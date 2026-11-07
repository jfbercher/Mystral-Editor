/**
 * The bar at the foot of the editor: where the document is, how long it is,
 * what language it is checked in, and what the repository is doing.
 *
 * Everything here is read from somewhere that already knew it -- the git
 * panel's state, the spell checker's chosen dictionary, the tab manager's
 * file, the text manager's document -- so the bar owns no state of its own
 * but the counts, which nothing else computes continuously.
 *
 * One bar per editor, drawn inside it, so a tab shows its own document and
 * nothing has to be told which tab is active.
 */
import { useContext, useEffect, useRef, useState } from "preact/hooks";
import { useSignalEffect } from "@preact/signals";
import styled from "styled-components";
import { MystState } from "../mystState";
import { gitSummary } from "./GitPanel";
import { activeDictionary } from "../extensions/spellchecker";
import { computeStats, showStatsPopup } from "../utils/local_utils/stats";
import { isTauri } from "../utils/local_utils/fs.js";

/**
 * How long after the last keystroke the counts are recomputed.
 *
 * Measured rather than guessed: a full pass over a 42 000-character document
 * takes about 8 ms with a bare markdown-it, under 30 ms at 335 000, and it
 * runs after typing has stopped rather than during it -- far below what the
 * preview already costs on every change. Hence a short delay: the number is
 * there almost at once and no one waits for it.
 */
const COUNT_DELAY = 400;

/**
 * Above this, the counts are computed only when asked.
 *
 * Not a performance cliff -- there is none at this size -- but the point past
 * which a document is unusual enough that a periodic pass is a choice rather
 * than a default. The bar says so instead of showing a stale number.
 */
const COUNT_LIMIT = 500_000;

const Bar = styled.div`
  flex: 0 0 auto;
  width: 100%;
  height: var(--status-bar-h, 25px);
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 1.5em;
  padding: 2px 10px;
  font-family: "Lato", sans-serif;
  font-size: 12px;
  line-height: 20px;
  color: var(--char-col);
  /* No rule above it: the bar already stands apart by its background, and a
     line there, with the wrapper's padding around the panes, closed a frame
     around the editing area that nobody had asked for. */
  background: var(--navbar-bg);
  user-select: none;
  white-space: nowrap;
  overflow: hidden;

  .spacer {
    flex: 1 1 auto;
  }

  .item {
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item.path {
    /* Shortened in JavaScript rather than by CSS. The obvious trick --
       "direction: rtl", so the ellipsis falls on the left and the file name
       survives -- reorders the neutral characters around the text: a leading
       "/" was displayed at the far end, and the arrow keys walked the
       selection backwards. The string was never wrong, only its picture, but
       a path one cannot read or select is not worth the cleverness. */
    flex: 0 1 auto;
    min-width: 0;
    opacity: 0.85;
  }

  button.item {
    border: none;
    background: none;
    padding: 0 2px;
    margin: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
    border-radius: var(--border-radius, 4px);

    &:hover {
      background: var(--button-bg-hover);
    }
  }

  .muted {
    opacity: 0.6;
  }
`;

/**
 * A path short enough for a status bar, cut in the middle.
 *
 * The two ends are what one reads: where the file lives, and what it is
 * called. The middle is what gives way. Separators are kept as they come --
 * a Windows path is as welcome here as a POSIX one -- and a path that already
 * fits is returned untouched.
 */
export function shortenPath(path, max = 64) {
  const text = String(path ?? "");
  if (text.length <= max) return text;
  const parts = text.split(/([/\\])/);
  const tail = parts.slice(-4).join("");
  // Two real segments at the head: `/Users` alone says nothing, `/Users/jf`
  // at least says whose.
  const head = parts.slice(0, 5).join("");
  const short = `${head}\u2026${tail}`;
  // A single enormous segment cannot be cut this way; take its end, which is
  // the part that names the file.
  return short.length < text.length ? short : `\u2026${text.slice(-max)}`;
}

/** The counts, kept up to date a little after the document settles. */
function useCounts(text, options) {
  const [counts, setCounts] = useState(null);
  const [tooLong, setTooLong] = useState(false);
  const timer = useRef(null);

  const compute = (doc) => {
    try {
      const md = text.md.value;
      if (!md) return;
      setCounts(computeStats(doc, md));
      setTooLong(false);
    } catch (err) {
      // A document mid-edit can defeat a plugin; a missing count is not worth
      // an error pane.
      console.warn("[status] the counts could not be computed:", err?.message ?? err);
    }
  };

  useSignalEffect(() => {
    const doc = text.text.value;
    clearTimeout(timer.current);
    if (doc.length > COUNT_LIMIT) {
      setTooLong(true);
      setCounts(null);
      return;
    }
    timer.current = setTimeout(() => compute(doc), COUNT_DELAY);
  });

  useEffect(() => () => clearTimeout(timer.current), []);

  return { counts, tooLong, countNow: () => compute(text.text.peek()) };
}

/**
 * Whether this runs in the desktop build.
 *
 * Called, not tested: `isTauri` is a function, and a function is always
 * truthy -- the mistake is easy enough that `GitPanel.jsx` makes it too, on
 * the same import, where `if (!isTauri) return` never returns.
 */
const onDesktop = isTauri();

export const StatusBar = () => {
  const { options, text } = useContext(MystState);
  const { counts, tooLong, countNow } = useCounts(text, options);

  const git = gitSummary.value;
  const dict = activeDictionary.value;
  const path = options.filePath.value;

  const stats = () => showStatsPopup(options.id.value);

  return (
    <Bar className="myst-status-bar">
      {onDesktop && (
        <span className="item" title={git ? `Branch ${git.branch}` : "Not a git repository"}>
          ⑂ {git ? git.branch : <span className="muted">—</span>}
          {git && git.changed > 0 && <span className="muted">· {git.changed} changed</span>}
          {git && git.ahead > 0 && <span className="muted">· {git.ahead} to push</span>}
        </span>
      )}

      <button type="button" className="item" onClick={tooLong ? countNow : stats} title={tooLong ? "Count this document now" : "Text statistics"}>
        {counts ? (
          <>
            {counts.wordCount.toLocaleString()} words · {counts.charsWithSpaces.toLocaleString()} chars
          </>
        ) : tooLong ? (
          <span className="muted">count on demand</span>
        ) : (
          <span className="muted">counting…</span>
        )}
      </button>

      <span className="item" title={dict ? `Spelling checked with ${dict}` : "No dictionary loaded: spelling is not checked"}>
        {dict ?? <span className="muted">no dictionary</span>}
      </span>

      <span className="spacer" />

      {path && (
        <span className="item path" title={path}>
          {shortenPath(path)}
        </span>
      )}
    </Bar>
  );
};

export default StatusBar;
