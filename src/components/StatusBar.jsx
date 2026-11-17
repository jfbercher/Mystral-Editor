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
import { availableInterpreters, currentChoice, pickInterpreter, onEngineChange, interpreterMenuEnabled } from "../markdown/engineChoice.js";
import { useSignalEffect } from "@preact/signals";
import styled from "styled-components";
import { MystState } from "../mystState";
import { gitSummary } from "./GitPanel";
import { availableDictionaries, storeDictionary } from "../extensions/spellchecker.js";
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
  /* Not "overflow: hidden", which is where the dictionary menu went: a popup
     anchored inside a clipped box is clipped with it, and all that showed was
     the two pixels of it that fitted in the bar's own height. What has to be
     kept from overflowing is the path, and it says so itself below. */

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

  /* Anchored to its item and opening upwards: the bar is at the foot of the
     window, so a menu dropping down would fall off it. */
  .menu-anchor {
    position: relative;
  }

  .menu {
    position: absolute;
    bottom: calc(100% + 4px);
    left: 0;
    z-index: 30;
    min-width: 12em;
    max-height: 50vh;
    overflow-y: auto;
    padding: 4px 0;
    background: var(--panel-bg);
    color: var(--char-col);
    border: 1px solid var(--border);
    border-radius: var(--border-radius, 6px);
    box-shadow: 0 2px 10px var(--box-shadow);
    text-align: left;
  }

  .menu-title {
    padding: 2px 10px 4px;
    opacity: 0.6;
  }

  .menu button {
    display: block;
    width: 100%;
    text-align: left;
    padding: 3px 10px;
    border: none;
    background: none;
    font: inherit;
    color: inherit;
    cursor: pointer;
    white-space: nowrap;

    &:hover {
      background: var(--button-bg-hover);
    }
  }

  .menu hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 4px 0;
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

//Whether this runs in the desktop build.
const onDesktop = isTauri();

/**
 * The menu of dictionaries, opened from the bar.
 *
 * The list is asked for when the menu opens rather than kept up to date: a
 * dictionary is installed by dropping a folder beside the configuration file,
 * which nothing notifies us of, so the only moment the answer is certainly
 * fresh is the moment it is wanted.
 */
const DictionaryMenu = ({ options, declared, onClose }) => {
  const [names, setNames] = useState(null);
  const chosen = options.dictionaryOverride.value;
  const active = options.activeDictionary.value.name;

  useEffect(() => {
    let alive = true;
    availableDictionaries(options.spellcheckOpts.value?.dictionaryPath)
      .then((found) => alive && setNames(found))
      .catch(() => alive && setNames([]));
    return () => {
      alive = false;
    };
  }, []);

  const pick = (name) => {
    storeDictionary(options.filePath.value, name);
    options.dictionaryOverride.value = name;
    onClose();
  };

  // Where the language in use comes from, said rather than left to be
  // guessed three weeks later.
  const origin = chosen ? "chosen here" : declared ? "from this document" : "from your settings";

  return (
    <div className="menu" onClick={(ev) => ev.stopPropagation()}>
      <div className="menu-title">Dictionary — {origin}</div>
      {names === null && <div className="menu-title">looking…</div>}
      {names?.length === 0 && <div className="menu-title">none found</div>}
      {names?.map((name) => (
        <button key={name} type="button" onClick={() => pick(name)}>
          {name === active ? "• " : "\u00a0\u00a0"}
          {name}
        </button>
      ))}
      {chosen && (
        <>
          <hr />
          <button type="button" onClick={() => pick(null)}>
            Forget this choice
          </button>
        </>
      )}
    </div>
  );
};

/**
 * The menu of interpreters, opened from the bar.
 *
 * Shown only where there is something to choose: the desktop build, with
 * "Use local Jupyter kernel" turned on. The list is asked for when the menu
 * opens, as the dictionaries are and for the same reason -- a kernel is
 * installed by a command in a terminal, which nothing notifies us of.
 *
 * The choice holds for the session. A lasting one belongs in the document's
 * `kernelspec`, which is also what its namespace is derived from, and that is
 * why a kernel of another language is refused here rather than applied: two
 * interpreters cannot share a namespace, and only the frontmatter can say so.
 */
const InterpreterMenu = ({ docKey, onClose }) => {
  const [kernels, setKernels] = useState(null);
  const [reason, setReason] = useState("");
  const [refused, setRefused] = useState("");
  const current = currentChoice(docKey);

  useEffect(() => {
    let alive = true;
    availableInterpreters()
      .then((found) => {
        if (!alive) return;
        setKernels(found.kernels);
        setReason(found.reason);
      })
      .catch(() => alive && setKernels([]));
    return () => {
      alive = false;
    };
  }, []);

  const pick = (kernel) => {
    const { ok, reason: why } = pickInterpreter(docKey, kernel);
    if (!ok) return setRefused(why);
    onClose();
  };

  const isActive = (name) => (name ? current.engine === "jupyter" && current.kernel?.name === name : current.engine === "pyodide");

  return (
    <div className="menu" onClick={(ev) => ev.stopPropagation()}>
      <div className="menu-title">Interpreter — {current.settled ? "for this session" : "not started yet"}</div>
      <button type="button" onClick={() => pick(null)}>
        {isActive(null) ? "\u2022 " : "\u00a0\u00a0"}
        pyodide
      </button>
      {kernels === null && <div className="menu-title">looking…</div>}
      {kernels?.length === 0 && <div className="menu-title">{reason || "no kernel found"}</div>}
      {kernels?.map((kernel) => (
        <button key={kernel.name} type="button" onClick={() => pick(kernel)}>
          {isActive(kernel.name) ? "\u2022 " : "\u00a0\u00a0"}
          {/* The kernelspec name first, because it is the identifier: unique,
              shown by the indicators, and the one a document writes in its
              `kernelspec`. Its human label follows, quietly -- it is what
              tells two Pythons apart, but it is not what anything else in
              this editor calls them. */}
          {kernel.name}
          {kernel.displayName && kernel.displayName !== kernel.name ? <span className="muted"> {kernel.displayName}</span> : null}
        </button>
      ))}
      {refused && (
        <>
          <hr />
          <div className="menu-title">{refused}</div>
        </>
      )}
    </div>
  );
};

export const StatusBar = () => {
  const { options, text } = useContext(MystState);
  const [menuOpen, setMenuOpen] = useState(false);
  const [engineMenuOpen, setEngineMenuOpen] = useState(false);

  // A click anywhere else closes it, which is what a menu does.
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuOpen]);

  useEffect(() => {
    if (!engineMenuOpen) return;
    const close = () => setEngineMenuOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [engineMenuOpen]);

  // Redrawn when an engine is settled or changed, which happens on the first
  // run rather than when the document opens.
  const [, bumpEngine] = useState(0);
  useEffect(() => onEngineChange(() => bumpEngine((n) => n + 1)), []);
  const engine = currentChoice(options.id.value);
  const { counts, tooLong, countNow } = useCounts(text, options);

  const git = gitSummary.value;
  const { name: dict, loading: dictLoading } = options.activeDictionary.value;
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

      <span className="menu-anchor">
        <button
          type="button"
          className="item"
          onClick={(ev) => {
            ev.stopPropagation();
            setMenuOpen((open) => !open);
          }}
          title={
            dictLoading
              ? "Loading the dictionary…"
              : dict
                ? `Spelling checked with ${dict} — click to choose another`
                : "No dictionary loaded: spelling is not checked — click to choose one"
          }
        >
          {dictLoading ? <span className="muted">dictionary…</span> : (dict ?? <span className="muted">no dictionary</span>)}
        </button>
        {menuOpen && <DictionaryMenu options={options} declared={text.language.value} onClose={() => setMenuOpen(false)} />}
      </span>

      {onDesktop && interpreterMenuEnabled() && (
        <span className="menu-anchor">
          <button
            type="button"
            className="item"
            onClick={(ev) => {
              ev.stopPropagation();
              setEngineMenuOpen((open) => !open);
            }}
            title={
              engine.engine === "jupyter"
                ? `Code cells run on the kernel "${engine.kernel?.displayName || engine.kernel?.name || "jupyter"}" — click to choose another`
                : "Code cells run on Pyodide — click to choose a local kernel"
            }
          >
            {engine.engine === "jupyter" ? (engine.kernel?.name ?? "jupyter") : <span className="muted">pyodide</span>}
          </button>
          {engineMenuOpen && <InterpreterMenu docKey={options.id.value} onClose={() => setEngineMenuOpen(false)} />}
        </span>
      )}

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
