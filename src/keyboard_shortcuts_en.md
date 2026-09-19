---
title: Keyboard Shortcuts
subtitle: Some Adaptations
authors:
  - jfbercher
date: 2026-08-01
license: CC-BY-4.0
github: https://github.com/jfbercher/Mystral-Editor
bibliography: references.bib
citation-style: author-year # or numeric
citation-template: "{authors} ({year}). *{title}*. {container}{volume}{pages}.{doilink}"
numbering:
  headings: true # activate headings numbering
  equations: true 
  figure: true
    #template: Fig. %s # Define the prefix
math:
  '\dr': '\mathrm{d}#1'
  '\wb': '\mathbf{wx}'
---

%# Keyboard Shortcuts

`Mod` = Cmd on macOS, Ctrl elsewhere. 

CodeMirror keymaps may change from one version to the next, so check for any edge cases on your own system.

## Interface

:::{table} Interface shortcuts
:name: truc
:align: center

| Key | Action |
|---|---|
| `Mod-Shit-o` | Open a file in current tab |
| `Mod-Shit-e` | Open a new (empty) tab |
| `Mod-Shit-s` | Save current tab |
:::
Configurable in `config.json`.


## Editing (`defaultKeymap`)

:::{table} Editing shortcuts
:name: trac
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