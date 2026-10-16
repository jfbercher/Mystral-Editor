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

import { config, saveConfigValue } from "../../config.js";
import { showToast } from "../utils_ui.js";
import { workingDirectory, currentFileDir, fileName, parentDir, isWindows } from "./fs.js";
import { documentFrontmatter, projectFrontmatter } from "../../markdown/frontmatterUtils.js";
import { dump as yamlDump } from "js-yaml";
import { cellCache, cellKey } from "../../markdown/pyodideRunner.js";

/** Scope names declared in src-tauri/capabilities/default.json. */
const LOGIN_SHELL = "login-shell";
const WINDOWS_SHELL = "windows-shell";

/**
 * `sh` does not exist on Windows outside a Git installation, so the two
 * platforms need different shells, different quoting and different ways of
 * finding the command -- but not a different search: Windows gives a desktop
 * application the user's PATH, read from the registry, so `myst` is simply
 * there. The whole PATH problem below is a Unix one. `isWindows` comes from
 * fs.js, where the path helpers need the same answer.
 */

const EXPORT_DIR = "_build/exports";

/** Quote a value for a POSIX shell. */
const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

/**
 * Quote a value for the shell in use.
 *
 * `cmd.exe` knows only the double quote and has no escape for it -- which costs
 * nothing here, since Windows forbids it in a file name.
 */
const q = (s) => (isWindows ? `"${String(s).replace(/"/g, "")}"` : shq(s));

/** Found by probing, for this session, when config.json names no path. */
let probedMystPath = null;

/**
 * What the user has actually told us, or nothing.
 *
 * `export.mystPath` defaults to the bare name `"myst"`, so its mere presence
 * says nothing: taking it for a setting is what kept the search below from
 * ever running. Only a value that differs from the default counts as a choice.
 */
const configuredMyst = () => {
  const value = String(config.export?.mystPath ?? "").trim();
  return value && value !== "myst" ? value : null;
};

const mystCmd = () => configuredMyst() || probedMystPath || "myst";

/**
 * The command as the shell should receive it.
 *
 * An absolute path is quoted -- a home directory can hold a space -- while
 * anything else is passed through: `export.mystPath` is allowed to be a command
 * line rather than a path, `npx myst` for instance, and quoting would turn that
 * into the name of a file that does not exist.
 */
const mystInvocation = (cmd = mystCmd()) =>
  /^[/~]/.test(cmd) || (isWindows && /^[A-Za-z]:[\\/]/.test(cmd)) ? q(cmd) : cmd;

/**
 * Put the directory myst lives in at the head of the PATH.
 *
 * Knowing where myst is is not enough to run it: `myst` is a node script whose
 * shebang is `#!/usr/bin/env node`, so the PATH chooses the interpreter, and
 * the login shell's PATH is not the user's. A Homebrew myst found at
 * /opt/homebrew/bin/myst was running under the /usr/local/bin/node that
 * `sh -lc` sees -- node 20 against the node 26 installed beside it -- and died
 * inside mystmd with `The "path" argument must be of type string. Received
 * undefined`, far enough from the cause to look like anything but a version
 * mismatch. A command manager's node sits next to the command it installed, so
 * putting that directory first picks the interpreter the user's own shell
 * would have picked.
 *
 * Only for an absolute path, since nothing else names a directory, and only on
 * POSIX: Windows hands a desktop application the user's real PATH, so there is
 * nothing to repair there and the quoting is better left alone.
 */
const pathPrefix = (cmd) => {
  if (isWindows || !/^[/~]/.test(cmd)) return "";
  const dir = parentDir(cmd);
  return dir ? `export PATH=${shq(dir)}:"$PATH" && ` : "";
};

/**
 * Where `myst` usually sits when the PATH does not say.
 *
 * A desktop application launched from the Finder does not inherit a terminal's
 * environment, and `sh -lc` reads `/etc/profile` and `~/.profile` -- never
 * `~/.zprofile` or `~/.zshrc`, where a macOS user's PATH additions live. So
 * `myst` is on the PATH in development, launched from a terminal, and gone in
 * a bundled build. These are tested with `[ -x ]`, which costs nothing;
 * `export.mystSearchPaths` in config.json adds to the list.
 */
const MYST_CANDIDATES = [
  "/opt/homebrew/bin/myst",
  "/usr/local/bin/myst",
  "/usr/bin/myst",
  "/snap/bin/myst",
  "$HOME/.local/bin/myst",
  "$HOME/.npm-global/bin/myst",
  "$HOME/.volta/bin/myst",
  "$HOME/.bun/bin/myst",
  "$HOME/.nvm/versions/node/*/bin/myst",
];

/**
 * A command the shell could not find at all, as opposed to one that failed.
 *
 * The exit codes are what to go by: 127 for a POSIX shell, 9009 for `cmd.exe`.
 * Its message is translated, so matching on the text would work in English and
 * nowhere else.
 */
const SHELL_NOT_FOUND = /\b(?:command not found|not found|no such file or directory|is not recognized as an internal or external command)\b/i;

const notFound = (res) => {
  if (res?.code === 127 || res?.code === 9009) return true;
  // The text is only a fallback, and it has to be a narrow one: a shell that
  // cannot find a command says so in a single short line, whereas myst's own
  // output runs to hundreds and contains messages such as "Cross reference
  // target was not found" -- which is how a build that worked came to be
  // reported as a missing myst.
  const err = String(res?.stderr ?? "").trim();
  if (!err || err.length >= 200 || err.includes("\n")) return false;
  // A line myst marked as its own is myst's, whatever it says.
  if (/[⚠⛔📖📚🍡🌎]/u.test(err)) return false;
  return SHELL_NOT_FOUND.test(err);
};

/**
 * Look for myst, cheapest first.
 *
 * The absolute paths are a single shell loop and answer instantly. Only if
 * none matches do we pay for an interactive login shell, which is slow but
 * reads `~/.zshrc` and therefore finds an nvm or a volta installation that
 * nothing else would.
 */
async function probeMyst() {
  // Nothing to look for: Windows hands the application the user's PATH.
  if (isWindows) return null;

  const list = [...MYST_CANDIDATES, ...(config.export?.mystSearchPaths ?? [])].join(" ");
  const quick = await runShell(`for p in ${list}; do [ -x "$p" ] && printf '%s\n' "$p" && exit 0; done; exit 1`);
  const found = quick.code === 0 && quick.stdout.trim().split("\n")[0];
  if (found) return found;

  const deep = await runShell(
    `for s in zsh bash; do command -v $s >/dev/null 2>&1 || continue; ` +
      `p=$("$s" -ilc 'command -v myst' 2>/dev/null | tail -n 1); ` +
      `[ -x "$p" ] && printf '%s\n' "$p" && exit 0; done; exit 1`,
  );
  return (deep.code === 0 && deep.stdout.trim().split("\n")[0]) || null;
}
const sitePort = () => config.export?.sitePort ?? 3000;

const baseName = (p) => fileName(p);

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
const dirName = (p) => parentDir(p);
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
async function runShell(line, cwd) {
  const { Command } = await import("@tauri-apps/plugin-shell");
  // `/d` keeps an AutoRun entry from changing the directory under us, and `/s`
  // makes cmd strip the outer quotes and take the rest of the line verbatim --
  // without it, a line holding quoted paths is re-parsed and falls apart.
  const [scope, args] = isWindows ? [WINDOWS_SHELL, ["/d", "/s", "/c", line]] : [LOGIN_SHELL, ["-lc", line]];
  console.log("[export]", scope, JSON.stringify(args), cwd ? `(cwd: ${cwd})` : "");

  try {
    const cmd = Command.create(scope, args, cwd ? { cwd } : {});
    const res = await cmd.execute();
    if (res.code !== 0) console.log("[export] exit", res.code, "\n", res.stdout, "\n", res.stderr);
    return { ...res, scope };
  } catch (err) {
    // A shell that cannot even be started -- a scope the capabilities do not
    // declare, a program that is not there -- used to reject and vanish: an
    // export is reached from an asynchronous toast callback, where nothing
    // catches. Turning it into an ordinary failure is what makes it visible.
    console.error("[export] could not start the shell:", scope, err);
    return { code: -1, stdout: "", stderr: String(err?.message ?? err), scope };
  }
}

async function runMyst(argline, cwd) {
  // The directory is changed inside the line on POSIX only, where a login
  // shell's profile can move it after the fact. `cmd /d` cannot be moved, so
  // there the `cwd` option is enough -- and it spares the line two quoted
  // paths, which is worth having where quoting is as brittle as it is.
  const run = (cmd) => {
    const call = `${pathPrefix(cmd)}${mystInvocation(cmd)} ${argline}`;
    return runShell(isWindows ? call : `cd ${shq(cwd)} && ${call}`, cwd);
  };

  const res = await run(mystCmd());
  // Only a command that was never found is worth looking for; a myst that ran
  // and failed has nothing to do with where it lives.
  if (!notFound(res) || probedMystPath || configuredMyst()) return res;

  const found = await probeMyst();
  if (!found) return res;

  probedMystPath = found;
  const written = await saveConfigValue("export.mystPath", found);
  showToast(
    written
      ? `myst was not on the PATH; found at ${found} and recorded in config.json.`
      : `myst was not on the PATH; using ${found} for this session.`,
    "success",
    8000,
  );
  return run(found);
}

/** A line myst marks as a warning rather than an error. */
const isWarningLine = (line) => /^\s*(?:⚠|WARN|warning)/iu.test(line);

/**
 * What myst actually has to say, warnings last.
 *
 * Taking the last three lines put the warnings in front of the error that
 * ended the run, which is the wrong way round: `myst build` prints its
 * warnings as it goes and its reason for stopping at the end. The lines that
 * are not warnings are therefore the ones worth showing, and the warnings are
 * only counted.
 */
function summarise(res) {
  const lines = String(res?.stderr || res?.stdout || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const warnings = lines.filter(isWarningLine);
  const errors = lines.filter((l) => !isWarningLine(l));
  return {
    warnings: warnings.length,
    onlyWarnings: lines.length > 0 && errors.length === 0,
    detail: (errors.length ? errors : warnings).slice(-2).join(" "),
  };
}

/** Report a command that did not end well, keeping the toast up to be read. */
function reportFailure(what, res) {
  console.error(`[export] ${what} exited ${res?.code}:`, res?.stderr || res?.stdout);

  // The one failure that is not about the document: the command itself is
  // nowhere to be found, and the probe did not turn it up either.
  if (notFound(res)) {
    showToast(
      "myst could not be found. An application launched from the desktop does not inherit a terminal's PATH. " +
        "Run `which myst` in a terminal and put that path in export.mystPath in config.json.",
      "error",
      0,
    );
    return;
  }

  const { warnings, onlyWarnings, detail } = summarise(res);
  // "Failed" overstates it when myst wrote its output and merely complained on
  // the way: the output exists, and a warning is not a failure. The shell and
  // the exit code are named because in a packaged build there is no console.
  const headline = onlyWarnings ? `${what} reported warnings` : `${what} reported errors`;
  const counted = warnings && !onlyWarnings ? ` (and ${warnings} warning${warnings > 1 ? "s" : ""})` : "";
  const where = res?.scope ? ` [${res.scope}, exit ${res.code}]` : "";
  showToast(`${headline}${counted}${where}${detail ? ": " + detail : ""}`, onlyWarnings ? "warning" : "error", 0);
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
/**
 * Report anything that escapes, rather than let it vanish.
 *
 * These entry points are called from menu handlers and toast callbacks, none of
 * which await their result: an exception there is an unhandled rejection and
 * the user sees nothing happen at all.
 */
const reported = (what, fn) => async (...args) => {
  try {
    return await fn(...args);
  } catch (err) {
    console.error(`[export] ${what} threw:`, err);
    showToast(`${what} failed: ${err?.message ?? err}`, "error", 0);
  }
};

export const exportCurrentFile = reported("Export", exportCurrentFileImpl);

async function exportCurrentFileImpl(tab, kind) {
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
          // Nothing awaits this callback, so an exception here would be lost.
          try {
            if (needProject && !(await mystInit(dirName(path)))) return;
            if (needEntry) addExportToFrontmatter(tab, kind);
            await runExport(tab, kind);
          } catch (err) {
            console.error("[export] failed:", err);
            showToast(`Export failed: ${err?.message ?? err}`, "error", 0);
          }
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

  const res = await runMyst(`build ${q(file)} --${kind}`, dir);
  if (res.code !== 0) return reportFailure(`myst build --${kind}`, res);

  // Do not guess the name: myst slugifies it, and its exact rules are its own.
  // Try the expected slug, then fall back to the newest file of that type.
  const out = await resolveExport(`${dir}/${EXPORT_DIR}`, OUTPUT_EXTENSIONS[kind] ?? [kind], slugify(stemOf(path)));
  if (!out) {
    showToast(`myst reported success but no ${(OUTPUT_EXTENSIONS[kind] ?? [kind]).map((e) => "." + e).join(" or ")} file was found in ${EXPORT_DIR}.`, "error", 0);
    return;
  }
  // Relative to the document's folder rather than just the file name: a LaTeX
  // export sits in a subfolder of its own, and saying "_build/exports/x.tex"
  // would send the user looking in the wrong place.
  const shown = out.startsWith(`${dir}/`) ? out.slice(dir.length + 1) : baseName(out);
  showToast(`Exported to ${shown}`, "success", 6000);

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
  const suffixes = exts.map((e) => `.${e}`);

  const when = async (full) => {
    try {
      return (await stat(full)).mtime?.getTime?.() ?? 0;
    } catch {
      return null;
    }
  };

  // Several candidates may exist at once -- a stale .docx beside a fresh .doc
  // from a run that changed template. Take the most recently written.
  let newest = null;
  const consider = async (full) => {
    const t = await when(full);
    if (t != null && (!newest || t > newest.when)) newest = { full, when: t };
  };

  // The expected names first. LaTeX is the odd one out: myst does not drop a
  // .tex beside the other exports, it writes a folder of its own holding the
  // file and the images it refers to -- "small-demo_tex/small-demo.tex". Looking
  // only beside the exports, we declared the export missing although it had just
  // been produced.
  for (const ext of exts) {
    if (await exists(`${dir}/${slug}.${ext}`)) await consider(`${dir}/${slug}.${ext}`);
    const sub = `${dir}/${slug}_${ext}/${slug}.${ext}`;
    if (await exists(sub)) await consider(sub);
  }
  if (newest) return newest.full;

  // Failing that, look through the exports folder and one level under it, which
  // is as deep as myst goes. The name myst chose is its own -- it slugifies --
  // so the most recent file of the right type wins.
  try {
    for (const entry of await readDir(dir)) {
      const full = `${dir}/${entry.name}`;
      if (entry.isFile) {
        if (suffixes.some((sfx) => entry.name.toLowerCase().endsWith(sfx))) await consider(full);
        continue;
      }
      if (!entry.isDirectory) continue;
      try {
        for (const child of await readDir(full)) {
          if (child.isFile && suffixes.some((sfx) => child.name.toLowerCase().endsWith(sfx))) {
            await consider(`${full}/${child.name}`);
          }
        }
      } catch { /* an unreadable subfolder is not a reason to give up on the rest */ }
    }
    return newest?.full ?? null;
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

/**
 * The rendered body to export, whichever mode the editor is in.
 *
 * In Both and Preview the .myst-preview element holds the rendered chunks and
 * is exported as it stands. In Inline it does not: renderText only fills it for
 * the modes that show it, the rendered blocks living in the editor's widgets
 * instead -- so an export made from Inline produced a page with an empty body.
 * The chunks themselves are up to date in either mode, so the body is rebuilt
 * from them, exactly as the preview would have.
 *
 * Code cells get their live element back: the chunk holds only the placeholder
 * the widget is built from, so without this the cells would come out as empty
 * boxes, without their code and without their output.
 */
function previewHtmlFor(tab, preview) {
  if (preview.querySelector("html-chunk")) return preview.outerHTML;

  const chunks = (typeof window !== "undefined" ? window.myst_editor?.[tab?.editorId]?.state?.text?.chunks : null) ?? [];
  if (!chunks.length) return preview.outerHTML;

  const clone = preview.cloneNode(false);
  clone.innerHTML = chunks.map((c) => `<html-chunk id="html-chunk-${c.id}">${c.html}</html-chunk>`).join("");

  for (const host of clone.querySelectorAll(".code-cell-host")) {
    const live = cellCache.get(cellKey(tab.editorId, host.id, host.dataset.linenos === "true"));
    if (live) host.replaceWith(live.cloneNode(true));
  }
  return clone.outerHTML;
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
    `<div id="myst-css-namespace" data-theme="${theme}">\n${previewHtmlFor(tab, preview)}\n</div>\n` +
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
/** Set while stopping on purpose, so the close handler stays quiet. */
let siteStopping = false;
/** Disarms the opener armed for the current run; a no-op when none is armed. */
let cancelSiteOpener = () => {};

/** True while a `myst start` server spawned from here is running. */
export const siteRunning = () => siteChild !== null;
export const siteUrl = () => `http://localhost:${sitePortInUse ?? sitePort()}`;

export async function startSite(tab) {
  if (siteChild) return;
  const dir = projectDir(tab);
  if (!dir) return;
  const port = sitePort();

  // `myst start` is spawned, not executed, so it cannot probe after the fact:
  // look for the command first when nothing has told us where it is.
  if (!configuredMyst() && !probedMystPath) {
    const found = await probeMyst();
    if (found) {
      probedMystPath = found;
      await saveConfigValue("export.mystPath", found);
    }
  }

  const { Command } = await import("@tauri-apps/plugin-shell");
  // `exec` replaces the shell with myst itself, so kill() reaches the server
  // rather than a wrapper that would leave it orphaned. cmd.exe has no such
  // verb: there the server is a grandchild, and stopping it kills the shell
  // first -- to be checked on Windows.
  const line = isWindows
    ? `${mystInvocation()} start --port ${port}`
    : `cd ${shq(dir)} && ${pathPrefix(mystCmd())}exec ${mystInvocation()} start --port ${port}`;
  console.log("[export] sh -lc", line);
  const [scope, args] = isWindows ? [WINDOWS_SHELL, ["/d", "/s", "/c", line]] : [LOGIN_SHELL, ["-lc", line]];
  const cmd = Command.create(scope, args, { cwd: dir });
  // myst announces the address it actually listens on, and it is not always
  // the one asked for -- it moves on when the port is taken. Reading it from
  // the output is more reliable than trusting the request.
  const watch = (line) => {
    console.log("[myst start]", line);
    // The port first, so that the address is right when the ready line lands.
    const match = SITE_URL_RE.exec(String(line)) ?? SITE_READY_RE.exec(String(line));
    if (match) sitePortInUse = Number(match[1]);
    openSiteWhenReady(line);
  };
  cmd.stdout.on("data", watch);
  cmd.stderr.on("data", watch);
  cmd.on("close", (data) => {
    // Ending on its own is not the same as being stopped from the menu: the
    // button would simply go back to "start", with nothing said about why.
    const unexpected = siteChild && !siteStopping;
    cancelSiteOpener();
    siteChild = null;
    sitePortInUse = null;
    siteStopping = false;
    if (unexpected) {
      showToast(`myst start stopped on its own (exit ${data?.code ?? "?"}). See the console for its output.`, "error", 0);
    }
  });

  // Armed before the spawn: the ready line can arrive before the await below
  // has returned, and an opener armed afterwards would miss it.
  cancelSiteOpener = armSiteOpener();

  try {
    siteChild = await cmd.spawn();
    sitePortInUse = port;
  } catch (err) {
    cancelSiteOpener();
    console.error("[export] myst start failed:", err);
    showToast(`myst start failed: ${err}`, "error", 0);
    return;
  }

  showToast(`Starting the MyST site on port ${port}…`, "success", 5000);
}

/** The address myst prints once it is listening. */
const SITE_URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/i;

/**
 * Open the site when myst says it is listening.
 *
 * A fixed wait was a guess about how long a cold `myst start` takes, and the
 * guess was wrong often enough to land on a "connection refused" page. Polling
 * the address was the obvious cure and the wrong one: the webview's content
 * security policy has no `connect-src` for localhost, so every probe is
 * refused before it leaves. What myst prints is better than either -- it says
 * `Server started on port 3000!` the moment it is ready, and that line arrives
 * through the stream we already read.
 */
let openSiteWhenReady = () => {};

/** The line myst prints once the theme server is up. */
const SITE_READY_RE = /server started on port\s*(\d+)/i;

function armSiteOpener(timeoutMs = 120000) {
  let done = false;

  const open = async () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(siteUrl());
    } catch (err) {
      console.warn("[export] could not open the browser:", err);
    }
  };

  const timer = setTimeout(() => {
    if (done || !siteChild) return;
    done = true;
    showToast(
      `The MyST site has not announced itself yet. If it is up, open ${siteUrl()} yourself.`,
      "warning",
      0,
    );
  }, timeoutMs);

  openSiteWhenReady = (line) => {
    if (SITE_READY_RE.test(String(line))) open();
  };

  return () => {
    done = true;
    clearTimeout(timer);
  };
}

export async function stopSite() {
  if (!siteChild) return;
  siteStopping = true;
  cancelSiteOpener();
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
