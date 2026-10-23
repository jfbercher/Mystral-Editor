---
title: Exporting a document
---


The editor produces three kinds of output, and which ones are offered depends on where it runs.

## What has to be installed first

Exports are produced by mystmd, which the editor runs as an external command; it is not bundled. Two things have to be in place, in this order.

1. First **Node.js, version 22 or later**. mystmd is written in JavaScript and runs under Node, so this is its prerequisite rather than ours — install it following [these instructions](https://mystmd.org/guide/install-node) or with your usual package manager, taking the current LTS[^node].


[^node]: An older Node is worse than none: a version 20 builds documents well enough to look healthy, then fails in the site server with a message naming neither Node nor a version. If mystmd offers to install a Node for itself, the editor declines on your behalf, because what it installs has been a release below its own requirement

2. Then **mystmd**, following [its own installation instructions](https://mystmd.org/guide/installing) — npm, pip or conda, as suits your machine.

Nothing else is needed: the first time an export runs, the editor finds both commands and records where they are in `config.json`, as `export.mystPath` and `export.nodePath`. If it cannot find them it says so, and those two settings let you point at them yourself; see [Customisation](customisation.md).

## From the desktop application: the 📦 menu
The export menu shells out to [mystmd](https://mystmd.org), so it exists in the desktop application only — the web build cannot run a command. Clicking the button directly exports to PDF, the most common case; its menu offers the rest.

**Export PDF**, **Export LaTeX** and **Export Word (docx)** run `myst build <file> --<format>` in the document's folder. The document is saved first, so what is exported is what is on screen and not the last saved revision. The result lands in `_build/exports/` and is opened with whatever the system uses for that file type — except LaTeX, which is usually an intermediate to process further rather than something to read immediately.

:::{figure} figures/exports.gif
:name: exports
:width: 95%

Demo of export possibilities. In Tauri apps, mystmd is called to build the output, according to the templates defined in document's frontmatter.
:::

A PDF built through LaTeX (see `export.pdfViaTex`) is a special case: mystmd gives a LaTeX export a folder of its own, and the PDF is produced there, among the `.aux` and `.fls` files. The editor copies it up into `_build/exports/` so that it sits beside the other exports, under the document's own name, and leaves the original where latexmk expects to find it on the next run. The rename matters more than it looks: myst names an export after the page's slug, and the slug of a project's index page — the first entry of the `toc` in `myst.yml` — is `index` whatever the file is called, so a PDF of `lesson-three.md` would otherwise arrive as `index.pdf`. The `.tex` keeps the name myst gave it.

Myst slugifies the name by rules of its own, and a docx export may land as `.doc` depending on the template. The editor looks for every plausible extension and takes the newest, which is why a stale export beside a fresh one does not confuse it.

**Export HTML (rendered)** is different: it writes out the preview as it stands, with the stylesheets the editor is using inlined, so the file opens anywhere and looks as it does on screen. It needs no myst project. It also needs the preview to be open, since that is what it copies.

**myst build (whole project)** runs a plain `myst build` over everything `myst.yml` declares. **Start the MyST site** runs `myst start` and opens the local preview; the same entry then stops it.

### What myst needs, and what the editor offers to set up
`myst build --pdf` needs two things the editor cannot invent: a project, that is a `myst.yml` in the folder, and an entry for that format in the document's frontmatter. `mystmd` has no default for either.

When one is missing, the export is refused with a message naming what is missing and a button that sets it up and exports in one go: `myst init --site --write-toc` for the project, and an `exports:` entry appended to the frontmatter for the format.

```yaml
---
exports:
  - format: pdf
---
```

A `template:` line is written only when `config.json` names one for that format, under `export.templates`. `mystmd` ships no default template (therefore inventing one here would silently change how every export looks).

### The plugins the editor installs

Two things a document does here have no equivalent in `mystmd` and would vanish
from every export without help: what the Pyodide cells computed, which `mystmd`
never executed and therefore knows nothing about, and the `exercise` /
`solution` pair, which it parses and then has no writer for. Two small mystmd
plugins carry both across.

They are written into `myst-plugins/` beside `myst.yml` when the editor sets a
project up, and declared there:

```yaml
project:
  plugins:
    - myst-plugins/exercise-admonition.mjs
    - myst-plugins/pyodide-outputs.mjs
  static_files:
    - _build/pyodide
```

In the project rather than referenced from the application, so that the project
builds for anyone who opens it, with `myst build` alone and without this
editor. They are kept in step with the application — rewritten when they differ,
before an export, a build or a site start — but `myst.yml` itself is never
touched again after the project is created. **A project made before this
existed, or set up by hand, needs those lines added once.** Without them
nothing fails: the figures are simply absent, which is the hardest kind of
defect to attribute.

`static_files` is what makes the cell images reachable from the site: the
editor writes them under `_build/pyodide`, and that entry copies the folder
into the site's public folder under its own name.

### Cells that stay executable on the site

The figures the editor computed travel into the site as they are, so a reader
sees them straight away. If the document also declares a `kernelspec`, the same
cells can be re-run in the reader's browser, the result replacing the figure in
place:

```yaml
---
kernelspec:
  name: python3
  display_name: 'Python 3'
---
```

and, in the project file:

```yaml
project:
  jupyter:
    lite: true
```

`kernelspec` is what decides, document by document: without it a page is never
executed and keeps the editor's figures; with it the page becomes replayable.
`jupyter.lite` is the in-browser kernel (JupyterLite), loaded on demand — a
reader who never presses Run pays nothing for it. The editor writes
`jupyter: lite: true` when it creates a project; `kernelspec` is yours to add,
since it is a statement about that document.

`myst start --execute` exists as well and is rarely what you want: it computes
the outputs at build time with a **local** Jupyter kernel — so it needs one
installed, with your packages — and its results are cached and then take
precedence for good. The editor's own figures already provide the initial state
without any of that.

### The project file as a model for the exports

The entry has to be in the **document's** frontmatter, not only in the project's `myst.yml`: `myst build <file>` reads the page's own block, and an export declared only in the project is built with the default template as though it had not been declared at all. Declaring it per file is therefore not a preference but what mystmd requires.

The project file is still the place to write it once. When the document has no entry for the format and the project does, the button offered with the message reads *Copy the project's entry and export*, and it copies that entry whole -- `template`, `article_type`, `chapters`, whatever it carries -- into the document's frontmatter before building. `myst.yml` is thus the model the documents are filled from, and what lands in a document is an ordinary edit, visible and undoable, that the author remains free to adjust afterwards.

`export.mystPath` is the command used to invoke myst. It may be a path or a whole command line, `npx myst` for instance.

Left empty, the plain name is used, and that is enough while the application is started from a terminal -- in development, typically. A bundled application launched from the desktop inherits no terminal environment, and the login shell it runs its commands through reads `/etc/profile` and `~/.profile`, never `~/.zprofile` or `~/.zshrc`, where a macOS user's `PATH` additions usually live. `myst` then appears to have vanished.

Rather than leave that to be discovered, the editor looks for it the first time a command is not found: a handful of usual locations first, which costs nothing, then an interactive login shell, which is slower but reads `~/.zshrc` and so finds an nvm or volta installation. What it finds is written into `config.json` as `export.mystPath`, and said in a message, so the search happens once and never again. `export.mystSearchPaths` adds locations of your own to the list. `export.sitePort` is the port `myst start` uses. See [customisation](customisation.md).

### Directives mystmd does not know
What leaves the editor is the source, not the rendered preview: `mystmd` parses the document again, with its own set of directives. One it does not know is not left as it is and is not reported in the exported file -- it is emptied of its content at parse time, so the block and everything inside it are simply absent from the PDF, the LaTeX or the Word file, while `myst build` says `unknown directive: <name>` in its output.

This matters for the proof family, which `mystmd` registers only as `proof:theorem` and `prf:theorem`, never as a bare `theorem`: write the prefixed form in a document meant to be exported (see [directives and roles](directives-and-roles.md)). The `exercise` and `solution` pair, [described here](https://mystmd.org/guide/exercises), has no writer at all in `mystmd`: the nodes are parsed and then dropped silently. The editor's own plugin brings them back as titled admonitions, numbered as mystmd numbered them, in every static export — see *The plugins the editor installs* above. (A [plugin of the same spirit](https://github.com/jupyter-book/myst-plugins/tree/main/plugins/exercise-admonition-pdf) exists upstream for PDF builds.)

### Labels of the proof family: lowercase only
A theorem, a proposition or any other member of the proof family must be given a **lowercase** label in a document meant to be exported. `mystmd` writes its anchor in the `.tex` with the normalised form of the label, which is lowercased, while it writes every cross-reference with the label as it was typed: a `:label: My-Theorem` therefore produces `\label{my-theorem}` and `\ref{My-Theorem}` in the same file, LaTeX resolves neither, and the number comes out as `??` in the PDF. An issue has been open on that. Headings, equations, figures and tables are not affected -- their handlers write the label unchanged.

Nothing in the editor itself needs this, which is why the case is underlined in the source as a warning: everything resolves correctly in the preview, and the problem only appears in the exported document. This is a bug in `myst-to-tex` rather than a rule of MyST, so both the warning and this paragraph are meant to disappear once it is fixed upstream.

## Web build
The web build has no myst, since it cannot execute local commands, so it offers the two things a page can do on its own, in the top bar: **Copy document as HTML** puts the rendered document on the clipboard, and **Print document as pdf** opens the browser's print dialogue, from which "*Save as PDF*" produces a file. Both are hidden in the desktop application, which has the export menu instead.

## Jupyter notebooks
A `.ipynb` file can be opened like any other document: it is converted to MyST Markdown as it is read, and *Save As* offers `.ipynb` among its formats to write one back. The conversion carries the code cells, their options and the prose; it does not carry the stored outputs, nor the kernel metadata, so a notebook written from the editor comes back with its cells unexecuted. Opening a notebook never modifies it: in the desktop application the editor works on a Markdown file beside it, which the first save creates, and in the browser the document starts out unattached, so the first save asks where to write it.

## PDF: which route to choose
The two PDF routes are not the same thing, and the difference matters for a scientific document. Printing from the browser prints the preview: it is immediate, needs nothing installed, and gives you the document as the editor renders it. The command `myst build --pdf` goes through LaTeX and produces a typeset document — proper floats, a bibliography, a template that a journal may require — at the cost of a working mystmd and TeX installation.

Use the first to read or circulate a draft, the second to produce the paper.
