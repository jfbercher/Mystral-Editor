---
title: Directives and roles
extends: mdocs_fm.yml
---

This document presents what directives and roles Mystral Editor understands, and where each piece comes from. 

Three origins are distinguished throughout:

- **Library** — provided by [markdown-it-docutils](https://github.com/executablebooks/markdown-it-docutils), the MyST parser this editor builds on, and used as it ships.

- **Upstream** — present in `antmicro/myst-editor`, the original basis of this project, at the point of the fork (February 2025).

- **This work** — added or rewritten here.

The distinction matters when reading someone else's MyST document: a directive marked *Library* or *Upstream* behaves as these expects, while the others carry behaviour of our own, usually by enhancing the support of [MyST specifications](https://mystmd.org/spec).

## Nesting directives

A directive written inside another must use **fewer** fence characters than the
one around it:

```
::::{note}

:::{image} portrait.jpg
:width: 40%
:::

The text of the note.

::::
```

The reason is that a closing fence is a line made of the fence character alone,
so a bare `:::` closes the innermost block that is open, and nothing says which
one was meant. Written with three colons on both, the outer note is closed by
the image's fence: what follows falls outside it, and the last `:::` closes
nothing. The document is mis-structured without any error being raised -- it
simply renders wrong.

Because the mistake is silent, the editor underlines a closing fence that closes
nothing, with the reason on hover. That mark is the symptom; the cure is to
lengthen the outer fence.

## Directives

### Numbered content and cross-references

This work's central addition is a shared numbering and cross-reference system.
Every directive below can take a `(label)=` anchor or a `:label:` option, gets a number when its kind is numbered, and can be pointed at from `{ref}`, `{numref}` or a `[](#label)` link. Which kinds are numbered, and under which words, is set by the `data_directives` registry in `config.json` — see [customisation](customisation.md). 
👉🏼 This work resolves labels through a document-wide reference map. Anchors are posed upstream (through `:name:` option) but links do not redirect to the element - a numbered class is also posed but has no effect). There was no support for equations. The document-wide reference map enables a reference to remain correct across the chunked rendering (which breaks upstream, since the markdown-it-docutils uses local counters -- chunked rendering has the interest of speed and potential progressive rendering). Every numbered kind below is supported in the current implementation (numbering was not supported Upstream). 
Roles, presented [](#Roles), also follow the same logic. 

:::{table} Directives's origins
:label: directives_origins


| Directive | Origin | Notes |
| --- | --- | --- |
| `figure` | Library, rewritten | Numbered captions, alignment, explicit labels resolved through the shared reference map |
| `figure-md` | Upstream, rewritten | A figure whose caption is Markdown |
| `image` | Library | Unchanged. Counts as a figure kind for numbering, unnumbered by default |
| `table` | Upstream, rewritten | Numbered captions and labels; the upstream version numbered per render, which broke across chunks |
| `list-table` | Library, rewritten | Same numbering treatment, plus alignment options |
| `math` | Library, rewritten | Equation numbering, plus `:label:` and `:enumerated:` options |
:::

### Admonitions

The supported admonitions, or *call-out* are: `admonition`, and the ten kinds `attention`, `caution`, `danger`, `error`, `hint`, `important`, `note`, `seealso`, `tip`, `warning`.

All come from the library and are all rewritten here: they accept an optional **title argument**, an `:open:` flag, and render as a collapsible `<details>/<summary>` block when given the `dropdown` class. The `note` admonition is numbered by default in the shipped registry; the others are not.

### Proofs, theorems and exercises

:::{table} Proofs, theorems and exercises
:label: proofs

| Directive | Origin |
| --- | --- |
| `proof`, `theorem`, `lemma`, `corollary`, `definition`, `example`, `remark`, `algorithm` | This work |
| `exercise`, `solution` | This work |
| `exercise-start` / `exercise-end`, `solution-start` / `solution-end` | This work |
:::

The `-start` / `-end` pairs open and close a numbered block around arbitrary content, for cases where the body cannot be nested inside a directive. The `solution` refers back to the exercise it answers rather than carrying a number of its own.

### Executable content

This is an important addition in Mystral Editor: the existing placeholder `code-cell`is enhanced as a true Python cell run by Pyodide, with its own editor and toolbar.

:::{table} Executable content
:label: executable_content

| Directive | Origin | Notes |
| --- | --- | --- |
| `code-cell` | Library name, fully rewritten | A Python cell run by Pyodide is introduced, with its own editor and toolbar. See [executable-content](executable-content.md) |
| `code`, `code-block` | Library | Unchanged, static code blocks |
:::

### Document structure

Two directives are added that address or enhance the documents stucture. The `toc` enable to include (partial) table of contents anywhere in the document. The directive `include` does what its name suggests : include content in currect document. Specific documentations are available: [toc](toc.md), [include](include.md).

:::{table} Document structure
:label: document_structure

| Directive | Origin | Notes |
| --- | --- | --- |
| `toc`, and the aliases `table-of-contents`, `tableofcontents`, `contents`, `toctree` | This work | Table of contents built from the document's headings, with `:depth:`, `:context:`, `:dropdown:` — see [toc](toc.md) |
| `include`, `literalinclude` | This work | Inserts another file, parsed as MyST or shown as a code block — see [include](include.md) |
:::

(Roles)=
## Roles

:::{table} Roles
:label: roles

| Role | Origin | Notes |
| --- | --- | --- |
| `eq` | Library | Reference to a numbered equation |
| `ref` | Library | Reference to a label |
| `numref` | Library | Numbered reference, `%s` substituted with the number |
| `math` | Library | Inline mathematics |
| `abbr`, `abbreviation` | Library | Abbreviation with a title |
| `sub`, `subscript`, `sup`, `superscript` | Library | |
| `raw` | Library | |
| `cite` | This work | A bibliography citation; `[@key]` is the usual spelling |
| `eval` | This work | Evaluates a Python expression and inserts its value in the text flow |

:::

The three reference roles — `eq`, `ref`, `numref` — are the ones Library already supported, and they are used here **unchanged**. 
👉🏼 What *really changed* beneath them is what they point to something: this work resolves labels through a document-wide reference map. 

## Other MyST syntax

Not directives or roles, but part of what the editor renders, and all added in this work (also see [the general presentation](./presentation.md)). 
- `%` line comments: each line starting with a % is not rendered at all. Keyboard shortcuts are `Mod-/ or Mod-:` to quickly comment or uncomment a line or block of text. `Mod` = `Cmd` on macOS, `Ctrl` elsewhere.
- footnotes (`[^1]`)
- reference-style links (`[text][ref]`),
- BibTeX citations (`[@key]`) with a `[bibliography]` marker,
- and heading numbering driven by the *Number headers* setting.

Mermaid diagrams (as a fenced `mermaid` block) were added upstream. 

## Notes 

### `include`: labels are shared with included files

- Labels form one namespace for the document and everything it includes, and so do the numbers: a figure inside an included file is numbered in reading order along with the host's, and its headings take their place in the outline and in the section numbering. The complementary doc [include](include.md) covers this.

Two definitions of the same label are a conflict, not a merge. The host's definition wins, and the clash is reported on screen as well as in the browser console, naming the file and line of each definition. Prefixing the labels of a file meant to be reused is the usual way to avoid it.

### Frontmatter: `python`

A document's frontmatter chooses the Python namespace its code cells run in: `shared` (the default) for the namespace common to every document that asks for nothing else, `isolated` for one of its own, or a name for a namespace shared by the documents that give the same one. Variables are what is separated; imported modules, matplotlib's state and the working directory stay common. The complementary doc [executable-content](executable-content.md) covers it.

### Frontmatter: inheriting from the project

A document inherits the frontmatter written in its project's `myst.yml`, which may itself inherit from other YAML files through `extends`. Lists are combined, objects deep-merged, and the document's own values win. `extends` written in a document's own frontmatter is not a MyST key and is ignored, as mystmd ignores it.
The complementary doc [frontmatter-extends](frontmatter-extends.md) covers it.

### Extending the set of Directives and Roles

The config file `config.json` does not add directives; it configures how the ones above are numbered and labelled, through `data_directives`. Genuinely new directives and roles can be supplied by the host page when the editor is embedded, through the `customDirectives` and `customRoles` options - a transform per target name.
