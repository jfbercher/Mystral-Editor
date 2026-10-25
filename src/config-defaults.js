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
    // `m` for want of anything better: the initials that would be mnemonic
    // here are all spoken for. Worth knowing if this one ever seems dead: in
    // a browser tab, Firefox keeps Mod-Shift-M for its responsive design view
    // and Chrome for switching profile, so the editor never sees it there.
    // The desktop build has no such claim on it. Mod-Shift-F is the roomiest
    // alternative, being a shortcut of neither; Mod-Shift-J is not, it opens
    // the console in both. This is a setting precisely because that varies.
    modeSlides:  "Mod-Shift-m",
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
    // How much larger than its natural size a figure is rasterised for an
    // export. The figures are SVG, which LaTeX cannot include and which the web
    // theme does not render directly, so they are turned into PNG when a
    // document is exported; 2 keeps them sharp in print without weighing much.
    exportImageScale: 2,

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

  // Slides: the view, the presentation and the export read the same settings,
  // because a deck rehearsed in the editor has to be the deck that is
  // projected. They are posted here as a set rather than added one at a time.
  slides: {
    // Nominal size of a slide, in pixels. The slide is laid out at this size
    // and then optically reduced to fit the panel, so what fits fits at any
    // panel width -- a preview that reflowed to the panel would say a slide
    // overflows when it does not, or the reverse, which is worse than having
    // no preview at all. 1280x720 is 16:9; 1024x768 is 4:3.
    width: 1280,
    height: 720,
    // How big the text of a slide is, in pixels *of the nominal slide*. It is
    // the one setting of this section one actually fiddles with, so it is a
    // plain number rather than a stylesheet to override: a slide is read from
    // the back of a room, and 16px -- a document's size -- is far too small.
    // Everything on a slide is sized in em, so this one value scales headings,
    // lists, maths and code together. It is nominal, so it does not depend on
    // the width of the pane: 28 looks the same in a half-width panel and on
    // the projector. Roughly 15 lines of body text fit at 28, 11 at 36.
    fontSize: 28,
    // The margin inside a slide, as a CSS padding shorthand: one value for
    // all four sides, two for vertical and horizontal, four for top, right,
    // bottom, left. "32px 56px" keeps the sides and gives back a third of the
    // height, which is where a dense slide runs out first -- and it is the
    // space above the header and below the footer as much as around the body,
    // since both sit inside it.
    padding: "48px 56px",
    // A line across the top of every slide, and one across the foot. Empty
    // means none, and an empty header costs no space.
    //
    // The footer is in two parts, so that a page number can sit at the right
    // while something else sits at the left: `footer` is the left, and
    // `footerPage` a template for the right, where `{n}` and `{total}` are
    // replaced -- "Slide {n}/{total}", or just "{n}". Defining a footerPage
    // puts the number in the footer and takes away the small one in the
    // corner, so it cannot appear twice.
    //
    // These are per deck far more often than per installation: a lecture
    // title belongs in the document, not in the application. The frontmatter
    // takes the same keys.
    header: "",
    footer: "",
    footerPage: "",
    // CSS declarations, applied to the header and footer as they stand --
    // "font-size: 18px; color: #888; border-bottom: 1px solid #ddd". The
    // browser parses them and drops what it does not understand, and they
    // cannot reach anything but the element they are given to.
    headerStyle: "",
    footerStyle: "",
    // The slide's own background, as any CSS colour. Empty follows the theme.
    background: "",
    // Where the content of a slide sits in its box: "top" or "center".
    // Centring suits a deck of short slides; a lecture whose slides are uneven
    // reads better flush to the top, where the titles line up from one slide
    // to the next instead of drifting up and down.
    verticalAlign: "top",
    // How big the code of a cell is on a slide, in pixels of the nominal
    // slide, like fontSize.
    //
    // A separate setting because code cells cannot follow the prose: their
    // stylesheet is written in rem, which is rooted at the document and not
    // at the slide, so raising fontSize left them exactly as small as they
    // are in an ordinary preview -- and code is the one thing on a slide that
    // has to be readable from the back of the room. Smaller than the prose by
    // default, because a cell carries more characters per line and because
    // code read aloud is usually being pointed at rather than read.
    cellFontSize: 18,
    // Also start a slide at every heading of this level or above, which makes
    // a document that was never written as a deck presentable without touching
    // it. 0 means only the explicit `---` markers cut.
    cutAtHeading: 0,
    // How one slide gives way to the next, while presenting:
    //
    //   none       the next slide is simply there
    //   fade       it appears
    //   slide      it comes in from the side the deck is moving towards
    //   slideUp    the same, vertically
    //   zoom       it grows the last few per cent into place
    //
    // Which spelling cuts a slide: "both", "plus" or "dash".
    //
    // The point of choosing is what it leaves free. Under "plus" only `+++`
    // cuts, so `---` goes back to being the horizontal rule it looks like.
    // Under "dash" only `---` cuts, which is what a document converted from a
    // notebook wants -- its `+++` lines are cell boundaries nobody asked to
    // see as sixty slides. "both" accepts either, and is the default because
    // it is what was there before this setting existed.
    //
    // It governs slide cuts only. `----` and `++++` are always fragments: a
    // four-dash rule is an odd thing to write on purpose, where a three-dash
    // one is not. `***` and `___` are horizontal rules under every setting.
    marker: "both",
    // A duration may follow on the same line -- "fade 700ms", "slideUp 1.2s",
    // or a bare number read as milliseconds -- because it is not a separate
    // decision: one does not choose a transition and then, elsewhere, how
    // long it lasts. Without one, 450ms.
    //
    // Deliberately few: a transition is there to say "that was a slide, here
    // is another", and past that it becomes a thing the room watches instead
    // of listening to you.
    transition: "slide",
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
    // Produce a PDF by exporting LaTeX, post-processing it, then running the
    // LaTeX chain here. `myst build --pdf` goes from Markdown to PDF through a
    // .tex the editor never sees, so the styled boxes, the restored proof
    // labels and the injected \label{} could not reach the PDF any other way.
    // The cost is that the document must declare a "tex" export rather than a
    // "pdf" one -- the editor offers to add it -- and that the LaTeX chain
    // below has to be installed. Set to false to let mystmd build the PDF
    // itself, unstyled.
    pdfViaTex: true,
    // The command run on the .tex to produce the PDF, with {file} replaced by
    // the file name. The default is the one jtex uses, so a document that
    // built under mystmd builds here the same way.
    // {engine} is the engine the template asks for in its template.yml, as jtex
    // reads it, and -xelatex when it asks for none -- jtex's own default.
    pdfCommand: 'latexmk -f {engine} -synctex=1 -interaction=batchmode -file-line-error -latexoption="-shell-escape" {file}',
    // Full path of the program pdfCommand names. Same blind spot as nodePath:
    // a desktop application does not inherit a terminal's PATH, so latexmk is
    // found in development and missing from a bundled build -- and a command
    // that never ran writes no .log, so there is nothing to read afterwards
    // either. Leave this empty and the editor looks where TeX distributions
    // install -- MacTeX, MacPorts, Homebrew, TeX Live, the distribution's own
    // packages -- then records what it found here. The directory is put at the
    // head of the PATH rather than substituted into the command, because
    // latexmk runs xelatex and kpsewhich by name and they are its neighbours.
    latexPath: "",
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
    // Port of myst's *content* server, which is not the one the site is read
    // on: `myst start` runs two servers. Named explicitly so that stopping the
    // site knows which ports to free; left to drift it climbed by one at each
    // run. Defaults to sitePort + 100, which is myst's own convention.
    siteContentPort: 3100,
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

