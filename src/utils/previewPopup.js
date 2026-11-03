import { formatEntryFull } from "../markdown/bibliography";

const previewStateByEditor = new Map(); // editorId -> { mapCache, forChunks }

function getPreviewState(editorId) {
  if (!previewStateByEditor.has(editorId)) {
    previewStateByEditor.set(editorId, { mapCache: null, forChunks: null });
  }
  return previewStateByEditor.get(editorId);
}

function getPreviewMap(editorId, chunks) {
  const state = getPreviewState(editorId);
  if (state.mapCache && state.forChunks === chunks) return state.mapCache;
  state.mapCache = buildPreviewMap(chunks);
  state.forChunks = chunks;
  return state.mapCache;
}

export function invalidatePreviewMapCache(editorId) {
  const state = previewStateByEditor.get(editorId);
  if (state) {
    state.mapCache = null;
    state.forChunks = null;
  }
}

export function disposeEditorPreviewCache(editorId) {
  previewStateByEditor.delete(editorId);
}
// ---

function buildPreviewMap(chunks) {
  const previewMap = new Map();
  const parser = new DOMParser();

  for (const chunk of chunks) {
    if (typeof chunk.hash === "string") continue; // ignore chunks synthétiques (footnotes/bibliographie)
    const dom = parser.parseFromString(chunk.html, "text/html");
    dom.body.querySelectorAll("[id]").forEach((el) => {
      if (!previewMap.has(el.id)) previewMap.set(el.id, el.outerHTML);
    });
  }

  return previewMap;
}


function resolvePreviewHtml(id, text) {
  const editorId = text.options.id.value;
  
  if (id.startsWith("fn:")) {
    const label = id.slice(3);
    const info = text.footnoteMap?.get(label);
    const html = text.md?.value ? text.md.value.renderInline(info.content, {}) : info.content;
    return `<div class="preview-footnote">${html}</div>`;
    //return info ? `<div class="preview-footnote">${info.content}</div>` : null;
  }
  if (id.startsWith("cite:")) {
    const label = id.slice(5);
    const info = text.citeMap?.get(label);
    if (!info?.entry) return null;
    const formattedMd = formatEntryFull(info.entry, text.citationTemplate);
    const html = text.md?.value ? text.md.value.renderInline(formattedMd, {}) : formattedMd;
    return `<div class="preview-citation">${html}</div>`;
  }
  if (id.startsWith("url:")) {
    const url = id.slice(4);
    const safe = url.replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    return `<div class="preview-link"><code>${safe}</code></div>`;
  }
  const html = getPreviewMap(editorId, text.chunks).get(id);
  return html ? `<div class="preview-generic">${html}</div>` : null;
}

/**
 * One popup per preview, not one for the whole application.
 *
 * There used to be a single module-level popup element, reused as long as it
 * was connected *anywhere*. With several tabs open it stayed in the shadow root
 * of whichever editor hovered a reference first, so every other tab wrote its
 * content into an element that was not in its own DOM: nothing appeared, until
 * one came back to that first tab. The same went for the show and hide timers,
 * which one tab could cancel for another.
 *
 * Keyed by the preview root, which is what a popup belongs to. A WeakMap, so a
 * closed editor takes its entry with it.
 */
const popupByRoot = new WeakMap();

const HIDE_DELAY = 150;

/**
 * Neutralises what the preview's own class says about being a pane.
 *
 * The content of a popup is wrapped in the preview's styled-components class so
 * that it is styled like the document -- admonitions as boxes, figures with
 * their captions, tables with their rules. That class also carries the panel's
 * chrome, which has no business here: its height, its scrolling, its border and
 * its background. Inline, so it wins over the class whatever the sheet order.
 */
/**
 * What the borrowed classes must not bring with them.
 *
 * The wrapper copies the preview pane's generated class so that the markup is
 * styled as it is in the preview. In Slides mode that class also carries the
 * deck: `& > html-chunk` there is 1280 by 720, scaled, with a padding and a
 * font of its own. And the `--slide-*` properties that give those their real
 * values are set inline *on the pane*, which the popup is a sibling of and so
 * does not inherit -- the content therefore fell back on the defaults and was
 * laid out as a full-size slide inside a popup meant to be 400px wide. Hence
 * the box the width of the slide, the text spilling below it, and a height
 * that made everything else meaningless.
 *
 * The properties are neutralised rather than the rules overridden: they are
 * the deck's own hook, so cancelling them needs no knowledge of the selectors
 * and cannot go stale when those change. `calc()` on `auto` is invalid, which
 * drops the margin the scaling compensates for -- exactly what is wanted,
 * since nothing is scaled here.
 */
/*
 * Two intentions reconciled, and the division of labour is the point.
 *
 * The *bounds* -- how wide, how tall, how big the type -- belong to the popup
 * and are set by `sizeForContext`, which knows whether one is reading from a
 * desk or from the back of a room. Setting them here as well put the two in
 * competition, and the inner cap won: a `max-width` on the content made every
 * bound on the box around it pointless.
 *
 * What belongs here is only the *neutralising*: the chrome the borrowed class
 * brings and that has no business in a popup, and the deck's `--slide-*`
 * properties. Keeping only `--slide-font` left the rest active, so in Slides
 * mode the content was laid out as a 1280 by 720 slide inside a 400 by 200
 * box -- the cramped boxes and the clipped equations.
 *
 * `background` is deliberately *not* reset: the content keeps the one its own
 * kind gives it, which is what makes an admonition look like itself.
 *
 * The pieces are joined with their own separators. Concatenated without one,
 * `border-radius:0` ran into `width:auto` and the browser dropped the whole
 * malformed declaration without a word.
 */
const POPUP_CONTENT_RESET = [
  "height:auto",
  "max-height:none",
  "width:auto",
  "max-width:none",
  "overflow:visible",
  "border:0",
  "box-shadow:none",
  "padding:0",
  "border-radius:0",
  // The deck's own hooks, cancelled: see above.
  "--slide-w:auto",
  "--slide-h:auto",
  "--slide-scale:1",
  "--slide-padding:0",
  // Inherited from the popup, whose size `sizeForContext` has just set.
  "--slide-font:inherit",
].join(";");

/**
 * Wrap rendered HTML so that it is styled as it is in the preview.
 *
 * The popup is a sibling of the preview, not a descendant: styled-components
 * writes descendant selectors prefixed by the generated class, so none of them
 * reached it, and an admonition came out as its bare text with no box around
 * it. Borrowing the class is enough -- the markup already holds everything,
 * since the preview map stores each element's outerHTML.
 */
function styledAsPreview(html, root) {
  const previewEl = previewPane(root);
  if (!previewEl?.className) return html;
  // Only the generated classes: those are what carry the styles. Everything
  // else on the pane is a hook of ours, and each one has already cost
  // something when copied along.
  //
  // `myst-preview` is how the pane is found: copied, the wrapper looked like a
  // second preview pane to every querySelector in this file -- including the
  // one choosing where to mount it, which then tried to append the popup into
  // itself (HierarchyRequestError).
  //
  // `presenting` is how the deck covers the window: `position: fixed` at the
  // top left of the viewport. Copied, the wrapper became that overlay -- which
  // is why the popup's content was drawn stuck in the corner, at the full
  // width of the screen, while the popup itself, left with nothing in the flow
  // to measure, collapsed to an empty bubble at the right place. Three
  // symptoms, one class.
  //
  // `measuring-slides` is a transient of the same family, and has no business
  // here either.
  const PANE_HOOKS = new Set(["myst-preview", "presenting", "measuring-slides"]);
  const styleClasses = previewEl.className.split(/\s+/).filter((c) => c && !PANE_HOOKS.has(c)).join(" ");
  if (!styleClasses) return html;
  return `<div class="${styleClasses}" style="${POPUP_CONTENT_RESET}">${html}</div>`;
}

/**
 * Where the popup is attached.
 *
 * Inside the panes, not at the root of the shadow tree. Attached to the root it
 * was outside the container the panes live in, and inherited none of the theme
 * variables declared on it -- `var(--green-500)` resolved to nothing, so an
 * admonition came out with no colour at all, white on white for the kinds whose
 * title is light. Any descendant of that container restores the ancestry, for
 * the variables and for anything else scoped to it.
 *
 * Which pane, though, is not a detail: the modes hide a pane with
 * `display: none` rather than unmounting it, so the preview's wrapper is still
 * in the DOM in Inline mode -- and a popup put inside it is hidden with it,
 * which is exactly how the popups disappeared from the inline preview. Hence
 * the visibility test, and the editor's wrapper as the other home: the two are
 * never hidden at the same time, and neither is positioned, so the popup keeps
 * the same offset parent and `positionPopup` needs to know nothing about this.
 *
 * It stays out of the flow (`position: absolute` in the sheet), so a parent
 * laid out in flex or grid does not count it as one more column -- the mistake
 * made with the completion tooltips, which produced an empty third panel.
 */
const isDisplayed = (el) => !!el && el.offsetParent !== null;

/** The preview pane itself, never a popup that borrowed its classes. */
function previewPane(root) {
  for (const el of root.querySelectorAll?.(".myst-preview") ?? []) {
    if (!el.closest?.(".myst-preview-popup")) return el;
  }
  return null;
}

function popupMountPoint(root) {
  const pane = previewPane(root);
  // While the deck is presenting, inside the pane and nowhere else.
  //
  // `startPresenting` calls `requestFullscreen()` on the pane, and a fullscreen
  // element is painted in the browser's top layer: everything outside it is not
  // rendered at all, whatever its `z-index`. A popup that is the pane's sibling
  // is therefore invisible -- which is why the desktop build never showed the
  // problem, its window being fullscreen already. And even before real
  // fullscreen, the `presenting` class makes the pane cover the window, so a
  // popup placed against the host ends up under the bottom edge.
  if (pane?.classList.contains("presenting")) return pane;

  const besidePreview = pane?.parentElement;
  if (isDisplayed(besidePreview)) return besidePreview;
  const editorWrapper = root.getElementById?.("editor-wrapper") ?? root.querySelector?.("#editor-wrapper");
  if (isDisplayed(editorWrapper)) return editorWrapper;
  return besidePreview ?? editorWrapper ?? root;
}

function popupStateFor(root) {
  let state = popupByRoot.get(root);
  if (state?.el.isConnected) {
    // The mode can have changed since the popup was created, taking its host
    // pane out of sight; moving the element keeps its listeners and its state.
    const mount = popupMountPoint(root);
    // Never into itself, whatever the mount point resolved to.
    if (mount && mount !== state.el && !state.el.contains(mount) && state.el.parentElement !== mount) {
      mount.appendChild(state.el);
    }
    return state;
  }

  const el = document.createElement("div");
  el.className = "myst-preview-popup";
  el.style.display = "none";
  // Being a sibling of the preview means being a child of the flex wrapper,
  // whose `& > * { min-height: 500px }` gives the panes their size. The popup is
  // not a pane: it is as tall as what it shows. Inline rather than in the sheet
  // because both selectors weigh the same and the order of the sheets would
  // decide the winner.
  el.style.minHeight = "0";
  el.style.height = "auto";
  // And its width, for the same reason and one more. A popup is as wide as
  // what it shows, bounded; in a deck it came out the full width of the slide.
  // Which rule did that was never established -- inline wins over any of them
  // without having to be found, and `max-content` leaves no room for a parent
  // to stretch it either. The sheet keeps the same 400px, for anything that
  // reads the stylesheet rather than the element.
  // `fit-content` and not `max-content`: the latter measured 0 on a popup whose
  // content is a single reset-styled div, which would have left it invisible.
  // The width is set here and the bounds at each showing, by sizeForContext:
  // they depend on where one is looking from, which the element does not know
  // when it is created.
  el.style.width = "fit-content";
  popupMountPoint(root).appendChild(el);
  state = { el, showTimeout: null, hideTimeout: null };

  // Attached here rather than at setup time: the element did not exist yet when
  // setup ran, so these were never attached at all for the first editor, and
  // the popup vanished the moment one tried to move the pointer into it.
  el.addEventListener("mouseenter", () => clearTimeout(state.hideTimeout));
  el.addEventListener("mouseleave", () => {
    state.hideTimeout = setTimeout(() => { el.style.display = "none"; }, HIDE_DELAY);
  });

  popupByRoot.set(root, state);
  return state;
}

/**
 * How big the popup should be, which is not the same question on a screen and
 * on a projection.
 *
 * In the ordinary preview it is a note in the margin, read from a desk. On a
 * projected slide it is read from the back of a room, and the deck's own type
 * size is the only measure of that: `--slide-font` is what a slide is set in,
 * and `--slide-scale` is what the pane does to fit it on the screen, so their
 * product is the size a letter actually has. Both are set inline on the pane,
 * which the popup is a sibling of and does not inherit from -- hence reading
 * them rather than relying on the cascade.
 *
 * The bounds are then expressed in `em`, so they follow whatever that size
 * turns out to be: a 400px box beside 28pt text would hold three words. And a
 * height at last, with a scrollbar: a long note had nothing stopping it from
 * running off the bottom of the screen.
 */
function sizeForContext(popup, root) {
  const pane = previewPane(root);
  const presenting = pane?.classList.contains("presenting");
  if (presenting) {
    const cs = getComputedStyle(pane);
    const font = parseFloat(cs.getPropertyValue("--slide-font")) || 28;
    const scale = parseFloat(cs.getPropertyValue("--slide-scale")) || 1;
    popup.style.fontSize = `${Math.round(font * scale * 100) / 100}px`;
  } else {
    popup.style.fontSize = "";
  }
  // Bounds in `em` and in viewport units, and no percentage: the popup hangs in
  // a wrapper of automatic height, where `100%` resolves to zero -- `min(60vh,
  // calc(100% - 16px))` therefore came out as `max-height: 0` and the popup
  // vanished altogether. A viewport unit always resolves.
  //
  // 32em rather than 24: a note holds equations, and they do not reflow. And
  // `overflow` on both axes rather than `overflow-y` alone, since a single
  // axis set to `auto` turns the other from `visible` into `auto` too -- which
  // clipped the wide equations instead of letting them scroll.
  popup.style.maxWidth = "min(32em, 90vw)";
  popup.style.maxHeight = "70vh";
  popup.style.overflow = "auto";
}

function positionPopup(popup, targetRect, root) {
  popup.style.display = "block";
  const popupRect = popup.getBoundingClientRect();

  // Against whatever the popup is actually offset from, rather than against the
  // host: the two are the same in the ordinary preview and are not while the
  // deck presents, where the popup lives inside a pane that covers the window.
  // Measuring against the host there put it below the bottom edge.
  const base = popup.offsetParent ?? root.host ?? null;
  const baseRect = base ? base.getBoundingClientRect() : { top: 0, left: 0 };
  const baseWidth = base?.clientWidth ?? window.innerWidth;
  const baseHeight = base?.clientHeight ?? window.innerHeight;

  let top = targetRect.bottom - baseRect.top + 8;
  let left = targetRect.left - baseRect.left;

  const maxLeft = baseWidth - popupRect.width - 8;
  if (left > maxLeft) left = Math.max(8, maxLeft);

  const maxTop = baseHeight - popupRect.height - 8;
  if (top > maxTop) top = targetRect.top - baseRect.top - popupRect.height - 8;
  if (top < 8) top = 8;

  popup.style.top = `${top}px`;
  popup.style.left = `${left}px`;
}

/**
 * Put the popup away, for a reason other than the pointer.
 *
 * Showing and hiding were driven by `mouseover` and `mouseout` alone, which is
 * enough while the pointer is what moves. In a slideshow it is not: the slides
 * are changed from the keyboard, the pointer never leaves the reference it was
 * resting on, no `mouseout` is ever sent, and the popup stays on screen over
 * the following slides -- and still there on the way back to the editor.
 *
 * So whoever changes what is on screen says so.
 */
export function hidePreviewPopup(root) {
  const state = popupByRoot.get(root);
  if (!state) return;
  clearTimeout(state.showTimeout);
  clearTimeout(state.hideTimeout);
  state.el.style.display = "none";
}

export function setupPreviewPopups(root, text) {
  const showDelay = 250;

  root.addEventListener("mouseover", (ev) => {
    const target = ev.target.closest?.("[data-preview]");
    if (!target) return;

    const state = popupStateFor(root);
    clearTimeout(state.hideTimeout);
    clearTimeout(state.showTimeout);

    state.showTimeout = setTimeout(() => {
      const id = target.getAttribute("data-preview");
      const html = resolvePreviewHtml(id, text);
      if (!html) return;

      state.el.innerHTML = styledAsPreview(html, root);
      sizeForContext(state.el, root);
      positionPopup(state.el, target.getBoundingClientRect(), root);
    }, showDelay);
  });

  root.addEventListener("mouseout", (ev) => {
    const target = ev.target.closest?.("[data-preview]");
    if (!target) return;
    const state = popupByRoot.get(root);
    if (!state) return;
    // Ignore si on passe juste vers la popup elle-même ou un enfant du même lien.
    if (ev.relatedTarget && (state.el.contains(ev.relatedTarget) || target.contains(ev.relatedTarget))) return;
    clearTimeout(state.showTimeout);
    state.hideTimeout = setTimeout(() => { state.el.style.display = "none"; }, HIDE_DELAY);
  });
}