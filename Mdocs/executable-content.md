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

Three options are understood:  

- `:linenos:` numbers the lines of the cell.
- `:packages: pandas, scipy` loads those packages before the cell runs, in addition to the ones always present. Names are comma-separated.
- `:tags: hide-input` carries cell metadata. It is stored and round-tripped but not otherwise interpreted at present.  

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
python: tp3 
--- 
```  

Every document carrying `python: tp3` sees the same variables; everything else is invisible to them. Since `extends` also works on the frontmatter, a project can set this once in a shared YAML file and have all of its documents inherit it — see [frontmatter-extends](frontmatter-extends.md).  

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

### The status bar  

Under the editor, a bar reports on the cell rather than acting on it: a message when there is one, the time of the last run, how long that run took, and the namespace the cell belongs to.  

The time is shown as a clock time while it is today's and with the date once it is not. It is saved with the cell's output and restored with it, which is what it is for: a document reopened a week later shows its results exactly as if they had just been computed, and the bar is what says otherwise. Changing a cell's code clears it, along with the output it described.  

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

An empty string means the action has no shortcut. A binding CodeMirror cannot parse is reported in the browser console and ignored, so a typo costs that one shortcut rather than the cell's whole keymap. Because these bindings take precedence inside a cell, rebinding one to a key the editor already uses — say `Mod-s` — shadows the editor's own while the cursor is in a cell.  

Two keys are fixed. 
- `Tab` accepts the completion when the popup is open and indents otherwise.
- `ArrowUp` and `ArrowDown` move to the previous or next cell once the cursor reaches the first or last line.  

Completion is provided by `jedi`, installed at start-up. If that installation fails (no network, typically) then `Tab` falls back to inserting four spaces and a message says so in the console. Completion reads the cell's text rather than the running interpreter, so it is the same in every namespace.  

## What Python can do here  

The interpreter is [Pyodide](https://pyodide.org): CPython compiled to WebAssembly, running in the page. `numpy`, `matplotlib` and `micropip` are loaded at start-up. Anything else is installed at run time:  

``` 
import micropip 
await micropip.install("pandas") 
```  

Top-level `await` works, since cells are executed as coroutines.  

Matplotlib figures are captured automatically: draw with `plt.plot(...)` and the figure appears in the output, no `plt.show()` needed. The backend is `agg` and figures are closed before each run, so a cell never inherits the previous one's canvas.  

`print()` output appears as it is produced rather than all at once at the end, which matters for a loop that reports progress. It is also mirrored to the browser console, prefixed `[py]`, where it can be read in time order alongside JavaScript messages.  

### Files  

Cells can read the files sitting next to the document. Before a cell runs, its source is scanned for filenames 

- in `open(...)`, `np.loadtxt(...)`, `pd.read_csv(...)` and their siblings, and in assignments such as `DATA = "measures.csv"` 

- and those files are copied from the working folder into the interpreter's in-memory filesystem under `/local`. Files a cell creates or modifies there are copied back to the working folder when it finishes.  

Two consequences follow. A filename built at run time, for instance by joining strings in a loop, is not seen by the scan and will not be staged. And in a browser without the File System Access API — Firefox, Safari — the working folder is a read-only snapshot: cells can read it but nothing is written back, and a message in the console says so once per run.  

The key `pyodide.resetCwdOnRun` decides whether the working directory persists between cells. See *Customisation*.  

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