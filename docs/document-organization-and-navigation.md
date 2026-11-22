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

### Bookmarks

A bookmark is a place one comes back to: the section being rewritten, the cell that is misbehaving, the paragraph to show someone tomorrow. Click in the narrow column left of the text — the one beside the comment markers — or press `Mod-Shift-b`, and the line is marked; `Mod-Shift-n` and `Mod-Alt-n` go from one to the next and back, cycling, so a document with three bookmarks is toured by pressing one key.

What is written in the document is a MyST comment:

```
% bookmark
## The section being worked on
```

which mystmd drops from every output and the preview never shows, exactly as it does for `% slide-vspace:`. Two consequences are worth knowing. The bookmarks travel with the file — through git, and to whoever you send it to, who will see them in their own editor — and nothing can drift out of step with the text, since a bookmark *is* a line of it rather than a position recorded elsewhere. The price is that placing one modifies the document: one undo step, and the modified marker. Anything written after the word is yours, a note to yourself that the editor ignores: `% bookmark à revoir avec M.`

Clicking the marked line removes its bookmark, as does clicking the marker line itself.

They are also listed at the foot of the table of contents, under the outline, and a click there goes straight to one — which is how you reach the third without passing through the first two. An entry shows what you wrote after the word, if you wrote anything; otherwise it borrows the line it marks, so a bookmark on a heading names itself. The list is read from the document's text rather than from the editor, so it answers in the preview-only mode as well.

### Comments

This follows MyST spec: lines starting with `%` are hidden from the preview. Keyboard shortcuts are `Mod-/ or Mod-:` to quickly comment or uncomment a line or block of text. `Mod` = `Cmd` on macOS, `Ctrl` elsewhere.

**HTML comments are not the same thing.** A `<!-- … -->` is HTML, so it reaches
the preview as HTML: invisible, which is what one wants, but obeying HTML's
rule rather than MyST's. A comment that is **never closed** swallows everything
after it -- not a defect of the editor but what CommonMark prescribes for an
unterminated HTML block, and what mystmd does at build time too, so the document
would be published with the same hole. The symptom is unmistakable: the
rendering disappears from that point to the next heading, which is where the
preview cuts its chunks. If a passage vanishes for no reason, look for a `<!--`
above it. A `%` comment has no such trap, since it ends with its line.

