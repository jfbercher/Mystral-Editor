# Table of contents in the page

`{toc}` inserts a table of contents built from the document's own headings. It
is the in-page counterpart of the side outline, and unlike it, what it produces
is part of the document: it is exported and printed with the rest.

```
:::{toc}
:::
```

The directive takes no content. An argument, if given, becomes the title shown
above the list. The aliases `table-of-contents`, `tableofcontents`, `contents`
and `toctree` are the same directive.

## Scope: `:context:`

By default the list covers the whole page. `:context: section` restricts it to
the section the directive is written in — the last heading that opens before
it — and lists that section's own subsections.

```
## Method

:::{toc}
:context: section
:depth: 1
:::
```

written under *2. Method*, lists 2.1, 2.2, 2.3 and nothing else. The numbers
shown are the document's, so a sectioned table of contents reads 2.1 and not 1.

`:kind:` is an alias of `:context:`.

Two of mystmd's values need a multi-page project, which the editor does not
have: `:context: children` and `:context: project` fall back to listing the
page, with a warning in the browser console saying so. They are accepted rather
than refused, so that a document written for a myst project renders here
without being edited.

## Depth

`:depth:` limits how many levels are shown, counted **below the context**. On a
page-wide table of contents `:depth: 2` lists chapters and their sections; on a
sectioned one it lists that section's subsections and their own children.
`:maxdepth:` is an alias.

Without it, everything is listed.

## Appearance

`:dropdown:` renders the list as a collapsible `<details>` block, closed by
default, with the title as its summary — "Contents" when no title is given.
`:open:` starts it expanded. Putting `dropdown` in `:class:` does the same as
`:dropdown:`.

`:class:` adds classes to the block, and `:label:` (alias `:name:`) gives it an
id so it can be referenced.

`:enumerated:` (alias `:numbered:`) concerns the numbering of the list itself.
The section numbers that appear in the entries come from the document's own
heading numbering, which is switched on in the editor's settings, not here.

## Included files

Headings pulled in by `{include}` are part of the document, so they appear in
the table of contents in their place, with the numbers they have in the running
text. See [include](include.md).
