import { BUILTIN_DIRECTIVES, DEFAULT_CONFIG } from "./config-defaults.js";
// Statically imported, deliberately, where everything else in this codebase
// loads Tauri lazily.
//
// These modules cannot be code-split anyway: @tauri-apps/api/path is imported
// statically by plugin-fs, and core/event/window by webview and window, so the
// bundler reports every dynamic import of them as ineffective and keeps them in
// the main chunk. What the dynamic import did change was the ORDER of the
// module bodies inside that chunk, and this file runs the very first thing the
// application does. When nothing else pulled path.js in eagerly, its body was
// emitted after the code calling it, and appConfigDir() read BaseDirectory
// before the enum existed -- "undefined is not an object" at start-up, in the
// built app only, where the dev server was fine.
//
// A static import states the dependency instead of hoping for an order. In a
// browser these modules only define functions; nothing touches Tauri until one
// is called, which isTauri guards.
import { appConfigDir, join } from "@tauri-apps/api/path";
import { readTextFile, exists, writeTextFile, mkdir } from "@tauri-apps/plugin-fs";

/**
 * Runtime configuration object — starts from defaults and is mutated by loadConfig().
 * Deep-clone DEFAULT_CONFIG so defaults remain intact for reference.
 */
export const config = {};

/**
 * Copy `source` into `target`, descending into plain objects instead of
 * replacing them, and creating them along the way.
 *
 * Used both to clone the defaults and to apply config.json. A shallow assign
 * would let a file naming a single key wipe out the rest of its section --
 * setting one export template would drop mystPath, sitePort and the other
 * templates. Arrays are replaced, not merged: a list in config.json is meant
 * as the whole list.
 */
function mergeInto(target, source) {
  for (const [key, value] of Object.entries(source ?? {})) {
    const isPlainObject = value !== null && typeof value === "object" && !Array.isArray(value);
    if (isPlainObject) {
      if (target[key] === null || typeof target[key] !== "object" || Array.isArray(target[key])) target[key] = {};
      mergeInto(target[key], value);
    } else {
      target[key] = value;
    }
  }
}

// Deep copy, so the defaults stay intact for reference and nothing mutates them.
mergeInto(config, DEFAULT_CONFIG);

/**
 * True when the app is running inside a Tauri desktop wrapper.
 * Used to switch between web fetch and Tauri fs-plugin reads.
 */
const isTauri = "__TAURI_INTERNALS__" in window;

let directives = BUILTIN_DIRECTIVES;
let customCss  = "";
let ready      = null;

// ---------------------------------------------------------------------------
// Web loader — uses plain fetch() relative to the app's base URL.
// config.json and custom.css must be placed in src/public/ (copied to dist/).
// ---------------------------------------------------------------------------
async function loadConfigWeb() {
  try {
    const res = await fetch(new URL("config.json", import.meta.url));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    _applyConfigData(data);
  } catch (err) {
    console.warn("config.json not loaded, using defaults.", err);
  }

  try {
    const res = await fetch("custom.css");
    if (res.ok) {
      customCss = await res.text();
      console.log("custom.css loaded (web)");
    }
  } catch {
    // Missing file is normal — not an error.
  }
}

// ---------------------------------------------------------------------------
// Tauri loader — reads files from the OS app-config directory via the fs plugin.
//
// Platform locations (identifier = "MystralEditor"):
//   macOS   ~/Library/Application Support/MystralEditor/
//   Linux   ~/.config/MystralEditor/
//   Windows %APPDATA%\MystralEditor\
//
// Place config.json and/or custom.css there to customise the app.
// ---------------------------------------------------------------------------
async function loadConfigTauri() {
  const dir = await appConfigDir();

  // config.json
  const configPath = await join(dir, "config.json");
  if (await exists(configPath)) {
    try {
      const data = JSON.parse(await readTextFile(configPath));
      _applyConfigData(data);
      console.log("config.json loaded from", configPath);
    } catch (err) {
      console.warn("config.json could not be parsed.", err);
    }
  }

  // custom.css
  const cssPath = await join(dir, "custom.css");
  if (await exists(cssPath)) {
    try {
      customCss = await readTextFile(cssPath);
      console.log("custom.css loaded from", cssPath);
    } catch (err) {
      console.warn("custom.css could not be read.", err);
    }
  }
}

// ---------------------------------------------------------------------------
// Shared helper — merges a parsed config.json object into the live config.
// ---------------------------------------------------------------------------
function _applyConfigData(data) {
  const { data_directives, ...rest } = data;
  // Every section merges the same way, at any depth: shortcuts, pyodide,
  // export.templates and whatever is added later all behave alike.
  mergeInto(config, rest);
  directives = { ...BUILTIN_DIRECTIVES, ...(data_directives ?? {}) };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * The config.json written when the user asks to open one that does not exist.
 *
 * It is the complete set of defaults, including the directive registry: JSON
 * takes no comments, so a full file is the only way for it to document itself
 * -- every key that can be set is there, with the value the application would
 * use anyway, and the file changes nothing until it is edited.
 *
 * The cost is that it pins those values: a default changed in a later version
 * will not reach anyone holding a file that names it. Deleting a key is how you
 * go back to following the default.
 */
const starterConfig = () => ({
  ...structuredClone(DEFAULT_CONFIG),
  data_directives: structuredClone(BUILTIN_DIRECTIVES),
});

/**
 * Open the configuration file of the platform in use.
 *
 * Under Tauri it lives in the OS app-config directory; it is created from a
 * starter if absent, since the system cannot open a file that is not there,
 * and handed to whatever application opens .json files.
 *
 * On the web it is served with the application and cannot be written from the
 * browser: it opens in a tab, for reading. Changing it means editing the file
 * on the server.
 *
 * @returns {Promise<{path: string, created: boolean, editable: boolean}>}
 */
export async function openConfigFile() {
  if (!isTauri) {
    const url = new URL("config.json", import.meta.url).href;
    window.open(url, "_blank", "noopener");
    return { path: url, created: false, editable: false };
  }

  // The opener is still lazy: it is only reached by a click, long after
  // everything has been evaluated.
  const { openPath } = await import("@tauri-apps/plugin-opener");

  const dir = await appConfigDir();
  const path = await join(dir, "config.json");
  let created = false;
  if (!(await exists(path))) {
    try { await mkdir(dir, { recursive: true }); } catch { /* already there */ }
    await writeTextFile(path, JSON.stringify(starterConfig(), null, 2) + "\n");
    created = true;
  }
  await openPath(path);
  return { path, created, editable: true };
}

/**
 * Loads user configuration (once). Returns a promise that resolves to config.
 * Safe to call multiple times — subsequent calls return the same promise.
 */
export function loadConfig() {
  ready ??= (async () => {
    // Never reject. app.js awaits this before building the first tab, so a
    // configuration that cannot be read used to take the whole application
    // down with it -- an empty window and nothing in the interface to say why.
    // Defaults are a working application; a warning is enough.
    try {
      if (isTauri) {
        await loadConfigTauri();
      } else {
        await loadConfigWeb();
      }
    } catch (err) {
      console.error("Configuration could not be loaded; using defaults.", err);
    }
    return config;
  })();
  return ready;
}

/** Returns the ready promise, triggering loadConfig() if not yet started. */
export const configReady = () => ready ?? loadConfig();

/** Returns the active directive map (built-in + any user overrides). */
export const getLabelledDirectives = () => directives;

/** Returns the custom CSS string (empty string if none was loaded). */
export const getCustomCss = () => customCss;
