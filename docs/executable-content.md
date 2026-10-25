---
title: Executable content -- code cells
subtitle: Mystral Editor
authors:
  - jfbercher
  - with a draft by Claude code
date: 2026-09-27
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
  '\dr': '\mathrm{d}#1'
  '\wb': '\mathbf{wx}'
---


%# Executable content: code cells  

:::{toc}
:context: section
:depth: 3
:::


**Mystral Editor runs Python inside the document!** A `code-cell` block becomes a small editor with its own toolbar; running it executes the code in a Python interpreter living in the page, and the result appears underneath.

For a scientific editor this is more than a convenience, and it is the feature that changes how a document is written. The prose, the computation and the figure it produces live in one file and travel together, so a number in a sentence and the code that produced it cannot drift apart: change the data and re-run, and the text follows. A colleague opening the file gets the argument and the means of checking it at once, without a separate notebook to locate, a script to reconstruct or an environment to install — the interpreter comes with the page. It is the same promise as a computational notebook, made to a document that is meant to be read rather than to a notebook that happens to contain prose. 

This page covers writing and running cells, the namespace a document runs in, what the Python side can and cannot do, the variable inspector, and the settings that govern all of it.  

## Writing a cell  
The directive form is the one to prefer, because it accepts options:  
``` 
:::{code-cell} 
python import numpy as np 
x = np.linspace(0, 1, 100) 
print(x.mean()) 
::: 
```  
The word after the marker is the language. It is informative — everything runs as Python — but it drives syntax highlighting and is kept when the cell is edited. Three fenced spellings are recognised as well: ` ```{code-cell} `, ` ```{code-cell} python ` and ` ```code-cell `.  

The options understood are:  

- `:linenos:` numbers the lines of the cell.
- `:packages: pandas, scipy` loads those packages before the cell runs, in addition to the ones always present. Names are comma-separated.
- `:tags: hide-input` opens the cell with its code folded away, showing the toolbar and the output alone. Other tags are stored and round-tripped but not otherwise interpreted.  
- `:params: n = 1..100 step 1` puts a control under the cell. See *Parameters*, below.
- `:figwidth: 60%` sets how wide the figures the cell draws are rendered. Any CSS length does -- a percentage of the output area, `20em`, `480px`. Without it the figure keeps its natural size, bounded by the width of the cell, and `pyodide.figureWidth` in `config.json` sets the default for every cell.  

A figure opens full screen when clicked: the wheel zooms about the pointer, dragging moves it, a double-click returns to the initial view, and `Escape` or a click beside the figure closes it. Figures are captured as SVG, with their text converted to outlines so that the result does not depend on the fonts available wherever it is later shown or exported; a zoom therefore stays sharp however far it goes. A figure too dense for that -- a scatter plot of a hundred thousand points -- falls back to a PNG capture at 120 dpi, which zooms as a picture does.  

A fourth form exists for a single expression in the middle of a sentence: the `{eval}` role. `` {eval}`2 + 2` `` renders as its value in the text flow, and is re-evaluated whenever a cell runs, so it follows the state of the session. It reads the document's own namespace, described next.  

## Namespaces: which Python a document runs in  

Within a document, all the cells share one namespace: a variable defined in one is visible from the next, as in a notebook.  
Between documents, the frontmatter decides. There is a single interpreter for the whole editor, but it holds as many namespaces as documents ask for:  
```yaml 
--- 
python: shared      # the default, and what you get by writing nothing 
--- 
```  

- `shared` is one common namespace for every document that does not ask for another. It is the right answer more often than it sounds: several tabs that are chapters of the same work, or a document doing a quick calculation beside the one being written, are better off seeing each other's variables than importing `numpy` twice.  

- `isolated` gives the document a namespace of its own. Nothing it defines reaches another document, and nothing another document defines reaches it. This is what to use when two files are unrelated, and above all when both are liable to bind a name as ordinary as `data`, `df` or `x`.  

```yaml 
--- 
python: isolated 
--- 
```  

A name gives a namespace shared by exactly the documents that ask for it:  

```yaml 
--- 
python: lab3 
--- 
```  

Every document carrying `python: lab3` sees the same variables; everything else is invisible to them. Since `extends` also works on the frontmatter, a project can set this once in a shared YAML file and have all of its documents inherit it — see [frontmatter-extends](frontmatter-extends.md).  

The namespace in force is shown at the right end of each cell's status bar. It is an indicator and not a control: a document's namespace is a property of the document, written in its frontmatter, so there is one place to change it and no hidden state to wonder about. The shared namespace is drawn dimmed, with a dashed outline, since it is the default.  
`shared` and `isolated` are reserved: a group cannot be called either.  

### What is separated, and what is not  

What a namespace separates is **variables**. Several things stay common to the whole editor, and it is better to know which:  

Imported modules. `sys.modules` is shared, so an `import numpy` paid for once benefits every document; which is what one wants, given what that import costs. The consequence is that a module's own state is shared too: monkey-patching a library in one document changes it for all of them.  

Matplotlib's state, beyond the figures themselves. Figures are closed before each run, so no cell inherits another's canvas, but `rcParams` set in one document apply everywhere. 

The current working directory, and the in-memory filesystem under `/local`. Two documents living in different folders share one `/local`, whatever their namespaces.  

Separating those as well would take a second interpreter — a second WebAssembly heap with its own copy of every package, paid for in memory and in loading time. The frontmatter value is a plain string, so such a mode can be added later without changing anything already written in a document.  

A document that has never been saved has no file to be keyed by, so `python: isolated` there isolates it for the current tab only; the namespace is not found again after a reload.  

## The toolbar  

Each cell carries the same buttons, acting on that cell or on the whole document.  

**Run** executes the cell; its background warms to a light red for as long as it runs, which is what tells a cell still working apart from one merely selected. 

**Clear** empties its output without touching the interpreter. 

**Run All** runs every cell of the document in order, waiting for each to finish. 

**Clear All** empties every output.  

**Vars** opens the variable inspector, described below. It shows the document's own namespace.  

**Restart** clears the namespace *of this document*: its user variables go, open figures are closed, the working directory returns to `/local`. A document running on its own therefore no longer wipes its neighbours' work. It keeps the interpreter itself, so it is instantaneous and works offline. What it deliberately does not do is unload modules — an `import` after a restart does not re-execute the module, and a library's internal state survives. When that matters, **⌥/Alt-click** on Restart instead: that reloads the whole Pyodide runtime, which takes several seconds, needs the network, and affects every document, since there is one runtime for all of them. It is the only true clean slate.  

**+ Cell** inserts an empty cell just below. 

**✕** deletes the cell, after an inline confirmation.  

**`</>`** appears in the inline preview only, and turns the cell into its markdown
source right there in the document. A code cell is the one block the inline
preview never unfolds when the cursor reaches it — it is already an editor, and
showing the raw fence instead would only take away execution, highlighting and
completion — so this button is the way in for whoever edits in inline mode and
needs to touch the fence itself, its `:label:` or its options. The cell renders
again as soon as the cursor leaves it, or on `Escape`.  

### Folding the code away  

The chevron at the left of the toolbar hides a cell's code, leaving its output and its buttons. On a slide that is often the point — the output is what is being shown, and a dozen lines of Python above it are what makes the slide overflow. While writing, it is a way to get a long cell out of the way without deleting anything.

`:tags: hide-input` sets the state a cell **opens** in; the button moves it from there, and that choice lasts as long as the cell does, re-renders included. The two are deliberately not the same thing: the document declares, the hand adjusts. Clicking does not write the tag back, so glancing at a long cell is not a modification of the file — and `pyodide.keys.toggleInput` gives the button a shortcut if you use it often.

### The status bar  

Under the editor, a bar reports on the cell rather than acting on it: a message when there is one, the time of the last run, how long that run took, and the namespace the cell belongs to.  

The time is shown as a clock time while it is today's and with the date once it is not. It is saved with the cell's output and restored with it, which is what it is for: a document reopened a week later shows its results exactly as if they had just been computed, and the bar is what says otherwise. Changing a cell's code clears it, along with the output it described.  

## Parameters  

A cell can declare that one of its numbers is meant to be varied:  

```
:::{code-cell}
:params: n = 1..100 step 1, amp = 0.1..5, grid = true

n = 12
amp = 1.0
grid = True
import numpy as np, matplotlib.pyplot as plt
x = np.linspace(0, 1, 400)
plt.plot(x, amp * np.sin(2 * np.pi * n * x))
:::
```

A strip appears under the editor with a control per declared name and a single **Apply**. `:params:` is offered by the completion of a `{code-cell}`, with an example value already in place, since the syntax is not one anybody guesses. Each declaration is `name = min..max`, optionally followed by `step s`, and declarations are separated by commas. A declaration of the form `name = bool` gives a checkbox instead of a slider, and writes `True` or `False` — with Python's capitals, since anything else would leave a cell that raises `NameError` the first time the box is ticked. Writing `name = true` or `name = false` instead declares the same checkbox *and* what it starts at, which is usually what you want: a flag declared as `bool` alone starts unticked every time, so a cell whose option should be on by default has no way to say so. The declaration is read without regard to case, so `True`, `TRUE` and `FAlsE` all mean what they look like; only the value written into the code carries Python's capitals.

Whatever the declaration says, the code wins when it says anything: the initial value matters only when the cell does not already assign the name. One that does not parse costs its own control rather than the whole cell.

The range is declared in the option; the *value* is read from the code and written back to it. Pressing Apply rewrites the cell's assignment -- `n = 12` becomes `n = 37` -- and then runs the cell. Reopening the document therefore shows what it will actually run, and there is no second place to keep in step.

That is the point of the feature, and the reason it is not `ipywidgets`. The cell stays plain Python: it reads an `n` that its own first line sets, so it runs the same way under `myst build --execute`, in Jupyter, or for a reader who copies it out. A value injected into the namespace by a widget would work here and raise `NameError` everywhere else. The cost is one line rewritten per apply; the gain is a document that is still a document.

### Integers and floats  

The precision of a parameter is read from the way its range is written, and the value written back keeps it. `n = 1..100` is an integer parameter, so Apply writes `n = 37`; `amp = 0.1..5` and `z = 1.0..3.0` are float parameters, so Apply writes `amp = 2.45` and `z = 2.00` — with the decimal point still there at a round value. That is not cosmetic: in Python `2` and `2.0` are different types, and silently turning one into the other changes what `//` means, what `/` returns exactly, and whether the value can index an array.

So the rule to remember is that a parameter meant to stay a float should be declared as one — `t = 0..10 step 0.5` or `z = 1.0..3.0` rather than `z = 1..3`. The decimals of the widest of `min`, `max` and `step` are the ones kept.

A range that declares no step gets one rounded to 1, 2 or 5 times a power of ten near a hundredth of its span, rather than the hundredth itself: `0.1..5` steps by 0.05 and not by 0.049, and `1..100` steps by 1. A slider can therefore not produce a value nobody chose, and never a `0.30000000000000004`.

### Applying  

The slider does nothing until Apply is pressed, deliberately: applying is an edit to the source, and a drag would otherwise produce thirty of them, thirty saves, and thirty site rebuilds. If the declared name has no assignment in the cell, Apply adds one at the top.

These are parameters, not a widget toolkit. There is no layout, no composition, no callbacks, and no controls linked to each other; a cell that needs those wants a notebook and a kernel, not this.  

## Keyboard shortcuts  

Shortcuts apply while the cursor is inside a cell editor. They are set in `config.json` under `pyodide.keys`, in CodeMirror notation: `Mod` is Cmd on macOS and Ctrl elsewhere, followed by `Shift`, `Alt` or `Ctrl`, then a key name such as `Enter`, `ArrowUp` or `k`.  

| Action | Default | Effect | 
| --- | --- | --- | 
| `run` | `Shift-Enter` | Run this cell | 
| `insertBelow` | `Mod-Shift-Enter` | Insert an empty cell below | 
| `inspect` | `Alt-v` | Open the variable window | 
| `clear` | *(none)* | Clear this cell's output | 
| `runAll` | *(none)* | Run every cell | 
| `clearAll` | *(none)* | Clear every output | 
| `restart` | *(none)* | Restart the kernel | 
| `deleteCell` | *(none)* | Delete this cell | 
| `editSource` | *(none)* | Inline preview: edit this cell's source |  

An empty string means the action has no shortcut. A binding CodeMirror cannot parse is reported in the browser console and ignored, so a typo costs that one shortcut rather than the cell's whole keymap. Because these bindings take precedence inside a cell, rebinding one to a key the editor already uses — say `Mod-s` — shadows the editor's own while the cursor is in a cell.  

Two keys are fixed. 
- `Tab` accepts the completion when the popup is open and indents otherwise.
- `ArrowUp` and `ArrowDown` move to the previous or next cell once the cursor reaches the first or last line.  

Completion is provided by `jedi`, installed at start-up. If that installation fails (no network, typically) then `Tab` falls back to inserting four spaces and a message says so in the console. Completion reads the cell's text rather than the running interpreter, so it is the same in every namespace.  

## `%load`: a file into a cell  

```
%load demo.py
```

Run the cell and the magic line is replaced by the contents of `demo.py`, commented out as it goes:

```
# %load demo.py
def f(x):
    return x ** 2
```

The path is relative to the document's folder, which is also where `open()` looks, so a file a cell already reads is a file a cell can load. Subfolders work; `..`, `~` and absolute paths are refused, and refused the same way on every platform. That last point is the reason for the rule: in a browser a `..` throws, while the desktop build would most likely resolve it — so a document could load on one and fail on the other, which is harder to diagnose than being told no.

It is a **gesture, not a link**. A cell permanently backed by a file raises a question nobody can answer on the author's behalf — which of the two is authoritative, and what saving means — and gets it wrong once in a way that loses work. Loading once has no such question. It also keeps the document whole: after a load the code is in the page, so `myst build` can render it, where a cell backed by a file would have left it an empty body.

The magic line is commented out for a reason worth knowing, since IPython does the same: left alone, the next run would reload the file and silently discard whatever was typed in between, and the cell would behave like a text box that empties itself.

Loading needs a working folder, which means the document must have been saved somewhere; until then the cell says so instead of failing quietly. Nothing is written back — `%load` only reads. To get code from a cell into a file, copy it out.

## What Python can do here  

The interpreter is [Pyodide](https://pyodide.org): CPython compiled to WebAssembly, running in the page. `numpy`, `matplotlib` and `micropip` are loaded at start-up. Anything else is installed at run time:  

``` 
import micropip 
await micropip.install("pandas") 
```  

Top-level `await` works, since cells are executed as coroutines.  

Matplotlib figures are captured automatically: draw with `plt.plot(...)`, and the figure appears in the output, no `plt.show()` needed. The backend is `agg`, and figures are closed before each run, so a cell never inherits the previous one's canvas.  

`print()` output appears as it is produced rather than all at once at the end, which matters for a loop that reports progress. It is also mirrored to the browser console, prefixed `[py]`, where it can be read in time order alongside JavaScript messages.  

### Files  

Cells can read the files sitting next to the document. Before a cell runs, its source is scanned for filenames 

- in `open(...)`, `np.loadtxt(...)`, `pd.read_csv(...)` and their siblings, and in assignments such as `DATA = "measures.csv"` 

- and those files are copied from the working folder into the interpreter's in-memory filesystem under `/local`. Files a cell creates or modifies there are copied back to the working folder when it finishes.  

Two consequences follow. A filename built at run time, for instance by joining strings in a loop, is not seen by the scan and will not be staged. And in a browser without the File System Access API — Firefox, Safari — the working folder is a read-only snapshot: cells can read it but nothing is written back, and a message in the console says so once per run.  

The key `pyodide.resetCwdOnRun` decides whether the working directory persists between cells. See *[Customisation](customisation.md)*.

### What it cannot do  

Pyodide runs on the page's main thread. A long computation freezes the interface until it returns, and there is no way to interrupt a running cell short of reloading — keep an eye on loops without a bound.  

There are no processes and no threads: `subprocess`, `multiprocessing` and anything that shells out will not work. `input()` has no console to read from. Packages with C extensions exist only if someone built them for WebAssembly: the Pyodide distribution and the pure-Python wheels on PyPI are the limit.  

Finally, the runtime itself is fetched from a CDN on first use. The first cell of a session therefore needs the network, and so does a hard restart.  

### The network, and what a cell may read  

There are no sockets either, so `requests` and `urllib` cannot work as they are. `pyodide_http` is installed at start-up and its patches applied, which reroutes them through the browser's own `fetch`: `requests.get(...)` and `pd.read_csv("https://...")` therefore work, and `pyodide.http.pyfetch` is there for an explicitly asynchronous call.  

What that rerouting also does is place them under the page's cross-origin rules, exactly like a `fetch` written in JavaScript. A cell can read a URL only if its server *allows* it to, by answering with an `Access-Control-Allow-Origin` header. Most public sites do not, and a request to one fails with a message naming CORS; even though the server replied, and replied 200. The response arrived: the browser refused to hand it over. No Python library gets around this: it is the browser, not Pyodide.  

Two cases work. 
- A server that sends the header, which many scholarly APIs do; e.g. Crossref and OpenAlex among them. And your *own* server: a document served from the same origin as its data reads it with no check at all, which is why a deployed copy of the editor reads datasets sitting beside it while the very same document fails in development.

- For data you host yourself, one line makes it readable everywhere — the development server, the desktop application, a colleague's browser:
```apache 
<FilesMatch "\.(csv|json|txt)$">
  Header set Access-Control-Allow-Origin "*"
</FilesMatch>
```  

It needs `mod_headers` and an `AllowOverride` that permits `FileInfo`, which a personal web space does not always grant; if the header does not appear, that is where to look. `*` makes those files readable from any page, so it suits public data and not private data — though it transmits no cookies or credentials and cannot expose anything authenticated.  

The desktop application is no exception. It serves its interface from an origin of its own, so a document that needs a third-party server needs that server's permission there too.  

## Saved outputs and variables  

Alongside a document, the editor writes a **sidecar file** holding the outputs of its cells and a snapshot of its namespace, so reopening it shows the results without re-running everything, and the variables come back. The snapshot is taken of the document's own namespace and records which one it was, so it is put back where it came from.  

Changing `python:` between two sessions therefore does not move the saved variables: they return to the namespace they were computed in, and the cells, which now run elsewhere, have to be re-run. That is what changing the namespace means.  

The snapshot has limits worth knowing. Values are serialised with `cloudpickle`, and what it cannot pickle is not saved — an open file, a JavaScript proxy, some objects holding a live resource. Those are named in the browser console when the document is reopened, with the reason, since there is nothing to be done about them at that point.  

Modules are recorded by name and re-imported on load. A module the document installed itself, with `micropip` or by writing it, does not exist in a fresh runtime until the cells that create it have run; the same goes for an object whose class lives in such a module. That is not lost data, so it is reported as a console note rather than an alert: running the cells brings it back. The alert is kept for a value that really could not be rebuilt, which is the case worth looking at.  

One subtlety about restored functions. `cloudpickle` rebuilds a function with its own copy of the globals it reads, which would leave a restored `f()` seeing the value a variable had when the document was saved rather than its current one. Restored functions are therefore rebound to the live namespace, so they follow the document's variables as they did before it was closed. Methods of a restored class keep their own snapshot, which is out of reach of that mechanism.  

## Cells that stay alive on the published site  

A cell is not only alive in the editor. When a document is published as a MyST
site, what its cells computed here is carried across and shown as it is, so a
reader sees the figures straight away, without waiting and without running
anything.  

And if the document declares a `kernelspec` in its frontmatter, those same
cells can be **re-run by the reader**, in their own browser, the new result
replacing the figure in place. The kernel is JupyterLite — Python compiled to
WebAssembly, like the one running here — fetched only when someone actually
presses Run, so a reader who never does pays nothing for it. Nothing is
installed on their machine, and nothing on yours: no Jupyter server is
involved.  

The two states coexist on purpose: the figures you computed are the document's
initial condition, and a kernel, when the reader starts one, takes over from
there. A document without `kernelspec` is simply never executed on the site and
keeps your figures — which is the right choice for notes meant to be read
rather than played with.  

The keys that enable this, and where each belongs, are in
[export](export.md#cells-that-stay-executable-on-the-site).  

## The variable inspector  

**Vars**, or `Alt-v`, opens a window listing what the document's namespace holds: one row per variable with its type, memory footprint, shape and a short `repr`. Its title names the namespace when it is not the shared one. Columns sort on click, the filter box matches names and types, and a checkbox adds modules, functions and classes, which are hidden by default.  
The `×` on a row deletes that variable. On a module row it also drops the entry from `sys.modules`, so a later `import` rebuilds it — though memory only comes back if nothing else still references the module, which between `numpy`, `matplotlib` and their friends is rarely the case. Note that `sys.modules` is shared by every document, so unloading a module there affects all of them.  

The footer totals the sizes on display. Read it as an order of magnitude: a container reports its own footprint and not that of its contents, so a list of ten thousand objects looks small, and an object bound to two names is counted twice. Arrays, `Series` and `DataFrame` are asked for their real footprint rather than trusting `sys.getsizeof`, which would only measure the wrapper.  

The same information is available as text, from inside a cell:  
```python 
%whos      # table: name, type, size, shape, value 
%who       # names only %whos -a   # include modules, functions and classes 
```  

These are the only two magics this runtime understands, and they report on the namespace of the cell that calls them. Pyodide runs plain Python, where `%whos` is a syntax error, so the two lines are rewritten into calls before execution; any other `%` line is left to fail as Python, rather than being silently swallowed. Their output is text in the cell, so it stays in the document and in the saved outputs — which the window, being transient, does not.  

A word on the percent sign itself: in MyST, a line beginning with `%` is a comment and disappears from the rendered document. That rule stops at fences, so `%whos` inside a code cell or a code block is left alone. In ordinary prose, a line that has to *start* with a visible percent sign is written `\%`, which renders as `%`; anywhere else on the line no escape is needed.  

## Appearance  

The look of a cell is governed by four CSS variables 

- `--pyodide-cell-bg`, `--pyodide-cell-border`, `--pyodide-output-bg` and `--pyodide-cell-running-bg` 
- plus a font-size knob, `--pyodide-cell-font-size`. 

They take precedence over the general `--color-*` variables so cells can be set apart from the rest of the page, and they have separate light and dark values. [myst-editor-css-variables](myst-editor-css-variables.md) documents each one, and [customisation](customisation.md) explains where to put your overrides.  

## Diagnostics  

Two helpers live on `window` for when something behaves oddly.  

- `__mystralNamespaceDebug` keeps a log of everything that changes a namespace — cell runs with the names they added and removed, restores, restarts, deletions;  each event naming the namespace it touched. `.spaces()` lists the namespaces currently in existence, `.losses()` only the events that removed a name, and `.dump()` prints the whole timeline. It answers the question "when did this variable disappear, and because of what?", which reading the code does not.  

- `__mystralEnvReport()` reports what the browser offers: secure context, which file pickers exist, whether IndexedDB really accepts a write. It is about file access rather than cells, but it is the first thing to run when the editor misbehaves on one machine and not another. 