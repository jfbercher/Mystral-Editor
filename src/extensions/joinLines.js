import { EditorView, keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { config } from "../config.js";

/**
 * Put back together the lines a PDF broke.
 *
 * Text copied out of a PDF arrives with a newline at the end of every printed
 * line, because that is what the page had. Markdown reads those as part of the
 * paragraph, so the result renders as one block either way -- until it is
 * edited, reflowed, exported or searched, at which point every line is its own
 * little wall.
 *
 * Joining is therefore a text operation and not a rendering one, and the whole
 * difficulty is knowing which newlines are the page's and which are the
 * author's. Four kinds are never touched:
 *
 *   - a blank line, which separates paragraphs;
 *   - a line opening a block of its own -- a heading, a list item, a quote, a
 *     table row, a fence, a directive, a definition, an HTML tag, a MyST
 *     comment;
 *   - the line before one of those, for the same reason read backwards;
 *   - anything inside a fenced or colon-delimited block, where a line break is
 *     the code's own and joining it changes what runs.
 *
 * What is removed along the way is the explicit hard break markdown has: two
 * spaces at the end of a line, or a trailing backslash. They are what the
 * command is named after, and leaving them in a joined paragraph would keep
 * the break it was asked to remove.
 */

/** A line that begins something of its own: it is never appended to the one above. */
const OPENS_BLOCK =
  /^[ \t]*(?:#{1,6}[ \t]|[-*+][ \t]|\d+[.)][ \t]|>|\||:{3,}|`{3,}|~{3,}|[:~][ \t]|<[a-zA-Z/!]|%|\(.+\)=[ \t]*$|---[ \t]*$|\[\^[^\]]+\]:|[A-Za-z0-9_-]+:[ \t]*$)/;

/**
 * A line that is a whole block by itself: nothing is appended *to* it.
 *
 * The symmetric rule, and the one the first version forgot -- a heading
 * swallowed the sentence under it, which is the worst thing this command
 * could do, since a heading looks the same until the document is rendered. A
 * list item is deliberately not here: the line under it is its continuation,
 * and joining them is exactly what a passage pasted from a PDF needs.
 */
const CLOSED_LINE =
  /^[ \t]*(?:#{1,6}[ \t]|>|\||%|<[a-zA-Z/!]|\(.+\)=[ \t]*$|---[ \t]*$|\[\^[^\]]+\]:|[A-Za-z0-9_-]+:[ \t]*$)/;

/** A fence or directive opening or closing: inside one, nothing is joined. */
const FENCE = /^[ \t]*(`{3,}|~{3,}|:{3,})/;

/** A line ending in a word cut by the page: "exemp-" + "le". */
const HYPHENATED = /(\p{L})-$/u;

/**
 * Join the broken lines of a passage, leaving its structure alone.
 *
 * Exported on its own so the rule can be tried without an editor: it is the
 * whole of the feature, and the cases that matter are all in the text.
 */
export function joinHardBreaks(text) {
  const lines = String(text).split("\n");
  const out = [];
  let fence = null;

  for (const raw of lines) {
    const marker = FENCE.exec(raw);
    if (marker) {
      const ticks = marker[1];
      if (!fence) fence = ticks[0];
      else if (ticks[0] === fence) fence = null;
      out.push(raw);
      continue;
    }
    if (fence) {
      out.push(raw);
      continue;
    }

    const previous = out.length ? out[out.length - 1] : null;
    const joinable =
      previous !== null &&
      previous.trim() !== "" &&
      raw.trim() !== "" &&
      !OPENS_BLOCK.test(raw) &&
      !CLOSED_LINE.test(previous) &&
      !FENCE.test(previous);

    if (!joinable) {
      out.push(raw);
      continue;
    }

    // The explicit hard breaks go with the line they ended.
    const left = previous.replace(/[ \t]+$/, "").replace(/\\$/, "");
    const right = raw.replace(/^[ \t]+/, "");
    // A line ending in a hyphen is never followed by a space: either the page
    // cut a word in two, and the hyphen goes with the cut, or the hyphen
    // belongs to the word -- "Marie-" before "Claire" -- and stays. What is
    // certain in both readings is that nothing separates the two halves. The
    // case of the next letter decides which reading it is.
    const cut = HYPHENATED.test(left);
    out[out.length - 1] = cut
      ? (/^\p{Ll}/u.test(right) ? left.slice(0, -1) : left) + right
      : `${left} ${right}`;
  }

  return out.join("\n");
}

/**
 * The passage the command works on: the selection, whole lines, or -- with no
 * selection -- the paragraph the caret is in.
 *
 * Acting on the paragraph matters more than it sounds: pasted text is read
 * before it is tidied, so the caret is usually already in the offending
 * paragraph and reaching for the mouse to select it is the slow part.
 */
function passage(state) {
  const { from, to } = state.selection.main;
  if (from !== to) {
    return { from: state.doc.lineAt(from).from, to: state.doc.lineAt(to).to };
  }
  const here = state.doc.lineAt(from).number;
  if (!state.doc.line(here).text.trim()) return null;
  let first = here;
  let last = here;
  while (first > 1 && state.doc.line(first - 1).text.trim()) first -= 1;
  while (last < state.doc.lines && state.doc.line(last + 1).text.trim()) last += 1;
  return { from: state.doc.line(first).from, to: state.doc.line(last).to };
}

export const joinBrokenLines = (view) => {
  const range = passage(view.state);
  if (!range) return false;
  const before = view.state.doc.sliceString(range.from, range.to);
  const after = joinHardBreaks(before);
  if (after === before) return false;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: after },
    // The joined passage stays selected, so a second thought is one undo or
    // one more command away, and so the eye finds what moved.
    selection: { anchor: range.from, head: range.from + after.length },
    userEvent: "input.joinlines",
    scrollIntoView: true,
  });
  return true;
};

/** From `shortcuts.joinLines` in config.json; empty means no key. */
export const joinLinesKeymap = () => {
  const key = (config.shortcuts ?? {}).joinLines;
  if (!key) return [];
  return Prec.high(keymap.of([{ key, run: joinBrokenLines, preventDefault: true }]));
};

export const joinLines = () => [joinLinesKeymap(), EditorView.baseTheme({})];
