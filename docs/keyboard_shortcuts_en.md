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
| `Mod-Shift-m` | Slides |
| *(none by default)* | Source only — `shortcuts.modeSource` |
| *(none by default)* | The MyST site in a pane — `shortcuts.modeSite` |
| `Mod-Shift-h` | The documentation, in a pane |
| `Mod-Shift-j` | Join the broken lines of the selection, or of the paragraph the caret is in |
| `Mod-Shift-b` | Place or remove a bookmark on the current line |
| `Mod-Shift-n` | Go to the next bookmark, cycling |
| `Mod-Alt-n` | Go to the previous one |
:::
These keys are configurable in `config.json`; see [Customisation](customisation.md).

The view keys do the same thing as the toolbar buttons, the mode chosen being remembered across sessions as a click on one is. They work from anywhere in the window, which matters for leaving Preview, where the editor is hidden and holds no focus. They are free in the desktop application, and on macOS in a browser as well -- there the developer tools are on Cmd-Alt-I and Safari's private window on Cmd-Shift-N, so nothing competes. On Windows and Linux the browser keeps two of them for itself and will not let them be taken over: `Ctrl-Shift-I` opens the developer tools, and `Ctrl-Shift-P` a private window in Firefox. `config.json` is where to choose others. Each button's tooltip shows the key it answers to, read from the configuration, so a changed binding is announced rather than guessed. The source view and the site view have no default key -- no letter is obviously theirs, and an unused binding is better than one taken from something else -- but their keys are read, so filling `shortcuts.modeSource` or `shortcuts.modeSite` binds them. The bookmarks are written in the document as `% bookmark` comments and listed under the outline; see *[Document organisation](document-organization-and-navigation.md)*.

## Slides

While the deck is being presented. The arrows and the space bar navigate everywhere except inside a code cell, where they edit -- a cell on a slide stays a cell, and that exception is what makes the mode usable in front of a room.

:::{table} Presenting
:align: center
:name: slide_shortcuts

| Key | Action |
|---|---|
| `→` `↓` `Space` `Enter` | Next fragment, then next slide |
| `←` `↑` `Backspace` | Back |
| `PageDown` / `PageUp` | The same, and these two work even from inside a cell: that is what a presenter remote sends |
| `Home` / `End` | First / last slide |
| `o` | The panorama: every slide as a thumbnail |
| `Escape` | Leave the slides |
:::

:::{table} In the panorama
:align: center
:name: panorama_shortcuts

| Key | Action |
|---|---|
| `←` `→` | Previous / next thumbnail |
| `↑` `↓` | One row up / down |
| `Home` / `End` | First / last |
| `Enter` / `Space` | Go to the selected slide |
| `o` / `Escape` | Back to where you were |
:::

Everything else is swallowed while the panorama is up: the deck is being looked through rather than presented. Cells already running go on running, there as on a slide.


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
| *(none by default)* | Fold this cell's code away, or back | `toggleInput` |
| `Mod-Shift--` | Cut this cell in two at the caret | `splitCell` |
:::

Configurable in `config.json` under `pyodide.keys`; an empty string means no
shortcut. Two keys are fixed: `Tab` accepts the completion when the popup is
open and indents otherwise, and `ArrowUp` / `ArrowDown` move to the previous or
next cell once the cursor reaches the first or last line.
[executable-content](executable-content.md) covers the cells themselves.

### Alt on a button

The cell's toolbar speaks a second word with the same buttons: holding `Alt`
(`⌥` on macOS) while clicking one asks for the wider version of what it does.
It is the grammar rather than an eleventh button, and the tooltips say so.

:::{table} Alt-click on a cell's toolbar
:align: center
:name: cell_alt_click

| Button | Click | `Alt`-click |
|---|---|---|
| Run | Run this cell | Run every cell of the document |
| Clear | Clear this cell's output | Clear every output |
| Restart | Restart the kernel: the variables of this document | Reload the whole Pyodide runtime, which affects every open document |
| ↑ / ↓ | Move the cell up or down | Merge it with the cell above or below |
| `+` / `−` | Grow or shrink the code of this cell | Give it back the size the document and the view decide |
| The button of a `:button:` cell | Show the quiz | Open the cell underneath it |
:::

A merge does nothing when the neighbour is not a code cell, or when anything
but blank lines stands between the two: a paragraph caught in a merge would
have to go somewhere, and there is no answer to where.