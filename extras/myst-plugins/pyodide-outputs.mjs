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
 * Each output is written twice, in the two fields the spec provides, because
 * the two chains read different ones (see BACKLOG point 4, "form D"):
 *
 *   - `children`: ordinary mdast -- an `image` and a `code` -- which
 *     `reduceOutputs` leaves alone (it returns early for an `output` that
 *     already has children) and hands to the LaTeX, Word and Typst writers.
 *   - `jupyter_data`: the minified MIME bundle the web theme reads, so the
 *     site shows the outputs and the cell stays executable.
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

/** mdast for the static writers, and a MIME bundle for the web theme. */
function nodesFor(outputs, insideContainer) {
  // Pairs rather than two arrays: a centred image is three nodes and one
  // bundle, and keeping two indices in step by hand is how they fall apart.
  const pairs = [];
  const add = (node, bundle = null) => pairs.push({ node, bundle });

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
      const bundle = {
        output_type: "display_data",
        data: { "image/png": { content_type: "image/png", path: out.path, hash: out.hash ?? out.path } },
        metadata: {},
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
        add(image, bundle);
      } else {
        add({ type: "raw", tex: `\\begin{${env}}` });
        add(image, bundle);
        add({ type: "raw", tex: `\\end{${env}}` });
      }
    } else if (out.type === "text" && String(out.value ?? "").trim()) {
      add({ type: "code", data: { type: "output" }, value: String(out.value) }, {
        output_type: "stream",
        name: out.stream === "stderr" ? "stderr" : "stdout",
        text: { content_type: "text/plain", content: String(out.value) },
      });
    }
  }
  return pairs;
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
            const pairs = nodesFor(outputs, inContainer);
            if (pairs.length) {
              child.children = pairs.map(({ node, bundle }) => ({
                type: "output",
                children: [node],
                // Only the nodes that stand for an output of their own carry a
                // bundle; the `raw` braces around a centred image are LaTeX
                // punctuation, and the web theme must not try to render them.
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
