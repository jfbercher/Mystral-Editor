/**
 * Reading a table out of the clipboard, and writing it as MyST.
 *
 * A clipboard is a menu of representations of one object. A table copied
 * from a spreadsheet or a web page is offered twice over: as `text/html`,
 * which knows what a row is, and as tab-separated `text/plain`, which knows
 * only lines. The HTML is the better source when it is there -- it carries
 * the header, the emphasis and the links -- and the plain text is a sound
 * fallback that covers a spreadsheet pasted from an application the browser
 * cannot see into.
 *
 * Everything here is a function of strings, so that the part with a right
 * answer can be checked on its own, as `csvTable.js` is. The editor's side
 * of it -- when to offer, what to replace -- lives in
 * `extensions/pasteTable.js`.
 *
 * ## Which of the three forms
 *
 * A pipe table for something small and plain: it is the lightest to read in
 * the source and what most people mean by a table in Markdown.
 *
 * `{csv-table}` when the data is regular and wide: a CSV stays legible in
 * the source, and it goes back to a spreadsheet without losing anything.
 *
 * `{list-table}` as soon as one cell holds more than flat text -- emphasis,
 * a link, a line break. Neither of the other two can carry those: a pipe
 * table has no room for a newline, and a CSV cell is a line of text.
 */

/** A cell: its text, and whether it needs more than a pipe table can give. */
const MAX_PIPE_ROWS = 12;
const MAX_PIPE_CELL = 40;

/** Inline markup worth keeping from an HTML cell, and nothing else. */
function inlineMarkdown(node) {
  let out = "";
  for (const child of node.childNodes ?? []) {
    if (child.nodeType === 3) {
      out += String(child.nodeValue).replace(/\s+/g, " ");
      continue;
    }
    if (child.nodeType !== 1) continue;
    const tag = child.tagName.toLowerCase();
    const inner = inlineMarkdown(child);
    if (tag === "br") out += "\n";
    else if (tag === "b" || tag === "strong") out += inner.trim() ? `**${inner.trim()}**` : "";
    else if (tag === "i" || tag === "em") out += inner.trim() ? `*${inner.trim()}*` : "";
    else if (tag === "code" || tag === "tt") out += inner.trim() ? `\`${inner.trim()}\`` : "";
    else if (tag === "a") {
      const href = child.getAttribute("href") ?? "";
      out += href && inner.trim() ? `[${inner.trim()}](${href})` : inner;
    } else if (tag === "p" || tag === "div") out += (out && !out.endsWith("\n") ? "\n" : "") + inner;
    else out += inner;
  }
  return out;
}

/**
 * The table a clipboard's HTML holds, or null.
 *
 * The first table only: a page copied wholesale may contain several, and
 * guessing which one was meant is worse than not guessing. A spreadsheet
 * puts exactly one there.
 *
 * `parse` is the DOM parser, passed in so that this module can be read and
 * tested outside a browser.
 */
export function tableFromHtml(html, parse) {
  if (!html || !/<table[\s>]/i.test(html)) return null;
  const doc = parse(html);
  const table = doc?.querySelector?.("table");
  if (!table) return null;

  // The table's own title, which Wikipedia and many a page put inside the
  // table as a `<caption>`. Read apart from the rows: a caption is not a
  // row, and a reader who copied a titled table expects the title to come
  // with it.
  const captionEl = table.querySelector("caption");
  const caption = captionEl ? inlineMarkdown(captionEl).replace(/\s+/g, " ").trim() : "";

  const rows = [];
  let headerRows = 0;
  // Set the moment a cell comes out of the reader looking different from its
  // own plain text: that difference is markup, and markup is what a pipe
  // table and a CSV cannot hold.
  let rich = false;
  for (const tr of table.querySelectorAll("tr")) {
    const cells = [...tr.querySelectorAll("th, td")];
    if (!cells.length) continue;
    // A row of `th` is a header row, wherever it sits: a spreadsheet marks
    // its first row that way without always wrapping it in a `thead`.
    const isHeader = cells.every((c) => c.tagName.toLowerCase() === "th");
    if (isHeader && rows.length === headerRows) headerRows += 1;
    const written = cells.map((cell) => inlineMarkdown(cell).trim());
    if (written.some((cell, i) => cell !== (cells[i].textContent ?? "").replace(/\s+/g, " ").trim())) rich = true;
    rows.push(written);
  }
  if (!rows.length) return null;
  return { rows, headerRows, rich, caption: tidyCaption(caption), source: "html" };
}

/**
 * The table a tab-separated text holds, or null.
 *
 * Two lines at least, a tab in each, and the same number of fields
 * throughout: anything less is prose that happens to contain a tab, and
 * offering to turn a paragraph into a table would be a nuisance.
 *
 * The header is not announced by this form, and the first row is taken for
 * one. That is what a spreadsheet paste almost always is, and a pipe table
 * cannot be written any other way.
 */
export function tableFromText(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  if (lines.length < 2) return null;

  // A first line with no tab, above lines that all have one, is a title:
  // that is how a titled table comes out of a page as plain text. Short, or
  // it is a paragraph sitting above a table, and turning a paragraph into a
  // caption is the kind of surprise this whole design avoids.
  let caption = "";
  if (!lines[0].includes("\t") && lines[0].trim() && lines[0].length <= 120 && lines.slice(1).every((l) => l.includes("\t"))) {
    caption = lines.shift().trim();
  }
  if (lines.length < 2) return null;
  if (!lines.every((line) => line.includes("\t"))) return null;
  const rows = lines.map((line) => line.split("\t"));
  const width = rows[0].length;
  if (width < 2 || !rows.every((row) => row.length === width)) return null;
  return { rows, headerRows: 1, rich: false, caption: tidyCaption(caption), source: "text" };
}

/**
 * A caption, tidied of what the copy left on it.
 *
 * The trailing colon of "List of towns (2023):" is punctuation introducing
 * the table in the page it came from; under the table it reads as a sentence
 * cut short. Nothing else is touched.
 */
const tidyCaption = (text) => String(text ?? "").trim().replace(/\s*:$/, "");

/**
 * Does any cell hold more than a pipe table or a CSV can carry?
 *
 * Told by the extraction rather than guessed from the text. Sniffing the
 * cells for markdown characters reads `3*4` as emphasis and sends an
 * arithmetic table to a list-table for nothing; the HTML reader, on the
 * other hand, knows perfectly well when it has just written a `**` of its
 * own, and says so.
 */
const isRich = (table, rows) => Boolean(table.rich) || rows.some((row) => row.some((cell) => cell.includes("\n")));

/** Is this small and plain enough to read as a pipe table? */
const fitsPipes = (rows) =>
  rows.length <= MAX_PIPE_ROWS && rows.every((row) => row.every((cell) => cell.length <= MAX_PIPE_CELL && !cell.includes("\n")));

/** Pad to a rectangle; a short row means empty cells at its end. */
function rectangular(rows) {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return rows.map((row) => (row.length === width ? row : [...row, ...Array(width - row.length).fill("")]));
}

/**
 * A pipe table, whose first row is its header -- it can have no other.
 *
 * With a caption it is wrapped in `{table}`, which is the directive whose
 * body is a markdown table and whose argument is its title. A pipe table
 * has nowhere of its own to put one, and dropping the title would lose
 * what the reader copied.
 */
function asPipes(rows, caption) {
  const cells = rows.map((row) => row.map((cell) => cell.replace(/\|/g, "\\|")));
  const [head, ...body] = cells;
  const line = (row) => `| ${row.join(" | ")} |`;
  const table = [line(head), `|${head.map(() => " --- ").join("|")}|`, ...body.map(line)].join("\n");
  return caption ? `:::{table} ${caption}\n${table}\n:::` : table;
}

/** A CSV cell: quoted when it holds a comma, a quote or a newline. */
const csvCell = (cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);

function asCsvTable(rows, headerRows, caption) {
  const body = rows.map((row) => row.map(csvCell).join(", ")).join("\n");
  const head = headerRows > 0 ? `:header-rows: ${headerRows}\n` : "";
  return `:::{csv-table}${caption ? ` ${caption}` : ""}\n${head}\n${body}\n:::`;
}

/**
 * A list-table, which is the only one of the three that can hold anything.
 *
 * A cell is a list item, and a multi-line cell is an item whose following
 * lines are indented under it -- which is how a line break survives the
 * journey at all.
 */
function asListTable(rows, headerRows, caption) {
  const item = (cell) => {
    const [first, ...rest] = String(cell).split("\n");
    return [`    - ${first}`, ...rest.map((line) => `      ${line}`)].join("\n");
  };
  const body = rows.map((row) => [`  * ${item(row[0]).trimStart()}`, ...row.slice(1).map(item)].join("\n")).join("\n");
  const head = headerRows > 0 ? `:header-rows: ${headerRows}\n` : "";
  return `:::{list-table}${caption ? ` ${caption}` : ""}\n${head}\n${body}\n:::`;
}

/**
 * The MyST for a table read from the clipboard, and the name of the form
 * chosen, so that the editor can say what it did.
 */
export function tableToMyst(table) {
  const rows = rectangular(table.rows);
  const headerRows = Math.min(table.headerRows ?? 0, rows.length);
  const caption = tidyCaption(table.caption);
  if (isRich(table, rows)) return { text: asListTable(rows, headerRows, caption), kind: "list-table" };
  // Exactly one header row for a pipe table, and that is not a detail: its
  // first row *is* its header, so writing a headerless table that way would
  // promote a row of data without saying so. A CSV can declare none.
  if (fitsPipes(rows) && headerRows === 1) return { text: asPipes(rows, caption), kind: caption ? "table" : "pipe table" };
  return { text: asCsvTable(rows, headerRows, caption), kind: "csv-table" };
}
