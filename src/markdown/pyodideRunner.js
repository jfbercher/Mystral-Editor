/**
 * pyodideRunner.js — moteur Pyodide singleton + UI des cellules code-cell.
 * CM6-powered code cells with Python syntax highlighting, Tab completion, auto-indent.
 *
 * API publique :
 *   initCodeCell(el, code, { packages, linenos, hash })
 *   runAllCells(parent)
 */

import IMurMurHash from "imurmurhash";
import { workingDirectory, currentFileDir, isTauri } from "../utils/local_utils/fs.js";
import { config, loadConfig } from "../config.js";

// CM6 imports — packages déjà présents dans le projet
import { EditorView, keymap as cmKeymap, lineNumbers } from "@codemirror/view";
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

async function loadPyodideRuntime(extraPackages = []) {
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
    def __init__(self, tag):
        self._tag = tag
    def write(self, s):
        js.globalThis._pyodideStreamWrite(self._tag, s)
        return len(s)
    def flush(self):
        pass

sys.stdout = _JsBridge("stdout")
sys.stderr = _JsBridge("stderr")
`);
      pyodide.runPython(`import matplotlib\nmatplotlib.use("agg")`);

      // Préparer /local dans MEMFS et y positionner le CWD initial
      try { pyodide.FS.mkdir("/local"); } catch { /* already exists */ }
      pyodide.runPython("import os; os.chdir('/local')");

      // Installation de jedi pour la complétion Tab (best-effort, non bloquant)
      try {
        await pyodide.runPythonAsync(`
import micropip as _micropip
await _micropip.install('jedi', keep_going=True)
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
        console.log('[myst] jedi chargé — complétion Tab active');
      } catch (_e) {
        console.warn('[myst] jedi non disponible, Tab insérera 4 espaces', _e);
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
  if (globalThis._pyodideCurrentCell) globalThis._pyodideCurrentCell[tag] += text;
};

async function restartKernel() {
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
  const re = /(?:open|read_csv|read_excel|read_table|read_fwf|read_json|read_parquet|loadtxt|genfromtxt|load|savetxt)\s*\(\s*['"]([^'"\n]+)['"]/g;
  for (const m of code.matchAll(re)) {
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
  if (!resolveWorkingDir()) return;
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

async function executePython(code, packages) {
  const pyodide = await loadPyodideRuntime(packages);
  const capture = { stdout: "", stderr: "" };
  globalThis._pyodideCurrentCell = capture;

  pyodide.runPython(`import matplotlib.pyplot as plt\nplt.close('all')`);

  await loadConfig();
  const prestagedBytes = await prestageFiles(pyodide, code);

  if (config.pyodide?.resetCwdOnRun) {
    pyodide.runPython("import os; os.chdir('/local')");
  }

  const memfsSnapshot = snapshotMemfsDir(pyodide);

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
    backgroundColor: "var(--color-background-primary, #fafbfc)",
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
.pyodide-wrapper{--pyodide-cell-font-size:0.8rem;box-sizing:border-box;width:100%;border:1px solid var(--color-border,#d0d7de);border-radius:6px;overflow:hidden;margin:1.25rem 0;background:var(--color-background-primary,#fff);color:var(--color-foreground-primary,#1f2328);font:var(--pyodide-cell-font-size) ui-monospace,SFMono-Regular,Menlo,monospace}
.pyodide-header,.pyodide-status-bar{display:flex;align-items:center;justify-content:space-between;padding:.45rem .75rem;background:var(--color-background-secondary,#f6f8fa);border-bottom:1px solid var(--color-border,#d0d7de);gap:.5rem}
.pyodide-status-bar{border-top:1px solid var(--color-border,#d0d7de);border-bottom:0;min-height:1.6rem}
.pyodide-controls{display:flex;flex-wrap:wrap;gap:.4rem;justify-content:flex-end}
.pyodide-btn{display:inline-flex;align-items:center;gap:.3rem;padding:.35rem .65rem;border-radius:5px;border:1px solid var(--color-border,#d0d7de);font:inherit;font-size:.8rem;line-height:1;cursor:pointer;background:var(--color-background-primary,#fff);color:inherit}
.pyodide-btn:disabled{opacity:.5;cursor:not-allowed}
.pyodide-btn-run,.pyodide-btn-runall{background:#1a7f37;color:#fff;border-color:rgba(31,35,40,.15);font-weight:600}
.pyodide-btn-runall{background:#0969da}
.pyodide-btn-restart{color:#cf222e;font-weight:600}
.pyodide-lang-badge{font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--color-foreground-muted,#57606a);letter-spacing:.04em}
.pyodide-editor-row{display:flex;position:relative;width:100%}
.pyodide-editor{flex:1;min-width:0;overflow:hidden;display:flex;flex-direction:column}
.pyodide-output{min-height:2.5rem;max-height:25rem;overflow:auto;padding:.7rem .75rem;border-top:1px solid var(--color-border,#d0d7de);background:var(--color-background-primary,#fff);resize:vertical}
.pyodide-output[hidden]{display:none}
.pyodide-output pre{margin:0 0 .4rem!important;padding:0!important;background:transparent!important;border:0!important;color:inherit!important;white-space:pre-wrap;word-break:break-word;font:inherit}
.pyodide-error,.pyodide-stderr{color:#cf222e}
.pyodide-figure{display:block;max-width:100%;height:auto;margin:.5rem 0}
.pyodide-status-text{font-size:.78rem;color:var(--color-foreground-muted,#57606a)}
.pyodide-status-info{color:#0550ae}.pyodide-status-success{color:#1a7f37}.pyodide-status-error{color:#cf222e}
.pyodide-timing{font-size:.68rem;color:var(--color-foreground-muted,#8c959f);font-variant-numeric:tabular-nums}
.eval-result{font-style:inherit}.eval-pending{opacity:.5;font-style:italic;cursor:wait}.eval-error{color:#cf222e;text-decoration:underline dotted;cursor:help}
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
  const restartBtn = mkBtn("pyodide-btn-restart", "Restart");

  controls.append(runBtn, clearBtn, runAllBtn, restartBtn);
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

  // Zone de sortie
  const outputArea = document.createElement("div");
  outputArea.className = "pyodide-output";
  outputArea.setAttribute("aria-live", "polite");
  outputArea.hidden = true;

  wrapper.append(header, editorRow, statusBar, outputArea);
  editorRow.appendChild(editorContainer);
  el.innerHTML = "";
  el.appendChild(wrapper);
  el.dataset.initialized = "1";

  if (cacheKey) cellCache.set(cacheKey, el);

  // ── État de synchronisation ───────────────────────────────────────────────
  let _currentCode    = code;
  let _currentCacheKey = cacheKey;

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
      detail: { originalCode: _currentCode, newCode }
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
      ...defaultKeymap,
      ...historyKeymap,
      { key: "Shift-Enter", run: (view) => { _syncToEditor(view); runBtn.click(); return true; } },
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
    outputArea.innerHTML = "";
    outputArea.hidden = true;
    timing.textContent = "";
    setStatus(statusText, "");
  });

  restartBtn.addEventListener("click", async () => {
    restartBtn.disabled = true;
    setStatus(statusText, "Restarting kernel…", "info");
    await restartKernel();
    setStatus(statusText, "Kernel restarted", "success");
    restartBtn.disabled = false;
  });

  runAllBtn.addEventListener("click", () => {
    const root = el.closest(".myst-preview, [class*=preview], body") ?? document.body;
    runAllCells(root);
  });

  runBtn.addEventListener("click", async () => {
    runBtn.disabled = true;
    outputArea.hidden = true;
    outputArea.innerHTML = "";
    timing.textContent = "";

    try {
      if (loadState === "idle") {
        loadState = "loading";
        setStatus(statusText, "Chargement de Pyodide (première exécution)…", "info");
        try {
          await loadPyodideRuntime(packages);
          loadState = "ready";
        } catch (err) {
          loadState = "error";
          loadError = String(err);
        }
      }

      if (loadState === "loading") {
        setStatus(statusText, "En attente de Pyodide…", "info");
        while (loadState === "loading") {
          await new Promise((r) => setTimeout(r, 150));
        }
      }

      if (loadState === "error") {
        setStatus(statusText, `Échec du chargement : ${loadError}`, "error");
        return;
      }

      setStatus(statusText, "Exécution…", "info");
      const result = await executePython(view.state.doc.toString(), packages);
      renderOutput(outputArea, result);
      timing.textContent = `run: ${result.durationMs} ms`;
      _cellExecutedListeners.forEach(fn => fn());
      if (result.error) {
        setStatus(statusText, "Erreur", "error");
      } else {
        statusText.textContent = "";
        statusText.className = "pyodide-status-text";
      }
    } catch (err) {
      setStatus(statusText, `Erreur : ${err}`, "error");
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
