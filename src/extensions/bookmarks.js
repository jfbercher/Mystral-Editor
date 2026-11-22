import { gutter, GutterMarker, EditorView, keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { config } from "../config.js";

/**
 * Bookmarks: places in a document one comes back to.
 *
 * A bookmark is a line of the document and nothing else:
 *
 *     % bookmark
 *     ## The section being worked on
 *
 * `%` is MyST's own comment, so mystmd drops the line from every output, and
 * `stripMystComments` erases it before the preview is rendered -- the same
 * road `% slide-vspace:` and `% shortcaption:` already take. Two things follow
 * from writing them in the document rather than beside it. They travel with
 * the file, through git and to whoever it is sent to; and, since the source is
 * the state, nothing can drift out of step with it -- there is no list to keep
 * mapped through edits, no file to keep in agreement with the text. A
 * bookmark moves when its line moves because it *is* its line.
 *
 * The price is that placing one modifies the document: one undo step, and the
 * modified marker. That is the trade that was chosen deliberately.
 */

/** A bookmark line. Anything after the word is the reader's own note. */
const BOOKMARK_RE = /^[ \t]*%[ \t]*bookmark\b/i;
/** The same, keeping that note. */
const BOOKMARK_LABEL_RE = /^[ \t]*%[ \t]*bookmark\b[ \t]*(.*)$/i;

/**
 * The bookmarks of a document, with what to call them, read from its text.
 *
 * For the panel rather than the editor: it is handed the document as a string
 * and has no view to ask. A bookmark names itself when its author wrote
 * something after the word -- `% bookmark relire avec M.` -- and otherwise
 * borrows the line it marks, which for a heading is the heading, and is
 * usually what one was looking for anyway.
 */
export function bookmarksInText(source) {
  const lines = String(source ?? "").split("\n");
  const starts = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }

  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const match = BOOKMARK_LABEL_RE.exec(lines[i]);
    if (!match) continue;
    let t = i + 1;
    while (t < lines.length && !lines[t].trim()) t++;
    const target = t < lines.length ? t : i;
    // The marked line, stripped of what makes it markdown rather than a
    // title: a reader scanning the panel wants "Transformée de Fourier", not
    // "## Transformée de Fourier".
    const borrowed = lines[target].trim().replace(/^[#>\-*+\s]+/, "").replace(/^:::\{?|\}?$/g, "").trim();
    const label = (match[1] ?? "").trim() || borrowed || `Line ${target + 1}`;
    found.push({ line: i + 1, targetLine: target + 1, pos: starts[target], label: label.slice(0, 80) });
  }
  return found;
}

/** The line numbers carrying a bookmark, in order. */
export function bookmarkLines(state) {
  const lines = [];
  for (let n = 1; n <= state.doc.lines; n++) {
    if (BOOKMARK_RE.test(state.doc.line(n).text)) lines.push(n);
  }
  return lines;
}

/**
 * Where a bookmark sends the reader: the first line with something on it
 * under the marker, or the marker itself at the end of the document.
 */
function targetOf(state, markerLine) {
  for (let n = markerLine + 1; n <= state.doc.lines; n++) {
    if (state.doc.line(n).text.trim()) return state.doc.line(n).from;
  }
  return state.doc.line(markerLine).from;
}

/**
 * What a click on the gutter sees, on demand.
 *
 * Turned on with `window.mystralBookmarkDebug = true`. The inline mode gives
 * one gutter row for a whole block of source, so the question is always the
 * same: which document lines did the row stand for, and was a bookmark among
 * them?
 */
function bookmarkTrace(what, extra) {
  if (!globalThis.mystralBookmarkDebug) return;
  console.log(`[bookmark] ${what}`, JSON.stringify(extra));
}

class BookmarkMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-bookmark-marker";
    el.title = "Bookmark — click to remove";
    el.textContent = "•";
    return el;
  }
}

class AddBookmarkMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-bookmark-add";
    el.title = "Click to bookmark this line";
    el.textContent = "•";
    return el;
  }
}

const marker = new BookmarkMarker();
const adder = new AddBookmarkMarker();

/**
 * Put a bookmark on this line, or take it away.
 *
 * Away when the line is a marker, or when the line above it is: clicking the
 * line one has bookmarked is how one expects to unmark it, and the marker
 * sits above that line.
 */
export function toggleBookmarkAt(view, lineNumber) {
  const { state } = view;
  const line = state.doc.line(Math.min(Math.max(lineNumber, 1), state.doc.lines));

  if (BOOKMARK_RE.test(line.text)) {
    view.dispatch({
      changes: { from: line.from, to: Math.min(line.to + 1, state.doc.length) },
      userEvent: "bookmark.remove",
    });
    return true;
  }
  if (line.number > 1) {
    const above = state.doc.line(line.number - 1);
    if (BOOKMARK_RE.test(above.text)) {
      view.dispatch({
        changes: { from: above.from, to: Math.min(above.to + 1, state.doc.length) },
        userEvent: "bookmark.remove",
      });
      return true;
    }
  }
  // The indentation of the line it marks, so a bookmark inside a directive or
  // a list stays inside it rather than closing it.
  const indent = /^[ \t]*/.exec(line.text)[0];
  view.dispatch({
    changes: { from: line.from, to: line.from, insert: `${indent}% bookmark\n` },
    userEvent: "bookmark.add",
  });
  return true;
}

export const toggleBookmark = (view) => toggleBookmarkAt(view, view.state.doc.lineAt(view.state.selection.main.head).number);

/**
 * Jump to the next bookmark, or the previous one, cycling.
 *
 * Cycling rather than stopping at the ends: with two or three bookmarks, one
 * key pressed again and again is how a reader goes round their places of
 * interest, and a jump that refuses at the last one turns that into two keys.
 */
function jump(view, dir) {
  const lines = bookmarkLines(view.state);
  if (!lines.length) return false;
  // Compared on where each bookmark *sends* the reader, not on the line its
  // marker sits on. The two differ by one line, or by two when a blank line
  // separates them, and comparing the marker lines sent "previous" back to
  // the bookmark one was already standing on.
  const targets = lines.map((n) => targetOf(view.state, n));
  const here = view.state.selection.main.head;
  const pos =
    dir > 0
      ? (targets.find((t) => t > here) ?? targets[0])
      : ([...targets].reverse().find((t) => t < here) ?? targets[targets.length - 1]);
  view.dispatch({
    selection: { anchor: pos, head: pos },
    effects: EditorView.scrollIntoView(pos, { y: "start" }),
    userEvent: "bookmark.jump",
  });
  view.focus();
  return true;
}

export const nextBookmark = (view) => jump(view, 1);
export const previousBookmark = (view) => jump(view, -1);

/**
 * The gutter. Every line carries a mark: a full one where a bookmark is, and a
 * pale one everywhere else, which is what makes the column clickable without
 * the reader having to guess that it is -- the comments gutter beside it works
 * the same way.
 */
const bookmarkGutter = gutter({
  class: "cm-bookmark-gutter",
  lineMarker(view, line) {
    // Every document line this gutter row stands for, and not just the first.
    // In the inline mode a whole block of source is replaced by one rendered
    // widget, so one row of the gutter answers for ten lines of document --
    // and a bookmark written inside such a block had no row of its own: the
    // mark was simply invisible there, while it showed perfectly in the dual
    // pane, where a row is a line.
    const { doc } = view.state;
    const first = doc.lineAt(line.from).number;
    const last = doc.lineAt(line.to).number;
    for (let n = first; n <= last; n++) {
      if (BOOKMARK_RE.test(doc.line(n).text)) return marker;
    }
    // The marker sits above the line it marks, which may put it in the block
    // just above this one.
    if (first > 1 && BOOKMARK_RE.test(doc.line(first - 1).text)) return marker;
    return adder;
  },
  lineMarkerChange: (update) => update.docChanged,
  initialSpacer: () => adder,
  domEventHandlers: {
    click(view, line) {
      // Clicking a row that stands for a whole block: if it holds a bookmark,
      // that one is removed wherever it sits inside the block; otherwise the
      // block's first line is the one marked, which is where a reader looking
      // at the rendered block would expect it.
      const { doc } = view.state;
      const first = doc.lineAt(line.from).number;
      const last = doc.lineAt(Math.min(line.to, doc.length)).number;
      bookmarkTrace("click", {
        rowFrom: line.from,
        rowTo: line.to,
        lines: [first, last],
        texts: Array.from({ length: Math.min(last - first + 1, 6) }, (_, k) => doc.line(first + k).text.slice(0, 40)),
        above: first > 1 ? doc.line(first - 1).text.slice(0, 40) : null,
      });
      for (let n = first; n <= last; n++) {
        if (BOOKMARK_RE.test(doc.line(n).text)) {
          bookmarkTrace("removing, line in the row", { line: n });
          return toggleBookmarkAt(view, n);
        }
      }
      // The marker is drawn for the line above too, and that line may sit in
      // the block just before this row: removing from here is what a reader
      // clicking the mark they can see expects.
      if (first > 1 && BOOKMARK_RE.test(doc.line(first - 1).text)) {
        bookmarkTrace("removing, line above the row", { line: first - 1 });
        return toggleBookmarkAt(view, first - 1);
      }
      bookmarkTrace("adding", { line: first });
      return toggleBookmarkAt(view, first);
    },
  },
});

const bookmarkTheme = EditorView.baseTheme({
  ".cm-bookmark-gutter": { width: "14px" },
  ".cm-bookmark-marker": { color: "var(--accent, #2563eb)", cursor: "pointer", fontSize: "16px", lineHeight: "1" },
  // Invisible until the pointer is in the column: a dot on every line would
  // be a column of noise beside a document.
  ".cm-bookmark-add": { color: "transparent", cursor: "pointer", fontSize: "16px", lineHeight: "1" },
  ".cm-bookmark-gutter:hover .cm-bookmark-add": { color: "var(--color-border, #ccc)" },
});

/** The three keys, from `shortcuts` in config.json; an empty one is not bound. */
function bookmarkKeymap() {
  const s = config.shortcuts ?? {};
  const bindings = [
    { key: s.bookmarkToggle, run: toggleBookmark },
    { key: s.bookmarkNext, run: nextBookmark },
    { key: s.bookmarkPrevious, run: previousBookmark },
  ].filter((b) => b.key);
  return Prec.high(keymap.of(bindings.map((b) => ({ ...b, preventDefault: true }))));
}

export const bookmarks = () => [bookmarkGutter, bookmarkTheme, bookmarkKeymap()];
