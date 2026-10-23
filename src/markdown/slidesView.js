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

/**
 * How large the slides are drawn in the pane, as a multiple of the size that
 * just fits.
 *
 * This is the one thing in the slide view that is *not* a property of the
 * deck, and keeping the two apart is what makes the view trustworthy. The type
 * size changes what fits on a slide and belongs to the document; this changes
 * only how big the picture of the slide is here, and belongs to whoever is
 * looking at it. Enlarging the text instead -- the obvious shortcut -- would
 * make the pane disagree with the projector about what overflows, which is the
 * one thing the view exists to get right.
 *
 * Remembered across sessions, like a pane ratio, because it is a comfort
 * setting and not a decision about the document.
 */
const ZOOM_KEY = "slideZoom";
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 4;
const ZOOM_SNAP = 0.06;

function readZoom() {
  try {
    const z = Number(localStorage.getItem(ZOOM_KEY));
    return Number.isFinite(z) && z >= ZOOM_MIN && z <= ZOOM_MAX ? z : 1;
  } catch {
    return 1;
  }
}

function writeZoom(z) {
  try {
    localStorage.setItem(ZOOM_KEY, String(z));
  } catch {
    // Private windows and blocked storage: the zoom just does not outlive the
    // session, which is no reason to break the gesture.
  }
}

/**
 * Nominal slide geometry.
 *
 * `settings` is what the document resolved -- its own `slides:` block over
 * config.json -- and config is the fallback for the moment before the first
 * render has produced one.
 */
function slideSize(settings) {
  const s = settings ?? config.slides ?? {};
  return {
    w: Number(s.width) || 1280,
    h: Number(s.height) || 720,
    // Nominal too, like the rest: the text is sized inside the 1280x720 box
    // and reduced with it, so the setting means the same thing in a half-width
    // panel and on the projector.
    font: Number(s.fontSize) || 28,
    align: s.verticalAlign === "center" ? "center" : "flex-start",
  };
}

/**
 * Turn `preview` into a strip of slides, and keep it measured.
 * @returns {() => void} a cleanup that undoes everything it set.
 */
export function attachSlideView(preview, getSettings = () => null) {
  if (!preview) return () => {};

  let frame = 0;
  let settle = 0;
  let badgeTimer = 0;
  let zoom = readZoom();

  const badge = document.createElement("div");
  badge.className = "slide-zoom-badge";
  badge.hidden = true;
  preview.appendChild(badge);

  const flashBadge = () => {
    // A full re-render empties the pane, badge included, so it is put back
    // rather than assumed to be there.
    if (!badge.isConnected) preview.appendChild(badge);
    badge.textContent = `${Math.round(zoom * 100)}%`;
    // Placed in viewport coordinates: inside a scrolling pane an absolutely
    // positioned badge would slide away with the content, and it is only on
    // screen for a second.
    const rect = preview.getBoundingClientRect();
    badge.style.left = `${rect.right - 16}px`;
    badge.style.top = `${rect.top + 16}px`;
    badge.hidden = false;
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => {
      badge.hidden = true;
    }, 1100);
  };

  const slides = () => [...preview.querySelectorAll(":scope > html-chunk")];

  const measure = () => {
    frame = 0;
    const { w, h, font, align } = slideSize(getSettings());
    const style = getComputedStyle(preview);
    const inner = preview.clientWidth - parseFloat(style.paddingLeft || 0) - parseFloat(style.paddingRight || 0);
    // A scale of 0 would collapse every box and, worse, make the overflow test
    // below meaningless. Before the pane has been laid out, leave the last
    // value alone.
    if (inner <= 0) return;

    preview.style.setProperty("--slide-w", `${w}px`);
    preview.style.setProperty("--slide-h", `${h}px`);
    preview.style.setProperty("--slide-font", `${font}px`);
    preview.style.setProperty("--slide-align", align);
    // The fitting scale, then the viewer's zoom on top. Above 1 the slide is
    // wider than the pane and the pane scrolls, which is the point.
    // One pixel shy of the exact fit, so that at 100% the pane does not grow a
    // horizontal scrollbar over a rounding error.
    preview.style.setProperty("--slide-scale", String(Math.min(1, (inner - 1) / w) * zoom));

    // Centred content that overflows spills out of *both* ends of the box, and
    // `scrollHeight` only counts what spills downwards -- so a centred slide
    // would under-report, and the one thing the view must get right is exactly
    // this. The boxes are therefore measured flush to the top and put back,
    // which costs one extra reflow in a pass that is already debounced.
    const centred = align === "center";
    if (centred) preview.classList.add("measuring-slides");

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

    if (centred) preview.classList.remove("measuring-slides");
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

  // Ctrl/Cmd and the wheel: the gesture every viewer already knows, and one
  // that needs no focus -- the cursor is in the source, which is where it
  // should stay. preventDefault, or the browser zooms its own page instead.
  const onWheel = (ev) => {
    if (!ev.ctrlKey && !ev.metaKey) return;
    ev.preventDefault();
    const next = zoom * Math.exp(-ev.deltaY * 0.002);
    // A detent at 100%, so the way back to "exactly what fits" is findable
    // without a reset command.
    const snapped = Math.abs(next - 1) < ZOOM_SNAP ? 1 : next;
    zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, snapped));
    writeZoom(zoom);
    flashBadge();
    schedule();
  };
  preview.addEventListener("wheel", onWheel, { passive: false });

  const resizeObserver = new ResizeObserver(schedule);
  resizeObserver.observe(preview);

  const mutationObserver = new MutationObserver(settled);
  mutationObserver.observe(preview, { childList: true, subtree: true });

  preview.addEventListener("load", settled, true);
  schedule();

  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(settle);
    clearTimeout(badgeTimer);
    preview.removeEventListener("wheel", onWheel);
    badge.remove();
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
    preview.style.removeProperty("--slide-align");
    preview.classList.remove("measuring-slides");
    preview.style.removeProperty("--slide-scale");
  };
}
