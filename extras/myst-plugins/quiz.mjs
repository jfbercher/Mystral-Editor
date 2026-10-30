/**
 * Teach mystmd the editor's `{quiz}`.
 *
 *     :::{quiz} quz quiz7
 *     :::
 *
 * In the editor this is a code-cell dressed as a button: the quiz is a live
 * labquiz widget, drawn by Pyodide into the cell's own output area. None of
 * that can travel to a static site -- the widgets' behaviour lives in the
 * editor, and a snapshot of their HTML would show a quiz that answers nothing.
 *
 * So the site gets the cell rather than its output: the directive becomes an
 * ordinary executable code cell holding `<obj>.show('<key>')`. A site built
 * with a kernel behind it -- thebe, Binder -- runs it and shows the real quiz;
 * one built without shows the line that would produce it. Both are honest,
 * which an inert copy of the widgets would not be.
 *
 * The node is the shape mystmd itself builds for a ```{code-cell}```, checked
 * against `myst build --site` on a document holding both: a `block` of kind
 * `notebook-code` wrapping an executable `code` node and an empty `outputs`.
 * Writing it by hand rather than reaching for a parser means the directive
 * produces what the rest of the pipeline already knows how to carry -- the
 * execution, the theme, `pyodide-outputs.mjs` if it ever has something to put
 * there.
 *
 * The editor's own options are read and dropped: `:button:` and `:dropdown:`
 * describe a control the site does not have. They are declared all the same,
 * because an unknown option is an error that takes the whole directive with
 * it, and a document should not stop building because it says how its button
 * is labelled.
 *
 * To use it, name it in the project's myst.yml:
 *
 *   project:
 *     plugins:
 *       - ./quiz.mjs
 */

/** A quiz's code, from `quz quiz7` or from `quiz7` alone. */
function quizCode(arg) {
  const args = String(arg ?? "").trim().split(/\s+/).filter(Boolean);
  // One argument names the quiz and leaves the instance to its usual name;
  // two name both. The instance is an object the document built in an earlier
  // cell, so it cannot be assumed -- only defaulted.
  const [obj, key] = args.length > 1 ? args : ["quiz", args[0] ?? ""];
  const escaped = String(key).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `${obj}.show('${escaped}')`;
}

const quiz = {
  name: "quiz",
  doc: "A labquiz quiz, as an executable cell.",
  arg: { type: String, required: true, doc: "`<instance> <key>`, or `<key>` alone for an instance named `quiz`." },
  options: {
    button: { type: String, doc: "Editor only: what the button says." },
    dropdown: { type: String, doc: "Editor only: fold the output into a disclosure." },
    label: { type: String },
    caption: { type: String },
  },
  run(data) {
    return [
      {
        type: "block",
        kind: "notebook-code",
        children: [
          { type: "code", lang: "python", executable: true, value: quizCode(data.arg) },
          // Empty, and with an id of its own: this is the receptacle a kernel
          // writes into. Random rather than derived from the quiz, so two
          // calls on the same quiz in one page stay two outputs -- which is
          // how mystmd numbers its own.
          { type: "outputs", id: `quiz-${Math.random().toString(36).slice(2, 11)}`, children: [] },
        ],
      },
    ];
  },
};

const plugin = {
  name: "Mystral Editor — quizzes",
  directives: [quiz],
};

export default plugin;
