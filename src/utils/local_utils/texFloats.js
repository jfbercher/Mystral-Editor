/**
 * Make a floated figure or table float in LaTeX.
 *
 * `:class: float-left` / `float-right` asks for the text to run beside the
 * figure rather than below it. LaTeX does that with `wrapfigure` and
 * `wraptable`, and `myst-to-tex` emits neither: it writes `\begin{figure}`
 * for every figure, so the environment has to be changed afterwards.
 *
 * Which figure is not guessed. `float-lists.mjs` leaves a marker inside each
 * one it has to wrap -- `%MYSTRALFLOAT:r:0.45` -- so this pass never counts
 * or pairs anything: it finds the marker and rewrites the environment around
 * it. Being a LaTeX comment, the marker is harmless in a file that is never
 * post-processed.
 *
 * `float-center` leaves no marker: a centred block is what `figure` already
 * is in LaTeX, and there is no centred `wrapfigure`.
 */

import { VERBATIM } from "./texTidy.js";

/** `%MYSTRALFLOAT:<side>:<width fraction, possibly empty>` on its own line. */
const MARKER = /^[ \t]*%MYSTRALFLOAT:([lr]):([0-9.]*)[ \t]*\r?\n/gm;

/**
 * The same pattern, as a fresh object.
 *
 * `MARKER` is walked with `exec`, which keeps its place in `lastIndex`, and
 * `String.replace` with a global pattern resets that place to zero when it is
 * done. Sharing the one object between the loop and the stripping below sent
 * the loop back to the first marker for ever.
 */
const stripMarkers = (s) => String(s).replace(new RegExp(MARKER.source, "gm"), "");

/**
 * Half the text width, give or take -- the width a figure takes when the
 * author gave none. Wide enough to be worth wrapping around, narrow enough to
 * leave a readable column beside it.
 */
const DEFAULT_WIDTH = "0.45";

const ENVIRONMENTS = { figure: "mystwrapfigure", table: "mystwraptable" };

/** Where the wrap has to stop, whatever LaTeX would do left alone. */
const SECTIONING = /\\(?:part|chapter|section|subsection|subsubsection|paragraph)\*?\s*[{[]/g;

/** `\begin{figure}[!htbp]` or `\begin{table}`, with its optional placement. */
const BEGIN = /\\begin\{(figure|table)\}(\[[^\]]*\])?/g;

/**
 * Inside a wrap environment `\linewidth` is the wrapped column, not the page.
 *
 * mystmd sizes the image as a fraction of `\linewidth` from `:figwidth:` --
 * the same fraction we are about to give the wrap box -- so leaving it would
 * apply the fraction twice and produce a figure at a fifth of the page. The
 * image fills its box instead, which is what the preview does with the same
 * class.
 */
const IMAGE_WIDTH = /\\includegraphics\[width=[0-9.]+\\linewidth\]/g;

/**
 * What the LaTeX run needs for any of this to compile.
 *
 * Two packages, and the document uses whichever it has. `wrapstuff` is the
 * better one and the reason is a visible defect, not a preference: with
 * `wrapfig`, when the text beside a figure runs out before the figure does,
 * everything that follows -- including the next section title -- stays
 * indented by the width of the figure. `wrapstuff` gives `\wrapstuffclear`,
 * which ends the wrap where we ask, and the pass puts one before the next
 * sectioning command of every float it wraps.
 *
 * `wrapstuff` is recent, though, and a TeX installation of a few years ago
 * does not have it. So the environments are named here and defined twice,
 * and the body says `mystwrapfigure` without knowing which it will get: with
 * `wrapstuff` the clear works, without it the document still builds and
 * behaves as it did before -- which is the old defect, not a new one.
 */
export const FLOAT_PREAMBLE = [
  "% >>> Mystral Editor: floated figures and tables",
  "\\IfFileExists{wrapstuff.sty}{%",
  "  \\usepackage{wrapstuff}",
  // `##1`, not `#1`: these definitions are arguments of `\IfFileExists`, and
  // a single `#` there is read as a parameter of the macro doing the reading
  // -- "Illegal parameter number in definition of \reserved@a", and no PDF.
  "  \\newenvironment{mystwrapfigure}[2]{\\begin{wrapstuff}[##1,width=##2,type=figure]}{\\end{wrapstuff}}",
  "  \\newenvironment{mystwraptable}[2]{\\begin{wrapstuff}[##1,width=##2,type=table]}{\\end{wrapstuff}}",
  "  \\newcommand{\\mystwrapclear}{\\par\\wrapstuffclear}",
  "}{%",
  "  \\usepackage{wrapfig}",
  "  \\newenvironment{mystwrapfigure}[2]{\\begin{wrapfigure}{##1}{##2}}{\\end{wrapfigure}}",
  "  \\newenvironment{mystwraptable}[2]{\\begin{wraptable}{##1}{##2}}{\\end{wraptable}}",
  "  \\newcommand{\\mystwrapclear}{\\par}",
  "}",
  "",
  "",
].join("\n");

/**
 * Rewrite every marked figure and table into its wrap environment.
 *
 * Returns the preamble as well as inserting it, for the same reason
 * `rewriteAdmonitions` does: a multi-file export keeps its preamble in
 * another file, and only the caller knows which.
 */
export function rewriteFloats(tex) {
  const text = String(tex ?? "");
  const kept = [];
  const masked = text.replace(VERBATIM, (match) => {
    kept.push(match);
    return `\u0000VERBATIM${kept.length - 1}\u0000`;
  });

  const edits = [];
  /** Offsets where a wrap has to be ended; a Set, since two floats can share one. */
  const clears = new Set();
  let floated = 0;

  MARKER.lastIndex = 0;
  let m;
  while ((m = MARKER.exec(masked))) {
    const side = m[1];
    const width = m[2] || DEFAULT_WIDTH;

    // The environment this marker sits in: the last one opened before it.
    BEGIN.lastIndex = 0;
    let open = null;
    let b;
    while ((b = BEGIN.exec(masked)) && b.index < m.index) open = b;
    if (!open) continue;

    const env = open[1];
    const wrap = ENVIRONMENTS[env];
    const close = `\\end{${env}}`;
    const closeAt = masked.indexOf(close, m.index);
    if (closeAt === -1) continue;

    // Another `\begin` of the same kind between the two would mean the marker
    // belongs to a figure that is not this one: refuse rather than rewrite
    // the wrong block.
    if (masked.slice(m.index, closeAt).includes(`\\begin{${env}}`)) continue;

    const openEnd = open.index + open[0].length;
    const body = stripMarkers(masked.slice(openEnd, closeAt))
      .replace(IMAGE_WIDTH, "\\includegraphics[width=\\linewidth]");

    // One edit for the whole figure rather than four around it: the pieces
    // overlap -- the marker lies inside the body -- and offsets computed on
    // the original text stop meaning anything as soon as one of them has
    // changed a length. Whole blocks cannot overlap each other, so applying
    // them from the end of the file is enough.
    edits.push({
      from: open.index,
      to: closeAt + close.length,
      text: `\\begin{${wrap}}{${side}}{${width}\\textwidth}${body}\\end{${wrap}}`,
    });
    floated += 1;

    // End the wrap before the next section. Left to itself, a figure taller
    // than the text beside it indents everything that follows by its width,
    // the next section title included -- which is what the clear is for.
    SECTIONING.lastIndex = closeAt + close.length;
    const next = SECTIONING.exec(masked);
    if (next) clears.add(next.index);
  }

  for (const at of clears) edits.push({ from: at, to: at, text: "\\mystwrapclear\n" });

  edits.sort((a, b) => b.from - a.from);
  let out = masked;
  for (const e of edits) out = out.slice(0, e.from) + e.text + out.slice(e.to);
  // A marker left by a figure this pass refused to rewrite would be harmless
  // -- it is a comment -- but the .tex is a file someone reads.
  out = stripMarkers(out);

  let preamble = "";
  let preambleWritten = false;
  if (floated) {
    preamble = FLOAT_PREAMBLE;
    const docAt = out.indexOf("\\begin{document}");
    if (docAt !== -1) {
      out = out.slice(0, docAt) + preamble + out.slice(docAt);
      preambleWritten = true;
    }
  }

  return { text: out.replace(/\u0000VERBATIM(\d+)\u0000/g, (_, i) => kept[Number(i)]), floated, preamble, preambleWritten };
}
