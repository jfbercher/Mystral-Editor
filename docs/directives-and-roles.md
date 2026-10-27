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

A `[](#label)` link with no text of its own is filled in entirely — "Figure 3",
"(2)", and so on. A link that carries its own text may place the target's values
in it, with the placeholders mystmd defines:

| Placeholder | Inserts |
|---|---|
| `{number}` | The number of the target. |
| `%s` | The same, in its legacy spelling. |
| `{name}` | The name of the target: the text of the heading, the caption when it has one, and the label itself when it has neither. |

```
[Exercise {number}](#my-exercise)      ->  Exercise 4
[see {name}](#sec:method)              ->  see Method and materials
```


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
| `proof:theorem`, `proof:lemma`, `proof:corollary`, `proof:proposition`, `proof:property`, `proof:axiom`, `proof:conjecture`, `proof:observation`, `proof:criterion`, `proof:assumption`, `proof:definition`, `proof:example`, `proof:remark`, `proof:proof`, `proof:algorithm` | This work |
| `exercise`, `solution` | This work |
| `exercise-start` / `exercise-end`, `solution-start` / `solution-end` | This work |
:::

These are the fifteen kinds mystmd knows, and each is also accepted under the `prf:` prefix and under its bare name -- `{prf:theorem}` and `{theorem}` are the same directive as `{proof:theorem}`, share its numbering and its label, and differ only in what they become outside the editor. `mystmd` registers these directives under `prf:<kind>` and, since version 1.11.0, under `proof:<kind>`; it knows no bare `{theorem}`, and an unknown directive loses its content at parse time, so a bare one disappears from a LaTeX, PDF or Word export without a trace in the document. The `proof:` form is therefore the one the editor proposes and the one to write; `prf:` is its equivalent for an older `mystmd`, and the bare names are kept for the documents that already use them.

Numbering is configured per family under the unprefixed name: a single `theorem:` entry in the frontmatter governs the three spellings. Each statement counts on its own -- Theorem 1, Theorem 2, Proposition 1 -- with one exception: `lemma` shares the theorem counter, as it does in LaTeX. Putting two of them back on a single sequence is a matter of giving them the same `kind` in the registry. One difference with an exported PDF remains: LaTeX resets most of these counters at every section, numbering them 2.1 and 2.2, where the numbers here run through the document.

The `-start` / `-end` pairs open and close a numbered block around arbitrary content, for cases where the body cannot be nested inside a directive. The `solution` refers back to the exercise it answers rather than carrying a number of its own.

A reference to a solution is therefore written with the exercise's number: `[](#my-solution)` and `` {ref}`my-solution` `` both render as *Solution to Exercise 1*. The joining word comes from `data_directives.solution.refJoiner` in `config.json` (`"to"` by default), and the two names from the `label` of the `solution` and `exercise` entries, so a document in another language renames all three. A solution whose exercise has no number shows the bare word.

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
| `show-index` | This work | Prints the document's index: everything marked with the `{index}` role, in alphabetical order, each term linking back to its occurrences — see *Index*, below |
| `list-of-figures`, `list-of-tables`, and the LaTeX aliases `listoffigures`, `listoftables` | This work | Lists the document's figures, or its tables: number and caption, each linking to its figure. In a LaTeX export they become `\listoffigures` / `\listoftables` — see *Lists of figures and tables*, below |
| `raw` | This work, for the preview only | A block handed verbatim to one output format, named as the argument or in `:format:`. mystmd handles it; what is added here is the preview, which used to show the grey « unknown directive » frame and so reported an error where there is none. It is shown as the literal text it is, labelled with the format it is written for |
:::

### Abbreviations  

The `{abbr}` role carries its own definition, as MyST specifies:

```
{abbr}`FFT (Fast Fourier Transform)`
```

A document — or its project — can instead declare them once in the frontmatter, after which **every occurrence in ordinary prose** carries its definition, with nothing written at the point of use:

```yaml
---
abbreviations:
  MyST: Markedly Structured Text
  FFT: Fast Fourier Transform
---
```

It is worth being clear that this is not a table the role consults; the shape invites that reading and it is wrong. The role already knows its definition. What the frontmatter asks for is something the role cannot do — that words nobody marked become abbreviations — so it is a pass over the rendered text.

Only prose is touched. A term inside inline code or a code block is left alone, and so is anything the `{abbr}` role has already wrapped. A term is recognised standing on its own: `FFTW` is not an `FFT` followed by a stray letter. The longest declared term wins where two overlap.

The definitions are inherited from the project, since they are read from the effective frontmatter: declared once in `myst.yml`, recognised in every document of the project.

### Index  

A term is marked where it is used, and the index is printed where you want it:

```
The {index}`Fourier transform` turns convolution into a product.

:::{show-index}
:::
```

The role shows its text and nothing else — an index entry should not announce itself in the sentence — and `{show-index}` lists every marked term alphabetically, each one linking back to its occurrences, numbered in document order. There are no page numbers to give: the page is the whole document.

Four forms are understood, the ones MyST documents:

| Written | Shown | Filed under |
| --- | --- | --- |
| `` {index}`Fourier transform` `` | Fourier transform | *Fourier transform* |
| `` {index}`the transform <Fourier transform>` `` | the transform | *Fourier transform* |
| `` {index}`pair: transform; Fourier` `` | transform, Fourier | *transform* → Fourier, and *Fourier* → transform |
| `` {index}`see: FFT; Fourier transform` `` | FFT | *FFT*, pointing at Fourier transform |

`single:` is the default and may be written out; `triple:` and `seealso:` work the same way as `pair:` and `see:`. A term marked inside a code block is left alone, as code should be.

Two deliberate limits. A `triple: a; b; c` is filed three ways — each term with the other two — where Sphinx files it six; three is enough to find a term from any of the three, which is what an index is for. And the index is a document's, not a project's: `{show-index}` collects what this file marks, included files included, and knows nothing of its neighbours.

### Lists of figures and tables

A document that is going to be printed usually wants them, and MyST has no directive for either, so these two are this fork's:

```
:::{list-of-figures}
:::

:::{list-of-tables}
:title: Tables
:::
```

What is shown is deliberately plain: the number and the caption, nothing else. A page number would be a lie — the preview has no pages — and a section would say more about the document's structure than about its figures. Every figure is listed, whether or not it is numbered: a list that silently dropped the unnumbered ones would be read as a list of all of them. A caption links to its figure when the figure carries a `:label:`, since that is the only case where there is an anchor to link to.

The optional `:title:` prints a heading above the list. It is an option rather than a heading written by hand because a heading written by hand would appear in the table of contents, which is rarely what is wanted of a list of figures.

The LaTeX spellings `{listoffigures}` and `{listoftables}` are accepted as aliases, for the author who writes them without thinking.

Both survive an export. `myst-plugins/float-lists.mjs`, installed into the project alongside the other plugins, teaches mystmd the two directives and turns each into a raw LaTeX node — `\listoffigures`, `\listoftables` — so LaTeX builds the list from the figures it has itself numbered, with its own page numbers. Nothing is emitted for the HTML site, for Word or for Typst: a raw node written for LaTeX is skipped by every other writer. That is a decision rather than an omission; a site has a sidebar and a search box, and a list of figures there would be furniture nobody asked for.

A figure or a table can say what its own entry should read:

```
:::{figure} plot.png
:label: fig-spectra

The measured spectra of the three samples, with the fitted envelope and the residuals below.

% shortcaption: Measured spectra
:::
```

A comment rather than an option, and the reason is mystmd: an option it does not know draws an « unexpected option » warning on every build and is thrown away before any plugin can read it, while a comment passes in silence and arrives in the tree. The editor shows the short form in its own `{list-of-figures}`, so what you see beside the number is what will be printed.

It must be written **after** the caption. mystmd takes the first block of a figure's body for its caption, so a comment placed first *becomes* the caption and the real one is demoted; the export plugin repairs that case rather than letting the caption vanish, but the rule is simpler than the repair.

The text is plain: it is a comment, which nothing parses, so a `%` or an `&` in it is printed rather than obeyed, and italics or math cannot be had this way. That is the price of a short caption that cannot break the LaTeX run — and it keeps the printed list identical to the one the editor shows.

The captions that declare nothing can be shortened automatically, by first sentence or by a budget in characters. It is off by default, since a caption printed in full is never wrong:

```yaml
---
shortCaptions: sentence     # or a number of characters, e.g. 60
---
```

The key is read from the document's frontmatter, from the project's `myst.yml` through `extends`, or from the editor's own `export.shortCaptions` — in that order, the document having the last word, as for `slides:`. mystmd reports it as an extra key it ignores, which it is: nothing in the export depends on mystmd knowing it. The editor applies the same rule to its own `{list-of-figures}` and `{list-of-tables}`, from the same shared code, so that the list you proof-read is the list that will be printed.

One repair travels with them. `myst-to-tex` writes every caption as `\caption[]{…}`, and the brackets are LaTeX's *short* caption — exactly what the two lists print. Written empty, they give a list of numbers with nothing beside them, which is invisible until the day a document asks for the list. The export's `.tex` post-processing drops the empty brackets, so LaTeX falls back on the real caption; a long caption therefore appears in the list in full, which is what the author wrote and what they alone can shorten.

(Roles)=
## Roles

:::{table} Roles
:label: roles

| Role | Origin | Notes |
| --- | --- | --- |
| `eq` | Library | Reference to a numbered equation |
| `ref` | Library | Reference to a label |
| `numref` | Library | Numbered reference, `%s` substituted with the number |
| `proof:ref`, `prf:ref` | This work | `numref` under the names mystmd gives it for the proof family |
| `math` | Library | Inline mathematics |
| `abbr`, `abbreviation` | Library | Abbreviation with a title |
| `sub`, `subscript`, `sup`, `superscript` | Library | |
| `raw` | Library | |
| `cite` | This work | A bibliography citation; `[@key]` is the usual spelling |
| `eval` | This work | Evaluates a Python expression and inserts its value in the text flow |
| `abbr`, `abbreviation` | markdown-it-docutils | An abbreviation and its definition: `` {abbr}`FFT (Fast Fourier Transform)` ``. Terms declared in the frontmatter are recognised in prose without it — see *Abbreviations*, above |
| `index` | This work | Marks a term for the index, showing it and nothing more. `single`, `pair`, `triple`, `see` and `seealso` prefixes, and the `text <term>` form — see *Index*, above |

:::

The three reference roles — `eq`, `ref`, `numref` — are the ones Library already supported, and they are used here **unchanged**. `proof:ref` and `prf:ref` are added as aliases of `numref`, which is what they are in mystmd: there, only the kind `ref` substitutes the target's title, every other kind goes through the numbered template. Writing `` {proof:ref}`my-theorem` `` therefore renders *Theorem 1* here and exports as it stands. 
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
