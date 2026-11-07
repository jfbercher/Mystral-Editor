/**
 * Make `{card}` and `{grid}` survive a LaTeX, PDF or Word export.
 *
 * Measured before being written: `myst-to-tex` reports "Unhandled LaTeX
 * conversion" for `card`, `grid`, `grid-item` and `details`, and drops each
 * node *with its children*. A document whose content lives in cards therefore
 * exports a hole -- not a degraded box, nothing at all. Typst keeps the body
 * and loses the header; the site, of course, is fine, since cards are its
 * native idiom.
 *
 * What this does, when it is asked to: a card becomes an admonition, which
 * every writer knows; a grid becomes a row of `minipage`s whose widths come
 * from the grid's own column counts and each item's `:columns:`.
 *
 * ── Why it has to be asked ────────────────────────────────────────────────
 *
 * A transform is told nothing about the format being built: `opts` is
 * undefined and the vfile names only the source. And mystmd 1.12 accepts no
 * renderer from a plugin -- only directives, roles and transforms -- so the
 * LaTeX writer cannot simply be taught these nodes. Converting
 * unconditionally would therefore flatten the cards of the *site* as well,
 * for everyone, including a build run from CI, which is the one place cards
 * are at their best.
 *
 * So the conversion runs only when `MYSTRAL_STATIC=1` is in the environment.
 * The editor sets it for its own `.tex`, `.pdf` and `.docx` exports; nothing
 * else sets it, so `myst start` and any build of yours are untouched. To get
 * the same treatment from your own command line:
 *
 *   MYSTRAL_STATIC=1 myst build --pdf
 *
 * ── The minipage, and what it costs ───────────────────────────────────────
 *
 * `multicols` was the other candidate and was measured too: it balances, it
 * breaks across pages, and it makes equal columns only -- it cannot express
 * `:columns: 4` beside `:columns: 8`. It also *drops floats silently*
 * (`Floats and marginpars not allowed inside multicols`), where a minipage
 * refuses them loudly (`Not in outer par mode`). A figure inside a grid has
 * to stop floating either way, which the `.tex` post-processing does on the
 * region these markers delimit.
 */

/** Plain text of an mdast subtree. */
function textOf(node) {
  if (!node) return "";
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(textOf).join("");
}

/** Only when asked; see the note above. */
const wanted = () => process.env.MYSTRAL_STATIC === "1";

/**
 * A card, as an admonition.
 *
 * The title is the card's own, or its header when it has no title. A header
 * that is not the title stays as the first paragraph, a footer becomes the
 * last one, and the link of a clickable card is written out: on paper a card
 * one could have clicked is a card whose address has to be readable.
 */
function cardToAdmonition(node) {
  const take = (type) => {
    const found = (node.children ?? []).find((c) => c.type === type);
    if (found) node.children = node.children.filter((c) => c !== found);
    return found;
  };

  const cardTitle = take("cardTitle");
  const header = take("header");
  const footer = take("footer");

  const titleText = textOf(cardTitle).trim() || textOf(header).trim();
  const body = [...(node.children ?? [])];

  // A header that lost to a title is not thrown away: it said something.
  if (cardTitle && header) body.unshift(...(header.children ?? []));
  if (footer) body.push({ type: "paragraph", children: [{ type: "emphasis", children: footer.children ?? [] }] });
  if (node.url) {
    body.push({
      type: "paragraph",
      children: [{ type: "link", url: node.url, children: [{ type: "text", value: node.url }] }],
    });
  }

  node.type = "admonition";
  node.kind = "note";
  node.children = [
    { type: "admonitionTitle", children: cardTitle?.children ?? header?.children ?? [{ type: "text", value: titleText }] },
    ...body,
  ];
}

/**
 * A `{dropdown}`, as an admonition.
 *
 * mystmd writes it as a `details` node -- the HTML element, which is exactly
 * right for a page and means nothing on paper -- and the LaTeX writer drops
 * it with its content. Paper has no folding, so what was hidden is simply
 * shown, under the title the `summary` carried.
 *
 * An admonition that is a dropdown (`:class: dropdown`) is not concerned: it
 * stays an `admonition` node and already reaches the `.tex` as a box.
 */
function detailsToAdmonition(node) {
  const children = node.children ?? [];
  const summary = children.find((c) => c.type === "summary");
  const body = children.filter((c) => c !== summary);
  node.type = "admonition";
  node.kind = "note";
  node.children = [
    { type: "admonitionTitle", children: summary?.children ?? [{ type: "text", value: "Details" }] },
    ...body,
  ];
}

/** The span an item claims, out of the grid's columns. */
const spanOf = (item) => {
  const n = Number.parseInt(item?.columns, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
};

/**
 * A grid, as rows of minipages.
 *
 * The column count is the one the grid declares for the widest screen: print
 * has one width, and it is the generous one. Items fill a row until it is
 * full, exactly as the browser lays them out, and a row that ends short
 * leaves its space at the right rather than stretching -- a half-empty row of
 * stretched boxes reads as a mistake.
 */
function gridToMinipages(grid) {
  const columns = Array.isArray(grid.columns) ? grid.columns : [1, 1, 1, 1];
  const total = Math.max(1, Number(columns[columns.length - 1]) || 1);
  const items = grid.children ?? [];

  const rows = [];
  let row = [];
  let used = 0;
  for (const item of items) {
    const span = Math.min(spanOf(item), total);
    if (used + span > total && row.length) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push({ item, span });
    used += span;
  }
  if (row.length) rows.push(row);

  const out = [];
  // `\mystgridrow` and its fellows are defined in the preamble the export
  // writes, so the shape of a grid can be changed in one place -- and so that
  // the post-processing has something unmistakable to find when it has to
  // stop the figures inside from floating.
  out.push({ type: "raw", tex: "\n\\mystgridbegin%\n" });
  rows.forEach((cells, rowIndex) => {
    cells.forEach(({ item, span }, i) => {
      const fraction = (span / total).toFixed(4);
      out.push({ type: "raw", tex: `\\mystgridcell{${fraction}}%\n` });
      // A grid-item is a wrapper and nothing else; a card inside a grid has
      // already become an admonition by now and goes in whole.
      out.push(...(item.type === "grid-item" ? (item.children ?? []) : [item]));
      out.push({ type: "raw", tex: `\n\\mystgridendcell${i < cells.length - 1 ? "\\hfill" : ""}%\n` });
    });
    if (rowIndex < rows.length - 1) out.push({ type: "raw", tex: "\n\\mystgridrowbreak%\n" });
  });
  out.push({ type: "raw", tex: "\n\\mystgridend%\n" });
  return out;
}

const cardsAndGrids = {
  name: "Cards and grids for static exports",
  // Project stage, for the reason the exercise plugin gives: enumeration and
  // reference resolution have already run, so nothing here can disturb a
  // number a cross-reference points at.
  stage: "project",
  plugin: () => (tree) => {
    if (!wanted()) return tree;

    const walk = (node) => {
      for (const child of node.children ?? []) walk(child);
      // Cards first, so that a card inside a grid is already an admonition
      // when the grid is flattened around it.
      for (const child of node.children ?? []) {
        if (child.type === "card") cardToAdmonition(child);
        else if (child.type === "details") detailsToAdmonition(child);
      }
      if (!node.children?.some((c) => c.type === "grid")) return;
      node.children = node.children.flatMap((c) => (c.type === "grid" ? gridToMinipages(c) : [c]));
    };
    walk(tree);
    return tree;
  },
};

const plugin = { name: "Mystral Editor — cards and grids", transforms: [cardsAndGrids] };
export default plugin;
