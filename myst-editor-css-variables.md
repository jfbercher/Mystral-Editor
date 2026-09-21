# myst-editor — CSS Theming Variables Reference

---

## Overview

All theme colors in myst-editor are expressed as **CSS custom properties** (variables). There are two logical groups:

| Group | Prefix | Purpose |
|---|---|---|
| Syntax-token colors | `--tok-*` | Code highlighting in the editor and preview |
| UI colors | `--color-*` | Backgrounds, borders, and prose text in Pyodide cells |

### Where values are defined

**`src/styles/MystStyles.js`** is the **single source of truth**. It constructs two `CSSStyleSheet` objects (`lightTheme` and `darkTheme`) and installs them on `document.adoptedStyleSheets`. All variables are scoped to:

```css
#myst-css-namespace {
  --tok-keyword: …;
  --color-background-primary: …;
  /* … */
}
```

Changing a value in this file changes it consistently in both the editor (CM6 highlight style) and the preview (hljs CSS rules and Pyodide cell styling).

### Where variables are _consumed_

| File | What it reads |
|---|---|
| `src/extensions/pythonHighlightStyle.js` | `--tok-*` — CM6 HighlightStyle for the main editor and detached sub-editors |
| `src/extensions/index.js` → `syntaxHighlight` | `--tok-*` — CM6 HighlightStyle applied globally via `defaultPlugins()` |
| `src/components/Preview.js` | `--tok-*` — hljs CSS rules for the rendered preview |
| `src/markdown/pyodideRunner.js` | `--color-*` — Pyodide cell wrapper and output area styling |

You only need to edit those consumer files if you want the **preview** to use different colors than the **editor**, or vice-versa. For uniform changes, editing `MystStyles.js` alone is sufficient.

---

## `--tok-*` — Syntax-token colors

These are used wherever code is highlighted: fenced code blocks in the editor, code cells, and rendered code in the preview.

| Variable | Light value | Dark value | Used for |
|---|---|---|---|
| `--tok-keyword` | `#cf222e` (red) | `#ff7b72` (salmon) | Language keywords: `def`, `class`, `import`, `return`, `if`, `for`, … |
| `--tok-string` | `#0a3069` (dark blue) | `#a5d6ff` (light blue) | String literals, including f-strings and multi-line strings |
| `--tok-comment` | `#6e7781` (grey) | `#8b949e` (muted grey) | Inline and block comments (also rendered in _italic_) |
| `--tok-number` | `#098658` (green) | `#79c0ff` (blue) | Numeric literals: integers, floats, hex constants |
| `--tok-bool` | `#0000ff` (blue) | `#79c0ff` (blue) | Boolean literals (`True`, `False`) and `None` / `null` |
| `--tok-self` | `#0000ff` (blue) | `#79c0ff` (blue) | The `self` and `cls` parameters in Python methods |
| `--tok-function` | `#795e26` (brown) | `#d2a8ff` (lavender) | Function and method names at their **definition** site, and at call sites where the parser can determine they are callable |
| `--tok-property` | `#001080` (dark blue) | `#c9d1d9` (light grey) | Plain identifiers (e.g., `micropip` in `import micropip`), attribute accesses, function parameters |
| `--tok-atom` | `#af00db` (purple) | `#ff7b72` (salmon) | Atoms and decorators (lezer `atom` tag) |
| `--tok-operator` | `#000000` (black) | `#c9d1d9` (light grey) | Operators (`+`, `-`, `==`, `->`, …) and punctuation |
| `--tok-classname` | `#267f99` (teal) | `#7ee787` (green) | Class names, type names, and imported module namespaces |

### Notes on lezer tag mapping

The mapping from lezer/Python AST nodes to `--tok-*` variables follows these conventions:

- `import micropip` → lezer tags `micropip` as `VariableName`, so it receives `--tok-property`.
- `import numpy as np` → `numpy` and `np` get `--tok-property`; `as` gets `--tok-keyword`.
- A function call site (`micropip.install(…)`) → `micropip` is `VariableName` (`--tok-property`), `install` is `propertyName` (`--tok-property`).
- A class definition → the class name at definition is `className` (`--tok-classname`).
- `def foo(…)` → `foo` is `definition(variableName)` (`--tok-function`).

---

## `--color-*` — UI / structural colors

These govern the **Pyodide code-cell** chrome (input area, output area, borders) and are also available for any custom CSS that needs to track the editor's active theme.

| Variable | Light value | Dark value | Used for |
|---|---|---|---|
| `--color-background-primary` | `#ffffff` | `#2a2a2a` | Main background of Pyodide cell input and output areas |
| `--color-background-secondary` | `#f6f8fa` | `#1a1a1a` | Alternate/secondary background (e.g., output panel) |
| `--color-border` | `#d0d7de` | `#878787` | Cell border color |
| `--color-foreground-primary` | `#1f2328` | `#dddddd` | Primary text color inside cells |
| `--color-foreground-muted` | `#57606a` | `#8b949e` | Secondary / dimmed text (labels, captions) |

---

## Other theme variables (pre-existing)

The following variables were already present in `MystStyles.js` before the syntax-highlighting work. They control the broader editor UI.

| Variable | Typical role |
|---|---|
| `--accent-dark` | Accent color used for links, active borders, and `hljs-attr` (HTML/YAML attribute names) |
| `--error-bg` | Background tint for error/warning banners |
| _(others)_ | Check `MystStyles.js` for the full list; the pattern above covers all variables added or modified during the theming work |

---


## Conditional theming in `custom.css`

myst-editor switches themes by replacing JavaScript-managed `adoptedStyleSheets`. The active theme is also exposed as a **`data-theme` attribute** on `#myst-css-namespace` (set in `utils/local_utils/theme.js`), which gives `custom.css` a stable CSS hook.

```css
/* custom.css */

/* Light theme overrides */
#myst-css-namespace[data-theme="lightTheme"] {
  --tok-keyword: #8b008b;
  --tok-string: #006400;
  /* … */
}

/* Dark theme overrides */
#myst-css-namespace[data-theme="darkTheme"] {
  --tok-keyword: #ff99cc;
  --tok-string: #90ee90;
  /* … */
}

/* Unconditional override (same value in both themes) */
#myst-css-namespace {
  --tok-comment: #999999;
}
```

> **Cascade note**: `custom.css` rules targeting `#myst-css-namespace` win over the adopted stylesheets as long as the stylesheet is loaded after them (a `<link>` in the page `<head>` is sufficient).
