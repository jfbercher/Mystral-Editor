# Executable content: code cells

Mystral Editor runs Python inside the document. A `code-cell` block becomes a
small editor with its own toolbar; running it executes the code in a Python
interpreter living in the page, and the result appears underneath. All the
cells share one interpreter, so a variable defined in one is visible from the
next, as in a notebook — and that interpreter is shared by **every open tab**,
not one per document. Two documents opened side by side see each other's
variables and can overwrite them, which is worth knowing before naming a
variable `data` in both.

This page covers writing and running cells, what the Python side can and
cannot do, the variable inspector, and the settings that govern all of it.

## Writing a cell

The directive form is the one to prefer, because it accepts options:

```
:::{code-cell} python
import numpy as np
x = np.linspace(0, 1, 100)
print(x.mean())
:::
```

The word after the marker is the language. It is informative — everything runs
as Python — but it drives syntax highlighting and is kept when the cell is
edited. Three fenced spellings are recognised as well: ` ```{code-cell} `,
` ```{code-cell} python ` and ` ```code-cell `.

Three options are understood:

`:linenos:` numbers the lines of the cell.

`:packages: pandas, scipy` loads those packages before the cell runs, in
addition to the ones always present. Names are comma-separated.

`:tags: hide-input` carries cell metadata. It is stored and round-tripped but
not otherwise interpreted at present.

A fourth form exists for a single expression in the middle of a sentence: the
`{eval}` role. `` {eval}`2 + 2` `` renders as its value in the text flow, and
is re-evaluated whenever a cell runs, so it follows the state of the session.

## The toolbar

Each cell carries the same buttons, acting on that cell or on the whole
document.

**Run** executes the cell; its background warms to a light red for as long as
it runs, which is what tells a cell still working apart from one merely
selected. **Clear** empties its output without touching the
interpreter. **Run All** runs every cell of the document in order, waiting for
each to finish. **Clear All** empties every output.

**Vars** opens the variable inspector, described below.

**Restart** clears the namespace: every user variable goes, open figures are
closed, the working directory returns to `/local`. It keeps the interpreter
itself, so it is instantaneous and works offline. What it deliberately does not
do is unload modules — an `import` after a restart does not re-execute the
module, and a library's internal state survives. When that matters,
**⌥/Alt-click** on Restart instead: that reloads the whole Pyodide runtime,
which takes several seconds and needs the network, and is the only true clean
slate.

**+ Cell** inserts an empty cell just below. **✕** deletes the cell, after an
inline confirmation.

## Keyboard shortcuts

Shortcuts apply while the cursor is inside a cell editor. They are set in
`config.json` under `pyodide.keys`, in CodeMirror notation: `Mod` is Cmd on
macOS and Ctrl elsewhere, followed by `Shift`, `Alt` or `Ctrl`, then a key
name such as `Enter`, `ArrowUp` or `k`.

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

An empty string means the action has no shortcut. A binding CodeMirror cannot
parse is reported in the browser console and ignored, so a typo costs that one
shortcut rather than the cell's whole keymap. Because these bindings take
precedence inside a cell, rebinding one to a key the editor already uses — say
`Mod-s` — shadows the editor's own while the cursor is in a cell.

Two keys are fixed. `Tab` accepts the completion when the popup is open and
indents otherwise. `ArrowUp` and `ArrowDown` move to the previous or next cell
once the cursor reaches the first or last line.

Completion is provided by jedi, installed at start-up. If that installation
fails — no network, typically — `Tab` falls back to inserting four spaces and a
message says so in the console.

## What Python can do here

The interpreter is [Pyodide](https://pyodide.org): CPython compiled to
WebAssembly, running in the page. `numpy`, `matplotlib` and `micropip` are
loaded at start-up. Anything else is installed at run time:

```
import micropip
await micropip.install("pandas")
```

Top-level `await` works, since cells are executed as coroutines.

Matplotlib figures are captured automatically: draw with `plt.plot(...)` and
the figure appears in the output, no `plt.show()` needed. The backend is `agg`
and figures are closed before each run, so a cell never inherits the previous
one's canvas.

`print()` output appears as it is produced rather than all at once at the end,
which matters for a loop that reports progress. It is also mirrored to the
browser console, prefixed `[py]`, where it can be read in time order alongside
JavaScript messages.

### Files

Cells can read the files sitting next to the document. Before a cell runs, its
source is scanned for filenames — in `open(...)`, `np.loadtxt(...)`,
`pd.read_csv(...)` and their siblings, and in assignments such as
`DATA = "measures.csv"` — and those files are copied from the working folder
into the interpreter's in-memory filesystem under `/local`. Files a cell
creates or modifies there are copied back to the working folder when it
finishes.

Two consequences follow. A filename built at run time, for instance by joining
strings in a loop, is not seen by the scan and will not be staged. And in a
browser without the File System Access API — Firefox, Safari — the working
folder is a read-only snapshot: cells can read it but nothing is written back,
and a message in the console says so once per run.

`pyodide.resetCwdOnRun` decides whether the working directory persists between
cells. See *Customisation*.

### What it cannot do

Pyodide runs on the page's main thread. A long computation freezes the
interface until it returns, and there is no way to interrupt a running cell
short of reloading — keep an eye on loops without a bound.

There are no processes and no threads: `subprocess`, `multiprocessing` and
anything that shells out will not work. Sockets are not available either, so
`requests` and `urllib` fail; use `pyodide.http.pyfetch` for HTTP. `input()`
has no console to read from. Packages with C extensions exist only if someone
built them for WebAssembly — the Pyodide distribution and the pure-Python
wheels on PyPI are the limit.

Finally, the runtime itself is fetched from a CDN on first use. The first cell
of a session therefore needs the network, and so does a hard restart.

## Saved outputs and variables

Alongside a document, the editor writes a sidecar file holding the outputs of
its cells and a snapshot of the namespace, so reopening it shows the results
without re-running everything, and the variables come back.

The single shared interpreter shows through here. The snapshot is taken of the
whole namespace, so a document's sidecar records variables created by the cells
of any other document open at the time; reopening it then reports them as
unrestorable, the packages they need not being loaded. The message is accurate
and the sidecar holds what it was asked to record — it is the pairing of one
kernel with per-document snapshots that does not hold as soon as two Python
documents are open.

The snapshot has limits worth knowing. Values are serialised with
`cloudpickle`, and what it cannot pickle is not saved — an open file, a
JavaScript proxy, some objects holding a live resource. Modules are recorded by
name and re-imported on load, which is why a module from a package that is not
in the runtime yet, such as `pandas` after a reload, may be reported as
unrestorable. Whatever does not come back is named in a message rather than
disappearing quietly, and re-running the cell that defines it is always the
remedy.

## The variable inspector

**Vars**, or `Alt-v`, opens a window listing what the namespace holds: one row
per variable with its type, memory footprint, shape and a short `repr`. Columns
sort on click, the filter box matches names and types, and a checkbox adds
modules, functions and classes, which are hidden by default.

The `×` on a row deletes that variable. On a module row it also drops the entry
from `sys.modules`, so a later `import` rebuilds it — though memory only comes
back if nothing else still references the module, which between `numpy`,
`matplotlib` and their friends is rarely the case.

The footer totals the sizes on display. Read it as an order of magnitude: a
container reports its own footprint and not that of its contents, so a list of
ten thousand objects looks small, and an object bound to two names is counted
twice. Arrays, `Series` and `DataFrame` are asked for their real footprint
rather than trusting `sys.getsizeof`, which would only measure the wrapper.

The same information is available as text, from inside a cell:

```python
-%whos      # table: name, type, size, shape, value
- %who       # names only
- %whos -a   # include modules, functions and classes
```



These are the only two magics this runtime understands. Pyodide runs plain
Python, where `%whos` is a syntax error, so the two lines are rewritten into
calls before execution; any other `%` line is left to fail as Python, rather
than being silently swallowed. Their output is text in the cell, so it stays in
the document and in the saved outputs — which the window, being transient,
does not.

A word on the percent sign itself: in MyST, a line beginning with `%` is a
comment and disappears from the rendered document. That rule stops at fences,
so `%whos` inside a code cell or a code block is left alone. In ordinary prose,
a line that has to *start* with a visible percent sign is written `\%`, which
renders as `%`; anywhere else on the line no escape is needed.

## Appearance

The look of a cell is governed by four CSS variables — `--pyodide-cell-bg`,
`--pyodide-cell-border`, `--pyodide-output-bg` and `--pyodide-cell-running-bg`
— plus a font-size knob, `--pyodide-cell-font-size`. They take precedence over the general `--color-*`
variables so cells can be set apart from the rest of the page, and they have
separate light and dark values. [myst-editor-css-variables](myst-editor-css-variables.md)
documents each one, and [customisation](customisation.md) explains where to
put your overrides.

## Diagnostics

Two helpers live on `window` for when something behaves oddly.

`__mystralNamespaceDebug` keeps a log of everything that changes the shared
namespace — cell runs with the names they added and removed, restores,
restarts, deletions. `.losses()` lists only the events that removed a name, and
`.dump()` prints the whole timeline. It answers the question "when did this
variable disappear, and because of what?", which reading the code does not.

`__mystralEnvReport()` reports what the browser offers: secure context, which
file pickers exist, whether IndexedDB really accepts a write. It is about file
access rather than cells, but it is the first thing to run when the editor
misbehaves on one machine and not another.
