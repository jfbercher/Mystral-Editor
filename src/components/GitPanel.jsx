/**
 * The editor's git screen: what the repository holds that the document does
 * not, and nothing else yet.
 *
 * Read-only on purpose. Nothing here stages, commits or touches the working
 * tree; the whole surface is a list and a diff. What it does establish is the
 * seam -- the panel asks `gitBackend.js`, the dialog shows what it returns --
 * so that committing is later a matter of adding a button rather than of
 * rearranging this.
 *
 * Why the dialog is not inside the panel: the dropdown mounts on hover and is
 * destroyed when the pointer leaves it, which would take an open dialog with
 * it. So the panel only *asks* for a diff, through a signal, and `GitModal`
 * sits beside `ErrorModal` in the editor itself, where nothing unmounts it.
 */

import { computed, signal } from "@preact/signals";
import { h } from "preact";
import { useContext, useEffect, useState } from "preact/hooks";
import styled from "styled-components";
import { MystState } from "../mystState";
import CommitModal from "../myst-git/CommitModal";
import { currentFileDir, workingDirectory, isTauri } from "../utils/local_utils/fs.js";
import {
  changes,
  findRepo,
  gitAvailable,
  branch as currentBranch,
  workText,
  stage,
  commit,
  isTextual,
  lf,
  aheadBehind,
  upstream,
  push,
} from "../utils/local_utils/gitBackend.js";
import { showToast } from "../utils/utils_ui.js";

/** The last thing we learned about the repository, for the button's tooltip. */
const repoState = signal(null);

/**
 * A diff the panel has asked for, carrying the editor that asked.
 *
 * Every open editor mounts a `GitModal`, and they all see this signal; the
 * owner is what keeps two documents from both answering, the way the cell
 * events already do.
 */
const diffRequest = signal(null);

/** What the git button says on hover. The branch and the count, nothing more. */
export const gitTooltip = computed(() => {
  const state = repoState.value;
  if (!state) return "Git";
  if (!state.available) return "Git — git was not found on this machine";
  if (!state.repo) return "Git — this folder is not a repository";
  const where = state.branch ?? "detached HEAD";
  if (state.error) return `Git — ${where} — ${state.error}`;
  const ahead = state.counts?.ahead ? ` · ${state.counts.ahead} to push` : "";
  return `${where} · ${state.count} file${state.count === 1 ? "" : "s"} changed${ahead}`;
});

/**
 * Write every tab that has unsaved work, and wait for it.
 *
 * git reads the files on disk. Without this a document the author has just
 * edited, and is looking at in the diff, would be committed as it was before --
 * which is the one failure nobody would think to check for.
 */
async function saveEverything() {
  const detail = { promises: [] };
  document.dispatchEvent(new CustomEvent("mystral-save-dirty", { detail }));
  await Promise.all(detail.promises);
}

/** The project directory, which is where a repository is looked for. */
const projectDir = () => currentFileDir.value || workingDirectory.value || null;

/**
 * Ask git where things stand.
 *
 * Cheap enough to run on opening the panel and on coming back to the window,
 * which is when the answer can have changed. Not polled: the editor writes a
 * sidecar beside the document often enough that a timer would mostly be
 * measuring its own noise.
 */
export async function refreshRepoState() {
  if (!isTauri) return;
  try {
    if (!(await gitAvailable())) return (repoState.value = { available: false });
    const repo = await findRepo(projectDir());
    if (!repo) return (repoState.value = { available: true, repo: null });
    const [branch, entries, tracking, counts] = await Promise.all([
      currentBranch(repo),
      changes(repo),
      upstream(repo),
      aheadBehind(repo),
    ]);
    repoState.value = { available: true, repo, branch, entries, count: entries.length, tracking, counts };
  } catch (err) {
    console.warn("[git]", err);
    repoState.value = { ...(repoState.peek() ?? { available: true }), error: String(err?.message ?? err) };
  }
}

if (typeof window !== "undefined") window.addEventListener("focus", () => refreshRepoState());

const PanelList = styled.div`
  width: 280px;

  h1 {
    font-size: 15px;
    margin: 0 0 4px;
  }

  .branch {
    font-size: 12px;
    color: var(--icon-color);
    margin-bottom: 10px;
    word-break: break-all;
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 320px;
    overflow-y: auto;
    scrollbar-width: thin;
  }

  li button {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    text-align: left;
    padding: 4px 6px;
    border: 1px solid transparent;
    border-radius: var(--border-radius);
    background: transparent;
    font: inherit;
    font-size: 13px;
    color: inherit;
    cursor: pointer;
  }

  li button:hover {
    border-color: var(--border);
    background-color: var(--button-bg);
  }

  /* Two columns of git's XY, in a fixed-width cell so the names line up. */
  .flags {
    font-family: monospace;
    font-size: 12px;
    flex: 0 0 auto;
    color: var(--icon-color);
  }

  .name {
    overflow-wrap: anywhere;
  }

  p {
    font-size: 12px;
    color: var(--icon-color);
    margin: 6px 0 0;
  }

  button.commit {
    margin-top: 10px;
    width: 100%;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    background-color: var(--button-bg);
    color: inherit;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  button.commit:hover:not(:disabled) {
    border-color: var(--accent);
  }

  button.commit:disabled {
    opacity: 0.6;
    cursor: progress;
  }
`;

/** `XY` as git prints it, with an untracked file shown as `??`. */
const flagsOf = (entry) => (entry.untracked ? "??" : `${entry.staged}${entry.unstaged}`);

/** A commit the panel has asked for: the same signal, with every file in it. */
const openCommit = async (owner) => {
  await saveEverything();
  await refreshRepoState();
  const state = repoState.peek();
  if (!state?.repo) return;
  const entries = state.entries ?? [];
  if (!entries.length) return showToast("Nothing to commit.", "success", 4000);
  const documents = await Promise.all(
    entries.map(async (entry) => {
      // An image belongs in the commit; its bytes do not belong in a diff. Read
      // as text they came out as a screenful of replacement characters, which
      // is what a GIF looks like through a UTF-8 decoder.
      if (!isTextual(entry.path)) return { file: entry.path, binary: true, text: "", initialText: "" };
      return {
        file: entry.path,
        // Both sides through `lf`: on Windows the working file has CRLF and the
        // blob has LF, and comparing them as they stand marks every line of
        // every document as changed.
        text: lf(await workText(state.repo, entry.path).catch(() => "")),
        initialText: lf(entry.headText ?? ""),
      };
    }),
  );
  diffRequest.value = {
    owner,
    commit: true,
    repo: state.repo,
    documents,
    summary: `Update ${entries.map((e) => e.path).join(", ")}`,
  };
};

const GitPanel = () => {
  const { options } = useContext(MystState);
  const [busy, setBusy] = useState(true);
  const [pushing, setPushing] = useState(false);

  const doPush = async () => {
    setPushing(true);
    try {
      const line = await push(repoState.peek().repo);
      showToast(line || "Pushed.", "success", 6000);
    } catch (err) {
      // Left open: a push that failed is something to read, not to glimpse.
      // The message is git's own -- a refused key, an upstream that has moved
      // on -- and it is what tells the author whether to retry here or to go
      // to their terminal.
      showToast(`Push failed: ${err?.message ?? err}`, "error", 0);
    } finally {
      setPushing(false);
      await refreshRepoState();
    }
  };

  useEffect(() => {
    let alive = true;
    refreshRepoState().finally(() => alive && setBusy(false));
    return () => (alive = false);
  }, []);

  const state = repoState.value;

  const openDiff = async (entry) => {
    try {
      const binary = !isTextual(entry.path);
      const text = binary ? "" : lf(await workText(state.repo, entry.path));
      diffRequest.value = {
        owner: options.id.value,
        documents: [{ file: entry.path, binary, text, initialText: lf(entry.headText ?? "") }],
      };
    } catch (err) {
      console.warn("[git] could not read", entry.path, err);
    }
  };

  return (
    <PanelList>
      <h1>Git</h1>
      {busy && !state ? (
        <p>Reading the repository…</p>
      ) : !state?.available ? (
        <p>git was not found on this machine. The editor uses the one already installed.</p>
      ) : !state.repo ? (
        <p>This folder is not inside a git repository.</p>
      ) : (
        <>
          {/* The branch, with the repository's path where it does not take
              room: a panel 280px wide has none for a path, and the question
              "which repository is this?" is asked once, not at every glance. */}
          <div className="branch" title={state.repo.root}>
            {state.branch ?? "detached HEAD"}
          </div>
          {state.entries?.length ? (
            <ul>
              {state.entries.map((entry) => (
                <li key={entry.path}>
                  <button type="button" onClick={() => openDiff(entry)} title="Show what changed">
                    <span className="flags">{flagsOf(entry)}</span>
                    <span className="name">{entry.path}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>Nothing to commit.</p>
          )}
          {Boolean(state.entries?.length) && (
            <button type="button" className="commit" onClick={() => openCommit(options.id.value)}>
              Review and commit…
            </button>
          )}
          {state.tracking && Boolean(state.counts?.ahead) && (
            <button type="button" className="commit" disabled={pushing} onClick={doPush}>
              {pushing ? "Pushing…" : `Push ${state.counts.ahead} commit${state.counts.ahead === 1 ? "" : "s"} to ${state.tracking}`}
            </button>
          )}
          {/* Said, not acted upon: fetching without being asked would reach the
              network while someone is writing, and the count below is only as
              fresh as the last fetch anyway. */}
          {Boolean(state.counts?.behind) && (
            <p>
              {state.counts.behind} commit{state.counts.behind === 1 ? "" : "s"} behind {state.tracking}, as of the last
              fetch. Pull from your terminal.
            </p>
          )}
          {state.tracking === null && state.branch && <p>This branch tracks nothing, so there is nowhere to push.</p>}
          {state.error && <p>{state.error}</p>}
        </>
      )}
    </PanelList>
  );
};

/**
 * The diff dialog, mounted once per editor beside `ErrorModal`.
 *
 * `CommitModal` in read-only mode: the same unified merge view the git wrapper
 * uses, without staging, discarding or a message. One implementation of a diff
 * rather than two that drift.
 */
export const GitModal = () => {
  const { options } = useContext(MystState);
  const request = diffRequest.value;
  const mine = request && request.owner === options.id.value;
  const committing = Boolean(mine && request.commit);

  const onSubmit = async ({ message, stagedDocs }) => {
    const { repo } = request;
    diffRequest.value = null;
    try {
      // The paths exactly as git spelled them: `stagedDocs` holds the `file` of
      // each document, which came from `status`. Nothing is normalised on the
      // way back -- see `nfc` in gitBackend.js.
      await stage(repo, stagedDocs);
      const line = await commit(repo, message.trim() + "\n");
      showToast(line || "Committed.", "success", 6000);
    } catch (err) {
      showToast(`Commit failed: ${err?.message ?? err}`, "error", 0);
    } finally {
      await refreshRepoState();
    }
  };

  return (
    <CommitModal
      open={Boolean(mine)}
      readOnly={!committing}
      initialSummary={committing ? request.summary : ""}
      latestCommit={committing}
      documents={mine ? request.documents : []}
      parent={options.parent}
      onSubmit={onSubmit}
      onClose={() => (diffRequest.value = null)}
    />
  );
};

/**
 * The topbar entry, declared here rather than in `mystState.js`: that module is
 * imported by `CodeMirror.jsx`, and this one reaches `CodeMirror` through the
 * diff dialog, so naming the button there closed an import cycle.
 *
 * `tooltip` is a function, not a string: the topbar calls it while rendering,
 * so reading the signal inside subscribes and the branch and the count follow
 * the repository. A getter would not survive -- the topbar spreads each button
 * into a memoised copy, which evaluates a getter once and keeps the answer.
 * `dropdown` returns an element rather than being the component itself, so the
 * panel keeps a hook scope of its own instead of borrowing the topbar's.
 */
export const gitButton = {
  id: "git",
  tooltip: () => gitTooltip.value,
  dropdown: () => h(GitPanel, {}),
};

export default GitPanel;
