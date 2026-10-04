---
title: Theming and Interface
---

Mystral Editor ships an explicit **light theme** alongside the dark theme, each defined as a full `CSSStyleSheet` with dedicated color tokens for the editor UI and CodeMirror syntax highlighting. Theme switching applies to both the main document and each editor's Shadow DOM.

Users can further customize the appearance with an optional `custom.css` file (scoped to `#myst-css-namespace`) that is loaded at startup and applied on top of the built-in themes. See [Customisation section](#customisation).

CodeMirror syntax highlighting colors are driven by CSS custom properties, making them easy to override per-project. The font stack uses self-hosted Lato (regular and bold weights, Latin and Latin-ext subsets).