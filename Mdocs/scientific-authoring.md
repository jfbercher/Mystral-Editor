---
title: Scientific Authoring
---

This is a major contribution of Mystral Editor over upstream.

### Equations and Mathematics

LaTeX equations are rendered via [KaTeX](https://katex.org/) and [markdown-it-texmath](https://github.com/goessner/markdown-it-texmath). Per-editor math macro maps are supported. Numbered equation blocks and cross-references (`{eq}`, `{numref}`) are resolved automatically.

:::{figure} /figures/equations.gif
:name: typing-equations
:alt: Typing equations in Mystral
:width: 95%

Inserting equations in Mystral - supports standard LaTeX as well as `math`directive. Equations can be labelled and referenced anywhere in the document. 
:::

### YAML Frontmatter

A YAML metadata block at the head of the document (title, authors, date, DOI, venue, license, GitHub link) is rendered as a formatted bibliographic header. The block is displayed as a collapsible section in the editor. A YAML language server can be activated via an external JSON schema for tooltips and autocompletion.

An `extends:` key lets a document inherit its frontmatter from one or more shared YAML files, so that the settings common to a set of documents -- numbering, citation style, math macros, export entries -- are written once. Lists are combined, objects deep-merged, and the document's own values win. See [frontmatter-extends](frontmatter-extends.md).

:::{figure} figures/front-matter.gif
:name: front-matter
:alt: Front matter samll demo
:width: 95%

Shows a frontmatter defined via `extends` of an original -- shared, frontmatter. A key is changed to demonstrate enabling/disabling a numbering counter (here figure numbering). Also, the demo shows the collapsible table of contents in the left. 
:::

### BibTeX Bibliography

A `.bib` file is associated with each tab. Citations are inserted with the `[@cle]` syntax and a `[bibliography]` marker generates the reference list.

- Two citation styles: **numeric** and **author-year**
- Customizable bibliography rendering template
- Hover preview of a cited reference
- BibTeX key autocompletion in the editor

:::{figure} figures/bibliography.gif
:name: biblio
:alt: Demo on bibliography
:width: 95%

Insertion of some bibliography references contained in a bibTeX file. This showcast insertion with popup suggestions, as well as popup previews in the preview window. 
:::

:::{figure} figures/bibliography-fm.gif
:name: biblio-fm
:alt: Demo on frontmatter & bibliography 
:width: 95%

Changing bibliography style in front-matter. 
:::

### Numbering and Cross-References

Figures, tables, equations and sections are numbered automatically. Labels are declared with the standard MyST syntax (`(label)=`). References (`{ref}`, `{eq}`, `{numref}`) are resolved and their text updated dynamically. A popover preview shows the referenced element on link hover.

Numbering is enabled or disabled per element type in the document's own frontmatter, under `numbering:` (`headings`, `equations`, `figure`, …). `config.json` is where the *labels* live -- which directives are numbered and under what name -- through its `data_directives` table. See an example in [](#front-matter).

### Footnotes

Standard Markdown footnotes are supported, numbered in order of first appearance, with backlinks from the note to its inline reference.

**Example — Source:**

```md
Here is a sentence with a note[^1] inline.

[^1]: This is the content of the footnote.
```

Here is a sentence with a note[^mynote] inline.

[^mynote]: This is really the content of the footnote.

:::{figure} figures/footnote.gif
:name: footnote
:alt: Fottnote demo
:width: 95%

Inserting a footnote.
:::


The inline marker renders as a superscript link. At the end of the document, Mystral Editor collects all definitions and generates a numbered *Footnotes* section with backlinks to each inline reference.

### Enhanced Admonitions

MyST admonitions are extended:

- **Optional free title**
- **Collapsible mode** (`details`/`summary` HTML) with `open` option (pre-expanded) or collapsed by default
- **New types**: `theorem`, `exercise`, `solution`
- Support for `align`, `icon`, and other options

**Example — Source:**

```md
:::{note} A custom title
:class: dropdown

This admonition has a **title** and is collapsible.
Add `:open:` to start it pre-expanded.
:::
```


:::{figure} figures/admonition.gif
:name: admonition
:alt: Admonition
:width: 95%

Example of admonitions with completions, dropdown, custom title, with or without icon.
:::

:::{figure} figures/admonition2.gif
:name: admonition2
:alt: Admonition2
:width: 95%

Example of admonition (continued) with a change of type.
:::


:::{note} A custom title
:class: dropdown
This admonition has a **title** and is collapsible.
Add `:open:` to start it pre-expanded.
:::

This renders as a `<details>`/`<summary>` block: the icon and custom title form the summary bar, and the body stays hidden until the user clicks to expand it.

### Figures and Tables

The `figure`, `table` and `list-table` directives support alignment (left, center, right) and scaling. Captions are numbered and cross-referenceable.

**Example — Source:**

```md
(fig:result)=
:::{figure} images/result.png
:align: center
:width: 50%

Results for the experiment.
:::

See {ref}`fig:result` ([](#fig:result)) for details.
```

:::{figure} images/result.png
:name: fig:result
:alt: Results
:width: 40%
:align: center

Results of the experiment
:::

See {ref}`fig:result` ([](#fig:result)) for details.

The figure renders centered, with the automatic caption "Figure 1: Results for the experiment." The `{numref}` role resolves to the hyperlinked text "Figure 1". Tables follow the same pattern using the `list-table` directive with a `(tab:label)=` anchor above it.

:::{figure} figures/figures.gif
:name: Fig
:alt: Fig demo
:width: 95%

A demo for figure insertion
:::



### Including Other Files

An `{include}` directive inserts another file into the document, parsed as MyST -- a shared preamble, a chapter split across files, a set of exercises reused from one document to the next. 

```md
:::{include} path/to/file.md
:::
```

What it pulls in is not a black box: its headings take their place in the outline and in the section numbering, its figures, tables and equations are numbered in reading order with the host's, and its labels can be referenced from the host and the host's from it. Part of a file can be selected by line range or by markers, and `:literal:` shows it as a code block instead of parsing it.

An included file is read once per session, so editing it while the host document is open needs a reload of the editor to be seen. 

👉🏼 See [include](include.md).

### Suggestions and Completion

The editor proposes what can come next as soon as it can tell what is being written. A `:::` fence opens the list of directives, and accepting one inserts its whole skeleton: opening line, argument, the usual options, closing fence, with `Tab` moving from placeholder to placeholder. A line starting with `:` inside a directive proposes that directive's options, and those whose values form a closed set then propose the values themselves. A `{` opens the list of roles.

The proposals that matter most for a scientific document are the ones read from the document rather than from a list. `{ref}`, `{numref}`, `{eq}` and the link form `[](#label)` propose the labels the document defines -- sections, figures, tables, equations, exercises, theorems, including those brought in by an `{include}` -- each with its family, its current number and its caption, and matching runs over the caption as well as the key, so a figure can be found by what it shows when its label has been forgotten. Citations work the same way: after an `@` inside brackets, the entries of the attached `.bib` file are proposed with their author, year and title. Inside a code cell, completion comes from `jedi` running in Pyodide.

👉🏼 See [completion](completion.md).