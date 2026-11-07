/**
 * Positions and severities, between CodeMirror and the language-server protocol.
 *
 * Shared by the YAML and JSON extensions. These three are the whole of what
 * the two have identically in common: everything else -- how the schema is
 * named, what a completion item looks like, how a region of a markdown
 * document is reached -- differs between them, and pretending otherwise would
 * cost more than the duplication it saves.
 */

/** A CodeMirror offset as an LSP position. */
export const cmPosToLspPos = (state, pos) => {
  const line = state.doc.lineAt(pos);
  return { line: line.number, character: pos - line.from };
};

/** An LSP position as a CodeMirror offset. */
export const lspPosToCmPos = (state, pos) => {
  const line = state.doc.line(pos.line);
  return line.from + pos.character;
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
