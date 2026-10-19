/**
 * Repair the labels of the proof family in a `.tex`.
 *
 * A WORKAROUND, and deliberately a separate file so that deleting it is the
 * whole removal. `myst-to-tex`'s proof handler is the only one that writes its
 * anchor from the normalised identifier -- `\label{newNode.identifier}` --
 * where headings, equations and figures write the label as the author typed
 * it, and where every cross-reference writes `\ref{node.label}`, also as
 * typed. Since `normalizeLabel()` lowercases, a theorem labelled `My-Theorem`
 * leaves `\label{my-theorem}` and `\ref{My-Theorem}` in the same file: LaTeX
 * resolves neither and the PDF carries `??` where the number should be.
 *
 * Nothing warns before the export -- the editor never normalises, so
 * everything is right on screen. `proofLabelCase.js` marks the labels at
 * risk while typing; this puts them back as typed in the `.tex`, so the two
 * halves of the same reference agree again.
 *
 * To remove once mystmd is fixed: delete this file and its two call sites.
 */

/**
 * mystmd's `normalizeLabel`, reproduced.
 *
 * Copied rather than imported, from myst-common's utils.js: collapse runs of
 * whitespace, drop quotes, trim, lowercase. Reproducing it is what lets us
 * predict the string mystmd wrote and find it; a looser rule would match
 * labels it never touched.
 */
export function normalizedIdentifier(label) {
  return String(label ?? "")
    .replace(/[\t\n\r ]+/g, " ")
    .replace(/['‘’"“”]+/g, "")
    .trim()
    .toLowerCase();
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * @typedef {object} ProofLabelRepair
 * @property {string} label       as the author typed it
 * @property {string} identifier  as mystmd wrote it
 * @property {"repaired"|"absent"|"ambiguous"|"unchanged"} outcome
 */

/**
 * @param {string} tex
 * @param {{label: string}[]} labels  every proof-family label of the source
 * @returns {{ text: string, repairs: ProofLabelRepair[], repaired: number }}
 */
export function repairProofLabels(tex, labels) {
  let text = String(tex ?? "");
  const repairs = [];
  let repaired = 0;

  for (const { label } of labels) {
    const identifier = normalizedIdentifier(label);
    // Nothing was mangled: mystmd wrote exactly what the author typed.
    if (identifier === label) {
      repairs.push({ label, identifier, outcome: "unchanged" });
      continue;
    }

    const re = new RegExp(`\\\\label\\{${escapeRe(identifier)}\\}`, "g");
    const found = text.match(re) ?? [];
    if (found.length === 0) {
      // Not an error in itself: a proof whose label is never written, or an
      // export that did not include this part of the document.
      repairs.push({ label, identifier, outcome: "absent" });
      continue;
    }
    if (found.length > 1) {
      // Two labels normalising to the same identifier -- `Thm-A` and `thm-a`,
      // say. mystmd has already lost which is which; guessing here would put
      // the wrong anchor on one of them, and a wrong reference that resolves
      // is worse than one that does not.
      repairs.push({ label, identifier, outcome: "ambiguous" });
      continue;
    }

    text = text.replace(re, `\\label{${label}}`);
    repairs.push({ label, identifier, outcome: "repaired" });
    repaired++;
  }

  return { text, repairs, repaired };
}
