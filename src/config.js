import { BUILTIN_DIRECTIVES, DEFAULT_CONFIG } from "./config-defaults.js";

/**
 * Runtime configuration object — starts from defaults and is mutated by loadConfig().
 * Deep-clone DEFAULT_CONFIG so defaults remain intact for reference.
 */
export const config = {
  ...DEFAULT_CONFIG,
  shortcuts: { ...DEFAULT_CONFIG.shortcuts },
  pyodide:   { ...DEFAULT_CONFIG.pyodide   },
};

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
  const { appConfigDir, join } = await import("@tauri-apps/api/path");
  const { readTextFile, exists } = await import("@tauri-apps/plugin-fs");

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
  const { shortcuts, data_directives, ...rest } = data;
  Object.assign(config, rest);
  Object.assign(config.shortcuts, shortcuts ?? {});
  directives = { ...BUILTIN_DIRECTIVES, ...(data_directives ?? {}) };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Loads user configuration (once). Returns a promise that resolves to config.
 * Safe to call multiple times — subsequent calls return the same promise.
 */
export function loadConfig() {
  ready ??= (async () => {
    if (isTauri) {
      await loadConfigTauri();
    } else {
      await loadConfigWeb();
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
