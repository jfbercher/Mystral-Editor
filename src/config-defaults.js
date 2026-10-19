/**
 * The proof family, as `name: [kind, label]`.
 *
 * The fifteen kinds mystmd knows, so that a document written here exports
 * without rewriting. The `kind` is what carries the numbering, and the
 * topology is mystmd's own LaTeX preamble: each statement counts on its own,
 * `lemma` alone sharing the theorem counter (`\newtheorem{lemma}[theorem]`).
 * Two statements can be put back on one sequence by giving them the same kind
 * here -- that is the whole of it.
 *
 * One difference with the PDF remains: LaTeX resets most of these counters at
 * every section (`[section]`), which numbers them 2.1, 2.2, while the numbers
 * here run through the document. See BACKLOG.md.
 */
export const PROOF_FAMILY = {
  proof:       ["proof",       "Proof"],
  theorem:     ["theorem",     "Theorem"],
  lemma:       ["theorem",     "Lemma"],
  corollary:   ["corollary",   "Corollary"],
  proposition: ["proposition", "Proposition"],
  property:    ["property",    "Property"],
  axiom:       ["axiom",       "Axiom"],
  conjecture:  ["conjecture",  "Conjecture"],
  observation: ["observation", "Observation"],
  criterion:   ["criterion",   "Criterion"],
  assumption:  ["assumption",  "Assumption"],
  definition:  ["definition",  "Definition"],
  example:     ["example",     "Example"],
  remark:      ["remark",      "Remark"],
  algorithm:   ["algorithm",   "Algorithm"],
};

/**
 * Each of them under its bare name and under the two prefixes mystmd answers
 * to. `fmKey` keeps the frontmatter numbering keys unprefixed, so one
 * `theorem:` setting governs the three spellings.
 */
const proofFamilyEntries = Object.entries(PROOF_FAMILY).flatMap(([name, [kind, label]]) => {
  const spec = { kind, label, numbered: true, caption: "arg" };
  return [
    [name, spec],
    [`proof:${name}`, { ...spec, fmKey: name }],
    [`prf:${name}`, { ...spec, fmKey: name }],
  ];
});

/**
 * Built-in directive definitions used by the labelling/numbering system.
 * These can be extended or overridden via the `data_directives` key in config.json.
 */
export const BUILTIN_DIRECTIVES = {
  // Media
  figure:       { kind: "fig",       label: "Figure",    numbered: true,  caption: "body" },
  "figure-md":  { kind: "fig",       label: "Figure",    numbered: true,  caption: "body", argIsLabel: true },
  image:        { kind: "fig",       label: "Image",     numbered: false },
  table:        { kind: "table",     label: "Table",     numbered: true,  caption: "both" },
  "list-table": { kind: "table",     label: "Table",     numbered: true,  caption: "both" },
  "csv-table":  { kind: "table",     label: "Table",     numbered: true,  caption: "both" },

  // Math
  math:         { kind: "eq",        label: "Equation",  numbered: true },

  // Exercises — mystmd / sphinx-exercise model
  exercise:         { kind: "exercise",  label: "Exercise", numbered: true,  caption: "arg" },
  solution:         { kind: "solution",  label: "Solution", numbered: false, caption: "arg", reference: true },
  // "Gated" syntax: two independent fences wrapping root content
  "exercise-start": { kind: "exercise",  label: "Exercise", numbered: true,  caption: "arg" },
  "exercise-end":   { kind: null },
  "solution-start": { kind: "solution",  label: "Solution", numbered: false, caption: "arg", reference: true },
  "solution-end":   { kind: null },

  // Proof family: bare names and the `proof:` / `prf:` spellings.
  ...Object.fromEntries(proofFamilyEntries),

  // Admonitions: referenceable but not numbered
  admonition: { kind: "adm", label: "Admonition", numbered: false, caption: "arg" },
  attention:  { kind: "adm", label: "Attention",  numbered: false, caption: "arg" },
  caution:    { kind: "adm", label: "Caution",    numbered: false, caption: "arg" },
  danger:     { kind: "adm", label: "Danger",     numbered: false, caption: "arg" },
  error:      { kind: "adm", label: "Error",      numbered: false, caption: "arg" },
  hint:       { kind: "adm", label: "Hint",       numbered: false, caption: "arg" },
  important:  { kind: "adm", label: "Important",  numbered: false, caption: "arg" },
  note:       { kind: "note",label: "Note",       numbered: true,  caption: "arg" },
  seealso:    { kind: "adm", label: "See also",   numbered: false, caption: "arg" },
  tip:        { kind: "adm", label: "Tip",        numbered: false, caption: "arg" },
  warning:    { kind: "adm", label: "Warning",    numbered: true,  caption: "arg" },
};

/**
 * Default configuration values.
 * These are the baseline settings before any user config.json is applied.
 */
export const DEFAULT_CONFIG = {
  suspendAfterMs:    60 * 60 * 1000,  // 1 hour
  checkIntervalMs:    5 * 60 * 1000,  // 5 minutes
  autoSaveEnabled:   true,
  autosaveIntervalMs: 60 * 1000,      // 1 minute

  editorMode: "Both",

  // How a document opens for a reader who has never said otherwise. As soon as
  // one folds or unfolds a frontmatter, that choice is remembered and outranks
  // this setting, exactly as the view mode remembers the last button pressed.
  foldFrontmatterOnOpen: true,

  recentFilesMax:  10,
  defaultFileName: "Untitled.md",

  fallbackImage:
    "https://upload.wikimedia.org/wikipedia/commons/a/a3/Image-not-found.png",

  shortcuts: {
    save:   "Mod-Shift-s",
    open:   "Mod-Shift-o",
    newTab: "Mod-Shift-e",
    // Switch the view. `l` rather than the `i` of "inline": Ctrl-Shift-I
    // opens the developer tools on Windows and Linux, in the webview as in a
    // browser, so the editor never sees it there. One binding that works on
    // the three platforms is worth more than a mnemonic that works on one --
    // and it keeps config.json portable between them. Firefox also keeps
    // Ctrl-Shift-P (private window) for itself, which is one of the reasons
    // these are configurable.
    modeDual:    "Mod-Shift-d",
    modePreview: "Mod-Shift-p",
    modeInline:  "Mod-Shift-l",
  },

  pyodide: {
    // false = notebook behaviour: CWD persists across cells (option B)
    // true  = resets os.chdir("/local") before each cell  (option A)
    resetCwdOnRun: false,

    // Default width of the matplotlib figures a cell produces, as a CSS length:
    // "60%" of the output area, "20em", "480px". Empty means the figure keeps
    // its natural size, bounded by the width of the cell. A cell overrides it
    // with its own :figwidth: option.
    figureWidth: "",

    // Keyboard shortcuts of a code-cell editor, in CodeMirror notation:
    // "Mod" is Cmd on macOS and Ctrl elsewhere, then Shift / Alt / Ctrl, and
    // a key name ("Enter", "ArrowUp", "k"). An empty string means no shortcut;
    // a binding that CodeMirror does not understand is reported in the console
    // and ignored, so a typo costs a shortcut rather than the whole cell.
    // They apply inside a cell editor only, and win over the editor's own
    // bindings, so rebinding one to a key the editor already uses (for
    // instance "Mod-s") shadows it while the cursor is in a cell.
    keys: {
      run:         "Shift-Enter",       // run this cell
      insertBelow: "Mod-Shift-Enter",   // insert an empty cell below
      inspect:     "Alt-v",             // open the variable window
      clear:       "",                  // clear this cell's output
      runAll:      "",                  // run every cell of the document
      clearAll:    "",                  // clear every output
      restart:     "",                  // restart the kernel (clears variables)
      deleteCell:  "",                  // delete this cell
      editSource:  "",                  // inline preview: edit this cell's source
    },
  },

  // Tauri-only export menu (myst build / myst start).
  export: {
    // Command used to invoke mystmd. It is run through a login shell, so the
    // plain name works as long as it is on the PATH of your shell profile;
    // set an absolute path here if it is installed somewhere unusual.
    mystPath: "myst",
    // Interpreter myst must run under. mystmd is a node script whose shebang
    // resolves `node` through the PATH, and the PATH of a login shell is not
    // the one your terminal shows: leave this empty and the editor looks for
    // the newest node it can find the first time myst reports none, then
    // records it here.
    nodePath: "",
    // Rewrite the .tex produced by a LaTeX export: admonitions become coloured
    // boxes carrying their kind and their label, proof labels mangled by
    // mystmd are put back as typed, and closing environments get a blank line
    // after them. The rewrite only happens when the source and the .tex can be
    // matched beyond doubt; otherwise the file is left exactly as mystmd wrote
    // it and the reason is reported.
    postProcessTex: true,
    // Colour of each admonition kind in a LaTeX or PDF export, as an RRGGBB
    // hex string without the leading "#". mystmd draws every admonition as the
    // same grey box, losing the kind the author chose; the export rewrites
    // them as coloured boxes using this table. The frame takes the colour and
    // the background a 6% tint of it. A kind absent from the table is drawn
    // like "plain", which is also what a generic {admonition} with no title
    // gets. Deliberately sober: a box that shouts on paper is a box the reader
    // stops seeing.
    admonitionColors: {
      attention: "B5762A",
      caution: "B5762A",
      danger: "B3261E",
      error: "B3261E",
      hint: "2E7D52",
      important: "7B4FA8",
      note: "4A6FA5",
      seealso: "4A6FA5",
      tip: "2E7D52",
      warning: "C8800F",
      // Not admonition kinds: `{exercise}` and `{solution}`, which a plugin
      // turns into admonitions so that they survive a static export.
      exercise: "1F6F8B",
      solution: "4F7942",
      plain: "666666",
      // Not a box: the colour of a hyperlink inside a box's title bar. A
      // solution's title carries a live reference to its exercise, and
      // hyperref's default red is unreadable on a coloured bar.
      titleLink: "CFE8FF",
    },
    // Port used by "myst start" for the local site preview.
    sitePort: 3000,
    // Template written into the exports frontmatter when the editor creates the
    // entry, per format. Empty means no `template:` line at all, which is what
    // myst itself defaults to -- there is no built-in template for any format.
    // Example: { "pdf": "arxiv_nips", "docx": "curvenote" }
    templates: {
      pdf: "",
      docx: "",
      tex: "",
    },
  },
};

