---
title: Customisation Reference
---

## Overview

Mystral Editor reads two optional files at startup. Neither is required: without them, the app runs fine on its built-in defaults.

| File | Purpose |
|---|---|
| `config.json` | Runtime settings: intervals, shortcuts, Pyodide behaviour, export commands, directive registry |
| `custom.css` | Stylesheet overrides, injected after the application stylesheet |

(Where-they-live)=
### Where they live

| Build | Location |
|---|---|
| Web | `src/public/` during development, copied to `dist/` on build; fetched relative to the app's base URL |
| Tauri (macOS) | `~/Library/Application Support/MystralEditor/` |
| Tauri (Linux) | `~/.config/MystralEditor/` |
| Tauri (Windows) | `%APPDATA%\MystralEditor\` |

The defaults live in `src/config-defaults.js`, which is the reference for every key below.

The **Settings** panel has an *Open config.json* button that opens the file for the installation in use, so the paths above rarely need to be typed. In the desktop build it creates the file when it does not exist yet — the system cannot open a file that is not there — and hands it to whatever application opens `.json`. The file it writes is the **complete** set of defaults, directive registry included: JSON takes no comments, so a full file is the only way for it to document itself. Nothing changes until a value is edited. The counterpart is that those values are pinned — a default changed in a later version will not reach a file that names it — so deleting a key is how you go back to following the default. In the web build the file is served with the application and cannot be written from the browser: it opens in a tab for reading, and changing it means editing the file on the server.

The panel's toggles are a different thing: they are remembered per browser, in `localStorage`, and take effect immediately. `config.json` is read once at start-up. **Auto-save** appears among the toggles, seeded from `autoSaveEnabled` below and overriding it once touched.

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
| `foldFrontmatterOnOpen` | `true` | Whether a document opens with its frontmatter folded. This is the starting point only: folding or unfolding one is remembered from session to session and outranks the setting from then on, as the view mode does. |
| `fallbackImage` | a remote placeholder URL | Image shown when a referenced file cannot be resolved. A relative path such as `./assets/image-not-found.png` keeps the app working offline. |

---

## `shortcuts` — keyboard bindings

| Key | Default | Action |
|---|---|---|
| `shortcuts.save` | `"Mod-Shift-s"` | Save, or Save as… for a document with no file yet |
| `shortcuts.open` | `"Mod-Shift-o"` | Open a file |
| `shortcuts.newTab` | `"Mod-Shift-e"` | New tab |
| `shortcuts.modeDual` | `"Mod-Shift-d"` | Switch to the dual pane |
| `shortcuts.modePreview` | `"Mod-Shift-p"` | Switch to the preview alone |
| `shortcuts.modeInline` | `"Mod-Shift-l"` | Switch to the inline preview |
| `shortcuts.modeSlides` | `"Mod-Shift-m"` | Switch to the slide view. `m` because "slides" has no free initial left; in a browser tab Firefox and Chrome both claim this one, so it only works in the desktop build unless you change it. |

`Mod` is Cmd on macOS and Ctrl elsewhere, following CodeMirror's convention. Modifiers are combined with `-`, for instance `"Mod-Alt-p"`.

These defaults are the same on the three platforms, which is why the inline preview is on `l` rather than the `i` of its name: `Ctrl-Shift-i` opens the developer tools on Windows and Linux, in the webview as in a browser, so the editor never sees it there. One binding that works everywhere keeps `config.json` portable from one machine to the next.

Some keys are still taken by the system, the browser or another application before the editor sees them, and that varies from one setup to the next. If one of these collides with something on yours, change it in `config.json`, which the `Settings` menu at the top left of the editor opens. Two directions worth trying: a letter that nothing claims, or `Alt` in place of `Mod`, which is free more often on Windows. In Firefox, note that `Ctrl-Shift-p` opens a private window.

---

## `spellcheck` — the language of the spell checker

| Key | Default | Meaning |
|---|-------|---|
| `spellcheck.language` | `"en_US"` | The dictionary used when a document declares no language of its own. |

A document's frontmatter wins over this:

```yaml
---
title: Transformée de Fourier
language: fr
---
```

The value is the dictionary's name. `fr` is accepted and looked up as `fr_FR`, which is what the folder is called, so you rarely need the long form. The language is also inherited from the project, being read from the effective frontmatter.

**Adding a language.** `en_US` ships with the application. Any other is a folder in the configuration directory, see [](#Where-they-live), beside `config.json` and holding the two files of a hunspell dictionary:

```
dictionaries/fr_FR/fr_FR.aff
dictionaries/fr_FR/fr_FR.dic
```

A site collecting dictionnaries is [https://github.com/wooorm/dictionaries/](https://github.com/wooorm/dictionaries/). 

The configuration folder is looked at first, so a bundled language can also be replaced by a dictionary you prefer. Hunspell dictionaries are what LibreOffice and Firefox use, and are packaged for every language of any size.

A document declaring a language nobody has installed keeps the checking it had rather than losing it, and the browser console says which dictionary was missing. Note that the configuration folder is read by the desktop build only; in a browser, the dictionaries served with the application are all there is.

---

## `pyodide` — executable code cells

:::{table} 
:label: 

| Key | Default | Meaning |
|---|-----------|---|
| `pyodide.resetCwdOnRun` | `false` | `false` keeps notebook behaviour: the working directory persists from one cell to the next, so a cell may `os.chdir()` and the following ones stay there. `true` resets to `/local` before every run, which makes each cell reproducible in isolation at the cost of that continuity. |
| `pyodide.figureWidth` | `""` | Default width of the matplotlib figures a cell produces, as a CSS length (`"60%"`, `"20em"`, `"480px"`). Empty leaves each figure at its natural size, bounded by the width of the cell. A cell overrides it with its own `:figwidth:` option. |
| `pyodide.keys.run` | `"Shift-Enter"` | Run the current cell. |
| `pyodide.keys.insertBelow` | `"Mod-Shift-Enter"` | Insert an empty cell below the current one. |
| `pyodide.keys.inspect` | `"Alt-v"` | Open the variable window. |
| `pyodide.keys.clear` | `""` | Clear the current cell's output. |
| `pyodide.keys.runAll` | `""` | Run every cell of the document. |
| `pyodide.keys.clearAll` | `""` | Clear every output. |
| `pyodide.keys.restart` | `""` | Restart the kernel, clearing all variables. |
| `pyodide.keys.deleteCell` | `""` | Delete the current cell. |
| `pyodide.keys.editSource` | `""` | Inline preview only: show this cell as its markdown source (Escape comes back). |
| `pyodide.keys.toggleInput` | `""` | Fold this cell's code away, or back |

:::



Which Python namespace a document's cells run in is not set here: it belongs to the document, through the `python:` key of its frontmatter (`shared`, `isolated`, or a group name). A project can still set it once for all of its documents, in the `project:` block of its `myst.yml`. See [executable-content](executable-content.md).

These shortcuts apply only while the cursor is inside a code-cell editor, and they take precedence there over the editor's own bindings: giving one a key the editor already uses, `"Mod-s"` for instance, shadows it inside cells. An empty string means the action has no shortcut. A binding CodeMirror cannot parse is reported in the browser console and dropped, so a typo costs that one shortcut rather than the cell's whole keymap.

`Tab`, which accepts a completion or indents, and the arrow keys that move between cells are not configurable.

[executable-content](executable-content.md) describes what each action does, and the rest of the code-cell machinery.

---

## `slides` — the slide view and the slide export

One section for both, deliberately: the view, the fullscreen presentation and the export read the same settings and the same cut, so that what is rehearsed is what is projected.

| Key | Default | Meaning |
|---|-------|---|
| `slides.width` | `1280` | Nominal width of a slide, in pixels. |
| `slides.height` | `720` | Nominal height. `1280×720` is 16:9; set `1024×768` for 4:3. |
| `slides.fontSize` | `28` | Size of the text on a slide, in pixels **of the nominal slide** — so it means the same in a half-width panel and on the projector. Everything on a slide is sized in em, so this one value scales headings, lists, maths and code together. Roughly 15 lines of body text fit at 28, 11 at 36. |
| `slides.padding` | `"48px 56px"` | The margin inside a slide, as a CSS padding shorthand. It is the space above the header and below the footer as much as around the body, since both sit inside it. |
| `slides.header` | `""` | A line across the top of every slide, in three parts separated by `\|`: left, middle, right. Empty means none, and costs no space. |
| `slides.footer` | `""` | The same, across the foot. |
| `slides.headerStyle` | `""` | CSS declarations applied to the header — `"font-size: 18px; color: #888; border-bottom: 1px solid #ddd"`. |
| `slides.footerStyle` | `""` | The same, for the footer. |
| `slides.background` | `""` | The slide's background, as any CSS colour. Empty follows the theme. |
| `slides.verticalAlign` | `"top"` | Where the content sits in the box: `"top"` or `"center"`. |
| `slides.cellFontSize` | `18` | Size of a code cell's text on a slide, same nominal pixels as `fontSize`. Separate because a cell's stylesheet is written in rem, which is rooted at the document rather than at the slide, so it cannot follow the prose on its own. |
| `slides.cutAtHeading` | `0` | Also start a slide at every heading of this level or above — `2` cuts at `h1` and `h2`. `0` means only the explicit markers cut. |
| `slides.marker` | `"both"` | Which spelling cuts a slide: `"both"`, `"plus"` (only `+++`) or `"dash"` (only `---`). Slide cuts only — `----` and `++++` are always fragments. |
| `slides.transition` | `"slide"` | How one slide gives way to the next while presenting: `"none"`, `"fade"`, `"slide"`, `"slideUp"` or `"zoom"`, optionally followed by a duration on the same line — `"fade 700ms"`, `"slideUp 1.2s"`, or a bare number read as milliseconds. 450ms without one, clamped to 3s. An unknown name falls back to `"slide"`. |

A document can override any of these for itself with a `slides:` block in its frontmatter — geometry and type size usually belong to the deck rather than to the installation. How large the slides are *drawn in the pane* is neither: that is `Ctrl`/`Cmd` and the wheel, remembered across sessions, and it is kept separate on purpose, since enlarging the text would change what fits on a slide and the view would stop agreeing with the projector. See [slides](slides.md).

A slide is laid out at its nominal size and then optically reduced to fit whatever panel it is shown in. That is the reason the size is a setting rather than the panel's width: a preview that reflowed to the panel would show text wrapping differently from the projector, and would report an overflow where there is none, or miss one — which is worse than having no preview.

---

## `export` — export menu (Tauri only)

This section drives the 📦 menu, which shells out to `myst` and therefore exists only in the desktop build.

| Key | Default | Meaning |
|---|-------|---|
| `export.mystPath` | `"myst"` | Command used to invoke mystmd — a path, or a whole command line such as `npx myst`. Commands run through a **login shell**, which reads `/etc/profile` and `~/.profile` but not `~/.zprofile` or `~/.zshrc`, and an application launched from the desktop inherits no terminal environment: the bare name then fails. Leaving this empty is fine — on macOS and Linux the editor looks for mystmd the first time a command is not found and writes what it finds here. On Windows there is nothing to look for: an application started from the desktop inherits the user's PATH from the registry, and the bare name works. When the value is an absolute path, its directory is placed at the head of the PATH before mystmd runs: `myst` is a node script whose shebang resolves `node` through the PATH, so a myst found in one installation would otherwise run under whichever node the login shell happens to see — a mismatch that surfaces as an obscure failure deep inside mystmd rather than as a version error. |
| `export.mystSearchPaths` | `[]` | Extra absolute paths, globs allowed, added to the places searched for mystmd. macOS and Linux only. |
| `export.nodePath` | `""` | Interpreter mystmd must run under. `myst` is a node script whose shebang resolves `node` through the PATH, and the PATH of a login shell is not the one a terminal shows: a myst installed by pip or pipx in `~/.local/bin`, or by Homebrew beside a node the login shell never reaches, then reports `Node.js (node) is required to run MyST, but could not be found`. Leave this empty: the first time myst says so, the editor looks for the **newest** node on the machine — several are usually installed, and the oldest is often the one found first — and records it here. `export.nodeSearchPaths` adds to the places looked at. If the newest node on the machine is older than 22, the editor says so instead of using it: mystmd's own check accepts 18, but a node 20 builds well enough to look healthy and then dies in the site server with an error naming neither Node nor a version. Beware in particular of the node mystmd offers to install for itself when it finds none — it has been seen to install a 20.0.0, below its own requirement. Not used on Windows. |
| `export.pdfViaTex` | `true` | Produce a PDF by exporting LaTeX, rewriting it (see `postProcessTex`) and running the LaTeX chain here. `myst build --pdf` goes from Markdown to PDF through a `.tex` the editor never sees, so the coloured boxes, the restored proof labels and the injected `\label{}` cannot reach the PDF any other way. The document must then declare a **`tex`** export rather than a `pdf` one — the editor offers to add it, with the template configured for PDF — and a LaTeX installation is required. Set to `false` to let mystmd build the PDF itself, unstyled. |
| `export.pdfCommand` | jtex's own command | Command run on the `.tex` to produce the PDF, in the folder holding it. `{file}` is replaced by the file name and `{engine}` by the engine the template asks for in its `template.yml` — the same `build.engine` jtex reads — falling back to `-xelatex`, jtex's own default, when the template asks for none. The command itself is jtex's, so a document that built under mystmd builds here the same way. Being JSON, inner quotes must be escaped: `-latexoption=\"-shell-escape\"`. |
| `export.latexPath` | `""` | Full path of the program `pdfCommand` names, `latexmk` by default. The same blind spot as `nodePath`, and a worse one to read: a desktop application does not inherit a terminal's PATH, so the LaTeX chain is found in development and missing from a bundled build — and since a run that never started leaves no `.log`, the editor used to quote the one an earlier build had left behind. Leave this empty: the editor looks where TeX distributions install — MacTeX's `/Library/TeX/texbin`, MacPorts, Homebrew, a TeX Live installed by its own installer, the distribution's own packages — then asks an interactive shell, and records what it finds here. `export.latexSearchPaths` adds to the places looked at. The directory found is put at the head of the PATH rather than substituted into the command, because latexmk in turn runs `xelatex`, `biber` and `kpsewhich` by name and they are its neighbours. A recorded path that no longer resolves — what upgrading TeX Live to the next year leaves behind — is dropped and looked for again. Not used on Windows. |
| `export.postProcessTex` | `true` | Rewrite the `.tex` produced by a LaTeX export. Admonitions become coloured boxes carrying their kind and their `:label:`, labels of the proof family that mystmd lowercased are put back as the author typed them — without which a cross-reference resolves to `??` — and a blank line is added after a closing environment, which mystmd runs straight into whatever follows. The rewrite only happens when the source and the `.tex` can be matched beyond doubt: the admonitions of one must line up with the `framed` environments of the other, titles included. Otherwise the file is left exactly as mystmd wrote it and the reason is shown, because rewriting in the wrong places is worse than not rewriting. Only `.tex` exports are concerned: a PDF is produced by mystmd from a `.tex` the editor never sees. |
| `export.admonitionColors` | one colour per kind | Colour of each admonition kind in a LaTeX or PDF export, as an `RRGGBB` hex string (a leading `#` is accepted). mystmd draws every admonition as the same grey box — the kind the author wrote exists in its syntax tree but is never read when it writes LaTeX — so the editor rewrites them as coloured boxes after the export. The frame takes the colour and the background a 6 % tint of it. Keys: `attention`, `caution`, `danger`, `error`, `hint`, `important`, `note`, `seealso`, `tip`, `warning`, and `plain`, used for a generic `{admonition}` with no title. Only the keys you give are changed; a value that is not a six-digit hex colour is reported in the console and the default kept. |
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
    "admonitionColors": { "note": "1B6B50", "warning": "C8800F" },
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
| `reference` | When true, the directive's argument names another target rather than being a caption — the `solution` case, which takes the number of the exercise it answers. |
| `refJoiner` | Read on the `solution` entry only: the word between the two names in a reference, *Solution **to** Exercise 1*. Defaults to `"to"`. |

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
