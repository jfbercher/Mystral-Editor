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

function route(msg) {
  if (msg.mystral) {
    // Le lien s'est fermé : toutes les demandes en cours resteraient sans
    // réponse, ce qui bloquerait les cellules qui les attendent.
    for (const [, waiting] of pending) waiting.fail(new Error("le lien avec le noyau s'est fermé"));
    pending.clear();
    return;
  }
  const parent = msg.parent_header?.msg_id;
  const waiting = parent ? pending.get(parent) : null;
  if (waiting) waiting.on(msg);
}

/** Le noyau de cet espace, créé à la première demande. */
async function kernelFor(space = SHARED_SPACE) {
  const existing = kernels.get(space);
  if (existing) return existing;

  const started = await startJupyter();
  if (!started.ok) throw new Error(started.reason);
  const specs = await jupyterFetch("GET", "/api/kernelspecs");
  const created = await jupyterFetch("POST", "/api/kernels", { name: specs.default });
  const link = await openKernel(created.id, route);
  const entry = { id: created.id, link, space };
  kernels.set(space, entry);

  await prepare(link);

  console.log(`[jupyter] noyau ${created.id} pour l'espace ${space}`);
  return entry;
}

/**
 * Une demande, et tout ce qu'elle provoque jusqu'au retour au repos.
 *
 * Le noyau dit lui-même quand il a fini : il repasse à `idle` sur le canal
 * iopub, et c'est ce message-là qui clôt la collecte — pas le `execute_reply`,
 * qui peut arriver avant les dernières sorties.
 */
function request(link, msgType, content, onMessage, { timeoutMs = 0, replyType = null } = {}) {
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
    link.send(msgType, content, msgId).catch((err) => done(reject, err));
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
async function callJson(link, code) {
  let out = "";
  let failure = null;
  await request(
    link,
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
async function prepare(link) {
  const steps = [
    ["le backend des figures", "%matplotlib inline"],
    ["les fonctions des services", [NAMESPACE_HELPERS_PY, PERSISTENCE_HELPERS_PY, KERNEL_BRIDGE_PY, hideNamesPy(IPYTHON_NAMES)].join("\n")],
  ];
  for (const [what, code] of steps) {
    try {
      let failure = null;
      await request(
        link,
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

/**
 * Une image d'un paquet MIME, en URL de données.
 *
 * Complète, pas le base64 nu : le rendu fait `img.src = figure`, et une chaîne
 * qui n'est pas une URL est prise pour une adresse relative -- le navigateur
 * demande alors au serveur une adresse de cent mille caractères et reçoit un
 * `431 Request Header Fields Too Large`. C'est ce que valait l'image.
 */
function figureUrl(data = {}) {
  if (data["image/png"]) return `data:image/png;base64,${data["image/png"]}`;
  if (data["image/jpeg"]) return `data:image/jpeg;base64,${data["image/jpeg"]}`;
  if (data["image/svg+xml"]) return `data:image/svg+xml;utf8,${encodeURIComponent(data["image/svg+xml"])}`;
  return null;
}

/** Le paquet MIME d'un résultat, dans la forme que `{eval}` et les cellules attendent. */
function fromMimes(data = {}) {
  if (data["text/html"]) return { kind: "html", value: data["text/html"] };
  if (data["image/svg+xml"]) return { kind: "svg", value: data["image/svg+xml"] };
  if (data["image/png"]) return { kind: "png", value: data["image/png"] };
  return { kind: "text", value: String(data["text/plain"] ?? "") };
}

async function execute(code, { onStream = null, space = SHARED_SPACE } = {}) {
  const started = performance.now();
  const { link } = await kernelFor(space);
  let stdout = "";
  let stderr = "";
  let error = null;
  let returnValue = null;
  const figures = [];

  await request(link, "execute_request", { code, silent: false, store_history: true, user_expressions: {}, allow_stdin: false }, (msg) => {
    const c = msg.content ?? {};
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
        // Les figures arrivent comme des images, ce que Pyodide doit aller
        // chercher dans matplotlib : ici elles sont déjà dans le message.
        const image = figureUrl(c.data);
        if (image) figures.push(image);
        else if (msg.msg_type === "execute_result") returnValue = String(c.data?.["text/plain"] ?? "");
        break;
      }
      case "error":
        error = `${c.ename}: ${c.evalue}`;
        break;
      default:
        break;
    }
  });

  return { stdout, stderr, error, returnValue, figures, durationMs: Math.round(performance.now() - started) };
}

async function evaluate(expr, space = SHARED_SPACE) {
  const { link } = await kernelFor(space);
  let value = { kind: "text", value: "" };
  await request(link, "execute_request", { code: expr, silent: false, store_history: false, user_expressions: {}, allow_stdin: false }, (msg) => {
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
  if (!entry) return { softened: false, removed: [] };
  await jupyterFetch("POST", `/api/kernels/${entry.id}/restart`);
  // Le processus est neuf : il ne sait plus ni où vont ses figures, ni ce que
  // sont les fonctions des services. Le `kernel_info_request` sert d'attente :
  // il ne revient au repos qu'une fois le noyau debout, et prépare donc moins
  // dans le vide qu'un délai choisi au jugé.
  try {
    await request(entry.link, "kernel_info_request", {}, () => {}, { timeoutMs: 30000, replyType: "kernel_info_reply" });
  } catch (err) {
    console.warn("[jupyter] redémarrage : le noyau tarde à répondre", err);
  }
  await prepare(entry.link);
  return { softened: false, removed: [] };
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
    entry.link,
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
      doc: () => describe(entry.link, source.slice(0, from) + match, from + match.length),
    })),
  };
}

async function describe(link, probe, cursor) {
  let found = null;
  await request(
    link,
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
  return callJson(entry.link, `print(_mystral_varlist_json(${includeAll ? "True" : "False"}))`);
}

async function forget(names, { unloadModules = false, space = SHARED_SPACE } = {}) {
  const entry = kernels.get(space);
  if (!entry || !names?.length) return [];
  const removed = await callJson(
    entry.link,
    `print(_mystral_delete(_json_vi.loads(_mystral_text64("${b64(JSON.stringify(names))}")), ${unloadModules ? "True" : "False"}))`,
  );
  console.log(`[jupyter] retiré de ${space} : ${removed?.join(", ") || "rien"}`);
  return removed ?? [];
}

async function snapshot(space = SHARED_SPACE) {
  const entry = kernels.get(space);
  if (!entry) return null;
  const saved = await callJson(entry.link, "print(_mystral_snapshot_json())");
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
  const { link } = await kernelFor(space);
  const report = await callJson(link, `print(_mystral_restore_json(_mystral_text64("${b64(JSON.stringify(saved))}")))`);
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
if (isTauri) {
  registerRuntime({
    name: "jupyter",
    // Pas `magics` : `%load` met des fichiers dans un système de fichiers
    // virtuel qui n'existe pas ici -- c'est le jalon 3. Pas `widgets` non
    // plus. Une capacité non déclarée vaut mieux qu'un bouton qui échoue.
    capabilities: ["expressions", "interrupt", "inspect", "snapshot", "completion"],
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
