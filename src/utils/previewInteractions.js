/** Handles a click in the projected preview HTML: toggle dropdown, scroll to internal anchor.
@returns {boolean} true if the event was handled (to be stopped/prevented further)
 */

import { EditorView } from "@codemirror/view";
import { isTauri } from "./local_utils";


function resolveLabelToLine(label, refMap) {
  return refMap?.byLabel?.get(label)?.line ?? null;
}

export function handlePreviewInteraction(ev, root, view, refMap, headingMap) {
  const dropdownHeader = ev.target.closest(".admonition.dropdown > header");
  if (dropdownHeader) {
    dropdownHeader.parentElement.classList.toggle("open");
    return true;
  }

  const anchorLink = ev.target.closest('a[href^="#"]');
  if (anchorLink) {
    ev.preventDefault();
    const targetId = decodeURIComponent(anchorLink.getAttribute("href").slice(1));



  if (view) {
  // A heading with no explicit (label)= gets id="hpos-{offset}", and that is what
  // a {toc} links to -- see anchorFor() in markdownDirectives.js. It is not a
  // label, so the lookup below cannot find it, and the DOM fallback at the end of
  // this function cannot help either: CodeMirror only renders the part of the
  // document around the viewport, so the heading being aimed at is usually not in
  // the DOM at all. Those links did nothing at all.
  //
  // The offset is a position in this document, so this is the side outline's own
  // move, scrollToPos() in utils.js: set the selection, ask CodeMirror to bring it
  // into view, and leave the geometry alone. "hpos-v123" is a heading of an
  // included file, which has no position here; it is left to the fallback.
  if (targetId.startsWith("hpos-")) {
    const pos = Number(targetId.slice(5));
    if (Number.isInteger(pos) && pos >= 0 && pos <= view.state.doc.length) {
      view.dispatch({ selection: { anchor: pos, head: pos }, effects: EditorView.scrollIntoView(pos, { y: "start" }) });
      return true;
    }
  }

  const lineNumber = resolveLabelToLine(targetId, refMap);
  if (lineNumber != null && lineNumber <= view.state.doc.lines) {
    const pos = view.state.doc.line(lineNumber).from;

    view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "start" }) });

    requestAnimationFrame(() => {
      const lineBlock = view.lineBlockAt(pos);
      const mystEditor = view.dom.closest("#myst-editor") ?? view.scrollDOM.parentElement;
      const scrollerRect = view.scrollDOM.getBoundingClientRect();
      const editorRect = mystEditor.getBoundingClientRect();
      const offset = scrollerRect.top - editorRect.top + mystEditor.scrollTop;

      mystEditor.scrollTo({ top: lineBlock.top + offset, behavior: "smooth" });
    });
    return true;
  }
} 

/* We move to the footnotes section at the end of the document; 
this is done in two steps, because the document isn't necessarily formatted 
yet and the destination may not be clearly marked.*/

if (targetId.startsWith("fn:") && view) {
  const mystEditor = view.dom.closest("#myst-editor") ?? view.scrollDOM.parentElement;
  mystEditor.scrollTo({ top: Number.MAX_SAFE_INTEGER, behavior: "instant" });
  setTimeout(() => {
    mystEditor.scrollTo({ top: Number.MAX_SAFE_INTEGER, behavior: "instant" });
  }, 100);
  return true;
}

// Fallback
    const targetEl = root?.querySelector?.(`#${CSS.escape(targetId)}`);
    targetEl?.scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
  }

  return false;
}
