import { ViewPlugin } from "@codemirror/view";
import { findNearestElementForLine } from "../markdown/markdownSourceMap";

/**
 * Which section the reader is in, for the table of contents to highlight.
 *
 * The question has two defensible answers and they disagree: while you type,
 * the section you are in is the one holding the caret; while you scroll away to
 * reread something, it is the one you are looking at. Choosing either alone
 * fails at the other moment -- a caret-only rule leaves the panel pointing at
 * the section you left, which is exactly when one gets lost, and a scroll-only
 * rule makes the panel name a section you are not writing in.
 *
 * So the rule here is: **the caret when it is on screen, the top of the visible
 * area otherwise**. Typing follows the caret, scrolling away follows the eyes,
 * and scrolling back returns to the caret. Nothing has to be remembered and
 * neither usage is surprised.
 *
 * The top of the view is read with `posAtCoords` and not from `visibleRanges`,
 * which would have been cheaper: those ranges are cut wherever content is
 * replaced by a widget, and in Inline mode nearly every block is, so the first
 * "visible" range there is the first line still shown as source -- which can be
 * a screenful away from what is on top. Geometry knows where a widget sits;
 * the ranges do not.
 */

/** The heading tree in document order, parents before their children. */
export function flatten(nodes, out = []) {
  for (const node of nodes ?? []) {
    out.push(node);
    flatten(node.children, out);
  }
  return out;
}

/**
 * The innermost heading whose section contains `pos`.
 *
 * The last heading at or before the position, which is the deepest one by
 * construction: a `###` following a `##` starts a section inside it, so taking
 * the latest start takes the narrowest section.
 */
export function headingAt(nodes, pos) {
  let found = null;
  for (const heading of flatten(nodes)) {
    // Virtual positions ("v<line>") belong to an included file: they are not
    // positions of this document and cannot be compared with one.
    if (typeof heading.pos !== "number") continue;
    if (heading.pos > pos) break;
    found = heading;
  }
  return found;
}

/**
 * Publish the position of the current section's heading, and only when it
 * changes.
 *
 * The signal drives a Preact render, and a scroll produces sixty frames a
 * second: writing the anchor itself would re-render the whole panel on every
 * one of them. Resolving to a heading here means the signal changes a few times
 * per document -- when a boundary is actually crossed.
 */
export const trackActiveSection = (headings, activeSection) =>
  ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.view = view;
        this.frame = 0;
        // CodeMirror's own DOM handlers are installed on the content, where a
        // scroll event does not arrive: it fires on the scroller, which is its
        // parent, and scroll events do not bubble.
        this.onScroll = () => this.schedule();
        view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
        this.schedule();
      }

      /**
       * At most one measurement per frame, however fast the wheel turns -- and
       * always outside the update cycle, since measuring reads layout and
       * reading layout while the view is updating is how measure loops start.
       */
      schedule() {
        if (this.frame) return;
        this.frame = requestAnimationFrame(() => {
          this.frame = 0;
          this.measure();
        });
      }

      update(update) {
        // `viewportChanged` covers a scroll long enough to re-render; the
        // listener above covers the short ones, which in a document rendered
        // whole is every scroll there is.
        if (update.docChanged || update.selectionSet || update.viewportChanged) this.schedule();
      }

      measure() {
        const view = this.view;
        const box = view.scrollDOM.getBoundingClientRect();
        // A hidden editor -- Preview mode, a background tab -- measures as a
        // zero-height box, and every position in it would answer the same.
        // Keeping the last known section is better than publishing a wrong one.
        if (!box.height) return;

        const head = view.state.selection.main.head;
        const caret = view.coordsAtPos(head);
        const onScreen = caret && caret.bottom > box.top && caret.top < box.bottom;
        const anchor = onScreen
          ? head
          : // `false`: the nearest position rather than none, so a point landing
            // in a margin, a gutter or a widget still answers.
            view.posAtCoords({ x: view.contentDOM.getBoundingClientRect().left + 4, y: box.top + 4 }, false);
        if (anchor == null) return;

        const pos = headingAt(headings.peek(), anchor)?.pos ?? null;
        if (activeSection.peek() !== pos) activeSection.value = pos;
      }

      destroy() {
        if (this.frame) cancelAnimationFrame(this.frame);
        this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
      }
    },
  );

/**
 * The same question in Preview mode, where there is no caret to follow.
 *
 * The editor is hidden there, so the plugin above measures a box of no height
 * and holds its tongue; what the reader sees is the rendered pane, and the only
 * thing it can be asked is which heading has scrolled past the top. The answer
 * has to come back as a *source* position all the same, since that is what the
 * outline matches its entries by -- hence the detour through the source map.
 *
 * Returns a handle: `refresh()` to measure again after the pane has re-rendered,
 * `destroy()` to let go of it.
 */
export function watchPreviewSection({ preview, text, editorView, headings, activeSection }) {
  /** Heading position → the element standing for it in the rendered pane. */
  let cache = null;
  let frame = 0;

  const build = () => {
    const view = editorView.peek();
    if (!view) return [];
    const out = [];
    for (const heading of flatten(headings.peek())) {
      if (typeof heading.pos !== "number" || heading.pos > view.state.doc.length) continue;
      const [el] = findNearestElementForLine(view.state.doc.lineAt(heading.pos).number, text.lineMap, preview);
      if (el) out.push({ pos: heading.pos, el });
    }
    return out;
  };

  const measure = () => {
    if (!preview.isConnected || !preview.clientHeight) return;
    // The pane is re-rendered by patching, so elements are replaced under us.
    // Checking that they are all still attached costs no layout, where
    // rebuilding on every frame would cost a query per heading.
    if (!cache?.length || cache.some((c) => !c.el.isConnected)) cache = build();
    if (!cache.length) return;

    // A heading counts as current once it reaches the upper quarter of the
    // pane, not once it has left it entirely: by the time a title is gone off
    // the top, one has been reading its section for a while.
    const line = preview.getBoundingClientRect().top + Math.min(80, preview.clientHeight / 4);
    let found = null;
    for (const entry of cache) {
      const box = entry.el.getBoundingClientRect();
      // Inside something collapsed -- a closed dropdown, a hidden tab -- and so
      // nowhere on screen. Skipped rather than read, since a zero rectangle
      // would answer "above the line" and swallow every heading after it.
      if (!box.height && !box.width) continue;
      if (box.top > line) break;
      found = entry;
    }

    // Nothing has reached the line yet: the document has not got to its first
    // section, exactly as before the first heading in the source.
    const pos = found?.pos ?? null;
    if (activeSection.peek() !== pos) activeSection.value = pos;
  };

  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      measure();
    });
  };

  preview.addEventListener("scroll", schedule, { passive: true });
  // The pane is rendered after this is installed, and re-rendered whenever the
  // document is, so measuring once at the start would read either nothing or
  // elements about to be replaced. Watching it is what makes the highlight
  // appear without waiting for the reader to scroll; the measurement is already
  // capped at one per frame, so a render storm costs one measurement a frame.
  const watcher = new MutationObserver(schedule);
  watcher.observe(preview, { childList: true, subtree: true });
  schedule();

  return {
    refresh: schedule,
    destroy() {
      if (frame) cancelAnimationFrame(frame);
      watcher.disconnect();
      preview.removeEventListener("scroll", schedule);
    },
  };
}
