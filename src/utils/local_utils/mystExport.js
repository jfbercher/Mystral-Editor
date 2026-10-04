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
import { documentFrontmatter, projectFrontmatter } from "../../markdown/frontmatterUtils.js";
import { dump as yamlDump } from "js-yaml";

/** Scope name declared in src-tauri/capabilities/default.json. */
const LOGIN_SHELL = "login-shell";

const EXPORT_DIR = "_build/exports";

/** Quote a value for a POSIX shell. */
const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

const mystCmd = () => config.export?.mystPath || "myst";
const sitePort = () => config.export?.sitePort ?? 3000;

const baseName = (p) => String(p).split("/").pop();

/**
 * Reproduce the name myst gives an export: lowercase, accents stripped, every
 * run of non-alphanumerics collapsed into a single dash.
 */
const slugify = (s) =>
  String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
/** The document's text as it currently stands in the editor. */
const editorText = (tab) =>
  (typeof window !== "undefined" && window.myst_editor?.[tab?.editorId]?.text) || "";

/** The frontmatter block of `src`, or null. */
const frontmatterOf = (src) => /^---\r?\n([\s\S]*?)\r?\n---/.exec(src);

/** The format an `exports` entry names, whichever shape it was written in. */
const formatOf = (entry) => (typeof entry === "string" ? entry : entry?.format);

/** The `exports` of a frontmatter, always as a list. */
const exportsOf = (frontmatter) => {
  const entries = frontmatter?.exports;
  if (!entries) return [];
  return Array.isArray(entries) ? entries : [entries];
};

/**
 * True when the DOCUMENT's own frontmatter declares an export of this format.
 *
 * Deliberately narrower than the effective frontmatter: `myst build <file>`
 * reads the page's own block and ignores the project's `exports` for a
 * single-file build, so an entry inherited from myst.yml would let the export
 * start and come out with the default template instead. The project's entry is
 * still put to use -- see projectExportEntry() -- but as something to copy here,
 * not as a substitute.
 */
export function frontmatterDeclares(tab, kind) {
  return exportsOf(documentFrontmatter(editorText(tab))).some((e) => String(formatOf(e) ?? "").trim() === kind);
}

/** The project's `exports` entry for this format, if myst.yml declares one. */
function projectExportEntry(kind) {
  return exportsOf(projectFrontmatter()).find((e) => String(formatOf(e) ?? "").trim() === kind);
}

/**
 * The YAML item to write under `exports:` for this format.
 *
 * The project's entry when there is one, copied whole -- template, article
 * type, chapters and the rest -- so that writing the exports once in myst.yml
 * still pays off: the project file becomes the model the documents are filled
 * from. Otherwise a bare entry, with the template config.json names for this
 * format, if it names one.
 */
function exportItem(kind) {
  const fromProject = projectExportEntry(kind);
  if (fromProject && typeof fromProject === "object") {
    return yamlDump([fromProject], { indent: 2, lineWidth: -1 })
      .trimEnd()
      .split("\n")
      .map((l) => "  " + l)
      .join("\n");
  }
  // myst ships no default template, and inventing one here would silently
  // change how every export looks.
  const template = (config.export?.templates?.[kind] || "").trim();
  return `  - format: ${kind}` + (template ? `\n    template: ${template}` : "");
}

/**
 * Add an `exports:` entry for `kind` to the document's frontmatter.
 *
 * Done in the editor rather than on disk, so it shows up as an ordinary edit
 * the user can read and undo. myst ships no default export, so without this
 * entry `myst build --<kind>` finds nothing to produce and quietly does nothing.
 */
function addExportToFrontmatter(tab, kind) {
  const src = editorText(tab);
  const item = exportItem(kind);
  const front = frontmatterOf(src);

  let next;
  if (!front) {
    next = `---\nexports:\n${item}\n---\n\n${src}`;
  } else if (/^exports\s*:/m.test(front[1])) {
    // Append an item to the existing list, right under its key.
    const body = front[1].replace(/^(exports\s*:[^\n]*\n?)/m, `$1${item}\n`);
    next = src.slice(0, front.index) + `---\n${body}\n---` + src.slice(front.index + front[0].length);
  } else {
    next = src.slice(0, front.index) + `---\n${front[1]}\nexports:\n${item}\n---` + src.slice(front.index + front[0].length);
  }
  tab.setEditorText(next);

  // The cached text that the save path reads is refreshed by the editor's update
  // listener, which is debounced by about a tenth of a second. Exporting right
  // after this edit therefore wrote the previous revision to disk, and myst,
  // finding no export entry in the file it read, fell back to its default
  // template -- the first export came out as plain_latex and the next ones were
  // right. Kept in step here; the listener writes the same value when it fires.
  const store = typeof window !== "undefined" ? window.myst_editor?.[tab?.editorId] : null;
  if (store) store.text = next;
}

/** Make the folder a MyST project, non-interactively and in place. */
async function mystInit(dir) {
  showToast("Creating the MyST project (myst init)…", "success", 4000);
  const res = await runMyst("init --site --write-toc", dir);
  if (res.code !== 0) {
    reportFailure("myst init", res);
    return false;
  }
  return true;
}

/**
 * Export the current file through `myst build <file> --<kind>`.
 *
 * Two things are required and myst provides neither by default: a project
 * (myst.yml beside the file) and an `exports:` entry for the wanted format in
 * the document's frontmatter. Both are offered as one explicit action rather
 * than created behind the user's back -- writing into someone's folder and
 * document is not something to do silently.
 *
 * @param {"tex"|"pdf"|"docx"} kind
 */
export async function exportCurrentFile(tab, kind) {
  const path = tab?.currentFileHandle;
  if (typeof path !== "string" || !path) {
    showToast("Save the document first: myst exports a file on disk.", "error", 5000);
    return;
  }

  const needProject = !(await hasMystYml(tab));
  const needEntry = !frontmatterDeclares(tab, kind);
  const fromProject = needEntry && projectExportEntry(kind);

  if (needProject || needEntry) {
    const missing = [
      needProject ? "this folder has no myst.yml" : null,
      needEntry
        ? `the document declares no "${kind}" export in its frontmatter` +
          (fromProject ? ", (and actually myst build reads the document's own, not the project's)" : "")
        : null,
    ]
      .filter(Boolean)
      .join(", and ");
    showToast(
      `Cannot export ${baseName(path)} to ${kind.toUpperCase()} because ${missing}. myst has no default project or export.`,
      "error",
      0,
      {
        label: needProject && needEntry
          ? "Set both up and export"
          : fromProject
            ? "Copy the project's entry and export"
            : "Set it up and export",
        onClick: async () => {
          if (needProject && !(await mystInit(dirName(path)))) return;
          if (needEntry) addExportToFrontmatter(tab, kind);
          await runExport(tab, kind);
        },
      },
    );
    return;
  }

  await runExport(tab, kind);
}

/** Build and open; assumes the project and the frontmatter entry are in place. */
async function runExport(tab, kind) {
  const path = tab.currentFileHandle;
  // Export what is on screen, not the last saved revision.
  await tab.smartSave();

  const dir = dirName(path);
  const file = baseName(path);
  showToast(`Exporting ${file} to ${kind.toUpperCase()}\u2026`, "success", 4000);

  const res = await runMyst(`build ${shq(file)} --${kind}`, dir);
  if (res.code !== 0) return reportFailure(`myst build --${kind}`, res);

  // Do not guess the name: myst slugifies it, and its exact rules are its own.
  // Try the expected slug, then fall back to the newest file of that type.
  const out = await resolveExport(`${dir}/${EXPORT_DIR}`, OUTPUT_EXTENSIONS[kind] ?? [kind], slugify(stemOf(path)));
  if (!out) {
    showToast(`myst reported success but no ${(OUTPUT_EXTENSIONS[kind] ?? [kind]).map((e) => "." + e).join(" or ")} file was found in ${EXPORT_DIR}.`, "error", 0);
    return;
  }
  showToast(`Exported to ${EXPORT_DIR}/${baseName(out)}`, "success", 6000);

  // Open the result in whatever the system uses for it. Not for .tex, which is
  // usually an intermediate the user processes further rather than reads.
  if (kind !== "tex") await openExported(out);
}

/** Hand a produced file to the system's default application. */
async function openExported(path) {
  try {
    const { openPath } = await import("@tauri-apps/plugin-opener");
    await openPath(path);
  } catch (err) {
    console.warn("[export] could not open", path, err);
  }
}

// The extension myst writes is not always the one the format is called by:
// a docx export can land as ".doc" depending on the template in use. Look for
// every plausible extension rather than assuming the format's own name.
const OUTPUT_EXTENSIONS = {
  tex: ["tex"],
  pdf: ["pdf"],
  docx: ["docx", "doc"],
};

/**
 * Absolute path of the export myst just wrote, or null.
 * @param {string[]} exts  candidate extensions, most likely first
 */
async function resolveExport(dir, exts, slug) {
  const { exists, readDir, stat } = await import("@tauri-apps/plugin-fs");
  // Several candidates may exist at once -- a stale .docx beside a fresh .doc
  // from a run that changed template. Take the most recently written.
  let newest = null;
  for (const ext of exts) {
    try {
      const expected = `${dir}/${slug}.${ext}`;
      if (!(await exists(expected))) continue;
      const when = (await stat(expected)).mtime?.getTime?.() ?? 0;
      if (!newest || when > newest.when) newest = { full: expected, when };
    } catch { /* fall through to the scan */ }
  }
  if (newest) return newest.full;
  try {
    const entries = await readDir(dir);
    const suffixes = exts.map((e) => `.${e}`);
    let best = null;
    for (const e of entries) {
      if (!e.isFile || !suffixes.some((sfx) => e.name.toLowerCase().endsWith(sfx))) continue;
      const full = `${dir}/${e.name}`;
      const when = (await stat(full)).mtime?.getTime?.() ?? 0;
      if (!best || when > best.when) best = { full, when };
    }
    return best?.full ?? null;
  } catch (err) {
    console.warn("[export] could not list", dir, err);
    return null;
  }
}

/** The CSSOM sheets of the <style> elements under a node. */
const styleElementSheets = (node) =>
  [...(node?.querySelectorAll?.("style") ?? [])].map((el) => el.sheet).filter(Boolean);

/**
 * The base the exported page needs, applied after everything that was collected.
 *
 * Last rather than first, and this matters, because what is collected is the
 * styling of an application window rather than of a page. The shell sets
 * `html, body { height: 100vh; overflow: hidden }` so that the editor fills the
 * window and never scrolls, and the preview is a styled-components box sized to
 * fill its pane -- `height: 100%` with its own `overflow-y: auto`. Carried into
 * a standalone page, those two left the document stuck at the top with no
 * scrollbar at all. Here the page itself scrolls and the box grows with its
 * content.
 *
 * The theme variables are scoped to #myst-css-namespace, so nothing outside it
 * can read them -- the page background cannot be written in terms of them. The
 * wrapper therefore covers the viewport and carries the background itself.
 * Without it the page stayed white while the dark theme set the text to white,
 * which is unreadable rather than merely plain.
 */
const EXPORT_BASE_CSS = `
html, body {
  margin: 0;
  padding: 0;
  height: auto;
  min-height: 100%;
  width: auto;
  overflow: visible;
}
#myst-css-namespace {
  min-height: 100vh;
  height: auto;
  box-sizing: border-box;
  padding: 20px;
  background: var(--panel-bg, #ffffff);
  color: var(--char-col, #000000);
}
#myst-css-namespace .myst-preview {
  height: auto;
  max-height: none;
  overflow: visible;
  background: transparent;
  border: 0;
  box-shadow: none;
  padding: 0;
}
`;

/** Serialize every CSS rule of a list of stylesheets. */
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
/**
 * Locate the rendered preview of THIS tab. Scoping to the editor id matters:
 * every open tab has its own shadow root, so picking the first .myst-preview in
 * the page exported whichever document happened to come first in the DOM.
 */
function findPreview(tab) {
  const host = tab?.editorId && document.getElementById(tab.editorId);
  return host?.shadowRoot?.querySelector(".myst-preview") ?? null;
}

export async function exportHtml(tab) {
  const path = tab?.currentFileHandle;
  const preview = findPreview(tab);
  if (!preview) {
    showToast("No rendered preview to export: open the preview first.", "error", 5000);
    return;
  }
  if (typeof path !== "string" || !path) {
    showToast("Save the document first, so the export has a name and a folder.", "error", 5000);
    return;
  }

  const root = preview.getRootNode();
  // Adopted sheets carry the themes and the editor's own sheets; the <style>
  // elements carry what styled-components injects, which is where the preview's
  // layout and colours live. Only the adopted ones were collected, so in the
  // light theme the result merely looked plainer than the preview -- and in the
  // dark one it came out unreadable.
  const css = [
    cssTextOf(document.adoptedStyleSheets),
    cssTextOf(root.adoptedStyleSheets),
    cssTextOf(styleElementSheets(root)),
    cssTextOf(styleElementSheets(document.head)),
    EXPORT_BASE_CSS,
  ].join("\n");
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
    const name = `${slugify(title)}.html`;
    await writeTextFile(`${dir}/${name}`, html);
    showToast(`Exported to ${EXPORT_DIR}/${name}`, "success", 6000);
    await openExported(`${dir}/${name}`);
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
