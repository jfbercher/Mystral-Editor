# Directives and roles

What this editor understands, and where each piece comes from. Three origins
are distinguished throughout:

**Library** — provided by `markdown-it-docutils`, the MyST parser this editor
builds on, and used as it ships.

**Upstream** — present in `antmicro/myst-editor`, the project this one is
forked from, at the point of the fork (February 2025).

**Fork** — added or rewritten here.

The distinction matters when reading someone else's MyST document: a directive
marked *Library* or *Upstream* behaves as the ecosystem expects, while the
others carry behaviour of our own.

## Directives

### Numbered content and cross-references

The fork's central addition is a shared numbering and cross-reference system.
Every directive below can take a `(label)=` anchor or a `:label:` option, gets a
number when its kind is numbered, and can be pointed at from `{ref}`, `{numref}`
or a `[](#label)` link. Which kinds are numbered, and under which words, is set
by the `data_directives` registry in `config.json` — see
[customisation](customisation.md).

| Directive | Origin | Notes |
| --- | --- | --- |
| `figure` | Library, rewritten | Numbered captions, alignment, explicit labels resolved through the shared reference map |
| `figure-md` | Upstream, rewritten | A figure whose caption is Markdown; kept for compatibility with existing documents |
| `figure-perso` | Fork | Alias of the rewritten `figure`, retained while documents migrate |
| `image` | Library | Unchanged. Counts as a figure kind for numbering, unnumbered by default |
| `table` | Upstream, rewritten | Numbered captions and labels; the upstream version numbered per render, which broke across chunks |
| `list-table` | Library, rewritten | Same numbering treatment, plus alignment options |
| `math` | Library, rewritten | Equation numbering, `:label:` and `:enumerated:` |

### Admonitions

`admonition`, and the ten kinds `attention`, `caution`, `danger`, `error`,
`hint`, `important`, `note`, `seealso`, `tip`, `warning`.

All come from the library and are all rewritten here: they accept an optional
**title argument**, an `:open:` flag, and render as a collapsible
`<details>/<summary>` block when given the `dropdown` class. `note` is numbered
by default in the shipped registry; the others are not.

### Proofs, theorems and exercises

| Directive | Origin |
| --- | --- |
| `proof`, `theorem`, `lemma`, `corollary`, `definition`, `example`, `remark`, `algorithm` | Fork |
| `exercise`, `solution` | Fork |
| `exercise-start` / `exercise-end`, `solution-start` / `solution-end` | Fork |

The `-start` / `-end` pairs open and close a numbered block around arbitrary
content, for cases where the body cannot be nested inside a directive.
`solution` refers back to the exercise it answers rather than carrying a number
of its own.

### Executable content

| Directive | Origin | Notes |
| --- | --- | --- |
| `code-cell` | Library name, rewritten | A Python cell run by Pyodide, with its own editor and toolbar. See [executable-content](executable-content.md) |
| `code`, `code-block` | Library | Unchanged, static code blocks |

### Document structure

| Directive | Origin | Notes |
| --- | --- | --- |
| `toc`, and the aliases `table-of-contents`, `tableofcontents`, `contents`, `toctree` | Fork | Table of contents built from the document's headings, with `:depth:`, `:context:`, `:dropdown:` |
| `include`, `literalinclude` | Fork | Inserts another file, parsed as MyST or shown as a code block |

## Roles

| Role | Origin | Notes |
| --- | --- | --- |
| `eq` | Library | Reference to a numbered equation |
| `ref` | Library | Reference to a label |
| `numref` | Library | Numbered reference, `%s` substituted with the number |
| `math` | Library | Inline mathematics |
| `abbr`, `abbreviation` | Library | Abbreviation with a title |
| `sub`, `subscript`, `sup`, `superscript` | Library | |
| `raw` | Library | |
| `cite` | Fork | A bibliography citation; `[@key]` is the usual spelling |
| `eval` | Fork | Evaluates a Python expression and inserts its value in the text flow |

The three reference roles — `eq`, `ref`, `numref` — are the ones upstream
already supported, and they are used here **unchanged**. What changed beneath
them is what they point at: the fork resolves labels through a document-wide
reference map instead of a per-render counter, so a reference stays correct
across the chunked rendering, and now reaches every numbered kind above rather
than equations and figures alone.

## Other MyST syntax

Not directives or roles, but part of what the editor renders, and all added by
the fork: `%` line comments, footnotes (`[^1]`), reference-style links
(`[text][ref]`), BibTeX citations (`[@key]`) with a `[bibliography]` marker,
Mermaid diagrams (as a fenced `mermaid` block), and heading numbering driven by
the *Number headers* setting.

## Extending the set

`config.json` does not add directives; it configures how the ones above are
numbered and labelled, through `data_directives`. Genuinely new directives and
roles are supplied by the host page when the editor is embedded, through the
`customDirectives` and `customRoles` options — a transform per target name.
