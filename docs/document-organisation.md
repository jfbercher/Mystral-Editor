---
title: Document Organization and Navigation
---

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