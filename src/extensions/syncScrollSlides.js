import { ViewPlugin } from "@codemirror/view";
import { OWNERSHIP_MS, editorScroller, editorOffsetOf, previewOffsetOf } from "./syncScrollContinuous.js";
import { getLineById } from "../markdown/markdownSourceMap.js";

/**
 * Source and slides, kept in step while a deck is being prepared.
 *
 * The slide view keeps both panes -- that is what makes it an editing mode
 * rather than a projector -- and they scrolled independently, so finding in
 * the source the slide one was looking at meant counting them.
 *
 * Two things separate this from the continuous sync of the dual pane, and
 * only two. The anchors are the slides rather than every rendered line:
 * thirty of them instead of hundreds, read from the chunks the slide view
 * cuts the preview into, each taking the source line of the first element it
 * holds. And the alignment snaps instead of interpolating, there being
 * nothing meaningful between two slides -- a point halfway down a slide
 * corresponds to no particular line of its source.
 *
 * What it does is one rule read from both ends. Scrolling the slides puts the
 * source on the first slide boundary at or below the top of the pane -- the
 * first slide one sees whole -- and falls back to the slide one is inside
 * when none is. Scrolling the source puts the slides on the one holding the
 * first visible line. Granularity is the slide, so a slow scroll of the
 * preview moves the source in steps; that is the mode, not a defect.
 *
 * Who follows whom is settled exactly as it is in the dual pane: a gesture on
 * a pane claims the sync for a fifth of a second, the other pane follows
 * without answering back, and the claim lapses on its own. Without it the two
 * would push each other down the document, each reading the other's correction
 * as a scroll of its own.
 *
 * Always on in this mode, deliberately: in slide preparation, seeing the
 * source of the slide in front of you is the point of having both panes.
 */

/** The slides of the deck, in order, as the slide view lays them out. */
function slidesOf(preview) {
  return [...preview.querySelectorAll(":scope > html-chunk:not([data-slide-hidden])")];
}

/**
 * The source line a slide starts on.
 *
 * The first element inside it that carries a line id, which the source map
 * put there -- a slide's own box has no line of its own.
 */
function lineOfSlide(slide, lineMap) {
  for (const el of slide.querySelectorAll("[data-line-id]")) {
    const line = getLineById(lineMap, el.dataset.lineId);
    if (line) return line;
  }
  return null;
}

/**
 * Which slide the other pane should be put on.
 *
 * Pulled out of the plugin so it can be tried on its own: the rule is the
 * whole of the feature, and it is two lines of comparison that are easy to
 * get subtly wrong at the ends of the deck.
 *
 * `slack` absorbs the pixel a slide sitting exactly at the top of a pane is
 * as likely to be above as below; without it the choice flickers between two
 * slides and the other pane jitters.
 */
export function chooseAnchor(anchors, who, top, slack = 2) {
  if (!anchors?.length) return null;
  if (who === "preview") {
    // The first slide that begins at or below the top of the pane -- the
    // first one seen whole -- and, failing that, the slide one is in the
    // middle of.
    const next = anchors.find((a) => a.preview >= top - slack);
    if (next) return next;
    return [...anchors].reverse().find((a) => a.preview <= top + slack) ?? null;
  }
  // The slide holding the first visible line: the last one that begins at or
  // above it, and the first slide while one is above them all.
  return [...anchors].reverse().find((a) => a.editor <= top + slack) ?? anchors[0];
}

export const syncScrollSlides = (text) =>
  ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.view = view;
        this.owner = null;
        this.ownedUntil = 0;
        this.frame = 0;
        this.anchorCache = null;
        this.anchorsAt = 0;

        this.claim = (who) => {
          this.owner = who;
          this.ownedUntil = performance.now() + OWNERSHIP_MS;
        };
        this.mine = (who) => this.owner === who || performance.now() > this.ownedUntil;

        this.onEditorScroll = () => this.schedule("editor");
        this.onPreviewScroll = () => this.schedule("preview");
        this.onEditorGesture = () => this.claim("editor");
        this.onPreviewGesture = () => this.claim("preview");

        this.scroller = null;
        this.preview = null;
        this.attachEditor();
        this.attachPreview();

        // Askable from the console, like the sync of the dual pane:
        //   window.mystralSlideSync()
        globalThis.mystralSlideSync = () => ({
          editor: Boolean(this.scroller),
          preview: Boolean(this.preview),
          slides: this.anchors()?.length ?? 0,
          last: this.last ?? null,
        });
      }

      attach(el, onScroll, onGesture) {
        el.addEventListener("scroll", onScroll, { passive: true });
        el.addEventListener("wheel", onGesture, { passive: true });
        el.addEventListener("touchstart", onGesture, { passive: true });
        el.addEventListener("mousedown", onGesture, { passive: true });
      }

      detach(el, onScroll, onGesture) {
        el.removeEventListener("scroll", onScroll);
        el.removeEventListener("wheel", onGesture);
        el.removeEventListener("touchstart", onGesture);
        el.removeEventListener("mousedown", onGesture);
      }

      attachEditor() {
        const scroller = editorScroller(this.view);
        if (scroller === this.scroller) return scroller;
        if (this.scroller) this.detach(this.scroller, this.onEditorScroll, this.onEditorGesture);
        this.scroller = scroller;
        if (scroller) this.attach(scroller, this.onEditorScroll, this.onEditorGesture);
        return scroller;
      }

      attachPreview() {
        const preview = text.preview.peek();
        if (preview === this.preview) return preview;
        if (this.preview) this.detach(this.preview, this.onPreviewScroll, this.onPreviewGesture);
        this.preview = preview;
        if (preview) this.attach(preview, this.onPreviewScroll, this.onPreviewGesture);
        return preview;
      }

      /**
       * One anchor per slide, measured in both panes.
       *
       * Cached for a quarter of a second, and that is sound rather than a
       * compromise: both offsets are kept in their pane's *scroll*
       * coordinates, which scrolling does not change. Only a re-render or a
       * resize can move them, and neither happens while a scroll is in
       * flight.
       */
      anchors() {
        const now = performance.now();
        if (this.anchorCache && now - this.anchorsAt < 250) return this.anchorCache;

        const preview = this.attachPreview();
        const scroller = this.attachEditor();
        const lineMap = text.lineMap;
        if (!preview || !scroller || !lineMap) return null;

        const found = [];
        for (const slide of slidesOf(preview)) {
          const line = lineOfSlide(slide, lineMap);
          if (!line) continue;
          const editor = editorOffsetOf(this.view, line);
          if (editor === null) continue;
          found.push({ line, editor, preview: previewOffsetOf(preview, slide) });
        }
        found.sort((a, b) => a.line - b.line);
        this.anchorCache = found;
        this.anchorsAt = now;
        return found;
      }

      schedule(who) {
        if (!this.mine(who)) return;
        this.claim(who);
        if (this.frame) return;
        this.frame = requestAnimationFrame(() => {
          this.frame = 0;
          this.align(who);
        });
      }

      align(who) {
        const anchors = this.anchors();
        if (!anchors?.length) return;
        const preview = this.preview;
        const scroller = this.scroller;
        if (!preview || !scroller) return;

        const follower = who === "preview" ? scroller : preview;
        const anchor = chooseAnchor(anchors, who, (who === "preview" ? preview : scroller).scrollTop);
        if (!anchor) return;
        const to = Math.max(0, who === "preview" ? anchor.editor : anchor.preview);
        this.last = { who, line: anchor.line, to };
        follower.scrollTop = to;
      }

      update(update) {
        // A render replaces the chunks, so the measurements taken against the
        // previous ones answer for elements that are no longer there.
        if (update.docChanged || update.geometryChanged) this.anchorCache = null;
        this.attachPreview();
        this.attachEditor();
      }

      destroy() {
        if (this.frame) cancelAnimationFrame(this.frame);
        if (this.scroller) this.detach(this.scroller, this.onEditorScroll, this.onEditorGesture);
        if (this.preview) this.detach(this.preview, this.onPreviewScroll, this.onPreviewGesture);
        if (globalThis.mystralSlideSync) delete globalThis.mystralSlideSync;
      }
    },
  );
