/**
 * Whether a cell opens showing its code.
 *
 * `:open: false` opens it folded; a cell that says nothing opens showing its
 * code. `:fold:` is the older spelling of the same thing the other way round
 * -- it folds -- and is still read, because documents carry it; `:open:`
 * wins when both appear.
 *
 * ## What the chevron does, and what it no longer does
 *
 * It folds the cell in front of you, and that is all. It used to write the
 * state back into the source, so that a document reopened a week later came
 * back tidied. The intention was good and the mechanism was wrong: an edit
 * made in answer to a view gesture re-renders the document, and a re-render
 * moves what one is looking at. That produced a long series of defects --
 * the pane creeping up a line at each fold, the preview jumping to wherever
 * the source happened to be, the slide replaying its entrance mid-sentence --
 * each fixed in its own place, and each a symptom of the same confusion.
 *
 * Folding is a property of the reading, not of the document. So the reader
 * folds, and nothing is written; the author writes `:open: false`, and that
 * is what survives a reopening, another machine, a copy sent to a student.
 * What is lost is the automatic tidying, and it is worth its price.
 *
 * A fence carries its flags in the info string rather than on option lines,
 * where `:open: false` has nowhere to put its value. There, `:fold:` remains
 * the way to say it.
 */

/**
 * Whether an option meant as a boolean is on.
 *
 * A directive's options reach us raw, so the three ways of writing the same
 * thing all arrive distinct: `:opt:` alone is `null`, `:opt: true` and
 * `:opt: false` are real booleans (YAML reads `True` and `yes` too), and a
 * value typed by hand is a string. Absent is off; present and bare is on;
 * anything spelling falsehood is off.
 *
 * Read raw on purpose: the directive library, left to convert them, turns a
 * `false` into an empty string before the convertor ever sees it -- which made
 * `:linenos: false` indistinguishable from `:linenos:`, and therefore turn
 * line numbers *on*. See `rawOptions` on CodeCellDirective.
 */
export const optionIsOn = (raw) => {
  if (raw === undefined) return false;
  if (raw === null || raw === true) return true;
  if (raw === false) return false;
  const value = String(raw).trim().toLowerCase();
  return !(value === "false" || value === "0" || value === "no" || value === "off");
};

/** Does this fence's info string carry the flag? `:fold:` beside `:linenos:`. */
export const infoHasFold = (info) => /(^|\s):fold:(\s|$)/i.test(String(info ?? ""));

/**
 * What `data-fold` should carry for a directive's options.
 *
 * Three values and not two: "1" folded, "0" open, and the empty string for a
 * cell that says neither -- which is not the same as saying "open", since
 * `:tags: hide-input` folds a cell that has no opinion of its own.
 */
export function foldAttr(options) {
  const open = options?.open;
  if (open !== undefined) return optionIsOn(open) ? "0" : "1";
  const fold = options?.fold;
  if (fold !== undefined) return optionIsOn(fold) ? "1" : "0";
  return "";
}
