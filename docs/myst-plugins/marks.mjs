/**
 * `~~struck out~~` and `==highlighted==`, so that both survive an export.
 *
 * Both are ordinary Markdown to a reader and neither is Markdown to mystmd:
 * `~~x~~` comes out of a LaTeX export as `{\textasciitilde}{\textasciitilde}x`
 * and `==x==` as itself. The roles exist -- `` {del}`x` `` becomes \sout and
 * `` {u}`x` `` becomes \uline -- so what is missing is only the shorthand,
 * which the editor's preview has always understood.
 *
 * ── What this emits, and why those nodes ──────────────────────────────────
 *
 * Struck-out text has a node of its own: `delete`, which every writer knows.
 * Nothing clever is needed.
 *
 * Highlighted text has none. `myst-spec` declares `delete`, `underline` and
 * `smallcaps`, and stops there; and a plugin may add directives, roles and
 * transforms but no renderer, so no writer can be taught a `mark` node. What
 * it becomes therefore depends on where the build is going -- see
 * `highlighted` below, which is where that trade is set out:
 *
 *   site    <span class="highlight">text</span>
 *   LaTeX   \hl{text}
 *   Word    text, plain
 *
 * `\hl` needs `soul`, which the editor's own LaTeX post-processing adds when
 * it finds one; a build from your own command line needs it in the preamble.
 *
 * ── Where it does not apply ───────────────────────────────────────────────
 *
 * Only `text` nodes are rewritten. Code, inline code and maths are other node
 * types holding a `value` rather than children, so they are never visited and
 * `~~` inside a code cell stays what it is. A `==` at the start of a line is
 * a setext heading to the parser and has already been consumed by the time
 * this runs, so headings are safe too.
 */

/** The two markers, and the node each one asks for. */
const MARKERS = ["~~", "=="];

/**
 * The nodes a mark becomes.
 *
 * Struck-out text has a node of its own and is simply that node.
 *
 * A highlight is its own text, between two `raw` nodes carrying the LaTeX
 * command. The text is *not* wrapped in anything, and that is the whole
 * design rather than a simplification: the Word writer drops any node it has
 * no handler for, together with its children, and it has none for `span` --
 * so a highlight written as a span did not lose its colour in Word, it lost
 * its words. Text that survives everywhere is worth more than a colour that
 * survives in one more place.
 *
 * The two `raw` nodes have no children, so the same writer drops them
 * harmlessly. It does say so, twice per highlight, in its log.
 */
const wrap = (kind, children) => (kind === "~~" ? struck(children) : highlighted(children));

/**
 * Is this a build meant to end in a file rather than on a site?
 *
 * The editor sets this for its own `.tex`, `.pdf` and `.docx` exports, as
 * `cards-grids.mjs` does before it; a site build sets nothing. It is the only
 * thing a transform ever learns about where it is going -- `opts` is
 * undefined and the vfile names only the source -- and here it decides a
 * genuine trade, described under `highlighted`.
 */
const staticExport = () => process.env.MYSTRAL_STATIC === "1";

/**
 * Highlighted text, drawn differently depending on where it is going.
 *
 * On a site, a `span` of a class the stylesheet colours. In a file, the text
 * itself between two `raw` nodes carrying the LaTeX command, and nothing
 * wrapping it.
 *
 * The difference is not a refinement, it is a trade made with eyes open. The
 * Word writer drops a node it has no handler for *together with its
 * children*, and it has none for `span`: a highlight written as a span does
 * not reach Word without its colour, it does not reach Word at all. Writing
 * it as a span everywhere would lose words; writing it bare everywhere loses
 * the colour on the site, which is where most readers meet the document.
 *
 * So each build gets what it can read. The reservation to know: a
 * `myst build --docx` run by hand, outside the editor and therefore without
 * `MYSTRAL_STATIC=1`, takes the site's shape and loses the highlighted words.
 * The editor's own exports set it, so its Word files are sound.
 */
const highlighted = (children) =>
  staticExport()
    ? [{ type: "raw", lang: "tex", tex: "\\hl{" }, ...children, { type: "raw", lang: "tex", tex: "}" }]
    : [{ type: "span", class: "highlight", children }];

/**
 * Struck-out text: one `delete` per child rather than one around them all.
 *
 * `delete` is a node every writer knows, so one around the lot ought to be
 * right -- and it is, except in Word. The Word writer carries styling as
 * "options for the next run", and a run of text *consumes and clears* them:
 *
 *   text(text, opts) {
 *     this.current.push(new TextRun({ text, ...this.data.nextRunOpts, ...opts }));
 *     delete this.data.nextRunOpts;
 *   }
 *
 * So in `~~a **b** c~~` the strike is set once, spent on `a`, and gone: the
 * bold comes out unstruck and so does everything after it. The same flaw
 * reaches `{del}`, `{u}` and `{sc}`, and no plugin can mend it -- a plugin
 * adds transforms, never a renderer.
 *
 * What a plugin can do is hand that writer a tree it reads correctly. One
 * `delete` per child means nothing stands between a `delete` and the text it
 * governs: `delete[bold[b]]` sets strike, then bold, then writes the run with
 * both. LaTeX and the site are unmoved -- `\sout{a}\sout{\textbf{b}}` draws
 * what `\sout{a \textbf{b}}` draws -- so the workaround costs them nothing.
 *
 * A single child, which is the ordinary case, stays a single node.
 */
const struck = (children) =>
  children.length <= 1 ? [{ type: "delete", children }] : children.map((child) => ({ type: "delete", children: [child] }));

/**
 * The first opening marker in a string, at or after `from`.
 *
 * An opener is followed by something other than a space, which is what keeps
 * `a ~~ b` -- two tildes used as themselves -- from opening anything. The
 * same rule markdown-it applies, so the preview and the export agree.
 *
 * `nextSibling` says whether another node follows this text, and it is not a
 * detail: in `~~**bold** first~~` the opening marker is the whole of its text
 * node, the bold being the next child. Asked only of the string, the test
 * found nothing after the marker, called it a stray pair of tildes, and the
 * document exported with its tildes showing. A sibling is not a space.
 */
function opener(value, from, nextSibling) {
  for (let i = from; i <= value.length - 2; i++) {
    const kind = value.slice(i, i + 2);
    if (!MARKERS.includes(kind)) continue;
    const after = value[i + 2];
    if (after === undefined ? nextSibling : /\S/.test(after)) return { at: i, kind };
  }
  return null;
}

/**
 * The matching closer in a string: preceded by something other than a space.
 *
 * `prevSibling` plays the part `nextSibling` plays above, for the symmetrical
 * case -- `~~ends in **bold**~~`, where the closing marker opens its own text
 * node and what precedes it is a node rather than a character.
 */
function closer(value, kind, from, prevSibling) {
  for (let i = from; i <= value.length - 2; i++) {
    if (value.slice(i, i + 2) !== kind) continue;
    if (i > 0 ? /\S/.test(value[i - 1]) : prevSibling) return i;
  }
  return -1;
}

const text = (value) => (value ? [{ type: "text", value }] : []);

/**
 * The last opening marker of this kind lying strictly between an opener and
 * the closer it was about to be paired with.
 *
 * markdown-it pairs a closer with the *nearest* opener before it, and the
 * preview is markdown-it. Pairing with the first opener instead looks the
 * same until a stray marker sits earlier in the same paragraph: in
 *
 *     non fermé ~~ceci reste
 *     et plus bas ~~barré~~
 *
 * -- one paragraph, the line breaks being soft -- the preview leaves the
 * first pair of tildes as tildes and strikes out the second, while pairing
 * with the first opener struck out everything from the stray marker onwards.
 * A document would then read one way in the editor and another in the
 * export, which is worse than either behaviour on its own.
 */
function nearerOpener(children, kind, startNode, startAt, endNode, endAt) {
  let found = null;
  for (let j = startNode; j <= endNode; j++) {
    const child = children[j];
    if (child?.type !== "text") continue;
    const value = String(child.value ?? "");
    const from = j === startNode ? startAt : 0;
    const to = j === endNode ? endAt : value.length;
    for (let k = from; k <= to - 2; k++) {
      if (value.slice(k, k + 2) !== kind) continue;
      const after = value[k + 2];
      if (after === undefined ? j < children.length - 1 : /\S/.test(after)) found = { node: j, at: k };
    }
  }
  return found;
}

/**
 * Rewrite one parent's children.
 *
 * Across the whole list of siblings rather than inside each text node, and
 * that is the point of the function: `~~struck **bold** out~~` is three
 * children -- text, strong, text -- so a pass confined to one node would see
 * two stray markers and leave them in the document, while the editor's own
 * preview renders the nesting happily. The two would then disagree, which is
 * worse than not supporting it at all.
 *
 * Unpaired markers are left exactly as they are. A document is full of them
 * -- a tilde in a path, `==` in a line of code quoted in prose -- and the
 * rule that a marker only counts when it closes is what keeps them safe.
 */
function rewriteChildren(node) {
  if (!Array.isArray(node.children) || node.children.length === 0) return;
  for (const child of node.children) rewriteChildren(child);

  let i = 0;
  let from = 0;
  while (i < node.children.length) {
    const child = node.children[i];
    if (child?.type !== "text") {
      i += 1;
      from = 0;
      continue;
    }
    const value = String(child.value ?? "");
    const open = opener(value, from, i < node.children.length - 1);
    if (!open) {
      i += 1;
      from = 0;
      continue;
    }
    const afterOpen = open.at + 2;

    // In this node first, then in the ones that follow: the content between
    // the markers may be anything the parser already built.
    let end = { node: i, at: closer(value, open.kind, afterOpen, false) };
    if (end.at === -1) {
      end = { node: -1, at: -1 };
      for (let j = i + 1; j < node.children.length; j++) {
        const sibling = node.children[j];
        if (sibling?.type !== "text") continue;
        // Something precedes this node by construction -- at the very least
        // the node the marker was opened in.
        const at = closer(String(sibling.value ?? ""), open.kind, 0, true);
        if (at !== -1) {
          end = { node: j, at };
          break;
        }
      }
    }
    // No closer: the marker is not a marker. Carry on past it rather than
    // past the node, so a later pair in the same text is still found.
    if (end.node === -1) {
      from = afterOpen;
      continue;
    }

    // Nearest opener wins, as in the preview: an earlier stray marker must
    // not swallow a pair written further on.
    const nearer = nearerOpener(node.children, open.kind, i, afterOpen, end.node, end.at);
    if (nearer) {
      i = nearer.node;
      from = nearer.at;
      continue;
    }

    const last = node.children[end.node];
    const lastValue = String(last.value ?? "");
    const inner =
      end.node === i
        ? text(value.slice(afterOpen, end.at))
        : [...text(value.slice(afterOpen)), ...node.children.slice(i + 1, end.node), ...text(lastValue.slice(0, end.at))];
    const before = text(value.slice(0, open.at));
    const after = text(lastValue.slice(end.at + 2));
    const wrapped = wrap(open.kind, inner);

    node.children.splice(i, end.node - i + 1, ...before, ...wrapped, ...after);
    // Resume on the remainder, which is where another pair may begin.
    i += before.length + wrapped.length;
    from = 0;
  }
}

const marks = {
  name: "mystral-marks",
  doc: "Strikethrough `~~x~~` and highlight `==x==`, as nodes the writers understand.",
  stage: "document",
  plugin: () => (tree) => {
    rewriteChildren(tree);
    return tree;
  },
};

const plugin = {
  name: "Mystral Editor — strikethrough and highlight",
  transforms: [marks],
};

export default plugin;
