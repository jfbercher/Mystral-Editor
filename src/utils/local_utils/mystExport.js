/**
 * Export menu backend — Tauri only.
 *
 * Runs `myst build` for the current file (tex / pdf / docx), saves the rendered
 * preview as a self-contained HTML document, and drives the two project-level
 * commands (`myst build`, `myst start`).
 *
 * Everything goes through a LOGIN shell (`sh -lc`). A GUI application launched
 * from the Finder does not inherit the PATH of an interactive shell, so a plain
 * `myst` -- typically installed by npm, nvm or conda -- would not be found. The
 * login shell reads the user's profile and resolves it the same way a terminal
 * does. `config.export.mystPath` overrides the command when needed.
 */

import { config } from "../../config.js";
import { showToast } from "../utils_ui.js";
import { workingDirectory, currentFileDir } from "./fs.js";

/** Scope name declared in src-tauri/capabilities/default.json. */
const LOGIN_SHELL = "login-shell";

const EXPORT_DIR = "_build/exports";

/** Quote a value for a POSIX shell. */
const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

const mystCmd = () => config.export?.mystPath || "myst";
const sitePort = () => config.export?.sitePort ?? 3000;

const baseName = (p) => String(p).split("/").pop();
const dirName = (p) => String(p).slice(0, String(p).lastIndexOf("/"));
const stemOf = (p) => baseName(p).replace(/\.[^.]+$/, "");

/**
 * Directory the myst commands run in: the folder of the current file, falling
 * back to the working folder. myst resolves myst.yml from there.
 */
export function projectDir(tab) {
  const p = tab?.currentFileHandle;
  if (typeof p === "string" && p.includes("/")) return dirName(p);
  const wd = currentFileDir.value || workingDirectory.value;
  return typeof wd === "string" ? wd : null;
}

/** True when the project directory holds a myst.yml. */
export async function hasMystYml(tab) {
  const dir = projectDir(tab);
  if (!dir) return false;
  try {
    const { exists } = await import("@tauri-apps/plugin-fs");
    return await exists(`${dir}/myst.yml`);
  } catch {
    return false;
  }
}

/**
 * Run a myst command line in `cwd`, returning { code, stdout, stderr }.
 *
 * The directory is changed inside the command rather than only through the
 * spawn option: a login shell sources the user's profile, which may move the
 * working directory, and myst then treats the home folder as the project root
 * and walks all of it -- failing on TCC-protected paths such as
 * ~/Library/Accounts. The explicit `cd` runs after the profile and wins.
 */
async function runMyst(argline, cwd) {
  const { Command } = await import("@tauri-apps/plugin-shell");
  const line = `cd ${shq(cwd)} && ${mystCmd()} ${argline}`;
  console.log("[export] sh -lc", line, "(cwd:", cwd + ")");
  const cmd = Command.create(LOGIN_SHELL, ["-lc", line], { cwd });
  const res = await cmd.execute();
  if (res.code !== 0) console.log("[export] exit", res.code, "\n", res.stdout, "\n", res.stderr);
  return res;
}

/** Report a failed command, keeping the toast up so the message can be read. */
function reportFailure(what, res) {
  const detail = (res?.stderr || res?.stdout || "").trim().split("\n").slice(-3).join(" ");
  console.error(`[export] ${what} failed (code ${res?.code}):`, res?.stderr || res?.stdout);
  showToast(`${what} failed${detail ? ": " + detail : ""} — see the console for the full output.`, "error", 0);
}

// ---------------------------------------------------------------------------
// Per-file exports
// ---------------------------------------------------------------------------

/**
 * Export the current file through `myst build <file> --<kind>`.
 * @param {"tex"|"pdf"|"docx"} kind
 */
export async function exportCurrentFile(tab, kind) {
  const path = tab?.currentFileHandle;
  if (typeof path !== "string" || !path) {
    showToast("Save the document first: myst exports a file on disk.", "error", 5000);
    return;
  }
  // Export what is on screen, not the last saved revision.
  await tab.smartSave();

  const dir = dirName(path);
  const file = baseName(path);
  showToast(`Exporting ${file} to ${kind.toUpperCase()}…`, "success", 4000);

  const res = await runMyst(`build ${shq(file)} --${kind}`, dir);
  if (res.code !== 0) return reportFailure(`myst build --${kind}`, res);

  const out = `${dir}/${EXPORT_DIR}/${stemOf(path)}.${kind}`;
  showToast(`Exported to ${EXPORT_DIR}/${stemOf(path)}.${kind}`, "success", 6000);

  if (kind === "pdf") {
    try {
      const { openPath } = await import("@tauri-apps/plugin-opener");
      await openPath(out);
    } catch (err) {
      console.warn("[export] could not open the PDF:", err);
    }
  }
}

/** Serialize every CSS rule of a list of adopted stylesheets. */
function cssTextOf(sheets) {
  const parts = [];
  for (const sheet of sheets || []) {
    try {
      for (const rule of sheet.cssRules) parts.push(rule.cssText);
    } catch {
      /* a cross-origin sheet cannot be read; skip it */
    }
  }
  return parts.join("\n");
}

/**
 * Save the rendered preview as a standalone HTML document.
 *
 * The styles are read from the sheets actually adopted at export time -- the
 * shadow root's for the preview itself, the document's for the theme variables,
 * which are scoped to #myst-css-namespace and so need that wrapper to apply.
 */
/** Locate the rendered preview; it lives inside the editor's shadow root. */
function findPreview() {
  for (const el of document.querySelectorAll("*")) {
    if (el.shadowRoot) {
      const found = el.shadowRoot.querySelector(".myst-preview");
      if (found) return found;
    }
  }
  return document.querySelector(".myst-preview");
}

export async function exportHtml(tab) {
  const path = tab?.currentFileHandle;
  const preview = findPreview();
  if (!preview) {
    showToast("No rendered preview to export: open the preview first.", "error", 5000);
    return;
  }
  if (typeof path !== "string" || !path) {
    showToast("Save the document first, so the export has a name and a folder.", "error", 5000);
    return;
  }

  const root = preview.getRootNode();
  const css = [cssTextOf(document.adoptedStyleSheets), cssTextOf(root.adoptedStyleSheets)].join("\n");
  const theme = root.host?.dataset?.theme || document.getElementById("myst-css-namespace")?.dataset?.theme || "lightTheme";
  const title = stemOf(path);

  const html =
    `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${title.replace(/[<&]/g, (m) => (m === "<" ? "&lt;" : "&amp;"))}</title>\n` +
    `<style>\n${css}\n</style>\n</head>\n<body>\n` +
    `<div id="myst-css-namespace" data-theme="${theme}">\n${preview.outerHTML}\n</div>\n` +
    `</body>\n</html>\n`;

  try {
    const { writeTextFile, mkdir } = await import("@tauri-apps/plugin-fs");
    const dir = `${dirName(path)}/${EXPORT_DIR}`;
    await mkdir(dir, { recursive: true }).catch(() => {});
    await writeTextFile(`${dir}/${title}.html`, html);
    showToast(`Exported to ${EXPORT_DIR}/${title}.html`, "success", 6000);
  } catch (err) {
    console.error("[export] HTML export failed:", err);
    showToast(`HTML export failed: ${err}`, "error", 0);
  }
}

// ---------------------------------------------------------------------------
// Project-level commands
// ---------------------------------------------------------------------------

/** Run a plain `myst build` over everything myst.yml declares. */
export async function mystBuild(tab) {
  const dir = projectDir(tab);
  if (!dir) return;
  showToast("Running myst build…", "success", 4000);
  const res = await runMyst("build", dir);
  if (res.code !== 0) return reportFailure("myst build", res);
  showToast("myst build finished.", "success", 5000);
}

// --- myst start -------------------------------------------------------------

let siteChild = null;
let sitePortInUse = null;

/** True while a `myst start` server spawned from here is running. */
export const siteRunning = () => siteChild !== null;
export const siteUrl = () => `http://localhost:${sitePortInUse ?? sitePort()}`;

export async function startSite(tab) {
  if (siteChild) return;
  const dir = projectDir(tab);
  if (!dir) return;
  const port = sitePort();

  const { Command } = await import("@tauri-apps/plugin-shell");
  // `exec` replaces the shell with myst itself, so kill() reaches the server
  // rather than a wrapper that would leave it orphaned.
  const line = `cd ${shq(dir)} && exec ${mystCmd()} start --port ${port}`;
  console.log("[export] sh -lc", line);
  const cmd = Command.create(LOGIN_SHELL, ["-lc", line], { cwd: dir });
  cmd.stdout.on("data", (l) => console.log("[myst start]", l));
  cmd.stderr.on("data", (l) => console.log("[myst start]", l));
  cmd.on("close", () => { siteChild = null; sitePortInUse = null; });

  try {
    siteChild = await cmd.spawn();
    sitePortInUse = port;
  } catch (err) {
    console.error("[export] myst start failed:", err);
    showToast(`myst start failed: ${err}`, "error", 0);
    return;
  }

  showToast(`Starting the MyST site on port ${port}…`, "success", 5000);
  // The server needs a moment before it answers; opening too early shows an error page.
  setTimeout(async () => {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(siteUrl());
    } catch (err) {
      console.warn("[export] could not open the browser:", err);
    }
  }, 4000);
}

export async function stopSite() {
  if (!siteChild) return;
  try {
    await siteChild.kill();
  } catch (err) {
    console.warn("[export] could not stop the site:", err);
  }
  siteChild = null;
  sitePortInUse = null;
  showToast("MyST site stopped.", "success", 4000);
}

// A spawned server outlives the page, so make sure a reload or a quit does not
// leave it running with the port taken.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => { siteChild?.kill?.(); });
}
