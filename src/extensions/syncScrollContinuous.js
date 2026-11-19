import { ViewPlugin } from "@codemirror/view";
import { markProgrammaticChange } from "../text";

/**
 * Keep the two panes level while either of them is being scrolled.
 *
 * ## What it aligns
 *
 * The first line showing. Not the caret -- scrolling is the one gesture one
 * makes without a caret in mind, and the document may have none in view --
 * and not the middle of the pane, which no one can point at. The top edge is
 * what the reader is looking at and the only landmark both panes can name.
 *
 * ## How
 *
 * Between the two panes there are *anchors*: a line of the source that
 * produced an element of the preview. `text.lineMap` holds them, and the
 * rendered elements carry the matching `data-line-id`. An anchor gives one
 * exact correspondence; what is wanted is a correspondence everywhere, so
 * between two consecutive anchors the position is interpolated. A paragraph
 * that takes three lines of source and two of preview is then traversed
 * smoothly rather than jumped over, which is the difference between a pane
 * that follows and a pane that lurches.
 *
 * Only the two anchors bracketing the current position are used, and that is
 * deliberate rather than an economy. CodeMirror does not measure what it does
 * not draw: outside the viewport the height of a wrapped line is an estimate,
 * so a distant anchor is a guess. The bracketing pair is on screen by
 * definition, hence measured, so the arithmetic rests on nothing estimated.
 * It is also why there is no table to rebuild when the document changes.
 *
 * ## The loop
 *
 * A follows B, B's own handler follows A, and the two chase each other a
 * pixel at a time. So the pane that receives the gesture owns the scroll for
 * a short while, and the other one says nothing while it does. Ownership is
 * taken by the wheel, by a touch, and by a scrollbar drag -- and also by a
 * plain scroll event on a pane that nobody else is driving, which is what
 * catches a keyboard PageDown.
 *
 * ## The ends
 *
 * When one pane is longer than the other -- an unfolded frontmatter at the
 * top, a figure at the bottom -- the shorter one reaches its end first. There
 * is nothing to do about that: `scrollTop` clamps itself, so the follower
 * stops and the driven pane goes on alone, which is what one wants and what
 * one would have had to write a test for had the browser not done it.
 */

/** How long the pane that was acted upon keeps the scroll to itself. */
const OWNERSHIP_MS = 220;

/**
 * The line numbers that have an element in the preview, in order.
 *
 * Rebuilt on demand rather than cached: `lineMap` is replaced at every
 * render, and a sorted copy kept alongside it would be one more thing able to
 * fall out of date. Sorting a few hundred numbers between two animation
 * frames costs nothing next to the layout the scroll itself causes.
 */
function mappedLines(lineMap) {
  if (!lineMap || lineMap.size === 0) return [];
  return [...lineMap.keys()].sort((a, b) => a - b);
}

/** Where a preview element sits in the preview's own scroll coordinates. */
function previewOffsetOf(preview, el) {
  return el.getBoundingClientRect().top - preview.getBoundingClientRect().top + preview.scrollTop;
}

/**
 * The element the editor actually scrolls in.
 *
 * Not `view.scrollDOM`: this project sets `.cm-scroller { overflow: visible }`
 * and lets the surrounding element scroll instead, which is why the rest of
 * the sync code reaches for the parent too. Listening to the scroller that
 * never scrolls, and writing a scrollTop nothing reads, is a sync that does
 * exactly nothing -- which is what the first version of this did.
 */
const editorScroller = (view) => view.dom.parentElement;

/** Where a line sits in the editor's own scroll coordinates. */
function editorOffsetOf(view, lineNumber) {
  const doc = view.state.doc;
  if (lineNumber < 1 || lineNumber > doc.lines) return null;
  const block = view.lineBlockAt(doc.line(lineNumber).from);
  const scroller = editorScroller(view);
  if (!scroller) return null;
  // `block.top` is measured from the top of the document; `documentTop` says
  // where that is on screen. Going through the screen is what makes the two
  // panes comparable, since the preview is measured the same way.
  return block.top + view.documentTop - scroller.getBoundingClientRect().top + scroller.scrollTop;
}

/**
 * One anchor, measured in both panes, or null when it has no layout -- a
 * folded block, or a line the preview has not drawn.
 */
function measure(view, preview, lineMap, lines, idx) {
  const line = lines[idx];
  const el = preview.querySelector(`[data-line-id="${lineMap.get(line)}"]`);
  if (!el || !el.offsetParent) return null;
  const editor = editorOffsetOf(view, line);
  if (editor === null) return null;
  return { idx, line, editor, preview: previewOffsetOf(preview, el) };
}

/**
 * The nearest anchor to `idx` that can actually be measured.
 *
 * A folded block has no layout, and a search that stopped there would answer
 * "no anchor" for a position that has two perfectly good ones a line away.
 * The walk is outward and bounded: anchors without layout are rare, and
 * walking far would cost more than the approximation is worth.
 */
function nearest(view, preview, lineMap, lines, idx) {
  for (let step = 0; step <= 4; step++) {
    for (const i of step === 0 ? [idx] : [idx - step, idx + step]) {
      if (i < 0 || i >= lines.length) continue;
      const a = measure(view, preview, lineMap, lines, i);
      if (a) return a;
    }
  }
  return null;
}

/**
 * The anchor pair bracketing a position: the last one at or above it, and the
 * first one below.
 *
 * By halving rather than by scanning. A long document has hundreds of
 * anchors, each costing a lookup and a measurement, and doing that on every
 * animation frame of a scroll is the difference between a pane that follows
 * and a pane that stutters. Offsets grow with the line number in both panes,
 * which is what makes halving legitimate here.
 */
function bracket(view, preview, lineMap, lines, offset, pick) {
  let lo = 0;
  let hi = lines.length - 1;
  let above = null;
  let below = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const a = nearest(view, preview, lineMap, lines, mid);
    if (!a) break;
    // Bounded by `mid` as well as by the anchor that was found. `nearest`
    // may have walked forward past `mid`, and taking its index alone would
    // then widen the window instead of narrowing it -- a loop that never
    // ends, which is exactly what it did the first time this was run.
    if (a[pick] <= offset) {
      above = a;
      lo = Math.max(mid, a.idx) + 1;
    } else {
      below = a;
      hi = Math.min(mid, a.idx) - 1;
    }
  }
  // The halving leaves `below` wherever it last turned back, which may be
  // several anchors past the one that actually follows. Interpolating over
  // that wider span would be wrong by however much lies between.
  if (above && (!below || below.idx > above.idx + 1)) {
    const next = nearest(view, preview, lineMap, lines, above.idx + 1);
    if (next && next.idx > above.idx) below = next;
  }
  return { above, below };
}

/**
 * The position the follower should take, by proportion between two anchors.
 *
 * Past the last anchor the two panes simply move together, pixel for pixel:
 * what is down there is the tail of one block, and the alternative -- holding
 * the follower still -- reads as a pane that has stopped working.
 */
function follower(above, below, offset, pick) {
  const other = pick === "editor" ? "preview" : "editor";
  if (!above) return null;
  if (!below) return above[other] + (offset - above[pick]);
  const span = below[pick] - above[pick];
  if (span <= 0) return above[other];
  const ratio = (offset - above[pick]) / span;
  return above[other] + ratio * (below[other] - above[other]);
}

export const syncScrollContinuously = (text) =>
  ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.view = view;
        this.owner = null;
        this.ownedUntil = 0;
        this.frame = 0;
        this.linesCache = null;
        this.linesAt = 0;

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
        this.attachEditor();
        this.attachPreview();

        // Askable from the console, like the other probes in this codebase:
        //   window.mystralScrollSync()
        // It says whether the two panes were found, how many anchors the
        // document offers, and what the last alignment did -- which is the
        // whole of what one needs to know when nothing moves.
        if (typeof window !== "undefined") {
          window.mystralScrollSync = () => ({
            scroller: this.scroller?.className || this.scroller?.tagName || null,
            preview: this.preview?.tagName ?? null,
            anchors: this.linesCache?.length ?? null,
            owner: this.owner,
            last: this.last ?? null,
          });
        }
      }

      /**
       * The element the editor scrolls in, listened to once it exists.
       *
       * A plugin is built while the view is being created, and the view is
       * not in its parent yet -- so this is resolved again later rather than
       * once and for all. The same lazy attachment the preview needs, for a
       * different reason.
       */
      attachEditor() {
        const scroller = editorScroller(this.view);
        if (scroller === this.scroller) return scroller;
        if (this.scroller) this.detach(this.scroller, this.onEditorScroll, this.onEditorGesture);
        this.scroller = scroller;
        if (scroller) this.attach(scroller, this.onEditorScroll, this.onEditorGesture);
        return scroller;
      }

      /** The four listeners a pane needs: one to follow, three to claim. */
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

      /**
       * The preview element is not there when the plugin is built, and it is
       * replaced when the editor changes mode. So it is looked up each time
       * and re-listened to when it turns out to be another element.
       */
      attachPreview() {
        const preview = text.preview.peek();
        if (preview === this.preview) return preview;
        if (this.preview) this.detach(this.preview, this.onPreviewScroll, this.onPreviewGesture);
        this.preview = preview;
        if (preview) this.attach(preview, this.onPreviewScroll, this.onPreviewGesture);
        return preview;
      }

      /**
       * The sorted anchor lines, rebuilt a few times a second at most.
       *
       * `lineMap` is mutated in place at every render, so there is no
       * identity to watch and no event to listen to; and sorting a thousand
       * numbers on every frame of a scroll is real work for a list that
       * cannot change while one scrolls, since nothing is being rendered.
       * A quarter of a second of staleness costs, at worst, a slightly
       * misplaced follower for that quarter second.
       */
      lines(lineMap) {
        const now = performance.now();
        if (!this.linesCache || now - this.linesAt > 250) {
          this.linesCache = mappedLines(lineMap);
          this.linesAt = now;
        }
        return this.linesCache;
      }

      /** One alignment per frame, whatever the scroll events say. */
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
        const preview = this.attachPreview();
        const view = this.view;
        if (!preview || !view.dom.isConnected) return;
        const lineMap = text.lineMap;
        const lines = this.lines(lineMap);
        if (lines.length === 0) return;

        const pick = who;
        const scroller = this.attachEditor();
        if (!scroller) return;
        const driver = who === "editor" ? scroller : preview;
        const target = who === "editor" ? preview : scroller;
        const { above, below } = bracket(view, preview, lineMap, lines, driver.scrollTop, pick);
        const wanted = follower(above, below, driver.scrollTop, pick);
        if (wanted === null) return;

        // Already there, within the rounding of a device pixel: writing it
        // again would be one more scroll event for nothing.
        const clamped = Math.max(0, Math.min(wanted, target.scrollHeight - target.clientHeight));
        if (Math.abs(target.scrollTop - clamped) < 1) return;
        // The follower is about to fire its own scroll event. Ownership keeps
        // that event from driving us back, and the mark tells the other sync
        // -- the one that follows the caret -- that this movement was not the
        // reader's hand in that pane.
        this.claim(who);
        markProgrammaticChange();
        this.last = { who, from: Math.round(driver.scrollTop), to: Math.round(clamped), anchors: lines.length };
        target.scrollTop = clamped;
      }

      update(upd) {
        // Late attachment: by now the view is in the document, so the element
        // it scrolls in exists even if it did not when this was built.
        this.attachEditor();
        this.attachPreview();
        // A render changes which lines have an element and where it is. The
        // measurements are taken fresh every time anyway; this only drops the
        // list of anchors, which is the one thing held from frame to frame.
        if (upd.docChanged || upd.geometryChanged) this.linesCache = null;
      }

      destroy() {
        if (this.frame) cancelAnimationFrame(this.frame);
        if (this.scroller) this.detach(this.scroller, this.onEditorScroll, this.onEditorGesture);
        if (this.preview) this.detach(this.preview, this.onPreviewScroll, this.onPreviewGesture);
      }
    },
  );
