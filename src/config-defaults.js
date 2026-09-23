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

  // Proof family
  proof:      { kind: "proof",     label: "Proof",      numbered: true,  caption: "arg" },
  theorem:    { kind: "theorem",   label: "Theorem",    numbered: true,  caption: "arg" },
  lemma:      { kind: "theorem",   label: "Lemma",      numbered: true,  caption: "arg" },
  corollary:  { kind: "theorem",   label: "Corollary",  numbered: true,  caption: "arg" },
  definition: { kind: "definition",label: "Definition", numbered: true,  caption: "arg" },
  example:    { kind: "example",   label: "Example",    numbered: true,  caption: "arg" },
  remark:     { kind: "remark",    label: "Remark",     numbered: true,  caption: "arg" },
  algorithm:  { kind: "algorithm", label: "Algorithm",  numbered: true,  caption: "arg" },

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

  recentFilesMax:  10,
  defaultFileName: "Untitled.md",

  fallbackImage:
    "https://upload.wikimedia.org/wikipedia/commons/a/a3/Image-not-found.png",

  shortcuts: {
    save:   "Mod-Shift-s",
    open:   "Mod-Shift-o",
    newTab: "Mod-Shift-e",
  },

  pyodide: {
    // false = notebook behaviour: CWD persists across cells (option B)
    // true  = resets os.chdir("/local") before each cell  (option A)
    resetCwdOnRun: false,
  },

  // Tauri-only export menu (myst build / myst start).
  export: {
    // Command used to invoke mystmd. It is run through a login shell, so the
    // plain name works as long as it is on the PATH of your shell profile;
    // set an absolute path here if it is installed somewhere unusual.
    mystPath: "myst",
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
