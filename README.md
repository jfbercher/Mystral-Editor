
[![License](https://img.shields.io/pypi/l/labquizbundle.svg)](https://pypi.org/project/labquizbundle/)
[![Documentation Status](https://readthedocs.org/projects/mystral-editor/badge/?version=latest)](https://mystral-editor.readthedocs.io/en/latest/)   

Sponsor:

[![ESIEE Paris](https://github.com/jfbercher/labquiz/raw/main/esiee_logo_moyen.png)](https://www.esiee.fr)   



**[Mystral Editor](https://github.com/jfbercher/Mystral-Editor)** is a lightweight, offline-capable editor with large [MyST Markdown](https://myst-parser.readthedocs.io/) support and live-preview, oriented toward academic documents, with equations, bibliography management, automatic numbering of floating elements and structured navigation.

[Mystral Editor](https://github.com/jfbercher/Mystral-Editor) begun as a fork of [Myst-Editor](https://github.com/antmicro/myst-editor/) by Antmicro, a web Markdown editor built on the [MyST Markdown](https://myst-parser.readthedocs.io/) syntax. Where Myst-Editor is designed as an embeddable Preact component for collaborative editing in web applications, Mystral Editor uses it as an infrastructure to build a full-featured scientific authoring tool for local use, while keeping all of Myst-Editor's strengths. Beyond the editor itself, MyST is backed by the [MySTmd ecosystem](https://mystmd.org/): a set of open-source tools that can compile the same source files into polished LaTeX manuscripts and PDF output, Word documents, and entire documentation websites (via Jupyter Book or the MyST site builder). 


---
👉🏼 📑 **[Mystral Documentation available at readthedocs](https://mystral-editor.readthedocs.io/en/latest/)**.

--- 

## What distinguishes Mystral

* ****A complete, offline MyST editor, with no server or build chain.**** What the preview displays is what `myst build` will produce: numbering, cross-references, bibliography, and mathematical macros.
* ****Executable Python code-cells directly in the document****, powered by Pyodide: no kernel, no installation, and no network connection once loaded, — and results persist across sessions.
* ****Four viewing modes****, including an **inline** mode that renders each block in place and opens only the block containing the cursor in source mode.
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

Mystral uses **`mystmd` for PDF, LaTeX, and Word exports**, with project-specific templates, and can produce self-contained HTML from the preview. MyST project commands (`build`, `start`) and inherited frontmatter from `myst.yml` are integrated into the application.

## Configuration and customization

The editor is extensively customizable through documented `config.json` settings, `custom.css` and CSS variables, keyboard shortcuts, Vim mode, and CodeMirror themes. Custom transformations can also convert application-specific syntax into HTML.

## Inherited from Myst-Editor, and preserved

* ****Real-time collaborative editing**** (Yjs/CRDT), with remote cursors and avatars.
* ****CriticMarkup suggestions****, which can be accepted or rejected, together with a ****diff view**** against the initial state.
* ****Configurable Hunspell spell checking**** and ****document templates**** loadable from JSON.



The original Myst-Editor is distributed under an Apache 2.0 license. The two following files list the Additions and Modifications over the original Editor (as required by the Apache 2.0 license): 

- [List of Additions](docs/additions.md)
- [List of Modifications](docs/modifications.md)

---
 📑 `Documentation` available at [readthedocs](https://mystral-editor.readthedocs.io/en/latest/).
