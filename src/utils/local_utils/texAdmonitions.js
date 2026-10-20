import { DEFAULT_CONFIG } from "../../config-defaults.js";
import { VERBATIM } from "./texTidy.js";

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
  // Blank out verbatim regions before looking: a `\begin{framed}` displayed in
  // a code block is text, not an environment. Blanked character by character
  // rather than removed, so every offset below still points into the real
  // file -- the rewriting works on those offsets.
  const text = String(tex ?? "").replace(VERBATIM, (match) => match.replace(/[^\n]/g, " "));
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
    // How far the title can be checked depends on what the source can predict.
    // An exercise reaches the .tex numbered by mystmd and a solution carries a
    // resolved reference, so demanding equality there would refuse every
    // document that has one. Requiring the author's title to appear keeps most
    // of the safety; "none" counts the box and checks nothing.
    const match = item.titleMatch ?? "exact";
    const expected = normaliseTitle(item.title);
    const found = normaliseTitle(block.title);
    const agree =
      match === "none" ||
      (match === "contains" ? Boolean(expected) && Boolean(found) && found.includes(expected) : expected === found);
    if (!agree) {
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

// --- Rewriting ---------------------------------------------------------------

/**
 * Colours per kind.
 *
 * The defaults live in `config-defaults.js`, next to everything else the user
 * can change, so that they reach `config.json` when it is created and document
 * themselves there. Callers pass whatever the user has set; nothing here reads
 * the live configuration, which keeps this module usable from a plain node
 * script as well as from the editor.
 */
export const DEFAULT_ADMONITION_COLORS = DEFAULT_CONFIG.export.admonitionColors;

/** A hex colour, so that a typo in config.json cannot produce invalid LaTeX. */
const HEX = /^[0-9a-fA-F]{6}$/;

/**
 * The colour table to use: the user's values where they are valid, the
 * defaults elsewhere. An unusable value is reported rather than silently
 * replaced -- a colour that does not show up is a thing one looks for.
 */
export function resolveColors(overrides) {
  const colors = { ...DEFAULT_ADMONITION_COLORS };
  const rejected = [];
  for (const [kind, value] of Object.entries(overrides ?? {})) {
    const hex = String(value ?? "").replace(/^#/, "");
    if (HEX.test(hex)) colors[kind] = hex.toUpperCase();
    else rejected.push(`${kind}: ${JSON.stringify(value)}`);
  }
  return { colors, rejected };
}

/** Environment name for a kind; one per kind, so each carries its own counter. */
const envOf = (kind) => (kind && kind !== "plain" && DEFAULT_ADMONITION_COLORS[kind] ? `mystadm${kind}` : "mystadmplain");

/**
 * The word mystmd puts before a reference, and therefore the word the box has
 * to carry for the reader to find it. It writes `Warning~\ref{…}` at the
 * reference site, in English, whatever the document's language.
 */
const KIND_WORD = {
  attention: "Attention",
  caution: "Caution",
  danger: "Danger",
  error: "Error",
  hint: "Hint",
  important: "Important",
  note: "Note",
  seealso: "See Also",
  tip: "Tip",
  warning: "Warning",
};

/**
 * Labels the `.tex` actually references with `\ref`.
 *
 * This is the only reliable sign that mystmd treated an admonition as
 * numbered: it writes `Warning~\ref{label}` for an enumerated one and the
 * title as plain text for the others. Reading it from the `.tex` is exact,
 * where guessing from `:enumerated:` in the source would mean reproducing a
 * resolution -- directive option, frontmatter, defaults -- that belongs to
 * mystmd.
 */
export function referencedLabels(tex) {
  const found = new Set();
  const re = /\\ref\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(String(tex ?? "")))) found.add(m[1]);
  return found;
}

const BEGIN_FRAMED_LEN = BEGIN_FRAMED.length;
const END_FRAMED_LEN = END_FRAMED.length;

/**
 * The preamble block defining the environments actually used.
 *
 * `auto counter` is not decoration: an injected `\label{}` inside a box that
 * steps no counter does not fail, it silently refers to the last counter that
 * moved -- the section -- and the reference comes out with a plausible, wrong
 * number. A wrong number is worse than a `??`, which at least is seen.
 */
export function admonitionPreamble(kinds, { plain = false, colors = DEFAULT_ADMONITION_COLORS } = {}) {
  const used = [...new Set(kinds.filter((k) => k && k !== "plain" && k !== "titleLink" && colors[k]))].sort();
  if (!used.length && !plain) return "";

  const lines = [
    "% >>> Mystral Editor: admonitions styled by kind",
    "\\usepackage[most]{tcolorbox}",
    // A title can hold a live reference -- a solution names its exercise --
    // and hyperref's default red is unreadable on a coloured bar. Set locally,
    // inside the title group, so nothing else in the document changes. The
    // \ifcsname guard is what makes the preamble independent of hyperref
    // being loaded at all.
    `\\definecolor{mystcoltitlelink}{HTML}{${colors.titleLink ?? DEFAULT_ADMONITION_COLORS.titleLink}}`,
    "\\newcommand{\\mystadmtitlelinks}{\\ifcsname hypersetup\\endcsname\\hypersetup{linkcolor=mystcoltitlelink}\\fi}",
  ];
  for (const kind of used) {
    const colour = colors[kind];
    // The colour is named apart from the environment. LaTeX keeps the two in
    // different namespaces, so sharing a name works -- and reads as a mistake
    // to the next person, which is its own cost.
    const col = `mystcol${kind}`;
    lines.push(
      `\\definecolor{${col}}{HTML}{${colour}}`,
      // Two arguments: an optional list of tcolorbox keys first, the title
      // second. The optional one is how a `label` reaches the box -- see
      // the note on `label=` in rewriteAdmonitions.
      `\\newtcolorbox[auto counter]{${envOf(kind)}}[2][]{breakable, enhanced, ` +
        `colback=${col}!6!white, colframe=${col}, coltitle=white, ` +
        `fonttitle=\\bfseries, title={\\mystadmtitlelinks #2}, #1}`,
    );
  }
  if (plain) {
    lines.push(
      `\\definecolor{mystcolplain}{HTML}{${colors.plain ?? DEFAULT_ADMONITION_COLORS.plain}}`,
      "\\newtcolorbox[auto counter]{mystadmplain}[1][]{breakable, enhanced, " +
        "colback=mystcolplain!6!white, colframe=mystcolplain, #1}",
    );
  }
  lines.push("% <<< Mystral Editor");
  return `${lines.join("\n")}\n`;
}

/**
 * Rewrite the `framed` environments of a `.tex` into styled, labelled boxes.
 *
 * The edits are collected first and applied from the end: a nested admonition
 * lies inside the body of the one containing it, never inside its opening or
 * closing lines, so the regions edited never overlap and the indices of the
 * untouched ones stay valid.
 *
 * The title is taken from the `.tex`, not from the source: mystmd has already
 * escaped it -- `100 \% \&`, ``...'' for quotes, `\texttt{}` for code -- and
 * re-escaping the source title ourselves would be a second implementation of
 * someone else's rules, which is how the two drift apart.
 *
 * @param {string} tex
 * @param {Array<{item: object, block: FramedBlock}>} pairs  from pairAdmonitions
 * @param {{colors?: Record<string,string>}} [opts]  user colours, from config.export.admonitionColors
 * @returns {{ text: string, rewritten: number, labelled: number, numbered: number, rejected: string[] }}
 */
export function rewriteAdmonitions(tex, pairs, { colors: overrides } = {}) {
  const { colors, rejected } = resolveColors(overrides);
  const text = String(tex ?? "");
  const referenced = referencedLabels(text);
  const edits = [];
  let labelled = 0;
  let numbered = 0;
  let needsPlain = false;

  for (const { item, block } of pairs) {
    if (block.end == null) continue;
    // A `framed` the author wrote themselves in a `{raw} latex` block: it
    // holds a rank, so that what follows stays aligned, and nothing else. It
    // is their LaTeX, not an admonition.
    if (item.passthrough) continue;
    const env = envOf(item.kind);
    if (env === "mystadmplain") needsPlain = true;

    // Opening: the `\begin{framed}` and, when there is one, the `\textbf{…}\\`
    // line that follows it -- the title moves into the box's own title slot.
    const openEnd = block.titleEnd ?? block.begin + BEGIN_FRAMED_LEN;
    const title = block.title ?? "";
    // tcolorbox's own `label=` key, not a bare `\label{}`. A `\label` written
    // just inside the box captures nothing -- the .aux comes back with
    // `\newlabel{x}{{}{1}…}`, an empty number -- because the box counter has
    // not been stepped at that point. The key ties the label to the counter
    // the box steps, which is what makes `\ref` print a number at all.
    const label = item.label ? `[label={${item.label}}]` : "";
    if (item.label) labelled++;
    // The newline is for whoever opens the .tex: LaTeX does not need it, and a
    // body glued to its opening line is a body nobody reads.
    // A box the document refers to has to show the number the reference
    // announces: `Warning~\ref{…}` sends the reader looking for "Warning 2",
    // and a box titled merely "Warning" leaves them hunting. `\thetcbcounter`
    // is the box's own counter, so the two cannot drift apart.
    // An exercise already carries its number, written by the plugin from
    // mystmd's own enumeration: adding ours would show two.
    const word = item.titleMatch === "exact" ? KIND_WORD[item.kind] : null;
    let shown = title;
    if (word && item.label && referenced.has(item.label)) {
      // Même forme que l'aperçu -- « Warning 2 (Mon titre) » -- pour que le
      // lecteur retrouve dans le PDF ce qu'il voyait dans l'éditeur.
      shown = title && title !== word ? `${word}~\\thetcbcounter\\ (${title})` : `${word}~\\thetcbcounter`;
      numbered++;
    }

    const opening =
      env === "mystadmplain" ? `\\begin{${env}}${label}\n` : `\\begin{${env}}${label}{${shown}}\n`;
    edits.push({ from: block.begin, to: openEnd, text: opening });

    edits.push({ from: block.end - END_FRAMED_LEN, to: block.end, text: `\\end{${env}}` });
  }

  const preamble = admonitionPreamble(
    pairs.map(({ item }) => item.kind),
    { plain: needsPlain, colors },
  );
  // A multi-file export has no preamble in the body: mystmd writes one main
  // file holding the preamble and `\\include`s one part per article. The
  // preamble is therefore returned as well, for the caller to put into the
  // file that does have a `\\begin{document}`.
  const docAt = text.indexOf("\\begin{document}");
  if (preamble && docAt !== -1) edits.push({ from: docAt, to: docAt, text: preamble });

  edits.sort((a, b) => b.from - a.from);
  let out = text;
  for (const e of edits) out = out.slice(0, e.from) + e.text + out.slice(e.to);

  const rewritten = pairs.filter(({ item }) => !item.passthrough).length;
  return { text: out, rewritten, labelled, numbered, rejected, preamble, preambleWritten: Boolean(preamble) && docAt !== -1 };
}
