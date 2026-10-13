import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { PROOF_FAMILY } from "../config-defaults.js";

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

/** Any fence; `info` empty means a closing one. */
const FENCE_RE = /^ {0,3}([:~`])\1{2,}[ \t]*(.*)$/;

/** `{proof:theorem}`, `{prf:theorem}` or `{theorem}`, as a fence's info string. */
const PROOF_INFO_RE = new RegExp(String.raw`^\{(?:proof:|prf:)?(?:${Object.keys(PROOF_FAMILY).join("|")})\}`);

/** An option line, and the label options among them. */
const OPTION_RE = /^\s*:[\w-]+:/;
const LABEL_OPTION_RE = /^(\s*:(?:label|name):\s*)(\S+)/;

/**
 * The label options of the proof family that carry an uppercase letter.
 *
 * The fences are tracked so that a directive shown inside a code block is not
 * reported: in a document about MyST, that is most of them.
 *
 * @param {Iterable<string>} lines
 * @returns {{from: number, to: number, label: string}[]}
 */
export function findUppercaseProofLabels(lines) {
  const out = [];
  const stack = [];
  let offset = 0;
  let inOptions = false;

  for (const line of lines) {
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const char = fence[1];
      const indent = line.length - line.trimStart().length;
      const len = /^(.)\1*/.exec(line.slice(indent))[0].length;
      const info = fence[2].trim();
      const top = stack[stack.length - 1];

      if (top && char === top.char && len >= top.len && info === "") {
        stack.pop();
        inOptions = false;
      } else if (!top?.code) {
        if (info !== "") {
          // A directive is `{name}`; anything else opened with a backtick or a
          // tilde is code, whose content is not read.
          const code = char !== ":" && !info.startsWith("{");
          stack.push({ char, len, code });
          inOptions = !code && PROOF_INFO_RE.test(info);
        } else if (char !== ":") {
          stack.push({ char, len, code: true });
        }
      }
      offset += line.length + 1;
      continue;
    }

    if (inOptions && !stack[stack.length - 1]?.code) {
      const label = LABEL_OPTION_RE.exec(line);
      if (label) {
        const [, prefix, value] = label;
        if (value !== value.toLowerCase()) {
          out.push({ from: offset + prefix.length, to: offset + prefix.length + value.length, label: value });
        }
      } else if (!OPTION_RE.test(line)) {
        // The first line that is not an option: the body has started.
        inOptions = false;
      }
    }
    offset += line.length + 1;
  }

  return out;
}

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
      for (const m of findUppercaseProofLabels(view.state.doc.iterLines())) {
        builder.add(m.from, m.to, uppercaseLabel);
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
