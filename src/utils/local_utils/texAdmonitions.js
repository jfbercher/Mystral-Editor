/**
 * The `.tex` side of the admonition correspondence: find the `framed`
 * environments mystmd wrote, and pair them with what `scanAdmonitions.js` read
 * from the source.
 *
 * `framed` appears nowhere else in `myst-to-tex` -- it is the exclusive
 * signature of an admonition -- so the Nth environment is the Nth admonition in
 * reading order. The ordinal is the correspondence; the title is the proof.
 */

/**
 * Read a braced group starting at `open` (the index of the `{`).
 *
 * Counting braces rather than matching to the first `}`: a title reaches the
 * `.tex` with its own markup in it -- `\textbf{Variable \texttt{x\_1}}` -- and
 * a non-greedy regex stops in the middle of it. An escaped brace `\{` does not
 * count, which is how a title containing a literal brace survives.
 *
 * @returns {{ inner: string, end: number }|null} `end` is the index after `}`
 */
function readGroup(text, open) {
  if (text[open] !== "{") return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return { inner: text.slice(open + 1, i), end: i + 1 };
    }
  }
  return null;
}

const BEGIN_FRAMED = "\\begin{framed}";
const END_FRAMED = "\\end{framed}";
/** The title line myst-to-tex writes: `\textbf{…}\\` on its own line. */
const TITLE_AFTER = /^\s*\\textbf\{/;

/**
 * @typedef {object} FramedBlock
 * @property {number} begin  index of `\begin{framed}`
 * @property {number} end    index just after the matching `\end{framed}`
 * @property {string|null} title  the title as written in the .tex, markup included
 * @property {number|null} titleStart  index of `\textbf`, null when there is none
 * @property {number|null} titleEnd    index just after the `\\` that follows it
 */

/**
 * Every `framed` environment, in reading order, nesting included.
 *
 * A nested admonition is listed after the one containing it, which is the
 * order `myst-to-tex` writes them and the order the source scan reports them.
 *
 * @param {string} tex
 * @returns {FramedBlock[]}
 */
export function framedBlocks(tex) {
  const text = String(tex ?? "");
  const blocks = [];

  for (let i = text.indexOf(BEGIN_FRAMED); i !== -1; i = text.indexOf(BEGIN_FRAMED, i + 1)) {
    const after = i + BEGIN_FRAMED.length;

    // Matching end, counting the nested environments on the way.
    let depth = 1;
    let cursor = after;
    let end = null;
    while (depth > 0) {
      const nextBegin = text.indexOf(BEGIN_FRAMED, cursor);
      const nextEnd = text.indexOf(END_FRAMED, cursor);
      if (nextEnd === -1) break;
      if (nextBegin !== -1 && nextBegin < nextEnd) {
        depth++;
        cursor = nextBegin + BEGIN_FRAMED.length;
      } else {
        depth--;
        cursor = nextEnd + END_FRAMED.length;
        if (depth === 0) end = cursor;
      }
    }

    // The title, when there is one: the first thing after the opening line.
    const rest = text.slice(after);
    let title = null;
    let titleStart = null;
    let titleEnd = null;
    const head = TITLE_AFTER.exec(rest);
    if (head) {
      const braceAt = after + head[0].length - 1;
      const group = readGroup(text, braceAt);
      if (group) {
        title = group.inner;
        titleStart = after + head[0].indexOf("\\textbf");
        // myst-to-tex writes `\\` then a newline after the title.
        const trailing = /^\s*\\\\\s*/.exec(text.slice(group.end));
        titleEnd = group.end + (trailing ? trailing[0].length : 0);
      }
    }

    blocks.push({ begin: i, end, title, titleStart, titleEnd });
  }

  return blocks;
}

/**
 * Reduce a title to what can be compared across the two sides.
 *
 * The same title is not written the same way in the source and in the `.tex`:
 * mystmd escapes the specials (`\%`, `\&`, `\_`), turns quotes into ``…'' and
 * a dash into ---, and wraps inline code in `\texttt{}`. Comparing the raw
 * strings would report a divergence on most real titles. What survives both
 * transformations is the letters and digits, so that is what is compared --
 * enough to catch a mis-pairing, which is a gross error, and blind to
 * typography, which is not an error at all.
 */
export function normaliseTitle(value) {
  if (value == null) return null;
  return (
    String(value)
      // `\texttt{x}` -> `{x}`: the command goes, its content stays.
      .replace(/\\[a-zA-Z]+\s*/g, " ")
      // Escaped specials come back to themselves before being dropped below.
      .replace(/\\([%&_#$<>{}])/g, "$1")
      .replace(/[{}$`'"*]/g, " ")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "")
  );
}

/**
 * Pair the source admonitions with the `framed` environments.
 *
 * Refuses rather than guesses: a count that does not match, or a title that
 * does not, means the two sides describe different documents and the `.tex`
 * must be left alone. Rewriting in the wrong places is worse than not
 * rewriting at all.
 *
 * @param {import("./scanAdmonitions.js").ScannedAdmonition[]} items
 * @param {FramedBlock[]} blocks
 * @returns {{ ok: boolean, reason: string|null, pairs: Array<{item: object, block: FramedBlock}> }}
 */
export function pairAdmonitions(items, blocks) {
  if (items.length !== blocks.length) {
    return {
      ok: false,
      reason: `the source has ${items.length} admonition(s) and the .tex has ${blocks.length} framed environment(s)`,
      pairs: [],
    };
  }

  const pairs = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const block = blocks[i];
    const expected = normaliseTitle(item.title);
    const found = normaliseTitle(block.title);
    if (expected !== found) {
      return {
        ok: false,
        reason:
          `admonition ${i + 1} (line ${item.line}): the source says ${JSON.stringify(item.title)} ` +
          `and the .tex says ${JSON.stringify(block.title)}`,
        pairs: [],
      };
    }
    if (block.end == null) {
      return { ok: false, reason: `admonition ${i + 1} (line ${item.line}): no matching \\end{framed}`, pairs: [] };
    }
    pairs.push({ item, block });
  }

  return { ok: true, reason: null, pairs };
}
