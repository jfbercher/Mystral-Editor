/**
 * Reading a git repository, for the editor's own use.
 *
 * Phase one: nothing here writes. It answers three questions -- which branch,
 * what has changed, and what a file looked like at a revision -- and that is
 * all the first screens need.
 *
 * Two rules shape every call, and both were established by measurement rather
 * than by reasoning (see BACKLOG.md, point 36).
 *
 * **No path ever reaches the shell.** The command line goes through `sh -lc`,
 * where a file named `abc'def.md` would end the argument early, and through a
 * `.bat` under Windows, where no quoting of ours survives at all. So the
 * repository is named by `GIT_DIR` and `GIT_WORK_TREE` in the environment --
 * verified to work from an unrelated working directory, which also disposes of
 * the login-shell profile that can move `cwd` out from under a command -- and a
 * file is named by the 40 hexadecimal characters of its blob, read from
 * `ls-tree`. `git -C <dir>`, `git show HEAD:<path>` and `cd <dir> &&` all put a
 * path on the line; none of them is used.
 *
 * **Every machine-readable output is asked for with `-z`.** Without it git
 * quotes anything outside ASCII in C octal escapes -- `"E\314\201toile.md"` --
 * in a form that depends on `core.quotePath` and would need a decoder of its
 * own. With it the bytes come through as they are.
 */

import { isWindows, parentDir } from "./fs.js";
import { runShell } from "./shell.js";

/**
 * A path normalised for *comparison only*.
 *
 * The same file is spelled differently on either side of git under macOS: the
 * filesystem holds `Étoile.md` decomposed (`E` + U+0301) while git, built with
 * `core.precomposeUnicode`, reports it composed. Measured on both: `ls` gives
 * `EM-LM-^Atoile.md`, `git status` gives `M-CM-^Itoile.md`.
 *
 * So anything used as a key -- a `Map`, a `Set`, an equality test -- is
 * normalised. Nothing else is: under Linux the filesystem distinguishes the two
 * forms, a file named in NFD *is* named in NFD, and opening its composed
 * spelling would name a file that does not exist. macOS is indifferent and
 * would never report the mistake, which is exactly why the rule is written here.
 */
export const nfc = (s) => String(s ?? "").normalize("NFC");

/** What the editor offers to commit. Everything else it writes stays out. */
const COMMITTABLE = /\.(md|markdown|py|ipynb|ya?ml|png|jpe?g|gif|svg|webp|pdf|bib|csv)$/i;

/**
 * The generated files the editor puts beside a document: a sidecar holding cell
 * outputs, the build folders, the plugins it installs. They are derived from
 * the document and from the application's version, so they belong to neither.
 */
const GENERATED = /(^|\/)(_build|myst-plugins|node_modules)\/|\.myst\.cache\.json$|(^|\/)\.[^/]+$/;

export const isCommittable = (path) => COMMITTABLE.test(path) && !GENERATED.test(path);

/**
 * What can be shown as a diff.
 *
 * `blob()` hands back decoded text, which is right for a document and nonsense
 * for a PNG: the bytes would come back through a UTF-8 decoder with every
 * invalid sequence replaced. An image belongs in a commit all the same, so it
 * is offered -- it is only its *contents* that are not asked for.
 */
export const isTextual = (path) => /\.(md|markdown|py|ipynb|ya?ml|bib|csv|svg)$/i.test(path);

/**
 * The repository a directory belongs to, or null.
 *
 * Walked here rather than asked of git, because asking would mean naming the
 * directory on a command line before we have anywhere safe to put it. `exists`
 * takes a string and spawns nothing.
 *
 * `.git` is a directory in an ordinary clone and a file in a worktree or a
 * submodule, where it holds `gitdir: <path>` -- relative to the file's own
 * folder when it is relative.
 */
export async function findRepo(dir) {
  if (!dir) return null;
  const { exists, readTextFile } = await import("@tauri-apps/plugin-fs");
  const sep = isWindows ? "\\" : "/";
  let here = String(dir);
  // A repository at the root of a drive still terminates: parentDir() returns
  // "" there, which ends the walk.
  for (let guard = 0; here && guard < 64; guard++, here = parentDir(here)) {
    const dot = `${here}${sep}.git`;
    let there = false;
    try {
      there = await exists(dot);
    } catch (err) {
      // Not "no": a scope refusing the path. `$HOME/**` does not match a
      // segment beginning with a dot, so `.git` was forbidden and this walk
      // reported, in perfect good faith, that the folder was not a repository.
      // The same dot has now cost us `.complete`, `.local` and this one. Said
      // out loud rather than swallowed: a refusal that passes for an answer is
      // the expensive kind.
      console.warn("[git] cannot look at", dot, "--", err?.message ?? err);
      throw new Error(`the application is not allowed to read ${dot}`);
    }
    if (!there) continue;
    let gitDir = dot;
    try {
      const text = await readTextFile(dot);
      const named = text.match(/^gitdir:\s*(.+?)\s*$/m);
      if (named) {
        const target = named[1];
        const absolute = /^([A-Za-z]:[\\/]|[\\/]|~)/.test(target);
        gitDir = absolute ? target : `${here}${sep}${target}`;
      }
    } catch {
      /* a directory, which readTextFile refuses: the ordinary case */
    }
    return { root: here, gitDir };
  }
  return null;
}

/** Run a git command in `repo`, with the repository named by the environment. */
async function git(repo, line) {
  return runShell(`git --no-optional-locks ${line}`, repo.root, {
    GIT_DIR: repo.gitDir,
    GIT_WORK_TREE: repo.root,
    // Asked for in English so the parsing never depends on the user's locale.
    // The porcelain formats are stable, but what git says *around* them is not.
    LC_ALL: "C",
  });
}

let available = null;

/** Whether git can be run at all. Asked once per session, like node's path. */
export async function gitAvailable() {
  if (available !== null) return available;
  const out = await runShell("git --version");
  available = out.code === 0 && /git version/i.test(out.stdout);
  if (!available) console.warn("[git] not available:", out.stdout || out.stderr);
  return available;
}

/** The current branch, or null when the head is detached. */
export async function branch(repo) {
  const out = await git(repo, "branch --show-current");
  if (out.code !== 0) return null;
  return out.stdout.trim() || null;
}

/** The fields of one `-z` record, as git wrote them. */
const FIELDS = {
  // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
  ordinary: 8,
  // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>  + a second record
  // holding the original path -- which is why this parser walks records rather
  // than splitting on NUL and reading positions.
  renamed: 9,
};

/**
 * What differs from `HEAD`, as `{ path, staged, unstaged, untracked }`.
 *
 * `staged` and `unstaged` are the two halves of git's `XY`: the first says what
 * the index holds that `HEAD` does not, the second what the file on disk holds
 * that the index does not. An editor needs both, since it is the second that
 * tells the author there is work not yet recorded anywhere.
 */
export async function status(repo) {
  const out = await git(repo, "status --porcelain=v2 -z --untracked-files=normal");
  if (out.code !== 0) throw new Error(out.stderr.trim() || `git status failed (${out.code})`);
  return parseStatus(out.stdout);
}

/**
 * The parser of the above, separated so that it can be run on a recorded
 * output without a repository, a shell or Tauri underneath it.
 */
export function parseStatus(text) {
  const records = String(text).split("\0");
  const entries = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;
    const kind = record[0];
    if (kind === "?" || kind === "!") {
      if (kind === "?") entries.push({ path: record.slice(2), staged: ".", unstaged: "?", untracked: true });
      continue;
    }
    if (kind !== "1" && kind !== "2" && kind !== "u") continue;
    const count = kind === "2" ? FIELDS.renamed : kind === "u" ? 10 : FIELDS.ordinary;
    // The path is the rest of the record after `count` space-separated fields,
    // and may itself hold spaces.
    const parts = record.split(" ");
    const path = parts.slice(count).join(" ");
    const xy = parts[1] ?? "..";
    entries.push({ path, staged: xy[0], unstaged: xy[1], untracked: false, unmerged: kind === "u" });
    // A rename writes its original path as a record of its own; stepping over
    // it is what keeps every later record aligned.
    if (kind === "2") i++;
  }
  return entries;
}

/**
 * Every file of a revision, as `nfc(path) -> { path, sha }`.
 *
 * The blob id is what makes the next call safe: a file is then read by forty
 * hexadecimal characters rather than by a name that would have to be quoted.
 */
export async function treeAt(repo, ref = "HEAD") {
  const out = await git(repo, `ls-tree -r -z ${ref}`);
  if (out.code !== 0) throw new Error(out.stderr.trim() || `git ls-tree failed (${out.code})`);
  const tree = new Map();
  for (const record of out.stdout.split("\0")) {
    if (!record) continue;
    // `<mode> <type> <sha>\t<path>` -- a tab, which no part before it contains.
    const tab = record.indexOf("\t");
    if (tab === -1) continue;
    const [, type, sha] = record.slice(0, tab).split(/\s+/);
    if (type !== "blob") continue;
    const path = record.slice(tab + 1);
    tree.set(nfc(path), { path, sha });
  }
  return tree;
}

/** The contents of a blob, by its id. */
export async function blob(repo, sha) {
  if (!/^[0-9a-f]{7,64}$/.test(sha)) throw new Error(`not an object id: ${sha}`);
  const out = await git(repo, `cat-file blob ${sha}`);
  if (out.code !== 0) throw new Error(out.stderr.trim() || `git cat-file failed (${out.code})`);
  return out.stdout;
}

/**
 * A file of the working tree, as it stands on disk.
 *
 * Read with the path git gave us, not a normalised copy of it: macOS opens
 * either spelling, Linux opens only the one that is really there. See `nfc`.
 */
export async function workText(repo, path) {
  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  const sep = isWindows ? "\\" : "/";
  return readTextFile(`${repo.root}${sep}${path}`);
}

/**
 * What the editor would offer to commit: the committable entries of `status`,
 * each with its contents at `HEAD` when it has one.
 *
 * One `ls-tree` for the whole revision rather than one lookup per file: a
 * repository of documents is small, and a single call cannot half-fail.
 */
export async function changes(repo) {
  const entries = (await status(repo)).filter((e) => isCommittable(e.path));
  if (!entries.length) return [];
  const tree = await treeAt(repo, "HEAD").catch(() => new Map());
  return Promise.all(
    entries.map(async (entry) => {
      const found = isTextual(entry.path) ? tree.get(nfc(entry.path)) : null;
      // null means two different things, and the caller needs both: a file that
      // `HEAD` does not have, and a file whose contents are not text. `tracked`
      // separates them.
      return { ...entry, tracked: tree.has(nfc(entry.path)), headText: found ? await blob(repo, found.sha) : null };
    }),
  );
}
