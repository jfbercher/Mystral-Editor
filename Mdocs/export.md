---
title: Exporting a document
extends: mdocs_fm.yml
---


The editor produces three kinds of output, and which ones are offered depends
on where it runs.

## From the desktop application: the 📦 menu

The export menu shells out to [mystmd (https://mystmd.org), so it exists in the desktop application only — the web build cannot run a command. Clicking the button directly exports to PDF, the most common case; its menu offers the rest.

**Export PDF**, **Export LaTeX** and **Export Word (docx)** run `myst build <file> --<format>` in the document's folder. The document is saved first, so what is exported is what is on screen and not the last saved revision. The result lands in `_build/exports/` and is opened with whatever the system uses for that file type — except LaTeX, which is usually an intermediate to process further rather than something to read.

The file myst writes is found rather than guessed: myst slugifies the name by rules of its own, and a docx export may land as `.doc` depending on the template. The editor looks for every plausible extension and takes the newest, which is why a stale export beside a fresh one does not confuse it.

**Export HTML (rendered)** is different: it writes out the preview as it stands, with the stylesheets the editor is using inlined, so the file opens anywhere and looks as it does on screen. It needs no myst project. It also needs the preview to be open, since that is what it copies.

**myst build (whole project)** runs a plain `myst build` over everything
`myst.yml` declares. **Start the MyST site** runs `myst start` and opens the
local preview; the same entry then stops it.

### What myst needs, and what the editor offers to set up

`myst build --pdf` needs two things the editor cannot invent: a project, that
is a `myst.yml` in the folder, and an entry for that format in the document's
frontmatter. myst has no default for either.

When one is missing, the export is refused with a message naming what is
missing and a button that sets it up and exports in one go: `myst init --site
--write-toc` for the project, and an `exports:` entry appended to the
frontmatter for the format.

```yaml
---
exports:
  - format: pdf
---
```

A `template:` line is written only when `config.json` names one for that format,
under `export.templates`. myst ships no default template, and inventing one
would silently change how every export looks.

`export.mystPath` is the command used to invoke myst. It runs through a login
shell, so the plain name works as long as it is on the `PATH` of your shell
profile; set an absolute path if it is installed somewhere unusual.
`export.sitePort` is the port `myst start` uses. See
[customisation](customisation.md).

## From the browser

The web build has no myst, so it offers the two things a page can do on its own,
in the top bar: **Copy document as HTML** puts the rendered document on the
clipboard, and **Print document as pdf** opens the browser's print dialogue,
from which "Save as PDF" produces a file. Both are hidden in the desktop
application, which has the export menu instead.

## PDF: which route to choose

The two PDF routes are not the same thing, and the difference matters for a
scientific document. Printing from the browser prints the preview: it is
immediate, needs nothing installed, and gives you the document as the editor
renders it. `myst build --pdf` goes through LaTeX and produces a typeset
document — proper floats, a bibliography, a template that a journal may
require — at the cost of a working mystmd and TeX installation.

Use the first to read or circulate a draft, the second to produce the paper.
