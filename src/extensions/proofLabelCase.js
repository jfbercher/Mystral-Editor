import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { findProofLabels } from "../markdown/scanProofLabels.js";

/**
 * Mark a label of the proof family that is not all lowercase.
 *
 * A workaround for a bug in `myst-to-tex`, not a rule of MyST, and to be
 * removed once it is fixed upstream. Its handler for the proof family is the
 * only one that writes its anchor with the normalised identifier --
 * `\label{newNode.identifier}` in proof.js -- where headings, equations and
 * figures write the label as it was typed, and where every cross-reference
 * writes `\ref{node.label}`. Since `normalizeLabel()` lowercases the
 * identifier, a theorem labelled `My-Theorem` leaves `\label{my-theorem}` and
 * `\ref{My-Theorem}` in the same .tex: LaTeX resolves neither, and the PDF
 * carries `??` where the number should be. Everything is correct in the editor,
 * which never normalises, so nothing warns before the export.
 *
 * Only the `:label:` and `:name:` options are read. The scan is a line scan, as
 * in orphanFence.js: an option can only appear in the lines that follow the
 * opening fence, and reading them is simpler and cheaper than walking the
 * syntax tree.
 */

const uppercaseLabel = Decoration.mark({
  class: "cm-proof-label-case",
  attributes: {
    title:
      "Use a lowercase label here. In a LaTeX, PDF or Word export, mystmd writes the anchor of a " +
      "theorem, proposition or proof in lowercase while cross-references keep the case you typed, " +
      "so the reference resolves to ?? in the document produced. This is a bug in myst-to-tex, not " +
      "a rule of MyST: the editor itself handles either case.",
  },
});

export const proofLabelCase = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = this.build(view);
    }

    update(update) {
      if (update.docChanged) this.decorations = this.build(update.view);
    }

    build(view) {
      const builder = new RangeSetBuilder();
      // Only the ones mystmd will lowercase on the way to LaTeX; the scan
      // itself is neutral and returns every proof label.
      for (const m of findProofLabels(view.state.doc.iterLines())) {
        if (m.label !== m.label.toLowerCase()) builder.add(m.from, m.to, uppercaseLabel);
      }
      return builder.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

/**
 * The same marking as the orphan fence, and for the same reason: a plain wavy
 * underline is what the spellchecker draws, and this one disappeared among its
 * squiggles. The highlight carries its own foreground colour so that it reads
 * the same in both themes.
 */
export const proofLabelCaseTheme = EditorView.baseTheme({
  ".cm-proof-label-case": {
    background: "var(--fence-error-bg, #ffb224)",
    color: "var(--fence-error-fg, #1f2328)",
    fontWeight: "700",
    borderRadius: "2px",
    padding: "0 2px",
    textDecoration: "underline wavy var(--error-bg, #cf222e)",
    textDecorationThickness: "2px",
    textDecorationSkipInk: "none",
    textUnderlineOffset: "3px",
    cursor: "help",
  },
});
