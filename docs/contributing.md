---
title: Contributing
---

### Prerequisites

- **Node.js v20** — recommended version; required for the test suite.
- **Rust and Cargo** (stable toolchain) — required only to build the Tauri desktop application.
- **Tauri CLI** — install with `cargo install tauri-cli` or `npm install -g @tauri-apps/cli`.

### Repository Setup

Clone the repository and install dependencies:

```bash
git clone https://github.com/jfbercher/Mystral-Editor.git
cd Mystral-Editor
npm install
```

Mystral Editor requires a few additional packages beyond the upstream baseline:

```bash
npm install katex markdown-it-texmath js-yaml @codemirror/lang-python
```

### Regenerating the schemas

The JSON schemas the language servers validate against -- `src/public/schemas/frontmatter.schema.json` for a document's frontmatter, `myst.schema.json` for a project configuration, `config.schema.json` for the editor's own `config.json` -- are generated, not written:

```bash
npm run schemas
```

mystmd publishes no schema of its own; it validates by hand, in TypeScript. But it exports the key lists and the alias map, so `scripts/generate-yaml-schemas.mjs` reads them from the installed `myst-frontmatter` and `myst-config` and builds the schemas from the version actually in `node_modules`. Upgrade mystmd, run the command again, and the editor stops offering keys that version no longer knows.

`config.schema.json` is generated the same way, by `scripts/generate-config-schema.mjs`, from `src/config-defaults.js`: the shape of each key is read off its default value, and **its description is the comment written above it**. So documenting a setting and documenting the editor are the same act -- write the comment, run the command, and the explanation appears on hover in anyone's `config.json`. Two things a default value cannot express stay in the script by hand: the closed sets of values (`editorMode`, `pyodide.offline`, `slides.verticalAlign`), in `OVERRIDES`, and the keys the configuration file accepts without holding them in `DEFAULT_CONFIG`, in `EXTRA` -- `data_directives` is one.

Nothing runs any of it for you: neither `npm run dev` nor `npm run build` calls `npm run schemas`, and the build only copies `src/public/` into `dist/`. So run it after bumping mystmd, after adding or changing one of this editor's own keys in the `OURS` block of the YAML generator, and after editing the comments in `config-defaults.js`. The generated files are sources like any other and are committed as such, since they are what the application serves.

### Development

Start the Vite dev server with hot reload:

```bash
npm run dev
```

To run with native Tauri desktop features (file dialogs, filesystem access, updater):

```bash
npm run tauri dev
```

### Building

Build the web app only:

```bash
npm run build
```

Build the full Tauri desktop application for the current platform:

```bash
npm run tauri build
```

Cross-platform release builds (macOS Apple Silicon/Intel, Linux x64/ARM64, Windows) are produced automatically by the GitHub Actions workflow (`.github/workflows/release.yaml`) when a `v*` tag is pushed.

### Running the Tests

The Playwright suite runs against the **built and previewed** app. Start three processes before running tests.

First-time setup:

```bash
npm install && npx playwright install
```

Terminal 1 — build and preview the app:

```bash
npm run build && npm run preview
```

Terminal 2 — collaboration server:

```bash
cd bin && npm install
YPERSISTENCE=/tmp/myst-yjs-db PORT=4455 node server.js
```

Terminal 3 — run the tests (Node 20 required):

```bash
npx -y node@20 /usr/bin/npm run test
```

To run a single test, pass a `-g` name filter:

```bash
npx -y node@20 node_modules/@playwright/test/cli.js test -c tests/playwright.config.js -g "test name"
```

### Diagnosing the Inline-mode layout

In Inline mode every block of the document is a CodeMirror *block widget*: a
rendered chunk standing in for the source lines it replaces. CodeMirror has to
know how tall each one is before it draws it, so the editor keeps the heights
it has measured and, for the rest, estimates them from a shape fitted at
runtime. When one of those answers is wrong, the document's height changes
under the reader, the view slides, and the console says
`Measure loop restarted more than 5 times`.

A trace is built into the measuring pass to tell the possible causes apart. It
is off by default and costs nothing; turn it on from the console and reload:

```js
localStorage.mystInlineDebug = "1"   // "0", or remove the key, to stop
```

It survives the reload on purpose: the lines that matter are those of the
*first* measurement of each block, and by the time one has opened a console
everything on screen has already been measured once.

Two lines are printed. One per measuring pass:

```
[inline] passe 47 : 20 blocs, contenu=579, hauteur doc=23657
[inline]   2 bougent -- L535-535 math 48->68 | L548-553 prose 155->156
```

and one the first time a given block is measured, giving the estimate against
what it really measures:

```
[inline] L543-548 prose : 6 lignes, 658 caracteres, estime 144 -> reel 156 (rapport 2.61, forme 25+4.7x)
```

How to read them:

A pass that draws blocks and reports none moving is a layout at rest -- that is
the normal state, and seeing it is how one knows the problem is elsewhere.

Heights moving while `contenu=` holds is content arriving after the block was
drawn: a code cell building its own editor, a font loading, an image without
stated dimensions.

A height moving by exactly one line *while* `contenu=` changes is text that
wrapped differently. That is a width problem wearing a height's clothes, and
the width is printed beside the heights for exactly this reason. Rendered
blocks are given a measured width (`pinContentWidth`) so that no single
unshrinkable block can widen the content and re-wrap all the others; a
`contenu=` that moves means something has got around that.

`estime -> reel` is the line worth watching in the long run. The shapes the
estimates come from -- `forme 25+4.7x`, read as *margins + line height x
rendered lines* -- are fitted as the editor measures real blocks, so they
adapt silently and, when they go wrong, say nothing. A document of an unusual
kind, a theme with another leading, a font that loads late: nothing else
reports it. A handful of these lines, pasted into an issue, is enough to see
whether the model is still fitting.

### Releasing a New Version

Use the `Makefile` release target to bump versions, commit, tag, and push:

```bash
make release VERSION=x.y.z
```

This updates the version string in `src-tauri/Cargo.toml` and `tauri.conf.json`, creates a git tag `vx.y.z`, and pushes it — triggering the CI release workflow automatically.
