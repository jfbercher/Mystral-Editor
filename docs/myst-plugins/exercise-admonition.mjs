/**
 * Make `{exercise}` and `{solution}` survive a LaTeX, PDF or Word export.
 *
 * `myst-ext-exercise` produces `exercise` and `solution` nodes, and no static
 * writer knows them: `myst-to-tex` reports "Unhandled LaTeX conversion" and
 * drops them, so the exercise disappears while the reference to it stays,
 * leaving `??` in the PDF. Turning them into admonitions -- which every writer
 * does know -- is enough to bring them back.
 *
 * Why `stage: 'project'`. In myst-cli, document-stage transforms run before
 * enumeration and before `resolveReferencesTransform`; project-stage ones run
 * after both. Converting at document stage would therefore change the node
 * kind before the references were written, and the document would read
 * "Note 1" where it should read "Exercise 1". At project stage the numbers and
 * the reference texts are already settled, and the conversion cannot disturb
 * them.
 *
 * To use it, name it in the project's myst.yml:
 *
 *   project:
 *     plugins:
 *       - ./exercise-admonition.mjs
 */

/** Plain text of an mdast subtree, for reusing a title already built. */
function textOf(node) {
  if (!node) return "";
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(textOf).join("");
}

const WORD = { exercise: "Exercise", solution: "Solution" };

function convert(node) {
  const word = WORD[node.type];
  const existing = node.children?.[0]?.type === "admonitionTitle" ? node.children[0] : null;

  let title;
  if (node.type === "solution") {
    // myst-ext-exercise already builds "Solution to <reference>", and the
    // reference has been resolved by now: keep it as it is.
    title = existing ?? { type: "admonitionTitle", children: [{ type: "text", value: word }] };
  } else {
    const head = node.enumerator ? `${word} ${node.enumerator}` : word;
    const own = existing ? textOf(existing).trim() : "";
    // Same shape as the editor's preview: "Exercise 3 (My title)".
    title = { type: "admonitionTitle", children: [{ type: "text", value: own ? `${head} (${own})` : head }] };
  }

  const body = existing ? node.children.slice(1) : (node.children ?? []);
  node.type = "admonition";
  // A kind the web theme knows, so the site keeps a sensible box. The colour
  // of the LaTeX box comes from the directive name in the source, not from
  // here, so `exercise` and `solution` can be coloured on their own.
  node.kind = "note";
  node.children = [title, ...body];
}

const exerciseAdmonition = {
  name: "Exercises and solutions as admonitions",
  stage: "project",
  plugin: () => (tree) => {
    const walk = (node) => {
      for (const child of node.children ?? []) walk(child);
      if (node.type === "exercise" || node.type === "solution") convert(node);
    };
    walk(tree);
    return tree;
  },
};

const plugin = { name: "Mystral Editor — exercises", transforms: [exerciseAdmonition] };
export default plugin;
