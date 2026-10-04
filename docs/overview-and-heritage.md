---
title: Overview
---

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