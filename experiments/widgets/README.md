# ipywidgets on bare Pyodide — an experiment

One question, and nothing else: **can an `IntSlider` live on the editor's own
Pyodide — no Jupyter kernel, no web worker — with a comm written by hand and
the standard widget manager on the JavaScript side?**

It is two-way or it is nothing. The control must follow Python, and Python
must follow the control. Anything less is a picture of a slider.

## Running it

From the repository root:

```sh
npx vite experiments/widgets
```

and open the address it prints. Pyodide and ipywidgets come from the network
the first time.

## Reading the result

- The slider appears, dragging it logs a new `slider.value`, and
  *Python: slider.value = 3* moves it → **the channel works both ways**, and
  the question of adopting a kernel for widgets is closed.
- The slider appears but nothing travels → the manager and the comm are not
  agreeing on message shape; the log says which message arrived last.
- Nothing appears → the failure is in `handle_comm_open`, i.e. before any of
  this is about widgets.

## What it leaves out, on purpose

Binary buffers (a slider needs none, a plot might), and the display protocol:
the widget is reached by its model id rather than through `display()`. Both
are real work, neither changes the answer to the question above.

## What the experiment taught that reading would not have

A comm is necessary and not sufficient. A widget model counts the messages it
has in flight and will not send another until the kernel reports itself
**idle** — which a kernel does at the end of every execution, and which
nothing here is. Without that report the first change is sent, the counter
stays at one, and every later change is queued for ever: the control moves and
Python does not.

Answering it is three lines, in `PyComm.send`. But it is the shape of the
thing to expect: the manager was written against a kernel, so adopting it
means answering for a kernel in a few more places than the channel itself.

## Known friction

`html-manager` is published compiled for webpack and its bundle assigns
`__webpack_public_path__`, which is a ReferenceError inside an ES module. The
page declares it on `window` beforehand. Vite also reports `path`, `fs` and
`url` as externalised for the browser: that is a Node-only corner of a
transitive dependency, and it is noise unless something actually calls into
it.

Both are worth counting rather than hiding: they say this package expects a
bundler we do not use.

## Files

- `bridge.py` — the comm, which is the whole Python side. `comm.create_comm`
  is a documented replacement point; JupyterLite's own pyolite kernel plugs in
  the same way, which is the point worth taking away: that kernel has no
  access to Pyodide that this page does not have.
- `main.js` — a `HTMLManager` subclass that knows how to make a comm, and the
  router between the two halves.

## Note

The dependency was installed with `npm install --no-save`, so `package.json`
is untouched, but `node_modules` was changed in passing (npm reported one
package removed and thirty-three changed). `npm ci` puts it back exactly as
the lockfile says.
