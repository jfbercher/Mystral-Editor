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
import { SHARED_SPACE, isSharedSpace, registerRuntime, runtime, supports } from "./cellRuntime.js";
import { chooseEngineFor } from "./engineChoice.js";
import { NAMESPACE_HELPERS_PY, PERSISTENCE_HELPERS_PY } from "./namespacePython.js";
import { config, loadConfig, configReady } from "../config.js";
import { DEFAULT_PACKAGES, HELPER_PACKAGES, resolvePyodideBase, ensureLocalWheels, localLockNames } from "../utils/local_utils/pyodideInstall.js";
import { showToast } from "../utils/utils_ui.js";

// CM6 imports — packages déjà présents dans le projet
import { EditorView, keymap as cmKeymap, lineNumbers, drawSelection, tooltips } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { python } from "@codemirror/lang-python";
import { defaultKeymap, historyKeymap, history, indentWithTab } from "@codemirror/commands";
import { indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { pythonHighlightStyle as pythonHighlight } from "../extensions/pythonHighlightStyle";
import { autocompletion, completionKeymap, startCompletion, completionStatus } from "@codemirror/autocomplete";
import {
  parseParams,
  parseParamsOptions,
  readValue,
  readFlag,
  readChoice,
  writeValue,
  quantise,
  formatValue,
  formatFlag,
} from "./cellParams.js";

// ─── Constantes ──────────────────────────────────────────────────────────────

// The distribution, what to load from it, and where it lives: see
// pyodideInstall.js, which the Settings panel also drives.

// ─── Singleton Pyodide ────────────────────────────────────────────────────────

let pyodideInstance = null;
let loadingPromise = null;

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
    if (extraPackages.length) {
      await ensureLocalWheels(extraPackages);
      await pyodideInstance.loadPackage(extraPackages);
    }
    return pyodideInstance;
  }
  if (!loadingPromise) {
    loadingPromise = (async () => {
      // Resolved once, here: everything below -- the wasm, the stdlib, the
      // lock and every wheel -- is fetched by Pyodide itself relative to this
      // one URL, so a local install is simply a different base and no code of
      // ours sits in the path.
      const { url: base, local } = await resolvePyodideBase(config.pyodide?.offline ?? "auto");
      const startedAt = performance.now();
      console.log(`[myst] Pyodide from ${local ? "the local install" : "the CDN"}: ${base}`);
      if (typeof globalThis.loadPyodide !== "function") {
        await loadScript(`${base}pyodide.js`);
      }
      // `packageBaseUrl` as well, and not for symmetry. Reading loadPyodide's
      // own source: it computes `cdnUrl = packageBaseUrl ?? <jsdelivr>` and
      // only *afterwards* defaults `packageBaseUrl` to the lock file's folder.
      // Left unset, `packageBaseUrl` therefore becomes the local folder --
      // which is what loadPackage uses, and why the default packages worked --
      // while `cdnUrl` stays jsdelivr, so whatever reads that one, micropip
      // among them, quietly goes back to the network even with a complete
      // local install. Passing it explicitly makes both the same.
      const pyodide = await globalThis.loadPyodide({ indexURL: base, packageBaseUrl: base });
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
      // Namespace introspection, used by the variable inspector and by %whos,
      // and the persistence helpers the sidecar calls. Both live in
      // `namespacePython.js`: the same source runs in a kernel, and a second
      // copy is the one that would not get fixed.
      // Every name starts with "_" so that a soft restart spares it.
      pyodide.runPython(NAMESPACE_HELPERS_PY);
      pyodide.runPython(PERSISTENCE_HELPERS_PY);

      pyodide.runPython(`import matplotlib\nmatplotlib.use("agg")`);

      // Préparer /local dans MEMFS et y positionner le CWD initial
      try { pyodide.FS.mkdir("/local"); } catch { /* already exists */ }
      pyodide.runPython("import os; os.chdir('/local')");

      // Installation de jedi pour la complétion Tab et de pyodide_http pour le
      // réseau (best-effort, non bloquant).
      // One by one rather than in a single call: loadPackage rejects the whole
      // list as soon as one name fails, and the absence of pyodide-http must
      // not cost the completion loaded beside it -- which is what micropip's
      // `keep_going` did here before.
      for (const name of HELPER_PACKAGES) {
        try {
          await pyodide.loadPackage(name);
        } catch (err) {
          console.warn(`[myst] ${name} could not be loaded`, err);
        }
      }

      // The second bridge: fetch *and* load. Defined here rather than at
      // module scope because it needs this instance.
      globalThis._mystralEnsureAndLoad = async function (namesJson) {
        try {
          const names = JSON.parse(namesJson);
          const report = await ensureLocalWheels(names);
          // Only what the distribution knows: loadPackage throws on a name it
          // has never heard of, and those are micropip's business.
          const known = await localLockNames(names);
          if (known.length) await pyodide.loadPackage(known);
          return JSON.stringify({ ...report, loaded: known });
        } catch (err) {
          console.warn("[pyodide] could not complete a dependency:", err);
          return JSON.stringify({ added: [], unavailable: [], loaded: [] });
        }
      };

      // micropip, taught to look in the local install before giving up.
      //
      // Its two paths are indistinguishable to a reader: a name absent from
      // the lock goes to PyPI over the network, a name in the lock is taken
      // from the local folder and nowhere else. So `micropip.install("bokeh")`
      // returned without a word and the import after it failed, advising the
      // reader to run the call they had just run. Here the wheel is fetched
      // into the folder first, and if it cannot be, the reason is said plainly
      // instead of being left to the next line to discover.
      //
      // In its own block: a failure to patch must not cost the completion.
      try {
        await pyodide.runPythonAsync(`
import micropip as _micropip_mod, json as _json_mp, js as _js_mp

_mystral_micropip_install = _micropip_mod.install

_MYSTRAL_SPECIFIERS = ('==', '>=', '<=', '~=', '!=', '>', '<', ';', ' ')

def _mystral_req_names(requirements):
    """The bare project names of a micropip requirement list."""
    if isinstance(requirements, str):
        requirements = [requirements]
    names = []
    for raw in requirements or []:
        text = str(raw).strip()
        # A URL or a wheel path is nothing the lock can answer for.
        if '://' in text or text.endswith('.whl'):
            continue
        name = text.split('[')[0]
        for sep in _MYSTRAL_SPECIFIERS:
            name = name.split(sep)[0]
        name = name.strip()
        if name:
            names.append(name)
    return names

def _mystral_dep_name(requirement):
    """The project name of a Requires-Dist line, or None if it does not apply.

    Markers are evaluated rather than guessed at: a dependency carrying
    ; extra == "dev", ; python_version < "3.9" or ; sys_platform == "win32"
    is not ours, and dropping only the extras -- the obvious shortcut -- would
    install wheels this runtime has no use for. packaging is in the
    distribution and micropip vendors it; without it, the marked lines are
    left alone rather than wrongly kept.
    """
    text = str(requirement).strip()
    try:
        from packaging.requirements import Requirement as _Req
        parsed = _Req(text)
        if parsed.marker is not None and not parsed.marker.evaluate():
            return None
        return parsed.name
    except ImportError:
        if ';' in text:
            return None
        name = text.split('[')[0]
        for sep in _MYSTRAL_SPECIFIERS:
            name = name.split(sep)[0]
        return name.strip() or None
    except Exception:
        return None


def _mystral_dep_req(line):
    """A Requires-Dist line as (requirement, bare name), or (None, None).

    The requirement keeps its version constraint, because that is what gets
    installed; the bare name is what the lock is asked about. Extras are
    dropped -- we want what the package needs to run, not what its authors
    need to test it.
    """
    text = str(line).strip()
    try:
        from packaging.requirements import Requirement as _Req
        parsed = _Req(text)
        if parsed.marker is not None and not parsed.marker.evaluate():
            return None, None
        return parsed.name + str(parsed.specifier or ''), parsed.name
    except ImportError:
        if ';' in text:
            return None, None
        name = _mystral_dep_name(text)
        return (text.split('[')[0].strip(), name) if name else (None, None)
    except Exception:
        return None, None


async def _mystral_install_walk(requirements):
    """Install, never letting micropip ask for a wheel of the distribution.

    That is the whole point, and it is about *when*, not what. micropip takes
    a distribution package from packageBaseUrl -- the offline folder -- and a
    wheel that is not yet there answers 404. On macOS and Linux the webview
    keeps that 404 for the rest of the session, so writing the file a moment
    later changes nothing: the next request is served the cached refusal, and
    only a restart clears it. Windows escapes it, serving the same protocol
    over http, where a 404 without cache headers is not stored.

    So micropip is never allowed to ask. Each round installs the pending
    requirements with deps=False, reads what they declare from the metadata
    just written -- the real list, for the version actually installed, with no
    network and no second resolver -- hands the distribution ones to us, and
    keeps the PyPI ones for the next round. A chain PyPI to PyPI to
    distribution is covered at any depth, which neither a single pass nor a
    query to PyPI would have managed.
    """
    import importlib as _il_mp, importlib.metadata as _md_mp

    pending = [requirements] if isinstance(requirements, str) else list(requirements or [])
    seen = set()

    for _ in range(8):   # a chain that long is a different problem
        if not pending:
            return
        await _mystral_micropip_install(pending, deps=False)

        # Freshly written: whatever cached the contents of site-packages has
        # to be told before the metadata is read.
        try:
            _il_mp.invalidate_caches()
            _md_mp.MetadataPathFinder.invalidate_caches()
        except Exception:
            pass

        wanted = {}
        for requirement in pending:
            name = _mystral_dep_name(requirement)
            if not name:
                continue
            seen.add(name.lower().replace('_', '-'))
            try:
                declared = _md_mp.requires(name) or []
            except Exception as _err:
                _js_mp.console.warn('[mystral] no metadata for ' + str(name) + ' -- ' + str(_err))
                continue
            for line in declared:
                requirement_text, dep_name = _mystral_dep_req(line)
                if not dep_name:
                    continue
                key = dep_name.lower().replace('_', '-')
                if key not in seen and key not in wanted:
                    wanted[key] = (requirement_text, dep_name)

        if not wanted:
            # Debug: this is how every walk ends, and the three platforms
            # have been checked. The lines that remain at log or warn level
            # are the ones that say something happened, or failed to.
            _js_mp.console.debug('[mystral] nothing left to resolve')
            return

        names = [v[1] for v in wanted.values()]
        _js_mp.console.log('[mystral] resolving: ' + ', '.join(names))

        # The distribution ones are ours to place and load; the answer says
        # which they were, closure included.
        handled = []
        try:
            answer = _json_mp.loads(await _js_mp.globalThis._mystralEnsureAndLoad(_json_mp.dumps(names)))
            handled = [str(x).lower().replace('_', '-') for x in (answer.get('loaded') or [])]
            if answer.get('unavailable'):
                _js_mp.console.warn('[mystral] could not be fetched: ' + ', '.join(answer['unavailable']))
        except Exception as _err:
            _js_mp.console.warn('[mystral] the local install could not be completed -- ' + str(_err))

        seen.update(handled)
        pending = [req for key, (req, _n) in wanted.items() if key not in handled and req]


async def _mystral_micropip_patched(requirements, *args, **kwargs):
    # Asked for a distribution package by name, the wheel has to be there
    # before micropip looks for it -- same reason as the walk below.
    try:
        report = _json_mp.loads(
            await _js_mp.globalThis._mystralEnsureWheels(_json_mp.dumps(_mystral_req_names(requirements)))
        )
    except Exception:
        report = None
    if report and report.get('unavailable'):
        names = ', '.join(report['unavailable'])
        raise RuntimeError(
            names + " is part of the Pyodide distribution, so micropip takes it from this "
            "installation's offline folder rather than from PyPI -- and it is not there. "
            "Connect to the network and run this again to add it, or add it to "
            "pyodide.offlinePackages in config.json and press the button in Settings."
        )

    # deps are walked by hand, so the caller's own arguments are honoured on
    # the first round only through this path.
    if kwargs.get('deps') is False or args:
        return await _mystral_micropip_install(requirements, *args, **kwargs)
    return await _mystral_install_walk(requirements)


_micropip_mod.install = _mystral_micropip_patched
`);
      } catch (err) {
        console.warn("[myst] micropip could not be taught about the local install", err);
      }

      let httpPatched = false;
      try {
        httpPatched = await pyodide.runPythonAsync(`
import jedi as _jedi_mod, json as _json_mod

# The Completion objects of the last list are kept so that their docstring can
# be asked for afterwards, one at a time: docstring() is costly and computing it
# for all eighty entries up front would be paid on every keystroke, while only
# the highlighted one is ever read. Only one popup exists at a time, so the
# index sent back always addresses this list.
_jedi_last = []

def _jedi_complete(source, line, col):
    global _jedi_last
    try:
        cs = _jedi_mod.Script(source).complete(line, col)[:80]
    except Exception:
        _jedi_last = []
        return '[]'
    _jedi_last = cs
    return _json_mod.dumps([
        {'name': c.name, 'complete': c.complete,
         'type': c.type,  'description': c.description}
        for c in cs
    ])

def _jedi_doc(i):
    """Signature and docstring of the i-th entry of the last completion list."""
    try:
        return _jedi_last[i].docstring(raw=False) or ''
    except Exception:
        return ''

# There are no sockets here, so requests and urllib cannot work as they are.
# pyodide_http reroutes them through the browser's own fetch -- which is what
# makes them work at all, and also what subjects them to the page's
# cross-origin rules, exactly like a fetch written in JavaScript.
#
# In its own block: the package may have failed to load a moment ago, and its
# absence must not cost the completion that loaded beside it.
try:
    import pyodide_http as _pyodide_http
    _pyodide_http.patch_all()
    _mystral_http_patched = True
except Exception:
    _mystral_http_patched = False
_mystral_http_patched
`);
        console.log('[myst] jedi loaded — completion Tab is active');
        console.log(
          httpPatched
            ? '[myst] pyodide_http loaded and patched — requests and urllib work, subject to CORS'
            : '[myst] pyodide_http unavailable — requests and urllib will not work',
        );
      } catch (_e) {
        console.warn('[myst] jedi unavailable, Tab will insert 4 spaces', _e);
      }

      // Timed, so the claim that a local install is faster can be checked
      // rather than believed. The honest comparison is a cold one: after an
      // online session the webview serves the same files from its own cache,
      // and the two are then much alike.
      console.log(
        `[myst] Pyodide ready in ${Math.round(performance.now() - startedAt)} ms ` +
          `(${local ? "local install" : "CDN, or the webview cache standing in for it"})`,
      );

      pyodideInstance = pyodide;
      return pyodide;
    })();
  }
  const pyodide = await loadingPromise;
  if (extraPackages.length) {
    // Same bargain as for micropip: a `:packages:` naming something the local
    // install does not have is fetched into it rather than failing.
    await ensureLocalWheels(extraPackages);
    await pyodide.loadPackage(extraPackages);
  }
  return pyodide;
}

/**
 * The bridge the patched `micropip.install` calls before doing its work.
 *
 * Python hands a JSON array and gets a JSON object back: a list crossing the
 * boundary arrives as a proxy that has to be freed, and a string spares both
 * sides that bookkeeping for something called a few times a session.
 */
globalThis._mystralEnsureWheels = async function (namesJson) {
  try {
    return JSON.stringify(await ensureLocalWheels(JSON.parse(namesJson)));
  } catch (err) {
    console.warn("[pyodide] could not complete the local install:", err);
    return JSON.stringify({ skipped: true, added: [], unavailable: [] });
  }
};

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

// ─── Namespaces ──────────────────────────────────────────────────────────────
/**
 * One interpreter, several namespaces.
 *
 * Every code cell used to write into the one `globals()` dict of `__main__`,
 * whatever document it belonged to. That is convenient when several tabs are
 * pieces of the same work, and a trap otherwise: a document could overwrite
 * another's variables without either of them mentioning it, and the sidecar --
 * which is per document -- saved the whole shared pot, so reopening a document
 * complained about names it never wrote.
 *
 * A document now says in its frontmatter which namespace it runs in:
 *
 *   python: shared     (or absent)  the common pot, exactly as before
 *   python: isolated                a namespace private to this document
 *   python: tp3                     a namespace shared by the documents naming it
 *
 * What is separated is the variables. `sys.modules` stays common -- an
 * `import numpy` paid once benefits everyone, which is what one wants -- and so
 * do the library-level state (matplotlib's backend and rcParams), the current
 * directory and any monkeypatching. Separating those would take a second
 * interpreter, which costs a second WASM heap and its own copy of every
 * package; the frontmatter value is a plain string, so such a mode can be added
 * later without changing what documents are written with.
 */

/**
 * The namespace vocabulary now lives in `cellRuntime.js`: a document asking for
 * `python: isolated` is asking this editor a question about documents, and the
 * answer is the same whoever runs the code. Re-exported from here so that the
 * modules that have always imported it from the engine keep working.
 */
export { SHARED_SPACE, spaceKey, spaceLabel, isSharedSpace } from "./cellRuntime.js";

/**
 * Namespace dicts, by registry key. The shared one is never stored here: it is
 * `pyodideInstance.globals`, and pinning a second reference to it would only
 * invite the two to drift. These are PyProxies, deliberately kept alive by this
 * map -- letting one be collected would take the document's variables with it.
 */
const namespaces = new Map();

/** A Python identifier built from a registry key, for `__name__`. */
const spaceModuleName = (key) => "mystral_" + key.replace(/[^A-Za-z0-9]+/g, "_");

/**
 * The globals dict for a key, created on first use.
 * A fresh namespace is seeded with the plain names the bootstrap binds in
 * `__main__`, so that a cell finds the same environment wherever it runs.
 */
export function getNamespace(key = SHARED_SPACE, pyodide = pyodideInstance) {
  if (!pyodide) throw new Error("getNamespace: Pyodide is not loaded yet");
  if (isSharedSpace(key)) return pyodide.globals;
  const existing = namespaces.get(key);
  if (existing) return existing;

  pyodide.globals.set("_ns_module_name", spaceModuleName(key));
  const ns = pyodide.runPython(`
import sys as _ns_sys, io as _ns_io, js as _ns_js
# Everything the bootstrap installed under a leading underscore comes along:
# the introspection helpers behind %whos, the jedi completion, micropip. They
# are hidden from the variable list and spared by a restart wherever they live,
# so a cell finds the same toolbox in any namespace.
_ns_created = {_k: _v for _k, _v in globals().items()
               if _k.startswith("_") and not _k.startswith("__")}
_ns_created.update({
    "__name__": _ns_module_name,
    "__doc__": None,
    "__package__": None,
    "__builtins__": __builtins__,
    "sys": _ns_sys, "io": _ns_io, "js": _ns_js,
})
_ns_created
`);
  pyodide.runPython(
    "for _k in ['_ns_module_name', '_ns_created', '_ns_sys', '_ns_io', '_ns_js', '_v']:\n"
    + "    globals().pop(_k, None)\n"
    + "globals().pop('_k', None)\n"
  );
  namespaces.set(key, ns);
  logNamespaceEvent("space-created", { space: key });
  return ns;
}

/** Registry keys in use, the shared one first. */
export function listNamespaces() {
  return [SHARED_SPACE, ...namespaces.keys()];
}

/**
 * Forget every namespace but the shared one. Called when the interpreter is
 * thrown away: the proxies point into a heap that no longer exists.
 */
function clearNamespaces() {
  for (const ns of namespaces.values()) {
    try { ns.destroy(); } catch { /* the interpreter may already be gone */ }
  }
  namespaces.clear();
}

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
function userGlobalNames(pyodide, space = SHARED_SPACE) {
  try {
    pyodide.globals.set("_ns_names", getNamespace(space, pyodide));
    const json = pyodide.runPython(
      "__import__('json').dumps(sorted(k for k in _ns_names if not k.startswith('_')))"
    );
    pyodide.runPython("globals().pop('_ns_names', None)");
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

globalThis.__mystralNamespaceDebug = {
  get log() { return namespaceLog; },
  spaces: () => listNamespaces(),
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

export async function softRestartKernel(space = SHARED_SPACE) {
  if (!pyodideInstance) return { softened: false, removed: [] };
  const removed = (userGlobalNames(pyodideInstance, space) ?? []).filter((n) => !RUNTIME_GLOBALS.includes(n));
  // Only this namespace is emptied. A document that runs on its own no longer
  // wipes its neighbours' variables when its Restart button is pressed.
  pyodideInstance.globals.set("_ns_target", getNamespace(space));
  pyodideInstance.runPython(`
_spared = frozenset(${JSON.stringify(RUNTIME_GLOBALS)})
_doomed = [_k for _k in _ns_target if not _k.startswith('_') and _k not in _spared]
for _n in _doomed:
    _ns_target.pop(_n, None)
globals().pop('_doomed', None)
globals().pop('_n', None)
globals().pop('_spared', None)
globals().pop('_ns_target', None)
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
  logNamespaceEvent("kernel-soft-restart", { removed, space });
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
  clearNamespaces();
  pyodideInstance = null;
  loadingPromise = null;
}

// ─── Accès aux fichiers locaux (workingDirectory → Pyodide MEMFS) ──────────────

function resolveWorkingDir() {
  if (isTauri()) return currentFileDir.value || workingDirectory.value || null;
  return workingDirectory.value || null;
}

/**
 * A file of the working folder, as bytes.
 *
 * The two halves the rest of this module already lives with: the Tauri
 * filesystem when there is one, the File System Access handles when the
 * editor runs in a browser. Pulled out of copyFileToMemfs so that reading a
 * file and handing it to the interpreter stop being the same act -- `%load`
 * wants the first without the second.
 */
async function readWorkspaceBytes(relPath) {
  const wd = resolveWorkingDir();
  if (!wd) return null;
  if (isTauri()) {
    const { readFile } = await import("@tauri-apps/plugin-fs");
    return await readFile(`${String(wd).replace(/\/$/, "")}/${relPath}`);
  }
  const parts = relPath.replace(/\\/g, "/").split("/").filter(Boolean);
  const fileName = parts.pop();
  let dir = wd;
  for (const part of parts) dir = await dir.getDirectoryHandle(part);
  const fh = await dir.getFileHandle(fileName);
  return new Uint8Array(await (await fh.getFile()).arrayBuffer());
}

async function copyFileToMemfs(pyodide, relPath) {
  const wd = resolveWorkingDir();
  if (!wd) return false;

  let bytes;
  try {
    bytes = await readWorkspaceBytes(relPath);
    if (!bytes) return null;

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
  const reAssign = /=\s*['"]([^'"\n]+\.(?:yaml|yml|json|csv|tsv|txt|xlsx|xls|parquet|py))['"]/gi;
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

/**
 * Expand the two IPython-style magics this runtime understands.
 *
 * Pyodide runs plain Python: "%whos" is a syntax error there. Rewriting the
 * line into a call keeps the familiar spelling without pretending to be
 * IPython -- only these two are recognised, anything else is left to fail on
 * its own terms rather than being silently swallowed.
 *   %whos [-a]   tabular listing      %who [-a]   names only
 * With -a (or "all"), modules, functions and classes are listed too.
 */
export function expandMystralMagics(code) {
  return code.replace(
    /^([ \t]*)%(whos|who)([ \t]+[-\w]+)?[ \t]*$/gm,
    (_m, indent, name, arg) => {
      const all = /^[ \t]*(-a|--all|all)$/.test(arg ?? "") ? "True" : "False";
      // globals() is the cell's own namespace, whichever it is, so the
      // magic tells the truth in an isolated document as in a shared one.
      return `${indent}_mystral_${name}(${all}, globals())`;
    },
  );
}

/**
 * `%load demo.py` -- the file's text, put into the cell.
 *
 * A gesture rather than a link. A cell permanently backed by a file raises a
 * question nobody can answer for the author -- which of the two is
 * authoritative, and what a save means -- and gets it wrong once in a way
 * that loses work. Loading once has no such question: after it, the code is
 * in the document, which is also why mystmd can still build the page. A cell
 * backed by a file would have left `myst build` reading an empty body.
 *
 * As in IPython, the magic line is commented out as it is replaced. Without
 * that the next run reloads the file and silently discards whatever was
 * typed in between -- the cell would behave like a text box that empties
 * itself.
 */
const LOAD_MAGIC = /^([ \t]*)%load[ \t]+(.+?)[ \t]*$/m;

/** The path a cell asks to load, or null. */
export function loadMagicPath(code) {
  const m = LOAD_MAGIC.exec(String(code ?? ""));
  return m ? m[2].replace(/^['"]|['"]$/g, "").trim() || null : null;
}

/**
 * True when a path stays under the document's folder.
 *
 * Refused on both platforms rather than left to each one's filesystem,
 * because the two disagree in the worst possible way: in a browser a `..`
 * throws, while in the desktop build the system would likely resolve it --
 * so a document could load here and fail for a reader, which is harder to
 * diagnose than a refusal. An absolute path is worse still on the desktop
 * side: joined behind the working folder it yields nonsense rather than an
 * error that says anything.
 */
export function isUnderWorkingDir(relPath) {
  const path = String(relPath ?? "").replace(/\\/g, "/").trim();
  if (!path) return false;
  if (path.startsWith("/") || path.startsWith("~") || /^[A-Za-z]:/.test(path)) return false;
  return !path.split("/").includes("..");
}

/** The cell's code with the magic line replaced by the file it names. */
export function applyLoadMagic(code, text) {
  const body = String(text ?? "").replace(/\r\n/g, "\n").replace(/\n+$/, "");
  // A function replacement, not a string: a `$&` or `$1` occurring in
  // somebody's Python would otherwise be read as a backreference and quietly
  // rewrite their code.
  return String(code).replace(LOAD_MAGIC, (_m, indent, path) => {
    const rel = path.replace(/^['"]|['"]$/g, "").trim();
    const lines = body.split("\n").map((l) => (l ? indent + l : l));
    return `${indent}# %load ${rel}\n${lines.join("\n")}`;
  });
}

/**
 * The namespace as the inspector shows it: one row per user variable.
 * Returns null when no kernel has been started yet -- there is nothing to
 * inspect, which is not the same as an empty namespace.
 */
export async function inspectNamespace(includeAll = false, space = SHARED_SPACE) {
  if (!pyodideInstance) return null;
  try {
    pyodideInstance.globals.set("_ns_target", getNamespace(space));
    const json = pyodideInstance.runPython(`_mystral_varlist_json(${includeAll ? "True" : "False"}, _ns_target)`);
    pyodideInstance.runPython("globals().pop('_ns_target', None)");
    return JSON.parse(json);
  } catch (e) {
    console.warn("[vars] could not read the namespace", e);
    return [];
  }
}

/**
 * Remove variables from the namespace.
 * @param {string[]} names
 * @param {boolean} unloadModules  also drop modules from sys.modules
 * @returns {Promise<string[]>} the names actually removed
 */
export async function deleteVariables(names, { unloadModules = false, space = SHARED_SPACE } = {}) {
  if (!pyodideInstance || !names.length) return [];
  pyodideInstance.globals.set("_mystral_del_json", JSON.stringify(names));
  pyodideInstance.globals.set("_ns_target", getNamespace(space));
  const removed = JSON.parse(pyodideInstance.runPython(
    `_mystral_delete(_json_vi.loads(_mystral_del_json), ${unloadModules ? "True" : "False"}, _ns_target)`,
  ));
  pyodideInstance.runPython("globals().pop('_mystral_del_json', None); globals().pop('_ns_target', None)");
  logNamespaceEvent("delete", { removed, space });
  // {eval} expressions may have been reading what just went away.
  _cellExecutedListeners.forEach((fn) => fn());
  return removed;
}

/**
 * Turn config.pyodide.keys into CodeMirror bindings.
 *
 * An action with an empty string simply has no shortcut. A binding CodeMirror
 * cannot parse is reported once and dropped: a typo in a configuration file
 * should cost that one shortcut, not the cell's whole keymap.
 */
/**
 * Does this look like a CodeMirror key name?
 *
 * Modifiers, then the key. The key is a word -- a letter, a digit, `F5`,
 * `ArrowUp`, `Enter` -- or a single character of punctuation: `-`, `[`, `/`
 * are names CodeMirror knows, and the first version of this test, which asked
 * for alphanumerics only, rejected every one of them. It rejected the notebook
 * gesture for splitting a cell, `Mod-Shift--`, which was this function's own
 * default. A validator stricter than what it validates is a trap that catches
 * its author first.
 *
 * Several keys separated by spaces are a chord, which CodeMirror also takes;
 * each part is checked on its own.
 */
const KEY_PART = /^(?:(?:Mod|Cmd|Meta|Ctrl|Control|Alt|Shift)-)*(?:[A-Za-z0-9]+|[^A-Za-z0-9\s])$/;
const isKeyName = (key) => key.split(/\s+/).filter(Boolean).every((part) => KEY_PART.test(part));

function cellKeyBindings(actions) {
  const configured = config.pyodide?.keys ?? {};
  const bindings = [];
  for (const [action, handler] of Object.entries(actions)) {
    const key = (configured[action] ?? "").trim();
    if (!key) continue;
    if (!isKeyName(key)) {
      console.warn(`[cells] ignoring the shortcut configured for "${action}": "${key}" is not a CodeMirror key name`);
      continue;
    }
    bindings.push({ key, preventDefault: true, run: (view) => { handler(view); return true; } });
  }
  return bindings;
}

async function executePython(code, packages, onStream = null, space = SHARED_SPACE) {
  const pyodide = await loadPyodideRuntime(packages);
  const namespace = getNamespace(space, pyodide);
  const capture = { stdout: "", stderr: "", onWrite: onStream };
  globalThis._pyodideCurrentCell = capture;

  pyodide.runPython(`import matplotlib.pyplot as plt\nplt.close('all')`);

  await loadConfig();
  const prestagedBytes = await prestageFiles(pyodide, code);

  if (config.pyodide?.resetCwdOnRun) {
    pyodide.runPython("import os; os.chdir('/local')");
  }

  const memfsSnapshot = snapshotMemfsDir(pyodide);
  const namesBefore = userGlobalNames(pyodide, space);

  const started = performance.now();
  let error = null;
  let returnValue = null;

  try {
    const value = await pyodide.runPythonAsync(expandMystralMagics(code), { globals: namespace });
    if (value !== undefined && value !== null) returnValue = String(value);
  } catch (err) {
    error = String(err);
  } finally {
    globalThis._pyodideCurrentCell = null;
  }

  if (namesBefore) {
    const namesAfter = userGlobalNames(pyodide, space) ?? namesBefore;
    const removed = namesBefore.filter((n) => !namesAfter.includes(n));
    const added = namesAfter.filter((n) => !namesBefore.includes(n));
    if (removed.length || added.length) {
      logNamespaceEvent("cell-run", { added, removed, errored: Boolean(error), space });
      if (removed.length) console.warn("[namespace] cell run removed:", removed.join(", "));
    }
  }

  const figures = captureFigures(pyodide);

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

/**
 * Where a cell's tooltips (the completion popup) should be rendered.
 *
 * Anything inside the cell is clipped by it; document.body would be outside the
 * shadow root the preview lives in, and the adopted style sheets do not reach
 * there. The editor's own wrapper is the first ancestor that is neither.
 *
 * The tooltips do not go straight into that wrapper, though: it lays its
 * children out in columns, and an element added to it became one more of them --
 * an empty third panel beside the editor and the preview. They go into a host of
 * its own, taken out of the flow with position:absolute, which a flex or grid
 * container ignores when it shares out the space. One host per wrapper, reused.
 */
function tooltipParent(el) {
  const root = el.getRootNode();
  const base =
    el.closest(".myst-editor-wrapper") ??
    (root instanceof ShadowRoot ? root.firstElementChild : null) ??
    document.body;

  let host = base.querySelector(":scope > .myst-cell-tooltip-host");
  if (!host) {
    host = document.createElement("div");
    host.className = "myst-cell-tooltip-host";
    // Zero-sized and out of flow; the tooltips it holds are position:fixed, so
    // they are placed against the viewport and owe nothing to this box.
    host.style.cssText = "position:absolute;top:0;left:0;width:0;height:0";
    base.appendChild(host);
  }
  return host;
}

// ─── Complétion : jedi derrière le verbe du contrat ──────────────────────────

/**
 * Tab demande la complétion quand il y a un mot à compléter.
 *
 * Jusqu'ici elle ne venait que d'elle-même, à la frappe, et c'était suffisant
 * tant que jedi répondait en quelques millisecondes depuis le même processus.
 * Un noyau met une soixantaine de millisecondes, et près de sept cents la
 * première fois -- le temps que son propre jedi s'éveille. La popup ouverte
 * par une frappe est alors fermée par la suivante avant que la réponse
 * n'arrive, ce qui donne exactement ce qu'on observe : des complétions qui
 * passent sans se laisser attraper.
 *
 * Un déclencheur explicite change cela : la demande est rattachée à un geste,
 * et le délai se lit comme une attente plutôt que comme un défaut. Tab est le
 * geste du notebook, et sur macOS il est le seul disponible -- Ctrl-Espace
 * appartient au changement de source de saisie du système, ce qui explique
 * qu'il n'ait rien fait ici.
 *
 * Posé après `completionKeymap`, pour qu'une popup ouverte soit acceptée
 * d'abord, et avant `indentWithTab`, qui garde Tab quand il n'y a rien à
 * compléter : en début de ligne, Tab indente comme avant.
 */
const askForCompletion = {
  key: "Tab",
  run: (view) => {
    const range = view.state.selection.main;
    if (!range.empty || completionStatus(view.state)) return false;
    const before = view.state.doc.sliceString(Math.max(0, range.from - 1), range.from);
    if (!/[\w.]/.test(before)) return false;
    return startCompletion(view);
  },
};

/**
 * Ce que jedi propose ici, dans la forme que le contrat demande.
 *
 * jedi lit le texte, sans rien savoir de l'espace de noms : la complétion
 * marche donc avant la première exécution, ce qu'un noyau ne sait pas faire.
 * Les deux approches ont chacune leur vertu, et c'est pour cela que le verbe
 * ne dit pas comment on s'y prend.
 */
function pyodideComplete(source, pos) {
  const py = pyodideInstance;
  if (!py || !py.globals.has("_jedi_complete")) return null;

  const before = source.substring(0, pos).split("\n");
  const line = before.length; // 1-based
  const col = before[before.length - 1].length; // 0-based

  let completions;
  try {
    completions = JSON.parse(py.runPython(`_jedi_complete(${JSON.stringify(source)}, ${line}, ${col})`));
  } catch {
    return null;
  }
  if (!completions.length) return null;

  // `from` = `to` = la position courante : jedi rend le suffixe à insérer là
  // où est le curseur, et non le mot entier à remplacer.
  return {
    from: pos,
    to: pos,
    items: completions.map((c, i) => ({
      name: c.name,
      insert: c.complete || "",
      type: c.type || "text",
      detail: c.description || undefined,
      // Demandée seulement quand l'entrée est survolée, et répondue depuis la
      // liste que jedi vient de construire -- d'où l'indice plutôt que le nom,
      // qui ne distinguerait pas deux surcharges. docstring(raw=False) commence
      // par la signature, qui est ce qu'on cherche le plus souvent.
      doc: () => {
        try {
          return py.globals.has("_jedi_doc") ? py.runPython(`_jedi_doc(${i})`) : null;
        } catch {
          return null;
        }
      },
    })),
  };
}

/**
 * La source d'autocomplétion de CodeMirror, qui ne sait plus quel moteur
 * répond : elle demande au registre, et met en forme ce qui revient.
 */
async function runtimeCompletionSource(context, space = SHARED_SPACE) {
  const engine = runtime(space);
  if (!engine?.complete) return null;

  let answer = null;
  try {
    answer = await engine.complete(context.state.doc.toString(), context.pos, space);
  } catch (e) {
    console.warn("[cells] la complétion a échoué :", e);
    return null;
  }
  if (!answer?.items?.length) return null;

  return {
    from: answer.from,
    to: answer.to ?? answer.from,
    options: answer.items.map((item) => ({
      label: item.name,
      apply: item.insert || undefined, // undefined = accepter sans insérer de texte
      type: item.type || "text",
      detail: item.detail || undefined,
      info: async () => {
        let doc = null;
        try {
          doc = await item.doc?.();
        } catch {
          return null;
        }
        if (!doc) return null;
        const dom = document.createElement("div");
        dom.className = "pyodide-completion-doc";
        // Styled here rather than in the sheet: the popup is rendered in the
        // tooltip host, outside the preview, and whether the adopted sheet
        // reaches that root depends on how the editor was mounted. Inline, the
        // bound always holds -- and without a bound a numpy docstring grew to
        // the full height of the window and covered the line being typed.
        dom.style.cssText = [
          "max-width:44em",
          "max-height:14em",
          "overflow:auto",
          "white-space:pre-wrap",
          "line-height:1.35",
          "font-family:ui-monospace,SFMono-Regular,Menlo,monospace",
          "font-size:0.78rem",
        ].join(";");
        // Not truncated: the panel scrolls, and the text is set as textContent,
        // so even a long scipy docstring costs nothing to hold.
        dom.textContent = doc;
        return dom;
      },
    })),
    validFor: /^[\w.]*$/,
  };
}

// ─── Styles ───────────────────────────────────────────────────────────────────



// ─── Helpers UI ───────────────────────────────────────────────────────────────

function setStatus(statusText, message, type = "info") {
  statusText.textContent = message;
  statusText.className = `pyodide-status-text pyodide-status-${type}`;
}

/**
 * Full-screen viewer for a figure: wheel to zoom, drag to pan, Escape to leave.
 *
 * Styled inline and appended to the body on purpose. The preview lives in a
 * shadow root whose sheets do not reach the document, and an overlay placed
 * inside the cell would be clipped by it; carrying its own styles, this one
 * depends on no sheet at all and nothing can cut it off.
 */
function openFigureViewer(src, alt = "") {
  if (typeof document === "undefined") return;
  document.getElementById("myst-figure-viewer")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "myst-figure-viewer";
  overlay.style.cssText = [
    "position:fixed", "inset:0", "z-index:100000",
    "background:rgba(0,0,0,.82)", "display:flex",
    "align-items:center", "justify-content:center",
    "overflow:hidden", "cursor:grab", "touch-action:none",
  ].join(";");

  const img = document.createElement("img");
  img.src = src;
  img.alt = alt;
  img.draggable = false;
  img.style.cssText = [
    "max-width:92vw", "max-height:92vh", "user-select:none",
    "transform-origin:0 0", "will-change:transform",
    // A figure saved as SVG has no intrinsic background: on the dark overlay it
    // would be black lines on black.
    "background:#fff", "box-shadow:0 8px 40px rgba(0,0,0,.5)",
  ].join(";");
  overlay.appendChild(img);

  const hint = document.createElement("div");
  hint.textContent = "Wheel to zoom \u2014 drag to move \u2014 double-click to reset \u2014 Esc to close";
  hint.style.cssText = [
    "position:absolute", "bottom:14px", "left:0", "right:0", "text-align:center",
    "color:rgba(255,255,255,.75)", "font:13px system-ui,sans-serif", "pointer-events:none",
  ].join(";");
  overlay.appendChild(hint);

  let scale = 1, x = 0, y = 0;
  const apply = () => { img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`; };

  const close = () => {
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
  };
  // The viewer is the topmost thing on screen, so the key is *its* key -- and
  // it has to take it in the capture phase to have it at all.
  //
  // Both this and the presentation listen on `document`, and the deck
  // registered first, when the presentation started, long before any figure
  // was opened. On the way up it therefore ran first, and an Escape meant to
  // close a figure closed the presentation with it: saying "this key is mine"
  // after the fact stops nothing that has already run. Capture runs on the
  // way down, before every bubbling listener whatever the order of
  // registration, which is what makes topmost mean topmost.
  const onKey = (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    close();
  };
  document.addEventListener("keydown", onKey, true);

  // Clicking the backdrop leaves; clicking the figure itself must not.
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  overlay.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const rect = img.getBoundingClientRect();
      // Zoom about the pointer: the point under it has to stay under it.
      const px = (e.clientX - rect.left) / scale;
      const py = (e.clientY - rect.top) / scale;
      const next = Math.min(20, Math.max(0.2, scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      x += px * (scale - next);
      y += py * (scale - next);
      scale = next;
      apply();
    },
    { passive: false },
  );

  let dragging = null;
  overlay.addEventListener("pointerdown", (e) => {
    dragging = { x: e.clientX - x, y: e.clientY - y };
    overlay.setPointerCapture(e.pointerId);
    overlay.style.cursor = "grabbing";
  });
  overlay.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    x = e.clientX - dragging.x;
    y = e.clientY - dragging.y;
    apply();
  });
  const endDrag = () => { dragging = null; overlay.style.cursor = "grab"; };
  overlay.addEventListener("pointerup", endDrag);
  overlay.addEventListener("pointercancel", endDrag);

  overlay.addEventListener("dblclick", () => { scale = 1; x = 0; y = 0; apply(); });

  document.body.appendChild(overlay);
}

/** The opening Python writes before the frames of a traceback. */
const TRACEBACK = /^Traceback \(most recent call last\):\s*\n/;

/**
 * A traceback reduced to the line that says something.
 *
 * Recognised by its text rather than by the pane it arrives in. Pyodide prints
 * the frames to stderr and leaves `PythonError` alone as the error value, so a
 * rule written against the error pane shortened a line that was already one
 * while the traceback went past it untouched. What identifies a traceback is
 * how it starts; which stream carries it is Pyodide's business.
 *
 * Anything else is returned as it stands: a cell that prints to stderr on
 * purpose is not reporting a failure.
 */
function shortenTraceback(text) {
  const s = String(text);
  if (!TRACEBACK.test(s)) return s;
  const lines = s.split("\n").map((l) => l.trimEnd()).filter(Boolean);
  return lines.length ? lines[lines.length - 1].trim() : s;
}

function renderOutput(outputArea, result) {
  const bare = outputArea.closest(".code-cell-host")?.dataset.chrome === "bare";
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
    // In a bare cell the error value is `PythonError` and nothing more -- the
    // frames and the message are in stderr. Saying "PythonError" under a
    // message that already names the failure is noise, so it is dropped.
    if (bare && key === "error" && TRACEBACK.test(String(result.stderr ?? ""))) continue;
    hasContent = true;
    const pre = document.createElement("pre");
    pre.className = cls;
    // A bare cell shows a button, not code, so the frames of a traceback name
    // lines its reader cannot see. The last line is the one that says
    // something: `KeyError: "Quiz 'quiz5' not found in bank."`, `NameError:
    // name 'quz' is not defined`. The full text stays one unfold away.
    pre.textContent = bare ? shortenTraceback(result[key]) : result[key];
    outputArea.appendChild(pre);
  }

  // How wide a matplotlib figure should be drawn: the cell's own :figwidth:, or
  // the document-wide default from config.json. Any CSS length does ("60%",
  // "20em"); empty means the figure keeps its natural size, bounded by the
  // output area. Read from the host at each render rather than captured, since
  // a re-render restamps it.
  const figWidth =
    outputArea.closest(".code-cell-host")?.dataset.figwidth?.trim() ||
    (config.pyodide?.figureWidth ?? "").trim();

  for (const figure of result.figures ?? []) {
    hasContent = true;
    const img = document.createElement("img");
    img.src = figure;
    img.alt = "matplotlib figure";
    img.className = "pyodide-figure";
    img.title = "Click to enlarge";
    if (figWidth) img.style.width = figWidth;
    outputArea.appendChild(img);
  }

  if (!hasContent) outputArea.hidden = true;
}

// ─── Cache inter-renders ──────────────────────────────────────────────────────
export const cellCache = new Map();

/**
 * Cells belong to the editor that rendered them.
 *
 * Every tab has its own editor but they all share this module, so a cache keyed
 * by the code alone made two documents holding the same cell text the same
 * cell: switching tabs handed one document's live widget to the other, which
 * took it out of the first -- cells vanishing from a preview, edits landing in
 * the wrong document, and, since the widget carried its own `data-python-space`,
 * a `del y` that ran in a namespace where y had never been defined.
 *
 * The owner is the editor id, and the sidecar strips it back off so that what
 * it stores stays keyed by the code, as before.
 */
export const OWNER_SEP = "\u0000";
/**
 * Forget every cell an editor instance built.
 *
 * The cache lets a widget survive a re-render, which is its whole purpose; it
 * was never meant to survive the editor itself. But `suspendTab()` removes the
 * instance and `mountEditor()` builds a new one under the same `editorId`, so
 * the keys still matched and hosts made for the previous shadow root were
 * handed back into the new one. A CodeMirror view resolves its root at
 * construction and reads focus and selection through it ever after: moved
 * across roots, it still draws and no longer takes a keystroke -- a cell that
 * looks normal and cannot be typed in, until the editor is reloaded.
 *
 * Nothing of value is lost by forgetting: a document's outputs are kept by the
 * sidecar, which restores them by document rather than by tab.
 */
export function clearCellCache(owner) {
  if (!owner) return 0;
  const prefix = owner + OWNER_SEP;
  let gone = 0;
  for (const key of [...cellCache.keys()]) {
    if (key.startsWith(prefix)) {
      cellCache.delete(key);
      gone++;
    }
  }
  if (gone) console.debug(`[cells] ${gone} cached cell(s) dropped with editor ${owner}`);
  return gone;
}

/**
 * What identifies a cell in the cache: who owns it, and its code.
 *
 * `:linenos:` used to be part of this key, on the idea that a cell with line
 * numbers was a different cell. It made the option unapplicable instead:
 * adding it changed the key, so the reused host no longer matched, and the
 * observer's second pass handed it over by position anyway -- with the editor
 * it already had, built once and for all without the gutter. The numbers only
 * appeared on a reload, which is when the cell is built afresh, and removing
 * the option left them there for the same reason. Line numbers are a view
 * setting, reconfigured on the editor that exists; see `_setLinenos`.
 */
export const cellKey = (owner, hash) => `${owner ?? ""}${OWNER_SEP}${hash}`;
/** Populated from sidecar before render; consumed by initCodeCell(). */
export const restoredOutputCache = new Map();

// ─── API principale ───────────────────────────────────────────────────────────

/**
 * Initialise ou restaure une cellule Pyodide dans `el` avec un éditeur CM6.
 * @param {HTMLElement} el  — le div placeholder déjà dans le DOM
 * @param {string} code     — code Python initial
 * @param {{ packages?: string[], linenos?: boolean, hash: string }} opts
 */
// "+ Cell" inserts text in the source; the cell itself only exists after the
// preview has been re-rendered, in another module, so the button cannot focus
// what it creates. It records the moment of the request instead, and the next
// empty cell built shortly after takes the cursor. An empty cell appearing
// within that window and not coming from the button would be a coincidence;
// the window is short enough, and the cost of being wrong is a caret in the
// wrong empty cell.
let pendingEmptyCellFocus = 0;
const FOCUS_REQUEST_TTL_MS = 3000;

/**
 * Put text in the clipboard, whichever way the platform allows.
 *
 * The modern call needs a secure context: it is there under Tauri and on
 * localhost, and missing the moment the dev server is reached by its address on
 * the network -- which is exactly how one tests on a tablet. The old command is
 * kept for that case. The textarea goes into the top document rather than the
 * editor's shadow root, where `execCommand` finds nothing to select.
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* no clipboard API, no permission, or an insecure context */
  }
  try {
    const holder = document.createElement("textarea");
    holder.value = text;
    holder.setAttribute("readonly", "");
    holder.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
    document.body.appendChild(holder);
    holder.select();
    const done = document.execCommand("copy");
    holder.remove();
    return done;
  } catch (err) {
    console.warn("[pyodide] could not copy the output:", err?.message ?? err);
    return false;
  }
}

export function initCodeCell(el, code, { packages = [], linenos = false, hash, owner = "" } = {}) {
  const cacheKey = hash ? cellKey(owner, hash) : null;
  // Only a widget still attached to this editor may stand in for this
  // placeholder. A disconnected one belongs to a tab that is not showing, and
  // moving it here would remove it from there.
  const known = cacheKey ? cellCache.get(cacheKey) : null;
  if (known?.isConnected) {
    el.replaceWith(known);
    return;
  }


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
  /**
   * Fold the code away, leaving the cell's output and its toolbar.
   *
   * On a slide this is often the point: the output is the thing being shown
   * and twelve lines of Python above it are what makes the slide overflow.
   * While writing, it is simply a way to get a long cell out of the way
   * without deleting anything.
   *
   * The state is written back into the document, as a `:fold:` option on the
   * cell; see src/markdown/cellFold.js. It was a view control at first, which
   * meant a document tidied cell by cell opened untidy at the next sitting --
   * thirty cells to fold again. The price is that a glance at a long cell is
   * a modification of the file: one undo step, and the modified marker.
   */
  const foldBtn    = mkBtn("pyodide-btn-fold",    "⌄");
  /**
   * Move the cell one place up or down in the document.
   *
   * Only in Inline mode: the step they take is one *block* of that mode's own
   * projection -- the next rendered object, whatever it is -- and that notion
   * exists nowhere else. In the dual preview there is no editor under the
   * rendering to move anything in. Where they show is settled by a rule in
   * pyodide-cells.css, keyed on the widget they sit in, and not by this file:
   * a host element travels between the two renderings, and a state recomputed
   * at each move is a state one can forget to recompute.
   *
   * The cell says which block it is by the line range the widget carries, and
   * `inlinePreview` does the move: it is the only part that knows where one
   * block ends and the next begins, which is what keeps a cell from landing
   * inside an admonition.
   */
  const upBtn      = mkBtn("pyodide-btn-move pyodide-btn-up",   "↑");
  const downBtn    = mkBtn("pyodide-btn-move pyodide-btn-down", "↓");
  upBtn.title = "Move this cell up";
  downBtn.title = "Move this cell down";
  const moveBy = (dir) => {
    const widget = el.closest(".cm-inline-rendered-md");
    const startLine = Number((widget?.dataset.mystBlock ?? "").split("-")[0]);
    if (!startLine) return;
    document.dispatchEvent(new CustomEvent("myst-block-move", { detail: { owner, startLine, dir } }));
  };
  /**
   * Alt on the same arrow merges instead of moving: the cell takes in the one
   * above or below it.
   *
   * The same grammar the toolbar already speaks -- Alt on Run runs the whole
   * document, Alt on Clear clears all of it -- and the direction is already
   * carried by the arrow. Two operations, no eleventh button.
   *
   * Nothing happens when the neighbour is not a code cell, or when anything
   * but blank lines stands between the two: a paragraph caught in a merge
   * would have to go somewhere, and there is no answer to where.
   */
  const mergeWith = (dir) => {
    _syncToEditor(editorContainer._cmView);
    document.dispatchEvent(new CustomEvent("pyodide-cell-merge", { detail: { owner, code: _currentCode, lineId: _lineId(), dir } }));
  };
  // The edits made in this cell are written to the document first, in both
  // cases: the block about to be moved or merged is read from the source, and
  // an unsynchronised cell would hand over the code it had before.
  const arrow = (dir) => (ev) => {
    if (ev.altKey) return mergeWith(dir);
    _syncToEditor(editorContainer._cmView);
    moveBy(dir);
  };
  upBtn.addEventListener("click", arrow("up"));
  downBtn.addEventListener("click", arrow("down"));
  /**
   * The code of this cell, a little smaller or a little larger.
   *
   * A view control, like the chevron beside it, and for the same reasons: it
   * is adjusted while reading and it writes nothing into the document. The
   * step is taken from the size the cell is *currently rendered at* rather
   * than from a stored number, so one press does the expected thing whether
   * the cell sits in an ordinary preview or on a slide, where the deck's own
   * code size applies.
   */
  const smallerBtn = mkBtn("pyodide-btn-font pyodide-btn-smaller", "−");
  const largerBtn  = mkBtn("pyodide-btn-font pyodide-btn-larger",  "+");
  const runBtn     = mkBtn("pyodide-btn-run",     "▶");
  const clearBtn   = mkBtn("pyodide-btn-clear",   "⌫");
  // Built, wired and never shown. Run All and Clear All are reached by
  // alt-clicking Run and Clear -- the grammar this toolbar already uses for
  // Restart, which reloads the whole runtime on an alt-click, and for the
  // size buttons, which reset on one. Two fewer buttons in a bar that was
  // wrapping onto a second line in a narrow pane, and the actions keep their
  // own handlers rather than being duplicated into their neighbours'.
  const runAllBtn  = mkBtn("pyodide-btn-runall",  "Run All");
  const clearAllBtn = mkBtn("pyodide-btn-clearall", "Clear All");
  const varsBtn     = mkBtn("pyodide-btn-vars",     "x=");
  varsBtn.title = "Variables currently defined (\u2325V) \u2014 or run %whos in a cell";
  // Read at each use rather than captured: a re-render restamps the host, and
  // the frontmatter may have changed `python:` in between.
  const _space = () => el.dataset.pythonSpace || SHARED_SPACE;
  // Et de même pour `:packages:`. Capturés à la construction, ils restaient
  // ceux du premier rendu : écrire l'option dans une cellule qui existe déjà
  // ne change ni son code, ni son hash, ni donc la cellule elle-même, et
  // l'option n'avait d'effet qu'au rechargement suivant. Le paramètre reste
  // la valeur de repli, pour une cellule construite sans attribut.
  const _packages = () => {
    try {
      const declared = JSON.parse(el.dataset.packages ?? "null");
      return Array.isArray(declared) ? declared : packages;
    } catch {
      return packages;
    }
  };
  const _spaceLabel = () => el.dataset.pythonSpaceLabel || SHARED_SPACE;

  // Declared here, before the keymap that calls it. Imported on demand: the
  // window needs this module and this module needs the window, and a static
  // import each way would be a cycle.
  const openVarInspector = async () => {
    const { showVarInspector } = await import("./varInspectorUi.js");
    await showVarInspector(_space(), _spaceLabel());
  };
  varsBtn.addEventListener("click", openVarInspector);
  const restartBtn = mkBtn("pyodide-btn-restart", "↻");
  const insertBtn  = mkBtn("pyodide-btn-insert",  "⊕");
  insertBtn.title = "Insert an empty code-cell below (⌘⇧↵ / Ctrl+Shift+Enter)";
  // Only useful in the inline preview, where a code cell is never turned into
  // its source by the caret (it is a full editor already, so replacing it would
  // remove execution and completion). CSS shows it there and hides it elsewhere,
  // where the source panel is one click away anyway.
  const sourceBtn = mkBtn("pyodide-btn-source", "✎");
  sourceBtn.title = "Edit this cell's markdown source in the document (Esc to come back)";
  const deleteBtn  = mkBtn("pyodide-btn-delete",  "✕");
  deleteBtn.title = "Delete this cell";

  // Not a control: a document's namespace is a property of the document, set
  // in its frontmatter, so this says where one is without offering a second way
  // of changing it. It lives in the status bar, with the rest of what is true
  // of this cell rather than actionable on it.
  const spaceTag = document.createElement("span");
  spaceTag.className = "pyodide-space-tag";
  const refreshSpaceTag = () => {
    const label = el.dataset.pythonSpaceLabel || SHARED_SPACE;
    spaceTag.textContent = label;
    spaceTag.dataset.shared = String(label === SHARED_SPACE);
    spaceTag.title =
      label === SHARED_SPACE
        ? "Python namespace: shared with every document that does not ask for another.\n" +
          "Set `python: isolated` or `python: <name>` in the frontmatter to separate them."
        : `Python namespace: ${label} — the variables of this document are its own.\n` +
          "Imported modules, matplotlib state and the current directory stay common.";
  };
  refreshSpaceTag();
  // A re-render restamps the host in place -- the widget is reused -- so the
  // label has to follow the attribute rather than being read once.
  new MutationObserver(refreshSpaceTag).observe(el, {
    attributes: true,
    attributeFilter: ["data-python-space-label"],
  });

  const setFolded = (folded) => {
    wrapper.classList.toggle("pyodide-folded", folded);
    foldBtn.textContent = folded ? "›" : "⌄";
    foldBtn.title = folded ? "Show this cell's code" : "Hide this cell's code";
    foldBtn.setAttribute("aria-expanded", String(!folded));
    // Kept on the host rather than in a variable: the host is what survives a
    // re-render, so the cell reopens folded if that is how it was left.
    if (folded) el.dataset.folded = "1";
    else delete el.dataset.folded;
  };

  /**
   * Fold, and remember it in the document.
   *
   * The state is written as a `:fold:` option in the source, so that it
   * survives a reopening, another machine, and a copy sent to someone else --
   * which the host element alone does not, since it lives only as long as the
   * session. The event travels on `document` and carries the owning editor and
   * the cell's line, exactly as the code edits do: `text.js` locates the block
   * and rewrites its options. Only the reader's own gesture goes through here;
   * applying what the document already says must not write it back.
   */
  const foldByHand = (folded) => {
    setFolded(folded);
    // While presenting, the chevron is a view control and nothing more.
    // Writing `:fold:` into the document would change the text, re-render the
    // slide and replay the deck's transition -- a fade in the middle of a
    // sentence -- and would modify the file during a lecture, which is the
    // last moment to do it. The state is kept on the host, as it was before
    // any of this was written to the source, so the cell stays as the speaker
    // left it until the deck is closed.
    if (el.closest(".presenting")) return;
    document.dispatchEvent(
      new CustomEvent("pyodide-cell-fold", {
        detail: { code: _currentCode, lineId: _lineId(), owner, folded },
      }),
    );
  };
  foldBtn.addEventListener("click", () => foldByHand(!wrapper.classList.contains("pyodide-folded")));

  const MIN_CELL_FONT = 8;
  const MAX_CELL_FONT = 48;

  const setCellFont = (px) => {
    if (px === null) {
      delete el.dataset.cellFont;
      wrapper.style.removeProperty("--pyodide-cell-font-size");
      return;
    }
    const size = Math.round(Math.min(MAX_CELL_FONT, Math.max(MIN_CELL_FONT, px)));
    el.dataset.cellFont = String(size);
    wrapper.style.setProperty("--pyodide-cell-font-size", `${size}px`);
  };

  const stepCellFont = (by) => (ev) => {
    // Alt-click gives the cell back to whatever the document and the view
    // say it should be -- a way out that costs no third button.
    if (ev.altKey) return setCellFont(null);
    const current = Number(el.dataset.cellFont) || parseFloat(getComputedStyle(wrapper).fontSize) || 13;
    setCellFont(current + by);
  };

  smallerBtn.title = "Smaller code in this cell (⌥/Alt-click to reset)";
  largerBtn.title = "Larger code in this cell (⌥/Alt-click to reset)";
  smallerBtn.addEventListener("click", stepCellFont(-1));
  largerBtn.addEventListener("click", stepCellFont(1));

  controls.append(foldBtn, upBtn, downBtn, smallerBtn, largerBtn, runBtn, clearBtn, varsBtn, restartBtn, insertBtn, sourceBtn, deleteBtn);

  /**
   * The cell's caption, in the toolbar.
   *
   * `:caption:` is read by mystmd, which turns the cell and its outputs into a
   * numbered figure in the exported document; the editor showed nothing, so
   * what one wrote was invisible until the site was built. It is shown here
   * rather than under the output, where a figure's caption goes: a cell is not
   * an illustration one reads beneath, it is a tool with a name, and the
   * toolbar is where the cell says what it is. Right of the buttons, in the
   * status bar's smaller type, wrapping to its own line when the buttons leave
   * it no room.
   *
   * The number comes from the document's scan through `data-number`; it is
   * absent when numbering is off, and the caption then stands alone.
   */
  const captionEl = document.createElement("span");
  captionEl.className = "pyodide-caption";
  el._syncCaption = () => {
    // The anchor `{ref}` and `{numref}` land on. On the wrapper rather than on
    // the host, whose id is the hash of the cell's code and is what the cache
    // recognises it by; and set from here rather than written into the rendered
    // HTML, where a tag of its own would have taken the block's source line.
    const anchor = (el.dataset.label ?? "").trim();
    if (anchor) wrapper.id = anchor;
    else wrapper.removeAttribute("id");
    const text = (el.dataset.caption ?? "").trim();
    const number = (el.dataset.number ?? "").trim();
    const label = (el.dataset.numberLabel ?? "").trim();
    captionEl.textContent = !text ? "" : number ? `${label} ${number} — ${text}` : text;
    captionEl.hidden = !text;
  };
  el._syncCaption();
  // After the buttons: the caption is what gives way when the header runs out
  // of room, and it wraps onto its own line rather than squeezing them.
  header.append(controls, captionEl);

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
  // The status bar used to carry a message and a duration and nothing else,
  // which left it empty most of the time. It now also says when the cell last
  // ran -- the question one asks of a document reopened a week later, whose
  // outputs are restored from its sidecar and look exactly as fresh as the ones
  // just computed -- and which namespace the cell belongs to, which belongs
  // here rather than in the toolbar: it is a piece of status, not a control.
  const ranAt = document.createElement("span");
  ranAt.className = "pyodide-ran-at";
  statusBar.append(statusText, ranAt, timing, spaceTag);
  /**
   * Two controls for the output, at the left of the status bar.
   *
   * Here rather than in the toolbar, which has thirteen buttons already and
   * sits at the other end of the cell: this strip is the one that speaks of
   * the run and of what it produced, and it is next to the output it governs.
   *
   * The first hides the output and brings it back. It sets a class of its own
   * rather than touching `hidden`, which already means something else -- the
   * cell has produced nothing -- and is written from a dozen places. The two
   * questions stay separate, and a stylesheet rule hides these controls
   * altogether when there is nothing to show.
   *
   * The second lifts the height limit, which caps a long output at
   * `--pyodide-output-max-height` and makes it scroll. It appears only when
   * the output is actually taller than its box, measured rather than guessed:
   * a button that would do nothing is worse than a button that is not there.
   */
  const outControls = document.createElement("span");
  outControls.className = "pyodide-out-controls";
  const mkOutBtn = (cls, label, title) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `pyodide-out-btn ${cls}`;
    b.textContent = label;
    b.title = title;
    outControls.append(b);
    return b;
  };
  const showOutBtn = mkOutBtn("pyodide-out-show", "⌄", "Hide this cell's output");
  const fullOutBtn = mkOutBtn("pyodide-out-full", "⤢", "Show the whole output");
  statusBar.prepend(outControls);

  /**
   * Record when the cell last ran.
   * Shown as a clock time while it is today's, and with the date once it is
   * not: "14:32:07" answers "did that just run?", "26/09 14:32" answers "is
   * what I am reading from last week?" -- the question a document reopened
   * with its outputs restored from its sidecar cannot otherwise answer, since
   * a restored output looks exactly as fresh as one just computed.
   * It is kept on the host element so the sidecar can save and restore it.
   */
  const setRanAt = (when) => {
    if (!when) {
      ranAt.textContent = "";
      ranAt.title = "";
      delete el.dataset.ranAt;
      return;
    }
    const today = when.toDateString() === new Date().toDateString();
    ranAt.textContent = today
      ? when.toLocaleTimeString()
      : when.toLocaleString([], { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    ranAt.title = `Last run: ${when.toLocaleString()}`;
    el.dataset.ranAt = when.toISOString();
  };

  // Zone de sortie (widget DOM area + text/stderr/figure area)
  const outputArea = document.createElement("div");
  outputArea.className = "pyodide-output";
  outputArea.setAttribute("aria-live", "polite");
  outputArea.hidden = true;
  // Delegated, and registered once for the life of the cell: the images are
  // replaced at every run, and those restored from a sidecar are injected as
  // raw HTML, which no per-image listener would ever reach.
  outputArea.addEventListener("click", (ev) => {
    const img = ev.target instanceof Element ? ev.target.closest(".pyodide-figure") : null;
    if (img) openFigureViewer(img.getAttribute("src"), img.getAttribute("alt") ?? "");
  });

  const widgetOutputArea = document.createElement("div");
  widgetOutputArea.className = "pyodide-widget-output";
  const textOutputArea = document.createElement("div");
  textOutputArea.className = "pyodide-text-output";

  /**
   * Copy the output, since selecting it with the mouse cannot be made to work.
   *
   * Measured rather than assumed, on a bench holding nothing but CodeMirror and
   * one replace widget: a drag inside such a widget never extends the browser's
   * selection -- not with `user-select: text`, not with `-webkit-user-drag:
   * none`, not with the widget in line rather than in block, not with
   * CodeMirror's own `ignoreEvent` hook for `selectionchange`, which *is*
   * consulted and *does* answer "leave it alone". The same structure written in
   * plain HTML selects without being asked, so it is what the editor builds
   * around a widget that stops the gesture, and not the island's
   * non-editability.
   *
   * It used to look as though it worked: before a cell's host joined the list
   * of interactive elements, CodeMirror took the mousedown and drew *its* own
   * selection over the source around the block -- which is why a copy served
   * `:::{code-cell} python` rather than the output. The selection was never the
   * reader's.
   *
   * So the output gets its own affordance, the one every notebook offers: a
   * button in the corner, faint until the pointer is over the output. It also
   * earns its place in the panes where selecting *does* work, because dragging
   * across forty lines of output to copy them is its own small misery.
   */
  const COPY_GLYPH = "\u29c9";
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "pyodide-btn pyodide-copy-out";
  copyBtn.textContent = COPY_GLYPH;
  copyBtn.title = "Copy this output";
  copyBtn.setAttribute("aria-label", "Copy this output");
  copyBtn.hidden = true;

  /**
   * The text of the output as it reads on screen.
   *
   * `innerText` and not `textContent`: it is what the reader sees, so a folded
   * `<details>` does not smuggle its contents into the clipboard. It is also
   * layout-dependent and answers nothing for a hidden element, hence the
   * fallback -- a cell whose output is there but not laid out yet.
   */
  const outputText = () =>
    [widgetOutputArea, textOutputArea]
      .map((area) => (area.innerText || area.textContent || "").replace(/\s+$/, ""))
      .filter((t) => t.trim())
      .join("\n");

  // Asked at the moment the pointer arrives rather than tracked: the output is
  // rewritten at every run and restored from sidecars as raw HTML, and no
  // observer would be as reliable as the question asked just in time.
  outputArea.addEventListener("mouseenter", () => {
    copyBtn.hidden = !outputText();
  });

  copyBtn.addEventListener("click", async (ev) => {
    // The cell host is an interactive element in the inline preview, so this
    // click never reaches the editor; stopped all the same, because the output
    // area carries a click handler of its own for the figure viewer.
    ev.stopPropagation();
    const text = outputText();
    if (!text) return;
    const done = await copyToClipboard(text);
    copyBtn.textContent = done ? "\u2713" : "\u2717";
    copyBtn.classList.toggle("pyodide-copy-done", done);
    setTimeout(() => {
      copyBtn.textContent = COPY_GLYPH;
      copyBtn.classList.remove("pyodide-copy-done");
    }, 1200);
  });

  // First, so that the float sits in the output's top corner and the text wraps
  // beside it instead of being covered by it.
  outputArea.appendChild(copyBtn);
  outputArea.appendChild(widgetOutputArea);
  outputArea.appendChild(textOutputArea);

  // The two controls declared with the status bar, wired now that the output
  // they act on exists.
  const COLLAPSED = "pyodide-output-collapsed";
  const FULL = "pyodide-output-full";
  /** Does the output exceed its box? What decides whether the second button exists at all. */
  const syncOutButtons = () => {
    const collapsed = outputArea.classList.contains(COLLAPSED);
    showOutBtn.textContent = collapsed ? "›" : "⌄";
    showOutBtn.title = collapsed ? "Show this cell's output" : "Hide this cell's output";
    const full = outputArea.classList.contains(FULL);
    // Capped and scrolling, or already lifted -- in which case the button has
    // to stay, since it is the way back.
    fullOutBtn.hidden = collapsed || !(full || outputArea.scrollHeight > outputArea.clientHeight + 1);
    fullOutBtn.textContent = full ? "⤡" : "⤢";
    fullOutBtn.title = full ? "Limit the output's height again" : "Show the whole output";
  };
  showOutBtn.addEventListener("click", () => {
    outputArea.classList.toggle(COLLAPSED);
    syncOutButtons();
  });
  fullOutBtn.addEventListener("click", () => {
    outputArea.classList.toggle(FULL);
    syncOutButtons();
  });
  // The output's own box stays capped as its content grows, so watching it
  // would report nothing: what grows is what it holds.
  if (typeof ResizeObserver === "function") {
    const watch = new ResizeObserver(() => syncOutButtons());
    watch.observe(textOutputArea);
    watch.observe(widgetOutputArea);
  }
  syncOutButtons();

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
    const restored = restoredOutputCache.get(cacheKey);
    textOutputArea.innerHTML = restored.html;
    // Sidecars written before the capture was fixed hold a copy of the button;
    // restoring one would plant a second, which the next save would capture in
    // its turn. Removed here rather than only at the source, so a file already
    // written repairs itself the first time it is opened.
    textOutputArea.querySelectorAll(".pyodide-copy-out").forEach((b) => b.remove());
    outputArea.hidden = false;
    if (restored.ranAt) setRanAt(new Date(restored.ranAt));
    restoredOutputCache.delete(cacheKey);
  }

  // ── Paramètres de la cellule ──────────────────────────────────────────────
  // Built from `:params:`, rebuilt whenever that attribute changes. A control
  // per declared name, and one Apply: moving a slider changes nothing until it
  // is pressed, because applying rewrites the cell's source and runs it, which
  // is a document edit and not something a drag should produce thirty times.
  const paramsBar = document.createElement("div");
  paramsBar.className = "pyodide-params-bar";
  paramsBar.hidden = true;

  // In the inline preview the cell is a CodeMirror widget, and the editor
  // around it is contenteditable. A mousedown on a non-editable element inside
  // a contenteditable starts a *native drag of that element*, which pre-empts
  // the slider's own drag: the thumb never moves. Stopping the gesture here is
  // what makes the control work in both panes, and it has to be on the bar
  // rather than on each slider because the browser decides at mousedown.
  for (const type of ["mousedown", "pointerdown", "touchstart"]) {
    paramsBar.addEventListener(type, (ev) => ev.stopPropagation());
  }
  paramsBar.addEventListener("dragstart", (ev) => ev.preventDefault());

  const syncParams = () => {
    const specs = parseParams(el.dataset.params ?? "");
    paramsBar.textContent = "";
    paramsBar.hidden = specs.length === 0;
    if (!specs.length) return;

    const controls = [];
    for (const spec of specs) {
      const field = document.createElement("label");
      field.className = "pyodide-param";
      const name = document.createElement("span");
      name.className = "pyodide-param-name";
      name.textContent = spec.name;

      // The range -- or the mere fact of being a flag -- is declared in the
      // directive; the value lives in the code. One source of truth, so
      // reopening a document shows what it will actually run.
      if (spec.type === "bool") {
        const box = document.createElement("input");
        box.type = "checkbox";
        // The code wins when it says anything; the declaration is only what
        // to start from when it does not.
        box.checked = readFlag(editorContainer.value, spec.name) ?? spec.initial ?? false;
        field.title = `${spec.name} — True or False`;
        field.append(box, name);
        paramsBar.append(field);
        controls.push({ spec, input: box });
        continue;
      }

      if (spec.type === "choice") {
        const menu = document.createElement("select");
        menu.className = "pyodide-param-choice";
        for (const item of spec.items) {
          const option = document.createElement("option");
          // The literal is the value, the label is what is read: the code gets
          // `'b'` and the author sees b.
          option.value = item.literal;
          option.textContent = item.label;
          menu.append(option);
        }
        // The code wins when it says anything; the declaration is only what to
        // start from when it does not.
        menu.value = readChoice(editorContainer.value, spec.name, spec.items) ?? spec.initial;
        field.title = `${spec.name} — ${spec.items.map((i) => i.label).join(", ")}`;
        field.append(name, menu);
        paramsBar.append(field);
        controls.push({ spec, input: menu });
        continue;
      }

      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = String(spec.min);
      slider.max = String(spec.max);
      slider.step = String(spec.step);

      const readout = document.createElement("output");
      readout.className = "pyodide-param-value";

      const found = readValue(editorContainer.value, spec.name);
      const start = quantise(spec, Math.min(spec.max, Math.max(spec.min, found ?? spec.min)));
      slider.value = String(start);
      slider.draggable = false;
      readout.textContent = formatValue(spec, start);
      field.title = `${spec.name} — ${spec.min} to ${spec.max}, step ${spec.step}`;

      slider.addEventListener("input", () => {
        readout.textContent = formatValue(spec, quantise(spec, Number(slider.value)));
      });

      field.append(name, slider, readout);
      paramsBar.append(field);
      controls.push({ spec, input: slider });
    }

    /**
     * Write the controls into the code, then run.
     *
     * The values live in the code and nowhere else -- `:params:` declares the
     * range, the cell's own source holds what it is set to -- so applying them
     * is an edit of the document, with everything that implies: an undo step,
     * a dirty file, a new cache key, a line on the collaboration stream.
     *
     * Which is why this is bound to `change` and not to `input`. A range emits
     * `change` on release and `input` on every pixel of a drag; the second
     * would write the document a hundred times for one gesture.
     */
    const applyAndRun = () => {
      let next = editorContainer.value;
      for (const { spec, input } of controls) {
        const written =
          spec.type === "bool"
            ? formatFlag(input.checked)
            : spec.type === "choice"
              ? input.value
              : formatValue(spec, quantise(spec, Number(input.value)));
        next = writeValue(next, spec.name, written);
      }
      // Setting .value dispatches a CM change; _syncToEditor then moves the
      // cache entry and tells the source side, exactly as a typed edit would.
      if (next !== editorContainer.value) editorContainer.value = next;
      _syncToEditor(view);
      // The values are written either way; the run waits when one is already
      // under way rather than stacking on it. Run disables its own button for
      // the length of an execution, which is the state to read.
      if (!runBtn.disabled) runBtn.click();
    };

    const applyBtn = mkBtn("pyodide-btn-apply", "Apply");
    applyBtn.title = "Write these values into the cell's code and run it";
    applyBtn.addEventListener("click", applyAndRun);
    paramsBar.append(applyBtn);

    // `:params: auto, …` -- the same thing, without the click. The button
    // stays: a cell that failed is re-run from it without having to disturb a
    // control that is already where it should be.
    if (parseParamsOptions(el.dataset.params ?? "").auto) {
      applyBtn.title += " (this cell also runs when a control is released)";
      for (const { input } of controls) input.addEventListener("change", applyAndRun);
    }
  };

  wrapper.append(header, editorRow, paramsBar, statusBar, outputArea);
  editorRow.appendChild(editorContainer);
  el.innerHTML = "";
  el.appendChild(wrapper);
  el.dataset.initialized = "1";
  // The inline preview reserves the cell's last known height on the empty
  // placeholder so the document does not shrink by the height of every cell
  // between the block being drawn and this observer filling it. The cell is
  // here now, so the reservation goes: the real content takes over.
  el.style.minHeight = "";

  if (cacheKey) cellCache.set(cacheKey, el);

  // Two answers, in order: what the reader left it at during this session --
  // the host's own attribute, which survives a re-render -- and what the
  // document asks for with `:fold:`, which the chevron writes itself.
  //
  // `:tags: hide-input` used to fold here as well. It no longer does: it is
  // metadata for the export, and the two say different things -- a cell may
  // well be read open and exported without its input. The tag is still carried
  // through to the export untouched.
  setFolded(el.dataset.folded === "1" || (el.dataset.folded === undefined && el.dataset.fold === "1"));
  if (el.dataset.cellFont) setCellFont(Number(el.dataset.cellFont));

  // ── Bare chrome ─────────────────────────────────────────────────────────
  // A cell that is presented as a single button: no toolbar, code folded
  // away, nothing to read but what running it produces. `{quiz}` asks for it;
  // anything else that is an action rather than a listing may.
  //
  // The button does not run anything itself -- it clicks Run. One run path
  // means the streaming, the status, the namespace and the cleanup are the
  // ones that have been debugged, and a second one would drift from them.
  //
  // Read from the host at each render rather than captured, and re-applied by
  // _syncChrome: a widget that is reused keeps the attributes of its first
  // render otherwise, and changing `:button:` in the document stayed without
  // effect until a reload.
  let bareBtn = null;
  const syncChrome = () => {
    const bare = el.dataset.chrome === "bare";
    wrapper.classList.toggle("pyodide-bare", bare);
    if (!bare) { bareBtn?.remove(); bareBtn = null; return; }
    if (!bareBtn) {
      bareBtn = document.createElement("button");
      bareBtn.type = "button";
      bareBtn.className = "pyodide-bare-run";
      bareBtn.title = "Show this quiz (⌥/Alt-click to open the cell)";
      bareBtn.addEventListener("click", (ev) => {
        // Alt-click opens the cell, which is the grammar the toolbar already
        // uses -- Run All, Restart, the size buttons. Hiding the toolbar took
        // the chevron with it, so without this the cell under the button could
        // not be opened at all: a door whose handle is on the other side.
        if (ev.altKey) return foldByHand(false);
        // The button does not run anything itself -- it clicks Run. One run
        // path means the streaming, the status, the namespace and the cleanup
        // are the ones that have been debugged, and a second would drift.
        runBtn.click();
      });
      // Run disables its own button for the length of a run; mirroring it here
      // beats re-deriving the state, which is settled in half a dozen places
      // (the finally of the run, a throw, a restart).
      new MutationObserver(() => { bareBtn.disabled = runBtn.disabled; })
        .observe(runBtn, { attributes: true, attributeFilter: ["disabled"] });

      // Before the output, wherever it currently lives: `:dropdown:` may
      // already have moved it inside its <details>.
      wrapper.insertBefore(bareBtn, details ?? outputArea);
      // Only when the button is created: folding is a view state the reader
      // owns afterwards, and re-folding on every re-render would close a cell
      // under the author typing elsewhere in the document.
      setFolded(true);
    }
    bareBtn.textContent = el.dataset.chromeLabel || "Quiz";
  };

  // `:dropdown:` -- the output in a <details>, so a quiz that has been done can
  // be folded away without clearing it.
  //
  // The <details> follows the output area's own `hidden` rather than being
  // driven from the run: that flag is set in several places (the run, a clear,
  // a sidecar restore), and an empty open frame showing before the first run
  // was the result of trying to track them.
  let details = null;
  const syncDropdown = () => {
    const wanted = el.dataset.dropdown === "1";
    if (wanted && !details) {
      details = document.createElement("details");
      details.className = "pyodide-output-details";
      details.open = true;
      details.hidden = outputArea.hidden;
      details.appendChild(document.createElement("summary"));
      outputArea.replaceWith(details);
      details.appendChild(outputArea);
      // The observer outlives the <details> it was made for: a cell whose
      // `:dropdown:` is taken away sets `details` back to null, and the
      // observer -- still watching the same output area -- then fired on a
      // null. It reads the variable at each call rather than closing over the
      // element, so the guard is the whole fix, and it disconnects itself
      // once there is nothing left to follow.
      const observer = new MutationObserver(() => {
        if (!details) return observer.disconnect();
        details.hidden = outputArea.hidden;
      });
      observer.observe(outputArea, { attributes: true, attributeFilter: ["hidden"] });
    } else if (!wanted && details) {
      details.replaceWith(outputArea);
      details = null;
    }
    if (details) {
      details.querySelector("summary").textContent =
        el.dataset.dropdownLabel || el.dataset.chromeLabel || "Output";
    }
  };

  // Order matters on the first call: the button is placed before the output
  // area, which the dropdown then moves into the <details>.
  syncChrome();
  syncDropdown();
  el._syncDropdown = syncDropdown;
  el._syncChrome = syncChrome;

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
    // The toolbar calls this with the cell's own editor, which does not exist
    // yet while the cell is being built: an absent view is not an error here,
    // only a cell with nothing to synchronise.
    if (!view || editorContainer._suppressSync) return;
    const newCode = view.state.doc.toString();
    if (newCode === _currentCode) return;

    const newHex = new IMurMurHash(newCode, 42).result().toString(16);
    const newId  = `code-cell-${newHex}`;
    const newKey = cellKey(owner, newId);
    if (_currentCacheKey) cellCache.delete(_currentCacheKey);
    cellCache.set(newKey, el);
    el.id = newId;
    _currentCacheKey = newKey;

    // These three events travel on `document`, so every open editor hears
    // them. Each carries the editor it came from: without that, two documents
    // holding the same cell at the same line both match the fence being looked
    // for, and an edit in one rewrote the other as well.
    document.dispatchEvent(new CustomEvent("pyodide-code-edit", {
      detail: { originalCode: _currentCode, newCode, lineId: _lineId(), owner }
    }));
    _currentCode = newCode;
  };

  // ── Raccourcis clavier configurables ─────────────────────────────────────
  const keysCompartment = new Compartment();
  const linenosCompartment = new Compartment();
  let _linenosOn = linenos;
  const cellActions = {
    run:         (view) => { _syncToEditor(view); runBtn.click(); },
    insertBelow: (view) => { _syncToEditor(view); insertBtn.click(); },
    inspect:     () => { openVarInspector(); },
    clear:       () => { clearBtn.click(); },
    runAll:      () => { runAllBtn.click(); },
    clearAll:    () => { clearAllBtn.click(); },
    restart:     () => { restartBtn.click(); },
    deleteCell:  (view) => { _syncToEditor(view); deleteBtn.click(); },
    editSource:  (view) => { _syncToEditor(view); sourceBtn.click(); },
    toggleInput: () => { foldBtn.click(); },
    /**
     * Cut the cell in two at the caret, both halves keeping the marker and the
     * options of the cell they come from -- whatever made it run is still
     * there on either side.
     *
     * A key and not a button, because this one is not a direction but a
     * position: it needs a caret, so it needs the cell to have the focus, and
     * a cell that has the focus is already under the fingers.
     */
    splitCell: (view) => {
      _syncToEditor(view);
      const bodyIndex = view.state.doc.lineAt(view.state.selection.main.head).number - 1;
      document.dispatchEvent(new CustomEvent("pyodide-cell-split", { detail: { owner, code: _currentCode, lineId: _lineId(), bodyIndex } }));
    },
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
      // Le moteur actif répond, et c'est l'espace de la cellule qui dit lequel.
      override: [(context) => runtimeCompletionSource(context, _space())],
      activateOnTyping: true,
      maxRenderedOptions: 12,
    }),
    // The completion popup is a CodeMirror tooltip, placed inside the cell's own
    // editor by default -- and the cell is a box with overflow:hidden, so the
    // list was cut off at its edge, or flipped above the first line when editing
    // the last one. Rendered somewhere wide instead, it is free to hang over the
    // rest of the preview.
    //
    // position:fixed alone would not be enough: the chunks of the preview carry
    // content-visibility:auto, whose paint containment makes them a containing
    // block for fixed descendants and clips them all the same. So the tooltip is
    // moved out, to the nearest ancestor outside the chunks. It stays inside the
    // same root, shadow root included, or it would lose the editor's styles.
    tooltips({ position: "fixed", parent: tooltipParent(el) }),
    cmKeymap.of([
      ...completionKeymap, // Tab accepte la complétion si la popup est visible
      askForCompletion, // Tab la demande s'il y a un mot sous le curseur
      indentWithTab, // Tab indente sinon (4 espaces en Python)
    ]),
    // The configured bindings sit between the two: after completion, so Tab
    // still accepts a suggestion, and before defaultKeymap, whose
    // insertNewlineKeepIndent would otherwise swallow Shift-Enter.
    // config.json is fetched asynchronously and a cell can be built before it
    // arrives, so they live in a compartment and are reapplied once the
    // configuration is in -- otherwise a shortcut set there would take effect
    // or not depending on which finished first.
    keysCompartment.of(cmKeymap.of(cellKeyBindings(cellActions))),
    cmKeymap.of([
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

  // In a compartment rather than pushed once: the same host is reused across
  // re-renders, so an option added to the document has to reach the editor
  // that already exists. `_setLinenos` is what the renderer calls.
  cmExtensions.push(linenosCompartment.of(linenos ? lineNumbers() : []));

  const cmState = EditorState.create({ doc: code, extensions: cmExtensions });
  const view    = new EditorView({ state: cmState, parent: editorContainer });
  el._setLinenos = (on) => {
    if (on === _linenosOn) return;
    _linenosOn = on;
    view.dispatch({ effects: linenosCompartment.reconfigure(on ? lineNumbers() : []) });
  };

  if (!code.trim() && pendingEmptyCellFocus
      && performance.now() - pendingEmptyCellFocus < FOCUS_REQUEST_TTL_MS) {
    pendingEmptyCellFocus = 0;
    // After the frame that inserts the cell in the DOM, or focus() lands on a
    // view the browser has not laid out yet.
    requestAnimationFrame(() => view.focus());
  }

  configReady().then(() => {
    view.dispatch({ effects: keysCompartment.reconfigure(cmKeymap.of(cellKeyBindings(cellActions))) });
  }).catch((e) => console.warn("[cells] could not apply the configured shortcuts", e));

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

  // Built now rather than above: it reads the cell's code through the `.value`
  // getter that was just defined. Exposed on the host so a reused widget can
  // be told that `:params:` changed (see markdownPyodide.js).
  el._syncParams = syncParams;
  syncParams();

  // ── Événements des boutons ────────────────────────────────────────────────

  clearBtn.title = "Clear this cell's output — ⌥/Alt-click to clear every cell";
  clearBtn.addEventListener("click", (ev) => {
    if (ev?.altKey) return void clearAllBtn.click();
    widgetOutputArea.innerHTML = "";
    textOutputArea.innerHTML = "";
    outputArea.hidden = true;
    timing.textContent = "";
    setRanAt(null);
    setStatus(statusText, "");
  });

  restartBtn.title =
    "Restart the kernel \u21bb: clears the variables of this document's namespace " +
    "(⌥/Alt-click to reload the whole Pyodide runtime, which affects every document)";
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
        // Le verbe du contrat, et non la fonction de Pyodide : sous un noyau
        // ce bouton redémarrait l'interprète du navigateur, qui n'exécutait
        // rien, et laissait le noyau intact. Le même oubli que pour l'attente
        // du moteur -- l'appel est antérieur à la couture.
        const { softened, removed, restarted } = await runtime(_space()).restart(_space());
        const where = _spaceLabel() === SHARED_SPACE ? "" : ` in ${_spaceLabel()}`;
        // Trois états, et non deux : un vidage de dictionnaire, qui peut dire
        // combien de noms il a retirés ; un redémarrage de processus, qui n'a
        // rien « vidé » mais tout recommencé, et annoncerait zéro variable
        // effacée s'il empruntait la même phrase ; et rien à redémarrer.
        setStatus(
          statusText,
          softened
            ? `Kernel restarted — ${removed.length} variable(s) cleared${where}`
            : restarted
              ? `Kernel restarted — a new process${where}`
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
    pendingEmptyCellFocus = performance.now();
    document.dispatchEvent(new CustomEvent("pyodide-insert-cell-below", {
      detail: { currentCode: _currentCode, lineId: _lineId(), owner }
    }));
  };
  insertBtn.addEventListener("click", _dispatchInsertBelow);

  // Ask the surrounding editor to show this cell as source.  Only the inline
  // preview listens; anywhere else the event is simply heard by nobody.
  // _syncToEditor first, so the source that appears is the code as it stands in
  // the cell rather than the last version written back to the document.
  sourceBtn.addEventListener("click", () => {
    _syncToEditor(view);
    document.dispatchEvent(new CustomEvent("pyodide-edit-source", {
      detail: { lineId: _lineId(), owner }
    }));
  });

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
        detail: { currentCode: _currentCode, lineId: _lineId(), owner }
      }));
    });
  });

  const RUN_TITLE = "Run this cell (⇧↵) — ⌥/Alt-click to run every cell of the document";
  runBtn.title = RUN_TITLE;

  /**
   * Le bouton d'exécution devient un bouton d'arrêt pendant qu'elle dure.
   *
   * Promis au jalon 1 et jamais câblé : une cellule partie dans une boucle
   * sans fin, ou dans un `%pip` qui attend une réponse impossible, n'avait
   * aucune issue. C'est ici que les capacités déclarées servent pour la
   * première fois -- sous Pyodide, qui ne sait pas s'interrompre, le bouton
   * reste désactivé comme avant, plutôt que d'offrir un arrêt qui n'arrête
   * rien.
   *
   * Le même bouton plutôt qu'un second : la barre est déjà pleine, et c'est
   * le geste du notebook.
   */
  const setStopMode = (on) => {
    runBtn.dataset.stop = on ? "1" : "";
    runBtn.textContent = on ? "⏹" : "▶";
    runBtn.title = on ? "Interrupt this cell" : RUN_TITLE;
    runBtn.disabled = !on;
  };

  runBtn.addEventListener("click", async (ev) => {
    if (runBtn.dataset.stop) {
      // Un clic programmé -- `runAllCells`, le raccourci ⇧↵ -- ne doit ni
      // interrompre ni lancer une seconde exécution : le bouton était
      // désactivé pour cela, et il ne l'est plus pendant qu'il arrête.
      if (!ev?.isTrusted) return;
      runBtn.disabled = true;
      try {
        await runtime(_space()).interrupt(_space());
        setStatus(statusText, "Interrupting…", "info");
      } catch (err) {
        setStatus(statusText, `Could not interrupt: ${err}`, "error");
        runBtn.disabled = false;
      }
      return;
    }
    if (ev?.altKey) return void runAllBtn.click();
    runBtn.disabled = true;
    setStopMode(supports("interrupt", _space()));
    wrapper.classList.add("pyodide-running");
    outputArea.hidden = true;
    widgetOutputArea.innerHTML = "";
    textOutputArea.innerHTML = "";
    timing.textContent = "";
    setRanAt(null);
    // A message left by something else -- a restart, an earlier error -- has
    // nothing to say about this run, and would end up glued to its timing.
    setStatus(statusText, "");

    // `%load` before anything else, since it decides what is about to run.
    // It happens whether or not the interpreter has started: loading a file
    // into a cell has nothing to do with Python, and failing it should not
    // cost the reader a Pyodide download.
    const wanted = loadMagicPath(editorContainer.value);
    if (wanted) {
      if (!isUnderWorkingDir(wanted)) {
        setStatus(statusText, `%load reads under the document's folder; "${wanted}" is outside it`, "error");
        wrapper.classList.remove("pyodide-running");
        setStopMode(false);
        runBtn.disabled = false;
        return;
      }
      try {
        const bytes = await readWorkspaceBytes(wanted);
        if (!bytes) throw new Error("no working folder");
        const text = new TextDecoder().decode(bytes);
        editorContainer.value = applyLoadMagic(editorContainer.value, text);
        // Through the same door a typed edit uses, so the document is
        // updated, the cache entry follows the new code, and the source pane
        // shows what the cell now holds.
        _syncToEditor(view);
        setStatus(statusText, `Loaded ${wanted}`, "success");
      } catch (err) {
        const why = resolveWorkingDir()
          ? `could not read ${wanted}`
          : "%load needs a working folder: save the document first";
        setStatus(statusText, why, "error");
        console.warn("[cells] %load failed:", err);
        wrapper.classList.remove("pyodide-running");
        setStopMode(false);
        runBtn.disabled = false;
        return;
      }
    }

    // Let the browser paint the running state before the interpreter seizes
    // the thread. Pyodide runs here, on the main thread, so from the first
    // line of Python until the last nothing is rendered: without this the
    // class would be added and removed between two frames and the tint would
    // never appear. Two frames, because the first callback still runs before
    // the paint it belongs to.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    try {
      // Quel moteur, d'abord : le document peut nommer un noyau, et la
      // question se règle une fois par espace de noms. Avant la frappe du
      // premier `ready`, parce qu'elle décide de ce qu'on attend.
      // Par document : le `kernelspec` lui appartient, et deux documents
      // peuvent se retrouver dans le même espace de noms -- c'est même le cas
      // ordinaire. Les avoir confondus faisait exécuter le second dans le
      // noyau du premier.
      const chosen = await chooseEngineFor(owner);
      if (chosen.refused) {
        setStatus(statusText, "Not run: this document asks for a kernel that is not available here", "error");
        return;
      }

      // Attendre le moteur actif, et non Pyodide.
      //
      // Ceci chargeait Pyodide avant chaque exécution, même quand la cellule
      // allait tourner dans un noyau : plusieurs secondes et un
      // téléchargement pour rien, et surtout un échec d'installation de
      // `:packages:` par micropip qui empêchait une cellule de s'exécuter
      // dans un noyau où le paquet était déjà installé. L'appel était
      // antérieur à la couture et n'avait pas suivi.
      //
      // La machine à états qui entourait l'appel a disparu avec lui :
      // `loadPyodideRuntime` mémorise déjà sa promesse, donc deux cellules
      // lancées ensemble attendent la même chose sans qu'on ait à le gérer
      // ici.
      const engine = runtime(_space());
      if (!engine.isReady?.()) setStatus(statusText, `${engine.name} is starting (first run)…`, "info");
      try {
        await engine.ready(_packages());
      } catch (err) {
        setStatus(statusText, `Load failed: ${String(err)}`, "error");
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
        // Au registre, pas à Pyodide : c'est ici que le choix du moteur se
        // joue pour une cellule, et `runtime()` rend Pyodide tant qu'aucun
        // autre n'a été demandé.
        // `cwd` : le dossier du document, pour le moteur qui a un vrai
        // système de fichiers. Pyodide l'ignore -- il travaille sur une copie
        // et sait déjà d'où elle vient --, un noyau s'y place. En mode web
        // `resolveWorkingDir` rend une poignée de répertoire et non un
        // chemin, d'où le filtre : un noyau n'existe de toute façon que sur
        // le bureau.
        const cwd = resolveWorkingDir();
        await loadConfig();
        result = await runtime(_space()).execute(view.state.doc.toString(), {
          packages: _packages(),
          onStream,
          space: _space(),
          cwd: typeof cwd === "string" ? cwd : null,
          // La clé garde son nom, `pyodide.resetCwdOnRun`, parce que des
          // configurations existantes la portent ; ce qu'elle dit vaut pour
          // les deux moteurs : chaque cellule repart du dossier du document,
          // au lieu de rester là où la précédente s'est déplacée.
          resetCwd: Boolean(config.pyodide?.resetCwdOnRun),
        });
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
      setRanAt(new Date());
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
      wrapper.classList.remove("pyodide-running");
      setStopMode(false);
      runBtn.disabled = false;
      // A run is the moment the outputs change, and the only one the editor
      // can see. Said rather than acted upon: this module knows nothing of
      // sites or of saving, and `runAllCells` fires it once per cell, so
      // whoever listens has to settle down before acting. Carries its owner,
      // like the edit event above, so two open documents do not answer for
      // each other.
      document.dispatchEvent(new CustomEvent("pyodide-cell-ran", { detail: { owner } }));
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
 * The numbers of the matplotlib figures currently open, or null when
 * matplotlib is not loaded. Taken before an evaluation so that what it opened
 * can be told from what was already there.
 */
function openFigureNumbers(pyodide) {
  try {
    return JSON.parse(pyodide.runPython(
      `import matplotlib.pyplot as _plt, json as _json; _json.dumps(_plt.get_fignums())`));
  } catch {
    return null;   // matplotlib absent: nothing to capture later either
  }
}

/**
 * Capture the open matplotlib figures as data URLs, and close them.
 *
 * SVG rather than PNG, so that zooming into a figure stays sharp instead of
 * showing the pixels of a 120 dpi capture. Text is drawn as paths, which makes
 * the result independent of the fonts available wherever it is later displayed
 * or exported. A dense figure -- a scatter plot of a hundred thousand points --
 * produces an unreasonable SVG, so past a size limit the PNG is kept, and so it
 * is whenever the SVG backend fails for any reason.
 *
 * @param {object} pyodide
 * @param {number[]|null} skip  figure numbers to leave alone, open and
 *   uncaptured. A cell captures everything (null); an {eval} passes the
 *   figures that were already open, so it shows what the expression drew and
 *   not what the document had drawn before it.
 */
function captureFigures(pyodide, skip = null) {
  try {
    const figJson = pyodide.runPython(`
import matplotlib.pyplot as plt, io, base64, json
_SVG_LIMIT = 2_000_000
_skip = set(json.loads('${JSON.stringify(skip ?? [])}'))
_figs = []
for _n in plt.get_fignums():
    if _n in _skip:
        continue
    _f = plt.figure(_n)
    _data = None
    try:
        _b = io.BytesIO()
        with plt.rc_context({'svg.fonttype': 'path'}):
            _f.savefig(_b, format='svg', bbox_inches='tight')
        _raw = _b.getvalue()
        if len(_raw) <= _SVG_LIMIT:
            _data = 'data:image/svg+xml;base64,' + base64.b64encode(_raw).decode()
    except Exception:
        _data = None
    if _data is None:
        _b = io.BytesIO()
        _f.savefig(_b, format='png', bbox_inches='tight', dpi=120)
        _data = 'data:image/png;base64,' + base64.b64encode(_b.getvalue()).decode()
    _figs.append(_data)
    plt.close(_f)
json.dumps(_figs)`);
    return JSON.parse(figJson);
  } catch {
    return [];   // pas de matplotlib
  }
}

/**
 * Asks an object how it wants to be shown, using the repr protocol Jupyter
 * made standard. Anything that already knows how to draw itself in a notebook
 * -- a DataFrame, a matplotlib figure, a sympy expression -- draws itself in
 * an {eval} too, instead of being flattened to str().
 *
 * It is defined in Pyodide's own globals rather than in a user namespace,
 * where it would turn up in dir() and in the sidecar snapshot.
 *
 * The lookup is on the *type*, as IPython does it: an instance attribute
 * called _repr_html_ is data the document happens to carry, not a method for
 * rendering it. Everything is handed back as JSON so nothing crosses the
 * boundary but a string.
 */
const RICH_REPR_SRC = `
def _mystral_rich_repr(_obj):
    import base64 as _b64, json as _json
    _LIMIT = 2_000_000
    for _name, _kind in (("_repr_html_", "html"), ("_repr_svg_", "svg")):
        _fn = getattr(type(_obj), _name, None)
        if _fn is None:
            continue
        try:
            _v = _fn(_obj)
        except Exception:
            continue
        if isinstance(_v, tuple):          # (data, metadata)
            _v = _v[0]
        if isinstance(_v, str) and _v.strip() and len(_v) <= _LIMIT:
            return _json.dumps({"kind": _kind, "value": _v})
    _fn = getattr(type(_obj), "_repr_png_", None)
    if _fn is not None:
        try:
            _v = _fn(_obj)
        except Exception:
            _v = None
        if isinstance(_v, tuple):
            _v = _v[0]
        if isinstance(_v, (bytes, bytearray)):
            _v = _b64.b64encode(bytes(_v)).decode()
        if isinstance(_v, str) and _v.strip() and len(_v) <= _LIMIT:
            return _json.dumps({"kind": "png", "value": _v})
    return _json.dumps({"kind": "text", "value": str(_obj)})
`;

/**
 * Evaluate a single Python expression and describe its result.
 * Lightweight variant of executePython() used by the {eval} inline role:
 * no file pre-staging, no matplotlib figure collection, no file sync.
 *
 * @param {string} expr
 * @returns {Promise<{kind: "text"|"html"|"svg"|"png", value: string}>}
 */
export async function runExpression(expr, space = SHARED_SPACE) {
  const pyodide = await loadPyodideRuntime();
  const figsBefore = openFigureNumbers(pyodide);
  const result = await pyodide.runPythonAsync(expr, { globals: getNamespace(space, pyodide) });

  // A plotting call is the case the repr protocol does not cover: `plt.plot(x)`
  // returns a list of Line2D and draws into the current figure. A notebook
  // shows the figure because its backend displays whatever was left open at
  // the end of the cell; the same rule here, and the figure wins over the
  // value, which is the bookkeeping nobody wants to read mid-sentence.
  if (figsBefore !== null) {
    const drawn = captureFigures(pyodide, figsBefore);
    if (drawn.length) {
      result?.destroy?.();
      return {
        kind: "html",
        value: drawn.map((src) => `<img class="eval-image" alt="matplotlib figure" src="${src}">`).join(""),
      };
    }
  }

  if (result === undefined || result === null) return { kind: "text", value: "" };

  // Simple values come back already converted; only a proxy has a Python
  // object behind it to interrogate.
  const isProxy = typeof result === "object" && typeof result.destroy === "function";
  if (!isProxy) return { kind: "text", value: String(result) };

  try {
    // Not memoised in a flag: a hard restart replaces the runtime, and the
    // flag would then promise a function that no longer exists.
    if (!pyodide.globals.has("_mystral_rich_repr")) pyodide.runPython(RICH_REPR_SRC);
    const describe = pyodide.globals.get("_mystral_rich_repr");
    const json = describe(result);
    describe.destroy?.();
    return JSON.parse(json);
  } catch {
    return { kind: "text", value: String(result) };
  } finally {
    result.destroy?.();
  }
}


// ─── Persistence helpers ─────────────────────────────────────────────────────

/** True if Pyodide has been initialized and is ready to run code. */
export function isPyodideReady() { return pyodideInstance !== null; }

/**
 * Serialize all user-facing globals to cloudpickle base64.
 * Returns a plain JS object suitable for JSON serialization.
 */
export async function snapshotNamespace(space = SHARED_SPACE) {
  const pyodide = await loadPyodideRuntime();
  pyodide.globals.set("_ns_target", getNamespace(space, pyodide));
  const result = await pyodide.runPythonAsync(
    `_mystral_snapshot_json(_ns_target, ${JSON.stringify(RUNTIME_GLOBALS)})`,
  );
  pyodide.runPython("globals().pop('_ns_target', None)");
  const snapshot = JSON.parse(result);
  const skipped = Object.entries(snapshot).filter(([, e]) => e.skipped).map(([n]) => n);
  logNamespaceEvent("snapshot", { saved: Object.keys(snapshot).length, failed: skipped, space });
  if (skipped.length) {
    console.warn(`[namespace] not persisted (unpicklable): ${skipped.join(", ")}`);
  }
  return snapshot;
}

/**
 * Restore a namespace snapshot produced by snapshotNamespace().
 * @param {Object} snapshot  — plain JS object from sidecar JSON
 */
export async function restoreNamespace(snapshot, space = SHARED_SPACE) {
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
  pyodide.globals.set('_ns_target', getNamespace(space, pyodide));
  // Failures used to be swallowed here, so a variable that could not be
  // unpickled simply ceased to exist, with nothing said anywhere. Collect them
  // instead and report them: silent data loss is the one outcome to rule out.
  const report = await pyodide.runPythonAsync("_mystral_restore_json(_restore_data_json, _ns_target)");
  pyodide.runPython("globals().pop('_restore_data_json', None); globals().pop('_ns_target', None)");
  const { ok, failed, relinked, never_saved: neverSaved } = JSON.parse(report);
  const neverSavedNames = Object.keys(neverSaved ?? {});
  if (neverSavedNames.length) {
    console.info(
      `[namespace] never saved (unpicklable when the document was written): ` +
        Object.entries(neverSaved).map(([n, why]) => `${n} (${why})`).join(", "),
    );
  }
  const entries = Object.entries(failed);
  const missingImports = entries.filter(([, i]) => i.kind === "import");
  const reallyLost = entries.filter(([, i]) => i.kind !== "import");

  logNamespaceEvent("restore", { added: ok, failed: entries.map(([n]) => n), space });

  for (const [name, info] of entries) {
    console.warn(`[namespace] could not restore "${name}": ${info.reason}`);
  }
  if (missingImports.length) {
    console.info(
      `[namespace] waiting on this document's own imports: ${missingImports.map(([n]) => n).join(", ")}` +
        " — running the cells that install or define them brings them back.",
    );
  }
  if (reallyLost.length) {
    showToast(
      `${reallyLost.length} variable(s) could not be restored from the saved session: ` +
        `${reallyLost.map(([n]) => n).join(", ")}. Re-run the cells that define them.`,
      "error",
      0,
    );
  }
  console.log(
    `[namespace] restored ${ok.length} variable(s) into ${space}` +
      (relinked ? `, ${relinked} function(s) rebound to the live namespace` : ""),
  );
  return { ok, failed };
}

/**
 * Pyodide as an implementation of the cell runtime, rather than as the only
 * path to one. Nothing changes today: it registers first, so it is the engine
 * every cell talks to. What this buys is that the day a Jupyter kernel is
 * written, the call sites already ask a register rather than this file.
 *
 * The verbs are the ones already exported; the capabilities are declared, so
 * an engine that lacks one says so instead of failing when it is used.
 */
registerRuntime({
  name: "pyodide",
  capabilities: ["expressions", "magics", "inspect", "snapshot", "completion"],
  ready: (packages) => loadPyodideRuntime(packages),
  isReady: () => isPyodideReady(),
  execute: (code, { packages = [], onStream = null, space = SHARED_SPACE } = {}) => executePython(code, packages, onStream, space),
  evaluate: (expr, space) => runExpression(expr, space),
  restart: (space) => softRestartKernel(space),
  inspect: (includeAll, space) => inspectNamespace(includeAll, space),
  forget: (names, opts) => deleteVariables(names, opts),
  complete: (source, pos) => pyodideComplete(source, pos),
  snapshot: (space) => snapshotNamespace(space),
  restore: (snapshot, space) => restoreNamespace(snapshot, space),
});
