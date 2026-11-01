import { EditorView } from "codemirror";
import { ViewPlugin } from "@codemirror/view";
import { markdownUpdatedEffect } from "../text";
import { findNearestElementForLine } from "../markdown/markdownSourceMap";

/**
 * What to measure, when the caret's line renders inside a folded disclosure.
 *
 * A closed `details` hides its content with `content-visibility: hidden`, which
 * *freezes* the subtree's layout rather than removing it: the figure is no
 * longer painted, but `getBoundingClientRect()` on it still answers with the
 * size it had while the box was open. So the bar was drawn the height of a
 * figure nobody could see, hanging out of the folded box -- and no amount of
 * recomputing could have helped, since the number being read was the preserved
 * one.
 *
 * The folded box itself is the right thing to point at anyway: it says "what
 * you are editing is in there", which is more useful than nothing at all.
 *
 * The climb goes to the *outermost* closed disclosure, since one nested inside
 * another closed one is just as invisible.
 */
const visibleAncestor = (element) => {
  let target = element;
  for (
    let folded = target.closest?.("details:not([open])");
    folded;
    folded = folded.parentElement?.closest("details:not([open])")
  ) {
    target = folded;
  }
  return target;
};

/**
 * Put the bar beside whatever the caret's line renders as.
 *
 * Pulled out of the update listener so that something other than an editor
 * update can ask for it -- see `repositionOnToggle`.
 */
const place = (view, text) => {
  // Read here, since the preview can mount after the editor and be replaced on a mode switch.
  const preview = text.preview.peek();
  if (!preview) return;

  const cursorLine = view.state.doc.lineAt(view.state.selection.main.head).number;
  const [matchingElem] = findNearestElementForLine(cursorLine, text.lineMap, preview);
  const previewElement = preview.querySelector(".cm-previewFocus");
  if (!previewElement) return;
  if (matchingElem && view.hasFocus) {
    const previewRect = preview.getBoundingClientRect();
    const matchingRect = visibleAncestor(matchingElem).getBoundingClientRect();

    previewElement.style.top = `${matchingRect.top - previewRect.top + preview.scrollTop}px`;
    // the decoration of a list item is not contained within it's clientRect
    const leftPos =
      matchingRect.left - previewRect.left - 12.5 - (matchingElem.tagName === "LI" || matchingElem.parentElement.tagName === "LI" ? 17 : 0);
    previewElement.style.left = `${leftPos}px`;
    previewElement.style.height = `${matchingRect.height}px`;
  } else {
    previewElement.style.height = "0px";
  }
};

/**
 * Follow a disclosure being opened or closed in the preview.
 *
 * The bar is placed from the rectangle of the element the caret's line renders
 * as, and that was recomputed only on a caret move, a keystroke or a resize of
 * the *editor*. Folding an admonition in the preview is none of those, so the
 * bar kept the size and position it had while the box was open and hung out of
 * the folded one until the next edit.
 *
 * Three things decide where the listener goes, and the first was learned the
 * hard way: `toggle` is **not composed**, so it does not cross a shadow
 * boundary at all -- not even in the capture phase, which is where a first
 * attempt put it, on `document`, where the event never arrived. The editor
 * mounts in a shadow root per tab, so the listener goes on that root, which
 * also outlives the preview element -- replaced on every change of mode -- and
 * keeps one editor from answering for another's documents.
 *
 * In the capture phase, since `toggle` does not bubble either. And on the next
 * frame, since the event is sent before the layout has caught up with it.
 */
const repositionOnToggle = (text) =>
  ViewPlugin.define((view) => {
    const root = view.dom.getRootNode();
    const onToggle = (ev) => {
      const preview = text.preview.peek();
      if (!preview || !(ev.target instanceof Element) || !preview.contains(ev.target)) return;
      requestAnimationFrame(() => place(view, text));
    };
    root.addEventListener("toggle", onToggle, true);
    return { destroy: () => root.removeEventListener("toggle", onToggle, true) };
  });

export const cursorIndicator = (text) => [
  repositionOnToggle(text),
  EditorView.updateListener.of((update) => {
    const cursorLineBefore = update.startState.doc.lineAt(update.startState.selection.main.head).number;
    const cursorLineAfter = update.state.doc.lineAt(update.state.selection.main.head).number;
    const selectionChanged = update.selectionSet && (cursorLineBefore !== cursorLineAfter || cursorLineBefore === 1);
    const markdownUpdated = update.transactions.some((t) => t.effects.some((e) => e.is(markdownUpdatedEffect)));
    const resized = update.geometryChanged && !update.viewportChanged;
    if (update.docChanged || (!selectionChanged && !markdownUpdated && !resized && !update.focusChanged)) {
      return;
    }

    place(update.view, text);
  }),
];
