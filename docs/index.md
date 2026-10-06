# Mystral Editor Documentation and Notes


These few pages contain documentation and notes for the Mystral Editor (work in progress).

- [Mystral Editor - Presentation](presentation.md) introduces the editor and its features.

Then a series of deeper and more technical notes follows:

- [additions](additions.md) and [modifications](modifications.md) record what this editor, begun as a fork of `antmicro/myst-editor` adds to it and changes in it.
- [directives-and-roles](directives-and-roles.md) lists every directive and role the editor understands, saying for each whether it comes from the markdown-it.docutils library, from the original upstream editor, or from this work.
- [completion](completion.md) describes the suggestions the editor offers while typing -- directives, options, roles, labels, citations and Python.
- [executable-content](executable-content.md) covers the Python code cells: writing and running them, what Pyodide can and cannot do, the variable inspector and the keyboard shortcuts.
- [export](export.md) covers the PDF, LaTeX, Word and HTML exports and the MyST project commands.
- [project-frontmatter-extends](project-frontmatter-extends.md) explains how a document inherits its settings from the project's `myst.yml`,
- [include](include.md) explains how a document pulls in another file, with the headings, labels and numbers that come with it, and [toc](toc.md) documents the in-page table of contents.
- [customisation](customisation.md) documents every key of `config.json` and the `custom.css` hook, and [myst-editor-css-variables](myst-editor-css-variables.md) lists the CSS variables it refers to.
- [keyboard_shortcuts_en](keyboard_shortcuts_en.md) lists the editor's bindings, including those of the code cells.
- The two installation guides cover the warnings macOS and Windows show for an unsigned application.

```{toctree}
:hidden:

Mystral Editor - Presentation.md
directives-and-roles.md
frontmatter-extends.md
include.md
toc.md
completion.md
executable-content.md
export.md
keyboard_shortcuts_en.md
customisation.md
myst-editor-css-variables.md
additions.md
modifications.md
macos_app_installation_guide.md
windows_app_installation_guide.md
```
