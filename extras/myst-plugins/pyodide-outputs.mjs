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
 * The empty node is *replaced* by ordinary mdast -- an `image`, a `code` --
 * rather than filled with `output` nodes carrying a Jupyter MIME bundle. The
 * bundle was the faithful route and it does not survive outside a notebook:
 * myst-cli only resolves a bundle's `path` when the bundle carries a `hash`
 * from its own output cache, which ours never will, and whatever is left is
 * then prefixed with the content server's origin by the web theme. An
 * ordinary `image` travels the road every figure already travels, and each
 * target copies the file and rewrites the URL for itself.
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
  // One entry per result, holding the mdast nodes it is made of.
  const results = [];
  const add = (nodes) => results.push({ nodes: [].concat(nodes) });

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
      const env = { left: "flushleft", right: "flushright" }[String(out.align ?? "").toLowerCase()] ?? "center";
      // Inside mystmd's own figure, `\centering` already applies to everything
      // it holds, so a centred image needs nothing -- but a left- or
      // right-aligned one needs saying, and an environment inside the figure
      // is what overrides it for that one image.
      if (insideContainer && env === "center") {
        add(image);
      } else {
        add([{ type: "raw", tex: `\\begin{${env}}` }, image, { type: "raw", tex: `\\end{${env}}` }]);
      }
    } else if (out.type === "text" && String(out.value ?? "").trim()) {
      // A plain string, as nbformat writes it: the same reason as above.
      add({ type: "code", data: { type: "output" }, value: String(out.value) });
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
              // The empty `outputs` node is *replaced* by ordinary mdast,
              // rather than filled with `output` nodes carrying a Jupyter
              // bundle.
              //
              // The bundle route was the faithful one and it does not work
              // outside a notebook: `transformOutputsToFile` in myst-cli only
              // rewrites a bundle's `path` when the bundle carries a `hash`
              // its own output cache knows, which ours never will -- and what
              // is left is handed to the web theme, where something prefixes
              // it with the content server's origin, whatever it holds. A
              // relative path arrived as `http://localhost:3100_build/...`; a
              // data URI arrived as `http://localhost:3101data:image/png...`.
              // The value was never the problem.
              //
              // An ordinary `image` node has none of that trouble: it is the
              // road every figure in the document already travels, so mystmd
              // copies the file where each target needs it and rewrites the
              // URL itself -- the site's public folder, the export's `files/`.
              // We stop claiming to be Jupyter outputs and simply emit the
              // picture.
              kids.splice(i, 1, ...results.flatMap(({ nodes }) => nodes));
              filled++;
              // The children array just changed under the loop; the nodes we
              // inserted hold no `outputs` of their own, so skipping past them
              // is both correct and cheaper.
              i += results.reduce((n, r) => n + r.nodes.length, 0) - 1;
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
