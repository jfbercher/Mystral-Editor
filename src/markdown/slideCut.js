/**
 * Where a document is cut into slides.
 *
 * One function, used by every part of the feature: the slide view, the
 * fullscreen presentation and the HTML export. That is the point of putting it
 * in a file of its own and keeping it free of the DOM and of the editor -- if
 * the view and the export ever disagreed about where a cut falls, what was
 * rehearsed would not be what is projected.
 *
 * The markers are horizontal rules, told apart by how they were written:
 *
 *   ---     ends a slide
 *   ----    ends a *fragment* of a slide
 *   ***     stays a horizontal rule, and cuts nothing
 *
 * markdown-it renders all three as a bare `<hr>`, but keeps the exact run of
 * characters in `token.markup`, which is what `markdownSlideBreaks.js` turns
 * into a class. The cut then reads the rendered DOM rather than the source,
 * which is what lets it run on content that came from an `{include}` or from a
 * cell's output.
 *
 * Fragments are cumulative: what has been revealed stays on screen. That is
 * what one wants in a lecture, where a list is uncovered point by point
 * without erasing what came before. Sub-slides that *replace* each other would
 * be a different feature, and not the one aimed at.
 */

/** `slide`, `fragment`, or null for anything that is not a break. */
export function breakKind(node) {
  if (!node || String(node.tagName ?? "").toUpperCase() !== "HR") return null;
  const cls = ` ${String(node.className ?? "")} `;
  if (cls.includes(" slide-break ")) return "slide";
  if (cls.includes(" fragment-break ")) return "fragment";
  return null;
}

/** The level of a heading element, or 0. */
function headingLevel(node) {
  const m = /^H([1-6])$/.exec(String(node?.tagName ?? "").toUpperCase());
  return m ? Number(m[1]) : 0;
}

/**
 * Cut an ordered list of top-level rendered nodes into slides.
 *
 * @param {Iterable<Element>} nodes  the rendered blocks, in document order
 * @param {{ cutAtHeading?: number }} [opts]
 *   `cutAtHeading: 2` also starts a slide at every `h1` and `h2`, which is what
 *   makes a document that was never written as a deck presentable without
 *   touching it. 0 disables it, and explicit markers always cut.
 * @returns {{ index: number, fragments: Element[][], nodes: Element[] }[]}
 *   `fragments[0]` is what the slide shows on arrival; the rest are revealed
 *   one at a time. `nodes` is the whole slide, which is what printing and the
 *   export want.
 */
export function cutIntoSlides(nodes, { cutAtHeading = 0 } = {}) {
  const slides = [];
  let fragments = null;

  const open = () => {
    fragments = [[]];
    slides.push(fragments);
  };
  const empty = () => fragments.every((f) => f.length === 0);

  open();
  for (const node of nodes) {
    const kind = breakKind(node);

    if (kind === "slide") {
      // A marker on an empty slide reopens it rather than adding one: two
      // rules in a row, or a rule opening the document, should not produce a
      // blank slide the author never wrote.
      if (!empty()) open();
      continue;
    }
    if (kind === "fragment") {
      if (fragments[fragments.length - 1].length > 0) fragments.push([]);
      continue;
    }

    const level = headingLevel(node);
    if (cutAtHeading && level && level <= cutAtHeading && !empty()) open();

    fragments[fragments.length - 1].push(node);
  }

  return slides
    .filter((f) => f.some((part) => part.length > 0))
    .map((f, index) => ({
      index,
      fragments: f.filter((part) => part.length > 0),
      nodes: f.flat(),
    }));
}

/** How many steps a deck takes to go through: slides plus their fragments. */
export function stepCount(slides) {
  return slides.reduce((n, s) => n + s.fragments.length, 0);
}

/**
 * Split a document's text at slide boundaries.
 *
 * This is the source-side half of the same decision `cutIntoSlides` makes on
 * the rendered DOM, and it exists so that the two cannot disagree: in slide
 * view the preview's render chunks *are* the slides, which is what lets a
 * slide be a box in CSS with no node ever moved. Moving nodes after the render
 * would be undone on each keystroke, and -- worse -- re-rendering a cell host
 * destroys its editor, its output and its link to the kernel.
 *
 * The contract is the one `text.js` already uses for its heading split: the
 * pieces concatenate back to the original text, and every piece after the
 * first starts with the newline that precedes its marker.
 *
 * A `----` is *not* a boundary: a fragment belongs to the slide it is part of.
 * Nor is the closing `---` of a frontmatter block, which is skipped before the
 * split. A `---` inside a fenced block is not one either, and needs no care
 * here: the caller merges a chunk whose fences are unbalanced into the next.
 */
export function splitTextForSlides(text, { cutAtHeading = 0 } = {}) {
  const src = String(text ?? "");
  const fm = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?=\r?\n|$)/.exec(src);
  const head = fm ? fm[0] : "";
  const rest = src.slice(head.length);

  const level = Math.max(0, Math.min(6, Number(cutAtHeading) || 0));
  const re = level
    ? new RegExp(`(?=\\n-{3}[ \\t]*(?:\\n|$))|(?=\\n#{1,${level}} )`, "g")
    : /(?=\n-{3}[ \t]*(?:\n|$))/g;

  const parts = rest.split(re);
  if (head) parts[0] = head + (parts[0] ?? "");
  return parts.length ? parts : [src];
}

/** A positive number, or null. */
const positive = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * The slide settings in effect for a document.
 *
 * Two levels, and they answer different questions. `config.json` is how *this
 * installation* presents; a `slides:` block in the frontmatter is how *this
 * deck* does, and it travels with the file -- a 4:3 room, or a lecture whose
 * slides carry three lines in very large type, is a property of the document
 * and not of the machine it is opened on.
 *
 *     ---
 *     title: Fourier series
 *     slides:
 *       fontSize: 40
 *       width: 1024
 *       height: 768
 *       cutAtHeading: 2
 *     ---
 *
 * Note what is *not* here: how large the slide is drawn in the pane. That is a
 * comfort setting of the viewer, not a property of the deck, and it has to
 * stay separate -- enlarging the text would change what fits on a slide, and
 * the view would stop telling the truth about the projection.
 */
export function resolveSlideSettings(frontmatter, defaults = {}) {
  const fm = (frontmatter && typeof frontmatter === "object" && frontmatter.slides) || {};
  const pick = (...candidates) => {
    for (const c of candidates) {
      const n = positive(c);
      if (n !== null) return n;
    }
    return null;
  };
  // Accept the three spellings a YAML writer reaches for, rather than
  // silently ignoring two of them.
  const fontSize = fm.fontSize ?? fm.fontsize ?? fm["font-size"];
  const cut = fm.cutAtHeading ?? fm.cutatheading ?? fm["cut-at-heading"] ?? defaults.cutAtHeading;
  const cutLevel = Number(cut);

  return {
    width: pick(fm.width, defaults.width) ?? 1280,
    height: pick(fm.height, defaults.height) ?? 720,
    fontSize: pick(fontSize, defaults.fontSize) ?? 28,
    cutAtHeading: Number.isFinite(cutLevel) ? Math.max(0, Math.min(6, Math.trunc(cutLevel))) : 0,
    transition: fm.transition ?? defaults.transition ?? "slide",
  };
}
