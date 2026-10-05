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
const POPUP_CONTENT_RESET =
  "height:auto;max-height:none;overflow:visible;background:transparent;border:0;box-shadow:none;padding:0;border-radius:0";

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
  const previewEl = root.querySelector?.(".myst-preview");
  if (!previewEl?.className) return html;
  return `<div class="${previewEl.className}" style="${POPUP_CONTENT_RESET}">${html}</div>`;
}

/**
 * Where the popup is attached.
 *
 * Beside the preview, not at the root of the shadow tree. Attached to the root
 * it was outside the container the preview lives in, and inherited none of the
 * theme variables declared on it -- `var(--green-500)` resolved to nothing, so
 * an admonition came out with no colour at all, white on white for the kinds
 * whose title is light. Being a sibling of the preview puts it back under the
 * same ancestry, for the variables and for anything else scoped to it.
 *
 * It stays out of the flow (`position: absolute` in the sheet), so a parent
 * laid out in flex or grid does not count it as one more column -- the mistake
 * made with the completion tooltips, which produced an empty third panel.
 */
function popupMountPoint(root) {
  return root.querySelector?.(".myst-preview")?.parentElement ?? root;
}

function popupStateFor(root) {
  let state = popupByRoot.get(root);
  if (state?.el.isConnected) return state;

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

function positionPopup(popup, targetRect, root) {
  const rootRect = root.host ? root.host.getBoundingClientRect() : { top: 0, left: 0 };
  popup.style.display = "block";
  const popupRect = popup.getBoundingClientRect();

  let top = targetRect.bottom - rootRect.top + 8;
  let left = targetRect.left - rootRect.left;

  const maxLeft = (root.host?.clientWidth ?? window.innerWidth) - popupRect.width - 8;
  if (left > maxLeft) left = Math.max(8, maxLeft);

  const maxTop = (root.host?.clientHeight ?? window.innerHeight) - popupRect.height - 8;
  if (top > maxTop) top = targetRect.top - rootRect.top - popupRect.height - 8;

  popup.style.top = `${top}px`;
  popup.style.left = `${left}px`;
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