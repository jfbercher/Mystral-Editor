/**
 * pyodideRunner.js — moteur Pyodide singleton + UI des cellules code-cell.
 * CM6-powered code cells with Python syntax highlighting, Tab completion, auto-indent.
 *
 * API publique :
 *   initCodeCell(el, code, { packages, linenos, hash })
 *   runAllCells(parent)
 *   clearAllCells(parent)
 *   softRestartKernel()
 */

import IMurMurHash from "imurmurhash";
import { workingDirectory, currentFileDir, isTauri } from "../utils/local_utils/fs.js";
import { config, loadConfig } from "../config.js";
import { showToast } from "../utils/utils_ui.js";

// CM6 imports — packages déjà présents dans le projet
import { EditorView, keymap as cmKeymap, lineNumbers, drawSelection } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { python } from "@codemirror/lang-python";
import { defaultKeymap, historyKeymap, history, indentWithTab } from "@codemirror/commands";
import { indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { pythonHighlightStyle as pythonHighlight } from "../extensions/pythonHighlightStyle";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";

// ─── Constantes ──────────────────────────────────────────────────────────────

const PYODIDE_CDN = "https://cdn.jsdelivr.net/pyodide/v0.29.3/full/";
const DEFAULT_PACKAGES = ["numpy", "matplotlib", "micropip"];

// ─── Singleton Pyodide ────────────────────────────────────────────────────────

let pyodideInstance = null;
let loadingPromise = null;
let loadState = "idle";
let loadError = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

export async function loadPyodideRuntime(extraPackages = []) {
  if (pyodideInstance) {
    if (extraPackages.length) await pyodideInstance.loadPackage(extraPackages);
    return pyodideInstance;
  }
  if (!loadingPromise) {
    loadingPromise = (async () => {
      if (typeof globalThis.loadPyodide !== "function") {
        await loadScript(`${PYODIDE_CDN}pyodide.js`);
      }
      const pyodide = await globalThis.loadPyodide({ indexURL: PYODIDE_CDN });
      await pyodide.loadPackage(DEFAULT_PACKAGES);
      pyodide.runPython(`
import sys, io, js

class _JsBridge(io.TextIOBase):
    # The js module is captured per instance rather than looked up in globals()
    # on every write: a stream that stops working because a name was rebound or
    # cleared elsewhere costs sys.stderr itself, and the error it raises can no
    # longer be printed.
    def __init__(self, tag, _js=js):
        self._tag = tag
        self._js = _js
    def write(self, s):
        self._js.globalThis._pyodideStreamWrite(self._tag, s)
        return len(s)
    def flush(self):
        pass

sys.stdout = _JsBridge("stdout")
sys.stderr = _JsBridge("stderr")
sys._mystral_env = True
`);
      pyodide.runPython(`import matplotlib\nmatplotlib.use("agg")`);

      // Préparer /local dans MEMFS et y positionner le CWD initial
      try { pyodide.FS.mkdir("/local"); } catch { /* already exists */ }
      pyodide.runPython("import os; os.chdir('/local')");

      // Installation de jedi pour la complétion Tab (best-effort, non bloquant)
      try {
        await pyodide.runPythonAsync(`
import micropip as _micropip
await _micropip.install(['jedi', 'cloudpickle'], keep_going=True)
import jedi as _jedi_mod, json as _json_mod

def _jedi_complete(source, line, col):
    try:
        cs = _jedi_mod.Script(source).complete(line, col)
        return _json_mod.dumps([
            {'name': c.name, 'complete': c.complete,
             'type': c.type,  'description': c.description}
            for c in cs[:80]
        ])
    except Exception:
        return '[]'
`);
        console.log('[myst] jedi loaded — completion Tab is active');
      } catch (_e) {
        console.warn('[myst] jedi unavailable, Tab will insert 4 spaces', _e);
      }

      pyodideInstance = pyodide;
      return pyodide;
    })();
  }
  const pyodide = await loadingPromise;
  if (extraPackages.length) await pyodide.loadPackage(extraPackages);
  return pyodide;
}

globalThis._pyodideStreamWrite = function (tag, text) {
  const cell = globalThis._pyodideCurrentCell;
  if (cell) {
    cell[tag] += text;
    // Let the running cell paint the text as it arrives instead of waiting for
    // executePython() to resolve.
    if (cell.onWrite) { try { cell.onWrite(tag, text); } catch { /* never break stdout */ } }
  }
  // Always mirror to the devtools console as well.  Two reasons:
  //  1. When a print happens after the cell's runPythonAsync() has resolved
  //     (async callback, deferred continuation), _pyodideCurrentCell is null
  //     and the text would otherwise vanish without a trace.
  //  2. It lets Python output be read in time order alongside JS console
  //     messages, which is the only way to debug async JS/Python interleaving.
  if (text && text.trim()) {
    const line = text.replace(/\n+$/, "");
    if (tag === "stderr") console.warn("[py]", line);
    else console.log("[py]", line);
  }
};

// ─── Namespace diagnostics ───────────────────────────────────────────────────
// A user-visible variable disappearing between two runs is invisible from the
// code alone: every mutation path (cell run, sidecar restore, kernel restart)
// writes into one shared globals() dict. This log records who touched what, so
// the question "when did x vanish, and because of whom?" is answered by data.
const namespaceLog = [];

function logNamespaceEvent(event, detail) {
  const entry = { at: new Date().toISOString(), event, ...detail };
  namespaceLog.push(entry);
  if (namespaceLog.length > 200) namespaceLog.shift();
  return entry;
}

/** Names currently bound in the Python globals (user-facing ones only). */
function userGlobalNames(pyodide) {
  try {
    const json = pyodide.runPython(
      "__import__('json').dumps(sorted(k for k in globals() if not k.startswith('_')))"
    );
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

globalThis.__mystralNamespaceDebug = {
  get log() { return namespaceLog; },
  names: () => (pyodideInstance ? userGlobalNames(pyodideInstance) : null),
  /** Every event that removed at least one name, oldest first. */
  losses: () => namespaceLog.filter((e) => e.removed?.length),
  dump() { console.table(namespaceLog.map(({ at, event, added, removed, failed }) =>
    ({ at, event, added: added?.join(" ") ?? "", removed: removed?.join(" ") ?? "", failed: failed?.join(" ") ?? "" }))); },
};

/**
 * Soft restart: keep the Pyodide instance, drop the user's state.
 *
 * A hard restart throws the interpreter away, and rebuilding it re-instantiates
 * the WASM runtime, reloads numpy/matplotlib and reinstalls jedi and cloudpickle
 * from PyPI -- several seconds of network, and a failure when offline. For the
 * everyday "give me a clean namespace" this is all that is needed.
 *
 * What it does NOT do, by design: modules already imported stay in sys.modules,
 * so a re-`import` does not re-execute them, and library-internal state (a
 * matplotlib backend, a numpy error mode) persists. Use the hard restart when
 * that matters.
 *
 * Names beginning with "_" are left alone: the runtime's own bridge, the jedi
 * completion helper and micropip live there. So are the few plain names bound
 * by the bootstrap, listed in RUNTIME_GLOBALS.
 */
// Plain names the bootstrap binds and the runtime keeps using. Clearing "js"
// broke the stdout/stderr bridge, which then could not even report its own
// failure ("lost sys.stderr").
const RUNTIME_GLOBALS = ["sys", "io", "js"];

export async function softRestartKernel() {
  if (!pyodideInstance) return { softened: false, removed: [] };
  const removed = (userGlobalNames(pyodideInstance) ?? []).filter((n) => !RUNTIME_GLOBALS.includes(n));
  pyodideInstance.runPython(`
_spared = frozenset(${JSON.stringify(RUNTIME_GLOBALS)})
_doomed = [_k for _k in globals() if not _k.startswith('_') and _k not in _spared]
for _n in _doomed:
    globals().pop(_n, None)
globals().pop('_doomed', None)
globals().pop('_n', None)
globals().pop('_spared', None)
try:
    import matplotlib.pyplot as _plt
    _plt.close('all')
    del _plt
except Exception:
    pass
import os as _os
_os.chdir('/local')
del _os
`);
  logNamespaceEvent("kernel-soft-restart", { removed });
  _cellExecutedListeners.forEach((fn) => fn());   // {eval} results are now stale
  return { softened: true, removed };
}

async function restartKernel() {
  logNamespaceEvent("kernel-restart", { removed: pyodideInstance ? (userGlobalNames(pyodideInstance) ?? []) : [] });
  if (pyodideInstance) {
    try {
      pyodideInstance.runPython("import sys; sys.stdout = sys.__stdout__; sys.stderr = sys.__stderr__");
    } catch {/* ignore */}
  }
  pyodideInstance = null;
  loadingPromise = null;
  loadState = "idle";
  loadError = null;
}

// ─── Accès aux fichiers locaux (workingDirectory → Pyodide MEMFS) ──────────────

function resolveWorkingDir() {
  if (isTauri()) return currentFileDir.value || workingDirectory.value || null;
  return workingDirectory.value || null;
}

async function copyFileToMemfs(pyodide, relPath) {
  const wd = resolveWorkingDir();
  if (!wd) return false;

  let bytes;
  try {
    if (isTauri()) {
      const { readFile } = await import("@tauri-apps/plugin-fs");
      const absPath = `${String(wd).replace(/\/$/, "")}/${relPath}`;
      bytes = await readFile(absPath);
    } else {
      const parts = relPath.replace(/\\/g, "/").split("/").filter(Boolean);
      const fileName = parts.pop();
      let dir = wd;
      for (const part of parts) dir = await dir.getDirectoryHandle(part);
      const fh = await dir.getFileHandle(fileName);
      const file = await fh.getFile();
      bytes = new Uint8Array(await file.arrayBuffer());
    }

    const dirs = relPath.split("/").slice(0, -1);
    let cur = "/local";
    for (const d of dirs) {
      cur += "/" + d;
      try { pyodide.FS.mkdir(cur); } catch { /* already exists */ }
    }
    pyodide.FS.writeFile("/local/" + relPath, bytes);
    return bytes;
  } catch (err) {
    console.warn(`[myst] copyFileToMemfs: impossible de copier "${relPath}"`, err);
    return null;
  }
}

function scanFilePaths(code) {
  const paths = new Set();
  // Match file literals in common function calls: open("f"), read_csv("f"), …
  const re = /(?:open|read_csv|read_excel|read_table|read_fwf|read_json|read_parquet|loadtxt|genfromtxt|load|savetxt)\s*\(\s*['"]([^'"\n]+)['"]/g;
  for (const m of code.matchAll(re)) {
    const p = m[1].replace(/\\/g, "/");
    if (!p.startsWith("/") && !/^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(p)) paths.add(p);
  }
  // Also match variable assignments with known data-file extensions:
  //   QUIZFILE = "intro-ds-tp.yaml"  or  CLIENT = "client_web.json"
  const reAssign = /=\s*['"]([^'"\n]+\.(?:yaml|yml|json|csv|tsv|txt|xlsx|xls|parquet))['"]/gi;
  for (const m of code.matchAll(reAssign)) {
    const p = m[1].replace(/\\/g, "/");
    if (!p.startsWith("/") && !/^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(p)) paths.add(p);
  }
  return [...paths];
}

async function prestageFiles(pyodide, code) {
  if (!resolveWorkingDir()) return new Map();
  try { pyodide.FS.mkdir("/local"); } catch { /* already exists */ }

  const paths = scanFilePaths(code);
  const prestagedBytes = new Map();
  if (paths.length) {
    const results = await Promise.all(
      paths.map(async (p) => {
        const bytes = await copyFileToMemfs(pyodide, p);
        return bytes ? ["/local/" + p.replace(/\\/g, "/"), bytes] : null;
      })
    );
    for (const entry of results) {
      if (entry) prestagedBytes.set(entry[0], entry[1]);
    }
  }
  return prestagedBytes;
}

globalThis._pyodideLocalFS = { copyFileToMemfs, workingDirectory };

// ─── Écriture retour : MEMFS /local → workingDirectory ──────────────────────────

function snapshotMemfsDir(pyodide, dir = "/local") {
  const map = new Map();
  const recurse = (d) => {
    let entries;
    try { entries = pyodide.FS.readdir(d); } catch { return; }
    for (const name of entries) {
      if (name === "." || name === "..") continue;
      const full = `${d}/${name}`;
      let stat;
      try { stat = pyodide.FS.stat(full); } catch { continue; }
      const isDir = (stat.mode & 0o170000) === 0o040000;
      if (isDir) { recurse(full); }
      else        { map.set(full, { size: stat.size, mtime: stat.mtime }); }
    }
  };
  recurse(dir);
  return map;
}

async function writeFileFromMemfs(pyodide, memfsPath) {
  const wd = resolveWorkingDir();
  if (!wd) return;
  if (wd.isReadOnlySnapshot) return;

  const relPath = memfsPath.slice("/local/".length);
  let bytes;
  try { bytes = pyodide.FS.readFile(memfsPath); }
  catch (err) {
    console.warn(`[myst] writeFileFromMemfs: lecture MEMFS impossible "${memfsPath}"`, err);
    return;
  }

  try {
    if (isTauri()) {
      const { writeFile, mkdir } = await import("@tauri-apps/plugin-fs");
      const base = String(wd).replace(/\/$/, "");
      const absPath = `${base}/${relPath}`;
      const parentDir = absPath.split("/").slice(0, -1).join("/");
      if (parentDir) await mkdir(parentDir, { recursive: true }).catch(() => {});
      await writeFile(absPath, bytes);
    } else {
      const parts = relPath.split("/").filter(Boolean);
      const fileName = parts.pop();
      let dir = wd;
      for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
      const fh = await dir.getFileHandle(fileName, { create: true });
      const writable = await fh.createWritable();
      await writable.write(bytes);
      await writable.close();
    }
    console.log(`[myst] Fichier sauvegardé : ${relPath}`);
  } catch (err) {
    console.warn(`[myst] writeFileFromMemfs: échec écriture "${relPath}"`, err);
  }
}

async function syncWrittenFiles(pyodide, beforeSnapshot, prestagedBytes = new Map()) {
  const wd = resolveWorkingDir();
  if (!wd) return;
  // Browsers without the File System Access API only give a read-only snapshot
  // of the folder, so files a cell created cannot be written back to disk.
  // Warn once here rather than per file.
  if (wd.isReadOnlySnapshot) {
    console.warn("[myst] Working folder is a read-only snapshot: files written by this cell stay in Pyodide's memory and are not saved to disk.");
    return;
  }
  const after = snapshotMemfsDir(pyodide);
  const toWrite = [];
  for (const [p, { size, mtime }] of after) {
    const prev = beforeSnapshot.get(p);
    if (!prev) {
      toWrite.push(p);
    } else if (prev.size !== size || prev.mtime !== mtime) {
      if (prestagedBytes.has(p)) {
        let currentBytes;
        try { currentBytes = pyodide.FS.readFile(p); } catch { continue; }
        const orig = prestagedBytes.get(p);
        const changed = currentBytes.length !== orig.length
          || currentBytes.some((b, i) => b !== orig[i]);
        if (changed) toWrite.push(p);
      } else {
        toWrite.push(p);
      }
    }
  }
  if (toWrite.length) await Promise.all(toWrite.map((p) => writeFileFromMemfs(pyodide, p)));
}

// ─── Exécution Python ─────────────────────────────────────────────────────────

// ─── Cell-executed hook (used by {eval} cache invalidation) ─────────────────
const _cellExecutedListeners = [];
/** Register a callback invoked after every successful code-cell run. */
export function onCellExecuted(fn) { _cellExecutedListeners.push(fn); }

async function executePython(code, packages, onStream = null) {
  const pyodide = await loadPyodideRuntime(packages);
  const capture = { stdout: "", stderr: "", onWrite: onStream };
  globalThis._pyodideCurrentCell = capture;

  pyodide.runPython(`import matplotlib.pyplot as plt\nplt.close('all')`);

  await loadConfig();
  const prestagedBytes = await prestageFiles(pyodide, code);

  if (config.pyodide?.resetCwdOnRun) {
    pyodide.runPython("import os; os.chdir('/local')");
  }

  const memfsSnapshot = snapshotMemfsDir(pyodide);
  const namesBefore = userGlobalNames(pyodide);

  const started = performance.now();
  let error = null;
  let returnValue = null;

  try {
    const value = await pyodide.runPythonAsync(code);
    if (value !== undefined && value !== null) returnValue = String(value);
  } catch (err) {
    error = String(err);
  } finally {
    globalThis._pyodideCurrentCell = null;
  }

  if (namesBefore) {
    const namesAfter = userGlobalNames(pyodide) ?? namesBefore;
    const removed = namesBefore.filter((n) => !namesAfter.includes(n));
    const added = namesAfter.filter((n) => !namesBefore.includes(n));
    if (removed.length || added.length) {
      logNamespaceEvent("cell-run", { added, removed, errored: Boolean(error) });
      if (removed.length) console.warn("[namespace] cell run removed:", removed.join(", "));
    }
  }

  let figures = [];
  try {
    const figJson = pyodide.runPython(`
import matplotlib.pyplot as plt, io, base64, json
_figs = []
for _n in plt.get_fignums():
    _f = plt.figure(_n)
    _b = io.BytesIO()
    _f.savefig(_b, format='png', bbox_inches='tight', dpi=120)
    _b.seek(0)
    _figs.append('data:image/png;base64,' + base64.b64encode(_b.read()).decode())
    plt.close(_f)
json.dumps(_figs)`);
    figures = JSON.parse(figJson);
  } catch {/* pas de matplotlib */}

  await syncWrittenFiles(pyodide, memfsSnapshot, prestagedBytes);

  return {
    stdout: capture.stdout,
    stderr: capture.stderr,
    error,
    returnValue,
    figures,
    durationMs: Math.round(performance.now() - started),
  };
}

// ─── Thème & coloration CM6 ───────────────────────────────────────────────────

/**
 * Thème de base pour les cellules code-cell :
 * reprend les CSS variables du projet pour compatibilité light/dark.
 */
const pyodideCmTheme = EditorView.theme({
  "&": {
    flex: "1",
    minWidth: "0",
    fontSize: "var(--pyodide-cell-font-size, 0.8rem)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    backgroundColor: "var(--pyodide-cell-bg, var(--color-background-primary, #f2f6fc))",
    color: "var(--color-foreground-primary, #1f2328)",
  },
  ".cm-content": {
    padding: ".75rem",
    lineHeight: "1.55",
    caretColor: "var(--color-foreground-primary, #1f2328)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  ".cm-line": { padding: "0" },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-cursor": {
    borderLeftColor: "var(--color-foreground-primary, #1f2328)",
  },
  ".cm-scroller": {
    overflow: "auto",
    lineHeight: "1.55",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  ".cm-gutters": {
    backgroundColor: "var(--color-background-secondary, #f6f8fa)",
    borderRight: "1px solid var(--color-border, #d0d7de)",
    color: "var(--color-foreground-muted, #8c959f)",
    minWidth: "2.5rem",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "var(--pyodide-cell-font-size, 0.8rem)",
  },
  ".cm-gutterElement": { padding: "0 .5rem 0 .75rem", minWidth: "2.5rem" },
  ".cm-activeLineGutter": { backgroundColor: "transparent" },
  ".cm-activeLine": { backgroundColor: "rgba(0,0,0,0.03)" },
  // Popup d'autocomplétion
  ".cm-tooltip": {
    border: "1px solid var(--color-border, #d0d7de)",
    borderRadius: "6px",
    backgroundColor: "var(--color-background-primary, #fff)",
    boxShadow: "0 4px 12px rgba(0,0,0,.15)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "0.8rem",
  },
  ".cm-tooltip-autocomplete > ul": {
    maxHeight: "280px",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "0.8rem",
  },
  ".cm-tooltip-autocomplete > ul > li": {
    padding: ".2rem .55rem",
  },
  ".cm-completionIcon": { display: "none" },
  ".cm-completionLabel": { fontFamily: "inherit" },
  ".cm-completionDetail": {
    color: "var(--color-foreground-muted, #57606a)",
    fontSize: "0.75rem",
    fontStyle: "normal",
    marginLeft: ".5rem",
  },
  "li[aria-selected]": {
    backgroundColor: "var(--color-background-secondary, #f6f8fa) !important",
    color: "inherit",
    outline: "1px solid var(--color-accent-emphasis, #0969da)",
  },
});

// pythonHighlight importé depuis ../extensions/pythonHighlightStyle.js

// ─── Source de complétion jedi pour CM6 ──────────────────────────────────────

/**
 * Source d'autocomplétion CM6 appelant _jedi_complete dans Pyodide.
 * Retourne les suffixes à insérer à la position courante.
 */
function jediCompletionSource(context) {
  const py = pyodideInstance;
  if (!py || !py.globals.has('_jedi_complete')) return null;

  const source = context.state.doc.toString();
  const pos    = context.pos;
  const before = source.substring(0, pos).split('\n');
  const line   = before.length;          // 1-based
  const col    = before[before.length - 1].length; // 0-based

  let completions;
  try {
    completions = JSON.parse(
      py.runPython(`_jedi_complete(${JSON.stringify(source)}, ${line}, ${col})`)
    );
  } catch { return null; }
  if (!completions.length) return null;

  // `from` = position courante : on insère le suffixe (c.complete) là où est le curseur.
  return {
    from: pos,
    options: completions.map(c => ({
      label:  c.name,
      apply:  c.complete || undefined,  // suffixe à insérer ; undefined = accept sans texte
      type:   c.type   || "text",
      detail: c.description || undefined,
    })),
    validFor: /^[\w.]*$/,
  };
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const STYLES_ID = "pyodide-cell-styles";

function ensureStyles() {
  if (document.getElementById(STYLES_ID)) return;
  const style = document.createElement("style");
  style.id = STYLES_ID;
  style.textContent = `
.pyodide-wrapper{--pyodide-cell-font-size:0.8rem;box-sizing:border-box;width:100%;border:1px solid var(--pyodide-cell-border,var(--color-border,#c4d4e6));border-radius:6px;overflow:hidden;margin:1.25rem 0;background:var(--pyodide-cell-bg,#f2f6fc);color:var(--color-foreground-primary,#1f2328);font:var(--pyodide-cell-font-size) ui-monospace,SFMono-Regular,Menlo,monospace}
.pyodide-header,.pyodide-status-bar{display:flex;align-items:center;justify-content:space-between;padding:.45rem .75rem;background:var(--pyodide-cell-bg,#f2f6fc);filter:brightness(0.97);border-bottom:1px solid var(--pyodide-cell-border,var(--color-border,#c4d4e6));gap:.5rem}
.pyodide-status-bar{border-top:1px solid var(--pyodide-cell-border,var(--color-border,#c4d4e6));border-bottom:0;min-height:1.6rem}
.pyodide-controls{display:flex;flex-wrap:wrap;gap:.4rem;justify-content:flex-end}
.pyodide-btn{display:inline-flex;align-items:center;gap:.3rem;padding:.35rem .65rem;border-radius:5px;border:1px solid var(--color-border,#d0d7de);font:inherit;font-size:.8rem;line-height:1;cursor:pointer;background:var(--color-background-primary,#fff);color:inherit}
.pyodide-btn:disabled{opacity:.5;cursor:not-allowed}
.pyodide-btn-run,.pyodide-btn-runall{background:#1a7f37;color:#fff;border-color:rgba(31,35,40,.15);font-weight:600}
.pyodide-btn-runall{background:#0969da}
.pyodide-btn-clearall{font-weight:600}
.pyodide-btn-restart{color:#cf222e;font-weight:600}
.pyodide-btn-insert{color:#6639ba;font-weight:600}
.pyodide-btn-delete{color:#cf222e;font-weight:600;margin-left:.25rem}
.pyodide-lang-badge{font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--color-foreground-muted,#57606a);letter-spacing:.04em}
.pyodide-editor-row{display:flex;position:relative;width:100%}
.pyodide-editor{flex:1;min-width:0;overflow:hidden;display:flex;flex-direction:column}
.pyodide-output{min-height:2.5rem;max-height:25rem;overflow:auto;padding:.7rem .75rem;border-top:1px solid var(--pyodide-cell-border,var(--color-border,#c4d4e6));background:var(--pyodide-output-bg,#e8f0f8);resize:vertical}
.pyodide-output[hidden]{display:none}
.pyodide-output pre{margin:0 0 .4rem!important;padding:0!important;background:transparent!important;border:0!important;color:inherit!important;white-space:pre-wrap;word-break:break-word;font:inherit}
.pyodide-error,.pyodide-stderr{color:#cf222e}
.pyodide-figure{display:block;max-width:100%;height:auto;margin:.5rem 0}
.pyodide-status-text{font-size:.78rem;color:var(--color-foreground-muted,#57606a)}
.pyodide-status-info{color:#0550ae}.pyodide-status-success{color:#1a7f37}.pyodide-status-error{color:#cf222e}
.pyodide-timing{font-size:.68rem;color:var(--color-foreground-muted,#8c959f);font-variant-numeric:tabular-nums}
.eval-result{font-style:inherit}.eval-pending{opacity:.5;font-style:italic;cursor:wait}.eval-error{color:#cf222e;text-decoration:underline dotted;cursor:help}
.pyodide-widget-output{min-height:0}.pyodide-text-output pre{margin:0 0 .4rem!important;padding:0!important;background:transparent!important;border:0!important;color:inherit!important;white-space:pre-wrap;word-break:break-word;font:inherit}.mw-vbox{display:flex;flex-direction:column;gap:.4rem}.mw-hbox{display:flex;flex-direction:row;flex-wrap:nowrap;gap:.5rem;align-items:center;overflow-x:auto}.mw-text,.mw-dropdown{display:inline-flex;align-items:center;gap:.35rem}.mw-label{font-size:.82rem;color:var(--color-foreground-secondary,#57606a);white-space:nowrap}.mw-input{padding:.3rem .5rem;border:1px solid var(--color-border,#d0d7de);border-radius:4px;font:inherit;font-size:.85rem}.mw-select{padding:.3rem .5rem;border:1px solid var(--color-border,#d0d7de);border-radius:4px;font:inherit;font-size:.85rem}.mw-checkbox{display:inline-flex;align-items:center;gap:.3rem;font-size:.85rem}.mw-btn{display:inline-flex;align-items:center;gap:.3rem;padding:.35rem .75rem;border-radius:5px;border:1px solid var(--color-border,#d0d7de);font:inherit;font-size:.85rem;cursor:pointer;background:var(--color-background-primary,#fff);color:inherit}.mw-btn:disabled{opacity:.5;cursor:not-allowed}.mw-btn-primary{background:#0969da;color:#fff;border-color:#0969da}.mw-btn-success{background:#1a7f37;color:#fff;border-color:#1a7f37}.mw-btn-info{background:#0550ae;color:#fff;border-color:#0550ae}.mw-btn-warning{background:#9a6700;color:#fff;border-color:#9a6700}.mw-btn-danger{background:#cf222e;color:#fff;border-color:#cf222e}.mw-btn-default{background:var(--color-background-primary,#fff)}.mw-html,.mw-htmlmath,.mw-markdown{font-size:.9rem}.mw-output{padding:.3rem 0}
`;
  document.head.appendChild(style);
}

// ─── Helpers UI ───────────────────────────────────────────────────────────────

function setStatus(statusText, message, type = "info") {
  statusText.textContent = message;
  statusText.className = `pyodide-status-text pyodide-status-${type}`;
}

function renderOutput(outputArea, result) {
  outputArea.innerHTML = "";
  outputArea.hidden = false;
  let hasContent = false;

  for (const [key, cls] of [
    ["stdout", "pyodide-stdout"],
    ["stderr", "pyodide-stderr"],
    ["error", "pyodide-error"],
    ["returnValue", "pyodide-return-value"],
  ]) {
    if (!result[key]) continue;
    hasContent = true;
    const pre = document.createElement("pre");
    pre.className = cls;
    pre.textContent = result[key];
    outputArea.appendChild(pre);
  }

  for (const figure of result.figures ?? []) {
    hasContent = true;
    const img = document.createElement("img");
    img.src = figure;
    img.alt = "matplotlib figure";
    img.className = "pyodide-figure";
    outputArea.appendChild(img);
  }

  if (!hasContent) outputArea.hidden = true;
}

// ─── Cache inter-renders ──────────────────────────────────────────────────────
export const cellCache = new Map();
/** Populated from sidecar before render; consumed by initCodeCell(). */
export const restoredOutputCache = new Map();

// ─── API principale ───────────────────────────────────────────────────────────

/**
 * Initialise ou restaure une cellule Pyodide dans `el` avec un éditeur CM6.
 * @param {HTMLElement} el  — le div placeholder déjà dans le DOM
 * @param {string} code     — code Python initial
 * @param {{ packages?: string[], linenos?: boolean, hash: string }} opts
 */
export function initCodeCell(el, code, { packages = [], linenos = false, hash } = {}) {
  const cacheKey = hash ? hash + (linenos ? "-ln" : "") : null;
  if (cacheKey && cellCache.has(cacheKey)) {
    el.replaceWith(cellCache.get(cacheKey));
    return;
  }

  ensureStyles();

  // ── Construction de l'UI ──────────────────────────────────────────────────

  const wrapper = document.createElement("div");
  wrapper.className = "pyodide-wrapper";
  wrapper.setAttribute("role", "region");
  wrapper.setAttribute("aria-label", "Interactive Python cell");

  // En-tête
  const header = document.createElement("div");
  header.className = "pyodide-header";
  const controls = document.createElement("div");
  controls.className = "pyodide-controls";

  const mkBtn = (cls, label) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `pyodide-btn ${cls}`;
    b.textContent = label;
    return b;
  };
  const runBtn     = mkBtn("pyodide-btn-run",     "▶ Run");
  const clearBtn   = mkBtn("pyodide-btn-clear",   "Clear");
  const runAllBtn  = mkBtn("pyodide-btn-runall",  "Run All");
  const clearAllBtn = mkBtn("pyodide-btn-clearall", "Clear All");
  const restartBtn = mkBtn("pyodide-btn-restart", "Restart");
  const insertBtn  = mkBtn("pyodide-btn-insert",  "+ Cell");
  insertBtn.title = "Insert an empty code-cell below (⌘⇧↵ / Ctrl+Shift+Enter)";
  const deleteBtn  = mkBtn("pyodide-btn-delete",  "✕");
  deleteBtn.title = "Delete this cell";

  controls.append(runBtn, clearBtn, runAllBtn, clearAllBtn, restartBtn, insertBtn, deleteBtn);
  header.append(controls);

  // Zone d'édition CM6
  const editorRow = document.createElement("div");
  editorRow.className = "pyodide-editor-row";

  // Le conteneur CM6 — garde la classe .pyodide-editor pour la compatibilité
  // avec markdownPyodide.js (querySelector(".pyodide-editor"))
  const editorContainer = document.createElement("div");
  editorContainer.className = "pyodide-editor";
  editorContainer.setAttribute("aria-label", "Python code editor");

  // Barre de statut
  const statusBar  = document.createElement("div");
  statusBar.className = "pyodide-status-bar";
  const statusText = document.createElement("span");
  statusText.className = "pyodide-status-text";
  const timing = document.createElement("span");
  timing.className = "pyodide-timing";
  statusBar.append(statusText, timing);

  // Zone de sortie (widget DOM area + text/stderr/figure area)
  const outputArea = document.createElement("div");
  outputArea.className = "pyodide-output";
  outputArea.setAttribute("aria-live", "polite");
  outputArea.hidden = true;

  const widgetOutputArea = document.createElement("div");
  widgetOutputArea.className = "pyodide-widget-output";
  const textOutputArea = document.createElement("div");
  textOutputArea.className = "pyodide-text-output";
  outputArea.appendChild(widgetOutputArea);
  outputArea.appendChild(textOutputArea);

  // The run handler hides outputArea for the whole duration of the cell and only
  // reveals it once executePython() has resolved.  Anything Python renders *while*
  // the cell is still running would therefore stay invisible until it ends -- and
  // when the cell is blocked on an `await` waiting for the user to click that very
  // widget (a sign-in button, a confirmation, any interactive prompt), it can never
  // be reached at all.  Reveal the area as soon as a widget is appended.
  new MutationObserver(() => {
    if (widgetOutputArea.children.length > 0) outputArea.hidden = false;
  }).observe(widgetOutputArea, { childList: true });

  // Restore output from sidecar if available (populated by sidecar.js)
  if (cacheKey && restoredOutputCache.has(cacheKey)) {
    textOutputArea.innerHTML = restoredOutputCache.get(cacheKey);
    outputArea.hidden = false;
    restoredOutputCache.delete(cacheKey);
  }

  wrapper.append(header, editorRow, statusBar, outputArea);
  editorRow.appendChild(editorContainer);
  el.innerHTML = "";
  el.appendChild(wrapper);
  el.dataset.initialized = "1";

  if (cacheKey) cellCache.set(cacheKey, el);

  // ── État de synchronisation ───────────────────────────────────────────────
  let _currentCode    = code;
  let _currentCacheKey = cacheKey;

  // Identity of a cell used to be its code alone, so two cells holding the same
  // text were indistinguishable and the first one always won. The source-map
  // line id, already stamped on the host for scroll sync, says *which* cell this
  // widget renders; it travels with every event so the source side can tell
  // duplicates apart. It is read at dispatch time because a re-render may
  // restamp the host after an edit elsewhere in the document.
  const _lineId = () => el.dataset.lineId ?? null;

  const _syncToEditor = (view) => {
    if (editorContainer._suppressSync) return;
    const newCode = view.state.doc.toString();
    if (newCode === _currentCode) return;

    const newHex = new IMurMurHash(newCode, 42).result().toString(16);
    const newId  = `code-cell-${newHex}`;
    const newKey = newId + (linenos ? "-ln" : "");
    if (_currentCacheKey) cellCache.delete(_currentCacheKey);
    cellCache.set(newKey, el);
    el.id = newId;
    _currentCacheKey = newKey;

    document.dispatchEvent(new CustomEvent("pyodide-code-edit", {
      detail: { originalCode: _currentCode, newCode, lineId: _lineId() }
    }));
    _currentCode = newCode;
  };

  // ── Extensions CM6 ───────────────────────────────────────────────────────

  const navigateToCell = (dir) => (view) => {
    const { state } = view;
    const { from } = state.selection.main;
    if (dir === 1) {
      const lastLine = state.doc.line(state.doc.lines);
      if (from < lastLine.from) return false;
    } else {
      const firstLine = state.doc.line(1);
      if (from > firstLine.to) return false;
    }
    const root = editorContainer.closest(".myst-preview, [class*=preview], body") ?? document.body;
    const all  = Array.from(root.querySelectorAll(".pyodide-editor"));
    const idx  = all.indexOf(editorContainer);
    const next = all[idx + dir];
    if (next?._cmView) {
      next._cmView.focus();
      if (dir === 1) {
        next._cmView.dispatch({ selection: { anchor: 0 } });
      } else {
        const len = next._cmView.state.doc.length;
        next._cmView.dispatch({ selection: { anchor: len } });
      }
      return true;
    }
    return false;
  };

  const cmExtensions = [
    python(),
    syntaxHighlighting(pythonHighlight),
    // Draw the caret and selection ourselves.  In inline-preview mode this editor
    // lives inside a CodeMirror widget, whose DOM is contenteditable="false";
    // the nested contenteditable="true" still takes focus and keystrokes, but the
    // browser paints no native caret there, so typing happened blind.
    drawSelection(),
    history(),
    indentOnInput(),
    autocompletion({
      override: [jediCompletionSource],
      activateOnTyping: true,
      maxRenderedOptions: 12,
    }),
    cmKeymap.of([
      ...completionKeymap,    // Tab accepte la complétion si popup visible
      indentWithTab,          // Tab indente sinon (4 espaces en Python)
      // Ces deux bindings doivent être AVANT defaultKeymap pour ne pas être
      // écrasés par insertNewlineKeepIndent (Shift-Enter dans defaultKeymap).
      { key: "Shift-Enter",     run: (view) => { _syncToEditor(view); runBtn.click(); return true; } },
      { key: "Mod-Shift-Enter", run: (view) => { _syncToEditor(view); insertBtn.click(); return true; } },
      ...defaultKeymap,
      ...historyKeymap,
      { key: "ArrowDown",   run: navigateToCell(+1) },
      { key: "ArrowUp",     run: navigateToCell(-1) },
    ]),
    EditorView.domEventHandlers({
      blur(_, view) { _syncToEditor(view); },
    }),
    EditorView.theme({ "&": {} }), // placeholder pour éviter le thème par défaut
    pyodideCmTheme,
  ];

  if (linenos) cmExtensions.push(lineNumbers());

  const cmState = EditorState.create({ doc: code, extensions: cmExtensions });
  const view    = new EditorView({ state: cmState, parent: editorContainer });

  // ── API de compatibilité (utilisée par markdownPyodide.js) ───────────────
  editorContainer._cmView       = view;
  editorContainer._suppressSync = false;
  editorContainer._updateCode   = (c) => { _currentCode = c; };

  // Getter/setter .value pour la compatibilité avec le code existant dans markdownPyodide.js
  Object.defineProperty(editorContainer, "value", {
    get()  { return view.state.doc.toString(); },
    set(c) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: c } });
    },
    configurable: true,
  });

  // ── Événements des boutons ────────────────────────────────────────────────

  clearBtn.addEventListener("click", () => {
    widgetOutputArea.innerHTML = "";
    textOutputArea.innerHTML = "";
    outputArea.hidden = true;
    timing.textContent = "";
    setStatus(statusText, "");
  });

  restartBtn.title = "Restart the kernel: clears all variables (⌥/Alt-click to reload the whole Pyodide runtime)";
  restartBtn.addEventListener("click", async (ev) => {
    const hard = ev.altKey;
    restartBtn.disabled = true;
    try {
      if (hard) {
        // Reloading takes seconds and needs the network, so do it now, with the
        // status visible, rather than surprising the next run with it.
        setStatus(statusText, "Reloading Pyodide runtime…", "info");
        await restartKernel();
        await loadPyodideRuntime();
        setStatus(statusText, "Runtime reloaded", "success");
      } else {
        const { softened, removed } = await softRestartKernel();
        setStatus(
          statusText,
          softened
            ? `Kernel restarted — ${removed.length} variable(s) cleared`
            : "Kernel not started yet",
          "success",
        );
      }
    } catch (e) {
      setStatus(statusText, `Restart failed: ${e}`, "error");
    } finally {
      restartBtn.disabled = false;
    }
  });

  runAllBtn.title = "Run every code-cell of this document, in order";
  runAllBtn.addEventListener("click", () => {
    const root = el.closest(".myst-preview, [class*=preview], body") ?? document.body;
    runAllCells(root);
  });

  clearAllBtn.title = "Clear the output of every code-cell (variables are kept)";
  clearAllBtn.addEventListener("click", () => {
    const root = el.closest(".myst-preview, [class*=preview], body") ?? document.body;
    clearAllCells(root);
  });

  // Dispatch "insert cell below" → handled in text.js
  const _dispatchInsertBelow = () => {
    _syncToEditor(view);
    document.dispatchEvent(new CustomEvent("pyodide-insert-cell-below", {
      detail: { currentCode: _currentCode, lineId: _lineId() }
    }));
  };
  insertBtn.addEventListener("click", _dispatchInsertBelow);

  deleteBtn.addEventListener("click", () => {
    _syncToEditor(view);
    // window.confirm() is blocked in Tauri/WKWebView — use an inline confirmation bar instead
    if (wrapper.querySelector(".pyodide-confirm-bar")) return; // already showing

    const bar = document.createElement("div");
    bar.className = "pyodide-confirm-bar";
    bar.style.cssText = [
      "display:flex", "align-items:center", "gap:.5rem", "padding:.4rem .75rem",
      "background:var(--pyodide-cell-bg,#f2f6fc)",
      "border-top:1px solid var(--pyodide-cell-border,#c4d4e6)",
      "font-size:.8rem"
    ].join(";");

    const msg = document.createElement("span");
    msg.textContent = "Delete this cell?";
    msg.style.flex = "1";

    const confirmOk  = document.createElement("button");
    confirmOk.type = "button";
    confirmOk.textContent = "Delete";
    confirmOk.style.cssText = "padding:.25rem .6rem;border-radius:4px;border:1px solid #cf222e;background:#cf222e;color:#fff;font:inherit;font-size:.78rem;cursor:pointer;font-weight:600";

    const confirmNo  = document.createElement("button");
    confirmNo.type = "button";
    confirmNo.textContent = "Cancel";
    confirmNo.style.cssText = "padding:.25rem .6rem;border-radius:4px;border:1px solid var(--pyodide-cell-border,#c4d4e6);background:transparent;font:inherit;font-size:.78rem;cursor:pointer";

    bar.append(msg, confirmOk, confirmNo);
    // Insert bar just before the output area (after the status bar)
    wrapper.insertBefore(bar, outputArea);

    confirmNo.addEventListener("click", () => bar.remove());
    confirmOk.addEventListener("click", () => {
      bar.remove();
      if (_currentCacheKey) cellCache.delete(_currentCacheKey);
      document.dispatchEvent(new CustomEvent("pyodide-delete-cell", {
        detail: { currentCode: _currentCode, lineId: _lineId() }
      }));
    });
  });

  runBtn.addEventListener("click", async () => {
    runBtn.disabled = true;
    outputArea.hidden = true;
    widgetOutputArea.innerHTML = "";
    textOutputArea.innerHTML = "";
    timing.textContent = "";

    try {
      if (loadState === "idle") {
        loadState = "loading";
        setStatus(statusText, "Pyodide loading (first execution)…", "info");
        try {
          await loadPyodideRuntime(packages);
          loadState = "ready";
        } catch (err) {
          loadState = "error";
          loadError = String(err);
        }
      }

      if (loadState === "loading") {
        setStatus(statusText, "Waiting for Pyodide…", "info");
        while (loadState === "loading") {
          await new Promise((r) => setTimeout(r, 150));
        }
      }

      if (loadState === "error") {
        setStatus(statusText, `Load failed: ${loadError}`, "error");
        return;
      }

      setStatus(statusText, "Running...", "info");
      globalThis.__mystral_cell_output = widgetOutputArea;

      // Stream stdout/stderr into the output area while the cell runs, so a long
      // cell shows progress instead of staying blank until it finishes.  Both
      // blocks are created up front, in the same order renderOutput() uses, so
      // the live view never reshuffles when the final render replaces it.
      const mkLive = (cls) => {
        const pre = document.createElement("pre");
        pre.className = cls;
        pre.hidden = true;
        textOutputArea.appendChild(pre);
        return pre;
      };
      const liveOut = mkLive("pyodide-stdout");
      const liveErr = mkLive("pyodide-stderr");

      let streaming = true;
      let pending = { stdout: "", stderr: "" };
      let flushQueued = false;
      const flush = () => {
        flushQueued = false;
        if (!streaming) return;
        // Measure before mutating: only follow the tail if the user has not
        // scrolled up to read something earlier.
        const atBottom =
          outputArea.scrollHeight - outputArea.scrollTop - outputArea.clientHeight < 40;
        let wrote = false;
        for (const [tag, pre] of [["stdout", liveOut], ["stderr", liveErr]]) {
          if (!pending[tag]) continue;
          pre.hidden = false;
          pre.appendChild(document.createTextNode(pending[tag]));
          pending[tag] = "";
          wrote = true;
        }
        if (wrote) {
          textOutputArea.hidden = false;
          outputArea.hidden = false;
          if (atBottom) outputArea.scrollTop = outputArea.scrollHeight;
        }
      };
      // Batch per animation frame: a chatty loop would otherwise append one text
      // node per write.  Note this can only paint when Python yields to the event
      // loop, so a tight synchronous loop still lands in one go at the end.
      const onStream = (tag, text) => {
        if (tag !== "stdout" && tag !== "stderr") return;
        pending[tag] += text;
        if (!flushQueued) { flushQueued = true; requestAnimationFrame(flush); }
      };

      let result;
      try {
        result = await executePython(view.state.doc.toString(), packages, onStream);
      } finally {
        // Stop streaming before renderOutput() wipes textOutputArea, otherwise a
        // queued frame would append to detached nodes.
        streaming = false;
        pending = { stdout: "", stderr: "" };
        // Also released here rather than after the await: on a throw it used to
        // stay pointing at this cell, so a later widget rendered into it.
        globalThis.__mystral_cell_output = null;
      }
      renderOutput(textOutputArea, result);
      // Show outer container if either sub-area has content
      outputArea.hidden = textOutputArea.hidden && widgetOutputArea.children.length === 0;
      timing.textContent = `run: ${result.durationMs} ms`;
      _cellExecutedListeners.forEach(fn => fn());
      if (result.error) {
        setStatus(statusText, "Error", "error");
      } else {
        statusText.textContent = "";
        statusText.className = "pyodide-status-text";
      }
    } catch (err) {
      setStatus(statusText, `Error : ${err}`, "error");
    } finally {
      runBtn.disabled = false;
    }
  });
}

/**
 * Exécute toutes les cellules Run visibles dans `root` dans l'ordre DOM.
 * @param {Element} root
 */
export async function runAllCells(root = document.body) {
  const buttons = Array.from(root.querySelectorAll(".pyodide-btn-run")).filter((b) => b.isConnected);
  for (const btn of buttons) {
    btn.click();
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (!btn.disabled) { clearInterval(check); resolve(); }
      }, 150);
    });
  }
}

/**
 * Clear the output of every code-cell below `root`, leaving the kernel state
 * untouched. The counterpart of runAllCells(): it drives the per-cell Clear
 * buttons rather than duplicating what they do, so the two stay in step.
 */
export function clearAllCells(root = document.body) {
  const buttons = Array.from(root.querySelectorAll(".pyodide-btn-clear")).filter((b) => b.isConnected);
  buttons.forEach((btn) => btn.click());
  return buttons.length;
}

/**
 * Evaluate a single Python expression and return its string representation.
 * Lightweight variant of executePython() used by the {eval} inline role:
 * no file pre-staging, no matplotlib figure collection, no file sync.
 * @param {string} expr
 * @returns {Promise<string>}
 */
export async function runExpression(expr) {
  const pyodide = await loadPyodideRuntime();
  const result = await pyodide.runPythonAsync(expr);
  if (result === undefined || result === null) return "";
  return String(result);
}


// ─── Persistence helpers ─────────────────────────────────────────────────────

/** True if Pyodide has been initialized and is ready to run code. */
export function isPyodideReady() { return pyodideInstance !== null; }

/**
 * Serialize all user-facing globals to cloudpickle base64.
 * Returns a plain JS object suitable for JSON serialization.
 */
export async function snapshotNamespace() {
  const pyodide = await loadPyodideRuntime();
  const result = await pyodide.runPythonAsync(`
import cloudpickle as _cp, base64 as _b64, io as _io, json as _json, types as _types
_skip = frozenset({"__name__", "__doc__", "__package__", "__loader__",
                   "__spec__", "__builtins__", "__annotations__"}
                  | set(${JSON.stringify(RUNTIME_GLOBALS)}))
_out = {}
for _n, _v in list(globals().items()):
    if _n.startswith('_') or _n in _skip:
        continue
    # A module is not user data. cloudpickle stores it as a reference whose
    # unpickling re-imports it, which fails in a fresh runtime whenever the
    # package is not loaded yet -- that is what made "np" and "pd" look lost.
    # Record the name instead and let the restore import it properly.
    if isinstance(_v, _types.ModuleType):
        _out[_n] = {"module": _v.__name__}
        continue
    try:
        _buf = _io.BytesIO()
        _cp.dump(_v, _buf)
        _out[_n] = {"data": _b64.b64encode(_buf.getvalue()).decode(), "type": type(_v).__name__}
    except Exception as _e:
        _out[_n] = {"skipped": True, "reason": str(_e)}
_json.dumps(_out)
`);
  const snapshot = JSON.parse(result);
  const skipped = Object.entries(snapshot).filter(([, e]) => e.skipped).map(([n]) => n);
  logNamespaceEvent("snapshot", { saved: Object.keys(snapshot).length, failed: skipped });
  if (skipped.length) {
    console.warn(`[namespace] not persisted (unpicklable): ${skipped.join(", ")}`);
  }
  return snapshot;
}

/**
 * Restore a namespace snapshot produced by snapshotNamespace().
 * @param {Object} snapshot  — plain JS object from sidecar JSON
 */
export async function restoreNamespace(snapshot) {
  if (!snapshot || Object.keys(snapshot).length === 0) return;
  const pyodide = await loadPyodideRuntime();

  // Modules were saved by name. Their packages have to be in the runtime before
  // the import can succeed, and in a fresh session only the default ones are:
  // ask Pyodide to fetch whatever else the snapshot mentions. Best effort -- a
  // package it does not know about is reported by the import below.
  const moduleNames = Object.values(snapshot)
    .map((e) => e?.module)
    .filter(Boolean);
  if (moduleNames.length) {
    const roots = [...new Set(moduleNames.map((m) => m.split(".")[0]))];
    try {
      await pyodide.loadPackagesFromImports(roots.map((r) => `import ${r}`).join("\n"));
    } catch (e) {
      console.warn("[namespace] could not preload packages for", roots, e);
    }
  }

  pyodide.globals.set('_restore_data_json', JSON.stringify(snapshot));
  // Failures used to be swallowed here, so a variable that could not be
  // unpickled simply ceased to exist, with nothing said anywhere. Collect them
  // instead and report them: silent data loss is the one outcome to rule out.
  const report = await pyodide.runPythonAsync(`
import cloudpickle as _cp, base64 as _b64, json as _json, importlib as _il
_data = _json.loads(_restore_data_json)
_ok, _failed = [], {}
for _n, _e in _data.items():
    if _e.get('skipped'):
        _failed[_n] = _e.get('reason', 'not persisted')
        continue
    try:
        if 'module' in _e:
            globals()[_n] = _il.import_module(_e['module'])
        else:
            globals()[_n] = _cp.loads(_b64.b64decode(_e['data']))
        _ok.append(_n)
    except Exception as _err:
        _failed[_n] = type(_err).__name__ + ': ' + str(_err)
_report = _json.dumps({'ok': _ok, 'failed': _failed})
for _k in ['_data', '_n', '_e', '_err', '_ok', '_failed', '_cp', '_b64', '_json', '_il', '_restore_data_json']:
    globals().pop(_k, None)
_report
`);
  const { ok, failed } = JSON.parse(report);
  // Sidecars written before runtime names were excluded still carry an entry
  // for "js" (an unpicklable JsProxy). It is plumbing the bootstrap rebinds on
  // its own, so it is not a variable the user lost.
  for (const name of RUNTIME_GLOBALS) delete failed[name];
  const failedNames = Object.keys(failed);
  logNamespaceEvent("restore", { added: ok, failed: failedNames });
  if (failedNames.length) {
    for (const [name, reason] of Object.entries(failed)) {
      console.warn(`[namespace] could not restore "${name}": ${reason}`);
    }
    showToast(
      `${failedNames.length} variable(s) could not be restored from the saved session: ${failedNames.join(", ")}. Re-run the cells that define them.`,
      "error",
      0,
    );
  }
  console.log(`[namespace] restored ${ok.length} variable(s)`);
  return { ok, failed };
}
