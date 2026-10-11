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
 * @param {import("markdown-it")} md  the editor's markdown-it instance
 * @param {string} text               heading text, as written in the document
 * @returns {string} HTML
 */
export function headingInlineHtml(md, text) {
  const raw = String(text ?? "");
  if (!raw || typeof md?.renderInline !== "function") return escapeHtml(raw);
  try {
    // A heading holding a footnote or a citation needs an env the caller does
    // not have; rather than render half of it, fall back to plain text.
    return md.renderInline(raw, {}).replace(/<a\b[^>]*>|<\/a>/gi, "");
  } catch {
    return escapeHtml(raw);
  }
}
