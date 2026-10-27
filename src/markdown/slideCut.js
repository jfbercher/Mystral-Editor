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
/**
 * A line that opens a slide, as a pattern fragment.
 *
 * Two spellings, and both are wanted. `---` is what Marp, reveal and remark
 * use, so it is what someone arriving from elsewhere writes. `+++` is MyST's
 * own structural division -- the thing that separates the cells of a
 * notebook -- so it is what a document converted from one already contains,
 * and it carries metadata on its own line.
 *
 * Writing `+++` also leaves `---` free to be what it looks like: a horizontal
 * rule inside a slide.
 *
 * Exactly three pluses: a fourth makes it a fragment marker, the way a fourth
 * dash does.
 */
const DASH_MARKER = "-{3}[ \\t]*";
const PLUS_MARKER = "\\+{3}(?!\\+)[^\\n]*";

/** The spellings that cut, for a given `slides.marker`. */
export const MARKERS = ["both", "plus", "dash"];

function markerPattern(marker) {
  if (marker === "plus") return `(?:${PLUS_MARKER})`;
  if (marker === "dash") return `(?:${DASH_MARKER})`;
  return `(?:${DASH_MARKER}|${PLUS_MARKER})`;
}

export function splitTextForSlides(text, { cutAtHeading = 0, marker = "both" } = {}) {
  const MARKER = markerPattern(marker);
  const src = String(text ?? "");
  const fm = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?=\r?\n|$)/.exec(src);
  const head = fm ? fm[0] : "";
  const rest = src.slice(head.length);

  const level = Math.max(0, Math.min(6, Number(cutAtHeading) || 0));
  const re = level
    ? new RegExp(`(?=\\n${MARKER}(?:\\n|$))|(?=\\n#{1,${level}} )`, "g")
    : new RegExp(`(?=\\n${MARKER}(?:\\n|$))`, "g");

  const parts = rest.split(re);

  // A marker and a heading can fall in the same place -- `---` followed by
  // `## Topic` while the deck also cuts at headings -- and the text between
  // the two cuts is then the marker and nothing else. Left alone that is a
  // slide: empty, numbered, and baffling. Such a piece is folded into the one
  // it opens, so the two cuts count as the one the author made, and the
  // pieces still concatenate back to the original text.
  const bare = (piece) => new RegExp(`^\\n?${MARKER}\\n*$`).test(piece);
  const out = [];
  let pending = "";
  for (const part of parts) {
    if (bare(part)) {
      pending += part;
      continue;
    }
    out.push(pending + part);
    pending = "";
  }
  // A marker with nothing after it at all: it opens no slide, so it belongs
  // to the end of the last one rather than to a slide of its own.
  if (pending) {
    if (out.length) out[out.length - 1] += pending;
    else out.push(pending);
  }

  if (head) out[0] = head + (out[0] ?? "");
  return out.length ? out : [src];
}

/** The transitions a deck may ask for; anything else falls back to `slide`. */
export const TRANSITIONS = ["none", "fade", "slide", "slideUp", "zoom"];

const DEFAULT_TRANSITION_MS = 450;

/**
 * A transition and how long it takes, from one declaration.
 *
 *     transition: fade
 *     transition: fade 700ms
 *     transition: slideUp 1.2s
 *
 * The duration sits on the same line because it is not a separate decision:
 * one does not choose a transition and then, elsewhere, how long it lasts.
 * A bare number is read as milliseconds, since that is what anyone writing
 * one means.
 */
export function parseTransition(value, fallback = "slide") {
  const text = String(value ?? "").trim();
  const m = /^([A-Za-z]+)(?:[ \t]+(\d+(?:\.\d+)?)\s*(ms|s)?)?$/.exec(text);
  const name = m && TRANSITIONS.includes(m[1]) ? m[1] : TRANSITIONS.includes(String(fallback)) ? String(fallback) : "slide";

  let ms = DEFAULT_TRANSITION_MS;
  if (m && m[2]) {
    const n = Number(m[2]);
    if (Number.isFinite(n)) ms = m[3] === "s" ? n * 1000 : n;
  }
  // Nothing below a frame, nothing above a few seconds: a transition one has
  // time to grow bored of is not a transition.
  return { name, ms: Math.max(0, Math.min(3000, Math.round(ms))) };
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
  const cellFontSize = fm.cellFontSize ?? fm.cellfontsize ?? fm["cell-font-size"];
  const cut = fm.cutAtHeading ?? fm.cutatheading ?? fm["cut-at-heading"] ?? defaults.cutAtHeading;
  const cutLevel = Number(cut);

  // Text, taken as written. The empty string means "none", so a deck can turn
  // off what its project sets.
  const text = (...candidates) => {
    for (const c of candidates) if (typeof c === "string" || typeof c === "number") return String(c);
    return "";
  };

  const align = String(fm.verticalAlign ?? fm.verticalalign ?? fm["vertical-align"] ?? defaults.verticalAlign ?? "top").toLowerCase();

  return {
    verticalAlign: ["center", "centre", "middle"].includes(align) ? "center" : "top",
    width: pick(fm.width, defaults.width) ?? 1280,
    height: pick(fm.height, defaults.height) ?? 720,
    fontSize: pick(fontSize, defaults.fontSize) ?? 28,
    cellFontSize: pick(cellFontSize, defaults.cellFontSize) ?? 18,
    padding: text(fm.padding, defaults.padding) || "48px 56px",
    header: text(fm.header, defaults.header),
    footer: text(fm.footer, defaults.footer),
    headerStyle: text(fm.headerStyle, fm.headerstyle, fm["header-style"], defaults.headerStyle),
    footerStyle: text(fm.footerStyle, fm.footerstyle, fm["footer-style"], defaults.footerStyle),
    background: text(fm.background, defaults.background),
    cutAtHeading: Number.isFinite(cutLevel) ? Math.max(0, Math.min(6, Math.trunc(cutLevel))) : 0,
    marker: MARKERS.includes(String(fm.marker ?? defaults.marker ?? "")) ? String(fm.marker ?? defaults.marker) : "both",
    ...(() => {
      const t = parseTransition(fm.transition ?? defaults.transition);
      return { transition: t.name, transitionMs: t.ms };
    })(),
  };
}

/**
 * Settings that belong to one slide, written as commented YAML under its
 * marker.
 *
 *     ---
 *     % fontSize: 44
 *     % verticalAlign: center
 *     % header: ""
 *
 *     # One big idea
 *
 * Why `%` rather than something on the marker itself: `---` has to stay a
 * horizontal rule as far as markdown-it is concerned -- that is what makes
 * the cut readable from the rendered DOM, and what keeps the slide and
 * fragment markers apart. Text after it would stop being a rule and would
 * need a block rule of our own, which means touching the cut. A `%` line is
 * already a MyST comment, already invisible in the render, and costs nothing.
 * (MyST does give `---` brace attributes of its own, which is a second reason
 * to leave it alone.)
 *
 * Only the block at the very top of the slide counts, so a comment written
 * further down stays a comment. "The top" means past whatever opened the
 * slide -- its marker, the frontmatter on the first one, or, when the deck is
 * cut at headings, the heading itself: a slide opened by `## Topic` has no
 * marker to write under, and the block belongs under the title.
 */
export function slideOverrides(text) {
  const src = String(text ?? "");
  const lines = src.split("\n");
  let i = 0;

  // Past the marker that opens the slide, or past a frontmatter block on the
  // first one.
  const out = {};

  if (lines[i]?.trim() === "") i += 1;

  // `+++ {"fontSize": 44}` -- MyST puts metadata on the marker, so it is read
  // here too. The comment block below it still wins, being both the later
  // word and the easier one to write: strict JSON with its quotes is a poor
  // thing to ask of someone writing a lecture.
  const block = /^[ \t]*\+{3}(?!\+)[ \t]*(.*)$/.exec(lines[i] ?? "");
  if (block) {
    i += 1;
    const meta = block[1].trim();
    if (meta.startsWith("{")) {
      try {
        const parsed = JSON.parse(meta);
        if (parsed && typeof parsed === "object") {
          for (const [k, v] of Object.entries(parsed)) out[k] = typeof v === "string" ? v : String(v);
        }
      } catch {
        // Malformed metadata costs its own settings and not the slide.
      }
    }
  } else if (/^-{3,}\s*$/.test(lines[i] ?? "")) {
    if (i === 0 && lines.slice(1).some((l) => /^-{3}\s*$/.test(l))) {
      // A frontmatter block: skip to just past its closing marker.
      const close = lines.findIndex((l, k) => k > 0 && /^-{3}\s*$/.test(l));
      i = close + 1;
    } else {
      i += 1;
    }
  }

  let found = 0;
  let skippedHeading = false;
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "") continue;
    // The heading that opens a slide when the deck is cut at headings, or
    // the title written under a marker. Stepped over once, and only before
    // anything has been read, so that a heading further down still ends the
    // block as any other content does.
    if (!found && !skippedHeading && /^#{1,6}\s/.test(line)) {
      skippedHeading = true;
      continue;
    }
    const m = /^\s*%\s*([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) break;
    found += 1;
    const key = m[1];
    let value = m[2].trim();
    // One level of quoting, as YAML would: `header: ""` is how a slide says
    // it wants no header, and that has to survive as an empty string rather
    // than as nothing at all.
    if (/^(".*"|'.*')$/.test(value)) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

/** A CSS value tame enough to put in a style attribute. */
const tameValue = (v) => {
  const t = String(v ?? "").trim();
  if (!t || t.length > 100) return null;
  return /^[A-Za-z0-9 #%.,()\-_/]+$/.test(t) ? t : null;
};

/**
 * The style attribute carrying a slide's own settings.
 *
 * Everything a slide can override is already a custom property the slide's
 * own rules read, so overriding one on the slide is enough -- no new rule, no
 * JavaScript at render time, and the inline style travels into the export and
 * onto the printed page by itself.
 *
 * The values are whitelisted and filtered rather than trusted: this ends up
 * in an attribute, and `"` or `;` in it would break out of the declaration.
 */
export function slideStyle(overrides) {
  const o = overrides ?? {};
  const decls = [];
  const px = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? `${n}px` : tameValue(v);
  };

  const add = (prop, value) => {
    if (value) decls.push(`${prop}: ${value}`);
  };

  if (o.fontSize !== undefined) add("--slide-font", px(o.fontSize));
  if (o.cellFontSize !== undefined) add("--slide-code-font", px(o.cellFontSize));
  if (o.background !== undefined) add("--slide-bg", tameValue(o.background));
  if (o.padding !== undefined) add("--slide-padding", tameValue(o.padding));
  if (o.verticalAlign !== undefined) {
    const centred = ["center", "centre", "middle"].includes(String(o.verticalAlign).toLowerCase());
    add("--slide-align", centred ? "center" : "flex-start");
    // The same margin that carries the centring, so a slide that centres
    // itself keeps its header and footer at their edges.
    add("--slide-header-push", centred ? "auto" : "0.7em");
  }
  return decls.join("; ");
}

/** The header and footer a slide overrides, as data attributes. */
export function slideFurnitureData(overrides) {
  const o = overrides ?? {};
  const data = {};
  for (const key of ["header", "footer"]) {
    if (o[key] !== undefined) data[key] = String(o[key]);
  }
  return data;
}
