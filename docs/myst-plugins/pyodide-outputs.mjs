/**
 * Fill the empty `outputs` nodes of a document with what the editor's Pyodide
 * cells produced.
 *
 * mystmd already builds the shape we need: a `{code-cell}` becomes a block
 * holding a `code` node and an **empty** `outputs` node beside it, whether or
 * not anything was ever executed. There is therefore nothing to insert and no
 * ordinal to match -- only a node waiting to be filled.
 *
 * The match is on the code itself, as written: the editor keys its cells the
 * same way, so neither side has to reproduce the other's hash function. Two
 * cells with identical code share their outputs, which is what the editor does
 * too -- its cache is keyed by the code.
 *
 * Each result becomes an `output` node carrying both forms, because the two
 * chains read different ones:
 *
 *   - `children`: ordinary mdast -- an `image`, a `code` -- which
 *     `reduceOutputs` hands to the LaTeX, Word and Typst writers.
 *   - `jupyter_data`: the minified MIME bundle, which is the only thing the
 *     web theme looks at. `Output` in `@myst-theme/jupyter` reads
 *     `node.jupyter_data` and never its children: before a kernel is
 *     connected it renders our image, and once one is, the same node is the
 *     receptacle thebe writes its own results into. Dropping the bundle, as
 *     an earlier version did, gave a site that showed the figures and had
 *     nowhere to put a recomputed one.
 *
 * The bundle's `path` is what took two attempts. It is used verbatim --
 * `<img src={image.path}>` -- so it has to be a URL the site actually serves:
 * a path into `_build/pyodide` is not one, and a bare base64 string has no
 * `.path` at all. `_build/pyodide` is declared in the project's
 * `static_files`, which copies it to the site's public folder under its own
 * name, so `/pyodide/<file>.png` is served and resolves from any page.
 *
 * The manifest is written by the editor next to the document; a document built
 * without one is left exactly as it is.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * Where the editor writes what this plugin reads.
 *
 * Under `_build`, not beside the document: it is an intermediate of a build,
 * like the `.tex`, and `_build` is the folder mystmd already claims and that
 * projects already ignore. The paths inside the manifest are relative to the
 * folder holding `_build`, so they are what the document itself would write.
 */
const MANIFEST = "_build/pyodide/pyodide-outputs.json";

/**
 * The folder the images are served from, once `_build/pyodide` has been copied
 * into the site's public folder by `static_files` -- `copyStaticFiles` keeps
 * the directory's own name, so this is simply its basename.
 */
const PUBLIC_DIR = "pyodide";

/** The manifest governing a file: the nearest one from its folder upwards. */
function readManifest(file) {
  let dir = dirname(resolve(file));
  for (let depth = 0; depth < 6; depth++) {
    const candidate = join(dir, MANIFEST);
    if (existsSync(candidate)) {
      try {
        return { dir, data: JSON.parse(readFileSync(candidate, "utf8")) };
      } catch (err) {
        console.warn(`[pyodide-outputs] ${candidate} is not readable JSON:`, err.message);
        return null;
      }
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

/**
 * The mdast each result is made of.
 *
 * One entry per *result*, never one per node. A centred image is three mdast
 * nodes -- `\begin{center}`, the image, `\end{center}` -- but a single output,
 * and emitting three `output` nodes put two of them in front of the web theme
 * with no data to render: "Cannot render output node / Jupyter output data
 * package is missing or not an object", twice, around each figure. The raw
 * braces are LaTeX punctuation; they belong inside the output they punctuate,
 * where `reduceOutputs` hands them to the LaTeX writer in order and the theme
 * never looks at them.
 */
function nodesFor(outputs, insideContainer) {
  // One entry per result: the mdast it is made of, and the bundle that stands
  // for the same thing for the web theme.
  const results = [];
  const add = (nodes, bundle = null) => results.push({ nodes: [].concat(nodes), bundle });

  for (const out of outputs ?? []) {
    if (out.type === "image" && out.path) {
      const image = {
        type: "image",
        data: { type: "output" },
        url: out.path,
        urlSource: out.path,
        // `width` is read by every writer; a width in per cent becomes a
        // fraction of the line in LaTeX, which is what the cell's `:figwidth:`
        // means. A width in pixels is passed on as it is and each writer makes
        // of it what it can.
        ...(out.width ? { width: out.width } : {}),
        ...(out.align ? { align: out.align } : {}),
      };
      // A `{code-cell}` carrying `:caption:` or `:label:` is wrapped by mystmd
      // itself in a figure holding the code and its outputs -- it reads the
      // source, not our HTML, so it sees those options. That figure already
      // carries `\centering`, so there the image needs nothing.
      //
      // Elsewhere it has to be centred by hand: `myst-to-tex` has its own
      // alignment code for a bare image commented out, so an
      // `\includegraphics` alone is never centred, whatever `align` says. A
      // `figure` container would centre it, but a float is free to drift away
      // from the cell that produced it -- the one thing an output must not do.
      // `center` is not a float, and is what that commented code wrote. It
      // travels in `raw` nodes, which the LaTeX writer reads and no other.
      // The environment the cell's `:align:` asks for; these three are the
      // ones myst-to-tex's own commented code used.
      // Served from the site's public folder: `_build/pyodide` is declared in
      // the project's `static_files`, which copies it there under its own
      // name. Absolute, so the URL resolves from any page of the site.
      const bundle = {
        output_type: "display_data",
        data: { "image/png": { content_type: "image/png", path: `/${PUBLIC_DIR}/${out.path.split("/").pop()}` } },
        metadata: {},
      };

      const env = { left: "flushleft", right: "flushright" }[String(out.align ?? "").toLowerCase()] ?? "center";
      // Inside mystmd's own figure, `\centering` already applies to everything
      // it holds, so a centred image needs nothing -- but a left- or
      // right-aligned one needs saying, and an environment inside the figure
      // is what overrides it for that one image.
      if (insideContainer && env === "center") {
        add(image, bundle);
      } else {
        add([{ type: "raw", tex: `\\begin{${env}}` }, image, { type: "raw", tex: `\\end{${env}}` }], bundle);
      }
    } else if (out.type === "text" && String(out.value ?? "").trim()) {
      // A plain string, as nbformat writes it: the same reason as above.
      add({ type: "code", data: { type: "output" }, value: String(out.value) }, {
        output_type: "stream",
        name: out.stream === "stderr" ? "stderr" : "stdout",
        // A plain string: `Stream` in the theme reads it through
        // `ensureString(output.text)`.
        text: String(out.value),
      });
    }
  }
  return results;
}

const fillOutputs = {
  name: "Pyodide cell outputs",
  // After enumeration and reference resolution, like the exercise plugin: this
  // adds content that carries none of either, but running late costs nothing
  // and keeps the two plugins' assumptions identical.
  stage: "project",
  plugin: () => (tree, vfile) => {
    const manifest = readManifest(vfile?.path ?? ".");
    if (!manifest) return tree;

    // An image path is written relative to the folder holding `_build`, and an
    // `image` node is read relative to its document: rewritten from one to the
    // other. Kept relative rather than made absolute, which also works but
    // stops mystmd copying the file into the export's own `files/` folder --
    // and a .tex pointing outside its folder travels nowhere.
    const from = dirname(resolve(vfile?.path ?? "."));
    const rebase = (p) => (p && !p.startsWith("/") ? relative(from, resolve(manifest.dir, p)) || p : p);
    const byCode = new Map(
      (manifest.data?.cells ?? []).map((c) => [
        String(c.code ?? "").trim(),
        (c.outputs ?? []).map((o) => (o.type === "image" ? { ...o, path: rebase(o.path) } : o)),
      ]),
    );
    if (!byCode.size) return tree;

    let filled = 0;
    const walk = (node, inContainer = false) => {
      const kids = node.children ?? [];
      for (let i = 0; i < kids.length; i++) {
        const child = kids[i];
        // An `outputs` that already holds something was filled by an
        // execution: that result is fresher than ours and is left alone.
        if (child.type === "outputs" && !(child.children ?? []).length) {
          const code = kids.slice(0, i).reverse().find((n) => n.type === "code");
          const outputs = code && byCode.get(String(code.value ?? "").trim());
          if (outputs) {
            const results = nodesFor(outputs, inContainer);
            if (results.length) {
              // The `outputs` node is filled, not replaced: it is what the
              // web theme renders, and what thebe writes its own results
              // into once a kernel is connected. Each child carries both
              // forms -- mdast for the static writers, a MIME bundle for the
              // theme -- and `Output` reads only the bundle, so nothing is
              // drawn twice. See `nodesFor` for why the bundle's path is an
              // absolute URL into the site's public folder.
              child.children = results.map(({ nodes, bundle }) => ({
                type: "output",
                children: nodes,
                ...(bundle ? { jupyter_data: bundle } : {}),
              }));
              filled++;
            }
          }
        }
        walk(child, inContainer || child.type === "container");
      }
    };
    walk(tree);

    if (filled) console.log(`🐍 Pyodide outputs: filled ${filled} cell(s) from ${MANIFEST}`);
    return tree;
  },
};

export default { name: "Mystral Editor — Pyodide outputs", transforms: [fillOutputs] };
