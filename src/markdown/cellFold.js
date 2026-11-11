/**
 * Writing a cell's folded state back into the document.
 *
 * The chevron that folds a cell's code away is a view state, and a view state
 * that is forgotten between two sittings is a chore: a course document holds
 * thirty cells, and reopening it to find them all unfolded undoes a tidying
 * that took a minute. Three places could remember it -- the browser's local
 * storage, the sidecar file, the document itself -- and only the document
 * survives everything: a reopening, another machine, a copy sent to a student,
 * an export. So the chevron writes `:fold:` into the source, the way the
 * parameter controls already write their values into the code.
 *
 * What is written depends on the syntax the cell is in. A directive carries
 * its options on lines of their own:
 *
 *     :::{code-cell} python
 *     :fold:
 *
 * while a plain fence carries its flags in the info string, beside `:linenos:`:
 *
 *     ```code-cell python :fold:
 *
 * Both are handled here. The option says one thing and only that -- present,
 * the cell opens folded; absent, it opens open -- so folding writes it and
 * unfolding removes it, and nothing is ever written twice. It has nothing to
 * do with `:tags: hide-input`, which is metadata for the export and does not
 * govern what the editor shows.
 *
 * A `:fold: false` written by hand is read as "open", so a document that says
 * so explicitly is not misread; it is simply never what this writes.
 */

/** Is this block written as a directive (options on their own lines) or as a bare fence? */
const isDirective = (openLine) => openLine.includes("{code-cell}");

/**
 * Whether an option meant as a boolean is on.
 *
 * A directive's options reach us raw, so the three ways of writing the same
 * thing all arrive distinct: `:opt:` alone is `null`, `:opt: true` and
 * `:opt: false` are real booleans (YAML reads `True` and `yes` too), and a
 * value typed by hand is a string. Absent is off; present and bare is on;
 * anything spelling falsehood is off.
 *
 * Read raw on purpose: the directive library, left to convert them, turns a
 * `false` into an empty string before the convertor ever sees it -- which made
 * `:linenos: false` indistinguishable from `:linenos:`, and therefore turn
 * line numbers *on*. See `rawOptions` on CodeCellDirective.
 */
export const optionIsOn = (raw) => {
  if (raw === undefined) return false;
  if (raw === null || raw === true) return true;
  if (raw === false) return false;
  const value = String(raw).trim().toLowerCase();
  return !(value === "false" || value === "0" || value === "no" || value === "off");
};

/** The value of a `:fold:` option: "1" folded, "0" open. */
export const foldValue = (raw) => (optionIsOn(raw) ? "1" : "0");

/** Does this fence's info string carry the flag? `:fold:` beside `:linenos:`. */
export const infoHasFold = (info) => /(^|\s):fold:(\s|$)/i.test(String(info ?? ""));

/**
 * The change that records `folded` for this block, or null when the source
 * already says it.
 *
 * @param {string} src            the whole document
 * @param {{lineStart:number, indent:string, codeStart:number}} block  from listFenceBlocks
 * @param {boolean} folded        the state the reader has just asked for
 * @returns {{from:number, to:number, insert:string}|null}
 */
export function foldOptionChange(src, block, folded) {
  const openEnd = src.indexOf("\n", block.lineStart);
  if (openEnd === -1) return null;
  const openLine = src.slice(block.lineStart, openEnd);

  if (!isDirective(openLine)) {
    const has = infoHasFold(openLine);
    if (has === folded) return null;
    const insert = folded ? `${openLine.replace(/\s+$/, "")} :fold:` : openLine.replace(/(^|\s):fold:(?=\s|$)/i, "");
    return { from: block.lineStart, to: openEnd, insert };
  }

  // The options are the `:key: value` lines between the opening marker and the
  // body; `block.codeStart` is where the body begins, so they end there.
  const options = src.slice(openEnd + 1, Math.max(openEnd + 1, block.codeStart));
  const foldLine = /^[ \t]*:fold:[^\n]*\n?/m.exec(options);
  const already = foldLine ? foldValue(foldLine[0].slice(foldLine[0].indexOf(":fold:") + 6)) === "1" : false;
  if (already === folded) return null;

  if (!folded) {
    const from = openEnd + 1 + foldLine.index;
    return { from, to: from + foldLine[0].length, insert: "" };
  }
  const line = `${block.indent}:fold:`;
  if (foldLine) {
    // A hand-written `:fold: false` being turned on: the line is rewritten
    // rather than a second one added.
    const from = openEnd + 1 + foldLine.index;
    return { from, to: from + foldLine[0].length, insert: `${line}\n` };
  }
  // First option of the block: a new line right after the opening marker,
  // which keeps it with the others whether or not there are any.
  return { from: openEnd, to: openEnd, insert: `\n${line}` };
}
