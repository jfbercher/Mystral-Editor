import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { TextManager, inlineRefreshEffect } from "../text";
import { tags } from "@lezer/highlight";
import { EditorView } from "codemirror";
import { Decoration, ViewPlugin, WidgetType, keymap } from "@codemirror/view";
import { EditorSelection, EditorState, RangeSet, StateEffect, StateField, Transaction } from "@codemirror/state";
import { handlePreviewInteraction } from "../utils/previewInteractions";
import { SECTION_LABEL_RE } from "../utils/headingNumbering";
import { dictionary, markMisspellings, spellRefresh } from "./spellchecker.js";

/**
 * Elements inside a rendered block that own their own click.
 *
 * Switching a block to its source is driven by the *mousedown*: CodeMirror moves
 * the caret into the block, the widget is replaced by the raw text, and the
 * element is gone before its own click handler ever runs.  That is why links and
 * checkboxes are already special-cased in ignoreEvent() -- this list extends the
 * same treatment to the rest of the interactive content.
 *
 * Clicking anywhere else in the block still enters edit mode as before.
 */
const INTERACTIVE_IN_PREVIEW = [
  ".admonition.dropdown > header", // toggled by handlePreviewInteraction()
  ".code-cell-host", // code cells: nested editor, Run/Clear buttons
  ".pyodide-wrapper",
  ".cm-editor", // any nested CodeMirror instance
  "button",
  "select",
  "textarea",
  // 'details > summary' only, NOT a bare 'summary': the admonition title is a
  // <summary> inside an <aside>, and whitelisting it stopped every click on an
  // admonition header from entering edit mode.
  "details > summary",
  '[contenteditable="true"]', // NOT [contenteditable]: CodeMirror marks the
  //  widget wrapper contenteditable="false".
].join(",");

const atomicMark = Decoration.mark({});

/**
 * Write new verdicts into the blocks already drawn.
 *
 * The worker answers after the widgets were built -- that is the whole point of
 * asking elsewhere -- so something has to carry the answer to what is on
 * screen. Rebuilding the widgets did it and cost far too much (see
 * `decorationsField`); this writes into their DOM instead.
 *
 * Mutating a widget's DOM from outside is safe, and not by luck: CodeMirror's
 * observer drops such mutations on purpose -- `readMutation` opens with
 * `if (!tile || tile.isWidget()) return null`. And `markMisspellings` refuses
 * to look inside a `.cm-error` it has already written, so marking twice marks
 * nothing twice: a second pass only reaches the words that were still unknown.
 *
 * Nothing here reads layout, and underlining changes no height, so the pass
 * cannot disturb the measuring it used to break.
 */
/**
 * What a block is worth, in pixels, before it has been drawn.
 *
 * CodeMirror asks a block widget for `estimatedHeight` when it builds its
 * height map, and **a widget that answers -1 is entered as one line high**
 * (`if (height < 0) height = this.oracle.lineHeight`, heightmap.ts). In Inline
 * mode every block is such a widget, so an undrawn document of a thousand lines
 * was thought a few hundred pixels tall. A jump to a section was then computed
 * on that fiction: the blocks drew, the heights exploded, the target moved, and
 * CodeMirror restarted its measuring pass hundreds of times before giving up
 * -- leaving the window blank. Scrolling there by hand cured it, because every
 * block had then been measured for real.
 *
 * Two answers, in order. The exact one: the height this very HTML was measured
 * at, which is kept as the view measures it. And failing that, the number of
 * source lines the block replaces, at the editor's own line height -- a rough
 * guess, but one that is wrong by a factor of two where the default was wrong
 * by a factor of twenty.
 *
 * Kept per content width, because a narrower pane wraps differently; two Map
 * lookups and no string built, since this is asked for every undrawn block
 * every time the map is rebuilt.
 */
const measured = new Map();
let measuredWidth = 0;
/**
 * Each code cell's last known height, by host id.
 *
 * A cell is not rendered by the markdown pipeline: the pipeline leaves an
 * empty `div.code-cell-host`, and a MutationObserver fills it afterwards with
 * a nested editor. Between the two there is a measuring pass, and the cell
 * measures zero there -- so drawing a block that holds cells shrinks the
 * document by their whole height, slides everything below out from under the
 * reader, and sends CodeMirror measuring again. Reserving the height the cell
 * had last time keeps the document still across that gap; `pyodideRunner`
 * drops the reservation as soon as the real cell is in place.
 */
const cellHeights = new Map();
let lineUnit = 20;
/** Enough for a long document; cleared whole rather than aged one by one. */
const MEASURED_MAX = 4000;

/**
 * How tall a block of each kind turns out to be, per source line, learned as
 * the view measures them.
 *
 * Counting source lines alone is wrong in both directions, and by a lot. A
 * `$$…$$` holding six lines of `\def` renders as one equation; a dropdown
 * admonition of ten lines shows a single title bar until it is opened; while a
 * heading is one line of source and some sixty pixels of rendered type. On a
 * real course document that is a factor of three or four either way -- enough
 * to unsettle a scroll *upwards*, where everything drawn above displaces what
 * the reader is looking at.
 *
 * So the ratio is not written here as a constant: it is measured. Each kind
 * keeps a running mean of (height / source lines / line height), seeded with a
 * mild prior that one real measurement already outweighs. A document teaches
 * the editor its own proportions within the first screenful, and keeps
 * teaching it.
 */
const RATIO_PRIOR = { prose: 1, heading: 2.5, math: 0.5, cell: 1.2, figure: 3, table: 1.2, admonition: 0.8 };
const ratios = new Map(Object.entries(RATIO_PRIOR).map(([kind, ratio]) => [kind, { sum: ratio, n: 1 }]));
/** A measurement is worth this much against the ones before it; the mean follows a document without chasing one odd block. */
const RATIO_MEMORY = 40;

/**
 * Whether to say what is measured.
 *
 * Read from `localStorage` as well as from `window`, because the traces that
 * matter are those of the *first* measurement of each block -- and by the time
 * one has opened a console and set a flag, everything on screen has already
 * been measured once. Stored, the flag survives the reload that gives a fresh
 * document:
 *
 *   localStorage.mystInlineDebug = "1"   // then reload; "0" or remove to stop
 */
function inlineDebug() {
  if (typeof window === "undefined") return false;
  if (window.__mystInlineDebug) return true;
  try {
    return window.localStorage?.getItem("mystInlineDebug") === "1";
  } catch {
    // Private browsing, blocked storage: the window flag remains.
    return false;
  }
}

/**
 * A block that opens as a closed `<details>`: a dropdown admonition, a folded
 * table of contents. It shows its summary line and hides everything else, so
 * its height owes nothing to the text it holds -- four hundred characters for
 * sixty pixels. Asked for as its own kind rather than averaged with the open
 * ones, since it is the `open` attribute, not the amount of text, that decides
 * which of the two shapes a block has.
 */
const FOLDED = /^\s*<details\b(?![^>]*\sopen[\s=>])/;

/** What a block holds, which is what decides its proportions. Kept per HTML: the test scans the string. */
const kinds = new Map();

function kindOf(html) {
  let kind = kinds.get(html);
  if (kind) return kind;
  kind = /^\s*<h[1-6][\s>]/.test(html)
    ? "heading"
    : FOLDED.test(html)
      ? "folded"
      : html.includes("code-cell-host")
        ? "cell"
        : html.includes("<figure") || html.includes("<img")
          ? "figure"
          : html.includes("<table")
            ? "table"
            : html.includes("admonition")
              ? "admonition"
              : html.includes("katex-display")
                ? "math"
                : html.includes("katex")
                  ? "prosemath"
                  : "prose";
  if (kinds.size >= MEASURED_MAX) kinds.clear();
  kinds.set(html, kind);
  return kind;
}

function ratioOf(kind) {
  const seen = ratios.get(kind);
  return seen ? seen.sum / seen.n : 1;
}

function learnRatio(kind, ratio) {
  if (!(ratio > 0) || !Number.isFinite(ratio)) return;
  const seen = ratios.get(kind) ?? { sum: 1, n: 1 };
  if (seen.n >= RATIO_MEMORY) {
    // Keep the mean, forget the count: the next measurements weigh as much as
    // the last ones did, so a document that changes shape is followed.
    seen.sum = (seen.sum / seen.n) * 4;
    seen.n = 4;
  }
  seen.sum += ratio;
  seen.n += 1;
  ratios.set(kind, seen);
}

/**
 * How much text a block holds, which is what decides how tall it wraps.
 *
 * Source lines do not predict the height of a paragraph: the same single line
 * of markdown is twenty pixels tall when it is a sentence and a hundred when
 * it is five. What does predict it is the amount of text and the width it has
 * to wrap in -- the number of rendered lines is the text divided by the line's
 * capacity. So for everything whose height comes from wrapped prose, the
 * estimate is
 *
 *     height = density x characters x line height / width
 *
 * where `density` is the average advance of a character in pixels, times
 * whatever the kind's type is larger than body text. It is learned the same
 * way the ratios are, from the blocks the view measures; the priors are an
 * ordinary 16px face (about eight pixels a character) and a heading's larger
 * type counted twice over, for its width and for its leading.
 *
 * The kinds left out are those whose height owes nothing to wrapping: an
 * equation, a figure, a code cell. Those keep the per-line ratio.
 */
/** The kinds whose height is fitted rather than guessed from a per-line ratio. */
const FITTED = new Set(["prose", "prosemath", "heading", "admonition", "folded", "table", "math"]);

/**
 * A block is a constant plus a slope, not a ratio.
 *
 *     height = base + slope x (characters x line height / width)
 *
 * The second term is the text, wrapped: the number of rendered lines is the
 * amount of text divided by what a line of that width holds, and `slope` is
 * the average advance of a character in pixels. The first term is everything
 * that does not wrap -- a paragraph's margins, a heading's leading, an
 * admonition's title bar.
 *
 * Folding the constant into the slope, as a single ratio does, is what made
 * the estimates miss: a one-line heading of eleven characters was credited
 * with the slope its margins had inflated, and a folded admonition of four
 * hundred characters -- which shows nothing but its title bar -- taught every
 * paragraph that text is cheap. Two numbers separate the two effects, and
 * they are fitted rather than chosen: each kind keeps the five running sums
 * of a least-squares line, decayed so that a document that changes shape is
 * followed. The priors are an ordinary 16px face at about eight pixels a
 * character, seeded weakly enough that a handful of real blocks overrules
 * them.
 */
const SHAPE_PRIOR = {
  // Margins, then a line height per rendered line.
  prose: { base: 8, slope: 20 },
  // Prose carrying inline mathematics: the same lines, set taller.
  prosemath: { base: 8, slope: 26 },
  heading: { base: 20, slope: 30 },
  admonition: { base: 40, slope: 20 },
  // A summary line, and nothing else until the reader opens it: its text is
  // counted and costs almost nothing, which the slope is there to say.
  folded: { base: 58, slope: 1 },
  table: { base: 20, slope: 24 },
  // Per displayed equation, which is what a math block is made of.
  math: { base: 10, slope: 75 },
};
/** Older measurements fade; about fifty blocks carry weight at any time. */
const SHAPE_DECAY = 0.98;

/** Seeded on the prior line at two points, so the fit is defined from the start and weighs almost nothing. */
const shapes = new Map(
  Object.entries(SHAPE_PRIOR).map(([kind, { base, slope }]) => {
    const fit = { n: 0, sx: 0, sy: 0, sxx: 0, sxy: 0 };
    for (const x of [0, 20]) {
      const y = base + slope * x;
      fit.n += 1;
      fit.sx += x;
      fit.sy += y;
      fit.sxx += x * x;
      fit.sxy += x * y;
    }
    return [kind, fit];
  }),
);

/**
 * How many lines a block's text wraps into.
 *
 * Characters alone made the model answer with a straight line where the thing
 * itself is a staircase: a paragraph does not grow smoothly, it grows by one
 * line at a time, and four characters cost a whole line just as seventy do.
 * The threshold belongs in the variable, not in the model -- so the rounding
 * up is done here, per paragraph, and what is fitted afterwards is an honest
 * line: margins, plus a line height per rendered line.
 *
 * The paragraphs are taken from the rendered HTML by its closing block tags,
 * and the line's capacity from an ordinary 16px face. Neither needs to be
 * exact: an error there moves the fitted slope, which is precisely what
 * fitting it is for.
 */
const BLOCK_END = /<\/(?:p|li|blockquote|h[1-6]|dd|dt|figcaption|td|th)>/gi;
const CHAR_WIDTH = 7.5;

function wrappedLines(html, width) {
  if (!(width > 0)) return 1;
  const perLine = Math.max(8, width / CHAR_WIDTH);
  let lines = 0;
  for (const chunk of html.split(BLOCK_END)) {
    const chars = textLengthOf(chunk);
    if (chars > 0) lines += Math.ceil(chars / perLine);
  }
  return Math.max(1, lines);
}

/**
 * What a block of the given kind is measured against.
 *
 * For text, the characters it has to wrap. For an equation, the number of
 * displayed equations -- a `$$…$$` holding eight lines of `\\begin{align}`
 * renders as one block of type some ninety pixels tall, and counting its
 * source lines or its characters predicted neither. One number, counted from
 * the rendered HTML, where the answer is already written.
 */
function loadOf(kind, html, unit, width) {
  if (kind === "math") return (html.match(/katex-display/g) ?? []).length || 1;
  return wrappedLines(html, width);
}

function shapeOf(kind) {
  const fit = shapes.get(kind);
  const prior = SHAPE_PRIOR[kind] ?? { base: 10, slope: 8 };
  if (!fit || fit.n < 2) return prior;
  const spread = fit.n * fit.sxx - fit.sx * fit.sx;
  // Without spread in the text term there is no line to fit -- every heading
  // seen so far being the same length, for instance. The prior's slope then
  // stands, and only the constant is taken from what was measured.
  if (!(Math.abs(spread) > 1e-6)) return { base: fit.sy / fit.n - prior.slope * (fit.sx / fit.n), slope: prior.slope };
  const slope = (fit.n * fit.sxy - fit.sx * fit.sy) / spread;
  const base = (fit.sy - slope * fit.sx) / fit.n;
  // A negative slope or a negative constant is a fit led astray by a few odd
  // blocks; neither means anything here.
  return { base: Math.min(600, Math.max(0, base)), slope: Math.min(5 * prior.slope, Math.max(0, slope)) };
}

function learnShape(kind, x, y) {
  if (!Number.isFinite(x) || !(y > 0)) return;
  const fit = shapes.get(kind) ?? { n: 0, sx: 0, sy: 0, sxx: 0, sxy: 0 };
  for (const k of ["n", "sx", "sy", "sxx", "sxy"]) fit[k] *= SHAPE_DECAY;
  fit.n += 1;
  fit.sx += x;
  fit.sy += y;
  fit.sxx += x * x;
  fit.sxy += x * y;
  shapes.set(kind, fit);
}

/** Characters of visible text in a chunk of rendered HTML, counted once per chunk. */
const textLengths = new Map();

function textLengthOf(html) {
  let length = textLengths.get(html);
  if (length !== undefined) return length;
  length = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
  if (textLengths.size >= MEASURED_MAX) textLengths.clear();
  textLengths.set(html, length);
  return length;
}

/**
 * What a block is expected to measure. One function, so the estimate the
 * height map is built on and the estimate the trace prints cannot drift apart.
 */
function estimateHeight(html, lines) {
  const kind = kindOf(html);
  const unit = lineUnit || 20;
  let guess;
  if (FITTED.has(kind) && measuredWidth > 0) {
    const { base, slope } = shapeOf(kind);
    guess = base + slope * loadOf(kind, html, unit, measuredWidth);
  } else {
    guess = lines * unit * ratioOf(kind);
  }
  // Bounded on both sides: an estimate is a guess, and a guess of two pixels
  // or of a whole screen is worse than a mediocre one.
  return Math.round(Math.min(4000, Math.max(unit, guess)));
}

/**
 * The width the stored heights belong to, and how far it may drift before they
 * are thrown away.
 *
 * Keyed on the exact width, the cache was emptied constantly: the comment
 * gutter is four pixels wider when a line in view carries a comment, which
 * moved the content by four pixels and discarded every height measured so far.
 * The blocks then fell back on estimates, the document lost or gained a
 * thousand pixels, and the reader's view jumped -- a cache invalidated by
 * nothing, costing exactly what it was there to prevent. Four pixels do not
 * re-wrap a paragraph; a real resize does.
 */
let cacheWidth = 0;
const CACHE_SLACK = 12;

function rememberHeight(width, html, height) {
  if (Math.abs(width - cacheWidth) > CACHE_SLACK) {
    measured.clear();
    cacheWidth = width;
  }
  if (measured.size >= MEASURED_MAX) measured.clear();
  measured.set(html, height);
}

/**
 * Measure the drawn blocks: the height cache and the fitted shapes are built
 * from here, and -- behind the flag -- so is what can be read about them.
 *
 * The measuring itself is not optional. Every height stored, and every point
 * the shapes are fitted on, comes from this pass; the console is the part that
 * is switched off.
 *
 * What it prints is the layout's state of rest. A pass that draws blocks and
 * reports none moving is a layout that has settled; a pass where heights move
 * while the width holds is a block whose content arrived late; a height that
 * moves by exactly one line while the width changes is text that wrapped
 * differently, which is a width problem wearing a height's clothes. The three
 * are told apart by reading one line, which is why the width is printed beside
 * the heights.
 *
 * The other line is the one that matters in the long run: the first time a
 * block is measured, its estimate is printed against what it really measures.
 * The shapes those estimates come from are fitted at runtime and therefore say
 * nothing when they go wrong -- a document of a kind they have not seen, a
 * theme with another leading, a font that loads late. Nothing else would
 * report it; this does, in one line, on any document.
 *
 *   localStorage.mystInlineDebug = "1"   // then reload; "0" or remove to stop
 */
const watchHeights = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.view = view;
      this.seen = new Map();
      this.passes = 0;
      this.schedule();
    }

    update(update) {
      if (update.docChanged || update.viewportChanged || update.geometryChanged) this.schedule();
    }

    schedule() {
      // Always, not only under the flag: this pass is what feeds the height
      // cache above, and the logging is the part that is optional.
      this.view.requestMeasure({ read: (view) => this.read(view) });
    }

    read(view) {
      this.passes += 1;
      const moved = [];
      let drawn = 0;
      // Read here rather than stored once: the line height follows the zoom and
      // the settings, and the width follows the pane.
      lineUnit = view.defaultLineHeight || lineUnit;
      measuredWidth = Math.round(view.contentDOM.clientWidth);
      for (const el of view.contentDOM.querySelectorAll(".cm-inline-rendered-md")) {
        drawn += 1;
        const key = el.dataset.mystBlock ?? "?";
        const height = Math.round(el.getBoundingClientRect().height);
        // Any host that has a height, whether or not it has been marked
        // initialised: the mark is set by a second party and waiting for it
        // was enough to keep this empty, which is the one thing the
        // reservation cannot afford.
        for (const host of el.querySelectorAll(".code-cell-host[id]")) {
          if (host.offsetHeight > 0) cellHeights.set(host.id, host.offsetHeight);
        }
        // What this block really costs, for the next time the map is built
        // without it on screen -- after an edit, a re-render, or a jump. And
        // what its kind costs per source line, which is what answers for the
        // blocks never drawn yet.
        if (height > 0 && el.mystHtml) {
          const first = !measured.has(el.mystHtml);
          rememberHeight(measuredWidth, el.mystHtml, height);
          const [from, to] = (el.dataset.mystBlock ?? "0-0").split("-").map(Number);
          const lines = Math.max(1, (to || 0) - (from || 0) + 1);
          const kind = kindOf(el.mystHtml);
          if (first) {
            if (inlineDebug()) {
              console.log(
                "[inline] L%s %s : %s lignes, %s caracteres, estime %s -> reel %s (rapport %s, forme %s)",
                String(el.dataset.mystBlock),
                kind,
                String(lines),
                String(textLengthOf(el.mystHtml)),
                String(estimateHeight(el.mystHtml, lines)),
                String(height),
                ratioOf(kind).toFixed(2),
                `${shapeOf(kind).base.toFixed(0)}+${shapeOf(kind).slope.toFixed(1)}x`,
              );
            }
            learnRatio(kind, height / lines / (lineUnit || 20));
            if (FITTED.has(kind) && measuredWidth > 0) {
              learnShape(kind, loadOf(kind, el.mystHtml, lineUnit || 20, measuredWidth), height);
            }
          }
        }
        const before = this.seen.get(key);
        this.seen.set(key, height);
        if (before === undefined || before === height) continue;
        const holds = el.querySelector(".code-cell-host")
          ? "cellule"
          : el.querySelector("img")
            ? "image"
            : el.querySelector(".katex-display, .katex")
              ? "math"
              : "texte";
        moved.push(`L${key} ${holds} ${before}->${height}`);
      }
      if (!inlineDebug()) return;
      // The width alongside the heights: a block whose height moves by exactly
      // one line is a block whose text wrapped differently, which is a width
      // that changed, not a height. Seeing both on one line tells the two
      // apart at a glance.
      console.log(
        "[inline] passe %s : %s blocs, contenu=%s, hauteur doc=%s",
        String(this.passes),
        String(drawn),
        String(measuredWidth),
        String(Math.round(view.contentHeight)),
      );
      if (moved.length) console.log("[inline]   %s bougent -- %s", String(moved.length), moved.slice(0, 8).join(" | "));
    }
  },
);

/**
 * Pin the rendered blocks' width to the space actually available.
 *
 * CodeMirror lays the scroller out as a flex row -- the gutters, then the
 * content -- and gives the content `flex-shrink: 0`. The content is therefore
 * as wide as its widest child, never narrower. A rendered block asking for
 * `width: 100%` of that content closes the loop: one block that cannot shrink
 * (a code cell, a wide table) widens the content, and every other block, being
 * a percentage of it, re-wraps. Heights move, CodeMirror measures again, and
 * the viewport slides under the reader -- the "Measure loop restarted" seen
 * while scrolling past a run of cells.
 *
 * So the blocks are given a width in pixels, read from the scroller minus the
 * gutters. It is written only when it actually changes, which is on a resize
 * and not on a scroll, so this cannot feed the loop it is there to break.
 */
const pinContentWidth = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.view = view;
      this.width = -1;
      this.schedule();
    }

    update(update) {
      if (update.geometryChanged || update.viewportChanged) this.schedule();
    }

    schedule() {
      this.view.requestMeasure({
        read: (view) => Math.round(view.scrollDOM.clientWidth - (view.dom.querySelector(".cm-gutters")?.offsetWidth ?? 0)),
        write: (width, view) => {
          if (width <= 0 || width === this.width) return;
          this.width = width;
          view.contentDOM.style.setProperty("--myst-inline-width", `${width}px`);
        },
      });
    }
  },
);

const reMarkOnVerdict = ViewPlugin.fromClass(
  class {
    update(update) {
      if (!update.transactions.some((tr) => tr.effects.some((e) => e.is(spellRefresh)))) return;
      const checker = update.state.facet(dictionary);
      if (!checker) return;
      for (const block of update.view.contentDOM.querySelectorAll(".cm-inline-rendered-md")) markMisspellings(block, checker);
    }
  },
);

/**
 * True when the click landed on an interactive element *inside* a rendered widget.
 *
 * The containment check is essential, not defensive.  closest() walks all the way
 * up the document, so without it an ancestor would match for every click anywhere:
 * `.cm-editor` is the outer editor's own root class, and the widget wrapper itself
 * carries contenteditable="false".  Either one made every click look interactive,
 * which stopped the editor from ever taking focus -- so blocks never switched to
 * source and the caret ended up inside a replaced range, invisible.
 */
const inInteractiveElement = (target) => {
  if (!(target instanceof Element)) return false;
  const widgetRoot = target.closest(".cm-inline-rendered-md");
  if (!widgetRoot) return false;
  const match = target.closest(INTERACTIVE_IN_PREVIEW);
  return Boolean(match) && match !== widgetRoot && widgetRoot.contains(match);
};

/**
 * A code-cell widget is already a full editor, and it writes its changes back to
 * the document (pyodide-code-edit -> text.js).  Replacing it with the raw source
 * would only remove execution, highlighting and completion, so it stays rendered
 * even when the caret is inside it.
 */
const isCodeCellBlock = (block) => typeof block.html === "string" && block.html.includes("code-cell-host");

/**
 * Lifts that shield for one cell, the one whose "</>" button was pressed.
 *
 * Carries the position of the cell to unlock, or null to lock it again.  At most
 * one cell at a time: two would only make the way out harder to describe.  The
 * exception ends by itself as soon as the caret leaves the block, so there is no
 * mode left hanging over the document.
 */
const unlockEffect = StateEffect.define();

const focusEffect = StateEffect.define();

/** Matches Preview/Inline list padding: 1.25em + 1.5em per nesting level below the first. */
const listPadEm = (depth) => 1.25 + (Math.max(1, depth) - 1) * 1.5;
/** Lato size used for rendered inline widgets / Preview. */
const RENDERED_FONT_PX = 16;
/** Historical mono advance used to align markdown indent with rendered list gutters. */
const MONO_CHAR_WIDTH_PX = 8.43333;

/**
 * Project TextManager's cached Preview chunks into CM replace widgets. No second markdown-it pass —
 * scheduleRender updates chunks first, then dispatches inlineRefreshEffect. Softbroken paragraphs /
 * list items become one widget per source line so carets stay non-block.
 */
export const inlinePreview = (/** @type {TextManager} */ text, options) => {
  const previewFont = "Lato";
  const baseFont = { fontFamily: previewFont, lineHeight: "1.3em" };
  const baseHeading = { fontWeight: "bold", lineHeight: 1.5, fontFamily: previewFont };
  const markdownHighlightStyle = HighlightStyle.define([
    { tag: tags.heading1, ...baseHeading, fontSize: "1.8em" },
    { tag: tags.heading2, ...baseHeading, fontSize: "1.5em" },
    { tag: tags.heading3, ...baseHeading, fontSize: "1.25em" },
    { tag: tags.heading4, ...baseHeading, fontSize: "1.15em" },
    { tag: [tags.link, tags.url], ...baseFont, textDecoration: "underline", color: "var(--accent-dark)" },
    { tag: tags.macroName, ...baseFont, color: "var(--accent-dark)" },
    { tag: tags.emphasis, ...baseFont, fontStyle: "italic" },
    { tag: tags.strong, ...baseFont, fontWeight: "bold" },
    { tag: tags.strikethrough, ...baseFont, textDecoration: "line-through" },
    { tag: [tags.monospace, tags.atom], ...baseFont, fontFamily: "monospace" },
    { tag: [tags.content], ...baseFont },
    { tag: tags.meta, color: "darkgrey" },
  ]);
  const markdownTheme = EditorView.theme({
    "&": { fontSize: "16px" },
    ".cm-widgetBuffer:has(+ .cm-inline-rendered-md), .cm-inline-rendered-md + .cm-widgetBuffer": {
      display: "none",
    },
    ".cm-inline-rendered-md input[type=checkbox]": { margin: "0 8px 0 0", verticalAlign: "middle" },
  });

  const minLineIn = (lineOfId, el, { skipNestedLists = false } = {}) => {
    let minLine = Infinity;
    const walk = (node) => {
      if (skipNestedLists && node !== el && (node.tagName === "UL" || node.tagName === "OL")) return;
      const line = lineOfId.get(node.getAttribute?.("data-line-id"));
      if (line != null) minLine = Math.min(minLine, line);
      for (const child of node.children || []) walk(child);
    };
    walk(el);
    return minLine;
  };

  /** Split on <br> (markdown-it softbreaks) so each source line can be a non-block widget. */
  const softbreakParts = (lineOfId, el) => {
    const parts = [];
    let part = { line: Infinity, nodes: [] };
    const flush = () => {
      if (part.nodes.length) parts.push(part);
      part = { line: Infinity, nodes: [] };
    };
    for (const child of [...el.childNodes]) {
      if (child.nodeName === "BR") {
        flush();
        continue;
      }
      if (child.nodeType === Node.TEXT_NODE && !child.textContent?.trim()) continue;
      const line = child.nodeType === Node.ELEMENT_NODE ? minLineIn(lineOfId, /** @type {Element} */ (child)) : Infinity;
      if (line !== Infinity) part.line = Math.min(part.line, line);
      part.nodes.push(child);
    }
    flush();
    return parts.filter((p) => p.line !== Infinity);
  };

  const wrapNodes = (el, nodes) => {
    const wrap = document.createElement(el.tagName);
    for (const attr of el.attributes || []) {
      if (attr.name === "data-line-id") continue;
      wrap.setAttribute(attr.name, attr.value);
    }
    for (const n of nodes) wrap.appendChild(n.cloneNode(true));
    return wrap.outerHTML;
  };

  /** Project Preview chunk HTML → start-line widget map (uses TextManager.lineMap). */
  function projectHtml(html, lineMap) {
    const dom = new DOMParser().parseFromString(html, "text/html");
    const byLine = new Map();
    const lineOfId = new Map([...lineMap].map(([line, id]) => [id, line]));

    const listDepthOf = (li) => {
      let depth = 0;
      for (let n = li.parentElement; n; n = n.parentElement) {
        if (n.tagName === "UL" || n.tagName === "OL") depth++;
      }
      return depth;
    };

    const addSoftbroken = (contentEl, depth, toHtml) => {
      // List items often wrap text in a single <p>; split that for per-line widgets.
      let el = contentEl;
      if (el.tagName === "LI") {
        const kids = [...el.children].filter((c) => c.tagName !== "UL" && c.tagName !== "OL");
        if (kids.length === 1 && kids[0].tagName === "P") el = kids[0];
      }
      const parts = softbreakParts(lineOfId, el);
      if (parts.length <= 1) {
        const startLine = parts[0]?.line ?? minLineIn(lineOfId, contentEl, { skipNestedLists: true });
        if (startLine === Infinity || byLine.has(startLine)) return;
        byLine.set(startLine, { html: toHtml([...el.childNodes], true), listDepth: depth });
        return;
      }
      // `first` says whether this part opens the block. It matters for a list
      // item spread over several source lines: each part is wrapped in a list of
      // its own to keep its indent, so without this they each carried a marker
      // and one entry showed as many bullets as it had lines -- while the
      // Preview, which does not split anything, showed one.
      parts.forEach((part, i) => {
        if (!byLine.has(part.line)) byLine.set(part.line, { html: toHtml(part.nodes, i === 0), listDepth: depth });
      });
    };

    const addListItems = (listEl) => {
      const ordered = listEl.tagName === "OL";
      const tag = listEl.tagName.toLowerCase();
      const types = ordered ? ["decimal", "lower-alpha", "lower-roman"] : ["disc", "circle", "square"];
      let nextNum = ordered ? Number(listEl.getAttribute("start")) || 1 : 0;
      for (const li of listEl.children) {
        if (li.tagName !== "LI") continue;
        const clone = li.cloneNode(true);
        for (const nested of [...clone.children]) {
          if (nested.tagName === "UL" || nested.tagName === "OL") nested.remove();
        }
        const depth = Math.max(1, listDepthOf(li));
        // A task item shows its checkbox where the marker would be.
        const isTask = !!li.querySelector(':scope > label > input[type="checkbox"]');
        const listStyle = isTask ? "none" : types[(depth - 1) % 3];
        const pad = `${listPadEm(depth)}em`;
        let liAttrs = "";
        if (ordered) {
          const num = li.hasAttribute("value") ? Number(li.getAttribute("value")) || nextNum : nextNum;
          nextNum = num + 1;
          liAttrs = ` value="${num}"`;
        }
        const toHtml = (nodes, first = true) => {
          const tmp = document.createElement("div");
          for (const n of nodes) tmp.appendChild(n.cloneNode(true));
          // A continuation line keeps the structure and the indent of the item,
          // so the text stays aligned, and loses only the marker.
          const style = first ? listStyle : "none";
          const attrs = first ? liAttrs : "";
          return `<${tag} class="cm-inline-list-item" style="list-style-type:${style};padding-left:${pad}"><li${attrs}>${tmp.innerHTML}</li></${tag}>`;
        };
        addSoftbroken(clone, depth, toHtml);
        for (const nested of li.children) {
          if (nested.tagName === "UL" || nested.tagName === "OL") addListItems(nested);
        }
      }
    };

    for (const el of dom.body.children) {
      if (el.tagName === "UL" || el.tagName === "OL") {
        addListItems(el);
        continue;
      }
      if (el.tagName === "P" || /^H[1-6]$/.test(el.tagName)) {
        addSoftbroken(el, null, (nodes) => wrapNodes(el, nodes));
        continue;
      }
      const minLine = minLineIn(lineOfId, el);
      if (minLine !== Infinity && !byLine.has(minLine)) byLine.set(minLine, { html: el.outerHTML, listDepth: null });
    }
    return byLine;
  }

  function computeBlocks() {
    if (!text.chunks.length) text.renderText(true, true);
    const source = text.chunks.map((c) => c.text).join("");

    const isSynthetic = (c) => typeof c.hash === "string" && (c.hash.startsWith("footnotes-") || c.hash.startsWith("bibliography-"));
    const realChunks = text.chunks.filter((c) => !isSynthetic(c));
    const syntheticChunks = text.chunks.filter(isSynthetic);

    const byLine = projectHtml(realChunks.map((c) => c.html).join(""), text.lineMap);

    // A section label written above its heading -- "(hello)=" -- is dropped from
    // the rendered tokens once it has been resolved, so it starts no block of
    // its own. It belongs to the heading it names, so the heading's block starts at the label.
    const lines = source.split("\n");
    for (const key of [...byLine.keys()].sort((a, b) => a - b)) {
      const entry = byLine.get(key);
      if (!/^<h[1-6][\s>]/i.test(entry.html?.trimStart() ?? "")) continue;
      let start = key;
      // A heading may carry more than one target.
      while (start > 1 && SECTION_LABEL_RE.test(lines[start - 2] ?? "")) start--;
      if (start !== key && !byLine.has(start)) {
        byLine.delete(key);
        byLine.set(start, entry);
      }
    }

    syntheticChunks.forEach((chunk, i) => {
      byLine.set(Number.MAX_SAFE_INTEGER - syntheticChunks.length + 1 + i, { html: chunk.html, listDepth: null });
    });

    return {
      byLine,
      docLength: source.length,
      docLines: source.split("\n").length,
    };
  }

  /** Whether the blocks still describe `state`'s document. */
  const projectionMatches = (state) => {
    const { docLength, docLines } = state.field(blocksField);
    return docLength === state.doc.length && docLines === state.doc.lines;
  };

  function blockRanges(state) {
    const { byLine } = state.field(blocksField);
    if (!projectionMatches(state)) return [];
    const starts = [...byLine.keys()].sort((a, b) => a - b);
    const SYNTHETIC_THRESHOLD = Number.MAX_SAFE_INTEGER - 1000; // toute clé au-delà = bloc synthétique
    const ranges = [];
    for (let i = 0; i < starts.length; i++) {
      const startLine = starts[i];
      const block = byLine.get(startLine);

      if (startLine >= SYNTHETIC_THRESHOLD) {
        ranges.push({
          startLine: state.doc.lines,
          endLine: state.doc.lines,
          from: state.doc.length,
          to: state.doc.length,
          html: block.html,
          listDepth: block.listDepth,
          synthetic: true,
        });
        continue;
      }

      let endLine = i + 1 < starts.length && starts[i + 1] < SYNTHETIC_THRESHOLD ? starts[i + 1] - 1 : state.doc.lines;
      while (endLine > startLine && !state.doc.line(endLine).text.trim()) endLine--;
      ranges.push({
        startLine,
        endLine,
        from: state.doc.line(startLine).from,
        to: state.doc.line(endLine).to,
        html: block.html,
        listDepth: block.listDepth,
      });
    }
    return ranges;
  }

  function sourceListMarginPx(lineText, listDepth) {
    if (!listDepth) return 0;
    const indentLen = lineText.length - lineText.trimStart().length;
    const renderedPadPx = listPadEm(listDepth) * RENDERED_FONT_PX;
    const listMarkCells = 2;
    return Math.max(0, renderedPadPx - (indentLen + listMarkCells) * MONO_CHAR_WIDTH_PX);
  }

  function selectionTouchesBlock(sel, block, doc) {
    return sel.ranges.some((r) => {
      const a = doc.lineAt(r.from).number;
      const b = doc.lineAt(r.to).number;
      return a <= block.endLine && b >= block.startLine;
    });
  }

  class ProjectedWidget extends WidgetType {
    constructor(html, startLine, endLine, dict) {
      super();
      this.html = html;
      this.startLine = startLine;
      this.endLine = endLine;
      // Which dictionary this was marked against -- a different one marks
      // different words, so the widget is a different widget. What that
      // dictionary has *learned* since is deliberately not part of this:
      // counting its verdicts here made every widget unequal to itself on
      // every answer from the worker, which is the rebuild storm described in
      // `decorationsField`. New verdicts reach the DOM in place instead.
      this.dict = dict;
    }

    /**
     * Two widgets are the same when they would draw the same thing.
     *
     * The dictionary belongs in that comparison, and leaving it out was a
     * defect with an odd symptom: rebuilding the decorations when the
     * dictionary landed changed nothing on screen, because CodeMirror found
     * the new widgets equal to the old ones and kept their DOM -- so `toDOM`
     * never ran again and nothing was underlined. Scrolling away and back
     * destroyed the widgets and rebuilt them, which is why a scroll
     * "repainted" what a rebuild would not.
     */
    /**
     * See `measured` above: answering -1 here, as the default does, had every
     * undrawn block counted as a single line.
     */
    get estimatedHeight() {
      const known = measured.get(this.html);
      if (known) return known;
      return estimateHeight(this.html, Math.max(1, (this.endLine ?? 0) - (this.startLine ?? 0) + 1));
    }

    eq(widget) {
      return this.html === widget.html && this.startLine === widget.startLine && this.endLine === widget.endLine && this.dict === widget.dict;
    }

    toDOM(view) {
      const el = document.createElement("span");
      el.className = "cm-inline-rendered-md";
      // Which source lines this block stands for: the diagnostic above names
      // them, and a line number is what one looks for in the document.
      el.dataset.mystBlock = `${this.startLine}-${this.endLine}`;
      // The key the measuring pass files this block's height under. A property
      // and not an attribute: it is read from the live element only, and a
      // chunk of HTML has no business in the document's markup.
      el.mystHtml = this.html;
      el.innerHTML = this.html;
      // Hold the place of every cell this block carries until the observer
      // fills it in; see `cellHeights`.
      const hosts = [...el.querySelectorAll(".code-cell-host[id]")];
      for (const host of hosts) {
        // A cell seen before is held at the height it had. One seen for the
        // first time has no height to be held at, and that is exactly when the
        // document lurches: so it is held at the block's own estimate, which
        // for a block that is nothing but a cell is the cell's estimate --
        // some three hundred pixels against two hundred and ninety-five
        // measured, where the alternative is zero.
        const height = cellHeights.get(host.id) ?? (hosts.length === 1 && kindOf(this.html) === "cell" ? this.estimatedHeight : 0);
        if (height && !host.dataset.initialized) host.style.minHeight = `${height}px`;
      }
      // The source this widget stands in for is not displayed, so the
      // editor's own checker -- which decorates ranges of the document --
      // has nothing to underline here. The rendered text is marked as a DOM
      // instead, with the same class, so Inline mode is checked like the
      // other views. A dictionary changed later reaches the widgets built
      // after it: these are rebuilt whenever their chunk is re-rendered.
      markMisspellings(el, this.dict ?? view.state.facet(dictionary));

      el.addEventListener("click", (ev) => {
        if (handlePreviewInteraction(ev, view.root, view, text.refMap, null)) {
          ev.stopPropagation();
          return;
        }
        // An interactive element owns its click even when handlePreviewInteraction
        // did not claim it (a Run button, a nested editor): falling through would
        // swap the widget for its source right under the user's pointer.
        if (inInteractiveElement(ev.target)) return;
        // If the click was not intercepted by anything specific (link, dropdown, checkbox),
        // force entry into edit mode on this block, even if the point is precisely clicked
        // has no natively resolvable character position (common case with KaTeX).
        const line = view.state.doc.line(this.startLine);
        view.dispatch({
          selection: EditorSelection.cursor(line.from),
          effects: focusEffect.of(true),
          userEvent: "select.pointer",
        });
        view.focus();
      });

      el.addEventListener("mousedown", (ev) => {
        if (!(ev.target instanceof Element) || ev.target.tagName !== "INPUT") return;
        ev.preventDefault();
        // Resolved from where the widget sits now: decorations are mapped through edits, so the
        // line captured when it was built may have moved or stopped existing.
        const line = view.state.doc.lineAt(view.posAtDOM(ev.target));
        const statusIdx = line.text.indexOf("[") + 1;
        if (statusIdx <= 0) return;
        const from = line.from + statusIdx;
        const current = line.text.slice(statusIdx, statusIdx + 1);
        view.dispatch({
          changes: { from, to: from + 1, insert: current === " " ? "x" : " " },
          effects: focusEffect.of(true),
          userEvent: "select.pointer",
        });
        view.focus();
      });
      return el;
    }

    ignoreEvent(ev) {
      if (ev.type !== "mousedown" || !(ev.target instanceof Element)) return false;
      if (ev.target.tagName === "INPUT") return true;
      if (ev.target.tagName === "A" || ev.target.closest("a")) return true;
      if (inInteractiveElement(ev.target)) return true;
      return !!options.onPreviewClick.peek()?.(ev);
    }
  }

  function buildDecorations(state) {
    // Read once per build and handed to every widget: see `ProjectedWidget.eq`.
    const dict = state.facet(dictionary);
    const focused = state.field(focusedField);
    const decorations = [];

    // Opt-in diagnostic: set window.__mystInlineDebug = true in the console.
    // Printed with %s specifiers so the values stay plain text instead of
    // collapsible objects.
    if (typeof window !== "undefined" && window.__mystInlineDebug) {
      const caretLine = state.doc.lineAt(state.selection.main.head).number;
      const b = blockRanges(state).find((x) => !x.synthetic && caretLine >= x.startLine && caretLine <= x.endLine);
      console.log(
        "[inline] caret=%s focused=%s block=%s asSource=%s codeCell=%s multiline=%s touches=%s",
        String(caretLine),
        String(focused),
        b ? `${b.startLine}-${b.endLine}` : "NONE",
        b ? String(focused && !isCodeCellBlock(b) && selectionTouchesBlock(state.selection, b, state.doc)) : "n/a",
        b ? String(isCodeCellBlock(b)) : "n/a",
        b ? String(b.startLine !== b.endLine) : "n/a",
        b ? String(selectionTouchesBlock(state.selection, b, state.doc)) : "n/a",
      );
    }

    for (const block of blockRanges(state)) {
      if (block.synthetic) {
        decorations.push(
          Decoration.widget({
            widget: new ProjectedWidget(block.html, block.startLine, block.endLine, dict),
            block: true,
            side: 1,
          }).range(block.from),
        );
        continue;
      }

      if (focused && !blockLocked(state, block) && selectionTouchesBlock(state.selection, block, state.doc)) {
        for (let lineNo = block.startLine; lineNo <= block.endLine; lineNo++) {
          const line = state.doc.line(lineNo);
          const margin = sourceListMarginPx(line.text, block.listDepth);
          decorations.push(
            Decoration.line({
              // The multiline variant re-enables display:block (see CodeMirror.jsx):
              // the base class forces display:inline so that a one-line block's source
              // flows inside the row with the rendered widgets around it, but applied
              // to a multi-line block that laid all of its lines side by side on one row.
              class: block.startLine === block.endLine ? "cm-inline-source-line" : "cm-inline-source-line cm-inline-source-multiline",
              ...(margin ? { attributes: { style: `margin-left: ${margin}px` } } : {}),
            }).range(line.from),
          );
        }
        continue;
      }
      decorations.push(
        Decoration.replace({
          widget: new ProjectedWidget(block.html, block.startLine, block.endLine, dict),
          block: block.startLine !== block.endLine,
        }).range(block.from, block.to),
      );
    }

    if (focused) decorations.push(Decoration.line({ class: "cm-inline-source-line" }).range(state.doc.lineAt(state.selection.main.head).from));

    return Decoration.set(decorations, true);
  }

  const focusedField = StateField.define({
    create: () => false,
    update: (value, tr) => {
      for (const e of tr.effects) {
        if (e.is(focusEffect)) return e.value;
      }
      return value;
    },
  });

  const blocksField = StateField.define({
    create: computeBlocks,
    update: (value, tr) => (tr.effects.some((e) => e.is(inlineRefreshEffect)) ? computeBlocks() : value),
  });

  const blockAt = (state, selection) => blockRanges(state).find((b) => selectionTouchesBlock(selection, b, state.doc));

  const unlockedField = StateField.define({
    create: () => null,
    update(value, tr) {
      for (const e of tr.effects) if (e.is(unlockEffect)) return e.value;
      if (value == null) return null;
      // Follow the edits being made in that very source; never decide anything
      // from the blocks while they still describe the document before them.
      if (tr.docChanged) return tr.changes.mapPos(value, -1);
      if (!tr.selection) return value;
      const block = blockRanges(tr.state).find((b) => value >= b.from && value <= b.to);
      if (!block) return value;
      return selectionTouchesBlock(tr.selection, block, tr.state.doc) ? value : null;
    },
  });

  /** A code cell stays rendered unless it is the one that was unlocked. */
  const blockLocked = (state, block) => {
    if (!isCodeCellBlock(block)) return false;
    const pos = state.field(unlockedField);
    return !(pos != null && pos >= block.from && pos <= block.to);
  };

  /**
   * The "</>" button of a cell asks its editor, on `document` like the other
   * cell events, so the owner has to be checked here too: every open editor
   * hears it, and only the one holding that cell may answer.
   */
  const editSourceListener = ViewPlugin.define((view) => {
    const handler = ({ detail: { lineId, owner } = {} }) => {
      const mine = text.options?.id?.value ?? options?.id?.value;
      if (owner != null && mine != null && owner !== mine) return;
      const pos = text._posFromLineId?.(lineId);
      if (pos == null) return;
      const block = blockRanges(view.state).find((b) => pos >= b.from && pos <= b.to);
      if (!block || !isCodeCellBlock(block)) return;
      // block.from, not a position inside: the range is still atomic in the state
      // this transaction starts from, and a caret aimed strictly inside it would
      // be pushed back out before the effect ever lifted the shield.
      view.dispatch({
        selection: EditorSelection.cursor(block.from),
        effects: [unlockEffect.of(block.from), focusEffect.of(true)],
        userEvent: "select.pointer",
      });
      view.focus();
    };
    document.addEventListener("pyodide-edit-source", handler);
    return { destroy: () => document.removeEventListener("pyodide-edit-source", handler) };
  });

  /** Escape renders the cell again without having to move the caret away. */
  const lockOnEscape = keymap.of([
    {
      key: "Escape",
      run: (view) => {
        if (view.state.field(unlockedField) == null) return false;
        view.dispatch({ effects: unlockEffect.of(null) });
        return true;
      },
    },
  ]);

  const decorationsField = StateField.define({
    create: buildDecorations,
    update: (value, tr) => {
      if (tr.docChanged) return value.map(tr.changes);
      // Keep the current widgets while the blocks describe an older document: rebuilding from them
      // would drop every widget until the next render lands.
      if (!projectionMatches(tr.state)) return value;
      if (tr.effects.some((e) => e.is(inlineRefreshEffect) || e.is(focusEffect) || e.is(unlockEffect))) return buildDecorations(tr.state);
      // The dictionary arrives seconds after the document is first drawn, and
      // a widget is marked when it is built: without this, nothing was
      // underlined until something else happened to rebuild it -- a keystroke
      // for the prose, and later still for the text inside a card. The
      // transaction that installs the dictionary rebuilds them all.
      if (tr.startState.facet(dictionary) !== tr.state.facet(dictionary)) return buildDecorations(tr.state);
      // A verdict from the spelling worker used to rebuild everything here, and
      // that was the most expensive line in the file. Verdicts arrive in
      // batches whenever new words come into view -- that is, *while
      // scrolling* -- and the widgets carried the checker's version in their
      // `eq`, so not one of them was judged equal to its predecessor.
      // CodeMirror therefore destroyed and rebuilt the DOM of every block on
      // screen, the heights changed under the measuring pass, and the symptoms
      // were a white flash, a view landing somewhere else, and its own warnings
      // in the console: "Measure loop restarted more than 5 times", "Viewport
      // failed to stabilize". The marks are now written into the DOM already
      // built, by `reMarkOnVerdict` below: no widget is destroyed, no height
      // moves, and nothing has to be measured again.
      if (!tr.selection) return value;
      if (tr.startState.field(unlockedField) !== tr.state.field(unlockedField)) return buildDecorations(tr.state);
      const from = blockAt(tr.startState, tr.startState.selection)?.from;
      return from === blockAt(tr.state, tr.selection)?.from ? value : buildDecorations(tr.state);
    },
    provide: (field) => EditorView.decorations.from(field),
  });

  const revealSelectedBlock = EditorState.transactionFilter.of((tr) => {
    if (!tr.selection || tr.docChanged) return tr;
    if (tr.effects.some((e) => e.is(focusEffect) && e.value === true)) return tr;
    if (!blockAt(tr.startState, tr.selection)) return tr;
    return [tr, { effects: focusEffect.of(true) }];
  });

  const enterJumpedBlock = EditorState.transactionFilter.of((tr) => {
    if (!tr.selection || tr.docChanged) return tr;
    if (tr.annotation(Transaction.userEvent) !== "select") return tr;
    const prev = tr.startState.selection.main;
    const next = tr.selection.main;
    if (prev.head === next.head) return tr;

    // Only nudge a caret that would end up *inside* a rendered block, to that block's near edge.
    // Anything else (Home/End/PageUp, or a step that lands on a boundary) must keep its destination.
    const ranges = blockRanges(tr.startState);
    let target = ranges.find((b) => next.head > b.from && next.head < b.to);

    // Stepping onto a block should enter it.
    //
    // Restricted to a step FROM THE ADJACENT LINE so that End, PageDown and a
    // jump from further away keep their destination.
    if (!target) {
      const prevLine = tr.startState.doc.lineAt(prev.head).number;
      target = ranges.find(
        (b) =>
          !b.synthetic &&
          ((next.head >= b.to && prev.head <= b.from && prevLine === b.startLine - 1) ||
            (next.head <= b.from && prev.head >= b.to && prevLine === b.endLine + 1)),
      );
    }

    if (!target || selectionTouchesBlock(tr.startState.selection, target, tr.startState.doc)) return tr;

    const head = next.head > prev.head ? target.from : target.to;
    return {
      selection: next.empty ? EditorSelection.cursor(head) : EditorSelection.range(next.anchor, head),
      effects: focusEffect.of(true),
      userEvent: "select",
    };
  });

  return [
    focusedField,
    blocksField,
    // Before decorationsField: that field reads this one while it rebuilds.
    unlockedField,
    decorationsField,
    editSourceListener,
    lockOnEscape,
    revealSelectedBlock,
    enterJumpedBlock,
    syntaxHighlighting(markdownHighlightStyle),
    markdownTheme,
    // Other blocks protect the caret by turning into source as soon as it touches
    // them.  Code cells no longer do, so their range must be atomic: otherwise
    // arrow keys would walk the caret into a replaced range, where it is invisible
    // and typing would corrupt the fence.  Marked atomic, the caret steps over.
    EditorView.atomicRanges.of((view) => {
      const ranges = [];
      for (const block of blockRanges(view.state)) {
        if (!block.synthetic && blockLocked(view.state, block) && block.to > block.from) {
          ranges.push(atomicMark.range(block.from, block.to));
        }
      }
      return RangeSet.of(ranges, true);
    }),
    EditorView.focusChangeEffect.of((_, focus) => focusEffect.of(focus)),
    reMarkOnVerdict,
    watchHeights,
    pinContentWidth,
  ];
};
