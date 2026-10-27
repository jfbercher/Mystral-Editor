/**
 * Lists of figures and of tables: `{list-of-figures}`, `{list-of-tables}`.
 *
 * LaTeX has `\listoffigures` and `\listoftables`, and a document that is
 * going to be printed usually wants them. MyST has no such directive, so
 * these two are ours; the spelling follows the MyST habit of hyphenated
 * names, and the LaTeX spellings are accepted as aliases so a source written
 * by reflex still works.
 *
 * What is shown is deliberately plain: the number and the caption, nothing
 * else. A page number would be a lie -- the preview has no pages -- and a
 * section would say more about the document's structure than about its
 * figures. Every figure is listed, numbered or not: a list that silently
 * dropped the unnumbered ones would be read as a list of all of them.
 *
 * The data comes from `scanTargets`, which has already walked the whole
 * document and settled every number; this module only reads it. The LaTeX
 * export goes through the `list-of-floats` plugin in `extras/myst-plugins/`,
 * which turns the same directives into `\listoffigures` / `\listoftables`.
 */

import { Directive, directiveOptions } from "markdown-it-docutils";
import { readRule, shortCaptionOf } from "../utils/shortCaption.js";

/** The two kinds a list can be made of, and how each is written and named. */
const KINDS = {
  fig: { names: ["list-of-figures", "listoffigures"], fallback: "Figure", heading: "List of Figures" },
  table: { names: ["list-of-tables", "listoftables"], fallback: "Table", heading: "List of Tables" },
};

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/**
 * The figures (or the tables) of the document, in reading order.
 *
 * `byLine` is a Map built while walking the source top to bottom, so its
 * insertion order is the document's own and there is nothing to sort. It is
 * read before the lines are translated back to the document's numbering,
 * because a figure defined in an included file is a figure of the document
 * that includes it and its line number is of no interest here.
 */
export function collectFloats(byLine, kind, rule = null) {
  const out = [];
  if (!byLine) return out;
  for (const entry of byLine.values()) {
    if (entry?.kind !== kind) continue;
    const title = entry.title ?? "";
    out.push({
      number: entry.number ?? null,
      label: entry.label ?? null,
      title,
      // What the printed list will show, computed here exactly as the export
      // computes it: `% shortcaption: …` when the author wrote one, and
      // otherwise whatever `shortCaptions` asks for. Baked into the entry
      // rather than applied at render time, so that changing the setting
      // changes the list's signature and the chunk holding it is rebuilt.
      short: entry.short ?? shortCaptionOf(title, rule) ?? null,
    });
  }
  return out;
}

/** Both lists at once: one walk of `byLine` rather than two. */
export function collectFloatLists(byLine, shortCaptions = null) {
  const rule = readRule(shortCaptions);
  return { fig: collectFloats(byLine, "fig", rule), table: collectFloats(byLine, "table", rule) };
}

/**
 * A short signature of the lists, for the chunk cache.
 *
 * Only the chunks that hold one of these directives depend on it -- the same
 * arrangement as `{show-index}` and `{toc}`. Making every chunk depend on it
 * would re-render the whole document on each keystroke inside any caption,
 * which is exactly what the chunking is there to avoid.
 */
export function floatListsSignature(lists) {
  if (!lists) return "";
  const one = (entries) => entries.map((e) => `${e.number ?? ""}:${e.label ?? ""}:${e.short ?? ""}:${e.title}`).join("|");
  return `${one(lists.fig ?? [])}\u0000${one(lists.table ?? [])}`;
}

/** "Figure 3", or just "3" if the document renamed the kind to nothing. */
const numberText = (word, number) => (word ? `${word} ${number}` : `${number}`);

/**
 * One list, rendered.
 *
 * The caption is a link when the figure carries a label, and plain text when
 * it does not: an anchor is written only for labelled targets, so a link to
 * an unlabelled figure would go nowhere.
 */
export function renderFloatList(entries, kind, kindLabel = {}) {
  const spec = KINDS[kind];
  const word = kindLabel[kind] ?? spec.fallback;

  if (!entries || !entries.length) {
    return `<div class="myst-float-list myst-float-list-empty" data-kind="${kind}">No ${kind === "fig" ? "figures" : "tables"} in this document.</div>`;
  }

  const items = entries.map((e) => {
    const parts = ['<li class="float-list-item">'];
    // The column is written even when there is no number: a document that
    // turned numbering off, or a single `:enumerated: false`, would otherwise
    // give a list whose captions do not line up.
    const num = e.number != null && e.number !== "" ? numberText(word, e.number) : "";
    parts.push(`<span class="float-list-number">${escapeHtml(num)}</span>`);
    const title = (e.short ?? e.title)?.trim();
    const inner = title
      ? escapeHtml(title)
      : `<span class="float-list-untitled">${escapeHtml(e.label || "untitled")}</span>`;
    parts.push(
      e.label
        ? `<a class="float-list-title" href="#${escapeHtml(e.label)}">${inner}</a>`
        : `<span class="float-list-title">${inner}</span>`,
    );
    parts.push("</li>");
    return parts.join("");
  });

  return `<div class="myst-float-list" data-kind="${kind}"><ul class="float-list">${items.join("")}</ul></div>`;
}

/**
 * The directive, built once per kind.
 *
 * `:title:` is the one option: a list is usually introduced by a heading, and
 * writing one by hand above the directive would put it in the table of
 * contents, which is rarely wanted for a list of figures.
 */
function listDirective(kind) {
  return class extends Directive {
    required_arguments = 0;
    optional_arguments = 0;
    // There is nothing to put in the body, and the directive ignores whatever
    // is there -- but it accepts one. Refusing meant that a blank line left
    // between the fences, which is what a completion or a stray keystroke
    // produces, turned the list into an error frame.
    has_content = true;
    option_spec = { title: directiveOptions.unchanged };

    run(data) {
      const token = this.createToken("html_block", "", 0, { map: data.map, block: true });
      const env = this.state?.env ?? {};
      const entries = env.floatLists?.[kind] ?? [];
      const title = data.options?.title;
      const heading = title ? `<p class="float-list-heading">${escapeHtml(title)}</p>` : "";
      token.content = heading + renderFloatList(entries, kind, env.kindLabel ?? {}) + "\n";
      return [token];
    }
  };
}

export const ListOfFiguresDirective = listDirective("fig");
export const ListOfTablesDirective = listDirective("table");

/** Every spelling, canonical and alias, mapped to its directive. */
export const floatListDirectives = Object.fromEntries([
  ...KINDS.fig.names.map((n) => [n, ListOfFiguresDirective]),
  ...KINDS.table.names.map((n) => [n, ListOfTablesDirective]),
]);

/** The names, for the cache gate in text.js and for the completions. */
export const FLOAT_LIST_NAMES = [...KINDS.fig.names, ...KINDS.table.names];

/**
 * Take the `% shortcaption: …` line out of a directive's body.
 *
 * The editor's comment stripper leaves everything inside a fence alone, and
 * rightly so -- a `%` line in a `{code-cell}` is the author's code, not a
 * comment -- so a figure would otherwise print its own metadata as part of
 * the legend, and a table would be handed a line that is not a table row.
 *
 * The line is blanked rather than removed: the body's line count is what the
 * directives use to place the caption and the legend in the source map, and
 * losing a line would move every following line of the figure.
 */
export const stripShortCaption = (body) =>
  String(body ?? "").replace(/^[ \t]*%[ \t]*shortcaption[ \t]*:.*$/gim, "");

