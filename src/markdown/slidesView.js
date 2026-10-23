/**
 * The slide view: measuring and labelling, and nothing else.
 *
 * Everything structural is already done by the time this runs. In slide mode
 * the preview's render chunks *are* the slides -- `splitTextForSlides` cuts
 * the text where the slides are cut -- so a slide is one `<html-chunk>` and
 * the view is a stylesheet. No node is ever moved: a post-render regrouping
 * would be undone at each keystroke, and re-rendering a cell host would
 * destroy its editor, its output and its attachment to the kernel. What is
 * left for JavaScript is what CSS cannot know.
 *
 * Three things, then:
 *
 *   - the scale. A slide is laid out at its nominal size, 1280x720 by
 *     default, and optically reduced to the width of the pane. That is the
 *     whole point of the view: text wraps as it will wrap on the projector, so
 *     what fits here fits there. A preview that reflowed to the pane would
 *     lie, which is worse than no preview.
 *   - the number, which `::after` reads from an attribute.
 *   - the overflow, which is the question the author actually has. A slide is
 *     a fixed box and a document does not know it is one; the view earns its
 *     place by saying, before the lecture rather than during it, which slides
 *     do not fit.
 */

import { config } from "../config.js";

const SETTLE_MS = 150;

/** Nominal slide geometry, from config, with the defaults as a fallback. */
function slideSize() {
  const w = Number(config.slides?.width) || 1280;
  const h = Number(config.slides?.height) || 720;
  // Nominal too, like the rest: the text is sized inside the 1280x720 box and
  // then reduced with it, so the setting means the same thing in a half-width
  // panel and on the projector.
  const font = Number(config.slides?.fontSize) || 28;
  return { w, h, font };
}

/**
 * Turn `preview` into a strip of slides, and keep it measured.
 * @returns {() => void} a cleanup that undoes everything it set.
 */
export function attachSlideView(preview) {
  if (!preview) return () => {};

  let frame = 0;
  let settle = 0;

  const slides = () => [...preview.querySelectorAll(":scope > html-chunk")];

  const measure = () => {
    frame = 0;
    const { w, h, font } = slideSize();
    const style = getComputedStyle(preview);
    const inner = preview.clientWidth - parseFloat(style.paddingLeft || 0) - parseFloat(style.paddingRight || 0);
    // A scale of 0 would collapse every box and, worse, make the overflow test
    // below meaningless. Before the pane has been laid out, leave the last
    // value alone.
    if (inner <= 0) return;

    preview.style.setProperty("--slide-w", `${w}px`);
    preview.style.setProperty("--slide-h", `${h}px`);
    preview.style.setProperty("--slide-font", `${font}px`);
    preview.style.setProperty("--slide-scale", String(Math.min(1, inner / w)));

    const all = slides();
    all.forEach((el, i) => {
      el.dataset.slideIndex = String(i + 1);
      el.dataset.slideTotal = String(all.length);
      // scrollHeight against clientHeight on the box itself: the box has a
      // fixed height and hides what spills, so the difference is exactly what
      // the audience would not see. Two pixels of tolerance, because a border
      // and a sub-pixel line height are not an overflow.
      const over = el.scrollHeight > el.clientHeight + 2;
      if (over) el.dataset.slideOverflow = "1";
      else delete el.dataset.slideOverflow;
    });
  };

  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(measure);
  };

  // A cell's figure arrives long after the render that made room for it, and
  // an image after its own load. Measuring once would report an overflow that
  // is no longer there, or miss one that just appeared, so the pass is redone
  // a moment after the DOM settles.
  const settled = () => {
    clearTimeout(settle);
    settle = setTimeout(schedule, SETTLE_MS);
  };

  const resizeObserver = new ResizeObserver(schedule);
  resizeObserver.observe(preview);

  const mutationObserver = new MutationObserver(settled);
  mutationObserver.observe(preview, { childList: true, subtree: true });

  preview.addEventListener("load", settled, true);
  schedule();

  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(settle);
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    preview.removeEventListener("load", settled, true);
    for (const el of slides()) {
      delete el.dataset.slideIndex;
      delete el.dataset.slideTotal;
      delete el.dataset.slideOverflow;
    }
    preview.style.removeProperty("--slide-w");
    preview.style.removeProperty("--slide-h");
    preview.style.removeProperty("--slide-font");
    preview.style.removeProperty("--slide-scale");
  };
}
