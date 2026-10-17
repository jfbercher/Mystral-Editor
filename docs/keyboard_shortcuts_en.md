---
title: Keyboard Shortcuts
extends: mdocs_fm.yml
---

%# Keyboard Shortcuts

**Note**: `Mod` = Cmd on macOS, Ctrl elsewhere. 

⚠️ CodeMirror keymaps may change from one version to the next, so check for any edge cases on your own system.

## Interface

:::{table} Interface shortcuts
:name: interface_sortcuts
:align: center

| Key | Action |
|---|---|
| `Mod-Shift-o` | Open a file in current tab |
| `Mod-Shift-e` | Open a new (empty) tab |
| `Mod-Shift-s` | Save current tab |
| `Mod-Shift-d` | Dual pane (source and preview) |
| `Mod-Shift-p` | Preview only |
| `Mod-Shift-l` | Inline preview |
:::
These keys are configurable in `config.json`; see [Customisation](customisation.md).

The three view keys do the same thing as the toolbar buttons, the mode chosen being remembered across sessions as a click on one is. They work from anywhere in the window, which matters for leaving Preview, where the editor is hidden and holds no focus. They are free in the desktop application, and on macOS in a browser as well -- there the developer tools are on Cmd-Alt-I and Safari's private window on Cmd-Shift-N, so nothing competes. On Windows and Linux the browser keeps two of them for itself and will not let them be taken over: `Ctrl-Shift-I` opens the developer tools, and `Ctrl-Shift-P` a private window in Firefox. `config.json` is where to choose others.


## Editing (`defaultKeymap`)

:::{table} Editing shortcuts
:name: editing_shortcuts
:align: center
| Key | Action |
|---|---|
| `Alt-↑` / `Alt-↓` | Move line |
| `Shift-Alt-↑` / `Shift-Alt-↓` | Duplicate line |
| `Mod-Shift-k` | Delete line |
| `Mod-[` / `Mod-]` | Indent / Outdent |
| `Tab` / `Shift-Tab` | Indent / Outdent (via `indentWithTab`) |
| `Mod-Enter` | Insert an empty line |
| `Alt-l` | Select the line |
| `Mod-i` | Expand to parent syntax node |
| `Mod-/ or Mod-:` | Comment out / Uncomment |
| `Escape` | Reduce to a single selection |
::: 

On macOS, Emacs shortcuts are added (`Ctrl-a`, `Ctrl-e`, `Ctrl-k`, `Ctrl-d`…).



## Search and Multi-Cursor (`searchKeymap`)

:::{table} Search and Multi-Cursor
:align: center
:name: searchKeymap

| Key | Action |
|---|---|
| `Mod-f` | Search panel |
| `Mod-g` / `Shift-Mod-g` | Next / Previous occurrence |
| **`Mod-d`** | **Add the next occurrence to the selection** |
| **`Mod-Shift-l`** | **Select all occurrences** (non-empty selection required) |
| `Mod-Alt-g` | Go to line |
:::

## History

:::{table} History
:align: center
:name: History
| Key | Action |
|---|---|
| `Mod-z` | Undo |
| `Mod-y` / `Mod-Shift-z` | Redo |
| `Mod-u` / `Alt-u` | Undo / redo selection |
:::

## Folding (`foldKeymap`)

:::{table} Folding
:align: center
:name: Folding

| Key | Action |
|---|---|
| `Ctrl-Shift-[` (macOS `Cmd-Alt-[` or `Ctrl-Shift-ArrowLeft`) | Fold |
| `Ctrl-Shift-]` (macOS `Cmd-Alt-]` or `Ctrl-Shift-ArrowRight`) | Unfold |
| `Ctrl-Alt-[` or `Ctrl-Shift-ArrowUp` / `Ctrl-Alt-]` or `Ctrl-Shift-ArrowDown` | Fold All / Unfold All |
| **`Ctrl-Shift-Space`** | **Toggle Fold** |
:::

## Completion and lint

- `Ctrl-Space` triggers, `↑`/`↓` navigate, `Enter` accepts, `Escape` closes. 
- `Mod-Shift-m` opens the diagnostics panel, `F8` goes to the next item.

## Code cells

These apply while the cursor is inside the editor of a `{code-cell}`, in the
preview. They take precedence over the bindings above, so rebinding one to a
key the editor already uses shadows it while the cursor is in a cell.

:::{table} Code-cell shortcuts
:align: center
:name: code_cell_shortcuts

| Key | Action | Key in `config.json` |
|---|---|---|
| `Shift-Enter` | Run this cell | `run` |
| `Mod-Shift-Enter` | Insert an empty cell below | `insertBelow` |
| `Alt-v` | Open the variable window | `inspect` |
| *(none by default)* | Clear this cell's output | `clear` |
| *(none by default)* | Run every cell of the document | `runAll` |
| *(none by default)* | Clear every output | `clearAll` |
| *(none by default)* | Restart the kernel | `restart` |
| *(none by default)* | Delete this cell | `deleteCell` |
| *(none by default)* | Inline preview: edit this cell's source | `editSource` |
:::

Configurable in `config.json` under `pyodide.keys`; an empty string means no
shortcut. Two keys are fixed: `Tab` accepts the completion when the popup is
open and indents otherwise, and `ArrowUp` / `ArrowDown` move to the previous or
next cell once the cursor reaches the first or last line.
[executable-content](executable-content.md) covers the cells themselves.