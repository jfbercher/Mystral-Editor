---
title: Python Executable Code Cells (Pyodide)
---

Mystral Editor integrates [Pyodide](https://pyodide.org/), which is a WebAssembly port of CPython, to support live, in-browser Python execution *directly in the document*.

A fenced code block with the `{code-cell}` directive (or ` ```{code-cell} python ` shorthand) renders as an editable Python editor cell with a **Run** button. Clicking it executes the code in the browser via Pyodide and displays stdout, return values, and errors below the cell.

```python
:::{code-cell} python
:packages: numpy

import numpy as np
print(np.linspace(0, 1, 5))
:::
```


:::{code-cell} python
:packages: numpy
:figwidth: 60%

import numpy as np
x = np.linspace(0, 1, 500)
y = np.random.randn(len(x))
plt.plot(x+y)
:::

:::{figure} figures/code-cell.gif
:name: code-cells
:alt: 
:width: 95%

Definition and excution of a code-cell, also showcasting completions and suggestions, bi-directional synchronization between source and preview.  

:::

:::{figure} figures/code-cell-vars.gif
:name: code-cells-vars
:alt: 
:width: 95%

Code-cell: example showing the variable inspector, to explore current variables, modules and functions (with the possibility to delete variables).  
:::


Supported options:

- `:packages: pkg1, pkg2` — additional packages to install via `micropip` before running
- `:linenos:` — show line numbers in the cell editor
- `:tags: hide-input` — cell metadata (for future filtering)

ℹ️ **Access to local-files** in read/write mode is supported, restricted to the Working Directory with explicit permissions (web), or in the same directory as the current file (Tauri local app).

𐃄 **Toolbar** Each cell carries a toolbar acting on itself or on the whole document: Run, Clear, Run All, Clear All, Restart, 

👁️ **Variable inspector** The **Vars** window lists what the namespace holds -- one row per variable with its type, memory footprint, shape and a short `repr`, with per-row deletion. The same information is available as text from inside a cell, with `%whos` and `%who`. 

Shortcuts are configurable in `config.json` under `pyodide.keys`.

A **`{eval}` role** evaluates a single expression in the middle of a sentence: `` {eval}`2 + 2` `` renders as its value and follows the state of the session. An approximate value of $\pi$ is {eval}`round(np.pi,4)` and of $\pi^2$ is {eval}`round(np.pi,3)**2`. Of course, calculated values in code-cells cans also be used in text: for instance, the sum of elements in $x+y$ is {eval}`np.sum(x+y)`, while its mean is {eval}`np.mean(x+y)`. 

:::{figure} figures/eval.gif
:name: eval1
:width: 95%

Demo of `{eval}`directive (1 of 2)
:::

:::{figure} figures/eval2.gif
:name: eval2
:width: 95%

Demo of `{eval}`directive (2 of 2)
:::
ℹ️ **Workspaces** Which Python  runs in each document is chosen by specifying a `python:` key in its frontmatter: 
- `shared` (the default) for the namespace common to every document that asks for nothing else,
- `isolated` for one of its own, 
- or any name, eg `lab1`,  for a namespace shared by the documents that give the same one -- several tabs that are chapters of one work, or a set of practicals.

What is separated is the variables; imported modules, matplotlib's state and the working directory stay common to the one (an only one) pyodide interpreter.

ℹ️ **Sidecar** Alongside a document the editor writes a sidecar file holding its cell outputs and a snapshot of its namespace, so reopening it shows the results *without re-running everything* and the variables come back.

Each cell editor uses the same Python syntax coloring as the main editor (`--tok-*` CSS variables), and the cell UI background adapts automatically to the active light or dark theme via `--color-background-*` variables. 

There is more information on [executable-content](executable-content.md) which covers all of it.
---
title: A title
subtitle: A subtitle
authors:
  - author names, one per line
date: 2026-09-19
license: GPL-3.0-or-later
github: https://github.com/jfbercher/Mystral-Editor
bibliography: references.bib
citation-style: author-year # or numeric
citation-template: "{authors} ({year}). *{title}*. {container}{volume}{pages}.{doilink}"
settings:
    myst_to_tex:
        code_style: listings
    output_stderr: remove
    output_matplotlib_strings: remove
exports:
  - format: docx
  - format: pdf
    template: arxiv_nips
    article_type: article
    chapters: []
numbering:
  headings: true # activate headings numbering
  equations: true 
  figure: true
    #template: Fig. %s # Define the prefix
math:
  '\sha': 'ш'
  '\dr': '\mathrm{d}#1'
  '\wb': '\mathbf{w}' 
---


:::{toc} Contents
::: 

## First section

