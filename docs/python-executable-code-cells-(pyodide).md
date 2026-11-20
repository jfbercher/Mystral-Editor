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
- `:linenos:` — show line numbers in the cell editor. A boolean, as in the MyST specification: bare, `true` and `yes` turn them on, `false` and `no` turn them off, and the option's absence leaves them off.
- `:tags: hide-input` — cell metadata, carried through to the export
- `:description:` — what the cell is, shown in its toolbar, right of the buttons and wrapping onto its own line when they leave no room. The editor's alone: mystmd does not know the option, so it numbers nothing and references nothing.
- `:caption:` — the same text, and one thing more: mystmd reads it, makes the cell a figure and gives it a number, so `{ref}` and `{numref}` can point at it. Use it when that is what you want. A cell with a caption and no description shows the caption in its toolbar, as it always has; a cell with both shows the description and exports the caption.
- `:label:` — makes the cell referenceable: `{ref}` and `{numref}` resolve to it, and land on the cell.
- `:align:`, `:figwidth:` — read by mystmd when the document is exported, where the cell and its outputs become a figure. They have no effect on the editor's own rendering.

A description costs nothing to the document: it is the caption that makes a cell a figure, which is why the two were separated. A cell described rather than captioned no longer advances the figure counter, and the figures after it keep the numbers they had.

Captioned cells are numbered, under a counter of their own -- `Code 1`, `Code 2` -- rather than among the figures. mystmd counts them as figures when it builds the site, so the two numberings differ by design; change `kind` to `"fig"` for `code-cell` in `data_directives` to follow mystmd instead. The label shown can be changed the same way.

Note that `:caption:` and `:label:` are deliberately not passed to the exporter a second time: mystmd reads them from the source itself, and sending them again produced two nested floats and the caption twice.
- `:open: false` — the cell opens with its code folded away

How a cell *opens* is the author's to say; what is showing right now is the reader's. `:open: false` folds the code away at opening, for a cell whose result is the point and whose code is a detail; a cell that says nothing opens showing its code. The chevron in the toolbar folds and unfolds as you read, and **writes nothing** -- so nothing is marked modified, nothing re-renders, and nothing moves under your eyes.

It used to write the state back into the source, which seemed a kindness: a document reopened a week later came back tidied. The mechanism was wrong, though, and in a way that took a while to see. An edit made in answer to a view gesture re-renders the document, and a re-render moves what one is looking at -- the pane creeping up a line at each fold, the preview jumping to wherever the source happened to be, a slide replaying its entrance in the middle of a sentence. Each was fixed in turn and another took its place, because the fault was the writing itself.

`:fold:` is the older spelling, the same thing the other way round, and is still read; `:open:` wins when both appear. A fence carries its flags in its info line, where a value has nowhere to go, so `:fold:` remains the spelling there:

````markdown
```code-cell python :linenos: :fold:
import numpy as np
```
````

`:tags: hide-input` is a separate matter: it is metadata for the export and folds nothing here, a cell being perfectly able to be read open and exported without its input.

ℹ️ **Access to local-files** in read/write mode is supported, restricted to the Working Directory with explicit permissions (web), or in the same directory as the current file (Tauri local app).

↑↓ **Moving a cell** In Inline mode the toolbar carries two arrows that move the cell one place up or down. The step is one *block* of the inline projection -- the next rendered object, whatever it is: a paragraph, a heading, another cell, or a whole admonition, which is therefore stepped over rather than entered. The blank lines between two blocks stay where they are, and the move is a single undo step. The arrows do not appear in the dual preview, where there is no editor under the rendering to move anything in.

⇅ **Merging and splitting** Alt-clicking one of those arrows merges the cell with its neighbour in that direction instead of moving it. The active cell's marker and options are the ones kept -- `:packages:` and `:params:` of two cells have no meaningful union -- and only the other cell's code is taken in. Nothing happens if the neighbour is not a code cell, or if anything but blank lines stands between the two.

`Mod-Shift--` (Cmd on macOS, Ctrl elsewhere, with the minus key) cuts the cell in two at the caret, both halves keeping the marker and the options of the cell they come from, so whatever made it run is still there on either side. Nothing happens when one half would be empty. The key is configurable in `config.json` under `pyodide.keys.splitCell`, like the other cell shortcuts, and wins over the editor's own bindings while the caret is in a cell. One combination to avoid when rebinding on macOS: Alt with neither Cmd nor Ctrl. Alt composes characters there, so the browser reports the composed sign rather than the letter, and CodeMirror deliberately refuses to guess the physical key -- the binding never matches and the character is typed into the cell.

▭ **The output's own controls** At the left of the status bar, two small buttons act on what the cell produced: one hides the output and brings it back, the other lifts the height limit so a long output is shown whole instead of scrolling inside `--pyodide-output-max-height` (25rem by default). The second appears only when the output is actually taller than its box, and both disappear when the cell has produced nothing. They are view controls: nothing is written to the document, and a reload starts afresh.

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
