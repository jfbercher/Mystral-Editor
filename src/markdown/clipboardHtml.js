// Both packages ship an ESM build and the bundler takes it, so each import
// is the shape that build actually exports -- a default for Turndown, named
// bindings for the plugin, which has no default at all.
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

/**
 * Turning pasted HTML into Markdown.
 *
 * The clipboard's `text/html` is the richest thing a web page or a word
 * processor offers: headings, lists, emphasis, links, quotes, code. Pasted
 * as text it arrives flattened, every one of those lost, and putting them
 * back by hand is the chore this answers.
 *
 * ## Turndown rather than our own
 *
 * The conversion itself is a long tail of rules about whitespace, nesting
 * and the shapes real pages take -- a `<p>` inside a `<li>`, a `<br>` at the
 * end of a block, a `<span>` wrapping half a word. Turndown knows them, and
 * its GFM plugin knows tables. What is written here is only what it cannot
 * know: what *this* editor wants out of it.
 *
 * ## What is cleaned afterwards
 *
 * A word processor leaves non-breaking spaces where it meant ordinary ones,
 * which look identical in the editor and refuse to wrap in the preview. A
 * page leaves runs of empty blocks. Both are swept here rather than taught
 * to Turndown, because they are properties of the paste and not of the
 * conversion.
 *
 * ## What is not done, and why
 *
 * An image keeps the address it had on the page. Writing it to disk, as a
 * pasted image is written, would mean fetching it -- a network call, from a
 * document, in an editor -- and that is a decision of its own rather than a
 * detail of this one. The address works while the page does, and the
 * document says so plainly rather than pretending otherwise.
 */

/** Built once: the service is stateless between calls and not cheap to make. */
let service = null;

function turndown() {
  if (service) return service;
  service = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    strongDelimiter: "**",
    linkStyle: "inlined",
  });
  service.use(gfm);

  // What a page carries for its own layout and what a document gains
  // nothing from: scripts, styles, navigation furniture. Turndown drops
  // unknown elements' tags but keeps their text, which for a `<nav>` means
  // a paragraph of menu entries in the middle of the document.
  service.remove(["script", "style", "noscript", "nav", "aside", "footer", "form", "button", "iframe"]);

  // Wikipedia's own furniture, which a copy brings along: the "[edit]" link
  // beside every heading. Named here as a courtesy to the commonest source
  // of a pasted table or section, and harmless anywhere else -- nothing but
  // Wikipedia calls a thing an editsection.
  service.addRule("editSection", {
    filter: (node) => node.nodeType === 1 && /(^|\s)mw-editsection(\s|$)/.test(node.getAttribute?.("class") ?? ""),
    replacement: () => "",
  });

  // A footnote marker copied from Wikipedia -- `[61]` linked to the bottom
  // of the page -- becomes a link to a page one no longer has. The text is
  // kept, the link is not: the number still reads as a reference, and
  // nothing points into the void.
  service.addRule("wikiReference", {
    filter: (node) => node.nodeName === "A" && /^\[\d+\]$/.test(node.textContent.trim()),
    replacement: (content) => content,
  });

  return service;
}

/** Characters a word processor leaves behind, meaning the ordinary ones. */
const TIDY = [
  [/ /g, " "], // non-breaking space
  [/[‘’]/g, "'"], // curly apostrophes, which MyST has no use for
  [/​/g, ""], // zero-width space
  [/[ \t]+$/gm, ""], // trailing spaces, which markdown reads as a line break
  [/\n{3,}/g, "\n\n"], // runs of empty blocks
  // Turndown writes `-   item`, which is valid and which nothing else in
  // this editor writes. One space, so a pasted list looks like a list typed
  // here; the four-space indent of a nested one is untouched and still deep
  // enough to nest.
  [/^(\s*)([-*+])   (?=\S)/gm, "$1$2 "],
];

/**
 * The Markdown a fragment of HTML becomes, or "" when it holds nothing.
 *
 * @param {string} html the clipboard's `text/html`
 */
export function htmlToMarkdown(html) {
  if (!html || !html.trim()) return "";
  let text = "";
  try {
    text = turndown().turndown(html);
  } catch (err) {
    console.warn("[paste] the HTML could not be converted:", err);
    return "";
  }
  for (const [pattern, replacement] of TIDY) text = text.replace(pattern, replacement);
  return text.trim();
}

/**
 * Is this HTML worth converting at all?
 *
 * A clipboard almost always carries `text/html`, even for a word copied
 * from a paragraph: the browser wraps the selection in a `<meta>` and a
 * `<span>` and calls it HTML. Offering to convert that would mean offering
 * on every paste, which is noise.
 *
 * So the test is for markup that *says something* -- a heading, a list, a
 * quote, a link, emphasis, code, an image -- and not merely for the
 * presence of tags. A table is deliberately absent from the list: a table
 * is read by `clipboardTable.js`, which picks a better form for it than a
 * pipe table.
 *
 * @param {Document} doc the parsed clipboard HTML
 */
export function worthConverting(doc) {
  const body = doc?.body;
  if (!body) return false;
  const meaningful = "h1, h2, h3, h4, h5, h6, ul, ol, li, blockquote, pre, code, a[href], img, b, strong, i, em, hr";
  return Boolean(body.querySelector(meaningful));
}

/**
 * Does this fragment hold a table and nothing else that matters?
 *
 * The question decides which of the two offers is made. A table on its own
 * goes to the table reader, which chooses between a pipe table, a
 * `{csv-table}` and a `{list-table}` by what the cells hold -- a better
 * answer than the pipe table Turndown would write. A table *among* prose
 * goes through the HTML conversion with everything else, because splitting
 * the two would mean losing one of them.
 *
 * @param {Document} doc the parsed clipboard HTML
 */
export function tableOnly(doc) {
  const body = doc?.body;
  const table = body?.querySelector("table");
  if (!table) return false;
  // Measured on a copy of the body, so the document the caller holds is
  // untouched: the same `doc` is read again afterwards.
  const copy = body.cloneNode(true);
  for (const found of copy.querySelectorAll("table")) found.remove();
  return !copy.textContent.trim() && !copy.querySelector("img, h1, h2, h3, h4, h5, h6, ul, ol, pre");
}
