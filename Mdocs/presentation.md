---
title: Mystral Editor - General Presentation
numbering:
  figure: true
exports:
  - format: docx
  - format: pdf
    template: arxiv_nips
    article_type: article
---



:::{toc} Contents
:dropdown: 
::: 

## Overview

**[Mystral Editor](https://github.com/jfbercher/Mystral-Editor)** is a lightweight, offline-capable editor with large [MyST Markdown](https://myst-parser.readthedocs.io/)[^MyST] support and live-preview, oriented toward academic documents, with equations, bibliography management, automatic numbering of floating elements and structured navigation.

[Mystral Editor](https://github.com/jfbercher/Mystral-Editor) begun as a fork of [Myst-Editor](https://github.com/antmicro/myst-editor/) by Antmicro, a web Markdown editor built on the [MyST Markdown](https://myst-parser.readthedocs.io/) syntax. Where Myst-Editor is designed as an embeddable Preact component for collaborative editing in web applications, Mystral Editor uses it as an infrastructure to build a full-featured scientific authoring tool for local use, while keeping all of Myst-Editor's strengths (live preview, inline mode, suggestions, diff view, themes).


Mystral Editor ships in two forms:

- **Native desktop applications** via Tauri (macOS, Linux, Windows) with access to the local file system
- **Web mode** application, deployable on any website and thus  usable in any browser without installation. A minimal Node.js server is also provided that allows to use the `dist` distribution locally, without real app.

The original Myst-Editor is distributed under an Apache 2.0 license. The two following files list the Additions and Modifications over the original Editor (as required by the Apache 2.0 license): 

- [List of Additions](additions.md)
- [List of Modifications](modifications.md)

[^MyST]: MyST Markdown (Markedly Structured Text) is a superset of CommonMark Markdown designed for technical and scientific writing. It adds structured roles and directives — the building blocks for cross-referenced figures, numbered equations, citations, admonitions, and rich metadata — while remaining fully readable as plain text. Beyond the editor itself, MyST is backed by the [MySTmd ecosystem](https://mystmd.org/): a set of open-source tools that can compile the same source files into polished LaTeX manuscripts and PDF output, Word documents, and entire documentation websites (via Jupyter Book or the MyST site builder), making it a compelling single-source format for researchers, educators, and technical authors who need to publish across multiple media from one set of files.

## Features Inherited from Myst-Editor

Mystral Editor retains and extends all upstream editor features:

- **Live preview and dual-pane sync**: changes are immediately reflected in the preview, with cursor-based highlight and scroll synchronization.
- **Inline mode**: toggle Markdown rendering directly on the editor lines.
- **Collaborative editing**: simultaneous editing via a WebSocket server (Yjs/CRDT protocol), with remote cursors and avatars in real time.
- **Suggestions and CriticMarkup**: propose changes that others can accept or reject, using the [CriticMarkup](https://fletcher.github.io/MultiMarkdown-6/syntax/critic.html) syntax.
- **Diff view**: display changes relative to the document's initial state, with a discard-all option.
- **Document templates**: loadable from an external JSON file to speed up document creation.
- **HTML / PDF export**: copy rendered HTML or print to PDF from toolbar buttons. Kept in the web build; the desktop application hides them in favour of its own export menu, described below.
- **Spell checker**: configurable Hunspell integration (language, dictionary path).
- **Customization**: CodeMirror themes, Vim mode, scroll-past-last-line, CSS overrides via Shadow DOM.
- **Custom transforms**: regular expressions turning syntax into arbitrary HTML (issue links, etc.).
- **MyST roles and directives**: some roles (`{ref}`, `{eq}`, etc.) and directives were already present in MyST editor and are extended/completed in Mystral.

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

:::{figure} figures/menu-bar-tauri.gif
:name: menu-bar-tauri
:alt: Menu bar in Tauri apps
:width: 90%

*Menu bar for Tauri applications* (version 0.9.9) - local file management  (open, save, save as...), export menu (export as pdf, latex, html, complete website...), visualisation mode (dual, source, preview, inline-preview).. 
:::

:::{figure} figures/menu-bar-web.gif
:name: menu-bar-web
:alt: Menu bar in Web app
:width: 90%

*Menu bar for web distribution* (version 0.9.9) - local file management  (open, save, save as...), visualisation mode (dual, source, preview, inline-preview).. 
:::

Each tab's state (file name, dirty flag, Yjs comments) is saved and restored across sessions. A tab marked *dirty* (unsaved changes) is shown visually in the tab bar.

(scientific_authoring)=
## Scientific Authoring

This is a major contribution of Mystral Editor over upstream.

### Equations and Mathematics

LaTeX equations are rendered via [KaTeX](https://katex.org/) and [markdown-it-texmath](https://github.com/goessner/markdown-it-texmath). Per-editor math macro maps are supported. Numbered equation blocks and cross-references (`{eq}`, `{numref}`) are resolved automatically.

:::{figure} /figures/equations.gif
:name: typing-equations
:alt: Typing equations in Mystral
:width: 95%

Inserting equations in Mystral - supports standard LaTeX as well as `math`directive. Equations can be labelled and referenced anywhere in the document. 
:::

### YAML Frontmatter

A YAML metadata block at the head of the document (title, authors, date, DOI, venue, license, GitHub link) is rendered as a formatted bibliographic header. The block is displayed as a collapsible section in the editor. A YAML language server can be activated via an external JSON schema for tooltips and autocompletion.

An `extends:` key lets a document inherit its frontmatter from one or more shared YAML files, so that the settings common to a set of documents -- numbering, citation style, math macros, export entries -- are written once. Lists are combined, objects deep-merged, and the document's own values win. See [frontmatter-extends](frontmatter-extends.md).

:::{figure} figures/front-matter.gif
:name: front-matter
:alt: Front matter samll demo
:width: 95%

Shows a frontmatter defined via `extends` of an original -- shared, frontmatter. A key is changed to demonstrate enabling/disabling a numbering counter (here figure numbering). Also, the demo shows the collapsible table of contents in the left. 
:::

### BibTeX Bibliography

A `.bib` file is associated with each tab. Citations are inserted with the `[@cle]` syntax and a `[bibliography]` marker generates the reference list.

- Two citation styles: **numeric** and **author-year**
- Customizable bibliography rendering template
- Hover preview of a cited reference
- BibTeX key autocompletion in the editor

:::{figure} figures/bibliography.gif
:name: biblio
:alt: Demo on bibliography
:width: 95%

Insertion of some bibliography references contained in a bibTeX file. This showcast insertion with popup suggestions, as well as popup previews in the preview window. 
:::

:::{figure} figures/bibliography-fm.gif
:name: biblio-fm
:alt: Demo on frontmatter & bibliography 
:width: 95%

Changing bibliography style in front-matter. 
:::

### Numbering and Cross-References

Figures, tables, equations and sections are numbered automatically. Labels are declared with the standard MyST syntax (`(label)=`). References (`{ref}`, `{eq}`, `{numref}`) are resolved and their text updated dynamically. A popover preview shows the referenced element on link hover.

Numbering is enabled or disabled per element type in the document's own frontmatter, under `numbering:` (`headings`, `equations`, `figure`, …). `config.json` is where the *labels* live -- which directives are numbered and under what name -- through its `data_directives` table. See an example in [](#front-matter).

### Footnotes

Standard Markdown footnotes are supported, numbered in order of first appearance, with backlinks from the note to its inline reference.

**Example — Source:**

```md
Here is a sentence with a note[^1] inline.

[^1]: This is the content of the footnote.
```

Here is a sentence with a note[^mynote] inline.

[^mynote]: This is really the content of the footnote.

:::{figure} figures/footnote.gif
:name: footnote
:alt: Fottnote demo
:width: 95%

Inserting a footnote.
:::


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


:::{figure} figures/admonition.gif
:name: admonition
:alt: Admonition
:width: 95%

Example of admonitions with completions, dropdown, custom title, with or without icon.
:::

:::{figure} figures/admonition2.gif
:name: admonition2
:alt: Admonition2
:width: 95%

Example of admonition (continued) with a change of type.
:::


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
:name: fig:result
:alt: Results
:width: 40%
:align: center

Results of the experiment
:::

See {ref}`fig:result` ([](#fig:result)) for details.

The figure renders centered, with the automatic caption "Figure 1: Results for the experiment." The `{numref}` role resolves to the hyperlinked text "Figure 1". Tables follow the same pattern using the `list-table` directive with a `(tab:label)=` anchor above it.

:::{figure} figures/figures.gif
:name: Fig
:alt: Fig demo
:width: 95%

A demo for figure insertion
:::



### Including Other Files

An `{include}` directive inserts another file into the document, parsed as MyST -- a shared preamble, a chapter split across files, a set of exercises reused from one document to the next. 

```md
:::{include} path/to/file.md
:::
```

What it pulls in is not a black box: its headings take their place in the outline and in the section numbering, its figures, tables and equations are numbered in reading order with the host's, and its labels can be referenced from the host and the host's from it. Part of a file can be selected by line range or by markers, and `:literal:` shows it as a code block instead of parsing it.

An included file is read once per session, so editing it while the host document is open needs a reload of the editor to be seen. 

👉🏼 See [include](include.md).

### Suggestions and Completion

The editor proposes what can come next as soon as it can tell what is being written. A `:::` fence opens the list of directives, and accepting one inserts its whole skeleton: opening line, argument, the usual options, closing fence, with `Tab` moving from placeholder to placeholder. A line starting with `:` inside a directive proposes that directive's options, and those whose values form a closed set then propose the values themselves. A `{` opens the list of roles.

The proposals that matter most for a scientific document are the ones read from the document rather than from a list. `{ref}`, `{numref}`, `{eq}` and the link form `[](#label)` propose the labels the document defines -- sections, figures, tables, equations, exercises, theorems, including those brought in by an `{include}` -- each with its family, its current number and its caption, and matching runs over the caption as well as the key, so a figure can be found by what it shows when its label has been forgotten. Citations work the same way: after an `@` inside brackets, the entries of the attached `.bib` file are proposed with their author, year and title. Inside a code cell, completion comes from `jedi` running in Pyodide.

👉🏼 See [completion](completion.md).

## Python Executable Code Cells (Pyodide)

Mystral Editor integrates [Pyodide](https://pyodide.org/), which is a WebAssembly port of CPython, to support live, in-browser Python execution *directly in the document*.

A fenced code block with the `{code-cell}` directive (or ` ```{code-cell} python ` shorthand) renders as an editable Python editor cell with a **Run** button. Clicking it executes the code in the browser via Pyodide and displays stdout, return values, and errors below the cell.

```python
:::{code-cell} python
:packages: numpy

import numpy as np
print(np.linspace(0, 1, 5))
:::
```


:::{code-cell} python
:packages: numpy
:figwidth: 60%

import numpy as np
x = np.linspace(0, 1, 500)
y = np.random.randn(len(x))
plt.plot(x+y)
:::

:::{figure} figures/code-cell.gif
:name: code-cells
:alt: 
:width: 95%

Definition and excution of a code-cell, also showcasting completions and suggestions, bi-directional synchronization between source and preview.  

:::

:::{figure} figures/code-cell-vars.gif
:name: code-cells-vars
:alt: 
:width: 95%

Code-cell: example showing the variable inspector, to explore current variables, modules and functions (with the possibility to delete variables).  
:::


Supported options:

- `:packages: pkg1, pkg2` — additional packages to install via `micropip` before running
- `:linenos:` — show line numbers in the cell editor
- `:tags: hide-input` — cell metadata (for future filtering)

ℹ️ **Access to local-files** in read/write mode is supported, restricted to the Working Directory with explicit permissions (web), or in the same directory as the current file (Tauri local app).

𐃄 **Toolbar** Each cell carries a toolbar acting on itself or on the whole document: Run, Clear, Run All, Clear All, Restart, 

👁️ **Variable inspector** The **Vars** window lists what the namespace holds -- one row per variable with its type, memory footprint, shape and a short `repr`, with per-row deletion. The same information is available as text from inside a cell, with `%whos` and `%who`. 

Shortcuts are configurable in `config.json` under `pyodide.keys`.

A **`{eval}` role** evaluates a single expression in the middle of a sentence: `` {eval}`2 + 2` `` renders as its value and follows the state of the session. An approximate value of $\pi$ is {eval}`round(np.pi,4)` and of $\pi^2$ is {eval}`round(np.pi,3)**2`. Of course, calculated values in code-cells cans also be used in text: for instance, the sum of elements in $x+y$ is {eval}`np.sum(x+y)`, while its mean is {eval}`np.mean(x+y)`. 

:::{figure} figures/eval.gif
:name: eval1
:width: 95%

Demo of `{eval}`directive (1 of 2)
:::

:::{figure} figures/eval2.gif
:name: eval2
:width: 95%

Demo of `{eval}`directive (2 of 2)
:::
ℹ️ **Workspaces** Which Python  runs in each document is chosen by specifying a `python:` key in its frontmatter: 
- `shared` (the default) for the namespace common to every document that asks for nothing else,
- `isolated` for one of its own, 
- or any name, eg `lab1`,  for a namespace shared by the documents that give the same one -- several tabs that are chapters of one work, or a set of practicals.

What is separated is the variables; imported modules, matplotlib's state and the working directory stay common to the one (an only one) pyodide interpreter.

ℹ️ **Sidecar** Alongside a document the editor writes a sidecar file holding its cell outputs and a snapshot of its namespace, so reopening it shows the results *without re-running everything* and the variables come back.

Each cell editor uses the same Python syntax coloring as the main editor (`--tok-*` CSS variables), and the cell UI background adapts automatically to the active light or dark theme via `--color-background-*` variables. 

There is more information on [executable-content](executable-content.md) which covers all of it.

## Document Organization and Navigation
### Table of Contents
A collapsible, resizable left side panel displays a table of contents generated dynamically from document headings. When heading numbering is enabled, numbers appear in the panel. Clicking an entry scrolls both the editor and the preview to the corresponding section. Headings coming from an included file appear there too, in their place in the numbering, shown in italics: they belong to another file, so they cannot be dragged, and clicking one scrolls the preview alone.

**Drag-and-Drop Section Reordering**

Document sections can be reordered directly from the table-of-contents panel by drag and drop. The operation moves in the Markdown source the full text spanning from the heading to the end of its subtree.

:::{figure} figures/table-of-contents.gif
:name: toc
:alt: toc
:width: 95%

Table of contents is a collapsible and resizable panel, with drag & drop capabilities to quickly reorder document contents.  
:::

A `:::{toc}` directive (aliases: `table-of-contents`, `contents`, `toctree`) can also insert a table of contents **inline inside the document body**, where it is exported and printed with the rest. It supports an optional title argument, `:depth:` to limit the levels shown, `:context: section` to restrict the list to the section it is written in, and a `:dropdown:` flag that wraps it in a collapsible `<details>/<summary>` block. When heading numbering is active, section numbers are preserved in the inline TOC links. 

:::{figure} figures/toc.gif
:name: toc2
:alt: toc2
:width: 

Demo for inline toc (in section context).
:::

👉🏼 Also see the dedicated [toc](toc.md) document.


### Multi-Document Tabbed Editing

Several documents can be open simultaneously in a tabbed interface. Each tab maintains its own state (file, scroll position, comments, bibliography, theme). Tabs are reordered by drag and drop. Inactive tabs are suspended after a configurable timeout to limit memory use, then restored on reactivation.

:::{figure} figures/tabs.gif
:name: tabs
:alt: 
:width: 95%

Several documents on the tabbed interface, which can be reorganized by drag & drop. 
:::
  

### Section Folding

Headings can be folded individually (chevron marker in the editor gutter) or globally at load time (option `unfoldedHeadings`). The YAML frontmatter can also be folded.

### Comments

This follows MyST spec: lines starting with `%` are hidden from the preview. Keyboard shortcuts are `Mod-/ or Mod-:` to quickly comment or uncomment a line or block of text. `Mod` = `Cmd` on macOS, `Ctrl` elsewhere.

## Theming and Interface

Mystral Editor ships an explicit **light theme** alongside the dark theme, each defined as a full `CSSStyleSheet` with dedicated color tokens for the editor UI and CodeMirror syntax highlighting. Theme switching applies to both the main document and each editor's Shadow DOM.

Users can further customize the appearance with an optional `custom.css` file (scoped to `#myst-css-namespace`) that is loaded at startup and applied on top of the built-in themes. See [Customisation section](#customisation).

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

The desktop application also carries an **export menu**, which the web build cannot have since it shells out to [mystmd](https://mystmd.org): PDF, LaTeX and Word through `myst build`, an HTML export that writes out the rendered preview with the editor's stylesheets inlined, and the project-level `myst build` and `myst start` commands. When the folder has no `myst.yml`, or the document declares no export entry for the format, the editor says which is missing and offers to set both up and export in one go. See [export](export.md).

:::{figure} figures/exports.gif
:name: exports
:width: 95%

Demo of export possibilities. In Tauri apps, mystmd is called to build the output
:::

A GitHub Actions workflow (`release.yaml`) builds and signs all platform variants on every `v*` tag push, producing installer artifacts published to GitHub Releases. A `Makefile` `release` target automates version bumping, tagging and pushing.

For users who prefer a browser-based setup, a minimal Node.js server (`server.mjs`) serves the built `dist/` folder as a single-page application with `/api/file` endpoints for local file read/write, replicating the file-access layer without Tauri.

(customisation)=
## Customisation

Mystral Editor can be customised through two optional files: **`config.json`** (runtime settings) and **`custom.css`** (stylesheet overrides). Neither file is required — the app runs fine without them, falling back to built-in defaults.

- **`config.json`** accepts any subset of the keys defined in `config-defaults.js` (`suspendAfterMs`, `autosaveIntervalMs`, `shortcuts`, `pyodide.resetCwdOnRun`, etc.) as well as a `data_directives` object to extend or override the built-in MyST directive registry. An example of `config.json` can be seen on the public folder in the repo: [config.json](https://raw.githubusercontent.com/jfbercher/Mystral-Editor/refs/heads/main/src/public/config.json).

- **`custom.css`** is injected after the application stylesheet, so any CSS variable or rule defined there takes precedence.

:::{example} Css
:label: css
/* custom.css */

/* Light theme overrides */
#myst-css-namespace[data-theme="lightTheme"] {
  --tok-keyword: #8b008b;
  --tok-string: #006400;
  /* … */
}

/* Dark theme overrides */
#myst-css-namespace[data-theme="darkTheme"] {
  --tok-keyword: #ff99cc;
  --tok-string: #90ee90;
  /* … */
}

/* Unconditional override (same value in both themes) */
#myst-css-namespace {
  --tok-comment: #999999;
}
:::

Where to place these files depends on how you are running the app:
For  **Web / dev server** — put both files in `src/public/`. Vite copies them to `dist/` at build time, where they are served alongside the application bundle.

For *Tauri desktop apps*:
| Platform | Path (`appConfigDir`) |
|---|---|
| macOS | `~/Library/Application Support/MystralEditor/` |
| Linux | `~/.config/MystralEditor/` |
| Windows | `%APPDATA%\MystralEditor\` |

## Getting Started

Pre-built binaries for macOS (Apple Silicon and Intel), Linux (x64 and ARM64), and Windows are available on the [Releases page](https://github.com/jfbercher/Mystral-Editor/releases). Download the package for your platform.

Each release carries the following packages, where `x.x.x` is the version
number of the release:

:::{table} Plateforms and packages
:label: Table_of_Distributions

| System | Processor | Package |
| --- | --- | --- |
| macOS | Apple Silicon | `Mystral Editor_x.x.x_aarch64.dmg` |
| macOS | Intel | `Mystral Editor_x.x.x_x64.dmg` |
| Windows | x86-64 | `Mystral Editor_x.x.x_x64-setup.exe` (installer) or `Mystral Editor_x.x.x_x64_en-US.msi` |
| Linux | x86-64 | `Mystral Editor_x.x.x_amd64.deb`, `Mystral Editor-x.x.x-1.x86_64.rpm` or `Mystral Editor_x.x.x_amd64.AppImage` |
| Linux | ARM64 | `Mystral Editor_x.x.x_arm64.deb`, `Mystral Editor-x.x.x-1.aarch64.rpm` or `Mystral Editor_x.x.x_aarch64.AppImage` |
:::

For the website, the files must be compiled manually using the `npm run build` command, then the files generated in `/dist` directory copied to the target website.

The remaining files of a release are not meant to be downloaded by hand: the
`.app.tar.gz` archives and the `.sig` signatures belong to the automatic
updater described below, and `latest.json` is the manifest it reads.

### macOS

After downloading the `.dmg`, drag **Mystral Editor** into your Applications folder. Because the app is not notarized, macOS Gatekeeper will warn that it is from an "unidentified developer."

To open it the first time, right-click (or Control-click) the app icon and choose **Open**. When the dialog appears saying the developer cannot be verified, click **Open** to proceed. Alternatively, open **System Settings --> Privacy & Security** and click **Open Anyway** next to the blocked entry. This one-time approval is all that is needed; subsequent launches proceed normally.

### Windows

When running the installer, Windows SmartScreen may display an "Unknown publisher" warning. Click **More info** in the dialog, then click **Run anyway** to continue with the installation.

### Linux

Install the `.deb` (Debian, Ubuntu and derivatives) or the `.rpm` (Fedora, openSUSE, RHEL) with the distribution's package manager. The `.AppImage` needs no installation at all: make it executable (`chmod +x`) and run it.

### First Launch and File Associations

On first launch the app registers itself as the default handler for `.myst`, `.md`, `.markdown`, and `.txt` files. You can open documents from the OS file manager, by dragging them onto the app window, or from **File -> Open** inside the app.

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

Mystral Editor requires a few additional packages beyond the upstream baseline:

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

| Feature | Myst-Editor (upstream) | Mystral Editor  |
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
| Table of contents | Outline mode only | Collapsible side panel with numbered headings, plus an in-page `{toc}` directive with `:context:` and `:depth:` |
| Drag-and-drop reorder | Not supported | Section drag-and-drop from TOC panel |
| Heading numbering | Not supported | Configurable, synced to TOC and source |
| Themes | Dark theme only | Explicit selectable Light and Dark themes; user `custom.css` with `data-theme` attribute for per-theme overrides |
| CodeMirror syntax colors | Fixed | CSS-variable-driven (`--tok-*`), shared between editor and preview, overridable per theme via `custom.css` |
| Code block languages | Markdown only | Python sub-mode for ` ```python ` and `:::{code-cell}` fences; Pyodide live execution, per-document namespaces, variable inspector, saved outputs |
| File inclusion | Not supported | `{include}` / `{literalinclude}`, with the included headings, labels and numbers taken into the host document |
| Export | Copy HTML, print to PDF | The same in the web build; in the desktop application, PDF, LaTeX, Word and HTML through mystmd, plus `myst build` and `myst start` |
| MyST autocompletion | Not supported | Roles, directives, cross-ref targets, BibTeX keys |
| Section folding | Collapsible heading marker | Chevron gutter marker, frontmatter fold |
| Desktop app | No | macOS, Linux, Windows (Tauri); file associations; auto-updater |
| Release pipeline | Not applicable | GitHub Actions cross-platform CI, Makefile versioning |
