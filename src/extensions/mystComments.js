import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";

/**
 * Commentaires MyST : une ligne commençant par `%` est ignorée au rendu.
 *
 * À la différence du `toggleComment` de @codemirror/commands, le marqueur est
 * posé en colonne 0 et non après l'indentation — MyST n'accepte le `%` que
 * comme tout premier caractère de la ligne.
 */

const MARKER = "%";
const COMMENTED = /^%[ \t]?/;

/** Toutes les lignes touchées par la sélection, dédoublonnées et ordonnées. */
const selectedLines = (state) => {
  const numbers = new Set();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from);
    const last = state.doc.lineAt(range.to);
    for (let n = first.number; n <= last.number; n++) numbers.add(n);
    // Une sélection qui s'arrête pile au début d'une ligne ne doit pas l'inclure.
    if (!range.empty && last.from === range.to && last.number > first.number) {
      numbers.delete(last.number);
    }
  }
  return [...numbers].sort((a, b) => a - b).map((n) => state.doc.line(n));
};

/** @type {import("@codemirror/view").Command} */
export const toggleMystComment = (view) => {
  const { state } = view;
  if (state.readOnly) return false;

  const lines = selectedLines(state);
  // On ignore les lignes vides, sauf si la sélection ne contient que ça.
  const filled = lines.filter((l) => l.text.trim().length > 0);
  const targets = filled.length ? filled : lines;
  if (!targets.length) return false;

  const uncomment = targets.every((l) => l.text.startsWith(MARKER));
  const changes = [];

  for (const line of targets) {
    if (uncomment) {
      const [match] = COMMENTED.exec(line.text) ?? [];
      if (match) changes.push({ from: line.from, to: line.from + match.length });
    } else {
      changes.push({ from: line.from, insert: MARKER + " " });
    }
  }

  if (!changes.length) return false;
  // La sélection est remappée automatiquement à travers les changements.
  view.dispatch(state.update({ changes, userEvent: uncomment ? "input.uncomment" : "input.comment" }));
  return true;
};

/**
 * `Prec.high` est nécessaire : `defaultKeymap` lie déjà Mod-/ à `toggleComment`
 * et est enregistré avant nous dans `ExtensionBuilder`.
 */
// export const mystComments = () => Prec.high(keymap.of([{ key: "Mod-/", run: toggleMystComment, preventDefault: true }]));

export const mystComments = () =>
  Prec.high(
    keymap.of([
      { key: "Mod-/", run: toggleMystComment, preventDefault: true },
      { key: "Mod-:", run: toggleMystComment, preventDefault: true }, // AZERTY, sans Shift
      { key: "Mod-Shift-/", run: toggleMystComment, preventDefault: true }, // filet de sécurité
    ]),
  );
