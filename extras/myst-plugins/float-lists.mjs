/**
 * Teach mystmd the editor's `{list-of-figures}` and `{list-of-tables}`.
 *
 * The editor renders these itself, from the figures and tables it has already
 * scanned. mystmd has never heard of them, so without this plugin a build
 * reports an unknown directive and drops the node -- and the LaTeX comes out
 * without the list the author asked for.
 *
 * What the directive produces is a `raw` node carrying nothing but `tex`. That
 * is on purpose and is the whole design:
 *
 *   - LaTeX has `\listoffigures` and `\listoftables`, which build the list
 *     from the figures LaTeX has itself numbered. Nothing here has to collect
 *     anything: the one line is the export.
 *   - Every other writer -- the web theme, Word, Typst -- sees a raw node in a
 *     language it does not speak and renders nothing, which is what we want
 *     for v1. An HTML site has a sidebar and a search box; a list of figures
 *     there would be furniture nobody asked for.
 *
 * The LaTeX spellings are accepted as aliases, because an author who knows
 * LaTeX writes `{listoffigures}` without thinking. The editor accepts the
 * same four names.
 *
 * To use it, name it in the project's myst.yml:
 *
 *   project:
 *     plugins:
 *       - ./float-lists.mjs
 */

/** One directive per kind: same shape, different LaTeX macro. */
const listDirective = (name, alias, macro, doc) => ({
  name,
  alias: [alias],
  doc,
  options: {
    // Accepted and ignored: the editor uses it to print a heading above the
    // list, and LaTeX titles its own lists through \listfigurename.
    title: { type: String, doc: "Heading shown above the list in the editor's preview." },
  },
  run() {
    // The newlines are not cosmetic. The writer puts a raw node's text where
    // it stands, so without them the next thing written runs straight into the
    // macro -- `\\listoffiguresSection 2` -- and LaTeX reads an undefined
    // control sequence rather than the list.
    return [{ type: "raw", tex: `\n\\${macro}\n\n` }];
  },
});


/* ------------------------------------------------------------------ *
 * Short captions
 *
 * LaTeX's `\caption[short]{long}` prints the short form in \listoffigures
 * and the long one under the figure. `myst-to-tex` always writes `\caption[]`
 * -- an explicit *empty* short caption -- so the lists come out as a column
 * of numbers with nothing beside them.
 *
 * The author declares the short form as a MyST comment inside the figure or
 * the table:
 *
 *     :::{figure} plot.png
 *     :label: fig-one
 *
 *     A long caption, with all the detail the reader of the page wants.
 *
 *     % shortcaption: The short form, for the list of figures
 *     :::
 *
 * A comment rather than an option, because mystmd drops an option it does not
 * know -- with a warning on every build -- before any plugin can see it,
 * while a comment arrives here intact.
 *
 * It must come *after* the caption: mystmd takes the first block of the body
 * for the caption, so a comment written first becomes the caption and the
 * real one is demoted to the legend. That is repaired below rather than
 * reported, because a caption whose whole content is a `shortcaption`
 * comment is never what anyone meant.
 *
 * What is emitted is a LaTeX *comment* carrying the text in base64:
 *
 *     \caption[]{%MYSTRALSHORT:VGhlIHNob3J0…
 *     The long caption}
 *
 * The editor's `.tex` post-processing turns it into the real optional
 * argument. The form matters: base64 cannot contain a brace, a bracket or a
 * percent sign, so nothing the author writes can break the argument it will
 * become; and until the post-processing runs -- or if it is turned off, or
 * never runs because the user exported with mystmd alone -- it is a comment,
 * which LaTeX ignores. A marker that could fail closed as an undefined
 * command was not worth the risk for a cosmetic gain.
 * ------------------------------------------------------------------ */

const SHORT = /^\s*shortcaption\s*:\s*([\s\S]+?)\s*$/i;

/**
 * The `shortcaption` comment, wherever mystmd put it.
 *
 * Where that is depends on where it was written, and the answer is rarely
 * the obvious one: a comment written after the caption ends up in the
 * figure's `legend`, not in its `caption`, and a table's lands there too.
 * Rather than enumerate the cases, the whole figure is searched and the
 * comment removed from whichever list holds it.
 *
 * Removing it is not housekeeping. A MyST comment reaches LaTeX as a LaTeX
 * comment, and the legend is written *inside* `\caption{…}`, so the comment
 * commented out the brace that closes it: the export did not merely lose the
 * short caption, it produced a file that does not compile.
 */
const findShort = (container) => {
  let found = null;
  const walk = (node) => {
    for (const child of node.children ?? []) {
      if (found) return;
      if (child.type === "comment") {
        const m = SHORT.exec(String(child.value ?? ""));
        if (m) {
          found = { parent: node, node: child, value: m[1] };
          return;
        }
      }
      walk(child);
    }
  };
  walk(container);
  return found;
};

const isShortOnlyCaption = (node) =>
  node?.type === "caption" && node.children?.length === 1 && node.children[0].type === "comment" && SHORT.test(String(node.children[0].value ?? ""));

const toBase64 = (s) =>
  typeof Buffer !== "undefined" ? Buffer.from(s, "utf8").toString("base64") : btoa(unescape(encodeURIComponent(s)));

/**
 * Put the short caption into the caption, as a LaTeX comment.
 *
 * Inserted inside the caption's first paragraph rather than beside it: the
 * writer emits a paragraph's children in place, which is where the text of
 * `\caption{…}` is built, and a block-level node beside the paragraph would
 * be written outside the braces.
 */
function markShortCaption(container, value) {
  const caption = (container.children ?? []).find((c) => c.type === "caption");
  if (!caption) return false;
  const paragraph = (caption.children ?? []).find((c) => c.type === "paragraph");
  const host = paragraph ?? caption;
  host.children = [{ type: "raw", tex: `%MYSTRALSHORT:${toBase64(value)}\n` }, ...(host.children ?? [])];
  return true;
}

const shortCaptions = {
  name: "Short captions for the lists of figures and tables",
  stage: "project",
  plugin: () => (tree) => {
    const walk = (node) => {
      for (const child of node.children ?? []) walk(child);
      if (node.type !== "container") return;

      // The comment written before the caption: mystmd made it the caption
      // and pushed the real one into the legend. Put them back the way they
      // were meant, so the figure reads the same here as in the editor.
      const caption = (node.children ?? []).find((c) => c.type === "caption");
      if (isShortOnlyCaption(caption)) {
        const rest = (node.children ?? []).filter((c) => c !== caption);
        const promoted = rest.find((c) => c.type === "paragraph" || c.type === "legend");
        if (promoted) {
          const value = SHORT.exec(String(caption.children[0].value ?? ""))[1];
          caption.children = promoted.type === "legend" ? (promoted.children ?? []) : [promoted];
          node.children = (node.children ?? []).filter((c) => c !== promoted);
          markShortCaption(node, value);
          return;
        }
      }

      const found = findShort(node);
      if (!found) return;
      found.parent.children = (found.parent.children ?? []).filter((c) => c !== found.node);
      // An empty paragraph left behind would be written as a blank line in
      // the middle of the caption.
      node.children = (node.children ?? []).filter((c) => c.type !== "legend" || (c.children ?? []).some((x) => (x.children ?? []).length || x.value));
      markShortCaption(node, found.value);
    };
    walk(tree);
    return tree;
  },
};


/* ------------------------------------------------------------------ *
 * Floated figures and tables
 *
 * `:class: float-left` / `float-right` on a `{figure}` or a `{table}` asks
 * for the text to run beside it rather than below. `:class:` and not an
 * option of our own: mystmd knows it, keeps it on the node and passes it to
 * the HTML site, where it drops an option it has never heard of -- with a
 * warning -- before anything downstream can read it.
 *
 * LaTeX does this with `wrapfigure` / `wraptable`, which the writer never
 * emits, so the environment has to be changed in the `.tex` afterwards. The
 * marker left here says which figure and how wide, in the same form as the
 * short captions above and for the same reasons: a LaTeX comment, so a file
 * that is never post-processed still compiles.
 *
 * `float-center` leaves no marker. There is no centred `wrapfigure`, and a
 * centred block is what `figure` already does in LaTeX -- the class only has
 * work to do in the preview and on the site.
 * ------------------------------------------------------------------ */

const FLOAT_CLASS = /(?:^|\s)float-(left|right)(?:\s|$)/;

/** `45%` as the fraction of `\textwidth` LaTeX wants; anything else, none. */
function widthFraction(width) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*%\s*$/.exec(String(width ?? ""));
  if (!m) return "";
  const fraction = Number(m[1]) / 100;
  return fraction > 0 && fraction <= 1 ? fraction.toFixed(3).replace(/0+$/, "").replace(/\.$/, "") : "";
}

/** The width the author gave the figure, which lives on the image node. */
function floatWidth(container) {
  let found = "";
  const walk = (node) => {
    for (const child of node.children ?? []) {
      if (found) return;
      if (child.type === "image" && child.width) found = widthFraction(child.width);
      else walk(child);
    }
  };
  walk(container);
  return found;
}

function markFloat(container) {
  const m = FLOAT_CLASS.exec(String(container.class ?? ""));
  if (!m) return false;
  const side = m[1] === "left" ? "l" : "r";
  // At the head of the figure rather than inside its caption, where the short
  // caption's marker already sits: the two would then have to be read in
  // either order. Here it is written just inside `\begin{figure}`, which is
  // the environment the post-processing has to find anyway.
  container.children = [{ type: "raw", tex: `%MYSTRALFLOAT:${side}:${floatWidth(container)}\n` }, ...(container.children ?? [])];
  return true;
}

const floatMarkers = {
  name: "Floated figures and tables",
  stage: "project",
  plugin: () => (tree) => {
    const walk = (node) => {
      for (const child of node.children ?? []) walk(child);
      if (node.type === "container") markFloat(node);
    };
    walk(tree);
    return tree;
  },
};

const plugin = {
  name: "Mystral Editor — lists of figures and tables",
  directives: [
    listDirective("list-of-figures", "listoffigures", "listoffigures", "A list of the document's figures."),
    listDirective("list-of-tables", "listoftables", "listoftables", "A list of the document's tables."),
  ],
  transforms: [shortCaptions, floatMarkers],
};

export default plugin;
