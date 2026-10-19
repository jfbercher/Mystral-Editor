/**
 * List, in reading order, every construct that `myst-to-tex` renders as a
 * `framed` environment -- that is, every admonition.
 *
 * Why a source scan rather than the AST: we do not have mystmd's AST. What we
 * have is the document and the `.tex` it produced. `framed` appears nowhere
 * else in `myst-to-tex`, so the Nth `\begin{framed}` is the Nth admonition of
 * the source, and that ordinal is the only bridge between the two. This module
 * builds the left-hand side of that correspondence; `texAdmonitions.js` walks
 * the `.tex` and pairs them.
 *
 * The pairing is checked rather than trusted: every admonition of a known kind
 * carries a title into the `.tex`, written `\textbf{Title}\\` immediately after
 * `\begin{framed}`. Comparing the two is what turns a silent mis-pairing into
 * a refusal to act, which is the behaviour this whole feature needs -- a
 * document rewritten in the wrong places is worse than one left alone.
 *
 * Reproducing mystmd's own rules is therefore the whole difficulty, and the
 * three that matter are implemented below, each with the upstream code it
 * mirrors named in a comment. Whatever cannot be predicted is reported in
 * `warnings` rather than guessed at.
 */

/** The admonition kinds mystmd knows, each a directive name of its own. */
export const ADMONITION_KINDS = [
  "attention",
  "caution",
  "danger",
  "error",
  "hint",
  "important",
  "note",
  "seealso",
  "tip",
  "warning",
];

/**
 * Default title given to a kind that carries none.
 *
 * Mirrors `admonitionKindToTitle` in myst-common: a titleless `{note}` reaches
 * the `.tex` as `\textbf{Note}\\`, not as an untitled box.
 */
const KIND_TITLES = {
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

export const admonitionKindToTitle = (kind) => KIND_TITLES[kind] ?? null;

/**
 * Directives the exercise plugin turns into admonitions.
 *
 * They are counted only when that plugin is in use: without it mystmd drops
 * them and they occupy no rank in the `.tex`. The caller says which it is --
 * or tries both, since the pairing itself can tell.
 */
export const EXERCISE_NAMES = ["exercise", "solution"];

/** The kinds GitHub-style blockquote callouts can produce. */
const GITHUB_KINDS = ["note", "tip", "important", "warning", "caution"];

const FENCE_OPEN = /^(\s*)([`:~]{3,})\s*(.*)$/;
const DIRECTIVE_INFO = /^\{([\w:+-]+)\}\s*(.*)$/;
const OPTION_LINE = /^\s*:([\w-]+):\s*(.*)$/;
/** A paragraph that is nothing but bold text, which mystmd promotes to a title. */
const BOLD_ONLY = /^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*$/;
const HEADING_LINE = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
/** `> **Note**` and `> [!NOTE]`, the two GitHub callout spellings. */
const QUOTE_BOLD = /^\s{0,3}>\s*(?:\*\*|__)([A-Za-z]+)(?:\*\*|__)/;
const QUOTE_BRACKET = /^\s{0,3}>\s*\[!([A-Za-z]+)\]/;

/**
 * @typedef {object} ScannedAdmonition
 * @property {string} name   directive name as written (`note`, `admonition`, …)
 * @property {string|null} kind   the admonition kind, null for a generic one
 * @property {string|null} title  the title that will appear in the .tex
 * @property {string|null} label  `:label:` or `:name:`, as the author typed it
 * @property {number} line   1-based line of the opening fence
 * @property {string} source `directive` or `blockquote`
 * @property {"exact"|"contains"|"none"} titleMatch  how far the title can be checked
 */

/**
 * @param {string} text the document, includes already expanded if that is wanted
 * @returns {{ items: ScannedAdmonition[], warnings: string[] }}
 */
export function scanAdmonitions(text, { withExercises = false } = {}) {
  const lines = String(text ?? "").split("\n");
  const items = [];
  const warnings = [];

  /** Open fences, so that a directive shown inside a code block is not counted. */
  const stack = [];
  const top = () => stack[stack.length - 1];

  /** The admonition being read, while its options and first body line go by. */
  let pending = null;

  const settle = () => {
    if (!pending) return;
    // A generic `{admonition}` with no argument reaches myst-to-tex with
    // neither kind nor title: admonitionHeadersTransform returns early.
    if (pending.title == null && pending.kind) pending.title = admonitionKindToTitle(pending.kind) ?? null;
    items.push({
      name: pending.name,
      kind: pending.kind,
      title: pending.title,
      label: pending.label,
      line: pending.line,
      source: "directive",
      titleMatch: pending.titleMatch ?? "exact",
    });
    pending = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    const frame = top();

    const fence = FENCE_OPEN.exec(line);
    if (fence) {
      const marker = fence[2];
      const info = fence[3].trim();

      // Closing the current block.
      if (frame && info === "" && marker[0] === frame.char && marker.length >= frame.len) {
        settle();
        stack.pop();
        continue;
      }
      if (frame?.opaque) continue;

      const directive = DIRECTIVE_INFO.exec(info);
      const name = directive?.[1];
      const isExercise = withExercises && EXERCISE_NAMES.includes(name);
      const isAdmonition = name === "admonition" || ADMONITION_KINDS.includes(name) || isExercise;
      // A backtick or tilde fence with no `{name}` is code: its content is not
      // a document and nothing in it reaches the .tex as an admonition.
      const opaque = !directive && marker[0] !== ":";

      if (isAdmonition) {
        settle();
        const arg = directive[2].trim();
        // An exercise reaches the .tex as `Exercise 3 (My title)` and a
        // solution as `Solution to <a live \ref>`: the number comes from
        // mystmd's enumeration and the reference from its resolution, neither
        // of which this scan computes. The title of an exercise can still be
        // required to appear in the box, which keeps most of the safety; a
        // solution can only be counted.
        const titleMatch = !isExercise ? "exact" : name === "exercise" && arg ? "contains" : "none";
        pending = {
          name,
          // `exercise` and `solution` get colours of their own rather than
          // borrowing an admonition kind.
          kind: name === "admonition" ? null : name,
          // The argument is the title when there is one; otherwise it is
          // decided later, from the kind or from the first body block.
          title: arg || null,
          label: null,
          line: lineNo,
          titleFixed: Boolean(arg) || isExercise,
          bodyStarted: false,
          titleMatch,
        };
      }
      stack.push({ char: marker[0], len: marker.length, opaque, admonition: isAdmonition });
      continue;
    }

    if (frame?.opaque) continue;

    if (pending) {
      const option = OPTION_LINE.exec(line);
      if (option && !pending.bodyStarted) {
        const [, key, value] = option;
        if (key === "label" || key === "name") pending.label = value.trim() || null;
        // `:class:` can name a kind for a generic admonition. mystmd resolves
        // that elsewhere and we do not reproduce it: say so rather than guess.
        if (key === "class" && pending.kind == null && value.split(/\s+/).some((c) => ADMONITION_KINDS.includes(c))) {
          warnings.push(
            `line ${pending.line}: {admonition} with a kind in :class: -- its title in the .tex cannot be predicted`,
          );
        }
        continue;
      }
      if (!line.trim()) continue;

      // First block of the body. mystmd's admonitionHeadersTransform, under
      // `replaceAdmonitionTitles` (true by default), promotes a lone bold
      // paragraph or a heading to the title and removes it from the body.
      if (!pending.bodyStarted) {
        pending.bodyStarted = true;
        if (!pending.titleFixed) {
          const bold = BOLD_ONLY.exec(line);
          const heading = HEADING_LINE.exec(line);
          if (bold) pending.title = bold[1].trim();
          else if (heading) pending.title = heading[1].trim();
        }
      }
      continue;
    }

    // Outside any admonition: GitHub-style callouts, which become admonitions
    // too and therefore occupy a place in the ordinal sequence.
    const quote = QUOTE_BRACKET.exec(line) ?? QUOTE_BOLD.exec(line);
    if (quote && !frame?.opaque) {
      const kind = quote[1].toLowerCase();
      if (GITHUB_KINDS.includes(kind)) {
        items.push({
          name: kind,
          kind,
          title: admonitionKindToTitle(kind),
          label: null,
          line: lineNo,
          source: "blockquote",
          titleMatch: "exact",
        });
      }
    }
  }

  settle();
  return { items, warnings };
}
