/**
 * Shortening a caption, for the list of figures and for the list of tables.
 *
 * Shared on purpose, and this is the whole point of the module: the editor's
 * `{list-of-figures}` and the `\listoffigures` of a LaTeX export must shorten
 * a caption the same way, or the author proof-reads one list and prints
 * another. The rule itself lives here; what to do with the result is the
 * caller's business -- the preview writes it in a list item, the export in
 * the optional argument of `\caption`.
 *
 * Nothing here touches the DOM, LaTeX or Tauri, which is what lets both the
 * markdown side and the export side import it.
 *
 * A caption declared by its author with `% shortcaption: …` never comes
 * through here: what someone wrote by hand is not improved by a rule.
 */

/** The end of a sentence, when something follows it. */
const SENTENCE_END = /[.!?]/;

/**
 * Where a caption may be cut without breaking LaTeX.
 *
 * The short caption is a separate argument, read on its own, so a cut has to
 * leave something that stands by itself: balanced braces, no half-opened
 * `$…$`, no `\textit` without its argument. Hence a single pass that tracks
 * brace depth and math, and records only the positions that are outside both.
 *
 * A backslash swallows the character after it, which is enough to keep
 * `\{`, `\$` and `\%` from being read as structure. The letters of a command
 * name are then ordinary characters, which costs nothing here: what matters
 * is that its braces are counted, and they are.
 */
function cutPoints(text) {
  const sentences = [];
  const words = [];
  let depth = 0;
  let math = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      i += 1;
      continue;
    }
    if (c === "$") {
      math = !math;
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") depth -= 1;
    if (depth !== 0 || math) continue;
    if (c === " ") words.push(i);
    else if (SENTENCE_END.test(c) && (i + 1 >= text.length || /\s/.test(text[i + 1]))) sentences.push(i + 1);
  }
  return { sentences, words };
}

/** Trailing punctuation an ellipsis should not be glued to. */
const trimEnd = (s) => s.replace(/[\s,;:.–—-]+$/, "");

/**
 * What `export.shortCaptions` -- or the frontmatter key of the same name --
 * actually asks for: `"sentence"`, a budget in characters, or nothing.
 *
 * Returns null for anything it does not recognise, so the caller can say so
 * rather than let a misspelt setting look like a feature that does not work.
 * A budget under ten characters is refused too: it could only ever produce an
 * ellipsis.
 */
export function readRule(value) {
  if (value == null || value === false || value === "") return null;
  if (typeof value === "string") {
    const word = value.trim().toLowerCase();
    if (word === "sentence") return "sentence";
    const n = Number(word);
    return Number.isFinite(n) && n >= 10 ? n : null;
  }
  if (typeof value === "number") return Number.isFinite(value) && value >= 10 ? value : null;
  return null;
}

/**
 * A short caption for the list of figures, or none.
 *
 * Returning nothing is a normal outcome and the safe one: a caption that is
 * already short needs no short form, and one that offers no safe place to cut
 * is better printed in full than printed broken.
 *
 *   - `"sentence"` keeps the first sentence. Academic captions are very often
 *     written "What it is. Then the details", and the first sentence is
 *     exactly the line one wants in the list.
 *   - a number is a budget in characters: the first sentence if it fits,
 *     otherwise the last whole word before the budget, followed by an
 *     ellipsis.
 */
export function shortCaptionOf(long, rule) {
  const text = String(long ?? "").trim();
  if (!readRule(rule) || !text) return null;
  rule = readRule(rule);
  const { sentences, words } = cutPoints(text);

  const firstSentence = sentences.find((p) => p < text.length);

  if (rule === "sentence") {
    if (firstSentence == null) return null;
    const cut = trimEnd(text.slice(0, firstSentence));
    return cut && cut.length < text.length ? cut : null;
  }

  const budget = Number(rule);
  if (!Number.isFinite(budget) || budget < 10) return null;
  if (text.length <= budget) return null;

  // A sentence that fits is better than a truncation: it ends where the
  // author ended it, and needs no ellipsis to say so.
  if (firstSentence != null && firstSentence <= budget) {
    const cut = trimEnd(text.slice(0, firstSentence));
    if (cut) return cut;
  }

  const at = [...words].reverse().find((p) => p <= budget);
  if (at == null) return null;
  const cut = trimEnd(text.slice(0, at));
  return cut ? `${cut}…` : null;
}

