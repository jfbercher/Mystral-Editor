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
import { workingDirectory, currentFileDir, fileName, parentDir, isWindows, readTextRelative } from "./fs.js";
import { documentFrontmatter, projectFrontmatter } from "../../markdown/frontmatterUtils.js";
import { dump as yamlDump } from "js-yaml";
import { cellCache, cellKey } from "../../markdown/pyodideRunner.js";
import { includeCache } from "../../markdown/markdownInclude.js";
import { expandIncludes, findIncludeBlocks } from "../../markdown/includeExpansion.js";
import { findProofLabels } from "../../markdown/scanProofLabels.js";
import { scanAdmonitions } from "./scanAdmonitions.js";
import { framedBlocks, pairAdmonitions, rewriteAdmonitions } from "./texAdmonitions.js";
import { repairProofLabels } from "./texProofLabels.js";
import { separateEnvironments } from "./texTidy.js";
import { writePyodideOutputs, refreshPyodideOutputs } from "./pyodideExport.js";
// The two mystmd plugins, embedded in the bundle as text rather than shipped
// as files: `?raw` means they travel with the application, always of the same
// version as the editor that writes them, and there is no resource path to
// resolve differently on each platform.
import exerciseAdmonitionSource from "../../../extras/myst-plugins/exercise-admonition.mjs?raw";
import pyodideOutputsSource from "../../../extras/myst-plugins/pyodide-outputs.mjs?raw";

/**
 * Environment handed to every myst command.
 *
 * `MYSTMD_ALLOW_NODEENV` is read by the pip build of mystmd (mystmd_py's
 * nodeenv.py) and is in none of its documentation. Left alone, a mystmd that
 * finds no node asks `Install Node.js in ...? (y/N)` on stdin -- a prompt with
 * no one in front of it here. Anything that is not yes turns that question
 * into an immediate, explicit refusal with a message of its own, which is what
 * we want: the node it would install is a 20.0.0, below what its own site
 * server works under. Harmless everywhere else, since no other build reads it.
 */
const MYST_ENV = { MYSTMD_ALLOW_NODEENV: "no" };

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
const q = (s) => (isWindows ? `"${String(s).replace(/"/g, "").replace(/\//g, "\\")}"` : shq(s));

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

/** Found by probing, for this session, when config.json names no interpreter. */
let probedNodePath = null;

/** The interpreter the user has chosen, or nothing. Empty by default. */
const configuredNode = () => {
  const value = String(config.export?.nodePath ?? "").trim();
  return value || null;
};

const nodeCmd = () => configuredNode() || probedNodePath || null;

/** Found by probing, for this session, when config.json names no LaTeX. */
let probedLatexPath = null;

/** The LaTeX driver the user has chosen, or nothing. Empty by default. */
const configuredLatex = () => {
  const value = String(config.export?.latexPath ?? "").trim();
  return value || null;
};

const latexCmd = () => configuredLatex() || probedLatexPath || null;

/**
 * The command as the shell should receive it.
 *
 * An absolute path is quoted -- a home directory can hold a space -- while
 * anything else is passed through: `export.mystPath` is allowed to be a command
 * line rather than a path, `npx myst` for instance, and quoting would turn that
 * into the name of a file that does not exist.
 */
const mystInvocation = (cmd = mystCmd()) => (/^[/~]/.test(cmd) || (isWindows && /^[A-Za-z]:[\\/]/.test(cmd)) ? q(cmd) : cmd);

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
 * That guess holds when a package manager installs node beside the command --
 * Homebrew does -- and not at all otherwise: a pip or pipx mystmd lands in
 * ~/.local/bin, where there is no node, and a node installed from nodejs.org
 * or by nvm lives somewhere else entirely. So an interpreter found by probing
 * or named in config.json goes first, and the directory of myst itself stays
 * as the fallback it always was.
 *
 * POSIX only: Windows hands a desktop application the user's real PATH, so
 * there is nothing to repair there and the quoting is better left alone.
 */
const pathPrefix = (cmd) => {
  if (isWindows) return "";
  const node = nodeCmd();
  const dirs = [];
  // The interpreter first when one is known: it was chosen, where the
  // directory below is only a good guess.
  if (node && /^[/~]/.test(node)) dirs.push(parentDir(node));
  if (/^[/~]/.test(cmd)) dirs.push(parentDir(cmd));
  const list = [...new Set(dirs.filter(Boolean))];
  return list.length ? `export PATH=${list.map(shq).join(":")}:"$PATH" && ` : "";
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

/**
 * Where a node that myst can run under may sit.
 *
 * mystmd's own message -- `Node.js (node) is required to run MyST, but could
 * not be found` -- is about the PATH of the shell it was started in, not about
 * the machine: the user's terminal usually has one. The node mystmd installs
 * for itself is in the list even though it needs no help finding it, because
 * being able to name it is what tells a machine that has nothing else apart
 * from one that has a real node somewhere. `export.nodeSearchPaths` in
 * config.json adds to the list.
 */
const NODE_CANDIDATES = [
  "/opt/homebrew/bin/node",
  "/usr/local/bin/node",
  "/usr/bin/node",
  "/snap/bin/node",
  "$HOME/.local/bin/node",
  "$HOME/.npm-global/bin/node",
  "$HOME/.volta/bin/node",
  "$HOME/.bun/bin/node",
  "$HOME/.nvm/versions/node/*/bin/node",
  "$HOME/.asdf/shims/node",
  // mystmd's own, last and least: it is the one that comes out too old.
  "$HOME/.local/share/myst/*/bin/node",
  "$HOME/.local/share/myst/*/node",
];

/**
 * The oldest node mystmd actually works under.
 *
 * Its own check asks for 18 and its documentation for 22, and the truth is
 * nearer the documentation: a 20.11 runs `myst build` well enough to look
 * healthy and dies in the theme server with `The "path" argument must be of
 * type string. Received undefined`, which names neither node nor a version.
 * When nothing on the machine reaches this, saying so is worth more than
 * silently picking the least bad.
 */
const MIN_NODE_MAJOR = 22;

/**
 * mystmd refusing to install a node for itself -- because we refused for it.
 *
 * Its own wording, `the user denied the request`, is accurate about the
 * mechanism and misleading about the facts: nobody was asked anything. Said
 * plainly, this is the one message a new installation most needs to read.
 */
const nodeDenied = (res) =>
  /attempt to install Node\.js (?:was unsuccessful|failed because the user denied)/i.test(`${res?.stdout ?? ""}\n${res?.stderr ?? ""}`);

/** myst saying it has no interpreter, as opposed to failing at its work. */
const nodeMissing = (res) => /Node\.js \(node\) is required to run MyST/i.test(`${res?.stdout ?? ""}\n${res?.stderr ?? ""}`);

/**
 * Look for the newest node, not the first one.
 *
 * Taking the first match is what the myst probe does, and it is right there:
 * any myst will do. Any node will not. A machine commonly carries several --
 * a distribution one, an installer one, one per version manager -- and the
 * oldest is often the one a login shell reaches first; the editor has already
 * run a myst under a node 20 that was six years newer on the same disk, and
 * the failure that followed named neither node nor a version. Asking each
 * candidate for its own version costs a handful of processes and removes the
 * guesswork.
 */
async function probeNode() {
  if (isWindows) return null;

  const list = [...NODE_CANDIDATES, ...(config.export?.nodeSearchPaths ?? [])].join(" ");
  const pick = await runShell(
    `best=; bestv=0; ` +
      `for p in ${list}; do ` +
      `[ -x "$p" ] || continue; ` +
      `v=$("$p" -v 2>/dev/null) || continue; ` +
      `v=\${v#v}; v=\${v%%.*}; ` +
      `case "$v" in ""|*[!0-9]*) continue;; esac; ` +
      `if [ "$v" -gt "$bestv" ]; then bestv=$v; best=$p; fi; ` +
      `done; ` +
      `[ -n "$best" ] && printf '%s %s\n' "$bestv" "$best" || exit 1`,
  );
  const best = pick.code === 0 && pick.stdout.trim().split("\n")[0];
  if (best) {
    const [major, ...rest] = best.split(" ");
    return { path: rest.join(" "), major: Number(major) };
  }

  // Nothing where nodes usually are: let the user's own interactive shell
  // answer, which is what nvm and asdf need -- their node exists only as a
  // function or a shim set up by ~/.bashrc or ~/.zshrc.
  const deep = await runShell(
    `for s in zsh bash; do command -v $s >/dev/null 2>&1 || continue; ` +
      `p=$("$s" -ilc 'command -v node' 2>/dev/null | tail -n 1); ` +
      `[ -x "$p" ] || continue; ` +
      `v=$("$p" -v 2>/dev/null); v=\${v#v}; v=\${v%%.*}; ` +
      `case "$v" in ""|*[!0-9]*) continue;; esac; ` +
      `printf '%s %s\n' "$v" "$p" && exit 0; done; exit 1`,
  );
  const line = deep.code === 0 && deep.stdout.trim().split("\n")[0];
  if (!line) return null;
  const [major, ...rest] = line.split(" ");
  return { path: rest.join(" "), major: Number(major) };
}

/** Set once the search has been made, so that a fruitless one is not repeated. */
let nodeProbed = false;

/**
 * Settle on an interpreter, once per session, before myst is ever run.
 *
 * Reacting to `Node.js (node) is required to run MyST` is not enough, because
 * the worst case never produces that message: on a machine with no node at
 * all, mystmd offers to install one for itself and installs a 20.0.0 -- below
 * what it needs. From then on it has an interpreter, says nothing, and fails
 * deep inside the theme server. Looking first is what makes that case visible,
 * and it costs one shell loop.
 *
 * An interpreter is adopted only if it is new enough to be an improvement.
 * Where the newest node on the machine is too old, saying so plainly is the
 * only useful thing left to do: putting it at the head of the PATH could
 * displace something better that myst was finding on its own.
 *
 * Returns true when a usable interpreter was newly adopted, so that a caller
 * that has just failed knows a retry is worth the wait.
 */
async function ensureNode() {
  if (isWindows || configuredNode() || probedNodePath || nodeProbed) return false;
  nodeProbed = true;

  const found = await probeNode();
  if (!found) return false;

  if (found.major < MIN_NODE_MAJOR) {
    showToast(
      `The newest Node.js found is ${found.major} (${found.path}); mystmd needs ${MIN_NODE_MAJOR} or later. ` +
        `Exports may fail with an error that says nothing about Node. Install a current Node.js, or set ` +
        `export.nodePath in config.json.`,
      "warning",
      0,
    );
    return false;
  }

  probedNodePath = found.path;
  const written = await saveConfigValue("export.nodePath", found.path);
  showToast(
    written
      ? `Running myst under Node ${found.major} (${found.path}), recorded in config.json.`
      : `Running myst under Node ${found.major} (${found.path}) for this session.`,
    "success",
    8000,
  );
  return true;
}

/**
 * Is the interpreter we settled on still there?
 *
 * Only an absolute path can be tested: a `~` would have to be expanded, and a
 * value the user wrote by hand deserves the benefit of the doubt rather than a
 * test that quoting makes fail.
 */
async function nodeUsable() {
  const node = nodeCmd();
  if (isWindows || !node || !node.startsWith("/")) return true;
  return (await runShell(`[ -x ${shq(node)} ]`)).code === 0;
}

/**
 * Forget the recorded interpreter and look again.
 *
 * What is written in config.json is a path, not a version, so an upgrade in
 * place -- Homebrew, apt -- changes nothing and needs nothing: the path still
 * points at the newer node. A version manager is the other case: nvm and asdf
 * keep each version in a directory of its own, so an upgrade leaves the
 * recorded path pointing at an older node, or at nothing once the old version
 * is removed. Without this, the recorded value would then be both wrong and
 * unreachable -- `configuredNode()` answers, so no search is made, and the
 * editor would tell the user to set a setting that is already set.
 */
async function refreshNode() {
  const stale = nodeCmd();
  if (stale) await saveConfigValue("export.nodePath", "");
  probedNodePath = null;
  nodeProbed = false;

  const found = await ensureNode();
  if (!found && stale) {
    showToast(
      `The Node.js recorded in config.json (${stale}) is no longer there, and no replacement was found. ` +
        `Install Node ${MIN_NODE_MAJOR} or later, or set export.nodePath yourself.`,
      "error",
      0,
    );
  }
  return found;
}
/**
 * Where a TeX distribution puts its binaries.
 *
 * The same blind spot as myst and node, and the one that took longest to name
 * because the symptom lies: a desktop application does not inherit a
 * terminal's PATH, so `latexmk` is there in development and gone in a bundled
 * build. What made it hard to read is that the editor then found a `.log` left
 * by an earlier run and reported whatever error that stale file held.
 *
 * Directories rather than paths, because the command named in
 * `export.pdfCommand` is configurable -- latexmk by default, but a user may
 * well put `tectonic` or a wrapper of their own there -- and because finding
 * it is only half of it: latexmk runs `xelatex` and `kpsewhich` through the
 * PATH in turn, and they live in the directory it came from.
 * `export.latexSearchPaths` in config.json adds to the list.
 */
const LATEX_DIRS = [
  // macOS: MacTeX's own symlink farm, then MacPorts, then Homebrew.
  "/Library/TeX/texbin",
  "/opt/local/bin",
  "/opt/homebrew/bin",
  "/usr/local/bin",
  // A TeX Live installed by its own installer, on either system.
  "/usr/local/texlive/*/bin/*",
  "$HOME/texlive/*/bin/*",
  // Distribution packages.
  "/usr/bin",
  "$HOME/.local/bin",
  "$HOME/bin",
];

/** The program `export.pdfCommand` actually runs, as opposed to its arguments. */
const latexProgram = () => (config.export?.pdfCommand ?? "").trim().split(/\s+/)[0] || "latexmk";

/**
 * Look for the LaTeX driver, first match wins.
 *
 * Unlike node, where the newest is the one that works, any complete TeX
 * distribution will do: the order of the list is the preference, and the first
 * one that answers is taken. The interactive shell at the end is there for the
 * same reason as in the two other probes -- a TeX Live installed per user adds
 * its directory in `~/.zshrc`, which `sh -lc` never reads.
 */
async function probeLatex() {
  const program = latexProgram();
  // Only a plain command name can be looked for; `export.pdfCommand` is
  // allowed to start with an absolute path, and that one needs no help.
  if (/[/\\]/.test(program)) return null;

  // Windows hands a desktop application the user's real PATH, so there is
  // nothing to repair there and nothing to search: `where` answers the only
  // question worth asking, which is whether the command exists at all. Asking
  // it is what lets a missing TeX distribution be named as such -- an unknown
  // command inside a batch file comes back as plain exit 1, in the machine's
  // own language, and no exit code tells it apart from a LaTeX run that failed.
  if (isWindows) {
    const where = await runShell(`where ${program}`);
    return (where.code === 0 && where.stdout.trim().split(/\r?\n/)[0]) || null;
  }

  const dirs = [...LATEX_DIRS, ...(config.export?.latexSearchPaths ?? [])].join(" ");
  const quick = await runShell(`for d in ${dirs}; do [ -x "$d/${program}" ] && printf '%s\n' "$d/${program}" && exit 0; done; exit 1`);
  const found = quick.code === 0 && quick.stdout.trim().split("\n")[0];
  if (found) return found;

  const deep = await runShell(
    `for s in zsh bash; do command -v $s >/dev/null 2>&1 || continue; ` +
      `p=$("$s" -ilc 'command -v ${program}' 2>/dev/null | tail -n 1); ` +
      `[ -x "$p" ] && printf '%s\n' "$p" && exit 0; done; exit 1`,
  );
  return (deep.code === 0 && deep.stdout.trim().split("\n")[0]) || null;
}

/** Set once the search has been made, so that a fruitless one is not repeated. */
let latexProbed = false;

/** Set when that search came up empty: the chain is not on this machine. */
let latexMissing = false;

/**
 * Settle on a LaTeX driver, once per session, before the chain is ever run.
 *
 * Looking first rather than reacting to a failure, because the failure is not
 * legible: latexmk missing and latexmk stopping on a missing package both end
 * as a non-zero exit with no PDF beside the `.tex`, and the `.log` that would
 * tell them apart is exactly the file that is not written when the command
 * never ran.
 *
 * A path recorded in config.json that no longer resolves is dropped rather
 * than kept: a TeX Live is upgraded by installing the next year beside it and
 * removing the old one, so a recorded `/usr/local/texlive/2024/bin/...` is
 * precisely what an upgrade leaves behind.
 */
async function ensureLatex() {
  const configured = configuredLatex();
  if (configured) {
    // A `~` or a command line rather than a path is the user's business.
    if (isWindows || !configured.startsWith("/")) return false;
    if ((await runShell(`[ -x ${shq(configured)} ]`)).code === 0) return false;
    showToast(`The LaTeX driver recorded in config.json (${configured}) is no longer there; looking for another.`, "warning", 6000);
    await saveConfigValue("export.latexPath", "");
    probedLatexPath = null;
    latexProbed = false;
  }
  if (probedLatexPath || latexProbed) return false;
  latexProbed = true;

  const found = await probeLatex();
  if (!found) {
    // Remembered, so that `compileTex` can say the chain is missing instead of
    // reporting whatever the shell said in whatever language it said it in.
    latexMissing = true;
    return false;
  }

  probedLatexPath = found;
  const written = await saveConfigValue("export.latexPath", found);
  console.debug(`[export] latex found at ${found}${written ? ", recorded in config.json" : ""}`);
  return true;
}

/**
 * Put the TeX distribution's directory at the head of the PATH.
 *
 * Naming latexmk by its absolute path is not enough: it is a Perl script that
 * runs `xelatex`, `biber` and `kpsewhich` by name, and those are its
 * neighbours. Prefixing instead of substituting also leaves
 * `export.pdfCommand` readable -- it still says `latexmk`, which is what the
 * user wrote there.
 */
const latexPrefix = () => {
  if (isWindows) return "";
  const cmd = latexCmd();
  if (!cmd || !/^[/~]/.test(cmd)) return "";
  const dir = parentDir(cmd);
  return dir ? `export PATH=${shq(dir)}:"$PATH" && ` : "";
};

const sitePort = () => config.export?.sitePort ?? 3000;

/**
 * The port myst's *content* server uses, which is not the one the site is read
 * on: `myst start` runs two servers, the application on `--port` and the
 * content on `--server-port`, 3100 by default. It is named explicitly so that
 * stopping the site knows which ports to free -- left to drift, it moved to
 * 3101, 3102 and so on, each run leaking one more.
 */
const siteContentPort = () => config.export?.siteContentPort ?? sitePort() + 100;

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
/**
 * Decode what a command printed, without ever being able to fail.
 *
 * The shell plugin decodes the output as UTF-8 and rejects the whole call when
 * one byte does not fit: `invalid utf-8 sequence of 1 bytes from index 85`,
 * raised as if the shell could not be started, taking the exit code, the
 * output and any chance of a diagnosis with it. On Windows that is the normal
 * case and not the exception -- `cmd.exe` and the tools it runs write in the
 * machine's legacy code page, so a single accented character in a message from
 * latexmk or myst was enough to lose the export.
 *
 * Asking for the bytes and decoding them here cannot fail, which is the point:
 * a non-fatal decoder substitutes U+FFFD rather than throwing. It is the net
 * under the `chcp 65001` in `runShell`, not the cure -- the cure is making the
 * output UTF-8 in the first place, the active code page being quite possibly
 * one nothing here can decode. The second pass as windows-1252 covers the
 * common Western case and leaves the text approximate elsewhere; approximate
 * text beats a lost exit code.
 */
const decodeOutput = (data) => {
  if (typeof data === "string") return data;
  if (!data || !data.length) return "";
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  if (!utf8.includes("\uFFFD")) return utf8;
  try {
    return new TextDecoder("windows-1252").decode(bytes);
  } catch {
    return utf8;
  }
};

/**
 * Hand a command line to `cmd.exe` through a file, because it cannot be handed
 * over as an argument.
 *
 * Rust quotes each argument of a process it starts in the MSVC convention,
 * which escapes an inner double quote as a backslash-quote pair. `cmd.exe`
 * knows nothing of that escape: it leaves the backslash alone, and the program
 * cmd then starts reads the pair through its own CRT, which turns it back into
 * a literal quote. A line holding `myst build "doc.md" --tex` therefore
 * reaches myst as a file named `"doc.md"`, quotes included -- which exists
 * nowhere, so myst falls back to exporting the project and the document
 * exported is whichever article the project happens to list. myst's own log is
 * where this was finally read, in its `$file` field:
 * `...\\Documents\\"tst-exercisebis.md"`.
 *
 * No quoting of ours survives that path, so none is attempted on it. The line
 * goes into a `.bat` written under the application's config folder, where we
 * decide the quoting, and cmd is given the script's path -- a single argument
 * holding no quote, which Rust passes through untouched.
 *
 * `%` is doubled, since a batch file expands `%NAME%` and a file name may hold
 * one. `chcp 65001` sits in the script rather than being chained with `&`: see
 * `decodeOutput` for why the output has to be UTF-8.
 *
 * Two names rather than one: cmd reads a batch file as it goes, so the
 * long-running `myst start` keeps a script of its own instead of having it
 * overwritten under its feet by the next export.
 */
async function windowsScript(line, name) {
  const { writeTextFile, mkdir } = await import("@tauri-apps/plugin-fs");
  const { appConfigDir, join } = await import("@tauri-apps/api/path");
  const dir = await appConfigDir();
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    /* already there, which is the usual case */
  }
  const path = await join(dir, name);
  await writeTextFile(path, `@echo off\r\nchcp 65001>nul\r\n${line.replace(/%/g, "%%")}\r\n`);
  return path;
}

async function runShell(line, cwd) {
  const { Command } = await import("@tauri-apps/plugin-shell");
  // `/d` keeps an AutoRun entry from changing the directory under us, and `/s`
  // makes cmd strip the outer quotes and take the rest of the line verbatim --
  // without it, a line holding quoted paths is re-parsed and falls apart.
  // On Windows the line goes through a script rather than an argument; see
  // `windowsScript`. If it cannot be written, the inline form is still better
  // than nothing: it works for every command that needs no quoting, and it
  // still asks for UTF-8 output.
  let winArg = null;
  if (isWindows) {
    try {
      winArg = await windowsScript(line, "mystral-run.bat");
    } catch (err) {
      console.warn("[export] the command script could not be written:", err);
    }
  }
  const [scope, args] = isWindows ? [WINDOWS_SHELL, ["/d", "/s", "/c", winArg ?? `chcp 65001>nul & ${line}`]] : [LOGIN_SHELL, ["-lc", line]];
  console.log("[export]", scope, JSON.stringify(args), cwd ? `(cwd: ${cwd})` : "");

  try {
    // `encoding: "raw"` hands back the bytes; see `decodeOutput`.
    const opts = { env: MYST_ENV, encoding: "raw" };
    if (cwd) opts.cwd = cwd;
    const out = await Command.create(scope, args, opts).execute();
    const res = { ...out, stdout: decodeOutput(out.stdout), stderr: decodeOutput(out.stderr) };
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
  // `< /dev/null` backs up MYST_ENV above, for a mystmd too old to read it:
  // that install prompt waits on a pipe nothing ever closes, so without one of
  // the two an export hangs for ever instead of failing. The environment
  // variable is much the better of the two -- it ends in a sentence saying
  // what happened, where EOF ends in a Python traceback -- but it costs
  // nothing to keep both.
  const run = (cmd) => {
    const call = `${pathPrefix(cmd)}${mystInvocation(cmd)} ${argline}`;
    return runShell(isWindows ? call : `cd ${shq(cwd)} && ${call} < /dev/null`, cwd);
  };

  // Before the first command: myst asked for an interpreter it may well find
  // on its own, and finding it too late is the whole trouble.
  await ensureNode();

  const res = await run(mystCmd());

  // Still without one -- the search came up empty where an interactive shell
  // would have answered, or config.json names a node that has since moved.
  if (nodeMissing(res) || nodeDenied(res)) return (await refreshNode()) ? run(mystCmd()) : res;

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
  const retried = await run(found);
  return nodeMissing(retried) && (await ensureNode()) ? run(found) : retried;
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

/**
 * A `myst.yml` that is not valid YAML, which stops myst before it starts.
 *
 * It deserves its own message because nothing else in the output is about the
 * document: mystmd throws from `loadConfigYaml`, so what reaches us is a Node
 * stack trace with the real sentence buried three lines above it. Without
 * this, the toast showed the tail of a stack and the only way to learn that a
 * sequence entry was indented wrongly was to open the console -- which a
 * packaged build does not have.
 *
 * The parser's own sentence is kept as it stands ("bad indentation of a
 * sequence entry (20:5)"): it is js-yaml's, it is precise, and rewording it
 * would only make it harder to search for.
 */
const configError = (res) => {
  const text = `${res?.stdout ?? ""}\n${res?.stderr ?? ""}`;
  // `$` is excluded from the path on purpose: node prints the source line it
  // threw from, `throw Error(\`Unable to read config file ${file} as YAML...\`)`,
  // above the error itself, and a search that matches it captures the template
  // placeholder instead of the file.
  const hit = /Unable to read config file ([^\n$]+?) as YAML/.exec(text);
  if (!hit) return null;
  const [, file] = hit;
  const at = hit.index;
  // The reason is the first line with content after the thrown sentence; the
  // numbered extract and the stack that follow are for a console, not a toast.
  const reason = text
    .slice(at)
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .find((l) => l && !/^at /.test(l) && !/^\d+ \|/.test(l) && !/^\^+$/.test(l) && !/^-+\^/.test(l));
  const [, line] = /\((\d+):\d+\)/.exec(reason ?? "") ?? [];
  return { file: file ? baseName(file) : "myst.yml", reason: reason ?? "", line };
};

/** Report a command that did not end well, keeping the toast up to be read. */
function reportFailure(what, res) {
  console.error(`[export] ${what} exited ${res?.code}:`, res?.stderr || res?.stdout);

  // The one failure that is not about the document: the command itself is
  // nowhere to be found, and the probe did not turn it up either.
  // `notFound()` is written for myst, whose output is long and marked; its
  // textual fallback catches any short line holding "not found", and
  // `! LaTeX Error: File \`tcolorbox.sty\' not found.` is exactly that. Here
  // only the shell's own verdict counts: 127 means the command does not exist.
  if (res?.code === 127 || res?.code === 9009) {
    showToast(
      "myst could not be found. An application launched from the desktop does not inherit a terminal's PATH. " +
        "Run `which myst` in a terminal and put that path in export.mystPath in config.json.",
      "error",
      0,
    );
    return;
  }

  // Not about the document either: the project file cannot be parsed, so
  // nothing was read and nothing will be until it is fixed.
  const bad = configError(res);
  if (bad) {
    showToast(
      // The parser's own sentence is kept as it stands and carries its own
      // position -- "bad indentation of a sequence entry (20:5)" -- so no
      // line number is added to it. `bad.line` is there for a caller that
      // would want to jump to it.
      `${bad.file} is not valid YAML, so myst stopped before reading anything${bad.reason ? `: ${bad.reason}` : "."}`,
      "error",
      0,
    );
    return;
  }

  // No interpreter anywhere, and the editor declined mystmd's offer to fetch
  // one on its own -- deliberately, since what it fetches is a 20.0.0.
  if (nodeDenied(res) || nodeMissing(res)) {
    showToast(
      `No usable Node.js was found on this machine, and mystmd needs ${MIN_NODE_MAJOR} or later to export. ` +
        "Install the current LTS from nodejs.org or with your package manager, then try again. " +
        "If node is installed somewhere unusual, put its path in export.nodePath in config.json.",
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
const editorText = (tab) => (typeof window !== "undefined" && window.myst_editor?.[tab?.editorId]?.text) || "";

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
function exportItem(kind, templateKind = kind) {
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
  // A tex entry added to produce a PDF takes the PDF's template: the point is
  // to compile the document the user configured, not a plain one.
  const template = (config.export?.templates?.[templateKind] || config.export?.templates?.[kind] || "").trim();
  return `  - format: ${kind}` + (template ? `\n    template: ${template}` : "");
}

/**
 * Add an `exports:` entry for `kind` to the document's frontmatter.
 *
 * Done in the editor rather than on disk, so it shows up as an ordinary edit
 * the user can read and undo. myst ships no default export, so without this
 * entry `myst build --<kind>` finds nothing to produce and quietly does nothing.
 */
function addExportToFrontmatter(tab, kind, templateKind = kind) {
  const src = editorText(tab);
  const item = exportItem(kind, templateKind);
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
/** Where a project keeps the plugins the editor needs, relative to myst.yml. */
const PLUGIN_DIR = "myst-plugins";

/** Where the cell images are written, and what the site must serve. */
const PYODIDE_OUTPUT_DIR = "_build/pyodide";

const PROJECT_PLUGINS = [
  ["exercise-admonition.mjs", exerciseAdmonitionSource],
  ["pyodide-outputs.mjs", pyodideOutputsSource],
];

/**
 * Give a project the plugins its documents need, and declare them.
 *
 * Without them a build is silently incomplete: the cell outputs are written to
 * the manifest, correctly, and nobody reads it; exercises and solutions
 * disappear the same way. Nothing fails, nothing is said -- the figures are
 * simply absent, which is the hardest kind of defect to attribute. A project
 * created here had never declared them, so every new folder started broken
 * while an older one, whose myst.yml had been written by hand, worked.
 *
 * Written into the project rather than referenced from the application: a
 * myst.yml pointing at an absolute path inside an app bundle builds on one
 * machine and nowhere else, and would break on the next update. A project
 * carrying its own plugins can be opened by anyone, built without the editor,
 * and committed as it stands.
 */
async function ensureProjectPlugins(dir, { declare = true } = {}) {
  const { exists, mkdir, readTextFile, writeTextFile } = await import("@tauri-apps/plugin-fs");
  try {
    // Without `declare` this only keeps the files in step and writes nothing
    // else: it is called before every build, and a project that has never had
    // our plugins is not to be given them behind its author's back.
    if (!declare && !(await exists(`${dir}/${PLUGIN_DIR}`))) return false;
    await mkdir(`${dir}/${PLUGIN_DIR}`, { recursive: true }).catch(() => {});
    for (const [name, source] of PROJECT_PLUGINS) {
      const file = `${dir}/${PLUGIN_DIR}/${name}`;
      // Rewritten when it differs: the plugin travels with the application, so
      // an update to the editor has to reach the projects it has set up.
      let current = null;
      if (await exists(file)) current = await readTextFile(file).catch(() => null);
      if (current !== source) await writeTextFile(file, source);
    }

    if (!declare) return false;

    const ymlPath = `${dir}/myst.yml`;
    if (!(await exists(ymlPath))) return false;
    const yml = await readTextFile(ymlPath);
    const wanted = PROJECT_PLUGINS.map(([name]) => `${PLUGIN_DIR}/${name}`);
    const missing = wanted.filter((entry) => !yml.includes(entry));
    if (!missing.length && yml.includes(PYODIDE_OUTPUT_DIR) && /^\s*jupyter:/m.test(yml)) return false;

    // Inserted under `project:` rather than parsed and rewritten: the file is
    // the user's, with their comments and their order, and a round trip
    // through a YAML parser would return it rearranged and stripped.
    const lines = yml.split("\n");
    const at = lines.findIndex((l) => /^project:\s*$/.test(l));
    if (at === -1) {
      console.warn("[export] myst.yml has no `project:` block; the plugins were not declared");
      return false;
    }
    const block = ["  plugins:", ...missing.map((entry) => `    - ${entry}`)];
    // The folder the cell images live in, served by the site under its own
    // name. Without it the site renders them from a path it does not serve,
    // and a reader who starts a kernel has nowhere for the result to land:
    // the image and the receptacle are the same node, and that node is only
    // valid when its URL resolves. See the plugin's `nodesFor`.
    if (!yml.includes(PYODIDE_OUTPUT_DIR)) block.push("  static_files:", `    - ${PYODIDE_OUTPUT_DIR}`);
    // The in-browser kernel, so that a reader can re-run a cell on the site.
    // It costs nothing to anyone who does not: the outputs the editor computed
    // are shown as they are, and the kernel is only loaded on demand. A
    // document still decides for itself by carrying a `kernelspec` or not.
    if (!/^\s*jupyter:/m.test(yml)) block.push("  jupyter:", "    lite: true");
    lines.splice(at + 1, 0, ...block);
    await writeTextFile(ymlPath, lines.join("\n"));
    showToast(`${PLUGIN_DIR}/ added to myst.yml: cell outputs and exercises need it to reach the exports.`, "success", 8000);
    return true;
  } catch (err) {
    console.warn("[export] the project plugins could not be installed:", err);
    return false;
  }
}

async function mystInit(dir) {
  showToast("Creating the MyST project (myst init)…", "success", 4000);
  const res = await runMyst("init --site --write-toc", dir);
  if (res.code !== 0) {
    reportFailure("myst init", res);
    return false;
  }
  // `myst init` knows nothing of our plugins, so a project created here would
  // build without them -- silently, which is the whole trouble.
  await ensureProjectPlugins(dir);
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
const reported =
  (what, fn) =>
  async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      console.error(`[export] ${what} threw:`, err);
      showToast(`${what} failed: ${err?.message ?? err}`, "error", 0);
    }
  };

export const exportCurrentFile = reported("Export", exportCurrentFileImpl);

/**
 * True when a PDF is produced here rather than by mystmd.
 *
 * `myst build --pdf` goes from Markdown to PDF through a `.tex` we never see,
 * so nothing can be rewritten between the two: the styled boxes and the
 * repaired labels would reach the LaTeX export and not the PDF. Building the
 * LaTeX, post-processing it and running the chain ourselves is the only place
 * that hand can be taken.
 */
const pdfViaTex = () => config.export?.pdfViaTex !== false && config.export?.postProcessTex !== false;

async function exportCurrentFileImpl(tab, kind) {
  const path = tab?.currentFileHandle;
  if (typeof path !== "string" || !path) {
    showToast("Save the document first: myst exports a file on disk.", "error", 5000);
    return;
  }

  // myst builds the file on disk, so what is on screen has to be on disk --
  // and the save is also what refreshes the manifest of cell outputs, since a
  // cell's current code is read from its own editor. Without this, exporting
  // right after editing a cell built the previous version of the document and
  // lost that cell's figure, which looked like an export fault and was not.
  // An ordinary save, the one the toolbar button makes. Asked for it not to be
  // interactive at first, and that was the mistake: `clearedToWrite` gives up
  // silently when it is not, so a file the conflict guard was unhappy about
  // was never written and nothing said so -- myst then built the previous
  // version and the newly edited cell lost its figure. A dialog is the right
  // answer here: the export was asked for, and a question beats a surprise.
  if (flushCellEdits(tab)) await new Promise((r) => requestAnimationFrame(r));
  try {
    if ((await tab?.saveCurrentDoc?.()) === false) {
      showToast("The document was not saved, so the export will build the version on disk.", "warning", 8000);
    }
  } catch (err) {
    console.warn("[export] the document could not be saved before exporting:", err);
  }

  await ensureProjectPlugins(dirName(path), { declare: false });

  // What myst is actually asked to build. A styled PDF is a LaTeX export that
  // we then compile, so it is a "tex" entry the document must declare -- the
  // "pdf" one is never used on that route.
  const buildKind = kind === "pdf" && pdfViaTex() ? "tex" : kind;

  const needProject = !(await hasMystYml(tab));
  const needEntry = !frontmatterDeclares(tab, buildKind);
  const fromProject = needEntry && projectExportEntry(buildKind);

  if (needProject || needEntry) {
    const missing = [
      needProject ? "this folder has no myst.yml" : null,
      needEntry
        ? `the document declares no "${buildKind}" export in its frontmatter` +
          (buildKind !== kind ? " (a styled PDF is built from the LaTeX export)" : "") +
          (fromProject ? ", (and actually myst build reads the document's own, not the project's)" : "")
        : null,
    ]
      .filter(Boolean)
      .join(", and ");
    showToast(`Cannot export ${baseName(path)} to ${kind.toUpperCase()} because ${missing}. myst has no default project or export.`, "error", 0, {
      label: needProject && needEntry ? "Set both up and export" : fromProject ? "Copy the project's entry and export" : "Set it up and export",
      onClick: async () => {
        // Nothing awaits this callback, so an exception here would be lost.
        try {
          if (needProject && !(await mystInit(dirName(path)))) return;
          if (needEntry) addExportToFrontmatter(tab, buildKind, kind);
          await runExport(tab, kind);
        } catch (err) {
          console.error("[export] failed:", err);
          showToast(`Export failed: ${err?.message ?? err}`, "error", 0);
        }
      },
    });
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
  // A styled PDF is a LaTeX export compiled here; see pdfViaTex().
  const buildKind = kind === "pdf" && pdfViaTex() ? "tex" : kind;
  showToast(`Exporting ${file} to ${kind.toUpperCase()}\u2026`, "success", 4000);

  // Before the build, not after: mystmd reads the manifest while it runs, so
  // what the cells produced has to be on disk first.
  try {
    // The whole shadow root, not just `.myst-preview`: in Inline mode the
    // preview element is never filled and the rendered blocks live in the
    // editor's own widgets, so looking only there found no live cell at all.
    // Both modes are under this root.
    const root = (tab?.editorId && document.getElementById(tab.editorId)?.shadowRoot) || null;
    const written = await writePyodideOutputs(tab, dir, root);
    if (written) {
      showToast(
        `${written.cells} cell output${written.cells === 1 ? "" : "s"} handed to myst` +
          `${written.images ? `, ${written.images} figure${written.images === 1 ? "" : "s"}` : ""}.`,
        "success",
        4000,
      );
    }
  } catch (err) {
    // Not fatal: the document exports without its outputs, which is what it
    // did before this existed.
    console.warn("[export] cell outputs could not be written:", err);
    showToast(`The cell outputs could not be written: ${err?.message ?? err}`, "warning", 8000);
  }

  // Noted before the command, to tell what it wrote from what was already
  // there; see `resolveExport`.
  const builtAt = Date.now();
  const res = await runMyst(`build ${q(file)} --${buildKind}`, dir);
  if (res.code !== 0) return reportFailure(`myst build --${buildKind}`, res);

  // Do not guess the name: myst slugifies it, and its exact rules are its own.
  // Try the expected slug, then fall back to the newest file of that type.
  const out = await resolveExport(`${dir}/${EXPORT_DIR}`, OUTPUT_EXTENSIONS[buildKind] ?? [buildKind], slugify(stemOf(path)), builtAt);
  if (!out) {
    showToast(
      `myst reported success but no ${(OUTPUT_EXTENSIONS[buildKind] ?? [buildKind]).map((e) => "." + e).join(" or ")} file was found in ${EXPORT_DIR}.`,
      "error",
      0,
    );
    return;
  }
  // Relative to the document's folder rather than just the file name: a LaTeX
  // export sits in a subfolder of its own, and saying "_build/exports/x.tex"
  // would send the user looking in the wrong place.
  const shown = out.startsWith(`${dir}/`) ? out.slice(dir.length + 1) : baseName(out);
  const post = buildKind === "tex" ? await postProcessTexFile(out, path) : null;

  if (kind === "pdf" && buildKind === "tex") {
    // Not always the file myst named: a split export is compiled from a main
    // trimmed to this document alone. See `postProcessTexFile`.
    const built = await compileTex(post?.compileFrom ?? out, {
      projectDir: dir,
      template: declaredTemplate(tab, "tex") ?? declaredTemplate(tab, "pdf"),
    });
    if (!built) return;
    // Renamed only where the name is not the document's doing: `index`, which
    // myst gives the project's index page, and the `-only` of a trimmed main.
    // Anywhere else myst's name is either the document's own or one the author
    // chose with `output:` in the frontmatter, and neither is ours to replace.
    const slug = slugify(stemOf(path));
    const stem = baseName(built).replace(/\.pdf$/i, "");
    const core = stem.replace(/-only$/, "");
    const wanted = `${core === "index" && slug !== "index" ? slug : core}.pdf`;
    const pdf = await publishPdf(built, `${dir}/${EXPORT_DIR}`, wanted === baseName(built) ? null : wanted);
    const pdfShown = pdf.startsWith(`${dir}/`) ? pdf.slice(dir.length + 1) : baseName(pdf);
    showToast(`Exported to ${pdfShown}`, "success", 6000);
    await openExported(pdf);
    return;
  }

  showToast(`Exported to ${shown}`, "success", 6000);

  // Open the result in whatever the system uses for it. Not for .tex, which is
  // usually an intermediate the user processes further rather than reads.
  if (kind !== "tex") await openExported(out);
}

/**
 * Put the PDF where the other exports are.
 *
 * A LaTeX export is a folder of its own -- the .tex, its images, its class
 * file -- and the PDF is produced in it, among the .aux, .fls and .fdb files
 * nobody wants to go looking through. Every other export lands directly in
 * _build/exports, so that is where this one is expected too.
 *
 * Copied rather than moved: latexmk decides what to redo by comparing its
 * output with the auxiliary files beside it, so taking the PDF away would make
 * every following build start from nothing. A copy that fails is not an error
 * either -- the PDF exists, it is simply one folder further down, and that is
 * what the toast then names.
 *
 * `name` renames the copy, and the caller passes one only where myst's name
 * says nothing about the document: `index`, which myst gives the project's
 * index page -- the first entry of the `toc` -- whatever the file is called,
 * so that asking for a PDF of `lesson-three.md` produced `index.pdf`. Every
 * other page, in the `toc` or not, is already named after itself, and a name
 * the author chose with `output:` in the frontmatter is theirs; neither is
 * ours to replace. The `.tex` keeps myst's name in every case -- it is myst's
 * file, and the rest of the chain finds it by that name.
 *
 * `myst build -o` would have renamed the export at the source and was tried
 * first: it silently drops the template declared in the frontmatter, with no
 * option to put it back, turning an arxiv_nips PDF into a plain_latex one
 * without a word.
 */
async function publishPdf(pdf, exportsDir, name) {
  const dest = `${exportsDir}/${name || baseName(pdf)}`;
  if (dest === pdf) return pdf;

  // Through the filesystem rather than through a shell. `cp` and `copy` differ
  // in their switches, in their quoting and in what they make of a path that
  // mixes separators -- ours do, being joined with "/" on a machine that
  // writes "\\" -- and a copy is one read and one write. Reading the bytes and
  // writing them back cannot be parsed wrongly by anything.
  try {
    const { readFile, writeFile } = await import("@tauri-apps/plugin-fs");
    await writeFile(dest, await readFile(pdf));
    return dest;
  } catch (err) {
    console.warn("[export] the PDF could not be copied to the exports folder:", err);
  }

  // Failing that -- a permission this build does not carry, most likely -- the
  // shell still knows how to copy a file. `/Y` answers the overwrite question
  // nobody is there to answer: without it a second export waits for ever on a
  // prompt whose output we never show. This line is cmd.exe's, which is what
  // the `windows-shell` scope runs; trying it in PowerShell proves nothing,
  // since `copy` is an alias of `Copy-Item` there and has no `/Y` at all.
  const res = await runShell(isWindows ? `copy /Y ${q(pdf)} ${q(dest)}` : `cp -f ${shq(pdf)} ${shq(dest)}`);
  if (res?.code !== 0) {
    console.warn("[export] the shell could not copy it either:", res?.stderr || res?.stdout);
    showToast(`The PDF was produced but could not be copied beside the other exports; it is in ${baseName(dirName(pdf))}.`, "warning", 8000);
    return pdf;
  }
  return dest;
}

/**
 * Rewrite the `.tex` mystmd just produced, in place.
 *
 * What mystmd writes is correct and plain: every admonition is the same grey
 * box with its kind dropped and no `\label`, the proof family's anchors are
 * lowercased while the references that point at them are not, and
 * environments run into one another on a single line. This repairs the three,
 * each in its own module, and refuses as a whole if the source and the `.tex`
 * cannot be matched -- rewriting in the wrong places is worse than not
 * rewriting.
 *
 * The source is read from disk rather than from the editor: that is the file
 * mystmd saw, and the document was saved before the build. Includes are
 * expanded the same way, since an `{include}` is one line in the source and a
 * whole file in the `.tex`.
 */
/**
 * The file holding this document's body, which is not always the file mystmd
 * named.
 *
 * A `.tex` export of a project with several articles is not one file: jtex
 * writes a main file carrying the preamble and `\begin{document}`, and one
 * part per article, pulled in with `\include{<export slug>-<article slug>}`.
 * The main file then holds no `framed` at all, which is exactly what the
 * pairing reported -- "the source has 10 admonition(s) and the .tex has 0" --
 * a correct refusal asked of the wrong file.
 *
 * The part is chosen by name rather than by content: its own slug is the
 * document's, slugified by the same rules as the export itself. Guessing from
 * the number of `framed` found would pick the wrong article the day two of
 * them hold as many.
 *
 * @returns {{body: string, main: string, parts: string[]}|null} null when the
 *   export is a single file, which is the ordinary case.
 */
function texParts(texPath, mainText, sourcePath) {
  const names = [...mainText.matchAll(/\\(?:include|input)\{([^}]+)\}/g)].map((m) => m[1].trim()).filter(Boolean);
  if (!names.length) return null;

  const dir = dirName(texPath);
  const slug = slugify(stemOf(sourcePath));
  const mainStem = baseName(texPath).replace(/\.tex$/i, "");
  // The document's own slug first, "index" only if that finds nothing: a
  // project's index page is slugged "index" by myst whatever the file is
  // called (see `resolveExport`), but a part genuinely named index must not
  // win over the part that carries this document's name.
  const tailOf = (n) => {
    const base = n
      .replace(/\.tex$/i, "")
      .split("/")
      .pop();
    return base.startsWith(`${mainStem}-`) ? base.slice(mainStem.length + 1) : base;
  };
  const own = names.find((n) => tailOf(n) === slug) ?? names.find((n) => tailOf(n) === "index");
  return {
    body: own ? `${dir}/${own.replace(/\.tex$/i, "")}.tex` : null,
    main: texPath,
    parts: names,
  };
}

async function postProcessTexFile(texPath, sourcePath) {
  const asIs = { compileFrom: texPath };
  if (config.export?.postProcessTex === false) return asIs;

  const { readTextFile, writeTextFile } = await import("@tauri-apps/plugin-fs");

  let source;
  try {
    source = await readTextFile(sourcePath);
  } catch (err) {
    console.warn("[export] could not read the source for post-processing:", err);
    return asIs;
  }

  // `expandIncludes` reads synchronously, so every included file is fetched
  // first: from the cache the editor fills while rendering, and from disk for
  // anything not there -- the export may run on a document opened a moment ago
  // and never scrolled through.
  const texts = new Map();
  const found = findIncludeBlocks(source);
  for (const block of found) {
    if (!block.path || block.literal || texts.has(block.path)) continue;
    const cached = includeCache.get(block.path);
    if (cached && !cached.error && typeof cached.text === "string") {
      texts.set(block.path, cached.text);
      continue;
    }
    try {
      // The same reader the include directive uses, rather than joining paths
      // here: it strips a leading "./" and resolves against the document's
      // folder, which is what the written path means.
      texts.set(block.path, await readTextRelative(block.path));
    } catch (err) {
      // Not fatal here: the pairing below will refuse rather than miscount.
      console.warn("[export] {include} could not be read for post-processing:", block.path, err);
    }
  }
  const expansion = expandIncludes(source, (p) => texts.get(p) ?? null);
  console.debug(
    "[export] post-processing:",
    `${found.length} include block(s) found`,
    `[${found.map((b) => b.path).join(", ")}]`,
    `${texts.size} read`,
    `expanded: ${expansion.expanded}`,
  );

  // Which file actually holds the body: see `texParts`.
  const main = await readTextFile(texPath);
  const split = texParts(texPath, main, sourcePath);
  if (split && !split.body) {
    const reason =
      `the export is split into ${split.parts.length} part(s) and none of them is named after this document ` +
      `(looked for "${slugify(stemOf(sourcePath))}" among ${split.parts.join(", ")})`;
    console.warn("[export] .tex left as mystmd wrote it:", reason);
    showToast(`The .tex was left as mystmd wrote it: ${reason}.`, "warning", 8000);
    return asIs;
  }
  const bodyPath = split ? split.body : texPath;
  if (split) {
    console.debug(`[export] multi-file export: body in ${baseName(bodyPath)}, preamble in ${baseName(texPath)}`);
  }

  const tex = split ? await readTextFile(bodyPath) : main;
  const blocks = framedBlocks(tex);
  // Whether {exercise} and {solution} occupy a rank depends on whether the
  // exercise plugin was in use for this build. Rather than require a setting,
  // try both readings and keep the one that verifies.
  const attempts = [true, false].map((withExercises) => {
    const { items } = scanAdmonitions(expansion.text, { withExercises });
    console.debug(`[export] scan with${withExercises ? "" : "out"} exercises: ${items.length} admonition(s)`);
    return pairAdmonitions(items, blocks);
  });
  const paired = attempts.find((a) => a.ok) ?? attempts[0];

  if (!paired.ok) {
    console.warn("[export] .tex left as mystmd wrote it:", paired.reason);
    showToast(`The .tex was left as mystmd wrote it: ${paired.reason}`, "warning", 8000);
    return asIs;
  }

  const styled = rewriteAdmonitions(tex, paired.pairs, { colors: config.export?.admonitionColors });
  for (const r of styled.rejected) {
    showToast(`export.admonitionColors -- not a six-digit hex colour, default kept: ${r}`, "warning", 8000);
  }

  const proof = repairProofLabels(styled.text, findProofLabels(expansion.text.split("\n")));
  await writeTextFile(bodyPath, separateEnvironments(proof.text));

  // In a multi-file export the body carries no preamble; the packages and the
  // box definitions have to go in the file that has `\begin{document}`.
  if (split && styled.preamble && !styled.preambleWritten) {
    const at = main.indexOf("\\begin{document}");
    if (at === -1) {
      showToast(
        `${baseName(texPath)} has no \\begin{document}: the boxes were styled but their definitions could not be ` +
          `added, so the LaTeX run will fail. Leave export.postProcessTex off for this project, or export one ` +
          `article at a time.`,
        "error",
        0,
      );
    } else {
      await writeTextFile(texPath, main.slice(0, at) + styled.preamble + main.slice(at));
    }
  }

  const parts = [`${styled.rewritten} admonition${styled.rewritten === 1 ? "" : "s"} styled`];
  if (styled.labelled) parts.push(`${styled.labelled} labelled`);
  if (proof.repaired) parts.push(`${proof.repaired} proof label${proof.repaired === 1 ? "" : "s"} restored`);
  // Said rather than left to be discovered: the other parts belong to other
  // documents of the project, whose sources this export never read.
  if (split && split.parts.length > 1) {
    parts.push(`in ${baseName(bodyPath)}; ${split.parts.length - 1} other part(s) left untouched`);
  }
  showToast(parts.join(", ") + ".", "success", 6000);

  // The PDF is the current document's, not the project's. A split main file
  // pulls in every article, so the one handed to LaTeX is a copy of it keeping
  // this document's part alone. The original is left untouched: it is what
  // mystmd produced, and someone may want the whole thing.
  if (!split) return asIs;
  const only = `${dirName(texPath)}/${baseName(texPath).replace(/\.tex$/i, "")}-only.tex`;
  const kept = split.body
    .replace(/\.tex$/i, "")
    .split("/")
    .pop();
  const trimmed = (await readTextFile(texPath)).replace(/\\(?:include|input)\{([^}]+)\}/g, (whole, name) =>
    name
      .trim()
      .replace(/\.tex$/i, "")
      .split("/")
      .pop() === kept
      ? whole
      : "",
  );
  try {
    await writeTextFile(only, trimmed);
    return { compileFrom: only };
  } catch (err) {
    // Not fatal, but the PDF will then hold the whole project rather than this
    // document, which is worth a word rather than a surprise.
    console.warn("[export] the trimmed main could not be written:", err);
    showToast(`${baseName(only)} could not be written; the PDF will hold every article of the project.`, "warning", 8000);
    return asIs;
  }
}

/**
 * The template the document asks for, from its own frontmatter or config.json.
 */
function declaredTemplate(tab, kind) {
  const entry = exportsOf(documentFrontmatter(editorText(tab))).find((e) => String(formatOf(e) ?? "").trim() === kind);
  const fromEntry = entry && typeof entry === "object" ? entry.template : null;
  return String(fromEntry || config.export?.templates?.[kind] || "").trim() || null;
}

/**
 * The LaTeX engine a template asks for, as jtex reads it.
 *
 * jtex takes it from the template's own `template.yml`:
 *
 *   const engine = templateYml?.build?.engine ?? '-xelatex';
 *
 * so hard-coding xelatex would quietly compile with the wrong engine for any
 * template that declares another. The file is not copied next to the export --
 * only the class and style files are -- so it is looked for where mystmd
 * downloads templates, under `_build/templates`. Not finding it is the common
 * case and not an error: the default is jtex's own.
 */
async function templateEngine(projectDir, template) {
  if (!template) return null;
  // `myst/elsarticle_myst` and `elsarticle_myst` name the same folder.
  const name = template.split("/").pop();
  const { exists, readTextFile, readDir } = await import("@tauri-apps/plugin-fs");
  const root = `${projectDir}/_build/templates`;
  if (!(await exists(root))) return null;

  const find = async (dir, depth) => {
    if (depth > 4) return null;
    let entries;
    try {
      entries = await readDir(dir);
    } catch {
      return null;
    }
    for (const e of entries) {
      if (!e.isDirectory) continue;
      if (e.name === name && (await exists(`${dir}/${e.name}/template.yml`))) return `${dir}/${e.name}/template.yml`;
      const deeper = await find(`${dir}/${e.name}`, depth + 1);
      if (deeper) return deeper;
    }
    return null;
  };

  const file = await find(root, 0);
  if (!file) return null;
  try {
    const { load } = await import("js-yaml");
    const engine = load(await readTextFile(file))?.build?.engine;
    return typeof engine === "string" && engine.trim() ? engine.trim() : null;
  } catch (err) {
    console.warn("[export] could not read the template's engine:", file, err);
    return null;
  }
}

/**
 * Run the LaTeX chain on a `.tex`, and return the PDF it produced.
 *
 * The command is jtex's own, so a document that built under mystmd builds
 * here the same way, and it is configurable because a document can need
 * another engine. It runs in the folder holding the `.tex`, which is where its
 * images, its bibliography and its class file are.
 *
 * @returns {Promise<string|null>} absolute path of the PDF, or null on failure
 */
async function compileTex(texPath, { projectDir, template } = {}) {
  const dir = dirName(texPath);
  const file = baseName(texPath);
  const command = config.export?.pdfCommand ?? "";
  if (!command.includes("{file}")) {
    showToast("export.pdfCommand must contain {file}; the PDF was not built.", "error", 0);
    return null;
  }

  // Look for the distribution before running it, not after failing: see
  // `ensureLatex`. It costs one shell loop, once per session.
  await ensureLatex();
  if (latexMissing) {
    showToast(
      `${latexProgram()} is not installed, or not on the PATH this application sees. Install a TeX distribution ` +
        `(MiKTeX or TeX Live on Windows, MacTeX or MacPorts on macOS, texlive-full on Linux), or set ` +
        `export.pdfViaTex to false to let mystmd build the PDF itself, unstyled. The .tex is ready either way.`,
      "error",
      0,
    );
    return null;
  }

  const engine = (await templateEngine(projectDir, template)) ?? "-xelatex";
  showToast(`Compiling ${file}\u2026`, "success", 4000);
  const line = command.replace("{engine}", engine).replace("{file}", q(file));
  console.debug("[export] latex:", latexPrefix() + line);
  const startedAt = Date.now();
  const res = await runShell(isWindows ? line : `cd ${shq(dir)} && ${latexPrefix()}${line}`, dir);

  // Only the shell's own verdict counts here. `notFound()` has a textual
  // fallback written for myst, and `! LaTeX Error: File \`tcolorbox.sty\' not
  // found.` matches it word for word -- which is how a missing LaTeX *package*
  // came to be reported as a missing LaTeX *installation*.
  if (res?.code === 127 || res?.code === 9009) {
    // The exit code and the first line it printed are named: a shell that
    // cannot find a command and a LaTeX run that failed early look alike from
    // here, and telling someone to install a tool they already have is the
    // worst of the two mistakes.
    const first =
      String(res?.stderr || res?.stdout || "")
        .trim()
        .split("\n")[0] ?? "";
    showToast(
      `${latexProgram()} could not be run [exit ${res?.code}]${first ? `: ${first}` : ""}, and it is in none of ` +
        `the places a TeX distribution usually installs. Check it with \`sh -lc 'command -v ${latexProgram()}'\`: ` +
        `if it answers, put that path in export.latexPath in config.json -- a desktop application does not inherit ` +
        `a terminal's PATH. Set export.pdfViaTex to false to let mystmd build the PDF itself, unstyled.`,
      "error",
      0,
    );
    return null;
  }

  const pdf = `${dir}/${file.replace(/\.tex$/i, "")}.pdf`;
  const { exists } = await import("@tauri-apps/plugin-fs");
  if (await exists(pdf)) {
    // latexmk returns non-zero on warnings it was told to ignore (`-f`), so
    // the file on disk is what says whether it worked, not the exit code.
    if (res.code !== 0) showToast("The LaTeX run reported problems; the PDF was produced anyway.", "warning", 8000);
    return pdf;
  }

  await reportLatexFailure(dir, file, res, startedAt);
  return null;
}

/**
 * Say why LaTeX stopped, from its own log.
 *
 * In `batchmode` nothing useful reaches the console: the errors are written to
 * `<name>.log`, each on a line starting with `!`, and the line that follows
 * usually names the file and the line number. Reporting the tail of stderr
 * instead, as the myst commands do, says only that something failed.
 */
async function reportLatexFailure(dir, file, res, startedAt = 0) {
  const stem = file.replace(/\.tex$/i, "");
  let detail = "";
  try {
    const { readTextFile, exists, stat } = await import("@tauri-apps/plugin-fs");
    const logPath = `${dir}/${stem}.log`;
    // Only a log this run wrote may be quoted. A `.log` left by an earlier,
    // successful build sits in the same folder and outlives everything, and
    // reading it is how a LaTeX chain that never started came to be reported
    // as a LaTeX chain that stopped on someone else's old warning.
    const fresh = (await exists(logPath)) && ((await stat(logPath))?.mtime?.getTime?.() ?? 0) >= startedAt;
    if (fresh) {
      const lines = (await readTextFile(logPath)).split("\n");
      const at = lines.findIndex((l) => l.startsWith("!"));
      if (at !== -1) detail = [lines[at], lines[at + 1]].filter(Boolean).join(" ").trim().slice(0, 220);
    }
  } catch (err) {
    console.warn("[export] the LaTeX log could not be read:", err);
  }
  console.error("[export] LaTeX failed:", res?.code, res?.stdout, res?.stderr);
  showToast(
    detail
      ? `LaTeX stopped: ${detail} The full log is ${stem}.log, beside the .tex.`
      : `LaTeX stopped (exit ${res?.code}) without saying why, and wrote no log for this run. ` +
          `The .tex is there; running ${latexProgram()} on it in a terminal will show the error.`,
    "error",
    0,
  );
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
async function resolveExport(dir, exts, slug, since = 0) {
  const { exists, readDir, stat } = await import("@tauri-apps/plugin-fs");
  const suffixes = exts.map((e) => `.${e}`);
  // Only what this build wrote may be returned. Everything below used to end
  // in "the newest file of the right type", which is how the export of another
  // document, left in the folder by an earlier run, came to be post-processed,
  // copied and opened in place of the one asked for -- a document the user had
  // never even opened. A file older than the command that was supposed to
  // produce it is not that command's output, whatever its name.
  const fresh = (t) => t != null && t + 1000 >= since;

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
    if (!fresh(t)) return;
    if (!newest || t > newest.when) newest = { full, when: t };
  };

  // The expected names first. LaTeX is the odd one out: myst does not drop a
  // .tex beside the other exports, it writes a folder of its own holding the
  // file and the images it refers to -- "small-demo_tex/small-demo.tex". Looking
  // only beside the exports, we declared the export missing although it had just
  // been produced.
  // "index" is the second expected name, not a guess: myst names an export
  // after the page's slug, and the slug of a project's index page -- its first
  // toc entry -- is "index" whatever the file is called. Building the first
  // file of a two-file project therefore produces index_tex/index.tex, and
  // looking only for <document>.tex found nothing and fell through to the
  // search below, which returned another document's export.
  for (const name of [slug, "index"]) {
    for (const ext of exts) {
      if (await exists(`${dir}/${name}.${ext}`)) await consider(`${dir}/${name}.${ext}`);
      const sub = `${dir}/${name}_${ext}/${name}.${ext}`;
      if (await exists(sub)) await consider(sub);
    }
    if (newest) return newest.full;
  }

  // Failing that, look through the exports folder and one level under it, which
  // is as deep as myst goes. The name myst chose is its own -- it slugifies --
  // so the most recent file of the right type wins, among those this build
  // actually wrote.
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
      } catch {
        /* an unreadable subfolder is not a reason to give up on the rest */
      }
    }
    return newest?.full ?? null;
  } catch (err) {
    console.warn("[export] could not list", dir, err);
    return null;
  }
}

/** The CSSOM sheets of the <style> elements under a node. */
const styleElementSheets = (node) => [...(node?.querySelectorAll?.("style") ?? [])].map((el) => el.sheet).filter(Boolean);

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
 * The custom properties the collected CSS uses, with the values in force.
 *
 * The palette -- `--green-500`, `--border-2` and the rest -- is declared on
 * `MystCSSVars`, a styled.div, so it lives on a class styled-components
 * generates (`.iOuiuE` one day, something else the next build). The exported
 * page wraps its content in `#myst-css-namespace` and carries no such class,
 * so every `var(--green-500)` resolved to nothing: `border: var(--border-2)
 * solid var(--green-500)` is simply invalid, and the admonitions came out
 * without border or colour.
 *
 * Chasing that generated name would mean depending on a build artefact. The
 * values in force are read from the live preview instead and written out
 * explicitly: whatever declares them, and whichever theme is on, what the
 * page gets is what was on screen. That is what an export of a rendering is.
 *
 * The names are taken from the collected CSS rather than enumerated from the
 * computed style, which browsers do not all expose the same way.
 */
function resolvedCustomProperties(css, element) {
  const names = new Set(String(css).match(/--[A-Za-z0-9_-]+(?=\s*:)/g) ?? []);
  if (!names.size || typeof getComputedStyle !== "function") return "";
  const computed = getComputedStyle(element);
  const parts = [];
  for (const name of names) {
    const value = computed.getPropertyValue(name).trim();
    if (value) parts.push(`  ${name}: ${value};`);
  }
  return parts.length ? `#myst-css-namespace {\n${parts.join("\n")}\n}\n` : "";
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
  const collected = [
    cssTextOf(document.adoptedStyleSheets),
    cssTextOf(root.adoptedStyleSheets),
    cssTextOf(styleElementSheets(root)),
    cssTextOf(styleElementSheets(document.head)),
  ].join("\n");
  // The variables last, so they win over the declarations they were read from.
  const css = [collected, EXPORT_BASE_CSS, resolvedCustomProperties(collected, preview)].join("\n");
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

  // The third place that reads the disk, after an export and a site start, and
  // it would be a version behind for the same reason. `create` is left off:
  // a whole-project build is not the moment to give a folder a manifest it
  // never had -- an export or a site start will, and both are about this
  // document.
  if (flushCellEdits(tab)) await new Promise((r) => requestAnimationFrame(r));
  await ensureProjectPlugins(dir, { declare: false });
  await refreshPyodideOutputs(tab);
  try {
    if ((await tab?.saveCurrentDoc?.()) === false) {
      showToast("The document was not saved; the build will use the version on disk.", "warning", 8000);
    }
  } catch (err) {
    console.warn("[export] the document could not be saved before building:", err);
  }

  showToast("Running myst build…", "success", 4000);
  const res = await runMyst("build", dir);
  if (res.code !== 0) return reportFailure("myst build", res);
  showToast("myst build finished.", "success", 5000);
}

// --- myst start -------------------------------------------------------------

let siteChild = null;
let sitePortInUse = null;
/** The folder the running server was started in; a site serves one project. */
let siteDir = null;
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

  // The site is built from the files on disk, and what is on disk is the last
  // save -- so a cell re-run since then would come out a version behind, from
  // the first page the site ever shows. The follow-up that keeps them in step
  // only arms itself once the site is running, which leaves exactly this gap.
  // `create` because this may be the first site this folder has ever served,
  // and `siteRunning()` is still false here, so the save's own refresh would
  // decline to make a manifest.
  if (flushCellEdits(tab)) await new Promise((r) => requestAnimationFrame(r));
  // A project carries its own copy of the plugins; keep it in step with the
  // application, or a correction made here would never reach a project set up
  // before it. Files only -- `declare: false` writes nothing into myst.yml.
  await ensureProjectPlugins(dir, { declare: false });
  await refreshPyodideOutputs(tab, { create: true });
  try {
    if ((await tab?.saveCurrentDoc?.()) === false) {
      showToast("The document was not saved, so the site will show the version on disk.", "warning", 8000);
    }
  } catch (err) {
    console.warn("[export] the document could not be saved before starting the site:", err);
  }

  // `myst start` is spawned, not executed, so it cannot probe after the fact:
  // look for the command first when nothing has told us where it is.
  if (!configuredMyst() && !probedMystPath) {
    const found = await probeMyst();
    if (found) {
      probedMystPath = found;
      await saveConfigValue("export.mystPath", found);
    }
  }
  // `start` is spawned, not executed, so nothing can retry it after the fact:
  // the interpreter has to be settled before the server is launched -- which
  // is also the one place worth paying for a check that it is still there.
  if (!(await nodeUsable())) await refreshNode();
  await ensureNode();

  const { Command } = await import("@tauri-apps/plugin-shell");
  // `exec` replaces the shell with myst itself, so kill() reaches the server
  // rather than a wrapper that would leave it orphaned. cmd.exe has no such
  // verb: there the server is a grandchild, and stopping it kills the shell
  // first -- to be checked on Windows.
  const ports = `--port ${port} --server-port ${siteContentPort()}`;
  const line = isWindows
    ? `${mystInvocation()} start ${ports}`
    : `cd ${shq(dir)} && ${pathPrefix(mystCmd())}exec ${mystInvocation()} start ${ports} < /dev/null`;
  console.log("[export] sh -lc", line);
  // Through a script of its own on Windows, for the same two reasons as every
  // other command: quoting that survives, and UTF-8 output -- this one's is
  // read line by line to find the address myst listens on, and a byte that
  // does not decode would take the whole stream with it.
  const winArg = isWindows ? await windowsScript(line, "mystral-site.bat").catch(() => null) : null;
  const [scope, args] = isWindows ? [WINDOWS_SHELL, ["/d", "/s", "/c", winArg ?? `chcp 65001>nul & ${line}`]] : [LOGIN_SHELL, ["-lc", line]];
  const cmd = Command.create(scope, args, { cwd: dir, env: MYST_ENV });
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
    siteDir = dir;
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
    showToast(`The MyST site has not announced itself yet. If it is up, open ${siteUrl()} yourself.`, "warning", 0);
  }, timeoutMs);

  openSiteWhenReady = (line) => {
    if (SITE_READY_RE.test(String(line))) open();
  };

  return () => {
    done = true;
    clearTimeout(timer);
  };
}

/**
 * Free the two ports `myst start` was using.
 *
 * `kill()` reaches the process we started and no further: `myst start` runs
 * its application and content servers as children of its own, and those went
 * on holding their ports after every stop. The next run then moved to 3001 and
 * 3101, the one after to 3002 and 3102, and so on for the session.
 *
 * Windows has the straight answer -- `taskkill /T` kills the tree -- so the
 * recorded pid is enough there. On POSIX the equivalent would be killing the
 * process group, which is the application's own group and therefore the
 * application: what is freed instead is precisely the ports that were asked
 * for, and only just after stopping the server that was asked to use them.
 */
async function freeSitePorts(pid) {
  const ports = [sitePortInUse ?? sitePort(), siteContentPort()];
  const line = isWindows
    ? pid
      ? `taskkill /F /T /PID ${pid}`
      : null
    : `for p in ${ports.join(" ")}; do pids=$(lsof -ti tcp:$p -sTCP:LISTEN 2>/dev/null); [ -n "$pids" ] && kill $pids; done; exit 0`;
  if (!line) return;
  const res = await runShell(line);
  if (res?.code !== 0) console.warn("[export] the site's ports may still be held:", res?.stderr || res?.stdout);
}

/**
 * Push what the cells hold now to the running site.
 *
 * The site is rebuilt when the document changes, and the cell outputs live in
 * a manifest beside it, so a cell re-executed without the document being saved
 * leaves the site showing the previous run -- or, when the cell's code was
 * edited, nothing at all: the manifest is keyed by the code, and the old entry
 * is no longer claimed by anything.
 *
 * Saving refreshes the manifest on its own; this is for the case where there
 * is nothing to save. The document is rewritten with the content it already
 * has, which changes nothing but its mtime, and that is what the watcher is
 * waiting for -- writing the manifest alone would not reach it, `_build` being
 * myst's own output folder and not something it watches.
 */
/**
 * Push a cell's pending edit down into the document before anything reads it.
 *
 * A cell's editor writes back to the document on blur, or when the cell is
 * run, inserted or deleted -- never on every keystroke, which would re-render
 * the preview under the cursor. So while the caret is still in a cell, the
 * document does not hold what the cell shows, and saving writes the version
 * from before the edit: the manifest, which reads the cell itself, then keys
 * an output on code the document does not have, and the figure disappears.
 *
 * Blurring is the editor's own way of saying it: the handler that writes back
 * is on blur, so there is nothing else to call and nothing to duplicate.
 */
function flushCellEdits(tab) {
  const root = (tab?.editorId && document.getElementById(tab.editorId)?.shadowRoot) || null;
  const active = root?.activeElement;
  const cell = active?.closest?.(".pyodide-editor");
  if (!cell) return false;
  active.blur?.();
  return true;
}

/**
 * The page of the running site that shows this document, or "".
 *
 * Empty whenever there is nothing to point at -- no server, or a server
 * serving another project -- which is what the editor reads to decide whether
 * the site view exists at all. Better an absent button than one leading to
 * somebody else's document.
 *
 * The index page is the exception that cost an evening elsewhere: myst gives
 * the first entry of the `toc` the slug `index` and serves it at the root,
 * whatever the file is called. The toc is read rather than guessed, since
 * guessing is what went wrong before.
 */
export async function sitePageUrl(tab) {
  const path = tab?.currentFileHandle;
  if (!siteChild || typeof path !== "string" || !path) return "";
  const dir = projectDir(tab);
  if (!dir || (siteDir && dir !== siteDir)) return "";

  const base = `http://localhost:${sitePortInUse ?? sitePort()}`;
  try {
    const { readTextFile, exists } = await import("@tauri-apps/plugin-fs");
    const ymlPath = `${dir}/myst.yml`;
    if (await exists(ymlPath)) {
      const first = /^\s*-\s*file:\s*(.+?)\s*$/m.exec(await readTextFile(ymlPath));
      if (first && baseName(first[1]) === baseName(path)) return `${base}/`;
    }
  } catch (err) {
    console.warn("[export] the project's toc could not be read:", err);
  }
  return `${base}/${slugify(stemOf(path))}`;
}

export async function stopSite() {
  if (!siteChild) return;
  siteStopping = true;
  cancelSiteOpener();
  const pid = siteChild.pid;
  try {
    await siteChild.kill();
  } catch (err) {
    console.warn("[export] could not stop the site:", err);
  }
  siteChild = null;
  await freeSitePorts(pid);
  sitePortInUse = null;
  siteDir = null;
  showToast("MyST site stopped.", "success", 4000);
}

// A spawned server outlives the page, so make sure a reload or a quit does not
// leave it running with the port taken.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    siteChild?.kill?.();
  });
}
