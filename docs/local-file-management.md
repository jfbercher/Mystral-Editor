---
title: Local File Management
---

A dedicated menu bar handles documents on the local file system:

- **Open files** with recent-file history and quick open
- **Save** and **Save As**
- **Autosave** with a configurable interval in `config.json` (enabled by default)
- **Backup save** on demand
- **Working directory management**: used for local image path resolution
- **Document statistics** (word, paragraph, line and character counts)
- **Zoom** (Cmd/Ctrl +/-/0) in Tauri mode

In web mode (outside Tauri), file access goes through the browser File System Access API (Chrome/Edge) with IndexedDB for tab-state persistence.

:::{figure} figures/menu-bar-tauri.gif
:name: menu-bar-tauri
:alt: Menu bar in Tauri apps
:width: 90%

*Menu bar for Tauri applications* (version 0.9.9) - local file management  (open, save, save as...), export menu (export as pdf, latex, html, complete website...), visualisation mode (dual, source, preview, inline-preview).. 
:::

:::{figure} figures/menu-bar-web.gif
:name: menu-bar-web
:alt: Menu bar in Web app
:width: 90%

*Menu bar for web distribution* (version 0.9.9) - local file management  (open, save, save as...), visualisation mode (dual, source, preview, inline-preview).. 
:::

Each tab's state (file name, dirty flag, Yjs comments) is saved and restored across sessions. A tab marked *dirty* (unsaved changes) is shown visually in the tab bar.