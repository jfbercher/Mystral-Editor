/**
 * Un noyau Jupyter comme moteur de cellule.
 *
 * Jalon 1 du point 50 : exécuter, évaluer, interrompre, redémarrer. Ni panneau
 * de variables, ni sidecar — leurs capacités ne sont pas déclarées, donc
 * l'interface ne les proposera pas plutôt que d'échouer en les tentant.
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

  // Le backend des figures, posé une fois pour le noyau.
  //
  // Sans cela une figure n'est pas envoyée du tout : le noyau rend le `repr` de
  // l'objet -- `<seaborn.axisgrid.FacetGrid at 0x…>` -- et aucun `display_data`
  // ne suit. JupyterLab n'a pas ce problème parce que `matplotlib_inline` s'y
  // impose comme backend par défaut ; lancé depuis notre shell, il ne s'impose
  // pas toujours. C'est le pendant du `matplotlib.use("agg")` que Pyodide pose
  // de son côté : chaque moteur doit dire où ses figures vont.
  //
  // En silence, et sans conséquence si matplotlib n'est pas installé : le
  // noyau répondra une erreur que personne n'attend et que personne ne lit.
  try {
    await request(
      link,
      "execute_request",
      { code: "%matplotlib inline", silent: true, store_history: false, user_expressions: {}, allow_stdin: false },
      () => {},
    );
  } catch (err) {
    console.warn("[jupyter] backend des figures :", err);
  }

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
function request(link, msgType, content, onMessage) {
  return new Promise((resolve, reject) => {
    link.send(msgType, content).then((msgId) => {
      pending.set(msgId, {
        on: (msg) => {
          onMessage(msg);
          if (msg.msg_type === "status" && msg.content?.execution_state === "idle") {
            pending.delete(msgId);
            resolve();
          }
        },
        fail: (err) => reject(err),
      });
    }, reject);
  });
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
  return { softened: false, removed: [] };
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
    // Ni `magics` -- `%load` met des fichiers dans un système de fichiers
    // virtuel qui n'existe pas ici --, ni `inspect`, ni `snapshot` : ce sont
    // les jalons suivants, et une capacité non déclarée vaut mieux qu'un
    // bouton qui échoue.
    capabilities: ["expressions", "interrupt"],
    ready: () => startJupyter(),
    isReady: () => jupyterRunning(),
    execute,
    evaluate,
    interrupt,
    restart,
  });
}
