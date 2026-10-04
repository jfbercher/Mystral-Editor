---
title: Customisation
---

Mystral Editor can be customised through two optional files: **`config.json`** (runtime settings) and **`custom.css`** (stylesheet overrides). Neither file is required — the app runs fine without them, falling back to built-in defaults.

- **`config.json`** accepts any subset of the keys defined in `config-defaults.js` (`suspendAfterMs`, `autosaveIntervalMs`, `shortcuts`, `pyodide.resetCwdOnRun`, etc.) as well as a `data_directives` object to extend or override the built-in MyST directive registry. An example of `config.json` can be seen on the public folder in the repo: [config.json](https://raw.githubusercontent.com/jfbercher/Mystral-Editor/refs/heads/main/src/public/config.json).

- **`custom.css`** is injected after the application stylesheet, so any CSS variable or rule defined there takes precedence.

:::{example} Css
:label: css
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
:::

Where to place these files depends on how you are running the app:
For  **Web / dev server** — put both files in `src/public/`. Vite copies them to `dist/` at build time, where they are served alongside the application bundle.

For *Tauri desktop apps*:
| Platform | Path (`appConfigDir`) |
|---|---|
| macOS | `~/Library/Application Support/MystralEditor/` |
| Linux | `~/.config/MystralEditor/` |
| Windows | `%APPDATA%\MystralEditor\` |