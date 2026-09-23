# Files Added in This Fork (vs. `upstream/main`)

This document lists every file that exists in this fork ("Mystral Editor") but not in the upstream `antmicro/myst-editor` repository, based on `git diff --name-status upstream/main...HEAD` (merge-base comparison, so it reflects only what this fork introduced, ignoring unrelated upstream-only changes since the fork point).

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
- `src-tauri/src/lib.rs~` — Editor backup/autosave file duplicating an earlier version of `lib.rs`.
- `src-tauri/src/lib copy.rs`, `src-tauri/src/lib copy 2.rs`, `src-tauri/src/lib copy 3.rs` — Accidental duplicate/backup copies of `lib.rs` at different stages of editing.
- `Topbar.jsx` (at repo root) — A stray duplicate of `src/components/Topbar.jsx`, sitting outside `src/components` by mistake.
- `complete_diff_of_modified_and_added_files_in_fork.txt`, `modified_and_added_files_in_fork.txt` — Generated scratch diff dumps produced by `diffs_in_fork.sh`; dev artifacts, not meant to be tracked long-term.
- `test.md` — Trivial one-line placeholder file with no functional role.

## Root-level scripts, docs, and misc

- `Notes_encours.md` — French-language scratch/working notes (TODO-style) tracking in-progress editor features and refactoring plans; personal dev notes rather than project documentation.
- `install_fork.md` — Short install instructions for this fork, listing extra npm dependencies to install (katex, markdown-it-texmath, js-yaml, CodeMirror Python support) before running `npm i && npm run build`.
- `macos_app_installation_guide.md` — End-user guide explaining how to bypass macOS Gatekeeper's "unidentified developer" warning for the unsigned/unnotarized app.
- `windows_app_installation_guide.md` — End-user guide explaining how to bypass Windows SmartScreen's "unknown publisher" warning to run the unsigned installer.
- `myst_editor.sh` — macOS launcher script that starts `npm run dev`, opens the app in a dedicated Brave Browser app window (optionally to a file path argument), and shuts the dev server down once that window closes.
- `myst_editor_dist.sh` — Same launcher pattern as `myst_editor.sh` but runs the built distribution via `node server.mjs` instead of the Vite dev server.
- `run_myst_editor.sh` — Simpler launcher variant (no file-path argument support).
- `server.mjs` — Minimal Node.js static file server for the built `dist/` app (SPA fallback), also exposing `/api/file` GET/POST endpoints to read and write local files, used when running the packaged/distributed build outside Tauri.
- `diffs_in_fork.sh` — Dev utility script that dumps the file-status list and full diff between `upstream/main` and `main` into text files for review.
- `vite-file-plugin.js` — Vite dev-server plugin registering the same `/api/file` middleware as `server.mjs`, for use during `npm run dev`.
- `assets/Image-not-found.png` — A placeholder "image not found" PNG, duplicated at the repo root outside the `src/public` tree actually used by the running app.

## Public runtime assets/config

- `src/public/assets/image-not-found.png` — The runtime copy of the "image not found" placeholder PNG served with the app, referenced by `src/public/config.json`'s `fallbackImage` setting.
- `src/public/config.json` — Runtime configuration for the desktop app: autosave/suspend/check intervals, recent-files limit, default filename, fallback image path, keyboard shortcuts (save/open/new tab), and a table of MyST directive definitions (figure, table, math, exercise, theorem, admonition, etc.) mapping directive names to numbering/caption/label behavior.
- `src/public/custom.css` — User-customizable CSS overrides scoped to `#myst-css-namespace`, styling emphasis/strong/heading colors via CSS variables.
- `src/public/new_file.md` — Template/sample MyST markdown document (frontmatter, bibliography, math macros) used as the starting content for new files, demonstrating cross-references, equations, footnotes, citations, and figures.

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

## New markdown-processing modules

- `src/markdown/bibliography.js` — Loads and parses a BibTeX (`.bib`) file per editor tab (Tauri filesystem or Web File System Access API), and provides markdown-it plugins to render `[@key]` citation groups and a `[bibliography]` marker into a formatted reference list, including a `Cite` role, numeric/author-year citation styles, and hover-preview metadata.
- `src/markdown/frontmatterUtils.js` — `extractFrontmatter(fullText)` parses the leading YAML frontmatter block using `js-yaml` and returns the parsed object plus the line number where it ends.
- `src/markdown/markdownFootnotes.js` — Pre-scans a document for footnote definitions/references, numbers them by first-reference order, and provides markdown-it plugins to render inline footnote markers (with backrefs and hover preview) and the generated footnotes section.
- `src/markdown/markdownHeadings.js` — A markdown-it core-rule plugin that assigns anchor IDs to headings from resolved section labels, strips `(label)=` marker paragraphs once consumed, and injects heading numbers into rendered heading tokens.
- `src/markdown/markdownMath.js` — Sets up KaTeX/`markdown-it-texmath` math rendering per editor (with per-editor macro maps), computes numbering/label configuration for numbered targets (equations, figures, tables, sections), renders `@label` auto-references and numbered equation blocks, and resolves `[](#label)`/`{ref}`/`{eq}`/`{numref}` link text and placeholders.
- `src/markdown/markdownRefLinks.js` — Adds support for Markdown reference-style links (`[text][ref]`, `[ref]`) with a global scan collecting `[label]: url "title"` definitions, plus markdown-it plugins to skip the definition lines and resolve reference-style link usages.
- `src/markdown/markdownTitledAdmonitions.js` — Extends `markdown-it-docutils`' admonition directive classes to accept an optional title argument, and adds an `open` flag option so admonitions can render pre-expanded/collapsible.
- `src/markdown/markdownPyodide.js` — markdown-it plugin that activates Pyodide-powered executable code cells in the preview. It intercepts both backtick-fenced ` ```{code-cell} ` blocks (processed as a fence rule) and `.code-cell-host` placeholder divs emitted by `CodeCellDirective`, installs a `MutationObserver` on the preview container that fires `initCodeCell()` whenever a new placeholder appears, and handles widget eviction and reuse across incremental re-renders so that cell state (user edits, outputs) survives paragraph re-renders of adjacent content.

- `src/markdown/pyodideRunner.js` — Initializes and manages the Pyodide WebAssembly runtime and the individual executable Python cell widgets. Loads Pyodide lazily on first execution (with a loading overlay), wraps each cell in a CodeMirror 6 editor configured with `pythonHighlightStyle`, runs code asynchronously via Pyodide and displays stdout/return-value/error output below the editor, supports `micropip.install()` for extra packages declared in the `{code-cell}` `:packages:` option, and exposes a `cellCache` for widget reuse. The cell UI adapts to light/dark mode through the `--color-background-*` and `--tok-*` CSS variables.

- `src/markdown/scanTargets.js` — Core cross-reference scanner: walks the raw markdown source to find and number all "targetable" directives (figures, tables, equations, exercises, theorems, etc.) and standalone math blocks, building `byLine`/`byLabel` maps used for cross-references; also folds in section (heading) labels.

## New utility modules

- `src/utils/commentsStorage.js` — Persists and retrieves collaborative-comment state (Yjs `ycomments` encoded state) per file path in IndexedDB (via `idb-keyval`).
- `src/utils/headingNumbering.js` — Numbers a heading tree, scans the raw text for `(label)=` lines preceding a heading, and flattens numbered headings into a line-number map used to sync headings with source lines.
- `src/utils/local_utils.js` — Barrel module defining `isTauri()` and re-exporting the `local_utils/theme.js`, `fs.js`, `stats.js`, `tab_state.js`, and `zoom.js` submodules as a single namespace.
- `src/utils/local_utils/fs.js` — Filesystem/storage abstraction bridging Web (File System Access API/IndexedDB) and Tauri (native FS): working/image directory selection, tab-order and file-handle persistence, image path resolution, recent-files tracking, and load/save/backup operations.
- `src/utils/local_utils/stats.js` — Computes document statistics (heading/paragraph/word/line/character counts) from the markdown-it token stream and shows them in a modal popup.
- `src/utils/local_utils/tab_state.js` — `createTabState(...)` builds the per-tab state object/API used by `TabManager` and the editor: tracks file handle/name/dirty flag, drives comments load/save, and implements open/save/save-as/backup/autosave/smart-save logic across Web and Tauri backends.
- `src/utils/local_utils/theme.js` — Manages light/dark theme application across the main document and each editor's Shadow DOM, applies optional user custom CSS, and injects custom CodeMirror syntax-highlighting colors. On every theme switch the function also sets a `data-theme` attribute (`"light"` or `"dark"`) on the `#myst-css-namespace` element, giving `custom.css` a stable CSS hook for per-theme variable overrides (e.g. `#myst-css-namespace[data-theme="dark"] { --tok-keyword: … }`).
- `src/utils/local_utils/zoom.js` — Tauri-only webview zoom control (bound to Cmd/Ctrl `+`/`-`/`0`), plus `openExternalUrl`/`initExternalLinkHandler` which intercepts external link clicks and opens them in the system browser (Tauri) or a new tab (Web).
- `src/utils/previewInteractions.js` — `handlePreviewInteraction` handles clicks inside the rendered preview pane: toggling dropdown admonitions and resolving internal anchor links to scroll the source/preview to the corresponding location.
- `src/utils/previewPopup.js` — Implements hover-preview popups in the rendered document: builds/caches renderable elements by ID, resolves preview HTML for footnotes/citations/external-link targets/cross-references, and manages popup positioning/timing.
- `src/utils/sectionReorder.js` — Supports drag-and-drop reordering of markdown sections: computes the source-text range spanning a heading and its subtree, flattens the heading tree with line numbers, and performs the text move to relocate a section.
- `src/utils/utils_ui.js` — Small DOM/UI helpers: `showToast` for transient notifications, and `createUpdateUI` for the modal progress overlay used during the Tauri self-update flow.

- `src/config-defaults.js` — Holds `DEFAULT_CONFIG` (intervals, autosave, recent-files limit, shortcuts, Pyodide behaviour, the Tauri export section) and `BUILTIN_DIRECTIVES`, the table describing how each MyST directive is labelled and numbered. Split out of `config.js` so the defaults can be read and documented on their own; `config.js` deep-copies them at startup and merges `config.json` over the copy, leaving the reference table untouched. See [customisation.md](customisation.md) for every key.
- `src/utils/local_utils/sidecar.js` — Persists a document's Pyodide state beside it: cell outputs and, when the runtime is ready, a cloudpickle snapshot of the user-facing globals. Under Tauri the sidecar is a `<name>.myst.cache.json` file next to the `.md`; on the web it is an IndexedDB entry keyed by working folder plus file name. Exposes `loadSidecar`, `applySidecarOutputs` (synchronous, so restored outputs are in place before the markdown renders), `scheduleNamespaceRestore`, `saveSidecarWithNamespace` and `saveSidecarToFile`. Objective: let a notebook-style document reopen with its results and variables intact rather than an empty runtime.
- `src/utils/local_utils/mystExport.js` — Backend of the Tauri-only export menu. Runs `myst build <file> --tex|--pdf|--docx` for the current document, saves the rendered preview as a self-contained HTML file, and drives the two project-level commands (`myst build`, and `myst start` with start/stop and browser opening). Every command goes through a login shell, since a GUI application launched from the Finder does not inherit an interactive shell's PATH and would not find `myst`. Also detects the two prerequisites myst provides no default for — a `myst.yml` project and an `exports:` frontmatter entry — and offers to create both rather than failing obscurely. Objective: make the standard MyST export formats reachable from the editor without dropping to a terminal.

## New stylesheets

- `src/styles/biblio.css` — Styles for the rendered bibliography section (list bullets/indentation, citation link decoration).
- `src/styles/codemirror-addition.css` — Extra CodeMirror syntax-highlighting styles and cursor styling, driven by CSS custom properties.
- `src/styles/editor-tabs.css` — Styles the multi-tab editor bar UI (tab buttons, close button, active/dirty states, "new tab" button).
- `src/styles/footnotes.css` — Minimal styling for the rendered footnotes section and its backreference links.
- `src/styles/frontmatter.css` — Styles for the rendered document frontmatter block (title, subtitle, authors, date/DOI, GitHub link).
- `src/styles/preview.css` — Miscellaneous preview styles: numbered document title, fold/unfold markers, hover-preview popup box, and numbering prefixes for table/figure captions.

## Docs/content files

- `src/keyboard_shortcuts_en.md` — English reference document listing the editor's keyboard shortcuts, formatted as MyST tables and demonstrating the fork's frontmatter/numbering/math-macro features.
- `src/keyboard_shortcuts_fr.md` — French translation/version of the keyboard shortcuts reference (plain Markdown tables).
- `src/small_presentation.md` — Sample/demo markdown document showcasing MyST Editor features (admonitions, dual-pane sync, images, Mermaid diagrams, view modes, custom transforms, collaboration) used as introductory/demo content.
