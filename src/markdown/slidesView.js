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
    furniture: {
      header: s.header ?? "",
      footer: s.footer ?? "",
      headerStyle: s.headerStyle ?? "",
      footerStyle: s.footerStyle ?? "",
    },
    background: s.background ?? "",
    padding: s.padding ?? "",
    cutAtHeading: Number(s.cutAtHeading) || 0,
    transition: s.transition ?? "slide",
    transitionMs: Number(s.transitionMs) || 450,
    w: Number(s.width) || 1280,
    h: Number(s.height) || 720,
    // Nominal too, like the rest: the text is sized inside the 1280x720 box
    // and reduced with it, so the setting means the same thing in a half-width
    // panel and on the projector.
    font: Number(s.fontSize) || 28,
    codeFont: Number(s.cellFontSize) || 18,
    align: s.verticalAlign === "center" ? "center" : "flex-start",
  };
}

/** The fragment breaks of a slide, which are its direct children. */
function fragmentCount(el) {
  return el.querySelectorAll(":scope > hr.fragment-break").length;
}

/**
 * CSS declarations, as the browser understands them.
 *
 * A round trip through a detached element's `style`: it parses the text,
 * drops whatever it does not recognise, and -- the point of doing it this way
 * -- cannot produce anything that escapes the element it is given to. A stray
 * brace in a frontmatter would otherwise have been a stray brace in a
 * stylesheet, which takes the rest of the stylesheet with it.
 */
function safeCss(decl) {
  const probe = document.createElement("div");
  try {
    probe.style.cssText = String(decl ?? "");
  } catch {
    return "";
  }
  return probe.style.cssText;
}

/**
 * One CSS value, if the browser agrees it is one.
 *
 * A custom property accepts any text, and the declaration that reads it only
 * fails later, when the value turns out to be nonsense -- at which point the
 * property falls back to its inherited value rather than to the fallback
 * written in `var()`. So a typo in a padding would not give the default
 * padding, it would give none at all. Asking the browser first avoids that.
 */
function cssValue(property, value) {
  const probe = document.createElement("div");
  try {
    probe.style[property] = String(value ?? "");
  } catch {
    return "";
  }
  return probe.style[property] ?? "";
}

/** A footer template with its placeholders filled. */
/**
 * A header or footer template with its placeholders filled.
 *
 * `{n}`, `{total}` and `{section}`. A template that mentions `{section}` on a
 * slide that has none renders *nothing at all*, rather than leaving the
 * punctuation around it stranded -- "Fourier analysis — 3/12" is wanted, and
 * " — 3/12" is not. The rule is coarse and it is predictable, which is worth
 * more here than cleverness about dangling separators.
 */
function fillTemplate(tpl, n, total, section) {
  const text = String(tpl ?? "");
  if (!text) return "";
  if (text.includes("{section}") && !section) return "";
  return text
    .replace(/\{n\}/g, String(n))
    .replace(/\{total\}/g, String(total))
    .replace(/\{section\}/g, String(section ?? ""));
}

/**
 * The section each slide belongs to, by its position in the deck.
 *
 * "Section" is the heading the slides are cut at -- so with
 * `cutAtHeading: 2`, every `##` opens one and the slides that follow belong
 * to it until the next. A deck cut by markers alone has no such level
 * declared, and level 2 is then assumed: it is the level a lecture's parts
 * are written at, and the alternative, taking the `h1`, would name the
 * document on every slide, which says nothing.
 *
 * Read from the rendered slides rather than from the source, because that is
 * where this pass already is -- and a heading pulled in by an `{include}`
 * counts, as it should.
 */
function sectionsOf(slides, cutAtHeading) {
  const level = Math.max(1, Math.min(6, Number(cutAtHeading) || 2));
  const selector = Array.from({ length: level }, (_, i) => `h${i + 1}`).join(",");
  const out = [];
  let current = "";
  for (const el of slides) {
    // A heading inside the slide opens its section: the slide carrying the
    // title belongs to the section it opens, not to the one before it.
    const heading = el.querySelector(selector);
    if (heading) current = headingLabel(heading);
    out.push(current);
  }
  return out;
}

/**
 * A heading as it reads, number included.
 *
 * `textContent` is not enough. A numbered heading carries its number in a
 * span of its own and the separator between the two -- " - " -- is drawn by
 * CSS, as `::after` content. Pseudo-elements are not text, so the plain
 * reading gave "1Mon titre": the number and the title pushed together with
 * the thing that held them apart missing.
 *
 * The separator is therefore asked of the stylesheet rather than written out
 * here, so that a custom.css changing it changes this too, and so that there
 * is one place where it is decided.
 */
function headingLabel(heading) {
  const num = heading.querySelector(".custom-header-num");
  if (!num) return heading.textContent.trim();

  let separator = " ";
  try {
    const content = getComputedStyle(num, "::after").content;
    if (content && content !== "none" && content !== "normal") separator = content.replace(/^["']|["']$/g, "");
  } catch {
    // No computed style to be had -- the default space is still right.
  }

  const number = num.textContent.trim();
  const rest = heading.textContent.slice(num.textContent.length).trim();
  return rest ? `${number}${separator}${rest}`.replace(/\s+/g, " ").trim() : number;
}

/**
 * A header or footer line, cut into its three parts.
 *
 * `left | middle | right`, positionally and with no special case: two parts
 * are the left and the middle, and an empty one takes no room -- so
 * `Course | | {n}` is the title at one end and the number at the other, and
 * `| {section} |` is a section title alone in the middle.
 *
 * Positional rather than clever. The alternative, "two parts mean the two
 * ends", would read better in the common case and be a rule to remember in
 * every other; writing `| |` says where things go.
 */
function lineParts(template, fill) {
  const text = String(template ?? "");
  if (!text.trim()) return null;
  const parts = text
    .split(/(?<!\\)\|/)
    .slice(0, 3)
    .map((part) => fill(part.replace(/\\\|/g, "|").trim()));
  while (parts.length < 3) parts.push("");
  return parts.some(Boolean) ? parts : null;
}

const LINE_HTML =
  '<span class="slide-line-left"></span><span class="slide-line-middle"></span><span class="slide-line-right"></span>';

/** Write the three parts into a line, touching only what changed. */
function fillLine(el, parts) {
  const spans = [
    el.querySelector(".slide-line-left"),
    el.querySelector(".slide-line-middle"),
    el.querySelector(".slide-line-right"),
  ];
  spans.forEach((span, i) => {
    if (span && span.textContent !== parts[i]) span.textContent = parts[i];
  });
}

/**
 * Give a slide its header and footer, or take them away.
 *
 * Real elements, not pseudo-elements, and not by choice: both pseudo-elements
 * of a slide are already spoken for, and `content` carries a single string --
 * so a footer with something on the left and a page number on the right
 * cannot be written that way at all.
 *
 * Inserting rather than re-rendering is what makes this safe: the cells, the
 * editors and their outputs are untouched. Everything here is idempotent and
 * writes only when the value differs, because this runs inside the pass a
 * mutation observer triggers, and a pass that always wrote would wake itself.
 */
function furnish(el, index, total, s, section) {
  // A slide may say otherwise for itself, in the commented block under its
  // marker; the renderer put that on the element. An empty string is an
  // answer -- it is how a title slide asks for no header -- so what counts is
  // whether the attribute is there, not whether it has content.
  const own = (key, fallback) => (el.dataset[key] === undefined ? fallback : el.dataset[key]);
  // Header and footer are the same thing: a line in two parts, the left one
  // text and the right one a template. The page number may sit in either, and
  // {section} in any of the four.
  const fill = (tpl) => fillTemplate(tpl, index, total, section);
  const headerTpl = own("slideHeader", s.header);
  const footerTpl = own("slideFooter", s.footer);
  const headerParts = lineParts(headerTpl, fill);
  const footerParts = lineParts(footerTpl, fill);

  const wantHeader = !!headerParts;
  const wantFooter = !!footerParts;

  let headerEl = el.querySelector(":scope > .slide-header");
  if (wantHeader) {
    if (!headerEl) {
      headerEl = document.createElement("div");
      headerEl.className = "slide-header";
      headerEl.innerHTML = LINE_HTML;
      el.insertBefore(headerEl, el.firstChild);
    } else if (el.firstChild !== headerEl) {
      el.insertBefore(headerEl, el.firstChild);
    }
    fillLine(headerEl, headerParts);
    const css = safeCss(s.headerStyle);
    if (headerEl.getAttribute("style") !== css) headerEl.setAttribute("style", css);
  } else if (headerEl) {
    headerEl.remove();
  }

  let footer = el.querySelector(":scope > .slide-footer");
  if (wantFooter) {
    if (!footer) {
      footer = document.createElement("div");
      footer.className = "slide-footer";
      footer.innerHTML = LINE_HTML;
      el.appendChild(footer);
    } else if (el.lastChild !== footer) {
      el.appendChild(footer);
    }
    fillLine(footer, footerParts);
    const css = safeCss(s.footerStyle);
    if (footer.getAttribute("style") !== css) footer.setAttribute("style", css);
  } else if (footer) {
    footer.remove();
  }

  // The badge in the corner steps aside when the footer carries the number,
  // so it can never be shown twice.
  // The badge in the corner steps aside as soon as the number is shown
  // somewhere else, whichever of the two lines carries it.
  const showsNumber = /\{n\}/.test(String(headerTpl ?? "")) || /\{n\}/.test(String(footerTpl ?? ""));
  if (showsNumber) el.dataset.footerPage = "1";
  else delete el.dataset.footerPage;
}

/**
 * The element that really has the focus.
 *
 * `document.activeElement` stops at a shadow root and returns its host, and
 * this editor lives in one -- so asking the document directly says "the
 * editor" and never "the cell inside it". Each root has to be asked in turn.
 */
function deepActiveElement() {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

/**
 * True when the caret is inside a cell's editor, where the keys must edit.
 *
 * This answered "no" always, for the reason above, and the cost was not what
 * it looked like: Backspace moving to the previous slide is what one notices,
 * but the same fault handed the arrows and -- worst of all -- the space bar
 * to the deck while Python was being typed in front of the room.
 */
function inCellEditor() {
  const el = deepActiveElement();
  return !!(el && el.closest && el.closest(".pyodide-wrapper"));
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

  // Presentation state. `slide` is the one being shown, `fragment` how many of
  // its breaks have been passed -- 0 meaning only the part before the first.
  // Cumulative, so revealing never takes anything away.
  let presenting = false;
  let slide = 0;
  let fragment = 0;

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
    const { w, h, font, codeFont, align, furniture, background, padding, transition, transitionMs, cutAtHeading } =
      slideSize(getSettings());
    if (preview.dataset.slideTransition !== transition) preview.dataset.slideTransition = transition;
    preview.style.setProperty("--slide-anim-time", `${transitionMs}ms`);
    const style = getComputedStyle(preview);
    const inner = preview.clientWidth - parseFloat(style.paddingLeft || 0) - parseFloat(style.paddingRight || 0);
    // A scale of 0 would collapse every box and, worse, make the overflow test
    // below meaningless. Before the pane has been laid out, leave the last
    // value alone.
    if (inner <= 0) return;

    preview.style.setProperty("--slide-w", `${w}px`);
    preview.style.setProperty("--slide-h", `${h}px`);
    preview.style.setProperty("--slide-font", `${font}px`);
    preview.style.setProperty("--slide-code-font", `${codeFont}px`);
    preview.style.setProperty("--slide-align", align);
    // Centred, the free space is shared between the header's bottom margin and
    // the footer's top one, so the content sits in the middle while the two
    // stay at their edges -- and that margin is itself the gap under the
    // header. Flush to the top there is no free space to share, so the gap
    // has to be given: without it the first line of the slide sat directly
    // against the header's rule.
    preview.style.setProperty("--slide-header-push", align === "center" ? "auto" : "0.7em");
    if (background) preview.style.setProperty("--slide-bg", background);
    else preview.style.removeProperty("--slide-bg");

    const pad = cssValue("padding", padding);
    if (pad) preview.style.setProperty("--slide-padding", pad);
    else preview.style.removeProperty("--slide-padding");
    if (presenting) {
      // Projecting: one slide, as large as the display allows. The zoom does
      // not apply -- there is nothing to zoom towards once the slide fills the
      // screen -- and *both* dimensions have to fit, which is why this is not
      // the editing formula with a different number in it.
      const box = getComputedStyle(preview);
      const innerH = preview.clientHeight - parseFloat(box.paddingTop || 0) - parseFloat(box.paddingBottom || 0);
      preview.style.setProperty("--slide-scale", String(Math.max(0.05, Math.min(inner / w, innerH / h))));
    } else {
      // Editing: fit the width, then the viewer's zoom on top. Above 1 the
      // slide is wider than the pane and the pane scrolls, which is the point.
      // One pixel shy of the exact fit, so that at 100% the pane does not grow
      // a horizontal scrollbar over a rounding error.
      preview.style.setProperty("--slide-scale", String(Math.min(1, (inner - 1) / w) * zoom));
    }

    // Centred content that overflows spills out of *both* ends of the box, and
    // `scrollHeight` only counts what spills downwards -- so a centred slide
    // would under-report, and the one thing the view must get right is exactly
    // this. The boxes are therefore measured flush to the top and put back,
    // which costs one extra reflow in a pass that is already debounced.
    const centred = align === "center";
    if (centred) preview.classList.add("measuring-slides");

    const all = slides();
    const sections = sectionsOf(all, cutAtHeading);
    all.forEach((el, i) => {
      el.dataset.slideIndex = String(i + 1);
      el.dataset.slideTotal = String(all.length);
      furnish(el, i + 1, all.length, furniture, sections[i]);
      // scrollHeight against clientHeight on the box itself: the box has a
      // fixed height and hides what spills, so the difference is exactly what
      // the audience would not see. Two pixels of tolerance, because a border
      // and a sub-pixel line height are not an overflow.
      const over = el.scrollHeight > el.clientHeight + 2;
      if (over) el.dataset.slideOverflow = "1";
      else delete el.dataset.slideOverflow;
    });

    if (centred) preview.classList.remove("measuring-slides");

    // Which slide is showing, and how much of it. Attributes rather than
    // inline styles, because what they drive is a stylesheet: everything
    // except the current slide is hidden, and inside it everything past the
    // last passed break is made invisible -- invisible, not removed, so the
    // layout does not shift under the audience as a list is uncovered.
    all.forEach((el, i) => {
      if (presenting && i === slide) {
        // Written only when it changes. Re-stamping it would restart the
        // entrance animation on every pass -- including the one a fragment
        // reveal triggers, which would replay the whole slide each time a
        // line is uncovered.
        if (el.dataset.slideCurrent !== "1") el.dataset.slideCurrent = "1";
        el.dataset.fragment = String(fragment);
      } else {
        delete el.dataset.slideCurrent;
        delete el.dataset.fragment;
      }
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

  // ── Presenting ────────────────────────────────────────────────────────────

  const slideCount = () => slides().length;

  /** The slide nearest the top of the pane: where "present" starts from. */
  const slideInView = () => {
    const all = slides();
    const top = preview.getBoundingClientRect().top;
    let best = 0;
    let bestGap = Infinity;
    all.forEach((el, i) => {
      const gap = Math.abs(el.getBoundingClientRect().top - top);
      if (gap < bestGap) {
        bestGap = gap;
        best = i;
      }
    });
    return best;
  };

  const go = (dir) => {
    const all = slides();
    if (!all.length) return;
    // Which way the deck is moving, so a slide comes in from the side one is
    // going towards and goes back the way it came.
    preview.dataset.slideDir = dir > 0 ? "next" : "prev";
    if (dir > 0) {
      if (fragment < fragmentCount(all[slide])) fragment += 1;
      else if (slide < all.length - 1) {
        slide += 1;
        fragment = 0;
      }
    } else {
      if (fragment > 0) fragment -= 1;
      else if (slide > 0) {
        slide -= 1;
        // Coming back to a slide shows it as it was left: fully revealed.
        fragment = fragmentCount(all[slide]);
      }
    }
    schedule();
  };

  const startPresenting = (from = slideInView()) => {
    presenting = true;
    slide = Math.max(0, Math.min(from, slideCount() - 1));
    fragment = 0;
    preview.dataset.slideDir = "next";
    preview.classList.add("presenting");
    // Asked for, not relied on. The class above already makes the pane cover
    // the window, so a browser that refuses the request -- or a gesture it
    // does not consider a user action -- still gives a clean projection
    // rather than nothing.
    preview.requestFullscreen?.().catch(() => {});
    schedule();
  };

  const stopPresenting = () => {
    presenting = false;
    preview.classList.remove("presenting");
    if (document.fullscreenElement === preview) document.exitFullscreen?.().catch(() => {});
    schedule();
    // Leave the audience's slide under the author's eyes rather than wherever
    // the pane happened to be scrolled before.
    slides()[slide]?.scrollIntoView({ block: "start" });
  };

  const onKey = (ev) => {
    if (!presenting) return;
    if (ev.repeat) return;

    // PageUp and PageDown first, and unconditionally: that is what every
    // presenter remote sends, and a remote has to keep working while the
    // caret sits in a cell -- which is the whole point of being able to type
    // Python in front of the room. Before the guard below, too: a cell's
    // editor binds those keys for paging and would otherwise swallow the
    // remote.
    if (ev.key === "PageDown") return void (ev.preventDefault(), go(1));
    if (ev.key === "PageUp") return void (ev.preventDefault(), go(-1));

    // Already dealt with by whoever had the focus, or by whatever was on top:
    // a cell's editor and the figure viewer both call preventDefault on the
    // keys they use. A second guard, resting on a different fact than the
    // first -- knowing *that* a key was consumed needs nothing of where the
    // caret is, so it holds where asking the focus would mislead. The tab
    // manager's own global shortcuts are written the same way.
    if (ev.defaultPrevented) return;

    const inCell = inCellEditor();

    if (ev.key === "Escape" && !inCell) return void (ev.preventDefault(), stopPresenting());

    // The arrows and the space bar navigate -- except inside a cell, where
    // they must edit. This exception is the one that decides whether the mode
    // is pleasant or unbearable, and it costs one test.
    if (inCell) return;
    if (ev.key === "ArrowRight" || ev.key === "ArrowDown" || ev.key === " " || ev.key === "Enter") {
      ev.preventDefault();
      go(1);
    } else if (ev.key === "ArrowLeft" || ev.key === "ArrowUp" || ev.key === "Backspace") {
      ev.preventDefault();
      go(-1);
    } else if (ev.key === "Home") {
      ev.preventDefault();
      slide = 0;
      fragment = 0;
      schedule();
    } else if (ev.key === "End") {
      ev.preventDefault();
      slide = Math.max(0, slideCount() - 1);
      fragment = fragmentCount(slides()[slide] ?? preview);
      schedule();
    }
  };

  // Leaving fullscreen by the browser's own means -- Escape, the system
  // gesture, another window -- has to end the presentation too, or the pane
  // would stay in projection mode inside the editor.
  const onFullscreen = () => {
    if (presenting && document.fullscreenElement !== preview) stopPresenting();
  };

  const onClick = (ev) => {
    if (!presenting) return;
    // A click advances, as in every other presenter -- but not one that was
    // aimed at something: a cell's button, its editor, a link, a figure to
    // open full screen.
    const t = ev.target;
    if (t instanceof Element && t.closest("a, button, input, .cm-editor, .pyodide-wrapper, img")) return;
    go(1);
  };

  const present = document.createElement("button");
  present.type = "button";
  present.className = "slide-present-btn";
  present.title = "Present from the slide in view (Escape to leave)";
  present.textContent = "▶";
  present.addEventListener("click", () => startPresenting());
  // First, not last: the pane scrolls, and a control appended after every
  // slide sits at the far end of that scroll rather than in the corner.
  preview.insertBefore(present, preview.firstChild);

  document.addEventListener("keydown", onKey);
  document.addEventListener("fullscreenchange", onFullscreen);
  preview.addEventListener("click", onClick);

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

  // The pane is emptied and rebuilt on a full re-render, taking the button
  // with it; it is put back rather than assumed to be there.
  const keepControls = () => {
    if (present.parentNode !== preview || preview.firstChild !== present) {
      preview.insertBefore(present, preview.firstChild);
    }
  };

  const mutationObserver = new MutationObserver(() => {
    keepControls();
    settled();
  });
  mutationObserver.observe(preview, { childList: true, subtree: true });

  preview.addEventListener("load", settled, true);
  schedule();

  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(settle);
    clearTimeout(badgeTimer);
    preview.removeEventListener("wheel", onWheel);
    preview.removeEventListener("click", onClick);
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("fullscreenchange", onFullscreen);
    if (document.fullscreenElement === preview) document.exitFullscreen?.().catch(() => {});
    preview.classList.remove("presenting");
    badge.remove();
    present.remove();
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    preview.removeEventListener("load", settled, true);
    for (const el of slides()) {
      delete el.dataset.slideIndex;
      delete el.dataset.slideTotal;
      delete el.dataset.slideOverflow;
      delete el.dataset.slideCurrent;
      delete el.dataset.fragment;
      delete el.dataset.footerPage;
      el.querySelector(":scope > .slide-header")?.remove();
      el.querySelector(":scope > .slide-footer")?.remove();
    }
    preview.style.removeProperty("--slide-w");
    preview.style.removeProperty("--slide-h");
    preview.style.removeProperty("--slide-font");
    preview.style.removeProperty("--slide-code-font");
    preview.style.removeProperty("--slide-align");
    preview.style.removeProperty("--slide-header-push");
    preview.style.removeProperty("--slide-bg");
    preview.style.removeProperty("--slide-padding");
    preview.style.removeProperty("--slide-anim-time");
    delete preview.dataset.slideTransition;
    delete preview.dataset.slideDir;
    preview.classList.remove("measuring-slides");
    preview.style.removeProperty("--slide-scale");
  };
}
