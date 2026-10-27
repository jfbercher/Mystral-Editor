import { shortCaptionOf } from "../shortCaption.js";

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

/**
 * Regions whose content is typeset verbatim.
 *
 * Shared with `texAdmonitions.js`: what is inside one is text on a page, not
 * LaTeX. A `\begin{framed}` shown in a code block is an example of an
 * environment, not an environment, and counting it would shift every pairing
 * that follows.
 */
export const VERBATIM = /\\begin\{(verbatim|lstlisting|minted|Verbatim|alltt)\*?\}[\s\S]*?\\end\{\1\*?\}/g;

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

/** The opening of a caption mystmd wrote: `\caption[]{` or `\caption*[]{`. */
const EMPTY_SHORT_CAPTION = /\\caption(\*?)\[\]\{/g;

/** `]` would close the optional argument early; braces around it do not. */
const asOptional = (s) => (s.includes("]") ? `{${s}}` : s);

/**
 * The short caption the author declared, as the export plugin left it.
 *
 * `% shortcaption: …` written in a figure or a table is carried into the
 * `.tex` by `float-lists.mjs` as a LaTeX comment at the head of the caption,
 * its text in base64. The encoding is what makes it safe: base64 holds no
 * brace, bracket or percent sign, so nothing the author writes can break the
 * argument it is about to become, and until this pass runs -- or if it never
 * runs, because the post-processing is off or mystmd was called directly --
 * it is a comment and LaTeX ignores it.
 */
const DECLARED_SHORT = /^%MYSTRALSHORT:([A-Za-z0-9+/=]+)[ \t]*\r?\n/;

const fromBase64 = (b) => {
  const binary = atob(b);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

/**
 * The declared text as LaTeX.
 *
 * It came from a MyST comment, which nothing parses: it is plain text, and
 * every character LaTeX reads as an instruction is escaped so that it is
 * printed instead. An author who wants italics or math in a short caption
 * cannot have them this way, which is the price of a short caption that
 * cannot break the build -- and it keeps the printed list identical to what
 * the editor shows beside it.
 */
const escapeTex = (s) =>
  String(s)
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");

/**
 * Give a figure back the caption its list of figures should show.
 *
 * `myst-to-tex` writes every caption as `\caption[]{the real caption}`. The
 * bracketed argument is LaTeX's *short* caption -- what goes into
 * `\listoffigures` and `\listoftables` -- and mystmd writes it empty, so the
 * lists come out as a column of numbers with nothing beside them. Nothing
 * else notices: the caption under the figure is the brace argument and is
 * printed in full either way, which is why the loss only shows up the day a
 * document asks for the list.
 *
 * Dropping the empty brackets makes LaTeX fall back on the real caption, its
 * own default, and that is what happens by default here: it is the only
 * choice that cannot be wrong. `export.shortCaptions` asks for a shortened
 * form instead, built by `shortCaptionOf`, which declines whenever it has no
 * safe place to cut -- the caption is then printed in full, as before.
 *
 * Verbatim regions are masked first, for the reason given above: a
 * `\caption[]{…}` shown inside a code block is an example, not a caption.
 */
export function restoreShortCaptions(tex, { rule = false } = {}) {
  const text = String(tex ?? "");
  const kept = [];
  const masked = text.replace(VERBATIM, (match) => {
    kept.push(match);
    return `\u0000VERBATIM${kept.length - 1}\u0000`;
  });

  let out = "";
  let from = 0;
  let fixed = 0;
  let shortened = 0;
  let declared = 0;

  EMPTY_SHORT_CAPTION.lastIndex = 0;
  let m;
  while ((m = EMPTY_SHORT_CAPTION.exec(masked))) {
    // The argument is brace-balanced, so it is walked rather than matched:
    // a caption holding `\textit{…}` has braces of its own and no regular
    // expression closes on the right one.
    let depth = 1;
    let i = EMPTY_SHORT_CAPTION.lastIndex;
    for (; i < masked.length && depth > 0; i++) {
      const c = masked[i];
      if (c === "\\") i += 1;
      else if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
    }
    if (depth !== 0) break; // unbalanced: leave the rest of the file alone

    let body = masked.slice(EMPTY_SHORT_CAPTION.lastIndex, i - 1);

    // What the author declared wins over anything computed here, and is the
    // only thing that gets a short caption on a `\caption*`: the marker is
    // removed in every case, since a comment left inside the braces would
    // comment out the one that closes them.
    const declaredMatch = DECLARED_SHORT.exec(body);
    let short = null;
    if (declaredMatch) {
      body = body.slice(declaredMatch[0].length);
      try {
        short = escapeTex(fromBase64(declaredMatch[1]));
        declared += 1;
      } catch {
        short = null;
      }
    } else if (!m[1]) {
      // Only a real caption takes a computed one: `\caption*` is unnumbered
      // and never appears in a list, and the export uses it for furniture of
      // its own -- the attribution line of a quotation, among others.
      short = shortCaptionOf(body, rule);
      if (short) shortened += 1;
    }
    fixed += 1;

    out += masked.slice(from, m.index);
    out += `\\caption${m[1]}${short ? `[${asOptional(short)}]` : ""}{${body}}`;
    from = i;
    EMPTY_SHORT_CAPTION.lastIndex = i;
  }
  out += masked.slice(from);

  return { text: out.replace(/\u0000VERBATIM(\d+)\u0000/g, (_, i) => kept[Number(i)]), fixed, shortened, declared };
}
