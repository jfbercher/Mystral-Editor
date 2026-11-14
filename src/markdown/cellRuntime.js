/**
 * What a code cell asks of whatever runs it.
 *
 * Everything executable in this editor runs in Pyodide, and that is not about
 * to change: a WebAssembly interpreter needs no installation, works in the web
 * build, and is the reason a document can be opened and run by someone who has
 * nothing. But a desktop install often *does* have a Python, and a Jupyter
 * kernel there would bring what WebAssembly cannot: a real interrupt on a
 * runaway loop, the user's own packages and compiled wheels, a real filesystem,
 * the kernel's own completion and introspection -- and, since an `ipykernel`
 * runs the same language, none of what is written here for Python would have
 * to be unplugged.
 *
 * This module is not that second engine. It is the line along which one could
 * be added: the verbs, written down, and a register that says which engine
 * answers them. Pyodide is its first implementation rather than its only path.
 *
 * ## The contract
 *
 * An engine declares a `name`, a set of `capabilities`, and these verbs. The
 * shapes are those `pyodideRunner` already uses, because an interface invented
 * ahead of its second implementation is a guess, while one read off the first
 * is a fact:
 *
 *   ready(packages)          -- bring the engine up, with those packages; resolves when it can run
 *   isReady()                -- without starting anything
 *   execute(code, opts)      -- opts: { packages, onStream, space, cwd, resetCwd }; streams as it goes
 *   evaluate(expr, space)    -- one expression and its value, for the {eval} role
 *   interrupt(space)         -- stop what is running there, without losing it
 *   restart(space)           -- empty that namespace, keep the engine
 *   inspect(includeAll, space) -- what the namespace holds, for the variable panel
 *   forget(names, opts)      -- remove variables from a namespace
 *   snapshot(space)          -- the namespace as something storable, for the sidecar
 *   restore(snapshot, space) -- put one back
 *   complete(source, pos, space) -- what could be typed here, for the editor
 *
 * `complete` is the odd one: it answers about source, not about a namespace,
 * and the two engines reach it by opposite routes -- Pyodide reads the text
 * with jedi, a kernel asks its own running state. So it returns what both can
 * say and nothing more: `{ from, to, items }`, each item carrying the text to
 * insert and, when the engine can produce one, a `doc()` that fetches its
 * documentation only if the editor asks. It is not `inspect`: that one is the
 * variable panel, and a cell editor needs neither.
 *
 * ## Capabilities, declared rather than discovered
 *
 * An engine says what it can do, and the interface asks before offering it. A
 * control that is greyed out with a reason is honest; one that is there and
 * does nothing is a defect, and this editor has paid for that lesson more than
 * once. A kernel that is not Python would answer `false` to `magics` and to
 * `expressions` -- our `{eval}` and our `%load` are Python source, not services
 * -- without any of it having to be guessed at the call site.
 *
 * ## What is *not* here
 *
 * The namespace vocabulary below is ours, not an engine's: a document saying
 * `python: isolated` is asking this editor a question about documents, and the
 * answer is the same whoever runs the code. It lives here rather than in the
 * Pyodide module, where `text.js` had to reach for it.
 *
 * Cells themselves -- their widget, their cache, their toolbar -- are not part
 * of this either. They are the same cells whatever runs them.
 */

/** The namespace every document uses unless it asks for another. */
export const SHARED_SPACE = "shared";

/**
 * The registry key for a frontmatter value.
 * `isolated` is not one namespace but one per document, hence the document id:
 * without it two isolated documents would land in the same place, which is the
 * very thing being avoided.
 */
export function spaceKey(space, docId, kernelTag = "") {
  const value = String(space ?? "").trim();
  // Un espace de noms ne peut pas s'étendre sur deux interprètes : des
  // variables vivent dans un processus, et deux documents qui ne tournent pas
  // dans le même ne partagent rien, quoi qu'en dise leur frontmatter. Un
  // document qui demande un noyau d'une autre langue a donc le sien, et
  // `python: shared` veut dire « partagé avec les documents du même
  // interprète ». Sans cette marque, un document R et un document Python
  // tombaient tous deux dans « shared », donc dans le même noyau -- le
  // premier arrivé l'emportait et le second s'exécutait dans la mauvaise
  // langue.
  const tag = String(kernelTag ?? "")
    .trim()
    .toLowerCase();
  //
  // La marque se pose sur le mot de tête -- `shared@ir`, `group@ir:cours`,
  // `doc@ir:<clé>` -- et non à la fin : une clé de fichier peut contenir un
  // arobase, et une marque posée au bout s'y perdrait. En tête, seul le
  // segment qui précède le deux-points est lu, et celui-là est à nous.
  const mark = tag ? `@${tag}` : "";
  if (!value || value === SHARED_SPACE) return SHARED_SPACE + mark;
  if (value !== "isolated") return `group${mark}:${value}`;
  // Un espace isolé l'est déjà par le document, mais la marque y reste : elle
  // n'y sépare rien, elle y renseigne. Une clé qui porte son noyau se relit
  // sans rien d'autre, et c'est ce dont la restauration d'un sidecar a besoin
  // quand elle arrive avant que le document ait dit quoi que ce soit.
  if (docId) return `doc${mark}:${docId}`;
  // No id means a document that has never been saved. Falling back to the
  // shared namespace would silently do the opposite of what it asked for, so it
  // gets one anyway; it just will not be found again once the tab is gone.
  console.warn('[namespace] "python: isolated" on a document with no id — isolated for this tab only');
  return `doc${mark}:unsaved`;
}

/** What the indicator shows: the value as written, or "shared" when unset. */
export function spaceLabel(space, kernelTag = "") {
  const value = String(space ?? "").trim() || SHARED_SPACE;
  const tag = String(kernelTag ?? "").trim();
  // Le noyau est nommé quand il sépare : « shared » et « shared (ir) » sont
  // deux espaces, et l'indicateur mentirait en les appelant pareil.
  return tag ? `${value} (${tag})` : value;
}

export const isSharedSpace = (key) => key === SHARED_SPACE;

/**
 * Le noyau qu'une clé d'espace porte, ou rien.
 *
 * `shared@ir` dit « ce document tourne sur `ir` » sans qu'on ait à retrouver
 * le document. C'est la seule chose qui reste lisible quand un sidecar se
 * restaure avant le premier rendu, c'est-à-dire avant que le frontmatter ait
 * été lu.
 */
export function kernelTagOf(key) {
  const head = String(key ?? "").split(":")[0];
  const at = head.indexOf("@");
  return at < 0 ? "" : head.slice(at + 1);
}

/**
 * What an engine may or may not be able to do.
 *
 * Written as a closed list so that a new engine is read against it rather than
 * declaring capabilities nobody asks about.
 */
export const CAPABILITIES = [
  /** `{eval}` and the parameter controls: Python source sent to a Python runtime. */
  "expressions",
  /**
   * The magics this editor understands: `%load`, `%whos`, `%who`.
   *
   * Both engines have them, by different routes -- `%load` is a rewrite the
   * editor does on the text, before any engine sees it, while `%whos` is
   * expanded into a call for Pyodide and answered by IPython itself in a
   * kernel. The capability was once declared by Pyodide alone, on the belief
   * that `%load` needed the virtual filesystem; it does not, it only reads a
   * file and puts its text in the cell.
   */
  "magics",
  /**
   * The engine works on the document's folder itself, rather than on a copy.
   *
   * Pyodide stages the files a cell names into an in-memory filesystem and
   * copies back what the cell wrote; a kernel simply opens them. What a
   * document may read differs accordingly, which is why this is declared
   * rather than assumed -- see `docs/executable-content.md`.
   */
  "localfiles",
  /** The variable panel: listing a namespace and deleting from it. */
  "inspect",
  /** Completion and documentation in the cell editor: the `complete` verb. */
  "completion",
  /** Storing a namespace in the sidecar and putting it back. */
  "snapshot",
  /** Stopping a cell that will not stop by itself: the `interrupt` verb. */
  "interrupt",
  /** ipywidgets and the comm protocol they travel on. */
  "widgets",
];

/** Engines by name, in the order they were registered. */
const engines = new Map();
let active = null;

/**
 * The engine a given namespace runs on, when it is not the default one.
 *
 * `runtime(space)` has always taken a space, "for the day the answer depends
 * on it". That day is here: the choice is a property of the document -- its
 * frontmatter names a kernel, or it does not -- and two documents open side by
 * side may legitimately answer differently, one on a kernel and one on
 * Pyodide. `engineChoice.js` decides; this map is only where the decision is
 * kept.
 */
const perSpace = new Map();

/**
 * Declare an engine. The first one registered is the active one, which keeps
 * today's behaviour exactly: Pyodide registers itself when its module loads,
 * and nothing has to choose.
 */
export function registerRuntime(engine) {
  if (!engine?.name) throw new Error("a runtime must have a name");
  engines.set(engine.name, engine);
  if (!active) active = engine.name;
  return engine;
}

/** The engine a cell should talk to: this namespace's, or the default one. */
export function runtime(space) {
  const engine = engines.get(perSpace.get(space) ?? active);
  if (!engine) throw new Error("no runtime registered");
  return engine;
}

/** Every engine declared, for a setting that would let one be chosen. */
export const listRuntimes = () => [...engines.values()].map(({ name, capabilities }) => ({ name, capabilities }));

/**
 * Is this within reach here? Ask before offering it, not after failing at it.
 *
 * An engine may answer for the space rather than in general: the Jupyter
 * engine declares what a *Python* kernel can do, and an R kernel can do much
 * less of it -- our `{eval}`, our variable panel and our snapshots are Python
 * sent to a Python process. `capabilitiesIn` is how an engine says so; without
 * it the declared list stands, which is the case for Pyodide, whose answer
 * never depends on the document.
 */
export function supports(capability, space) {
  const engine = runtime(space);
  const declared = engine?.capabilitiesIn?.(space) ?? engine?.capabilities ?? [];
  return declared.includes(capability);
}

/** Choose an engine by name; unknown names are refused rather than silently ignored. */
export function useRuntime(name) {
  if (!engines.has(name)) throw new Error(`unknown runtime: ${name}`);
  active = name;
  // Un choix global efface les choix par espace, sans quoi il ne vaudrait que
  // pour les documents qui n'en ont pas encore fait un -- et depuis la
  // console, « désormais » doit vouloir dire partout.
  perSpace.clear();
  console.log(`[runtime] les cellules s'exécutent désormais dans « ${name} »`);
  return engines.get(name);
}

/**
 * Le moteur de cet espace-là. `null` le rend au choix par défaut.
 *
 * Pas `useRuntimeFor` : un nom commençant par « use » fait voir un hook React
 * à l'analyseur, qui réclame alors un composant autour de chaque appel.
 */
export function assignRuntime(space, name) {
  if (name && !engines.has(name)) throw new Error(`unknown runtime: ${name}`);
  if (name) perSpace.set(space, name);
  else perSpace.delete(space);
  return runtime(space);
}

/** Le nom du moteur de cet espace, sans le résoudre ni rien démarrer. */
export const runtimeNameFor = (space) => perSpace.get(space) ?? active;

// Depuis la console, le temps du jalon 1 : le choix par le frontmatter
// (`kernelspec`, voir le point 18 du backlog) est l'étape suivante.
//   window.mystralUseRuntime("jupyter")   puis   ("pyodide")
if (typeof window !== "undefined") {
  window.mystralUseRuntime = useRuntime;
  window.mystralRuntimes = listRuntimes;
}
