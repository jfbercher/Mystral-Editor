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
 *   execute(code, opts)      -- opts: { packages, onStream, space }; streams as it goes
 *   evaluate(expr, space)    -- one expression and its value, for the {eval} role
 *   interrupt(space)         -- stop what is running there, without losing it
 *   restart(space)           -- empty that namespace, keep the engine
 *   inspect(includeAll, space) -- what the namespace holds, for the variable panel
 *   forget(names, opts)      -- remove variables from a namespace
 *   snapshot(space)          -- the namespace as something storable, for the sidecar
 *   restore(snapshot, space) -- put one back
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
export function spaceKey(space, docId) {
  const value = String(space ?? "").trim();
  if (!value || value === SHARED_SPACE) return SHARED_SPACE;
  if (value !== "isolated") return `group:${value}`;
  if (docId) return `doc:${docId}`;
  // No id means a document that has never been saved. Falling back to the
  // shared namespace would silently do the opposite of what it asked for, so it
  // gets one anyway; it just will not be found again once the tab is gone.
  console.warn('[namespace] "python: isolated" on a document with no id — isolated for this tab only');
  return "doc:unsaved";
}

/** What the indicator shows: the value as written, or "shared" when unset. */
export function spaceLabel(space) {
  const value = String(space ?? "").trim();
  return value || SHARED_SPACE;
}

export const isSharedSpace = (key) => key === SHARED_SPACE;

/**
 * What an engine may or may not be able to do.
 *
 * Written as a closed list so that a new engine is read against it rather than
 * declaring capabilities nobody asks about.
 */
export const CAPABILITIES = [
  /** `{eval}` and the parameter controls: Python source sent to a Python runtime. */
  "expressions",
  /** `%load`, `%whos` and the other magics this editor rewrites. */
  "magics",
  /** The variable panel: listing a namespace and deleting from it. */
  "inspect",
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

/** The engine a cell should talk to. Takes a space, for the day the answer depends on it. */
export function runtime(/* space */) {
  const engine = engines.get(active);
  if (!engine) throw new Error("no runtime registered");
  return engine;
}

/** Every engine declared, for a setting that would let one be chosen. */
export const listRuntimes = () => [...engines.values()].map(({ name, capabilities }) => ({ name, capabilities }));

/** Is this within reach here? Ask before offering it, not after failing at it. */
export const supports = (capability, space) => Boolean(runtime(space)?.capabilities?.includes(capability));

/** Choose an engine by name; unknown names are refused rather than silently ignored. */
export function useRuntime(name) {
  if (!engines.has(name)) throw new Error(`unknown runtime: ${name}`);
  active = name;
  console.log(`[runtime] les cellules s'exécutent désormais dans « ${name} »`);
  return engines.get(name);
}

// Depuis la console, le temps du jalon 1 : le choix par le frontmatter
// (`kernelspec`, voir le point 18 du backlog) est l'étape suivante.
//   window.mystralUseRuntime("jupyter")   puis   ("pyodide")
if (typeof window !== "undefined") {
  window.mystralUseRuntime = useRuntime;
  window.mystralRuntimes = listRuntimes;
}
