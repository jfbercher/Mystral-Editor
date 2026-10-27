/**
 * Abbreviations declared once, recognised everywhere.
 *
 *     ---
 *     abbreviations:
 *       MyST: Markedly Structured Text
 *       FFT: Fast Fourier Transform
 *     ---
 *
 * After which every MyST and every FFT in the text carries its definition,
 * without the author writing anything at the point of use.
 *
 * It is worth being clear about what this is *not*, because the shape is
 * misleading. The `{abbr}` role already exists, from markdown-it-docutils,
 * and it takes its definition with it: `` {abbr}`FFT (Fast Fourier
 * Transform)` ``. One might expect the frontmatter to be a table that role
 * consults -- it is not. The frontmatter asks for something the role cannot
 * do: that *occurrences in ordinary prose* become abbreviations. So this is a
 * pass over the rendered text, not an entry in a lookup the role reads.
 *
 * The project's own frontmatter is inherited, since the map comes from the
 * effective frontmatter: a term defined once for a project is recognised in
 * every document of it.
 */

/** The abbreviations a document declares, as a map of term to definition. */
export function readAbbreviations(frontmatter) {
  const raw = frontmatter?.abbreviations ?? frontmatter?.abbreviation;
  const out = new Map();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;

  for (const [term, value] of Object.entries(raw)) {
    const key = String(term ?? "").trim();
    // A plain string is the documented form; an object with a title is what
    // mystmd accepts when an abbreviation carries more than a definition, and
    // reading it costs one line rather than an error nobody can act on.
    const definition =
      typeof value === "string"
        ? value.trim()
        : value && typeof value === "object"
          ? String(value.title ?? value.definition ?? "").trim()
          : "";
    if (key && definition) out.set(key, definition);
  }
  return out;
}

/** A short signature, for the chunk cache: every chunk depends on this map. */
export function abbreviationsSignature(abbreviations) {
  if (!abbreviations?.size) return "";
  return [...abbreviations.entries()].map(([k, v]) => `${k}=${v}`).join("|");
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Characters that make a term part of a longer word rather than a word. */
const WORDISH = "A-Za-z0-9_\\-";

const cache = new WeakMap();

/**
 * One expression matching any declared term standing on its own.
 *
 * Longest first, so `FFTW` is not matched as `FFT` followed by a stray W, and
 * bounded by a captured character rather than a lookbehind: lookbehind is
 * recent in WebKit, which is what the desktop build runs inside, and a
 * silently inert regular expression is a poor thing to ship.
 */
function termPattern(abbreviations) {
  if (cache.has(abbreviations)) return cache.get(abbreviations);
  const alts = [...abbreviations.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join("|");
  const re = alts ? new RegExp(`(^|[^${WORDISH}])(${alts})(?![${WORDISH}])`, "g") : null;
  cache.set(abbreviations, re);
  return re;
}

/** Replace a text token by the run of tokens its matches produce. */
function expandToken(token, re, abbreviations, Token) {
  re.lastIndex = 0;
  const text = token.content;
  const out = [];
  let last = 0;
  let m;

  while ((m = re.exec(text))) {
    const start = m.index + m[1].length;
    const term = m[2];
    if (start > last) {
      const before = new Token("text", "", 0);
      before.content = text.slice(last, start);
      out.push(before);
    }
    const abbr = new Token("html_inline", "", 0);
    abbr.content = `<abbr title="${escapeHtml(abbreviations.get(term))}">${escapeHtml(term)}</abbr>`;
    out.push(abbr);
    last = start + term.length;
    // The bounding character was consumed by the match; without this a term
    // immediately followed by another -- "FFT FFT" -- would lose the second.
    re.lastIndex = last;
  }

  if (!out.length) return null;
  if (last < text.length) {
    const rest = new Token("text", "", 0);
    rest.content = text.slice(last);
    out.push(rest);
  }
  return out;
}

export function markdownAbbreviations(md) {
  md.core.ruler.push("myst_abbreviations", (state) => {
    const abbreviations = state.env?.abbreviations;
    if (!abbreviations?.size) return;
    const re = termPattern(abbreviations);
    if (!re) return;

    for (const block of state.tokens) {
      if (block.type !== "inline" || !block.children?.length) continue;

      let changed = false;
      const children = [];
      for (const child of block.children) {
        // Only prose. `code_inline`, the role's own output and raw html are
        // other token types, so they are passed through untouched -- which is
        // what keeps an abbreviation out of a code sample, and keeps this
        // pass from wrapping what the `{abbr}` role has already wrapped.
        if (child.type !== "text") {
          children.push(child);
          continue;
        }
        const expanded = expandToken(child, re, abbreviations, state.Token);
        if (expanded) {
          children.push(...expanded);
          changed = true;
        } else {
          children.push(child);
        }
      }
      if (changed) block.children = children;
    }
  });
}

export default markdownAbbreviations;
