/**
 * Positions and severities, between CodeMirror and the language-server protocol.
 *
 * Shared by the YAML and JSON extensions. These three are the whole of what
 * the two have identically in common: everything else -- how the schema is
 * named, what a completion item looks like, how a region of a markdown
 * document is reached -- differs between them, and pretending otherwise would
 * cost more than the duplication it saves.
 */

/**
 * A CodeMirror offset as an LSP position.
 *
 * CodeMirror numbers its lines from one, the protocol from zero, hence the
 * subtraction. `lineOffset` is for a caller that sends the server a document
 * that is not exactly the editor's: the YAML extension prepends a line
 * holding the schema comment, so everything it sends is one line further
 * down, and it passes 1. Reading `line.number` straight across happened to be
 * right for that one caller, and only for it -- which is why a document sent
 * without a prefix pointed one line too far.
 */
export const cmPosToLspPos = (state, pos, lineOffset = 0) => {
  const line = state.doc.lineAt(pos);
  return { line: line.number - 1 + lineOffset, character: pos - line.from };
};

/** An LSP position as a CodeMirror offset, undoing the same offset. */
export const lspPosToCmPos = (state, pos, lineOffset = 0) => {
  const line = state.doc.line(Math.min(state.doc.lines, Math.max(1, pos.line + 1 - lineOffset)));
  return Math.min(line.to, line.from + pos.character);
};

/**
 * An LSP severity as a CodeMirror one.
 *
 * The protocol numbers them from one: Error 1, Warning 2, Information 3,
 * Hint 4. The editor read 2 as an error and 1 as a warning, which swapped the
 * two: a syntax error was shown in the colour of an advice, and an unknown
 * key in the colour of a fault. Anything else -- a severity the server leaves
 * out, or one the protocol adds later -- is a hint, which is the level that
 * asks for nothing.
 */
export const lspSeverityToCm = (severityLevel) => {
  if (severityLevel === 1) return "error";
  if (severityLevel === 2) return "warning";
  if (severityLevel === 3) return "info";
  return "hint";
};
