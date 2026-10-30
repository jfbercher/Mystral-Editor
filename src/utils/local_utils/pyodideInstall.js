/**
 * A copy of the Pyodide distribution on disk, so that cells run without a
 * network.
 *
 * Today a session needs two hosts: the CDN for the runtime and its packages.
 * (PyPI was a third until the helpers moved to `loadPackage`.) An application
 * installed on a classroom machine, or one behind a firewall, can therefore
 * execute nothing at all, and every session downloads numpy and matplotlib
 * again.
 *
 * What is downloaded is an exact mirror of the CDN directory, flat: the five
 * core files, then one wheel per package of the dependency closure. `indexURL`
 * can then point at the folder and Pyodide finds everything where it expects
 * it, with no code of ours in the path.
 *
 * **Two scopes have to reach this folder, and a dot nearly stopped both.** A
 * glob does not match a path segment beginning with a dot unless the dot is
 * written literally, and that rule bit twice: the witness was called
 * `.complete` and Tauri's filesystem scope refused it, and on Linux the folder
 * itself lives under `~/.local/share`, where `assetProtocol.scope: ["**"]`
 * answered 403 and nothing else did. Hence a visible witness, and
 * `$APPDATA/**` beside `**` in `tauri.conf.json` -- the expanded variable
 * carries the dot as a literal. macOS and Windows never showed either
 * symptom: their data folders have no dotted segment.
 *
 * **The witness file is the only truth.** `.complete` is written last, once
 * every file is in place, and the install is considered present if and only if
 * it is there. An interrupted download leaves no witness and is never mistaken
 * for a cache; a new version of Pyodide is a new directory, and the old one is
 * removed. Nothing about this belongs in `config.json`: a flag there would go
 * on saying "installed" after the folder was emptied, after a half-finished
 * download, or after an application update moved to another version. What the
 * configuration may hold is a *preference* -- `pyodide.offline` -- which says
 * whether to use a local copy, not whether one exists.
 */

import { isTauri } from "./fs.js";

/** Pinned: the lock, the wheels and the runtime have to agree. */
export const PYODIDE_VERSION = "0.29.3";
export const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

/** Loaded for every cell. */
export const DEFAULT_PACKAGES = ["numpy", "matplotlib", "micropip"];

/**
 * The helpers a document never imports: Tab completion, pickling, and the shim
 * that lets `requests` and `urllib` work. All three are in the distribution,
 * so they cost nothing but their wheel. `pyodide-http` with a hyphen is the
 * package; `pyodide_http` is only the module it installs.
 */
export const HELPER_PACKAGES = ["jedi", "cloudpickle", "pyodide-http"];

/**
 * What `pyodide.js` itself asks for, and nothing more -- checked against the
 * file rather than assumed. `pyodide.mjs` is not among them: the editor loads
 * the classic build with a script tag.
 */
/** Named, because two places read it and an index into the list would rot. */
export const LOCK_FILE = "pyodide-lock.json";

export const CORE_FILES = [
  "pyodide.js",
  "pyodide.asm.js",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  LOCK_FILE,
  // `pyodide.js.map` is deliberately absent. The developer tools ask for it,
  // and downloading it does not help: they resolve the name against the root
  // of the asset origin rather than against the script's own encoded URL, so
  // the request 404s wherever the file sits. Carrying 84 kB that fixes
  // nothing would be worse than the log line it was meant to silence.
];

/**
 * Not `.complete`: a leading dot makes it a hidden file, and Tauri's filesystem
 * scope does not match one behind a `**` -- every other path the application
 * writes under $HOME is allowed, and this one alone was refused. It has no
 * reason to be hidden anyway; inside a folder meant to be copied from machine
 * to machine, a visible file that says what is in it is better.
 */
const WITNESS = "complete.json";

/* ── The plan: pure, and tested on the real lock ────────────────────────── */

/**
 * Every package needed to load `names`, dependencies included.
 *
 * Names are matched after PEP 503 normalisation -- lowercase, and every run
 * of `-`, `_` or `.` reduced to one `-` -- because that is the rule everything
 * else in Python uses, and because the same project is spelled both ways all
 * the time: the package is `pyodide-http` in the lock and `pyodide_http` on
 * the import line. A name that still does not resolve is reported rather than
 * dropped: a silent omission here becomes a session that works online and
 * fails offline, which is the hardest kind of bug to be told about.
 */
const normalise = (name) => String(name).toLowerCase().replace(/[-_.]+/g, "-");

export function packageClosure(lock, names) {
  const packages = lock?.packages ?? {};
  const keys = new Map(Object.keys(packages).map((k) => [normalise(k), k]));
  const found = new Set();
  const missing = [];

  const visit = (name) => {
    const key = keys.get(normalise(name));
    if (!key) {
      if (!missing.includes(name)) missing.push(name);
      return;
    }
    if (found.has(key)) return;
    found.add(key);
    for (const dep of packages[key].depends ?? []) visit(dep);
  };
  names.forEach(visit);

  return { packages: [...found].sort(), missing };
}

/**
 * The files to fetch, in the order they should be written.
 *
 * The core comes first and the witness is not in the list: it is written by
 * the caller, after everything else, and that ordering is the whole guarantee.
 */
export function installPlan(lock, names = [...DEFAULT_PACKAGES, ...HELPER_PACKAGES]) {
  const { packages, missing } = packageClosure(lock, names);
  const files = CORE_FILES.map((name) => ({ name, sha256: null }));
  for (const key of packages) {
    const entry = lock.packages[key];
    files.push({ name: entry.file_name, sha256: entry.sha256, package: key });
  }
  return { files, packages, missing };
}

/* ── Integrity ──────────────────────────────────────────────────────────── */

const hex = (buffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * What can be checked is checked.
 *
 * The lock gives a sha256 for every wheel, so those are verified exactly. It
 * says nothing about the core files, which are therefore only checked for
 * being non-empty and, for the WebAssembly module, for carrying its magic
 * number -- enough to catch a proxy that served an error page with a 200, which
 * is the failure this guards against.
 */
export async function verifyFile(name, bytes, sha256) {
  if (!bytes?.byteLength) return `${name} is empty`;
  if (sha256) {
    const digest = hex(await crypto.subtle.digest("SHA-256", bytes));
    if (digest !== sha256) return `${name} does not match its checksum`;
    return null;
  }
  if (name.endsWith(".wasm")) {
    const magic = new Uint8Array(bytes.buffer ?? bytes, 0, 4);
    if (magic[0] !== 0x00 || magic[1] !== 0x61 || magic[2] !== 0x73 || magic[3] !== 0x6d) {
      return `${name} is not a WebAssembly module`;
    }
  }
  return null;
}

/* ── Where it lives ─────────────────────────────────────────────────────── */

export async function localPyodideDir() {
  const { appDataDir, join } = await import("@tauri-apps/api/path");
  return join(await appDataDir(), "pyodide", PYODIDE_VERSION);
}

/**
 * A file inside the install, named the way this platform names files.
 *
 * Not `${dir}/${name}`: on Windows `appDataDir()` returns a path with
 * backslashes, and gluing a forward slash to it gives a mixed-separator path
 * that the filesystem will accept but that the capability's `$HOME/**`
 * pattern may not -- a permission refusal on one platform only, with nothing
 * in the message pointing at the separator.
 */
async function inInstall(dir, name) {
  const { join } = await import("@tauri-apps/api/path");
  return join(dir, name);
}

/**
 * Is there a usable copy, and what URL serves it?
 *
 * The URL is built from a path that already ends in a separator, so that the
 * file name appended by Pyodide lands inside the folder: `convertFileSrc`
 * percent-encodes what it is given, and a separator added afterwards would sit
 * outside the encoded part.
 */
export async function localPyodideStatus() {
  if (!isTauri()) return { installed: false, dir: null, baseUrl: null };
  try {
    const { exists } = await import("@tauri-apps/plugin-fs");
    const { convertFileSrc } = await import("@tauri-apps/api/core");
    const dir = await localPyodideDir();
    const installed = await exists(await inInstall(dir, WITNESS));
    // The separator is part of what is encoded, and it has to be this
    // platform's: Pyodide appends a bare file name to this base, and the
    // asset protocol percent-decodes the whole thing back into a path.
    let separator = "/";
    try {
      const { sep } = await import("@tauri-apps/api/path");
      separator = typeof sep === "function" ? sep() : sep || "/";
    } catch {
      /* keep "/" */
    }
    const base = dir.endsWith(separator) ? dir : dir + separator;
    return { installed, dir, baseUrl: installed ? convertFileSrc(base) : null };
  } catch (err) {
    console.warn("[pyodide] could not read the local install:", err);
    return { installed: false, dir: null, baseUrl: null };
  }
}

/**
 * Where Pyodide should be loaded from.
 *
 * `"never"` keeps the CDN whatever is on disk, which is what one wants while
 * testing a new version. Anything else prefers a complete local copy and falls
 * back to the CDN, so an application that has never been given one behaves
 * exactly as before.
 */
export async function resolvePyodideBase(preference = "auto") {
  if (preference === "never") return { url: PYODIDE_CDN, local: false };
  const { installed, baseUrl } = await localPyodideStatus();
  return installed ? { url: baseUrl, local: true } : { url: PYODIDE_CDN, local: false };
}

/* ── Installing ─────────────────────────────────────────────────────────── */

/**
 * Fetch the whole distribution into the versioned folder.
 *
 * `extraPackages` adds to the default set, dependencies included: a document
 * that asks for pandas or pyyaml in a cell's `:packages:` needs them here too,
 * or it will run online and fail offline. `pyodide.offlinePackages` is where
 * they are declared.
 *
 * `onProgress` is called with `{done, total, name, bytes}` after each file, so
 * the caller can show what is happening -- several dozen megabytes is long
 * enough that silence reads as a hang.
 *
 * Failure leaves the folder without its witness, which is to say: unusable,
 * and therefore harmless. The partial files are kept rather than cleaned up, so
 * that a second attempt can skip what is already verified.
 */
export async function installLocalPyodide({ onProgress = () => {}, signal, extraPackages = [] } = {}) {
  if (!isTauri()) throw new Error("A local Pyodide is only useful in the desktop application.");
  const { mkdir, writeFile, readFile, exists, remove } = await import("@tauri-apps/plugin-fs");

  const dir = await localPyodideDir();
  await mkdir(dir, { recursive: true });
  // A witness from a previous attempt would make a half-written folder look
  // finished for as long as this one runs.
  const witness = await inInstall(dir, WITNESS);
  if (await exists(witness)) await remove(witness);

  const lockResponse = await fetch(`${PYODIDE_CDN}${LOCK_FILE}`, { signal });
  if (!lockResponse.ok) throw new Error(`pyodide-lock.json: ${lockResponse.status}`);
  const lock = await lockResponse.json();

  const { files, missing } = installPlan(lock, [...DEFAULT_PACKAGES, ...HELPER_PACKAGES, ...extraPackages]);
  if (missing.length) {
    throw new Error(`These packages are not in the Pyodide distribution: ${missing.join(", ")}`);
  }

  let done = 0;
  let bytes = 0;
  for (const file of files) {
    if (signal?.aborted) throw new Error("Installation cancelled.");
    const target = await inInstall(dir, file.name);

    // Already there and sound: a second attempt after a dropped connection
    // should not download forty megabytes again.
    if (await exists(target)) {
      const existing = await readFile(target);
      if (!(await verifyFile(file.name, existing, file.sha256))) {
        done += 1;
        bytes += existing.byteLength;
        onProgress({ done, total: files.length, name: file.name, bytes, skipped: true });
        continue;
      }
    }

    const response = await fetch(`${PYODIDE_CDN}${file.name}`, { signal });
    if (!response.ok) throw new Error(`${file.name}: ${response.status}`);
    const data = new Uint8Array(await response.arrayBuffer());
    const problem = await verifyFile(file.name, data, file.sha256);
    if (problem) throw new Error(problem);
    await writeFile(target, data);

    done += 1;
    bytes += data.byteLength;
    onProgress({ done, total: files.length, name: file.name, bytes });
  }

  // Last, and only now.
  await writeFile(
    await inInstall(dir, WITNESS),
    new TextEncoder().encode(JSON.stringify({ version: PYODIDE_VERSION, files: files.length, bytes, at: new Date().toISOString() }, null, 1)),
  );
  return { dir, files: files.length, bytes };
}

/** Remove a local copy, witness first so an interrupted removal is not usable. */
export async function removeLocalPyodide() {
  const { exists, remove } = await import("@tauri-apps/plugin-fs");
  const dir = await localPyodideDir();
  if (!(await exists(dir))) return false;
  const witness = await inInstall(dir, WITNESS);
  if (await exists(witness)) await remove(witness);
  await remove(dir, { recursive: true });
  return true;
}

/**
 * Fetch, into a local install, the distribution wheels it does not have yet.
 *
 * This is the answer to an asymmetry that is baffling until one knows micropip
 * has two paths: a name absent from the lock is an ordinary PyPI package and
 * is downloaded over the network, while a name *in* the lock is a distribution
 * package, taken from `packageBaseUrl` and nowhere else. Once that is the
 * local folder, being known to Pyodide is what deprives a package of the
 * network -- so `micropip.install("bokeh")` returned without a word and the
 * import after it failed, telling the reader to run the call they had just
 * run.
 *
 * So the folder grows as it is used: what worked once online works offline
 * afterwards, and a package behaves the same whether Pyodide has heard of it
 * or not. Names the lock does not know are left alone; they are micropip's
 * business and the network's.
 *
 * Returns what it added and what it could not get, for the caller to report.
 * Nothing here throws on a failed download: being unable to add a wheel is an
 * answer, not an accident -- it usually means there is no network.
 *
 * `missingLocalWheels` is the same walk without the downloading, so that the
 * Settings panel can ask what is absent -- the honest question behind "is
 * there anything left to fetch" -- rather than guess from the mere existence
 * of a declared list.
 */
export async function missingLocalWheels(names) {
  const wanted = [].concat(names ?? []).filter(Boolean);
  const { installed, dir } = await localPyodideStatus();
  if (!installed || !wanted.length) return { dir, lock: null, missing: [] };

  const { exists, readFile } = await import("@tauri-apps/plugin-fs");
  let lock;
  try {
    lock = JSON.parse(new TextDecoder().decode(await readFile(await inInstall(dir, LOCK_FILE))));
  } catch (err) {
    console.warn("[pyodide] the local lock could not be read:", err);
    return { dir, lock: null, missing: [] };
  }

  // Only what the lock knows: the rest is PyPI's, and already works.
  const { packages } = packageClosure(lock, wanted);
  const missing = [];
  for (const key of packages) {
    if (!(await exists(await inInstall(dir, lock.packages[key].file_name)))) missing.push(key);
  }
  return { dir, lock, missing };
}

/**
 * Forget the empty answer the webview kept for a file that did not exist yet.
 *
 * The order of events is what does the damage: micropip asks for a wheel
 * before we have fetched it, the asset protocol answers an error with no
 * body, and the webview caches *that*. We then write the file -- the console
 * says so, and it is there on disk -- and the very next `loadPackage` asks
 * for the same URL and is served the empty response, which fails Pyodide's
 * integrity check with "Content length: 0" on a file that is plainly
 * complete. Restarting the application cleared it, which is what made the
 * bug look like magic; Windows never showed it, serving its protocols over
 * http through another path.
 *
 * `cache: "reload"` bypasses the stored entry and replaces it, so the fetch
 * Pyodide is about to make finds the file. Failures are ignored: this is a
 * repair of someone else's bookkeeping, and the load that follows is the
 * real test.
 */
async function refreshCacheEntry(baseUrl, fileName) {
  if (!baseUrl) return;
  try {
    await fetch(`${baseUrl}${fileName}`, { cache: "reload" });
  } catch {
    /* the load that follows will say if it mattered */
  }
}

export async function ensureLocalWheels(names) {
  const { dir, lock, missing } = await missingLocalWheels(names);
  if (!lock || !missing.length) return { skipped: !lock, added: [], unavailable: [] };

  const { writeFile } = await import("@tauri-apps/plugin-fs");
  // The URL Pyodide will ask for, needed to put the cache right afterwards.
  const { baseUrl } = await localPyodideStatus();
  const added = [];
  const unavailable = [];

  for (const key of missing) {
    const entry = lock.packages[key];
    const target = await inInstall(dir, entry.file_name);
    try {
      const response = await fetch(`${PYODIDE_CDN}${entry.file_name}`);
      if (!response.ok) throw new Error(`${response.status}`);
      const data = new Uint8Array(await response.arrayBuffer());
      const problem = await verifyFile(entry.file_name, data, entry.sha256);
      if (problem) throw new Error(problem);
      await writeFile(target, data);
      await refreshCacheEntry(baseUrl, entry.file_name);
      added.push(key);
    } catch (err) {
      console.warn(`[pyodide] ${key} could not be added to the local install:`, err);
      unavailable.push(key);
    }
  }
  if (added.length) console.log(`[pyodide] added to the local install: ${added.join(", ")}`);
  return { skipped: false, added, unavailable };
}

/**
 * Among `names`, those the distribution knows -- with their dependencies.
 *
 * What `loadPackage` may be handed: it throws on a name it has never heard
 * of, and those are micropip's business anyway.
 */
export async function localLockNames(names) {
  const { lock } = await missingLocalWheels(names);
  if (!lock) return [];
  return packageClosure(lock, [].concat(names ?? []).filter(Boolean)).packages;
}
