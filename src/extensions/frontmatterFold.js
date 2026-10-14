import { foldService, foldEffect, unfoldEffect, foldedRanges } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { config } from "../config.js";

/**
 * What the reader last decided, which outranks the configuration.
 *
 * `config.foldFrontmatterOnOpen` says how a document opens for someone who has
 * never said otherwise; the moment the reader folds or unfolds the block, that
 * becomes the answer and the setting steps aside -- the same arrangement as the
 * view mode, which remembers the last button pressed rather than re-reading
 * `editorMode` every time.
 */
const STORAGE_KEY = "frontmatterFolded";

function readPreference() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "folded") return true;
    if (stored === "unfolded") return false;
  } catch {
    /* private browsing, blocked storage: fall back on the configuration */
  }
  return null;
}

function writePreference(folded) {
  try {
    localStorage.setItem(STORAGE_KEY, folded ? "folded" : "unfolded");
  } catch {
    /* nothing to do: the session simply will not be remembered */
  }
}

/** Whether a document being opened should have its frontmatter folded. */
export function shouldFoldFrontmatter() {
  return readPreference() ?? !!config.foldFrontmatterOnOpen;
}

/**
 * The range the frontmatter folds over: from the end of the opening `---` to
 * the end of the closing one, so the first line stays visible and keeps its
 * fold marker.
 *
 * The delimiters are located here rather than through `extractFrontmatter`,
 * which parses the YAML: a block being edited is invalid half of the time, and
 * there is no reason for it to lose its fold while a value is being typed. This
 * also keeps a full `doc.toString()` and a YAML parse out of a path the fold
 * gutter walks for every visible line.
 */
export function frontmatterRange(state) {
  const { doc } = state;
  const openLine = doc.line(1);
  if (openLine.text.trim() !== "---") return null;

  for (let n = 2; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (line.text.trim() !== "---") continue;
    return line.to > openLine.to ? { from: openLine.to, to: line.to } : null;
  }
  return null;
}

export const frontmatterFoldService = foldService.of((state, lineStart, lineEnd) => {
// We only suggest the fold for the very first line of the document (that of the opening “---”).
  if (lineStart !== 0) return null;
  return frontmatterRange(state);
});

/**
 * Fold the frontmatter, if there is one and it is not folded already.
 *
 * Called when a document is loaded into the editor, not on every change: the
 * point is to open a file on its text rather than on its metadata, while
 * leaving the reader free to unfold it and keep it that way.
 */
/** Is this range folded, exactly as given? */
function isFolded(state, range) {
  let folded = false;
  foldedRanges(state).between(range.from, range.to, (from, to) => {
    if (from === range.from && to === range.to) folded = true;
  });
  return folded;
}

/**
 * Record the reader's choice, and only theirs.
 *
 * The test is on the effect rather than on the resulting state: folding a
 * heading, or the initial `skipAndFoldAll`, also goes through a fold effect,
 * and reading the state afterwards would turn every one of them into a
 * decision about the frontmatter -- including a decision never made.
 */
export const frontmatterFoldMemory = EditorView.updateListener.of((update) => {
  const range = frontmatterRange(update.state);
  if (!range) return;

  const touched = update.transactions.some((tr) =>
    tr.effects.some(
      (e) => (e.is(foldEffect) || e.is(unfoldEffect)) && e.value.from === range.from && e.value.to === range.to,
    ),
  );
  if (touched) writePreference(isFolded(update.state, range));
});

export function foldFrontmatter(view) {
  const range = view && frontmatterRange(view.state);
  if (!range) return false;

  if (isFolded(view.state, range)) return false;

  view.dispatch({ effects: foldEffect.of(range) });
  return true;
}