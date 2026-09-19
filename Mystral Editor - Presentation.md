---
title: Mystral Editor
authors:
  - jfbercher
date: Version 0.9 of 2026-09-19.
license: GNU GPL 3.0+
github: https://github.com/jfbercher/Mystral-Editor
bibliography: references.bib
citation-style: author-year # or numeric
citation-template: "{authors} ({year}). *{title}*. {container}{volume}{pages}.{doilink}"
numbering:
  headings: true # activate headings numbering
  equations: true 
  figure: true
    #template: Fig. %s # Define the prefix
math:
  '\dr': '\mathrm{d}#1'
  '\wb': '\mathbf{wx}'
---


## Overview

[Mystral Editor](https://github.com/jfbercher/Mystral-Editor) is a fork of [Myst-Editor](https://github.com/antmicro/myst-editor/) by Antmicro, a web Markdown editor built on the [MyST Markdown](https://myst-parser.readthedocs.io/) (Markedly Structured Text) syntax. Where Myst-Editor is designed as an embeddable Preact component for collaborative editing in web applications, This project uses it to build a full-featured scientific authoring tool for local use.

[Additions](./additions.md)
[Modifications](./modifications.md)


MyST Markdown (Markedly Structured Text) is a superset of CommonMark Markdown designed for technical and scientific writing. It adds structured roles and directives — the building blocks for cross-referenced figures, numbered equations, citations, admonitions, and rich metadata — while remaining fully readable as plain text. Beyond the editor itself, MyST is backed by the [MySTmd ecosystem](https://mystmd.org/): a set of open-source tools that can compile the same source files into polished LaTeX manuscripts and PDF output, Word documents, and entire documentation websites (via Jupyter Book or the MyST site builder), making it a compelling single-source format for researchers, educators, and technical authors who need to publish across multiple media from one set of files.

The project addresses a concrete need: a lightweight, offline-capable editor oriented toward academic documents, with bibliography management, equations, automatic numbering of floating elements and structured navigation, while keeping all of Myst-Editor's strengths (live preview, inline mode, suggestions, diff view, themes).

The application ships in two forms:

- **Native desktop application** via Tauri (macOS, Linux, Windows) with access to the local file system
- **Web mode** via a minimal Node.js server, usable in any browser without installation

## Features Inherited from Myst-Editor

Mystral Editor retains and extends all upstream editor features:

- **Live preview and dual-pane sync**: changes are immediately reflected in the preview, with cursor-based highlight and scroll synchronization.
- **Inline mode**: toggle Markdown rendering directly on the editor lines.
- **Collaborative editing**: simultaneous editing via a WebSocket server (Yjs/CRDT protocol), with remote cursors and avatars in real time.
- **Suggestions and CriticMarkup**: propose changes that others can accept or reject, using the [CriticMarkup](https://fletcher.github.io/MultiMarkdown-6/syntax/critic.html) syntax.
- **Diff view**: display changes relative to the document's initial state, with a discard-all option.
- **Comments**: text hidden from the preview (lines starting with `%`).
- **Document templates**: loadable from an external JSON file to speed up document creation.
- **HTML / PDF export**: copy rendered HTML or export to PDF via toolbar buttons.
- **Spell checker**: configurable Hunspell integration (language, dictionary path).
- **Customization**: CodeMirror themes, Vim mode, scroll-past-last-line, CSS overrides via Shadow DOM.
- **Custom transforms**: regular expressions turning syntax into arbitrary HTML (issue links, etc.).
- **MyST roles and directives**: custom roles (`{ref}`, `{eq}`, etc.) and directives with CodeMirror autocompletion.

## Local File Management

A dedicated menu bar handles documents on the local file system:

- **Open files** with recent-file history and quick open
- **Save** and **Save As**
- **Autosave** with a configurable interval in `config.json` (enabled by default)
- **Backup save** on demand
- **Working directory management**: used for local image path resolution
- **Document statistics** (word, paragraph, line and character counts)
- **Zoom** (Cmd/Ctrl +/-/0) in Tauri mode

In web mode (outside Tauri), file access goes through the browser File System Access API (Chrome/Edge) with IndexedDB for tab-state persistence.

Each tab's state (file name, dirty flag, Yjs comments) is saved and restored across sessions. A tab marked *dirty* (unsaved changes) is shown visually in the tab bar.

## Scientific Authoring

This is the core contribution of Mystral Editor over upstream.

### Equations and Mathematics

LaTeX equations are rendered via [KaTeX](https://katex.org/) et [markdown-it-texmath](https://github.com/goessner/markdown-it-texmath). Per-editor math macro maps are supported. Numbered equation blocks and cross-references (`{eq}`, `{numref}`) are resolved automatically.

### YAML Frontmatter

A YAML metadata block at the head of the document (title, authors, date, DOI, venue, license, GitHub link) is rendered as a formatted bibliographic header. The block is displayed as a collapsible section in the editor. A YAML language server can be activated via an external JSON schema for tooltips and autocompletion.

### BibTeX Bibliography

A `.bib` file is associated with each tab. Citations are inserted with the `[@cle]` syntax and a `[bibliography]` marker generates the reference list.

- Two citation styles: **numeric** and **author-year**
- Customizable bibliography rendering template
- Hover preview of a cited reference
- BibTeX key autocompletion in the editor

### Numbering and Cross-References

Figures, tables, equations and sections are numbered automatically. Labels are declared with the standard MyST syntax (`(label)=`). References (erences (`{ref}`, `{eq}`, `{numref}`) are resolved and their text updated dynamically. A popover preview shows the referenced element on link hover.

Numbering can be enabled or disabled independently for each element type (via `config.json`).

### Footnotes

Standard Markdown footnotes are supported, numbered in order of first appearance, with backlinks from the note to its inline reference.

**Example — Source:**

```md
Here is a sentence with a note[^1] inline.

[^1]: This is the content of the footnote.
```

Here is a sentence with a note[^1] inline.

[^1]: This is the content of the footnote.

The inline marker renders as a superscript link. At the end of the document, Mystral Editor collects all definitions and generates a numbered *Footnotes* section with backlinks to each inline reference.

### Enhanced Admonitions

MyST admonitions are extended:

- **Optional free title**
- **Collapsible mode** (`details`/`summary` HTML) with `open` option (pre-expanded) or collapsed by default
- **New types**: `theorem`, `exercise`, `solution`
- Support for `align`, `icon`, and other options

**Example — Source:**

```md
:::{note} A custom title
:class: dropdown

This admonition has a **title** and is collapsible.
Add `:open:` to start it pre-expanded.
:::
```

:::{note} A custom title
:class: dropdown

This admonition has a **title** and is collapsible.
Add `:open:` to start it pre-expanded.
:::

This renders as a `<details>`/`<summary>` block: the icon and custom title form the summary bar, and the body stays hidden until the user clicks to expand it.

### Figures and Tables

The `figure`, `table` and `list-table` directives support alignment (left, center, right) and scaling. Captions are numbered and cross-referenceable.

**Example — Source:**

```md
(fig:result)=
:::{figure} images/result.png
:align: center
:width: 50%

Results for the experiment.
:::

See {ref}`fig:result` ([](#fig:result)) for details.
```

:::{figure} images/result.png
:align: center
:label: fig:result
:width: 40%

Results for the experiment.
:::

See {ref}`fig:result` ([](#fig:result)) for details.

The figure renders centered, with the automatic caption "Figure 1: Results for the experiment." The `{numref}` role resolves to the hyperlinked text "Figure 1". Tables follow the same pattern using the `list-table` directive with a `(tab:label)=` anchor above it.

## Document Organization and Navigation

### Table of Contents

A collapsible, resizable left side panel displays a table of contents generated dynamically from document headings. When heading numbering is enabled, numbers appear in the panel. Clicking an entry scrolls both the editor and the preview to the corresponding section.

### Drag-and-Drop Section Reordering

Document sections can be reordered directly from the table-of-contents panel by drag and drop. The operation moves in the Markdown source the full text spanning from the heading to the end of its subtree.

### Multi-Document Tabbed Editing

Several documents can be open simultaneously in a tabbed interface. Each tab maintains its own state (file, scroll position, comments, bibliography, theme). Inactive tabs are suspended after a configurable timeout to limit memory use, then restored on reactivation.

### Section Folding

Headings can be folded individually (chevron marker in the editor gutter) or globally at load time (option `unfoldedHeadings`). The YAML frontmatter can also be folded.

## Theming and Interface

Mystral Editor ships an explicit **light theme** alongside the dark theme, each defined as a full `CSSStyleSheet` with dedicated color tokens for the editor UI and CodeMirror syntax highlighting. Theme switching applies to both the main document and each editor's Shadow DOM.

Users can further customize the appearance with an optional `custom.css` file (scoped to `#myst-css-namespace`) that is loaded at startup and applied on top of the built-in themes.

CodeMirror syntax highlighting colors are driven by CSS custom properties, making them easy to override per-project. The font stack uses self-hosted Lato (regular and bold weights, Latin and Latin-ext subsets).

## Desktop Application (Tauri)

Mystral Editor is packaged as a native cross-platform desktop application using [Tauri](https://tauri.app/), with pre-built releases for **macOS** (Apple Silicon and Intel), **Linux** (x64 and ARM64), and **Windows**. The app is registered as the default handler for `.myst`, `.md`, `.markdown`, and `.txt` files.

Key Tauri-specific features:

- **Native file dialogs** for open, save and directory selection
- **Single-instance enforcement**: opening a second file re-uses the running window
- **File-association launch**: dragging a file onto the app or double-clicking it in the OS opens it directly in a new tab
- **Auto-updater**: the app checks for new releases at startup and can install updates in place (via a GitHub Releases endpoint)
- **External link handling**: links in the preview open in the system browser rather than the webview
- **Webview zoom**: Cmd/Ctrl +/-/0 scales the entire UI
- **Logging** via the Tauri logging plugin

A GitHub Actions workflow (`release.yaml`) builds and signs all platform variants on every `v*` tag push, producing installer artifacts published to GitHub Releases. A `Makefile` `release` target automates version bumping, tagging and pushing.

For users who prefer a browser-based setup, a minimal Node.js server (`server.mjs`) serves the built `dist/` folder as a single-page application with `/api/file` endpoints for local file read/write, replicating the file-access layer without Tauri.

## Getting Started

Pre-built binaries for macOS (Apple Silicon and Intel), Linux (x64 and ARM64), and Windows are available on the [Releases page](https://github.com/jfbercher/Mystral-Editor/releases). Download the package for your platform.

### macOS

After downloading the `.dmg`, drag **Mystral Editor** into your Applications folder. Because the app is not notarized, macOS Gatekeeper will warn that it is from an "unidentified developer."

To open it the first time, right-click (or Control-click) the app icon and choose **Open**. When the dialog appears saying the developer cannot be verified, click **Open** to proceed. Alternatively, open **System Settings → Privacy & Security** and click **Open Anyway** next to the blocked entry. This one-time approval is all that is needed; subsequent launches proceed normally.

### Windows

When running the installer, Windows SmartScreen may display an "Unknown publisher" warning. Click **More info** in the dialog, then click **Run anyway** to continue with the installation.

### Linux

Extract the downloaded `.tar.gz` archive and run the `Mystral-Editor` binary directly, or install the provided `.deb` or `.AppImage` package.

### First Launch and File Associations

On first launch the app registers itself as the default handler for `.myst`, `.md`, `.markdown`, and `.txt` files. You can open documents from the OS file manager, by dragging them onto the app window, or from **File → Open** inside the app.

### Automatic Updates

Mystral Editor checks for updates automatically on each startup. When a new release is published on GitHub, the app downloads it in the background and prompts you to restart and apply the update. No manual download is required for subsequent releases.

## Contributing

### Prerequisites

- **Node.js v20** — recommended version; required for the test suite.
- **Rust and Cargo** (stable toolchain) — required only to build the Tauri desktop application.
- **Tauri CLI** — install with `cargo install tauri-cli` or `npm install -g @tauri-apps/cli`.

### Repository Setup

Clone the repository and install dependencies:

```bash
git clone https://github.com/jfbercher/Mystral-Editor.git
cd Mystral-Editor
npm install
```

The fork requires a few additional packages beyond the upstream baseline:

```bash
npm install katex markdown-it-texmath js-yaml @codemirror/lang-python
```

### Development

Start the Vite dev server with hot reload:

```bash
npm run dev
```

To run with native Tauri desktop features (file dialogs, filesystem access, updater):

```bash
npm run tauri dev
```

### Building

Build the web app only:

```bash
npm run build
```

Build the full Tauri desktop application for the current platform:

```bash
npm run tauri build
```

Cross-platform release builds (macOS Apple Silicon/Intel, Linux x64/ARM64, Windows) are produced automatically by the GitHub Actions workflow (`.github/workflows/release.yaml`) when a `v*` tag is pushed.

### Running the Tests

The Playwright suite runs against the **built and previewed** app. Start three processes before running tests.

First-time setup:

```bash
npm install && npx playwright install
```

Terminal 1 — build and preview the app:

```bash
npm run build && npm run preview
```

Terminal 2 — collaboration server:

```bash
cd bin && npm install
YPERSISTENCE=/tmp/myst-yjs-db PORT=4455 node server.js
```

Terminal 3 — run the tests (Node 20 required):

```bash
npx -y node@20 /usr/bin/npm run test
```

To run a single test, pass a `-g` name filter:

```bash
npx -y node@20 node_modules/@playwright/test/cli.js test -c tests/playwright.config.js -g "test name"
```

### Releasing a New Version

Use the `Makefile` release target to bump versions, commit, tag, and push:

```bash
make release VERSION=x.y.z
```

This updates the version string in `src-tauri/Cargo.toml` and `tauri.conf.json`, creates a git tag `vx.y.z`, and pushes it — triggering the CI release workflow automatically.

## Differences vs Myst-Editor (Summary)

| Feature | Myst-Editor (upstream) | Mystral Editor (this fork) |
| --- | --- | --- |
| Deployment | Embeddable Preact component for web apps | Desktop app (Tauri) + web server mode |
| File management | None (text passed via JS API) | Open, Save, Save As, Autosave, Backup, Recent files |
| Multi-document | Single editor instance | Tabbed interface with suspend/restore |
| LaTeX equations | Not supported | KaTeX rendering, numbered equations, cross-references |
| YAML frontmatter | Not rendered | Rendered header (title, authors, DOI, etc.), collapsible |
| Bibliography | Not supported | BibTeX, numeric and author-date styles, cite role, hover preview |
| Cross-references | Basic MyST roles | Full label/target scan, numbered refs, popover preview |
| Footnotes | Not supported | Supported, numbered by first appearance |
| Admonitions | Standard markdown-it MyST types | MySTmd support: Titles, dropdown (details/summary), new types (theorem, exercise) |
| Figure/table alignment | Not supported | Left, center, right alignment and scaling |
| Table of contents | Outline mode only | Collapsible side panel, numbered headings |
| Drag-and-drop reorder | Not supported | Section drag-and-drop from TOC panel |
| Heading numbering | Not supported | Configurable, synced to TOC and source |
| Themes | Dark theme only | Explicit selectable Light and Dark themes, user custom.css |
| CodeMirror syntax colors | Fixed | CSS-token-driven, overridable per project |
| Code block languages | Markdown only | Python sub-mode (extensible) |
| MyST autocompletion | Not supported | Roles, directives, cross-ref targets, BibTeX keys |
| Section folding | Collapsible heading marker | Chevron gutter marker, frontmatter fold |
| Desktop app | No | macOS, Linux, Windows (Tauri); file associations; auto-updater |
| Release pipeline | Not applicable | GitHub Actions cross-platform CI, Makefile versioning |
