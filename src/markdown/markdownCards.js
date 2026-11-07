/**
 * Cards and grids: `{card}`, `{grid}` and `{grid-item}`.
 *
 * mystmd knows all three and `markdown-it-docutils` knows none of them, so a
 * document that uses them showed, until now, a raw block in the preview and
 * the real thing on the site. They are written here as the specification
 * describes them -- https://mystmd.org/guide/dropdowns-cards-and-tabs -- with
 * the sphinx-design body syntax supported alongside the options, since the
 * page documents both.
 *
 * A word on what they are *for*, because it decides the markup. A card is a
 * titled block with an optional header and footer, which may as a whole be a
 * link. A grid is a responsive row: its argument gives the number of columns
 * at four screen widths, and an item may span several of them. Neither
 * carries meaning the way an admonition does -- nothing here says "warning"
 * -- so the markup stays plain and the stylesheet does the work.
 */
import { Directive, directiveOptions } from "markdown-it-docutils";

/** The four breakpoints the specification names, in order. */
const BREAKPOINTS = ["xs", "md", "lg", "xl"];

/** `:class: a b` in any of the shapes the options may arrive in. */
const classList = (value) =>
  []
    .concat(value ?? [])
    .flatMap((c) => String(c).split(/\s+/))
    .filter(Boolean);

/**
 * A column count per breakpoint, from the grid's argument.
 *
 * `1 1 2 3` is the documented form -- smallest, medium, large, extra-large.
 * Fewer numbers repeat the last, which is what a reader writing `2` alone
 * means, and anything unreadable falls back to a single column rather than
 * breaking the document.
 */
export function columnsFromArgument(arg) {
  const numbers = String(arg ?? "")
    .trim()
    .split(/\s+/)
    .map((n) => Number.parseInt(n, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!numbers.length) return [1, 1, 1, 1];
  return BREAKPOINTS.map((_, i) => numbers[Math.min(i, numbers.length - 1)]);
}

/**
 * The three parts of a sphinx-design card body.
 *
 * A line of `^^^` ends the header, a line of `+++` begins the footer, and a
 * body with neither is all body. Written as a split rather than a parse: the
 * markers are whole lines by definition, and the parts are parsed afterwards
 * like any other body.
 */
export function splitCardBody(body) {
  const lines = String(body ?? "").split("\n");
  const headerEnd = lines.findIndex((l) => l.trim() === "^^^");
  const footerStart = lines.findIndex((l, i) => i > headerEnd && l.trim() === "+++");
  const header = headerEnd >= 0 ? lines.slice(0, headerEnd).join("\n") : null;
  const start = headerEnd >= 0 ? headerEnd + 1 : 0;
  const end = footerStart >= 0 ? footerStart : lines.length;
  const footer = footerStart >= 0 ? lines.slice(footerStart + 1).join("\n") : null;
  return { header, body: lines.slice(start, end).join("\n"), footer, headerLines: start };
}

export class CardDirective extends Directive {
  required_arguments = 0;
  optional_arguments = 1; // the title
  final_argument_whitespace = true;
  has_content = true;

  option_spec = {
    header: directiveOptions.unchanged,
    footer: directiveOptions.unchanged,
    // The specification's own name is `url`, with `link` as its alias; both
    // appear in its examples, so both are read here.
    url: directiveOptions.unchanged,
    link: directiveOptions.unchanged,
    class: directiveOptions.class_option,
    label: directiveOptions.unchanged,
    name: directiveOptions.unchanged,
  };

  run(data) {
    const options = data.options ?? {};

    // mystmd requires a card to have a body -- without one it emits
    // `mystDirectiveError: required body not provided for directive: card`
    // and no card at all. A preview that accepted it quietly is a preview
    // that lies: the card looked right here and vanished from the export,
    // taking the pairing of the whole `.tex` down with it. So the editor
    // refuses it in the same place and in the same terms.
    if (!String(data.body ?? "").trim()) {
      // An `html_block` rather than a tag token: a message has to be *written*,
      // and a token with no children renders as an empty element.
      const message = "<strong>card</strong>: a body is required. mystmd drops a card that has none, so this one would not reach an export.";
      return [
        this.createToken("html_block", "", 0, {
          map: data.map,
          block: true,
          content: `<div class="myst-directive-error">${message}</div>\n`,
        }),
      ];
    }

    const parts = splitCardBody(data.body);
    const header = options.header ?? parts.header;
    const footer = options.footer ?? parts.footer;
    const url = String(options.url ?? options.link ?? "").trim();
    const title = data.args[0];
    const bodyStart = data.bodyMap[0] + (parts.header !== null ? parts.headerLines : 0);

    // A link makes the whole card clickable, which is what the specification
    // says it does. An <a> around blocks is valid HTML5, and keeps the one
    // behaviour a reader expects of a card that announces itself as a link.
    const tag = url ? "a" : "div";
    const open = this.createToken("card_open", tag, 1, { map: data.map, block: true });
    open.attrSet("class", ["myst-card", url ? "card-link" : null, ...classList(options.class)].filter(Boolean).join(" "));
    if (url) {
      open.attrSet("href", url);
      // Only an external link leaves the application; an internal one is a
      // reference inside the document and must stay in the pane.
      if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
        open.attrSet("target", "_blank");
        open.attrSet("rel", "noopener noreferrer");
      }
    }
    const label = options.label ?? options.name;
    if (label) open.attrSet("id", String(label));

    const tokens = [open];

    const part = (cls, tagName, content, line) => {
      if (content == null || String(content).trim() === "") return;
      const partOpen = this.createToken(`card_${cls}_open`, tagName, 1, { block: true });
      partOpen.attrSet("class", `card-${cls}`);
      tokens.push(partOpen);
      tokens.push(...this.nestedParse(String(content), line));
      tokens.push(this.createToken(`card_${cls}_close`, tagName, -1, { block: true }));
    };

    part("header", "header", header, data.bodyMap[0]);

    if (title) {
      const titleOpen = this.createToken("card_title_open", "div", 1, { block: true });
      titleOpen.attrSet("class", "card-title");
      tokens.push(titleOpen);
      tokens.push(
        this.createToken("inline", "", 0, { map: [data.map[0], data.map[0]], content: title, children: [] }),
      );
      tokens.push(this.createToken("card_title_close", "div", -1, { block: true }));
    }

    const bodyOpen = this.createToken("card_body_open", "div", 1, { block: true });
    bodyOpen.attrSet("class", "card-body");
    tokens.push(bodyOpen);
    tokens.push(...this.nestedParse(parts.body, bodyStart));
    tokens.push(this.createToken("card_body_close", "div", -1, { block: true }));

    part("footer", "footer", footer, data.bodyMap[0]);

    tokens.push(this.createToken("card_close", tag, -1, { block: true }));
    return tokens;
  }
}

export class GridDirective extends Directive {
  required_arguments = 0;
  optional_arguments = 1; // the column counts
  final_argument_whitespace = true;
  has_content = true;

  option_spec = {
    class: directiveOptions.class_option,
    label: directiveOptions.unchanged,
    name: directiveOptions.unchanged,
    // Read and ignored for now: a grid may be enumerated, and nothing in this
    // editor numbers one yet. Declared so that writing it is not an error.
    enumerated: directiveOptions.unchanged,
    numbered: directiveOptions.unchanged,
    enumerator: directiveOptions.unchanged,
    number: directiveOptions.unchanged,
    // Not in the specification, and in sphinx-design's: accepted so that a
    // document carried over from there is not rejected over a gap size.
    gutter: directiveOptions.unchanged,
  };

  run(data) {
    const options = data.options ?? {};
    const [xs, md, lg, xl] = columnsFromArgument(data.args[0]);
    const open = this.createToken("grid_open", "div", 1, { map: data.map, block: true });
    open.attrSet("class", ["myst-grid", ...classList(options.class)].join(" "));
    // The counts travel as custom properties and the stylesheet holds the
    // breakpoints: four media queries written once, rather than inline styles
    // that could not express a breakpoint at all.
    open.attrSet("style", `--grid-xs:${xs};--grid-md:${md};--grid-lg:${lg};--grid-xl:${xl}`);
    const label = options.label ?? options.name;
    if (label) open.attrSet("id", String(label));

    return [open, ...this.nestedParse(data.body, data.bodyMap[0]), this.createToken("grid_close", "div", -1, { block: true })];
  }
}

export class GridItemDirective extends Directive {
  required_arguments = 0;
  optional_arguments = 1;
  final_argument_whitespace = true;
  has_content = true;

  option_spec = {
    columns: directiveOptions.unchanged,
    class: directiveOptions.class_option,
    label: directiveOptions.unchanged,
    name: directiveOptions.unchanged,
  };

  run(data) {
    const options = data.options ?? {};
    const open = this.createToken("grid_item_open", "div", 1, { map: data.map, block: true });
    open.attrSet("class", ["myst-grid-item", ...classList(options.class)].join(" "));
    // `:columns:` is a span out of the twelve the specification counts in, so
    // a grid holding items that declare one is written `{grid} 1 1 12 12`.
    const span = Number.parseInt(String(options.columns ?? "").trim(), 10);
    if (Number.isFinite(span) && span > 0) open.attrSet("style", `--span:${Math.min(span, 12)}`);
    const label = options.label ?? options.name;
    if (label) open.attrSet("id", String(label));

    return [
      open,
      ...this.nestedParse(data.body, data.bodyMap[0]),
      this.createToken("grid_item_close", "div", -1, { block: true }),
    ];
  }
}

export const layoutDirectives = {
  card: CardDirective,
  grid: GridDirective,
  "grid-item": GridItemDirective,
  // The specification's own alias: a card placed in a grid, which is what a
  // card already is here.
  "grid-item-card": CardDirective,
};
