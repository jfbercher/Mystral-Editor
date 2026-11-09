/**
 * Heading text rendered as inline Markdown, for the places that show a heading
 * outside the document: the side outline and the `{toc}` directive.
 *
 * Both showed the raw source -- `**Résultats**` with its asterisks, `$x^2$`
 * unrendered -- because both printed the text as it stands in the file. The
 * heading tree stores source text on purpose, since that is what the numbering
 * and the reordering work on; rendering belongs here, at the point of display.
 *
 * Anchors are removed, their content kept: an entry of a table of contents is
 * itself a link, and an `<a>` nested in another is invalid and swallows the
 * click. Everything else -- emphasis, code, maths, roles -- is kept.
 */

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/**
 * Rendered headings, kept from one render to the next.
 *
 * The outline re-renders whenever the heading tree is written, which used to be
 * every keystroke: a hundred headings, a hundred inline renders through the
 * editor's full markdown-it -- roles, maths, citations and all. Measured under
 * Tauri on a 174 kB document with a hundred headings, that was **140 ms per
 * change** -- 157 ms with the panel open against 15 ms with it closed. A heading
 * renders to the same HTML as long as its text is the same, so the answer is
 * kept rather than recomputed, and Preact then skips the DOM write too, finding
 * the same string in `dangerouslySetInnerHTML`.
 *
 * Keyed by text alone, with the instance held beside it: a different markdown-it
 * is a different renderer, so its arrival empties the table rather than serving
 * the previous one's answers.
 */
const rendered = new Map();
let renderedBy = null;
/** Enough for any outline; a document is reopened long before this is reached. */
const RENDERED_MAX = 2000;

/**
 * @param {import("markdown-it")} md  the editor's markdown-it instance
 * @param {string} text               heading text, as written in the document
 * @returns {string} HTML
 */
export function headingInlineHtml(md, text) {
  const raw = String(text ?? "");
  if (!raw || typeof md?.renderInline !== "function") return escapeHtml(raw);

  if (md !== renderedBy) {
    rendered.clear();
    renderedBy = md;
  }
  const known = rendered.get(raw);
  if (known !== undefined) return known;

  let html;
  try {
    // A heading holding a footnote or a citation needs an env the caller does
    // not have; rather than render half of it, fall back to plain text.
    html = md.renderInline(raw, {}).replace(/<a\b[^>]*>|<\/a>/gi, "");
  } catch {
    html = escapeHtml(raw);
  }
  if (rendered.size >= RENDERED_MAX) rendered.clear();
  rendered.set(raw, html);
  return html;
}
