# Mystral Editor Documentation and Notes


These few pages contain documentation and notes for the Mystral Editor (work in progress).

[Mystral Editor - Presentation](<Mystral Editor - Presentation.md>) introduces the editor and its features. [directives-and-roles](directives-and-roles.md) lists every directive and role the editor understands, saying for each whether it comes from the MyST library, from the upstream editor, or from this fork. [frontmatter-extends](frontmatter-extends.md) explains how a document inherits frontmatter from shared YAML files. [executable-content](executable-content.md) covers the Python code cells: writing and running them, what Pyodide can and cannot do, the variable inspector and the keyboard shortcuts. [customisation](customisation.md) documents every key of `config.json` and the `custom.css` hook, and [myst-editor-css-variables](myst-editor-css-variables.md) lists the CSS variables it refers to. [additions](additions.md) and [modifications](modifications.md) record what this fork adds to, and changes in, `antmicro/myst-editor`. The two installation guides cover the warnings macOS and Windows show for an unsigned application.

```{toctree}
:hidden:

Mystral Editor - Presentation.md
directives-and-roles.md
frontmatter-extends.md
executable-content.md
customisation.md
myst-editor-css-variables.md
additions.md
modifications.md
macos_app_installation_guide.md
windows_app_installation_guide.md
```
