import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

/**
 * Mark the colon fences that do not pair up.
 *
 * MyST nests by fence length: an inner directive must use fewer colons than the
 * one around it, because a bare `:::` closes the innermost block open at that
 * point, and nothing says which one was meant. So
 *
 *     :::{warning}
 *     :::{image} photo.png
 *     :::
 *     text
 *     :::
 *
 * has its warning closed by the image's fence; the text falls outside it and the
 * last `:::` closes nothing. The document is quietly mis-structured -- it simply
 * renders wrong, with no error raised anywhere. The cure is to open the outer
 * block with `::::`; what is marked here is the symptom.
 *
 * Read from the text rather than from the syntax tree. The leftover fence takes
 * whatever shape its surroundings give it -- a block of its own after a blank
 * line, part of the paragraph above it otherwise, since a fence cannot interrupt
 * a paragraph -- so there is no one node to look for. Counting lines always
 * works.
 *
 * Backtick and tilde fences are tracked too, so that a `:::` shown inside a code
 * block does not count, but only colon fences are ever reported: a lone ``` is
 * the ordinary way to open a code block and would be underlined for as long as
 * it takes to write it, while a lone `:::` has no such use.
 */

/** Opening or closing fence; `info` empty means a closing one. */
const FENCE_RE = /^ {0,3}([:~`])\1{2,}[ \t]*(.*)$/;

/**
 * The fence lines that do not pair up.
 *
 * The rule is CommonMark's, and it is what makes equal-length nesting fail:
 * once a block is open, the only line that means anything is one that closes
 * it -- same character, at least as long, nothing after it. Everything else,
 * `:::{image}` included, is content. So an inner directive written with as many
 * colons as the one around it never opens anything; it is the first bare `:::`
 * that closes the outer block, and the last one is then left with nothing to
 * close. Opening the outer block with `::::` makes the inner fences too short
 * to close it, and the nesting works.
 *
 * @param {string} text
 * @returns {{from: number, to: number, unclosed: boolean}[]}
 */
export function findUnbalancedFences(text) {
  return scanFences(text.split("\n"));
}

/**
 * The same scan over any iterable of lines.
 *
 * The view passes CodeMirror's own line iterator rather than a string: this runs
 * on every keystroke, and turning a long document into one big string just to
 * split it again was the only part of it with a real cost.
 *
 * @param {Iterable<string>} lines
 * @returns {{from: number, to: number, unclosed: boolean}[]}
 */
export function scanFences(lines) {
  const stack = [];
  const out = [];
  let offset = 0;

  for (const line of lines) {
    const m = FENCE_RE.exec(line);
    if (!m) {
      offset += line.length + 1;
      continue;
    }
    const char = m[1];
    const indent = line.length - line.trimStart().length;
    const len = /^(.)\1*/.exec(line.slice(indent))[0].length;
    const info = m[2].trim();
    const frame = { char, len, from: offset + indent, to: offset + indent + len };
    const top = stack[stack.length - 1];

    if (top) {
      // Inside a block: close it, or be content.
      if (char === top.char && len >= top.len && info === "") stack.pop();
    } else if (info !== "") {
      stack.push(frame);
    } else if (char === ":") {
      // A colon fence with nothing after it, outside any block: it closes
      // nothing. A bare ``` is the ordinary way to open a code block, so it is
      // pushed instead of being reported.
      out.push({ ...frame, unclosed: false });
    } else {
      stack.push(frame);
    }
    offset += line.length + 1;
  }

  // Whatever is still open was never closed. Only colon fences are reported:
  // an unfinished code block is the normal state of one being written.
  for (const frame of stack) if (frame.char === ":") out.push({ ...frame, unclosed: true });

  out.sort((a, b) => a.from - b.from);
  return out;
}

const closesNothing = Decoration.mark({
  class: "cm-orphan-fence",
  attributes: {
    title:
      "This fence closes nothing — usually one that has already closed the block around it. " +
      "A nested directive must use fewer fence characters than the one around it.",
  },
});

const neverClosed = Decoration.mark({
  class: "cm-orphan-fence",
  attributes: { title: "This block is never closed." },
});

export const orphanFence = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = this.build(view);
    }

    update(update) {
      if (update.docChanged) this.decorations = this.build(update.view);
    }

    build(view) {
      const builder = new RangeSetBuilder();
      for (const f of scanFences(view.state.doc.iterLines())) {
        builder.add(f.from, f.to, f.unclosed ? neverClosed : closesNothing);
      }
      return builder.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

/**
 * Deliberately loud. A plain wavy underline is what the spellchecker draws, and
 * a reader skims past one more of them -- while this one says the document is
 * structurally wrong, which is worth interrupting for. The highlight carries its
 * own foreground colour so that it reads the same in both themes.
 */
export const orphanFenceTheme = EditorView.baseTheme({
  ".cm-orphan-fence": {
    background: "var(--fence-error-bg, #ffb224)",
    color: "var(--fence-error-fg, #1f2328)",
    fontWeight: "700",
    borderRadius: "2px",
    padding: "0 2px",
    textDecoration: "underline wavy var(--error-bg, #cf222e)",
    textDecorationThickness: "2px",
    textDecorationSkipInk: "none",
    textUnderlineOffset: "3px",
    cursor: "help",
  },
});
