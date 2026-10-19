/**
 * Cosmetic tidying of a `.tex` produced by mystmd.
 *
 * Changes nothing LaTeX reads. mystmd closes an environment and starts the
 * next thing on the same line -- `\end{theorem}\begin{definition}`, or
 * `\end{definition}et des références` -- which compiles perfectly and is
 * miserable to read, to diff and to debug. Since the whole point of exporting
 * to LaTeX rather than straight to PDF is that someone opens the file, that is
 * worth a pass of its own.
 */

/** Regions whose content is typeset verbatim and must not be touched. */
const VERBATIM = /\\begin\{(verbatim|lstlisting|minted|Verbatim|alltt)\*?\}[\s\S]*?\\end\{\1\*?\}/g;

/** `\end{env}` followed immediately by something that is not whitespace. */
const GLUED_END = /(\\end\{[^}]+\})(?=\S)/g;

/**
 * Put a blank line after an `\end{…}` that something follows immediately.
 *
 * Verbatim regions are set aside first: inside one, a newline is content, and
 * adding it would change the page rather than the file.
 */
export function separateEnvironments(tex) {
  const text = String(tex ?? "");
  const kept = [];
  // Replace each verbatim region by a placeholder that cannot occur in LaTeX,
  // tidy what is left, then put them back.
  const masked = text.replace(VERBATIM, (match) => {
    kept.push(match);
    return `\u0000VERBATIM${kept.length - 1}\u0000`;
  });
  const tidied = masked.replace(GLUED_END, "$1\n\n");
  return tidied.replace(/\u0000VERBATIM(\d+)\u0000/g, (_, i) => kept[Number(i)]);
}
