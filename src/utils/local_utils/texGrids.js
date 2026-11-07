/**
 * The LaTeX side of a `{grid}`: the row of boxes, and the floats inside it.
 *
 * `cards-grids.mjs` leaves markers rather than LaTeX -- `\mystgridbegin`,
 * `\mystgridcell{0.3333}`, `\mystgridendcell`, `\mystgridrowbreak`,
 * `\mystgridend` -- so that what a grid looks like is decided here, in one
 * place, rather than in a plugin that would have to be regenerated to change
 * a margin.
 *
 * The part that is not cosmetic is the floats. A `figure` inside a minipage
 * is not a degraded layout, it is a failed build: `! LaTeX Error: Not in
 * outer par mode.` (`multicols`, measured beside it, accepts the figure and
 * silently drops it from the PDF, which is worse.) Inside a grid, a figure
 * therefore stops floating: the environment becomes a centred block and the
 * caption becomes a `\captionof`, which keeps the numbering, the entry in
 * the list of figures and any `\label` on it. Verified by compiling: the
 * figures of a two-column row come out as Figure 1 and Figure 2, in order.
 */

/**
 * What the markers mean. Written as macros so that the body of the `.tex`
 * stays readable, and so that a project can redefine one of them.
 *
 * `\ignorespaces` after a row opens: mystmd writes a blank line after a raw
 * node, and a space before a minipage shows as an indent nobody asked for.
 */
export const GRID_PREAMBLE = [
  "% >>> Mystral Editor: grids",
  "\\usepackage{capt-of}",
  "\\newcommand{\\mystgridbegin}{\\par\\medskip\\noindent\\ignorespaces}",
  // The gap between two cells is taken out of each cell rather than added
  // between them, so a full row still fits the line; `\hfill` between the
  // boxes spreads whatever is left.
  "\\newcommand{\\mystgridcell}[1]{\\begin{minipage}[t]{\\dimexpr #1\\linewidth-0.8em\\relax}}",
  "\\newcommand{\\mystgridendcell}{\\end{minipage}}",
  "\\newcommand{\\mystgridrowbreak}{\\par\\medskip\\noindent\\ignorespaces}",
  "\\newcommand{\\mystgridend}{\\par\\medskip}",
  "",
  "",
].join("\n");

/**
 * One grid, from its opening marker to its closing one.
 *
 * `(?![A-Za-z])` is not decoration: `\mystgridend` is a prefix of
 * `\mystgridendcell`, so without it the non-greedy match stopped at the end
 * of the *first cell*. Everything after that -- the other cells, their
 * floats, their blank lines -- was left untouched, which is exactly the shape
 * of the bug this was written to fix.
 */
const GRID_REGION = /\\mystgridbegin%?[\s\S]*?\\mystgridend(?![A-Za-z])%?/g;

/**
 * A float environment, with its optional placement, inside one region.
 *
 * Only `figure` and `table` are touched: they are the two the writer floats.
 * Anything else inside a cell -- a listing, an equation, an admonition -- is
 * already content that stays where it is written.
 */
const FLOAT_OPEN = /\\begin\{(figure|table)\}(\*?)(\[[^\]]*\])?/g;
const FLOAT_CLOSE = /\\end\{(figure|table)\}(\*?)/g;

/** `\caption{` → `\captionof{figure}{`, the command only, never its argument. */
const captionFor = (kind) => new RegExp(`\\\\caption(?=\\{|\\[)`, "g");

/**
 * Turn the floats of one grid region into blocks that stay put.
 *
 * The kinds are read in order of appearance, so a region holding a figure and
 * a table gives each its own `\captionof`. A caption outside any float -- a
 * `\captionof` already written by an earlier pass, say -- is left alone,
 * since the pattern only ever fires between a `\begin` and its `\end`.
 */
function defloat(region) {
  let out = "";
  let rest = region;
  for (;;) {
    FLOAT_OPEN.lastIndex = 0;
    const open = FLOAT_OPEN.exec(rest);
    if (!open) return out + rest;

    const kind = open[1];
    FLOAT_CLOSE.lastIndex = open.index;
    const close = FLOAT_CLOSE.exec(rest);
    // An unbalanced environment is left exactly as it is: this pass is a
    // convenience, not a parser, and a malformed `.tex` is better reported by
    // LaTeX than silently patched here.
    if (!close) return out + rest;

    const inner = rest.slice(open.index + open[0].length, close.index);
    out +=
      rest.slice(0, open.index) +
      "\\begin{center}" +
      inner.replace(captionFor(kind), `\\captionof{${kind}}`) +
      "\\end{center}";
    rest = rest.slice(close.index + close[0].length);
  }
}

/** A line that is one of our markers, whatever follows it on that line. */
const MARKER_LINE = /^[ \t]*\\mystgrid(?:begin|cell|endcell|rowbreak|end)\b/;

/**
 * Remove the blank lines that touch a marker.
 *
 * mystmd writes a paragraph break after every raw node, so the `.tex` reads
 * `\mystgridendcell\hfill%` then an empty line then `\mystgridcell{…}`. The
 * trailing `%` eats its own newline, but the empty line that follows is still
 * an empty line -- which is a `\par` -- and a `\par` between two boxes ends
 * the line: the cells came out stacked instead of side by side, each one
 * below the last.
 *
 * Only the blank lines *adjacent to a marker* go. Those inside a cell
 * separate its paragraphs and are its author's.
 */
function tighten(region) {
  const lines = region.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "") {
      const prev = out.length ? out[out.length - 1] : "";
      let j = i;
      while (j < lines.length && lines[j].trim() === "") j += 1;
      const next = j < lines.length ? lines[j] : "";
      if (MARKER_LINE.test(prev) || MARKER_LINE.test(next)) {
        i = j - 1;
        continue;
      }
    }
    out.push(lines[i]);
  }
  return out.join("\n");
}

/**
 * Rewrite every grid region, and add the preamble if there was one.
 *
 * Same contract as `rewriteFloats`: the preamble is returned as well as
 * inserted, because a multi-file export keeps its preamble in another file
 * and the caller has to put it there itself.
 */
export function rewriteGrids(text) {
  let grids = 0;
  let out = String(text ?? "").replace(GRID_REGION, (region) => {
    grids += 1;
    return tighten(defloat(region));
  });

  let preamble = "";
  let preambleWritten = false;
  if (grids) {
    preamble = GRID_PREAMBLE;
    const docAt = out.indexOf("\\begin{document}");
    if (docAt !== -1) {
      out = out.slice(0, docAt) + preamble + out.slice(docAt);
      preambleWritten = true;
    }
  }

  return { text: out, grids, preamble, preambleWritten };
}
