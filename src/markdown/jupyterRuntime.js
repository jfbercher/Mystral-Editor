/**
 * Un noyau Jupyter comme moteur de cellule.
 *
 * Jalons 1 et 2 du point 50 : exécuter, évaluer, interrompre, redémarrer, puis
 * les services — le panneau de variables et le sidecar. Ce qui n'est pas
 * déclaré dans les capacités n'est pas proposé par l'interface, plutôt que de
 * lui faire tenter ce qui échouerait.
 *
 * **Le Python des services n'est pas écrit ici.** Lister un espace, en retirer
 * une variable, l'enregistrer et le remettre sont les mêmes fonctions que sous
 * Pyodide : elles vivent dans `namespacePython.js` et tournent telles quelles
 * dans un CPython. Ce fichier n'en fournit que le transport — les poser dans
 * le noyau au démarrage, leur passer un argument, relire leur réponse.
 *
 * Pyodide reste le moteur par défaut et le seul du build web. Celui-ci ne
 * s'enregistre que là où il peut exister, et ne s'active que si on le demande.
 *
 * **Un noyau par espace de noms.** `spaceKey` dit déjà ce qu'un document veut
 * — partagé, isolé, ou un groupe nommé — et un noyau est exactement cela :
 * un état qui survit entre deux cellules et que deux documents peuvent vouloir
 * séparé. La correspondance est terme à terme, et c'est ce qui permet à
 * `restart` de devenir un vrai redémarrage de processus au lieu d'un vidage de
 * dictionnaire.
 */
import { registerRuntime, SHARED_SPACE } from "./cellRuntime.js";
import { NAMESPACE_HELPERS_PY, PERSISTENCE_HELPERS_PY, hideNamesPy } from "./namespacePython.js";
import { isTauri } from "../utils/local_utils/fs.js";
import { startJupyter, jupyterRunning } from "../utils/local_utils/jupyterServer.js";
import { jupyterFetch, openKernel } from "../utils/local_utils/jupyterLink.js";
import { chosenKernel } from "./engineChoice.js";
import { renderBundle } from "./mimeRenderers.js";

/**
 * Tracing for the widget path, behind a switch.
 *
 * `localStorage.mystWidgetDebug = "1"` in the console, then reload. The same
 * convention as the inline preview's own tracing: this path has three layers
 * -- protocol, routing, model -- and a defect in one of them looks exactly
 * like a defect in the others from outside.
 */
export const wdbg = (...args) => {
  try {
    if (typeof localStorage !== "undefined" && localStorage.mystWidgetDebug) console.log("[wdbg]", ...args);
  } catch {
    /* no storage, no tracing */
  }
};

const short = (id) => (id ? String(id).slice(0, 8) : "—");

/** Un noyau vivant, par espace. */
const kernels = new Map();

/**
 * Les demandes en cours, par identifiant de message.
 *
 * Un lien porte toutes les cellules d'un espace, et tout ce qui revient d'un
 * noyau nomme, dans son `parent_header`, la demande qui l'a provoqué. C'est la
 * seule façon de rendre une sortie à la bonne cellule.
 */
const pending = new Map();

/**
 * Les comms : le canal que les widgets empruntent.
 *
 * Préparation du terrain, pas encore les widgets eux-mêmes. Ce qui manquait
 * n'était pas le rendu mais le **routage** : tout ce qui revient d'un noyau
 * était rendu à la demande en cours, et un message sans demande était perdu.
 * Or un widget vit précisément après la fin de la cellule qui l'a créé --
 * chaque déplacement d'un curseur envoie un `comm_msg` qui ne répond à rien.
 * Ils arrivaient donc dans le vide, et aucun gestionnaire n'aurait pu les
 * rattraper après coup.
 *
 * Trois messages : `comm_open` quand le noyau déclare un objet partagé,
 * `comm_msg` pour chaque changement d'état dans un sens ou dans l'autre,
 * `comm_close` à la fin. Ils sont routés par `comm_id` et non par
 * `parent_header`, ce qui est leur seule identité durable.
 *
 * Ce que cela ne fait pas, et qu'il faudra : rendre les vues. Un
 * `display_data` de widget porte `application/vnd.jupyter.widget-view+json`
 * avec un `model_id` ; le relier à un modèle demande
 * `@jupyter-widgets/html-manager`, qui est la seule dépendance lourde du
 * sujet. D'ici là, la cellule dit qu'un widget est passé plutôt que de ne
 * rien montrer.
 */
const comms = new Map();
const commListeners = new Set();

/**
 * Listeners for what a comm message provokes on iopub.
 *
 * Distinct from `onComm`, which carries the comm protocol itself -- open,
 * update, close. This one carries what the kernel *printed, drew or raised*
 * while handling such a message, under its parent. The widget layer needs it
 * to fill an `Output`, and to show a plain `observe` that merely prints.
 */
const commOutputListeners = new Set();

/**
 * Parents an `Output` widget has claimed.
 *
 * Consulted by both routes, and that is the point. `interact` calls its
 * function once while the cell is still running, so that first figure travels
 * under the *cell's* parent rather than a comm's: collected as a cell output,
 * it appeared above the widget, and then again inside it on the next move.
 * A claimed parent belongs to the widget, wherever it was sent from.
 */
const claimedParents = new Set();

export function claimOutputParent(msgId) {
  if (msgId) claimedParents.add(msgId);
}

export function releaseOutputParent(msgId) {
  if (msgId) claimedParents.delete(msgId);
}

/** Does this parent belong to an `Output`, even if no model answers for it yet? */
export const isOutputParent = (msgId) => Boolean(msgId) && claimedParents.has(msgId);

/**
 * Which comm claims this parent, asked while the claim still stands.
 *
 * A claim is transient: the kernel clears `msg_id` as soon as the
 * `with output:` block ends, which is before a message buffered during the
 * widget layer's loading gets replayed. Asking then finds nothing -- neither
 * the register nor the model, whose trait is empty again -- and the content
 * of a first `Output` was lost exactly there. So the claiming comm is
 * resolved at the moment the message is diverted and carried along with it:
 * a comm id is permanent, a `msg_id` is not.
 */
function claimingComm(parent) {
  if (!parent) return null;
  for (const [commId, claimed] of outputClaims) if (claimed === parent) return commId;
  return null;
}

/** Hand a message to the widget layer, whichever route it arrived by. */
function tellCommOutput(msg, msgId, commId, space) {
  wdbg(
    "tellCommOutput",
    msg.msg_type,
    "parent =",
    short(msgId),
    "comm =",
    short(commId),
    "ready =",
    widgetsReady,
    "listeners =",
    commOutputListeners.size,
  );
  // Same queue as the comm messages, and for the same reason: a first
  // `Output` is filled while its manager is still being fetched.
  if (!widgetsReady && widgetBoot) {
    commBacklog.push(() => tellCommOutput(msg, msgId, commId, space));
    return;
  }
  for (const listener of commOutputListeners) {
    try {
      listener(msg, { msgId, commId, space });
    } catch (err) {
      console.warn("[widgets] a comm-output listener failed:", err);
    }
  }
}

export function onCommOutput(listener) {
  commOutputListeners.add(listener);
  return () => commOutputListeners.delete(listener);
}

/** S'abonner à ce qui passe sur les comms. Rend de quoi se désabonner. */
export function onComm(listener) {
  commListeners.add(listener);
  return () => commListeners.delete(listener);
}

/** Écrire sur un comm : ouvrir, envoyer un état, fermer. */
export function sendComm(space, msgType, content) {
  const entry = kernels.get(space);
  if (!entry) throw new Error(`aucun noyau pour l'espace ${space}`);
  return entry.link.send(msgType, content);
}

/**
 * Écrire, en rendant tout de suite l'identifiant du message, et en rendant
 * compte de ce qu'il provoque.
 *
 * Les deux comptent, et le second explique pourquoi un curseur déplacé à la
 * souris ne remontait pas au noyau. `WidgetModel.sync` compte ses messages en
 * vol et ne décrémente ce compte qu'en recevant le `status: idle` associé **au
 * `msg_id` que `send` a rendu** ; un identifiant vide, et le compte ne
 * redescend jamais : tout ce qui suit est mis en tampon au lieu d'être envoyé.
 *
 * L'identifiant est donc tiré ici, avant l'envoi -- ce que `link.send` permet
 * depuis la course réparée au jalon de la complétion -- et les messages qu'il
 * provoque sont rendus aux rappels `iopub` de l'appelant.
 */
export function sendCommMessage(space, msgType, content, callbacks = null) {
  const entry = kernels.get(space);
  if (!entry) throw new Error(`aucun noyau pour l'espace ${space}`);
  const msgId = crypto.randomUUID();
  // Always registered, callbacks or not. What a comm message provokes on
  // iopub is the whole of what `observe`, `interact` and `with output:`
  // produce: the kernel runs the callback under *this* parent and streams its
  // prints, figures and errors there. Keeping only the idle, as before, threw
  // all of it away -- which is why an observer looked dead when it was merely
  // speaking into a void.
  pending.set(msgId, {
    on: (msg) => {
      const handler = callbacks?.iopub?.[msg.msg_type];
      if (handler) {
        try {
          handler(msg);
        } catch (err) {
          console.warn("[widgets] an iopub callback failed:", err);
        }
      }
      tellCommOutput(msg, msgId, claimingComm(msgId) ?? content?.comm_id ?? null, space);
      if (msg.msg_type === "status" && msg.content?.execution_state === "idle") pending.delete(msgId);
    },
    fail: () => pending.delete(msgId),
  });
  entry.link.send(msgType, content, msgId).catch((err) => {
    pending.delete(msgId);
    console.warn(`[jupyter] ${msgType} non envoyé :`, err);
  });
  return msgId;
}

/** Ce qui est ouvert, pour la console et pour un gestionnaire qui arriverait en cours de route. */
export const listComms = () => [...comms.entries()].map(([id, c]) => ({ id, ...c }));

// Exposés pour la console : `onComm` y est joint parce qu'un `import()` depuis
// la console peut rendre une autre instance du module -- dont la liste
// d'abonnés serait vide, et l'essai muet sans qu'on sache pourquoi.
if (typeof window !== "undefined") {
  window.mystralComms = listComms;
  window.mystralOnComm = onComm;
}

/**
 * Le gestionnaire de widgets n'est chargé qu'à la vue d'un widget.
 *
 * Les paquets ipywidgets pèsent, et un document qui n'en a pas n'a pas à les
 * charger. Mais le gestionnaire doit exister *avant* le `comm_open` qui
 * annonce un modèle, sinon il le manque -- et c'est le seul message qui dit
 * qu'un modèle existe. D'où cet amorçage : le premier `comm_open` de widget
 * déclenche le chargement, et tout ce qui arrive pendant ce temps est mis de
 * côté puis rejoué dans l'ordre, ce même `comm_open` en tête.
 */
let widgetBoot = null;
let widgetsReady = false;

/**
 * What arrives while the widget layer loads, kept in order.
 *
 * Thunks rather than messages, because two kinds queue here: the comm
 * protocol itself, and the outputs a comm provokes. They have to be replayed
 * in the order they arrived -- a `comm_open` before the state that fills it,
 * a claim before what it captures -- and only one queue can promise that.
 * Buffering the first kind alone is what left the very first `Output` empty:
 * its content arrived during the loading and had no one to hear it.
 */
const commBacklog = [];

function bootWidgets(space) {
  if (widgetBoot) return;
  widgetBoot = import("./widgetManager.js")
    .then((mod) => mod.widgetManagerFor(space))
    .then(() => {
      widgetsReady = true;
      wdbg("boot terminé, rejeu de", commBacklog.length, "message(s)");
      for (const replay of commBacklog.splice(0)) replay();
    })
    .catch((err) => {
      console.warn("[widgets] manager unavailable:", err);
      commBacklog.length = 0;
    });
}

/** The parent each `Output` comm currently captures under. */
const outputClaims = new Map();

/**
 * Register an `Output`'s claim the instant it is announced.
 *
 * Reading it off the model would be too late: the state travels through the
 * widget machinery, which is asynchronous, while the output it is about to
 * capture arrives in the very next websocket message. The claim would land
 * after the figure it was meant to catch -- which is exactly what happened,
 * leaving `interact`'s first plot above the widget instead of inside it.
 * The raw message says it plainly and says it now.
 */
function noteOutputClaim(msg) {
  const state = msg.content?.data?.state;
  if (!state || !("msg_id" in state)) return;
  wdbg("claim", short(msg.content?.comm_id), "msg_id =", short(state.msg_id) || "(libéré)");
  const commId = msg.content?.comm_id;
  const previous = outputClaims.get(commId);
  if (previous) releaseOutputParent(previous);
  const claimed = String(state.msg_id ?? "");
  if (claimed) {
    outputClaims.set(commId, claimed);
    claimOutputParent(claimed);
  } else {
    outputClaims.delete(commId);
  }
}

function routeComm(msg, space) {
  const kind = msg.msg_type;
  if (kind !== "comm_open" && kind !== "comm_msg" && kind !== "comm_close") return false;
  noteOutputClaim(msg);
  const id = msg.content?.comm_id;
  // Personne n'écoute encore : soit c'est le premier widget et il faut
  // charger de quoi l'accueillir, soit le chargement est en cours et ce
  // message attend son tour.
  wdbg("routeComm", kind, short(id), msg.content?.target_name ?? "", "ready =", widgetsReady);
  if (!widgetsReady && (widgetBoot || msg.content?.target_name === "jupyter.widget")) {
    if (id && kind === "comm_open") comms.set(id, { target: msg.content?.target_name ?? "", space, openedAt: Date.now() });
    commBacklog.push(() => {
      for (const listener of commListeners) listener(msg, space);
    });
    bootWidgets(space);
    return true;
  }
  if (id) {
    if (kind === "comm_open") comms.set(id, { target: msg.content?.target_name ?? "", space, openedAt: Date.now() });
    else if (kind === "comm_close") comms.delete(id);
  }
  for (const listener of commListeners) {
    try {
      listener(msg, space);
    } catch (err) {
      console.warn("[jupyter] un abonné aux comms a échoué :", err);
    }
  }
  return true;
}

function route(msg, space) {
  if (msg.mystral) {
    // Le lien s'est fermé. Deux choses à faire, et la seconde manquait :
    // libérer les demandes en cours, qui resteraient sinon sans réponse et
    // bloqueraient les cellules qui les attendent ; et **oublier le noyau**,
    // sans quoi la prochaine exécution écrirait dans un lien que Rust ne
    // connaît plus et répondrait « no such link » indéfiniment. Oublié, il
    // est simplement recréé au prochain passage.
    //
    // Les demandes sont libérées toutes ensemble : elles ne disent pas de
    // quel espace elles viennent, et un second noyau vivant verrait les
    // siennes tomber avec les autres. C'est une imprécision assumée, pour un
    // évènement rare dont la suite est de toute façon une réexécution.
    failPending("le lien avec le noyau s'est fermé");
    if (kernels.delete(space)) console.warn(`[jupyter] lien perdu pour l'espace ${space} ; un noyau neuf sera ouvert à la prochaine exécution`);
    return;
  }
  // Avant le routage par demande : un comm n'en a pas, ou plus.
  if (routeComm(msg, space)) return;
  const parent = msg.parent_header?.msg_id;
  const waiting = parent ? pending.get(parent) : null;
  if (waiting) waiting.on(msg);
}

/**
 * Libérer tout ce qui attend une réponse.
 *
 * Une demande en cours n'a pas de délai de garde quand elle porte une cellule
 * -- une cellule a le droit de tourner une heure. Il faut donc que les
 * évènements qui rendent sa réponse impossible la libèrent explicitement,
 * sans quoi la cellule reste « en cours » pour toujours et aucun geste ne la
 * rend à son auteur. Un `%pip uninstall` attendant une confirmation qu'on ne
 * peut pas donner a montré le trou : le noyau redémarré, la cellule restait
 * bloquée, et ses voisines avec elle.
 */
function failPending(reason) {
  const waiting = [...pending.values()];
  pending.clear();
  for (const one of waiting) one.fail(new Error(reason));
}

/** Le noyau de cet espace, créé à la première demande. */
async function kernelFor(space = SHARED_SPACE) {
  const existing = kernels.get(space);
  if (existing) return existing;

  const started = await startJupyter();
  if (!started.ok) throw new Error(started.reason);
  const specs = await jupyterFetch("GET", "/api/kernelspecs");
  // Le noyau que `engineChoice` a retenu pour ce document, et non le noyau par
  // défaut du serveur : c'est toute la différence entre un document R et son
  // voisin Python ouverts en même temps.
  const wanted = chosenKernel(space);
  const name = wanted?.name && specs.kernelspecs?.[wanted.name] ? wanted.name : specs.default;
  // La langue décide de ce qu'on envoie et de ce qu'on déclare savoir faire.
  // Lue du serveur, qui la tient de la spécification du noyau lui-même.
  const language = String(specs.kernelspecs?.[name]?.spec?.language ?? wanted?.language ?? "python").toLowerCase();
  const created = await jupyterFetch("POST", "/api/kernels", { name });
  const link = await openKernel(created.id, (msg) => route(msg, space));
  const entry = { id: created.id, link, space, name, language };
  kernels.set(space, entry);

  await prepare(entry);

  console.log(`[jupyter] noyau ${name} (${language}) ${created.id} pour l'espace ${space}`);
  return entry;
}

/**
 * Une demande, et tout ce qu'elle provoque jusqu'au retour au repos.
 *
 * Le noyau dit lui-même quand il a fini : il repasse à `idle` sur le canal
 * iopub, et c'est ce message-là qui clôt la collecte — pas le `execute_reply`,
 * qui peut arriver avant les dernières sorties.
 */
function request(entry, msgType, content, onMessage, { timeoutMs = 0, replyType = null } = {}) {
  // Inscrite avant l'envoi, et non à son retour. `send` ne rend son
  // identifiant qu'une fois l'appel Tauri revenu, alors que le noyau peut
  // avoir déjà répondu : la réponse n'aurait alors trouvé personne, et la
  // promesse serait restée en suspens. Une exécution de plusieurs secondes
  // masquait la course ; une complétion qui revient en soixante
  // millisecondes la perd.
  const msgId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    // Un délai de garde pour les échanges de service, aucun pour une cellule :
    // une cellule a le droit de tourner une heure, alors qu'une demande à
    // laquelle le noyau ne répond pas -- parce qu'il redémarrait quand elle
    // est partie -- laisserait sinon son appelant suspendu pour toujours.
    const timer = timeoutMs
      ? setTimeout(() => {
          pending.delete(msgId);
          reject(new Error(`le noyau n'a pas répondu à ${msgType} en ${timeoutMs} ms`));
        }, timeoutMs)
      : null;
    const done = (settle, value) => {
      if (timer) clearTimeout(timer);
      pending.delete(msgId);
      settle(value);
    };
    pending.set(msgId, {
      on: (msg) => {
        onMessage(msg);
        // Une cellule se clôt au retour au repos, qui vient après ses
        // dernières sorties. Un échange de service se clôt sur sa réponse :
        // il n'en produit pas d'autre, et l'attendre le ferait dépendre d'un
        // message dont il n'a aucun besoin.
        if (replyType ? msg.msg_type === replyType : msg.msg_type === "status" && msg.content?.execution_state === "idle") done(resolve);
      },
      fail: (err) => done(reject, err),
    });
    // Un envoi qui échoue veut dire que le lien n'est plus : Rust ne le
    // connaît pas (« no such link »), ou il vient de se fermer. Le noyau est
    // oublié ici aussi, parce que la sentinelle de fermeture peut n'être
    // jamais arrivée -- une page rechargée, un serveur arrêté -- et qu'un
    // noyau fantôme rejouerait la même erreur à chaque exécution.
    entry.link.send(msgType, content, msgId).catch((err) => {
      if (kernels.get(entry.space) === entry) {
        kernels.delete(entry.space);
        console.warn(`[jupyter] lien inutilisable pour l'espace ${entry.space} ; il sera rouvert à la prochaine exécution`, err);
      }
      done(reject, new Error("le lien avec le noyau a été perdu ; la prochaine exécution ouvrira un noyau neuf, dont l'espace de noms sera vide"));
    });
  });
}

/**
 * Le transport des services, qui est tout ce que ce fichier ajoute au Python
 * partagé : de quoi faire entrer un argument et ressortir une réponse.
 *
 * Un argument entre en base64 plutôt qu'inséré dans le code : une liste de
 * noms, ou un instantané de plusieurs mégaoctets, n'a alors aucune chance
 * d'être relu comme du Python. Et la réponse sort par `print` : la valeur de
 * retour d'une cellule arrive sous forme de `repr`, qu'il faudrait désamorcer,
 * là où ce que `print` écrit est la chaîne elle-même.
 */
const KERNEL_BRIDGE_PY = `
def _mystral_text64(_payload):
    import base64 as _b64x
    return _b64x.b64decode(_payload).decode('utf-8')


def _mystral_base_name(_req):
    # Le nom de distribution d'une exigence : "pandas>=2.1" -> "pandas",
    # "scikit-learn[extra]" -> "scikit-learn". Sans expression reguliere, qui
    # voyagerait mal dans un litteral JS -- ses contre-obliques y disparaissent.
    _s = str(_req).strip().split('[')[0].split(';')[0]
    for _sep in ('===', '==', '>=', '<=', '!=', '~=', '>', '<'):
        _s = _s.split(_sep)[0]
    return _s.strip()


def _mystral_missing(_names):
    # Ce que le document demande et que ce noyau n'a pas. La distribution
    # d'abord, parce que c'est elle que l'exigence nomme et qu'elle connait
    # "scikit-learn" ; le module ensuite, parce qu'un paquet pose autrement
    # qu'avec pip s'importe sans qu'aucune distribution ne le declare.
    import importlib.metadata as _md, importlib.util as _iu
    _out = []
    for _n in _names:
        _base = _mystral_base_name(_n)
        if not _base:
            continue
        try:
            _md.version(_base)
            continue
        except Exception:
            pass
        try:
            if _iu.find_spec(_base.replace('-', '_')):
                continue
        except Exception:
            pass
        _out.append(_n)
    return _out


def _mystral_missing_json(_names):
    return _json_vi.dumps(_mystral_missing(_names))
`;

/** Les noms qu'IPython pose lui-même dans l'espace de l'utilisateur. */
const IPYTHON_NAMES = ["In", "Out", "get_ipython", "exit", "quit"];

/** Du texte, en base64, par morceaux : un instantané dépasse ce qu'un appel étalé encaisse. */
function b64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

/**
 * Du code de service : exécuté sans entrer dans l'historique, et dont on lit
 * le JSON imprimé. Une erreur du noyau devient une exception ici plutôt qu'une
 * réponse vide, parce qu'un panneau de variables qui se dit vide alors qu'il
 * n'a pas su regarder est le défaut que ce projet refuse.
 */
async function callJson(entry, code) {
  let out = "";
  let failure = null;
  await request(
    entry,
    "execute_request",
    { code, silent: false, store_history: false, user_expressions: {}, allow_stdin: false },
    (msg) => {
      const c = msg.content ?? {};
      if (msg.msg_type === "stream" && c.name === "stdout") out += c.text;
      if (msg.msg_type === "error") failure = `${c.ename}: ${c.evalue}`;
    },
    { timeoutMs: 30000 },
  );
  if (failure) throw new Error(failure);
  const text = out.trim();
  return text ? JSON.parse(text) : null;
}

/**
 * Ce qu'un noyau neuf doit savoir : où vont ses figures, et les fonctions des
 * services. À rejouer après un redémarrage, qui est un processus neuf.
 *
 * Le backend des figures, d'abord. Sans lui une figure n'est pas envoyée du
 * tout : le noyau rend le `repr` de l'objet -- `<seaborn.axisgrid.FacetGrid at
 * 0x…>` -- et aucun `display_data` ne suit. JupyterLab n'a pas ce problème
 * parce que `matplotlib_inline` s'y impose comme backend par défaut ; lancé
 * depuis notre shell, il ne s'impose pas toujours. C'est le pendant du
 * `matplotlib.use("agg")` que Pyodide pose de son côté : chaque moteur doit
 * dire où ses figures vont.
 */
async function prepare(entry) {
  // Tout ce préambule est du Python : le backend des figures, les fonctions
  // des services, le pont. L'envoyer à un noyau R n'en ferait pas du R, cela
  // ferait trois erreurs et une liste de capacités mensongère. Un noyau qui
  // n'est pas Python ne reçoit donc rien, et ne déclare rien de ce que ce
  // Python-là apporte -- voir `capabilitiesIn`.
  if (entry.language !== "python") {
    console.log(`[jupyter] noyau ${entry.name} (${entry.language}) : ni figures ni services, qui sont écrits en Python`);
    return;
  }
  const steps = [
    ["le backend des figures", "%matplotlib inline"],
    ["les fonctions des services", [NAMESPACE_HELPERS_PY, PERSISTENCE_HELPERS_PY, KERNEL_BRIDGE_PY, hideNamesPy(IPYTHON_NAMES)].join("\n")],
  ];
  for (const [what, code] of steps) {
    try {
      let failure = null;
      await request(
        entry,
        "execute_request",
        { code, silent: false, store_history: false, user_expressions: {}, allow_stdin: false },
        (msg) => {
          if (msg.msg_type === "error") failure = `${msg.content?.ename}: ${msg.content?.evalue}`;
        },
        { timeoutMs: 30000 },
      );
      // Un noyau sans matplotlib répond une erreur que personne n'attend ; un
      // noyau qui n'est pas Python refusera aussi les fonctions des services,
      // et ses capacités seront alors fausses -- mieux vaut le dire ici que
      // laisser le panneau de variables rendre du vide.
      if (failure) console.warn(`[jupyter] ${what} : ${failure}`);
    } catch (err) {
      console.warn(`[jupyter] ${what} :`, err);
    }
  }
}


/** Le paquet MIME d'un résultat, dans la forme que `{eval}` et les cellules attendent. */
function fromMimes(data = {}) {
  if (data["text/html"]) return { kind: "html", value: data["text/html"] };
  if (data["image/svg+xml"]) return { kind: "svg", value: data["image/svg+xml"] };
  if (data["image/png"]) return { kind: "png", value: data["image/png"] };
  return { kind: "text", value: String(data["text/plain"] ?? "") };
}

/**
 * Placer le noyau dans le dossier du document.
 *
 * C'est tout le jalon 3, et c'est une ligne de Python. Pyodide travaille sur
 * une copie : les fichiers qu'une cellule nomme sont repérés dans son source,
 * copiés dans un système de fichiers en mémoire sous `/local`, et recopiés
 * au retour. Un noyau n'a besoin de rien de tout cela -- il a le vrai
 * système de fichiers -- mais il démarre là où le serveur a été lancé, qui
 * n'est pas le dossier du document. D'où `os.chdir`.
 *
 * Ce n'est pas la racine du serveur qu'on change, contrairement à ce que le
 * plan supposait : la racine ne gouverne que les API de fichiers du serveur,
 * dont nous ne nous servons pas, et elle interdirait d'ouvrir un document
 * situé ailleurs. Le répertoire courant du noyau est ce qui décide de ce que
 * `open("data.csv")` lit, et il se règle noyau par noyau -- donc espace par
 * espace, ce qui est exactement la granularité qu'on veut.
 *
 * Demandé seulement quand il change : au premier passage, quand le document
 * n'est pas celui de la dernière exécution -- deux documents peuvent partager
 * un espace -- et à chaque exécution si `resetCwdOnRun` est posée, qui veut
 * dire qu'une cellule repart du dossier du document même si la précédente
 * s'est déplacée. En une demande à part, et non collée devant le code de la
 * cellule : préfixer le source décalerait les numéros de ligne de toutes ses
 * erreurs.
 */
async function placeKernel(entry, cwd, resetCwd) {
  if (!cwd || (entry.cwd === cwd && !resetCwd)) return;
  try {
    await request(
      entry,
      "execute_request",
      {
        code: `import os as _os_cwd; _os_cwd.chdir(${JSON.stringify(cwd)})`,
        silent: false,
        store_history: false,
        user_expressions: {},
        allow_stdin: false,
      },
      () => {},
      { timeoutMs: 15000, replyType: "execute_reply" },
    );
    entry.cwd = cwd;
  } catch (err) {
    // Un dossier devenu inaccessible, un noyau qui ne répond plus : la
    // cellule s'exécutera là où le noyau se trouve, et ce qu'elle dira de
    // `data.csv` sera clair. Mieux vaut cela que refuser de l'exécuter.
    console.warn(`[jupyter] le noyau n'a pas pu se placer dans ${cwd} :`, err);
  }
}

/**
 * Les paquets refusés, par espace : on ne redemande pas à chaque exécution.
 *
 * Le refus vaut pour la session, pas pour le document : il dit « pas dans cet
 * environnement », ce qui est une décision sur la machine, et elle ne survit
 * pas à une fermeture — rien n'est écrit nulle part.
 */
const declinedPackages = new Map();

/** Deux boutons, qui est tout ce que les dialogues natifs offrent. */
async function askYesNo(message, title, okLabel, cancelLabel) {
  if (!isTauri()) return window.confirm(`${message}\n\nOK: ${okLabel} — Cancel: ${cancelLabel}`);
  const { ask } = await import("@tauri-apps/plugin-dialog");
  return await ask(message, { title, kind: "warning", okLabel, cancelLabel });
}

const askToInstall = (names, kernelName) =>
  askYesNo(
    `This document asks for ${names.join(", ")}.\n\n` +
      `They are not installed in the kernel (${kernelName}). Install them there with %pip?\n\n` +
      `This changes the Python environment on this machine, not just this document.`,
    "Install packages?",
    "Install",
    "Skip",
  );

/**
 * `:packages:` sous un noyau.
 *
 * L'option fait installer par micropip sous Pyodide, où l'environnement est
 * jetable et n'appartient à personne. Un noyau est l'environnement de
 * quelqu'un : y installer sans le dire serait s'autoriser à modifier une
 * machine parce qu'un document le demande, et un document peut venir
 * d'ailleurs. Échouer serait l'autre excès, puisque le document n'a rien fait
 * de mal -- il a été écrit pour Pyodide.
 *
 * Donc : demander, une fois, en nommant ce qui manque, et n'installer que ce
 * qui manque. Un refus est retenu pour la session, et la cellule s'exécute
 * quand même : si elle a vraiment besoin du paquet, son `ImportError` le dira
 * mieux que nous.
 */
async function ensurePackages(entry, packages, onStream) {
  if (!packages?.length) return;
  const refused = declinedPackages.get(entry.space) ?? new Set();
  const wanted = packages.filter((name) => !refused.has(name));
  if (!wanted.length) return;

  let missing;
  try {
    missing = await callJson(entry, `print(_mystral_missing_json(_json_vi.loads(_mystral_text64("${b64(JSON.stringify(wanted))}"))))`);
  } catch (err) {
    console.warn("[jupyter] impossible de savoir quels paquets manquent :", err);
    return;
  }
  if (!missing?.length) return;

  if (!(await askToInstall(missing, entry.name ?? "python"))) {
    for (const name of missing) refused.add(name);
    declinedPackages.set(entry.space, refused);
    console.warn(`[jupyter] ${missing.join(", ")} non installés (refusé) ; la cellule s'exécute sans eux`);
    return;
  }

  // La sortie de l'installation est diffusée dans la cellule : elle est
  // longue, parfois bavarde, et c'est précisément ce qu'on veut voir quand on
  // vient d'autoriser une modification de son environnement.
  await request(
    entry,
    "execute_request",
    { code: `%pip install ${missing.join(" ")}`, silent: false, store_history: false, user_expressions: {}, allow_stdin: false },
    (msg) => {
      if (msg.msg_type === "stream") onStream?.(msg.content?.name === "stderr" ? "stderr" : "stdout", msg.content?.text ?? "");
    },
    { timeoutMs: 600000 },
  );
}

/**
 * `%pip uninstall` sans `-y`.
 *
 * pip demande « Proceed (Y/n)? » sur son entrée standard. La cellule n'en a
 * pas : `allow_stdin` est faux, ce qui fait échouer proprement un `input()`
 * du document, mais pip est un sous-processus et sa question n'emprunte pas
 * le protocole -- elle part dans un terminal qui n'existe pas. Rien ne revient
 * jamais, et la cellule attend pour toujours.
 *
 * Ajouter `-y` d'office reviendrait à confirmer à la place de quelqu'un une
 * opération qui retire des paquets de sa machine. On demande donc, comme pour
 * l'installation, et on n'écrit `-y` que si la réponse est oui. La ligne du
 * document n'est pas modifiée : seul ce qui part au noyau l'est, et sur la
 * même ligne, donc sans décaler les numéros d'une erreur.
 */
const UNINSTALL_WITHOUT_YES = /^[ \t]*[%!]pip[ \t]+uninstall\b(?![^\n]*(?:^|[ \t])-(?:y\b|-yes\b))[^\n]*$/gm;

async function guardUninstall(code) {
  UNINSTALL_WITHOUT_YES.lastIndex = 0;
  if (!UNINSTALL_WITHOUT_YES.test(code)) return code;
  const agreed = await askYesNo(
    "This cell runs `pip uninstall`, which asks for a confirmation the editor cannot answer: " +
      "the question goes to a terminal that does not exist, and the cell would wait for ever.\n\n" +
      "Run it with -y, removing the packages without further confirmation?",
    "Uninstall packages?",
    "Run with -y",
    "Cancel",
  );
  if (!agreed) return null;
  UNINSTALL_WITHOUT_YES.lastIndex = 0;
  return code.replace(UNINSTALL_WITHOUT_YES, (line) => `${line.replace(/[ \t]+$/, "")} -y`);
}

async function execute(code, { packages = [], onStream = null, space = SHARED_SPACE, cwd = null, resetCwd = false } = {}) {
  const started = performance.now();
  const guarded = await guardUninstall(code);
  if (guarded === null) {
    return {
      stdout: "",
      stderr: "",
      error: "cancelled: pip uninstall needs -y to run here",
      returnValue: null,
      outputs: [],
      durationMs: 0,
    };
  }

  const entry = await kernelFor(space);
  await placeKernel(entry, cwd, resetCwd);
  // Après le placement : une exigence peut nommer un chemin relatif au
  // document, comme une roue posée à côté de lui.
  await ensurePackages(entry, packages, onStream);
  let stdout = "";
  let stderr = "";
  let error = null;
  let returnValue = null;
  // One ordered list rather than a bucket per kind: a cell that draws, writes
  // and draws again used to show its two figures first, the order between
  // kinds being lost on the way out.
  const outputs = [];

  await request(entry, "execute_request", { code: guarded, silent: false, store_history: true, user_expressions: {}, allow_stdin: false }, (msg) => {
    const c = msg.content ?? {};
    // An `Output` widget may have claimed this very execution as its parent --
    // `interact` does it, before its first call draws anything. What it has
    // claimed is its own: it goes to the widget layer and not into the cell's
    // outputs, which otherwise showed the first figure twice, once above the
    // widget and once inside it.
    const parent = msg.parent_header?.msg_id;
    const isWidgetView = Boolean(c.data?.["application/vnd.jupyter.widget-view+json"]);
    if (msg.msg_type !== "status") {
      wdbg("cellule", msg.msg_type, "parent =", short(parent), "revendiqué =", claimedParents.has(parent), isWidgetView ? "(vue de widget)" : "");
    }
    // A widget view always belongs to the cell: it is what says *where* the
    // widget is to be drawn. Diverting it to the `Output` left the cell with
    // nothing to mount, and `interact` lost its slider along with the plot it
    // was meant to drive.
    if (msg.msg_type !== "status" && !isWidgetView && parent && claimedParents.has(parent)) {
      tellCommOutput(msg, parent, claimingComm(parent), space);
      return;
    }
    switch (msg.msg_type) {
      case "stream": {
        if (c.name === "stderr") stderr += c.text;
        else stdout += c.text;
        // Diffusé au fil de l'eau : une longue cellule doit montrer ce qu'elle
        // fait avant d'avoir fini, comme elle le fait déjà sous Pyodide.
        onStream?.(c.name === "stderr" ? "stderr" : "stdout", c.text);
        break;
      }
      case "display_data":
      case "execute_result": {
        // Which representation to draw is decided in one table, for the cells,
        // for the `Output` widgets and for Pyodide alike: see mimeRenderers.js.
        // A kernel delivers the whole bundle; under Pyodide the object has to
        // be asked, which is the only difference left between the two engines
        // here.
        const fragment = renderBundle(c.data, { textFallback: msg.msg_type === "execute_result" });
        if (!fragment) break;
        if (fragment.kind === "text") returnValue = fragment.text;
        else outputs.push(fragment);
        break;
      }
      case "error":
        error = `${c.ename}: ${c.evalue}`;
        break;
      default:
        break;
    }
  });

  return { stdout, stderr, error, returnValue, outputs, durationMs: Math.round(performance.now() - started) };
}

async function evaluate(expr, space = SHARED_SPACE) {
  const entry = await kernelFor(space);
  let value = { kind: "text", value: "" };
  await request(entry, "execute_request", { code: expr, silent: false, store_history: false, user_expressions: {}, allow_stdin: false }, (msg) => {
    const c = msg.content ?? {};
    if (msg.msg_type === "execute_result" || msg.msg_type === "display_data") value = fromMimes(c.data);
    if (msg.msg_type === "error") value = { kind: "error", value: `${c.ename}: ${c.evalue}` };
  });
  return value;
}

/** Arrêter ce qui tourne, sans perdre l'état. Ce que le WebAssembly ne sait pas faire. */
async function interrupt(space = SHARED_SPACE) {
  const entry = kernels.get(space);
  if (!entry) return false;
  await jupyterFetch("POST", `/api/kernels/${entry.id}/interrupt`);
  return true;
}

/** Un vrai redémarrage de processus, pas un vidage de dictionnaire. */
async function restart(space = SHARED_SPACE) {
  const entry = kernels.get(space);
  // `softened` reste faux : rien n'a été adouci, et `removed` ne peut pas
  // être rempli -- un processus neuf ne sait pas ce que le précédent tenait.
  // `restarted` dit ce qui s'est passé, et laisse l'interface écrire la
  // phrase juste au lieu d'annoncer zéro variable effacée.
  if (!entry) return { softened: false, removed: [], restarted: false };
  await jupyterFetch("POST", `/api/kernels/${entry.id}/restart`);
  // Ce que le processus d'avant devait encore est perdu avec lui : les
  // cellules qui l'attendaient doivent l'apprendre, et c'est la seule façon
  // de rendre la main à celle que le redémarrage venait délivrer.
  failPending("le noyau a redémarré pendant l'exécution de cette cellule");
  // Le processus est neuf : il ne sait plus ni où vont ses figures, ni ce que
  // sont les fonctions des services. Le `kernel_info_request` sert d'attente :
  // il ne revient au repos qu'une fois le noyau debout, et prépare donc moins
  // dans le vide qu'un délai choisi au jugé.
  try {
    await request(entry, "kernel_info_request", {}, () => {}, { timeoutMs: 30000, replyType: "kernel_info_reply" });
  } catch (err) {
    console.warn("[jupyter] redémarrage : le noyau tarde à répondre", err);
  }
  await prepare(entry);
  return { softened: false, removed: [], restarted: true };
}

/**
 * Enlever les couleurs ANSI dont IPython habille sa documentation.
 *
 * L'échappement est construit plutôt qu'écrit : un caractère de contrôle dans
 * un littéral d'expression régulière est une faute pour eslint, et il a raison
 * -- on ne le voit pas en relisant.
 */
const ANSI_COLOUR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const stripAnsi = (text) => String(text).replace(ANSI_COLOUR, "");

/**
 * L'introspection du noyau : ce qui peut s'écrire ici, et ce que c'est.
 *
 * C'est l'autre moitié de ce qu'un vrai Python apporte, et elle ne ressemble
 * pas à celle de Pyodide. jedi lit le texte et sait donc compléter avant toute
 * exécution, mais ne connaît que ce qu'il a pu déduire ; le noyau, lui, ne
 * répond qu'à partir de son état vivant -- il ignore une variable tant que la
 * cellule qui la pose n'a pas tourné, et en échange il connaît le vrai type de
 * ce qui est là, les attributs qu'un objet s'est donnés à l'exécution et les
 * noms qu'un `%pip install` vient d'apporter.
 *
 * Pas de noyau, pas de complétion : en créer un pour compléter un mot ferait
 * payer plusieurs secondes à la première frappe dans un document qu'on vient
 * d'ouvrir.
 */
async function complete(source, pos, space = SHARED_SPACE) {
  const entry = kernels.get(space);
  if (!entry) return null;

  let reply = null;
  await request(
    entry,
    "complete_request",
    { code: source, cursor_pos: pos },
    (msg) => {
      if (msg.msg_type === "complete_reply") reply = msg.content;
    },
    { timeoutMs: 10000, replyType: "complete_reply" },
  );
  if (reply?.status !== "ok" || !reply.matches?.length) return null;

  // Le noyau rend le mot entier à remplacer, et dit où il commence : c'est une
  // réponse plus riche que celle de jedi, qui rend le suffixe à insérer. Le
  // contrat porte les deux parce qu'il nomme un intervalle plutôt qu'un point.
  const from = reply.cursor_start;
  const to = reply.cursor_end;
  const kinds = reply.metadata?._jupyter_types_experimental ?? [];
  return {
    from,
    to,
    items: reply.matches.map((match, i) => ({
      name: match,
      insert: match,
      type: kinds[i]?.type && kinds[i].type !== "<unknown>" ? kinds[i].type : "text",
      // `inspect_request` répond sur une position dans un code, pas sur un
      // candidat. On lui soumet donc le texte tel qu'il serait si l'entrée
      // était acceptée, curseur au bout : la documentation obtenue est bien
      // celle de ce candidat-là, et non celle du mot incomplet sous le curseur.
      doc: () => describe(entry, source.slice(0, from) + match, from + match.length),
    })),
  };
}

async function describe(entry, probe, cursor) {
  let found = null;
  await request(
    entry,
    "inspect_request",
    { code: probe, cursor_pos: cursor, detail_level: 0 },
    (msg) => {
      if (msg.msg_type === "inspect_reply" && msg.content?.found) found = msg.content.data?.["text/plain"];
    },
    { timeoutMs: 10000, replyType: "inspect_reply" },
  );
  return found ? stripAnsi(found) : null;
}

/**
 * Les services : le panneau de variables et le sidecar.
 *
 * Chacun commence par refuser de créer un noyau. Un espace dans lequel rien
 * n'a tourné n'a rien à montrer ni à enregistrer, et en démarrer un pour le
 * constater ferait payer plusieurs secondes à l'ouverture d'un document --
 * pire, le sidecar écrirait par-dessus un instantané valable celui, vide,
 * d'un noyau qui vient de naître. `null` dit ici ce qu'il dit sous Pyodide :
 * rien n'est démarré, ce qui n'est pas la même chose qu'un espace vide.
 */
async function inspect(includeAll = false, space = SHARED_SPACE) {
  const entry = kernels.get(space);
  if (!entry) return null;
  return callJson(entry, `print(_mystral_varlist_json(${includeAll ? "True" : "False"}))`);
}

async function forget(names, { unloadModules = false, space = SHARED_SPACE } = {}) {
  const entry = kernels.get(space);
  if (!entry || !names?.length) return [];
  const removed = await callJson(
    entry,
    `print(_mystral_delete(_json_vi.loads(_mystral_text64("${b64(JSON.stringify(names))}")), ${unloadModules ? "True" : "False"}))`,
  );
  console.log(`[jupyter] retiré de ${space} : ${removed?.join(", ") || "rien"}`);
  return removed ?? [];
}

async function snapshot(space = SHARED_SPACE) {
  const entry = kernels.get(space);
  if (!entry) return null;
  const saved = await callJson(entry, "print(_mystral_snapshot_json())");
  const skipped = Object.entries(saved ?? {})
    .filter(([, e]) => e.skipped)
    .map(([n]) => n);
  if (skipped.length) {
    // Sous Pyodide, cloudpickle est garanti ; dans le noyau de quelqu'un
    // d'autre, il peut manquer, et `pickle` ne sait pas enregistrer une
    // fonction définie dans une cellule. Le dire une fois vaut mieux que
    // laisser découvrir à la réouverture que la moitié manque.
    console.warn(`[jupyter] non enregistré (non sérialisable) : ${skipped.join(", ")}`);
  }
  return saved;
}

async function restore(saved, space = SHARED_SPACE) {
  if (!saved || Object.keys(saved).length === 0) return;
  const entry = await kernelFor(space);
  const report = await callJson(entry, `print(_mystral_restore_json(_mystral_text64("${b64(JSON.stringify(saved))}")))`);
  const { ok = [], failed = {}, relinked = 0, never_saved: neverSaved = {} } = report ?? {};
  for (const [name, info] of Object.entries(failed)) {
    console.warn(`[jupyter] n'a pas pu restaurer « ${name} » : ${info.reason}`);
  }
  const never = Object.keys(neverSaved);
  if (never.length) console.info(`[jupyter] jamais enregistrées : ${never.join(", ")}`);
  console.log(
    `[jupyter] ${ok.length} variable(s) restaurée(s) dans ${space}` + (relinked ? `, ${relinked} fonction(s) reliée(s) à l'espace vivant` : ""),
  );
  return { ok, failed };
}

/** Fermer les liens et oublier les noyaux ; le serveur, lui, reste. */
export async function closeKernels() {
  for (const [space, entry] of kernels) {
    try {
      await entry.link.close();
      await jupyterFetch("DELETE", `/api/kernels/${entry.id}`);
    } catch (err) {
      console.warn(`[jupyter] fermeture de l'espace ${space} :`, err);
    }
  }
  kernels.clear();
}

// Enregistré seulement là où il peut exister. Pyodide s'étant enregistré le
// premier reste le moteur actif ; celui-ci attend `useRuntime("jupyter")`.
// `isTauri` est une fonction : non appelée, elle est vraie partout, et ce
// moteur se déclarait aussi dans le build web -- où il ne peut pas exister.
// Sans conséquence visible, Pyodide s'enregistrant le premier et le choix
// étant manuel, mais la condition ne disait pas ce qu'elle croyait dire.
if (isTauri()) {
  registerRuntime({
    name: "jupyter",
    // Pas `magics` : `%load` met des fichiers dans un système de fichiers
    // virtuel qui n'existe pas ici -- c'est le jalon 3. Pas `widgets` non
    // plus. Une capacité non déclarée vaut mieux qu'un bouton qui échoue.
    // `magics` : `%load` est une réécriture faite côté éditeur, qui lit le
    // fichier par le même chemin quel que soit le moteur, et `%whos` est
    // rendu ici par IPython lui-même. `localfiles` dit ce que le jalon 3
    // apporte : les cellules lisent et écrivent le dossier du document tel
    // qu'il est, sans copie ni recopie.
    capabilities: ["expressions", "magics", "interrupt", "inspect", "snapshot", "completion", "localfiles"],
    /**
     * Ce qu'un noyau donné sait faire, qui n'est pas ce que le moteur sait
     * faire. Nos services sont du Python envoyé à un processus Python :
     * `{eval}`, le panneau de variables, les instantanés, la complétion de
     * notre côté. Un noyau R garde ce qui ne dépend d'aucune langue --
     * l'interruption, et le dossier du document.
     */
    capabilitiesIn: (space) => {
      const language = kernels.get(space)?.language ?? chosenKernel(space)?.language ?? "python";
      return String(language).toLowerCase() === "python"
        ? ["expressions", "magics", "interrupt", "inspect", "snapshot", "completion", "localfiles"]
        : ["interrupt", "localfiles"];
    },
    // `:packages:` est traité par `execute`, qui a le noyau sous la main :
    // démarrer le serveur ne dit rien de ce qui est installé.
    ready: () => startJupyter(),
    // Un noyau vivant, et non le serveur allumé : c'est ce que le sidecar
    // demande avant d'enregistrer, et il ne doit enregistrer que s'il y a
    // quelque chose à prendre. L'équivalent exact de `isPyodideReady`.
    isReady: () => jupyterRunning() && kernels.size > 0,
    execute,
    evaluate,
    interrupt,
    restart,
    inspect,
    complete,
    forget,
    snapshot,
    restore,
  });
}
