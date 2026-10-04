---
title: Differences vs Myst-Editor (Summary)
---

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
