# Inheriting frontmatter with `extends`

A document's frontmatter can inherit from one or more YAML files, so that
settings shared by several documents — math macros, authorship, funding,
export definitions, numbering — are written once and reused.

```
---
extends: shared/common.yml
title: Signal processing, lab 3
---
```

Several files are given as a list, and are applied in the order written:

```
---
extends:
  - ../shared/authors.yml
  - ../shared/macros.yml
---
```

Paths are relative to the document, as for images and `{include}`. The
inherited file is a plain YAML file holding the keys a frontmatter would hold;
it needs no `---` fences of its own. It may itself carry an `extends`, up to
five levels deep.

## How values are merged

Three rules, following mystmd.

**Lists are combined, not replaced.** Authors declared in the shared file and
in the document all appear in the result. `exports` and `downloads` are
deduplicated by `id`, which is how an inherited entry is overridden rather than
added to.

**Objects are deep-merged**, key by key, so a shared `numbering` block can be
adjusted on one key without restating the others.

**Anything else written in the document wins.** A string, a number, or a value
whose type differs from the inherited one replaces it.

A worked example. With `shared/common.yml`:

```yaml
authors:
  - name: Jean-François Bercher
numbering:
  headings: true
  figure: true
math:
  \R: \mathbb{R}
exports:
  - id: pdf
    format: pdf
    template: plain_latex
```

and, in the document:

```
---
extends: shared/common.yml
title: Lab 3
authors:
  - name: A. Student
numbering:
  headings: false
exports:
  - id: pdf
    format: pdf
    template: arxiv_nips
---
```

the effective frontmatter has both authors, `numbering.headings` false while
`numbering.figure` stays true, the `\R` macro, and a single `pdf` export using
`arxiv_nips` — the shared entry replaced by the local one, having the same
`id`.

## What it affects

Everything the frontmatter drives: math macros, heading and figure numbering,
the bibliography path and citation style, the `exports` the desktop build
writes, and the block rendered at the top of the document.

The inherited file is read when the document renders. Editing it updates the
documents that extend it the next time they are rendered — reopening the tab,
or any edit.

## Limits

Remote URLs are not fetched. An entry starting with `http://` or `https://` is
ignored, with a message in the browser console.

The file is read through the working folder, so in a browser one has to be
selected first, as for any other local file. In the desktop application the
path is resolved next to the document.

A file that names itself, or two files that name each other, are reported in
the console and ignored rather than followed.
