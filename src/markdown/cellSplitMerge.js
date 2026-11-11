/**
 * Merging two neighbouring code cells, and splitting one in two.
 *
 * Both are rewritings of the source, so both are written here as functions of
 * a string: what they do can be read, and tested, without a browser.
 *
 * What is kept, and what is not. A cell is an opening marker, its options, and
 * a body. Merging keeps the **active cell's** marker and options whole -- they
 * are not combined, since `:packages:` and `:params:` of two cells have no
 * meaningful union -- and takes only the body of the other. Splitting gives
 * both halves the same marker and the same options as the cell they come from,
 * which is the only answer that cannot surprise: whatever made the cell run is
 * still there on both sides.
 */

/** Put `indent` back on every line that has something on it. */
const indentBody = (text, indent) =>
  !indent
    ? text
    : String(text)
        .split("\n")
        .map((line) => (line.trim() === "" ? line : indent + line))
        .join("\n");

/**
 * The three pieces of a cell, from a block as `listFenceBlocks` describes it.
 * `head` is the opening marker and the option lines, as written; `body` is the
 * code, dedented; `close` is the marker that ends it.
 */
function partsOf(src, block) {
  // Trailing newlines dropped: the body's start is taken *after* the blank
  // line that separates the options from the code, so that blank line is at
  // the tail of this slice -- and `cellText` puts the separator back itself.
  const head = src.slice(block.lineStart, block.codeStart).replace(/\n+$/, "");
  const closeM = /^\n[ \t]*([`:~]{3,})/.exec(src.slice(block.codeEnd, block.blockEnd));
  return { head, body: block.inside, close: closeM ? closeM[1] : ":::", indent: block.indent };
}

/** A cell written out again from its pieces. */
function cellText({ head, body, close, indent }) {
  // A directive wants a blank line between its options and its body -- without
  // it, the first line of code is read as one more option. A bare fence has no
  // options to separate, and a blank line there is a blank first line of code.
  const separator = head.includes("{code-cell}") ? "\n\n" : "\n";
  return `${head}${separator}${indentBody(body, indent)}\n${indent}${close}\n`;
}

/**
 * Are these two blocks neighbours, in the sense that merging them changes
 * nothing but themselves?
 *
 * Nothing between them but blank lines -- a paragraph sitting there would have
 * to go somewhere, and there is no answer to where -- and the same indentation,
 * which is what says they are in the same container rather than one inside an
 * admonition and one outside it.
 */
export function cellsAreNeighbours(src, first, second) {
  return first.indent === second.indent && src.slice(first.blockEnd, second.lineStart).trim() === "";
}

/**
 * The two cells as one, keeping the options of whichever is the active one.
 * Replaces everything from `first.lineStart` to `second.blockEnd`.
 */
export function mergeCellsText(src, first, second, keepSecond) {
  const a = partsOf(src, first);
  const b = partsOf(src, second);
  const keep = keepSecond ? b : a;
  return cellText({ ...keep, indent: first.indent, body: `${a.body}\n${b.body}` });
}

/**
 * The cell as two cells, cut before line `bodyIndex` of its body (0-based).
 *
 * Null when the cut would leave one side empty: splitting at the very top or
 * the very bottom of a cell means producing an empty one, which is never what
 * was meant and is a keystroke away from being noticed too late.
 */
export function splitCellText(src, block, bodyIndex) {
  const parts = partsOf(src, block);
  const lines = parts.body.split("\n");
  if (!(bodyIndex > 0) || bodyIndex >= lines.length) return null;
  const before = lines.slice(0, bodyIndex).join("\n").replace(/\s+$/, "");
  const after = lines.slice(bodyIndex).join("\n").replace(/^\n+/, "").replace(/\s+$/, "");
  if (!before || !after) return null;
  return `${cellText({ ...parts, body: before })}\n${cellText({ ...parts, body: after })}`;
}
