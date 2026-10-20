---
title: Additions
extends: mdocs_fm.yml
---

This document lists every file that exists in ``Mystral Editor'' but not in the upstream `antmicro/myst-editor` repository, based on `git diff --name-status upstream/main...HEAD` (merge-base comparison, so it reflects only what this fork introduced, ignoring unrelated upstream-only changes since the fork point).

State: commit `ce49491`, 2026-10-20. Regenerate the inventory with `git diff --name-status upstream/main...HEAD` and compare it against the lists below.

## Desktop app (Tauri) scaffolding

- `.github/workflows/release.yaml` — GitHub Actions workflow that builds and publishes cross-platform Tauri desktop app releases (macOS Apple Silicon/Intel, Linux x64/ARM64, Windows) triggered by `v*` tags, using `tauri-apps/tauri-action` and code-signing/updater secrets.
- `.npmrc` — npm configuration setting `allow-git=all`, permitting npm to install packages from git dependencies.
- `Makefile` — Defines a `release` target that bumps the version string in `src-tauri/Cargo.toml` and `tauri.conf.json`, commits, tags, and pushes a new release version.
- `src-tauri/.gitignore` — Git ignore rules for the Tauri Rust backend, excluding the `target/` build directory and generated `gen/schemas`.
- `src-tauri/Cargo.lock` — Rust dependency lockfile pinning exact versions for the Tauri backend build (`app_lib` crate and its Tauri plugins).
- `src-tauri/Cargo.toml` — Rust package manifest for the Tauri desktop app "Mystral Editor", declaring the `app_lib` crate and dependencies (Tauri core plus plugins for logging, filesystem, dialogs, shell, opener, single-instance, updater, and process control).
- `src-tauri/Info.plist` — macOS bundle property list registering the app as the default editor/handler for `.myst`, `.md`, `.markdown`, and `.txt` files.
- `src-tauri/build.rs` — Cargo build script that invokes `tauri_build::build()` to run Tauri's standard build-time codegen.
- `src-tauri/capabilities/default.json` — Tauri v2 permissions/capabilities manifest granting the main window access to window control, updater, process restart, dialogs, shell/opener, webview zoom, and filesystem read/write/exists under the user's home directory.
- `src-tauri/tauri.conf.json` — Main Tauri configuration: app metadata ("Mystral Editor" v0.9.0), dev/build commands, window size, auto-updater endpoint/pubkey pointing at the `jfbercher/Mystral-Editor` GitHub releases, bundle icons, and file associations for markdown/myst files.
- `src-tauri/src/lib.rs` — Core Rust entry point for the Tauri app: sets up the single-instance plugin, tracks a "pending file" (opened via CLI arg or macOS "Open With"/file-association events) exposed to the frontend via the `get_pending_file` command, and registers the app's plugins (updater, dialog, fs, process, shell, opener, logging).
- `src-tauri/src/google_auth.rs` — Native Google OAuth 2.0 sign-in for the desktop build, exposed as the `google_login` command. Google refuses OAuth from embedded webviews, so inside WKWebView the Google Identity Services button answers 403, One Tap reports `browser_not_supported` and the popup is blocked, whatever the origin or CSP. This module implements the flow Google supports for an installed application: it opens the *system* browser, listens on `http://127.0.0.1:<ephemeral port>` for the redirect, verifies the `state`, and exchanges the authorization code with PKCE, returning the `id_token`. Objective: let the quiz/authentication features work in the packaged app, where the browser-based flow cannot.
- `src-tauri/src/main.rs` — Tauri binary entry point; suppresses the Windows console window in release builds and calls into `app_lib::run()`.
- `src-tauri/icons/**` — Full icon set (multiple PNG resolutions, `.icns` for macOS, `.ico` for Windows, an `icon.iconset` folder, and an `ios/` folder with iOS-specific sizes) used by Tauri to build the desktop and mobile app bundles' icons.

**Stray/cruft files worth cleaning up** (accidental leftovers, not intentional source files):

- `complete_diff_of_modified_and_added_files_in_fork.txt`, `modified_and_added_files_in_fork.txt` — Generated scratch diff dumps produced by `diffs_in_fork.sh`; dev artifacts, not meant to be tracked long-term.
- `Makefile.old`, `test.md`, `docs/mdocs_fm.yml~`, `docs/myst.yml.sav`, `docs/myst copy.yml`, `docs/test-code-cell.md` — Backups and scratch files committed by accident.
- `docs/customisation-presentation.md`, `docs/desktop-apps.md`, `docs/document.md`, `docs/document-organisation.md`, `docs/executable-code.md`, `docs/overview-and-heritage.md`, `docs/table-of-differences.md`, `docs/theming.md` — Earlier drafts of pages that now exist under another name; none is in the table of contents of `docs/myst.yml`, so none is built.

## Root-level scripts, docs, and misc

- `install_fork.md` — Short install instructions for this fork, listing extra npm dependencies to install (katex, markdown-it-texmath, js-yaml, CodeMirror Python support) before running `npm i && npm run build`.
- `myst_editor.sh` — macOS launcher script that starts `npm run dev`, opens the app in a dedicated Brave Browser app window (optionally to a file path argument), and shuts the dev server down once that window closes.
- `myst_editor_dist.sh` — Same launcher pattern as `myst_editor.sh` but runs the built distribution via `node server.mjs` instead of the Vite dev server.
- `run_myst_editor.sh` — Simpler launcher variant (no file-path argument support).
- `server.mjs` — Minimal Node.js static file server for the built `dist/` app (SPA fallback), also exposing `/api/file` GET/POST endpoints to read and write local files, used when running the packaged/distributed build outside Tauri.
- `.readthedocs.yaml` — Read the Docs build configuration for the documentation site.
- `diffs_in_fork.sh` — Dev utility script that dumps the file-status list and full diff between `upstream/main` and `main` into text files for review.
- `vite-file-plugin.js` — Vite dev-server plugin registering the same `/api/file` middleware as `server.mjs`, for use during `npm run dev`.
- `assets/Image-not-found.png` — A placeholder "image not found" PNG, duplicated at the repo root outside the `src/public` tree actually used by the running app.

## Public runtime assets/config

- `src/public/assets/image-not-found.png` — The runtime copy of the "image not found" placeholder PNG served with the app, referenced by `src/public/config.json`'s `fallbackImage` setting.
- `src/public/config.json` — Runtime configuration for the desktop app: autosave/suspend/check intervals, recent-files limit, default filename, fallback image path, keyboard shortcuts (save/open/new tab), the `pyodide` section (whether the working directory is reset before each cell, and the code-cell key bindings under `pyodide.keys`), the Tauri-only `export` section, and a table of MyST directive definitions (figure, table, math, exercise, theorem, admonition, etc.) mapping directive names to numbering/caption/label behavior.
- `src/public/custom.css` — User-customizable CSS overrides scoped to `#myst-css-namespace`, styling emphasis/strong/heading colors via CSS variables.
- `src/public/newFileTemplate` — Template/sample MyST markdown document (frontmatter, bibliography, math macros) used as the starting content for new files, demonstrating cross-references, equations, footnotes, citations, and figures.

## Core app/runtime modules

- `src/app.js` — Application bootstrap for the desktop (Tauri) build: exposes `checkForUpdates` (checks/downloads/installs app updates via Tauri's updater plugin) and `initApp`, which loads config, initializes zoom and external-link handling, creates and initializes a `TabManager`, and wires Tauri window focus/`open-file` events and startup file handling.
- `src/config.js` — Defines the app-wide runtime `config` (autosave/suspend intervals, shortcuts, fallback image, etc.) and a built-in table of MyST directive metadata (`BUILTIN_DIRECTIVES`); `loadConfig`/`configReady` asynchronously fetch `config.json` and an optional `custom.css` to merge/override these defaults.
- `src/editor_factory.js` — Builds and mounts a `MystEditor` instance for a given tab: assembles the custom toolbar buttons (theme toggle, open/new/save/save-as/backup/autosave/stats), injects the fork's additional stylesheets, wires collaboration/room settings, keyboard shortcuts, image URL resolution (Tauri vs Web), and the `onReady` lifecycle that loads the file, comments, bibliography, and theme on startup.
- `src/tab_manager.js` — `TabManager` class implementing the multi-document-tab UI: creates/activates/closes tabs, persists and restores tab order and the active tab, lazily mounts/suspends editor instances for inactive tabs after a timeout, tracks dirty state, and opens files (including from Tauri file-open events) into new or existing tabs.

## New CodeMirror extensions

- `src/extensions/lezerMarkdownExtensions.js` — Implements `colonFencedCodeParser`, a lezer-markdown `BlockParser` that handles `:::` (triple-colon) fenced blocks, generating the same `FencedCode` AST nodes (with `CodeInfo` and `CodeMark` children) as backtick fences. This enables `:::{directive} arg` MyST syntax — including `:::{code-cell}`, `:::{toc}`, `:::{figure}`, etc. — to be parsed and syntax-highlighted in the main CodeMirror editor. Also exports `tableParser` extending lezer-markdown with GFM-style table support.

- `src/extensions/pythonHighlightStyle.js` — Defines and exports `pythonHighlightStyle`, a CodeMirror 6 `HighlightStyle` that maps lezer-python AST tags to `--tok-*` CSS custom properties (e.g. `tags.keyword` → `var(--tok-keyword)`, `tags.definition(variableName)` → `var(--tok-function)`). Using CSS variables instead of literal color values makes all Python syntax coloring automatically theme-responsive. Shared by `codeBlockLanguages.js` (detached sub-editors) and `pyodideRunner.js` (Pyodide cell editors).

- `src/extensions/codeBlockLanguages.js` — Registers per-language CodeMirror sub-modes for fenced code blocks. Imports the shared `pythonHighlightStyle` and composes it with `@codemirror/lang-python` into a single extension set registered under both the `python` and `code-cell` keys, so that backtick-fenced ` ```python ` blocks and colon-fenced `:::{code-cell}` blocks both receive Python syntax highlighting and language intelligence in the detached sub-editors.
- `src/extensions/frontmatterFold.js` — A CodeMirror `foldService` that lets the user fold the YAML frontmatter block by detecting its extent with `extractFrontmatter`.
- `src/extensions/mystComments.js` — Implements MyST-style line comments (`%` at column 0): exports `toggleMystComment` (a CodeMirror command) and `mystComments()`, a keymap binding `Mod-/`, `Mod-:` (AZERTY), and `Mod-Shift-/`.
- `src/extensions/mystCompletions.js` — Implements the MyST-aware autocompletion source for CodeMirror: snippet completions for roles (`{ref}`, `{eq}`, etc.) and directives, cross-reference targets, and bibliography-key citations.
- `src/extensions/proofLabelCase.js` — Underlines a `:label:` / `:name:` of the proof family that is not all lowercase. A workaround for a bug in `myst-to-tex`, whose proof handler is the only one to write its anchor with the normalised (lowercased) identifier while every cross-reference writes the label as typed, so an exported PDF resolves neither and shows `??`. Exports `findUppercaseProofLabels`, a line scan with fence tracking so that a directive shown inside a code block is not reported, plus the `proofLabelCase` view plugin and its theme. To be removed when the bug is fixed upstream.
- `src/extensions/orphanFence.js` — Marks the colon fences that do not pair up: one that closes nothing, and one that opens a block never closed. Both are the symptom of a nesting written with equal fence lengths, where the inner directive's closing `:::` ends the outer block and the document is silently mis-structured. Exports `scanFences` / `findUnbalancedFences`, a line-by-line scan following CommonMark's rule — once a block is open, only a line that closes it means anything — so it does not depend on the shape the leftover fence happens to take in the syntax tree, and can be tested on its own. Also exports the `orphanFence` view plugin and its theme, which uses `--fence-error-bg` / `--fence-error-fg`.

## New markdown-processing modules

- `src/markdown/bibliography.js` — Loads and parses a BibTeX (`.bib`) file per editor tab (Tauri filesystem or Web File System Access API), and provides markdown-it plugins to render `[@key]` citation groups and a `[bibliography]` marker into a formatted reference list, including a `Cite` role, numeric/author-year citation styles, and hover-preview metadata.
- `src/markdown/frontmatterUtils.js` — `extractFrontmatter(fullText)` parses the leading YAML frontmatter block using `js-yaml` and returns the parsed object plus the line number where it ends.
- `src/markdown/markdownFootnotes.js` — Pre-scans a document for footnote definitions/references, numbers them by first-reference order, and provides markdown-it plugins to render inline footnote markers (with backrefs and hover preview) and the generated footnotes section.
- `src/markdown/markdownHeadings.js` — A markdown-it core-rule plugin that assigns anchor IDs to headings from resolved section labels, strips `(label)=` marker paragraphs once consumed, and injects heading numbers into rendered heading tokens.
- `src/markdown/markdownMath.js` — Sets up KaTeX/`markdown-it-texmath` math rendering per editor (with per-editor macro maps), computes numbering/label configuration for numbered targets (equations, figures, tables, sections), renders `@label` auto-references and numbered equation blocks, and resolves `[](#label)`/`{ref}`/`{eq}`/`{numref}` link text and placeholders.
- `src/markdown/markdownInclude.js` — Implements the `{include}` (and `literalinclude`) directive: pulls another file into the document, parsed as MyST by default or shown as a code block with `:literal:`/`:lang:`. Reading a file is asynchronous while markdown-it renders synchronously, so it uses the same pattern as the `{eval}` role — a cache that renders a placeholder on a miss and triggers a re-render when the content arrives. Supports the selection options `:lines:`, `:start-line:`, `:end-line:`, `:start-at:`, `:start-after:`, `:end-at:`, `:end-before:`, plus `:caption:`, `:filename:`, `:label:` and `:class:`. Guards against a file that includes itself. Left aside for now, with a console warning when used: `:linenos:`, `:lineno-start:`, `:number-lines:`, `:lineno-match:` and `:emphasize-lines:`. The frontmatter of an included file is stripped and ignored -- mystmd promotes its math macros and abbreviations, which is not done here. Everything else inside an included file does reach the document: `includeExpansion.js` expands the inclusions before the scanners walk the text, so its headings, labels and numbers are the document's own. [include](include.md) documents the behaviour and its limits.
- `src/markdown/includeExpansion.js` — Builds the text the scanners walk: the document with its `{include}` blocks replaced by the content they pull in, so that labels, numbering and the heading tree see the document as the reader does. Included lines are given virtual line numbers allocated past the end of the document, a key the scanners and the renderer agree on and that addresses nothing in the editor. Also holds the content-selection helpers (`stripFrontmatter`, `selectLines`) shared with the directive, so the scan and the renderer prepare an included file identically.
- `src/markdown/varInspectorUi.js` — The "Vars" window of a code cell: one row per variable of the document's namespace with its type, memory footprint, shape and a short `repr`, sortable and filterable, with per-row deletion and an optional unloading of modules from `sys.modules`. Its column set and its size heuristics follow the Jupyter varInspector nbextension.
- `src/markdown/markdownFence.js` — Replaces markdown-it's `fence` block rule (`colonFencedBlocks`) so that a run of colons opens a fenced block as backticks and tildes do, which is what lets MyST's `:::{directive}` form be written and nested.
- `src/markdown/markdownLinks.js` — `checkLinks`: a link whose target begins with `(` is not a link. It is rendered back as the literal text the author typed, `[label](...)`, instead of becoming an anchor to a nonsensical address — the case that arises when a MyST target `(name)=` is followed by something markdown-it reads as a link.
- `src/styles/pyodide-cells.css` — The whole appearance of a code cell, injected into the editor's shadow root as an adopted stylesheet rather than into `document.head`: document styles do not cross a shadow boundary, so a sheet placed outside it has no effect on the cells at all.
- `src/public/linkedtemplatelist.json` — The list read by the Templates menu (`templatelist` in `editor_factory.js`): a name, an id and the URL of the document to fetch for each entry.
- `src/markdown/markdownRefLinks.js` — Adds support for Markdown reference-style links (`[text][ref]`, `[ref]`) with a global scan collecting `[label]: url "title"` definitions, plus markdown-it plugins to skip the definition lines and resolve reference-style link usages.
- `src/markdown/markdownTitledAdmonitions.js` — Extends `markdown-it-docutils`' admonition directive classes to accept an optional title argument, and adds an `open` flag option so admonitions can render pre-expanded/collapsible.
- `src/markdown/markdownPyodide.js` — markdown-it plugin that activates Pyodide-powered executable code cells in the preview. It intercepts both backtick-fenced ` ```{code-cell} ` blocks (processed as a fence rule) and `.code-cell-host` placeholder divs emitted by `CodeCellDirective`, installs a `MutationObserver` on the preview container that fires `initCodeCell()` whenever a new placeholder appears, and handles widget eviction and reuse across incremental re-renders so that cell state (user edits, outputs) survives paragraph re-renders of adjacent content.

- `src/markdown/pyodideRunner.js` — Initializes and manages the Pyodide WebAssembly runtime and the individual executable Python cell widgets. Loads Pyodide lazily on first execution (with a loading overlay), wraps each cell in a CodeMirror 6 editor configured with `pythonHighlightStyle`, runs code asynchronously via Pyodide and displays stdout/return-value/error output below the editor, supports `micropip.install()` for extra packages declared in the `{code-cell}` `:packages:` option, and exposes a `cellCache` for widget reuse. The cell UI adapts to light/dark mode through the `--color-background-*` and `--tok-*` CSS variables.

- `src/markdown/scanTargets.js` — Core cross-reference scanner: walks the raw markdown source to find and number all "targetable" directives (figures, tables, equations, exercises, theorems, etc.) and standalone math blocks, building `byLine`/`byLabel` maps used for cross-references; also folds in section (heading) labels.
- `src/markdown/scanProofLabels.js` — Pure line scan finding the `:label:` / `:name:` of a proof-family directive that is not all lowercase, with fence tracking so that a directive shown inside a code block is not reported. Extracted from `proofLabelCase.js` so that the editor's underlining and the LaTeX post-processing look for the same thing: one decorates what it finds, the other repairs it in the exported `.tex`.

## New utility modules

- `src/utils/commentsStorage.js` — Persists and retrieves collaborative-comment state (Yjs `ycomments` encoded state) per file path in IndexedDB (via `idb-keyval`).
- `src/utils/headingNumbering.js` — Numbers a heading tree, scans the raw text for `(label)=` lines preceding a heading, and flattens numbered headings into a line-number map used to sync headings with source lines.
- `src/utils/local_utils.js` — Barrel module defining `isTauri()` and re-exporting the `local_utils/theme.js`, `fs.js`, `stats.js`, `tab_state.js`, and `zoom.js` submodules as a single namespace.
- `src/utils/local_utils/fs.js` — Filesystem/storage abstraction bridging Web (File System Access API/IndexedDB) and Tauri (native FS): working/image directory selection, tab-order and file-handle persistence, image path resolution, recent-files tracking, and load/save/backup operations.
- `src/utils/local_utils/stats.js` — Computes document statistics (heading/paragraph/word/line/character counts) from the markdown-it token stream and shows them in a modal popup.
- `src/utils/local_utils/tab_state.js` — `createTabState(...)` builds the per-tab state object/API used by `TabManager` and the editor: tracks file handle/name/dirty flag, drives comments load/save, and implements open/save/save-as/backup/autosave/smart-save logic across Web and Tauri backends.
- `src/utils/local_utils/theme.js` — Manages light/dark theme application across the main document and each editor's Shadow DOM, applies optional user custom CSS, and injects custom CodeMirror syntax-highlighting colors. On every theme switch the function also sets a `data-theme` attribute (`"lightTheme"` or `"darkTheme"`) on the `#myst-css-namespace` element, giving `custom.css` a stable CSS hook for per-theme variable overrides (e.g. `#myst-css-namespace[data-theme="darkTheme"] { --tok-keyword: … }`).
- `src/utils/local_utils/zoom.js` — Tauri-only webview zoom control (bound to Cmd/Ctrl `+`/`-`/`0`), plus `openExternalUrl`/`initExternalLinkHandler` which intercepts external link clicks and opens them in the system browser (Tauri) or a new tab (Web).
- `src/utils/previewInteractions.js` — `handlePreviewInteraction` handles clicks inside the rendered preview pane: toggling dropdown admonitions and resolving internal anchor links to scroll the source/preview to the corresponding location.
- `src/utils/previewPopup.js` — Implements hover-preview popups in the rendered document: builds/caches renderable elements by ID, resolves preview HTML for footnotes/citations/external-link targets/cross-references, and manages popup positioning/timing.
- `src/utils/sectionReorder.js` — Supports drag-and-drop reordering of markdown sections: computes the source-text range spanning a heading and its subtree, flattens the heading tree with line numbers, and performs the text move to relocate a section.
- `src/utils/utils_ui.js` — Small DOM/UI helpers: `showToast` for transient notifications, and `createUpdateUI` for the modal progress overlay used during the Tauri self-update flow.

- `src/config-defaults.js` — Holds `DEFAULT_CONFIG` (intervals, autosave, recent-files limit, shortcuts, Pyodide behaviour, the Tauri export section) and `BUILTIN_DIRECTIVES`, the table describing how each MyST directive is labelled and numbered. Split out of `config.js` so the defaults can be read and documented on their own; `config.js` deep-copies them at startup and merges `config.json` over the copy, leaving the reference table untouched. See [customisation.md](customisation.md) for every key.
- `src/utils/local_utils/sidecar.js` — Persists a document's Pyodide state beside it: cell outputs and, when the runtime is ready, a cloudpickle snapshot of the user-facing globals. Under Tauri the sidecar is a `<name>.myst.cache.json` file next to the `.md`; on the web it is an IndexedDB entry keyed by working folder plus file name. Exposes `loadSidecar`, `applySidecarOutputs` (synchronous, so restored outputs are in place before the markdown renders), `scheduleNamespaceRestore`, `saveSidecarWithNamespace` and `saveSidecarToFile`. The snapshot is taken of the document's own Python namespace and records which one it was, so it is restored where it came from; the file carries a `version`, and anything older than the current one has its namespace refused rather than read as if it were this document's. Objective: let a notebook-style document reopen with its results and variables intact rather than an empty runtime.
- `src/utils/local_utils/mystExport.js` — Backend of the Tauri-only export menu. Runs `myst build <file> --tex|--pdf|--docx` for the current document, saves the rendered preview as a self-contained HTML file, and drives the two project-level commands (`myst build`, and `myst start` with start/stop and browser opening). Every command goes through a login shell, since a GUI application launched from the Finder does not inherit an interactive shell's PATH and would not find `myst`. Also detects the two prerequisites myst provides no default for — a `myst.yml` project and an `exports:` frontmatter entry — and offers to create both rather than failing obscurely. Objective: make the standard MyST export formats reachable from the editor without dropping to a terminal.
- `src/utils/local_utils/scanAdmonitions.js` — Reads a MyST source and lists its admonitions in document order, each with its kind, its title as the reader will see it and its `:label:`. Reproduces mystmd's own rules — the default title of each kind, a bold first line or a heading promoted to a title, a GitHub blockquote callout — so that the list matches what the exporter will produce. Hand-written `\\begin{framed}` inside a `{raw} latex` block is counted separately, as a passthrough, since it will appear in the `.tex` without ever having been an admonition. Used by the `.tex` post-processing and by `bin/check-admonitions.mjs`.
- `src/utils/local_utils/texAdmonitions.js` — The LaTeX side of the same work: finds every `framed` environment in an exported `.tex` while masking verbatim regions character by character (so that offsets stay exact), pairs them with the admonitions of the source by position and by title, and rewrites each one as a `tcolorbox` carrying its kind's colour, its number and its `\\label`. The pairing is graded rather than assumed, and the whole rewrite is refused when a document and its export cannot be matched beyond doubt — rewriting in the wrong places is worse than not rewriting. Also holds `DEFAULT_ADMONITION_COLORS` and the preamble the rewrite injects.
- `src/utils/local_utils/texProofLabels.js` — Puts back the proof labels `myst-to-tex` mangles. Its proof handler is the only one to write its anchor with the normalised (lowercased) identifier while every cross-reference writes the label as typed, so an exported PDF resolves neither and shows `??`. Deliberately isolated, with each repair reported as `repaired`, `absent`, `ambiguous` or `unchanged`. To be removed when the bug is fixed upstream.
- `src/utils/local_utils/texTidy.js` — Cosmetic repairs on an exported `.tex`: `separateEnvironments` puts a blank line after a closing environment, which mystmd writes run together on a single line. Exports the `VERBATIM` pattern the other `.tex` modules share, so that none of them edits inside a `verbatim`, `lstlisting` or `minted` block.
- `src/utils/local_utils/pyodideExport.js` — Hands what the Pyodide cells produced to mystmd, which otherwise exports a code cell with no output at all: the editor runs the cells, mystmd never does. Writes each figure as a PNG under `_build/pyodide/` — rasterising SVG at `pyodide.exportImageScale` on a white background — plus a manifest keyed by the cell's code, and honours the project's own `output_stderr` and `output_matplotlib_strings` filters. Read back at build time by `extras/myst-plugins/pyodide-outputs.mjs`.
- `src/utils/headingInline.js` — Heading text rendered as inline Markdown for the places that show a heading outside the document: the side outline and the `{toc}` directive. Both printed the source as it stands in the file — `**Résultats**` with its asterisks, `$x^2$` unrendered — because the heading tree stores source text on purpose, that being what the numbering and the section reordering work on. Anchors are flattened, their content kept: an entry of a table of contents is itself a link, and an `<a>` nested in another swallows the click.
- `src/utils/ipynb2mystLib.js` — The in-editor half of the notebook conversion: turns a `.ipynb` into MyST code cells and back, commenting the directive options (`# :option: value`) on the way out so that the notebook stays valid Python, and uncommenting them on the way in. Shared with the standalone scripts in `extras/`.

## Export tooling: scripts and mystmd plugins

- `bin/check-admonitions.mjs` — Command-line dry run of the `.tex` post-processing, outside the application: given a source and the `.tex` mystmd produced from it, it expands the includes, scans both sides and reports whether the pairing holds, naming the file and line of anything it cannot match. `--write <out.tex>` applies the full chain — admonitions, proof labels, environment separation — and `--colors <config.json>` reads the palette from a real configuration, so the command answers exactly the question the editor answers.
- `extras/myst-plugins/exercise-admonition.mjs` — mystmd plugin bringing `{exercise}` and `{solution}` back into the static exports, which drop them: a LaTeX or Word export produced nothing where the editor shows a box. Retypes them as admonitions at the `project` stage — after enumeration and reference resolution, so the number each one received is still the number the cross-references point at — and builds the title `Exercise N (its own title)`.
- `extras/myst-plugins/pyodide-outputs.mjs` — The other half of `pyodideExport.js`: reads the manifest under `_build/pyodide/`, matches each empty `outputs` node against the trimmed code of its cell and fills it with the figures the editor computed, rebasing the image paths relative to the document and honouring the cell's `:figwidth:` and `:align:`.
- `extras/ipynb2myst.js`, `extras/ipynb2myst.py`, `extras/myst2ipynb.js`, `extras/myst2ipynb.py` — Standalone converters between Jupyter notebooks and MyST documents, in Node and in Python, sharing the logic of `src/utils/ipynb2mystLib.js`. For converting a set of files without opening the editor.

## New stylesheets

- `src/styles/biblio.css` — Styles for the rendered bibliography section (list bullets/indentation, citation link decoration).
- `src/styles/codemirror-addition.css` — Extra CodeMirror syntax-highlighting styles and cursor styling, driven by CSS custom properties.
- `src/styles/editor-tabs.css` — Styles the multi-tab editor bar UI (tab buttons, close button, active/dirty states, "new tab" button).
- `src/styles/footnotes.css` — Minimal styling for the rendered footnotes section and its backreference links.
- `src/styles/frontmatter.css` — Styles for the rendered document frontmatter block (title, subtitle, authors, date/DOI, GitHub link).
- `src/styles/preview.css` — Miscellaneous preview styles: numbered document title, fold/unfold markers, hover-preview popup box, and numbering prefixes for table/figure captions.

## The documentation site (`docs/`)

Upstream's Sphinx documentation was moved aside to `MystEdDocs/` and left as it was; `docs/` is this fork's own documentation, written in MyST and built by mystmd itself — the editor's documentation is a document the editor is made to write. `docs/myst.yml` holds the project and its table of contents, `docs/mdocs_fm.yml` the frontmatter every page extends, and `docs/index.md` is the landing page. Only the files listed in that table of contents are built; the drafts left beside them are named among the stray files above.

Presentation and general documentation:

- `docs/presentation.md` — The editor presented in one piece, exported to PDF and DOCX by the project itself, so that the page doubles as a demonstration of the exports.
- `docs/overview.md` — What Mystral Editor is and where it comes from.
- `docs/local-file-management.md` — The file menu: opening, recent files, saving, autosave, backups, the working folder, and the detection of a file changed on disk behind the editor's back.
- `docs/scientific-authoring.md` — Equations, numbering, cross-references, bibliography, footnotes: the fork's main contribution over upstream.
- `docs/python-executable-code-cells-(pyodide).md` — Code cells, the Pyodide runtime, the variable inspector, and what is kept in the sidecar between sessions.
- `docs/document-organization-and-navigation.md` — The side outline, the table of contents, section drag-and-drop, tabs.
- `docs/theming-and-interface.md` — Light and dark themes, the token groups, and what a `custom.css` can reach.
- `docs/desktop-application-(tauri).md` — The packaged application: platforms, file associations, the updater.
- `docs/customisation.md` — `config.json` and `custom.css` from the user's side, with `docs/customisation-reference.md` holding the key-by-key table.
- `docs/getting-started.md`, `docs/contributing.md` — Installing a release; building from source and running the tests.
- `docs/differences-vs-myst-editor-(summary).md` — Upstream and this fork feature by feature, as a table.
- `docs/macos_app_installation_guide.md`, `docs/windows_app_installation_guide.md` — Getting past Gatekeeper and SmartScreen, the application being unsigned.

Precisions and further notes:

- `docs/additions.md`, `docs/modifications.md` — These two inventories.
- `docs/completion.md` — What the editor proposes as one types, and where each proposal comes from.
- `docs/export.md` — The export menu, the prerequisites mystmd gives no default for, the PDF built through a post-processed LaTeX, and the settings that govern it.
- `docs/toc.md`, `docs/include.md` — The `{toc}` and `{include}` directives.
- `docs/directives-and-roles.md` — Every directive and role understood, each attributed to its origin: library, upstream, or this fork.
- `docs/executable-content.md` — Code cells from the document's point of view rather than the runtime's.
- `docs/project-frontmatter-extends.md` — What belongs to the project rather than to a file, and how `extends` chains the frontmatter.
- `docs/myst-editor-css-variables.md` — The `--tok-*` and UI custom properties, as a reference table.
- `docs/keyboard_shortcuts_en.md` — Every shortcut, code cells included, as MyST tables — and, like the rest, a demonstration of the features it is written with.

Supporting files:

- `docs/plugins/*.mjs`, `docs/plugins/foldable-solutions.css` — The mystmd plugins the documentation site itself uses: a custom `example` admonition, exercises rendered in PDF builds, foldable solutions, and a per-page last-updated date read from git.
- `docs/figures/*.gif`, `docs/images/` — The screen recordings the pages show: each feature is demonstrated rather than described.
- `docs/fourier_signal.bib`, `docs/sf_demo_1.py`, `docs/sf_demo2.py`, `docs/split_markdown.py`, `docs/small_demo.md` — Material the example pages draw on.

## Other content files

- `src/public/newFileTemplate.md` — The starting content of a new file, in its own `.md` so that the editor's own highlighting applies while it is edited.
- `src/small_presentation.md` — Sample document showcasing admonitions, dual-pane sync, images, Mermaid diagrams, view modes and collaboration, inherited from upstream's demo content.
