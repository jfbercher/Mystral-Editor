import { EditorView } from "codemirror";
import { findNearestElementForLine } from "./markdown/markdownSourceMap";

export function scrollToPos(pos, { editorView, options, text }) {
  const view = editorView.peek();
  if (!view) return;
  view.dispatch({ selection: { anchor: pos, head: pos }, effects: EditorView.scrollIntoView(pos, { y: "start" }) });

  // In Preview mode the editor is hidden, so the scroll above is invisible - scroll the preview pane instead.
  const preview = options.mode.peek() === "Preview" && text.preview.peek();
  if (!preview) return;
  const [elem] = findNearestElementForLine(view.state.doc.lineAt(pos).number, text.lineMap, preview);
  if (!elem) return;
  preview.scrollTo({ top: preview.scrollTop + elem.getBoundingClientRect().top - preview.getBoundingClientRect().top, behavior: "smooth" });
}

/**
 * Scroll the preview to content pulled in by an {include}. Such content has no
 * position in the editor -- its lines are not lines of this document -- so only
 * the preview moves, and only when it is on screen and already rendered.
 */
export function scrollToVirtualLine(line, { text }) {
  const preview = text.preview.peek();
  const id = text.virtualLineMap?.get(line);
  if (!preview || !id) return false;
  const elem = preview.querySelector(`[data-line-id="${id}"]`);
  if (!elem?.offsetParent) return false;
  preview.scrollTo({ top: preview.scrollTop + elem.getBoundingClientRect().top - preview.getBoundingClientRect().top, behavior: "smooth" });
  return true;
}

export async function waitForElement(parent, id) {
  return new Promise((resolve) => {
    const elem = parent.getElementById(id);
    if (elem) {
      resolve(elem);
      return;
    }

    const observer = new MutationObserver(() => {
      const elem = parent.getElementById(id);
      if (elem) {
        observer.disconnect();
        resolve(elem);
      }
    });

    observer.observe(parent, { childList: true, subtree: true });
  });
}
