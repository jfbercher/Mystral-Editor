/**
 * Quel moteur exécute les cellules de ce document.
 *
 * Le contrat (`cellRuntime.js`) dit ce qu'un moteur sait faire ; ce module dit
 * lequel répond, et c'est une question de document et non d'application : deux
 * documents ouverts côte à côte peuvent légitimement répondre différemment,
 * l'un sur un noyau et l'autre sur Pyodide.
 *
 * ## La cascade
 *
 * Le réglage « Use a local Jupyter kernel » commande, et il est éteint par
 * défaut : rien ne change pour qui ne le demande pas, et un éditeur qui lance
 * un serveur Python sans qu'on l'ait voulu serait une surprise désagréable.
 *
 * Allumé, et seulement sur le bureau :
 *
 * 1. le `kernelspec` du frontmatter, s'il nomme un noyau installé ;
 * 2. sinon le premier noyau Python trouvé -- ce qui couvre le cas courant d'un
 *    carnet importé demandant `python3` sur une machine où le noyau s'appelle
 *    autrement ;
 * 3. sinon Pyodide, qui choisit lui-même entre son installation locale et le
 *    réseau : cette moitié-là de la cascade existe déjà et ne nous regarde pas.
 *
 * ## Quand le document demande ce qu'on ne peut pas lui donner
 *
 * Un carnet importé porte presque toujours un `kernelspec`, et le réglage est
 * éteint par défaut : poser une question à chaque ouverture serait
 * insupportable. La règle est donc celle du **langage**. Si le noyau demandé
 * est un Python, Pyodide en est un substitut fidèle et personne n'a besoin
 * d'être consulté. S'il ne l'est pas -- `ir`, `julia-1.10` --, exécuter du R
 * sous Python ne produirait que des erreurs de syntaxe sans rapport avec leur
 * cause : on explique, et on demande si Pyodide doit quand même essayer. La
 * réponse vaut pour la session et pour cet espace de noms, parce qu'une
 * question posée deux fois est une question de trop.
 *
 * Le langage d'un noyau absent de la machine ne peut pas être lu : il est
 * déduit du nom et du `display_name` que le document porte, ce qui reconnaît
 * « python3 » et « Python 3.11 » sans se prononcer sur le reste.
 */
import { assignRuntime, runtimeNameFor, kernelTagOf, SHARED_SPACE } from "./cellRuntime.js";
export { kernelSettingOn as interpreterMenuEnabled };
import { listJupyterKernels } from "../utils/local_utils/jupyterKernels.js";
import { isTauri } from "../utils/local_utils/fs.js";

/** L'identifiant du réglage, tel que `mystState.js` le déclare. */
export const KERNEL_SETTING = "jupyter-kernel";

/** Là où les réglages de l'éditeur sont écrits. */
const SETTINGS_KEY = "myst/settings";

/**
 * Le réglage, lu au moment de s'en servir.
 *
 * Dans le stockage local plutôt que dans l'état de l'application : ce module
 * est appelé depuis une cellule, qui n'a pas de contexte Preact, et c'est de
 * toute façon là que le réglage est conservé d'une session à l'autre. Relu à
 * chaque résolution, donc sans rien à réinitialiser quand il change -- seuls
 * les documents déjà résolus gardent leur choix, et `forgetChoices()` est là
 * pour cela.
 */
export function kernelSettingOn() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "[]");
    return Boolean(saved.find?.((entry) => entry?.id === KERNEL_SETTING)?.enabled);
  } catch {
    return false;
  }
}

/**
 * Le noyau que le frontmatter demande.
 *
 * Trois écritures ont cours : la chaîne nue, l'objet des carnets Jupyter
 * (`name`, `display_name`), et celle de mystmd qui le range sous `jupyter`.
 * Les trois disent la même chose, et aucune ne mérite qu'on refuse les autres.
 */
export function readKernelspec(fm) {
  const raw = fm?.kernelspec ?? fm?.jupyter?.kernelspec ?? null;
  if (!raw) return null;
  if (typeof raw === "string") return { name: raw.trim(), displayName: "" };
  const name = String(raw.name ?? "").trim();
  const displayName = String(raw.display_name ?? raw.displayName ?? "").trim();
  return name || displayName ? { name, displayName } : null;
}

/** Un nom qui annonce du Python, faute de pouvoir interroger un noyau absent. */
const looksPython = ({ name = "", displayName = "" } = {}) => /python|ipykernel|pyodide/i.test(`${name} ${displayName}`);

/**
 * La marque qu'un `kernelspec` laisse sur l'espace de noms.
 *
 * Vide pour tout ce qui est Python -- Pyodide, `python3`, `Python 3.11` : ces
 * documents partagent leurs variables comme ils l'ont toujours fait. Le nom du
 * noyau sinon, parce qu'un espace de noms ne peut pas s'étendre sur deux
 * interprètes et qu'un document R n'a rien à partager avec son voisin Python.
 */
export const kernelTagFor = (spec) => (!spec || looksPython(spec) ? "" : spec.name || spec.displayName || "");

/**
 * Ce que chaque document demande, et où il range ses variables.
 *
 * Par document et non par espace : le `kernelspec` est une propriété du
 * document, et deux documents peuvent légitimement se retrouver dans le même
 * espace. Les y avoir mêlés est précisément ce qui faisait que le second
 * document s'exécutait dans le noyau du premier.
 */
const declared = new Map();

/** Les décisions déjà prises, et les refus déjà essuyés, par document. */
const decided = new Map();

/** Le dernier document vu pour un espace, pour qui ne connaît que l'espace. */
const lastDocOf = new Map();

/**
 * Ce que le frontmatter de ce document demande, et dans quel espace il tombe.
 *
 * Appelé à chaque rendu, donc tenu de ne rien faire quand rien ne change :
 * modifier le `kernelspec` d'un document rouvre la question, le reste non.
 */
export function declareDocumentKernel(docKey, spec, space) {
  lastDocOf.set(space, docKey);
  const before = declared.get(docKey) ?? null;
  const same =
    (before?.spec?.name ?? null) === (spec?.name ?? null) &&
    (before?.spec?.displayName ?? null) === (spec?.displayName ?? null) &&
    before?.space === space;
  if (same) return;
  declared.set(docKey, { spec: spec ?? null, space });
  decided.delete(docKey);
}

/**
 * Listeners for "the engine of some document is now settled, or changed".
 *
 * The choice is resolved on the first run, not when the document opens, so
 * anything that displays it has to react rather than read once.
 */
const engineListeners = new Set();

export function onEngineChange(listener) {
  engineListeners.add(listener);
  return () => engineListeners.delete(listener);
}

function announce() {
  for (const listener of engineListeners) {
    try {
      listener();
    } catch (err) {
      console.warn("[runtime] an engine listener failed:", err);
    }
  }
}

/** What is running this document, for an indicator or a menu. */
export function currentChoice(docKey) {
  const entry = declared.get(docKey);
  const space = entry?.space ?? SHARED_SPACE;
  const decision = decided.get(docKey);
  return {
    space,
    engine: decision?.engine ?? runtimeNameFor(space),
    kernel: decision?.kernel ?? null,
    settled: Boolean(decision),
    declared: entry?.spec ?? null,
  };
}

/** Pyodide, plus whatever kernels this machine has. */
export async function availableInterpreters() {
  if (!isTauri() || !kernelSettingOn()) return { kernels: [], reason: "le réglage « Use local Jupyter kernel » est éteint" };
  const { available, kernels, reason } = await installedKernels();
  return { kernels: available ? kernels : [], reason: available ? "" : reason };
}

/**
 * Choose an interpreter for this document, for this session.
 *
 * Session-scoped on purpose: a lasting choice belongs in the document's
 * `kernelspec`, which is also what the namespace is derived from. Which is
 * why a kernel of another language is refused here rather than applied: its
 * namespace must be separate -- two interpreters cannot share one -- and only
 * the frontmatter can say so. Saying it plainly beats letting an R kernel
 * quietly take over the namespace a Python document is using.
 */
export function pickInterpreter(docKey, kernel = null) {
  const { space } = currentChoice(docKey);
  const tag = kernelTagOf(space);
  if (kernel) {
    const language = String(kernel.language ?? "").toLowerCase();
    const wanted = language === "python" ? "" : kernel.name.toLowerCase();
    if (wanted !== tag) {
      return {
        ok: false,
        reason: `« ${kernel.displayName || kernel.name} » n'est pas un Python : son espace de noms doit être à part. Déclarez-le dans le frontmatter (kernelspec), d'où l'espace est dérivé.`,
      };
    }
  }
  decided.set(docKey, { engine: kernel ? "jupyter" : "pyodide", kernel, refused: false, space });
  assignRuntime(space, kernel ? "jupyter" : "pyodide");
  announce();
  return { ok: true };
}

/** Le noyau retenu pour un espace, pour qui doit l'ouvrir. */
export function chosenKernel(space) {
  const choice = decided.get(lastDocOf.get(space));
  return choice?.space === space ? (choice.kernel ?? null) : null;
}

/**
 * Oublier les décisions, par exemple quand le réglage change.
 *
 * Les espaces sont rendus au moteur par défaut en même temps : sans cela, le
 * panneau de variables et la complétion continueraient de parler au noyau
 * jusqu'à la prochaine exécution, alors que le réglage dit le contraire.
 */
export function forgetChoices() {
  for (const choice of decided.values()) assignRuntime(choice.space, null);
  decided.clear();
  announce();
}

/** La liste des noyaux installés, demandée une fois par session. */
let kernelList = null;
const installedKernels = () => (kernelList ??= listJupyterKernels());

/** Deux boutons, comme ailleurs. */
async function askYesNo(message, title, okLabel, cancelLabel) {
  if (!isTauri()) return window.confirm(`${message}\n\nOK: ${okLabel} — Cancel: ${cancelLabel}`);
  const { ask } = await import("@tauri-apps/plugin-dialog");
  return await ask(message, { title, kind: "warning", okLabel, cancelLabel });
}

/** Expliquer, puis demander. */
async function askPyodideInstead(space, wanted, why) {
  const label = wanted.displayName || wanted.name;
  const agreed = await askYesNo(
    `This document asks for the "${label}" kernel, which is not being used here: ${why}.\n\n` +
      `Pyodide runs Python, so this document's cells would be read as Python -- which is probably not what they are.\n\n` +
      `Run them on Pyodide anyway?`,
    "Kernel not available",
    "Use Pyodide",
    "Do not run",
  );
  if (!agreed) console.warn(`[runtime] ${space} : exécution refusée faute du noyau « ${label} »`);
  return { engine: "pyodide", kernel: null, refused: !agreed };
}

/**
 * Le moteur de cet espace, résolu une fois puis retenu.
 *
 * Rend `{ engine, kernel, refused }`. `refused` dit qu'on a posé la question
 * et que la réponse était non : la cellule ne s'exécute pas, et le dit.
 */
export async function chooseEngineFor(docKey) {
  if (decided.has(docKey)) return decided.get(docKey);

  const entry = declared.get(docKey) ?? { spec: null, space: SHARED_SPACE };
  const wanted = entry.spec;
  const space = entry.space;
  const settle = (choice) => {
    decided.set(docKey, { ...choice, space });
    assignRuntime(space, choice.engine);
    announce();
    return choice;
  };

  // Le build web n'a qu'un moteur, et le réglage n'y veut rien dire.
  if (!isTauri() || !kernelSettingOn()) {
    if (wanted && !looksPython(wanted)) return settle(await askPyodideInstead(space, wanted, "the local kernel setting is off"));
    return settle({ engine: "pyodide", kernel: null, refused: false });
  }

  const { available, kernels, reason } = await installedKernels();
  const named = wanted?.name ? kernels.find((k) => k.name === wanted.name) : null;
  if (named) return settle({ engine: "jupyter", kernel: named, refused: false });

  // Un document muet, ou qui demande un Python que cette machine nomme
  // autrement : le premier Python fait l'affaire, et c'est ce que l'auteur
  // voulait dire.
  const python = kernels.find((k) => String(k.language).toLowerCase() === "python");
  if (python && (!wanted || looksPython(wanted))) {
    if (wanted && wanted.name !== python.name) console.log(`[runtime] ${space} : « ${wanted.name} » introuvable, exécution sur « ${python.name} »`);
    return settle({ engine: "jupyter", kernel: python, refused: false });
  }

  const why = !available ? reason || "no Jupyter installation was found" : `no kernel named "${wanted?.name ?? ""}" is installed here`;
  if (wanted && !looksPython(wanted)) return settle(await askPyodideInstead(space, wanted, why));
  if (wanted) console.log(`[runtime] ${space} : « ${wanted.name} » indisponible (${why}), exécution sur Pyodide`);
  return settle({ engine: "pyodide", kernel: null, refused: false });
}

/**
 * Le moteur d'un espace, pour qui n'a pas de document sous la main -- le
 * sidecar, qui restaure par espace. Résolu depuis le dernier document vu là,
 * ce qui suffit : les documents d'un même espace tournent par construction sur
 * des noyaux compatibles, la marque du `kernelspec` les ayant séparés sinon.
 */
export async function chooseEngineForSpace(space = SHARED_SPACE) {
  const known = lastDocOf.get(space);
  if (known) return chooseEngineFor(known);

  // Aucun document déclaré ici, et ce n'est pas une anomalie : un sidecar se
  // restaure **avant le premier rendu**, pour que les sorties soient en place
  // quand le document s'affiche -- donc avant que le frontmatter ait été lu.
  // Rendre le moteur par défaut à ce moment-là faisait présenter à Pyodide un
  // instantané écrit par un noyau, que la garde refusait à juste titre : les
  // sorties revenaient, les variables non.
  //
  // La clé de l'espace suffit pourtant à décider : elle porte le noyau quand
  // il en est un d'une autre langue, et son absence veut dire Python, ce qui
  // est précisément ce que la cascade sait traiter.
  const tag = kernelTagOf(space);
  const stand = `space:${space}`;
  if (!declared.has(stand)) declared.set(stand, { spec: tag ? { name: tag, displayName: "" } : null, space });
  lastDocOf.set(space, stand);
  return chooseEngineFor(stand);
}

/** Pour la console, et pour la barre d'état le jour où elle le dira. */
if (typeof window !== "undefined") {
  window.mystralEngineFor = (space = SHARED_SPACE) => ({
    chosen: runtimeNameFor(space),
    document: lastDocOf.get(space) ?? null,
    declared: declared.get(lastDocOf.get(space)) ?? null,
    decided: decided.get(lastDocOf.get(space)) ?? null,
  });
}
