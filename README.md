
[![License](https://img.shields.io/pypi/l/labquizbundle.svg)](https://pypi.org/project/labquizbundle/)
[![Documentation Status](https://readthedocs.org/projects/mystral-editor/badge/?version=latest)](https://mystral-editor.readthedocs.io/en/latest/)   

Sponsor:

[![ESIEE Paris](https://github.com/jfbercher/labquiz/raw/main/esiee_logo_moyen.png)](https://www.esiee.fr)   



**[Mystral Editor](https://github.com/jfbercher/Mystral-Editor)** is a lightweight, offline-capable editor with large [MyST Markdown](https://myst-parser.readthedocs.io/) support and live-preview, oriented toward academic documents, with equations, bibliography management, automatic numbering of floating elements and structured navigation.

[Mystral Editor](https://github.com/jfbercher/Mystral-Editor) begun as a fork of [Myst-Editor](https://github.com/antmicro/myst-editor/) by Antmicro, a web Markdown editor built on the [MyST Markdown](https://myst-parser.readthedocs.io/) syntax. Where Myst-Editor is designed as an embeddable Preact component for collaborative editing in web applications, Mystral Editor uses it as an infrastructure to build a full-featured scientific authoring tool for local use, while keeping all of Myst-Editor's strengths. Beyond the editor itself, MyST is backed by the [MySTmd ecosystem](https://mystmd.org/): a set of open-source tools that can compile the same source files into polished LaTeX manuscripts and PDF output, Word documents, and entire documentation websites (via Jupyter Book or the MyST site builder). 


---
👉🏼 📑 **[Mystral Documentation available at readthedocs](https://mystral-editor.readthedocs.io/en/latest/)**.

--- 

![](./docs/figures/demo.gif)

## What distinguishes Mystral

* ****A complete, offline scientific MyST editor, with no server or build chain.**** What the preview displays is what `myst build` will produce: numbering, cross-references, bibliography, and mathematical macros.
* ****Executable Python code-cells directly in the document****, powered by Pyodide: no kernel, no installation, and no network connection once loaded, — and results persist across sessions.
* **A slide mode**, dedicated to slide preparation *and* a slideshow mode (with live execution of code-cells).
* Reads markdown, yaml files; import/export jupyter notebook *ipynb* files. Exports your documents as LaTeX, PDF, DOC, HTML, and build full websites through mystmd. 
* ****Six viewing modes****, including an *inline* mode that renders each block in place and opens only the block containing the cursor in source mode; a embedded view of the *generated MyST website*, and preview of *slides*. 
* ****One codebase, two forms****: a desktop application for macOS, Windows, and Linux (x86-64 and ARM64) with local file system access, or a web application deployable anywhere without installation.

## Scientific authoring

Mystral provides full **scientific authoring** with KaTeX-rendered and automatically numbered LaTeX equations, document-specific macros, configurable numbering for headings, figures, tables, equations,... , and live cross-references with hover previews. Per-document **BibTeX bibliographies**, footnotes, and enhanced, collapsible admonitions (`note`, `tips`, `warning`, `theorem`, `exercise`, `solution`, etc.) are also supported.

## Executable content

**`{code-cell}`** blocks provide editable, executable Python with persistent namespaces, text and graphical output, and matplotlib figures, while **`{eval}`** embeds computed values directly in prose. A variable inspector and *sidecar* files preserve state and outputs, SVG figures remain fully zoomable, and additional packages can be installed with `micropip`.

## Suggestions and completions

Mystral provides context-aware completion for **directives, options, document labels, and BibTeX keys**, including searchable labels and references. Python cells offer `jedi` completion with signatures and docstrings.

## Document organization

A **collapsible document outline** makes it possible to navigate and *reorder sections by drag and drop*; while `{toc}` and `{include}` integrate tables of contents and external files with the document's numbering and cross-references. Sections can be collapsed, documents opened in tabs, and comments anchored to the text.

## Export

Mystral uses **`mystmd` for PDF, LaTeX, and Word exports**, with project-specific templates, and can produce self-contained HTML from the preview. MyST project commands (`build`, `start`) and inherited frontmatter from `myst.yml` are integrated into the application. **Jupyter notebooks** can also be opened directly, converted to MyST Markdown on the fly, and written back out as `.ipynb` -- the conversion carries code and text, not cell outputs.

## Configuration and customization

The editor is extensively customizable through documented `config.json` settings, `custom.css` and CSS variables, keyboard shortcuts, Vim mode, and CodeMirror themes. Custom transformations can also convert application-specific syntax into HTML.

## Inherited from Myst-Editor, and preserved

* ****Real-time collaborative editing**** (Yjs/CRDT), with remote cursors and avatars.
* ****CriticMarkup suggestions****, which can be accepted or rejected, together with a ****diff view**** against the initial state.
* ****Configurable Hunspell spell checking**** and ****document templates**** loadable from JSON.



The original Myst-Editor is distributed under an Apache 2.0 license. The two following files list the Additions and Modifications over the original Editor (as required by the Apache 2.0 license): 

- [List of Additions](docs/additions.md)
- [List of Modifications](docs/modifications.md)

## Getting Started

Pre-built binaries for macOS (Apple Silicon and Intel), Linux (x64 and ARM64), and Windows are available on the [Releases page](https://github.com/jfbercher/Mystral-Editor/releases). Download the package for your platform.

Each release carries the following packages, where `x.x.x` is the version number of the release:


| System | Processor | Package |
| --- | --- | --- |
| macOS | Apple Silicon | `Mystral Editor_x.x.x_aarch64.dmg` |
| macOS | Intel | `Mystral Editor_x.x.x_x64.dmg` |
| Windows | x86-64 | `Mystral Editor_x.x.x_x64-setup.exe` (installer) or `Mystral Editor_x.x.x_x64_en-US.msi` |
| Linux | x86-64 | `Mystral Editor_x.x.x_amd64.deb`, `Mystral Editor-x.x.x-1.x86_64.rpm` or `Mystral Editor_x.x.x_amd64.AppImage` |
| Linux | ARM64 | `Mystral Editor_x.x.x_arm64.deb`, `Mystral Editor-x.x.x-1.aarch64.rpm` or `Mystral Editor_x.x.x_aarch64.AppImage` |

For the website, the files must be compiled manually using the `npm run build` command, then the files generated in `/dist` directory copied to the target website.

The remaining files of a release are not meant to be downloaded by hand: the `.app.tar.gz` archives and the `.sig` signatures belong to the automatic updater described below, and `latest.json` is the manifest it reads.

### macOS

After downloading the `.dmg`, drag **Mystral Editor** into your Applications folder. Because the app is not notarized, macOS Gatekeeper will warn that it is from an "unidentified developer."

> To open it the first time, right-click (or Control-click) the app icon and choose **Open**. When the dialog appears saying the developer cannot be verified, click **Open** to proceed. Alternatively, open **System Settings --> Privacy & Security** and click **Open Anyway** next to the blocked entry. This one-time approval is all that is needed; subsequent launches proceed normally.

### Windows

> When running the installer, Windows SmartScreen may display an "Unknown publisher" warning. Click **More info** in the dialog, then click **Run anyway** to continue with the installation.

### Linux

Install the `.deb` (Debian, Ubuntu and derivatives) or the `.rpm` (Fedora, openSUSE, RHEL) with the distribution's package manager. The `.AppImage` needs no installation at all: make it executable (`chmod +x`) and run it.

### All plateforms

👉🏼 If you want to take advantage of the export features — *and that would be a good idea*, to export your documents to LaTeX, PDF, or Docx, or even to generate a complete website, you’ll need to have a working installation of `mystmd`, if you don’t already have one. Indeed, the exports are produced by mystmd, which the editor runs as an external command; it is not bundled. Two things have to be in place, in this order.

1. First **Node.js, version 22 or later**. mystmd is written in JavaScript and runs under Node, so this is its prerequisite rather than ours — install it following [these instructions](https://mystmd.org/guide/install-node) or with your usual package manager, taking the current LTS.

2. Then **mystmd**, following [its own installation instructions](https://mystmd.org/guide/installing) — npm, pip or conda, as suits your machine.

Nothing else is needed: the first time an export runs, the editor finds both commands and records where they are in `config.json`, as `export.mystPath` and `export.nodePath`. If it cannot find them it says so, and those two settings let you point at them yourself; see [Customisation](customisation.md).

---
 📑  Full `Documentation` available at [readthedocs](https://mystral-editor.readthedocs.io/en/latest/).
 
--- 
