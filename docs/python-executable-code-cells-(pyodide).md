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

A **`{eval}` role** evaluates a single expression in the middle of a sentence: `` {eval}`2 + 2` `` renders as its value and follows the state of the session. An approximate value of $\pi$ is {eval}`round(np.pi,2)` and of $\pi^2$ is {eval}`round(np.pi,3)**2`. Of course, calculated values in code-cells cans also be used in text: for instance, the sum of elements in $x+y$ is {eval}`np.sum(x+y)`, while its mean is {eval}`np.mean(x+y)`. 

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

What `{eval}` inserts is a result and not a string: an object that knows how to draw itself -- a DataFrame, a figure -- is drawn, through the `_repr_html_` / `_repr_svg_` / `_repr_png_` protocol Jupyter made standard. A plotting call is the one case that protocol does not cover, since `plt.plot(x)` returns a list of `Line2D` and draws into the current figure; the role therefore shows what the expression drew, as a notebook does. Two limits are worth knowing: a *live* widget cannot be inserted this way, since it would need a host surviving the re-render of its chunk, and on an HTML site `{eval}` is never re-evaluated -- its value is the one the editor computed, and a document exported without a run carries none.

🧪 **Quizzes** -- A `{quiz}` directive integrates the **[labquiz](https://github.com/jfbercher/labquiz)** package: `:::{quiz} qz quiz7` shows a button that, pressed, displays the quiz in the preview and grades it there.

```
:::{quiz} qz quiz7
:button: Questionnaire
:dropdown: Answers
:::
```

It is actually a *code-cell* running `qz.show('quiz7')`, dressed as a button. A quiz is a live widget: it needs a host that survives the re-render of its chunk, an output area the labquiz shim can draw into and a place in the kernel, all of which a cell already is. Unfolding it gives back the toolbar and the code; a failure is reduced to its last line, since a reader of a button cannot see the lines a traceback names. On an HTML site the directive becomes a real executable cell, and as the editor declares `jupyter.lite` the quiz is playable there. In a PDF, nothing: the export removes it. See [directives-and-roles](directives-and-roles.md) for the full description.

ℹ️ **Workspaces** Which Python  runs in each document is chosen by specifying a `python:` key in its frontmatter: 
- `shared` (the default) for the namespace common to every document that asks for nothing else,
- `isolated` for one of its own, 
- or any name, eg `lab1`,  for a namespace shared by the documents that give the same one -- several tabs that are chapters of one work, or a set of practicals.

What is separated is the variables; imported modules, matplotlib's state and the working directory stay common to the one (an only one) pyodide interpreter.

ℹ️ **Sidecar** Alongside a document the editor writes a sidecar file holding its cell outputs and a snapshot of its namespace, so reopening it shows the results *without re-running everything* and the variables come back.

Each cell editor uses the same Python syntax coloring as the main editor (`--tok-*` CSS variables), and the cell UI background adapts automatically to the active light or dark theme via `--color-background-*` variables. 

ℹ️ **On the published site, the cells stay alive.** The figures the editor computed are carried into the MyST site as they are, so a reader sees them without waiting for anything; and if the document declares a `kernelspec`, the same cells can be re-run in the reader's own browser, the result replacing the figure in place. Nothing is installed for that — the kernel is JupyterLite, fetched on demand, and only when someone actually presses Run. See [export](export.md) for the keys that enable it.

There is more information on [executable-content](executable-content.md) which covers all of it.
