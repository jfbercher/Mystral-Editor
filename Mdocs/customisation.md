# Mystral Editor — Customisation Reference

---

## Overview

Mystral Editor reads two optional files at startup. Neither is required: without them the app runs on its built-in defaults.

| File | Purpose |
|---|---|
| `config.json` | Runtime settings: intervals, shortcuts, Pyodide behaviour, export commands, directive registry |
| `custom.css` | Stylesheet overrides, injected after the application stylesheet |

### Where they live

| Build | Location |
|---|---|
| Web | `src/public/` during development, copied to `dist/` on build; fetched relative to the app's base URL |
| Tauri (macOS) | `~/Library/Application Support/MystralEditor/` |
| Tauri (Linux) | `~/.config/MystralEditor/` |
| Tauri (Windows) | `%APPDATA%\MystralEditor\` |

The defaults live in `src/config-defaults.js`, which is the reference for every key below.

The **Settings** panel has an *Open config.json* button that opens the file for
the installation in use, so the paths above rarely need to be typed. In the
desktop build it creates the file from a starter holding the current defaults
when it does not exist yet — the system cannot open a file that is not there —
and hands it to whatever application opens `.json`. In the web build the file is
served with the application and cannot be written from the browser: it opens in
a tab for reading, and changing it means editing the file on the server.

The panel's toggles are a different thing: they are remembered per browser, in
`localStorage`, and take effect immediately. `config.json` is read once at
start-up. **Auto-save** appears among the toggles, seeded from
`autoSaveEnabled` below and overriding it once touched.

### How values are merged

`config.json` may contain **any subset** of the keys. It is merged into the defaults *recursively*, so a file naming a single nested key keeps everything else in its section:

```json
{ "export": { "templates": { "pdf": "arxiv_nips" } } }
```

leaves `export.mystPath`, `export.sitePort` and the other templates at their default values. Arrays are the exception: a list in `config.json` replaces the default list entirely, since a partial list is rarely what one means.

An unreadable or malformed `config.json` is not fatal — it is reported in the console and the defaults apply.

---

## Editing and session keys

| Key | Default | Meaning |
|---|---|---|
| `autoSaveEnabled` | `true` | Whether autosave is on when the app starts. The toolbar toggle overrides it for the session. |
| `autosaveIntervalMs` | `60000` | Delay between two autosaves, in milliseconds. |
| `suspendAfterMs` | `3600000` | How long an inactive tab stays mounted before its editor is suspended to free memory. Its content is restored on reactivation. |
| `checkIntervalMs` | `300000` | How often inactive tabs are checked against the interval above. |
| `recentFilesMax` | `10` | Number of entries kept in the "open a file" dropdown. |
| `defaultFileName` | `"Untitled.md"` | Name given to a document that has never been saved. |
| `fallbackImage` | a remote placeholder URL | Image shown when a referenced file cannot be resolved. A relative path such as `./assets/image-not-found.png` keeps the app working offline. |

---

## `shortcuts` — keyboard bindings

| Key | Default | Action |
|---|---|---|
| `shortcuts.save` | `"Mod-Shift-s"` | Save, or Save as… for a document with no file yet |
| `shortcuts.open` | `"Mod-Shift-o"` | Open a file |
| `shortcuts.newTab` | `"Mod-Shift-e"` | New tab |

`Mod` is Cmd on macOS and Ctrl elsewhere, following CodeMirror's convention. Modifiers are combined with `-`, for instance `"Mod-Alt-p"`.

---

## `pyodide` — executable code cells

| Key | Default | Meaning |
|---|---|---|
| `pyodide.resetCwdOnRun` | `false` | `false` keeps notebook behaviour: the working directory persists from one cell to the next, so a cell may `os.chdir()` and the following ones stay there. `true` resets to `/local` before every run, which makes each cell reproducible in isolation at the cost of that continuity. |
| `pyodide.keys.run` | `"Shift-Enter"` | Run the current cell. |
| `pyodide.keys.insertBelow` | `"Mod-Shift-Enter"` | Insert an empty cell below the current one. |
| `pyodide.keys.inspect` | `"Alt-v"` | Open the variable window. |
| `pyodide.keys.clear` | `""` | Clear the current cell's output. |
| `pyodide.keys.runAll` | `""` | Run every cell of the document. |
| `pyodide.keys.clearAll` | `""` | Clear every output. |
| `pyodide.keys.restart` | `""` | Restart the kernel, clearing all variables. |
| `pyodide.keys.deleteCell` | `""` | Delete the current cell. |

These shortcuts apply only while the cursor is inside a code-cell editor, and
they take precedence there over the editor's own bindings: giving one a key the
editor already uses, `"Mod-s"` for instance, shadows it inside cells. An empty
string means the action has no shortcut. A binding CodeMirror cannot parse is
reported in the browser console and dropped, so a typo costs that one shortcut
rather than the cell's whole keymap.

`Tab`, which accepts a completion or indents, and the arrow keys that move
between cells are not configurable.

[executable-content](executable-content.md) describes what each action does,
and the rest of the code-cell machinery.

---

## `export` — export menu (Tauri only)

This section drives the 📦 menu, which shells out to `myst` and therefore exists only in the desktop build.

| Key | Default | Meaning |
|---|---|---|
| `export.mystPath` | `"myst"` | Command used to invoke mystmd. It runs through a **login shell**, so the bare name works as long as it is on the PATH of your shell profile — a GUI application launched from the Finder does not inherit an interactive shell's PATH. Set an absolute path here when mystmd lives somewhere unusual. |
| `export.sitePort` | `3000` | Port used by `myst start` for the local site preview, and the port the browser is opened on. |
| `export.templates.pdf` | `""` | myst template written into the document's `exports:` frontmatter when the editor creates the entry. |
| `export.templates.docx` | `""` | Same, for Word exports. |
| `export.templates.tex` | `""` | Same, for LaTeX exports. |

An empty template emits no `template:` line at all, which is what myst itself does: it ships no default template for any format. Naming one applies it to the entries the editor creates from then on; entries already present in a document are never rewritten.

```json
{
  "export": {
    "mystPath": "/opt/homebrew/bin/myst",
    "sitePort": 4000,
    "templates": { "pdf": "arxiv_nips", "docx": "curvenote" }
  }
}
```

Two conditions must hold before a file can be exported, and myst provides neither by default: a project (`myst.yml`) beside the document, and an `exports:` entry for the wanted format in its frontmatter. When either is missing the editor says so and offers to set both up — `myst init --site --write-toc` in that folder, then the frontmatter entry — rather than doing it silently.

---

## `data_directives` — extending the directive registry

`data_directives` adds to, or overrides, the built-in table that tells the editor how each MyST directive is labelled and numbered. Entries are merged over `BUILTIN_DIRECTIVES`, so naming an existing directive replaces its definition and any other name adds one.

| Field | Meaning |
|---|---|
| `kind` | Counter the directive shares. Directives with the same `kind` are numbered in one sequence. |
| `label` | Human-readable name used in cross-references ("Figure 3", "Table 2"). |
| `numbered` | Whether instances receive a number. |
| `caption` | Where the caption comes from: `"arg"` (the directive argument), `"body"`, or `"both"`. |
| `argIsLabel` | When true, the directive's argument is its label rather than its caption. |

```json
{
  "data_directives": {
    "definition": { "kind": "definition", "label": "Definition", "numbered": true, "caption": "arg" },
    "figure":     { "kind": "fig", "label": "Fig.", "numbered": true, "caption": "body" }
  }
}
```

> **Note.** The key is `data_directives`. A block named `directives` is read by nothing and silently ignored.

---

## `custom.css` — stylesheet overrides

`custom.css` is injected after the application stylesheet, so any rule or variable defined there wins. The active theme is exposed as a `data-theme` attribute on `#myst-css-namespace`, which gives a stable hook for per-theme overrides:

```css
/* Both themes */
#myst-css-namespace {
  --tok-comment: #999999;
}

/* Light theme only */
#myst-css-namespace[data-theme="lightTheme"] {
  --tok-keyword: #8b008b;
}

/* Dark theme only */
#myst-css-namespace[data-theme="darkTheme"] {
  --tok-keyword: #ff99cc;
}
```

The full list of CSS variables — syntax tokens, UI colours and Pyodide cell chrome — is documented separately in [myst-editor-css-variables.md](myst-editor-css-variables.md).

---

## A complete example

```json
{
  "autosaveIntervalMs": 120000,
  "recentFilesMax": 15,
  "fallbackImage": "./assets/image-not-found.png",
  "shortcuts": { "save": "Mod-s" },
  "pyodide": { "resetCwdOnRun": true },
  "export": {
    "sitePort": 4000,
    "templates": { "pdf": "arxiv_nips" }
  },
  "data_directives": {
    "definition": { "kind": "definition", "label": "Definition", "numbered": true, "caption": "arg" }
  }
}
```

Every other key keeps its default.
