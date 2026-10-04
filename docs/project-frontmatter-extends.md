---
title: Project frontmatter and `myst.yml`
---


A document rarely stands alone. The settings a set of documents shares — math macros, authorship, numbering, the bibliography, the exports to produce — belong to the project rather than to each file, and are written once in the project's `myst.yml`. Each document then inherits them, and may override or complete any of them in its own frontmatter.

```yaml
# myst.yml, beside the documents
version: 1
project:
  authors:
    - jfbercher
  numbering:
    headings: true
    equations: true
  bibliography:
    - references.bib
  exports:
    - format: pdf
      template: arxiv_nips
```

```
---
title: Signal processing, lab 3
numbering:
  headings: false
---
```

gives that document the project's authors, equation numbering, bibliography and PDF export, with heading numbering turned off for it alone.

This is mystmd's own model, and it is why the editor follows it: the preview shows what `myst build` will produce, and an export declared in the project is an export the document really has.

## Where the project file is looked for?

In the desktop application, beside the document. Opening a file in another folder picks up that folder's project, so two documents of two different projects can be open side by side.

In a local web session, in the working folder, which has to be chosen first, as for any other local file.

In a deployed web build there is no folder to read from, so the file is fetched from the root of the site: a `myst.yml` placed in `public/` before building ends up there and is found.

A missing `myst.yml` is not an error. A single document without a project shall simply carries everything in its own frontmatter.

## `extends` inside the project file

A project file may itself inherit, through `extends`, so that several projects
share one set of settings:

```yaml
version: 1
extends: ../shared/common.yml
project:
  title: Lab notes
```

It is read both at the top level, where mystmd documents it, and inside `project:`, where it is also commonly written. Several files are given as a list and applied in the order written. The file named is read beside the project file; it is a plain YAML file holding the keys a frontmatter would hold, and it needs no `---` fences of its own — adding them produces *expected a single document in the stream, but found more* in the browser console (and an error in mystmd). It may itself carry an `extends`, up to five levels deep.

Remote URLs are not fetched: an entry starting with `http://` or `https://` is ignored, with a message in the console. A file that names itself, or two files that name each other, are reported and ignored rather than followed.

```{warning}
`extends` in a **document's** frontmatter is not a MyST key. mystmd accepts it in `myst.yml` only, so the editor ignores it too  (honouring it would make the preview disagree with the build). A document that still carries one gets a message in the browser console; move those settings to the project file.
```

## How values are merged

Three rules, following mystmd.

**Lists are combined, not replaced.** Authors declared in the project and in the document all appear in the result. `exports` and `downloads` are deduplicated by `id`, which is how an inherited entry is overridden rather than added to.

**Objects are merged key by key.** A project that sets `numbering.headings` and `numbering.figure` keeps `numbering.figure` when a document sets only `numbering.headings`.

**Anything else written in the document wins.** A title, a date, a citation style declared locally replaces the inherited one.

The same rules apply between a project file and what its own `extends` names.

## Exports: the project file as a model

`exports` is the one key a document cannot simply inherit. `myst build <file>` reads the page's own frontmatter, so an export declared only in `myst.yml` is built with the default template as though it had not been declared.

The project file is still where to write it once. When a document has no entry for the format being exported and the project has one, the editor offers to copy that entry whole into the document before building. The project file acts as a model the documents are filled from, and what lands in a document is an ordinary edit the author stays free to change. See [export](export.md).

## What it affects

Everything the frontmatter drives: math macros, heading and figure numbering, the bibliography path and citation style, the Python namespace of the code cells, the `exports` the desktop build writes, and the block rendered at the top
of the document.

The project file is read when the document renders. Editing it updates the documents that belong to it the next time they are rendered, i.e. reopening the tab, or any edit.
