/**
 * `==highlighted==`, as a `<mark>` element.
 *
 * markdown-it ships strikethrough and emphasis and stops there; the double
 * equals sign is a GitHub and Obsidian habit that a lot of notes carry, and a
 * document written elsewhere arrives full of them. It is written here rather
 * than pulled in as a dependency because it is thirty lines of the shape
 * markdown-it already uses for `~~`, and because the export side -- which is
 * a mystmd plugin and shares no code with this -- has to agree with it
 * exactly. Two implementations we own stay in step; one of ours and one of
 * someone else's drift.
 *
 * The algorithm is markdown-it's own: a tokenizer that pushes the runs of
 * markers as delimiters, and a second pass that pairs them. Doing it that way
 * is what makes `==a **b** c==` work, and what makes a lone `=` stay a lone
 * `=`: the pairing is the parser's, not a regular expression's.
 */

/** The character, once, as markdown-it compares code points. */
const EQ = 0x3d;

/**
 * Push the runs of `=` as delimiters, two by two.
 *
 * An odd marker leaves one behind as plain text, which is how `===` is read
 * as an opening pair followed by a stray sign rather than refused outright.
 */
function tokenize(state, silent) {
  const start = state.pos;
  if (silent) return false;
  if (state.src.charCodeAt(start) !== EQ) return false;

  const scanned = state.scanDelims(state.pos, true);
  let len = scanned.length;
  if (len < 2) return false;

  let token;
  if (len % 2) {
    token = state.push("text", "", 0);
    token.content = "=";
    len -= 1;
  }

  for (let i = 0; i < len; i += 2) {
    token = state.push("text", "", 0);
    token.content = "==";
    state.delimiters.push({
      marker: EQ,
      length: 0, // the pairing ignores it, as it does for `~~`
      token: state.tokens.length - 1,
      end: -1,
      open: scanned.can_open,
      close: scanned.can_close,
    });
  }

  state.pos += scanned.length;
  return true;
}

/** Turn the paired delimiters into `<mark>` tags, and fuse the lonely ones. */
function postProcess(state, delimiters) {
  const lone = [];

  for (const start of delimiters) {
    if (start.marker !== EQ || start.end === -1) continue;
    const end = delimiters[start.end];

    let token = state.tokens[start.token];
    token.type = "mark_open";
    token.tag = "mark";
    token.nesting = 1;
    token.markup = "==";
    token.content = "";

    token = state.tokens[end.token];
    token.type = "mark_close";
    token.tag = "mark";
    token.nesting = -1;
    token.markup = "==";
    token.content = "";

    // `==a ===b==` leaves a stray sign against the closing tag; markdown-it
    // glues it back to the text so the output does not gain a token nobody
    // asked for.
    const before = state.tokens[end.token - 1];
    if (before?.type === "text" && before.content === "=") lone.push(end.token - 1);
  }

  while (lone.length) {
    const i = lone.pop();
    let j = i + 1;
    while (state.tokens[j]?.type === "mark_close") j += 1;
    j -= 1;
    if (i !== j) {
      const token = state.tokens[j];
      state.tokens[j] = state.tokens[i];
      state.tokens[i] = token;
    }
  }
}

export default function markdownMark(md) {
  md.inline.ruler.before("emphasis", "mark", tokenize);
  md.inline.ruler2.before("emphasis", "mark", (state) => {
    postProcess(state, state.delimiters);
    for (const meta of state.tokens_meta ?? []) {
      if (meta?.delimiters) postProcess(state, meta.delimiters);
    }
    return true;
  });
}
