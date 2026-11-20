/**
 * Reading the body of a `{csv-table}`.
 *
 * Separate from the directive because it is the one part with a right answer
 * that can be checked: the directive assembles tokens, this reads text, and
 * the cases that matter -- a quoted field holding the delimiter, a doubled
 * quote, a newline inside a field -- are testable on their own.
 *
 * The options are mystmd's, and behave as mystmd's do, because the preview
 * and the export must read the same document the same way. mystmd hands the
 * body to `csv-parse` with `delimiter`, `quote`, `escape` and `ltrim` set
 * from the directive's options; what follows is that behaviour, written out.
 *
 * Note `delim` and not `delimiter`: the option is spelled the short way, and
 * the two special values `tab` and `space` stand for the whitespace they
 * name. `keepspace` turns off the trimming that otherwise removes the space
 * after a separator, which is why `a, b` has cells `a` and `b` by default.
 */

/** `delim: tab` and `delim: space` name characters that cannot be written. */
function delimiterOf(value) {
  const given = value === undefined || value === null || value === "" ? "," : String(value);
  if (given === "tab") return "\t";
  if (given === "space") return " ";
  return given.slice(0, 1);
}

/**
 * Split CSV text into rows of cells.
 *
 * A hand-written scanner rather than a library: the whole of it is the three
 * rules below, and a dependency whose behaviour we would have to pin to
 * mystmd's anyway is a dependency that can drift from it.
 *
 *   - a field opens with the quote character only when the quote is its first
 *     character; elsewhere a quote is an ordinary character, so `a"b` is
 *     three characters and not an error;
 *   - inside a quoted field, the escape character before a quote makes a
 *     literal quote. With the default settings the two are the same
 *     character, which is why a doubled `""` is the usual spelling;
 *   - a newline ends a row unless it is inside a quoted field.
 *
 * @param {string} text
 * @param {{delim?: string, quote?: string, escape?: string, keepspace?: boolean}} [options]
 * @returns {string[][]} rows, each an array of cells
 */
export function parseCsv(text, options = {}) {
  const delim = delimiterOf(options.delim);
  const quote = String(options.quote ?? '"').slice(0, 1) || '"';
  const escape = String(options.escape ?? '"').slice(0, 1) || '"';
  const trim = !options.keepspace;

  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  let started = false; // something has been written to the current cell

  const source = String(text ?? "").replace(/\r\n?/g, "\n");

  const endCell = () => {
    row.push(trim ? cell.replace(/^[ \t]+/, "") : cell);
    cell = "";
    started = false;
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];

    if (quoted) {
      // The escape character counts only when what follows is a quote or
      // another escape; before anything else it is a character like another,
      // which is what lets a Windows path survive `escape: \`.
      if (ch === escape && (source[i + 1] === quote || source[i + 1] === escape)) {
        cell += source[i + 1];
        i += 1;
        continue;
      }
      if (ch === quote) {
        quoted = false;
        continue;
      }
      cell += ch;
      continue;
    }

    if (ch === quote && !started) {
      quoted = true;
      started = true;
      continue;
    }
    if (ch === delim) {
      endCell();
      continue;
    }
    if (ch === "\n") {
      endRow();
      continue;
    }
    // Leading whitespace is dropped by the trim at the end of the cell, so it
    // must not count as a start: `a, "b, c"` has a quoted second field.
    if (!(trim && !started && (ch === " " || ch === "\t"))) started = true;
    cell += ch;
  }

  // A trailing newline closes the last row and opens nothing: a file that
  // ends with one does not gain an empty row from it.
  if (cell !== "" || row.length) endRow();

  return rows;
}

/**
 * Pad every row to the widest, so the table is rectangular.
 *
 * A short row is a row with empty cells at its end, which is what a reader
 * means by it; a table whose rows differ in length is not something HTML can
 * draw at all.
 */
export function rectangular(rows) {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return rows.map((row) => (row.length === width ? row : [...row, ...Array(width - row.length).fill("")]));
}
