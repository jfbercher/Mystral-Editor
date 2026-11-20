import { EditorView } from "@codemirror/view";
import { tableFromHtml, tableFromText, tableToMyst } from "../markdown/clipboardTable.js";
import { showToast } from "../utils/utils_ui.js";

/**
 * Offering to turn a pasted table into a MyST one.
 *
 * The rule this follows is the one the whole question hangs on: **a paste
 * must never surprise**. If the reader wanted the plain text, they must get
 * the plain text. So nothing is intercepted -- the tab-separated text goes
 * in exactly as it always has -- and the offer comes afterwards, as a
 * notice with a button. Ignored, it fades and nothing happened; taken, it
 * replaces what was just inserted, in one dispatch, so one undo puts the
 * text back.
 *
 * This is the opposite choice from a pasted image, and for a reason the
 * clipboard itself gives: an image has no fallback representation, so
 * intercepting it is the only way to not lose it. A table has a perfectly
 * good one, and taking it over would be deciding for the author.
 */

/** The DOM parser, as a function, so the reading module stays testable. */
const parseHtml = (html) => new DOMParser().parseFromString(html, "text/html");

/**
 * The table a clipboard holds, or null.
 *
 * Shared with the image handler, which has to know: a spreadsheet puts a
 * *picture of the selection* in the clipboard alongside the table itself, so
 * "an image has no fallback representation" -- the reason images are
 * intercepted at all -- is false exactly there. An image of a table is the
 * poorest of the representations on offer, and the one nobody meant.
 */
export function tableInClipboard(clip) {
  if (!clip) return null;
  try {
    return tableFromHtml(clip.getData("text/html"), parseHtml) ?? tableFromText(clip.getData("text/plain"));
  } catch (err) {
    console.warn("[paste] the clipboard's table could not be read:", err);
    return null;
  }
}

export const pasteTable = () =>
  EditorView.domEventHandlers({
    paste(event, view) {
      // No test for an image here, and that is deliberate: a spreadsheet
      // sends one along with the table, and standing down for it would be
      // standing down for exactly the paste this exists to answer. A
      // clipboard with an image and no table never reaches this point --
      // the image handler takes that paste over.
      const table = tableInClipboard(event.clipboardData);
      if (!table) return false;

      const from = view.state.selection.main.from;
      // After the paste, not instead of it: the handler returns false, the
      // editor inserts the text, and the frame after that is the first
      // moment the inserted range can be read from the document itself --
      // which is safer than computing it from the clipboard's own length.
      requestAnimationFrame(() => offer(view, from, table));
      return false;
    },
  });

/**
 * Propose the conversion, and do it if asked.
 *
 * The range is checked again when the button is pressed: a notice waits for
 * a reader, and a reader may have typed in the meantime. Rather than
 * replace a range that has moved under it -- which would eat whatever is
 * there now -- it says so and leaves the document alone.
 */
function offer(view, from, table) {
  const to = view.state.selection.main.head;
  if (to <= from) return;
  const pasted = view.state.doc.sliceString(from, to);
  const { text, kind } = tableToMyst(table);

  showToast(`Pasted as text — convert it to a ${kind}?`, "info", 0, {
    label: "Convert",
    onClick: () => {
      if (view.state.doc.sliceString(from, to) !== pasted) {
        showToast("The pasted text has changed since; nothing was converted.", "warning", 4000);
        return;
      }
      // On its own lines, wherever the caret was: a table in the middle of a
      // sentence is not a table, and the blank line before it is what makes
      // the directive a block of its own.
      const before = from > 0 && view.state.doc.sliceString(from - 1, from) !== "\n" ? "\n\n" : "";
      const after = to < view.state.doc.length && view.state.doc.sliceString(to, to + 1) !== "\n" ? "\n" : "";
      const insert = `${before}${text}${after}`;
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
        userEvent: "input.paste",
        scrollIntoView: true,
      });
      view.focus();
    },
  });
}
