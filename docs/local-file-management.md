---
title: Local File Management
---

### Main menu

A dedicated menu bar handles documents on the local file system:

- **Open files** with recent-file history and quick open
- **Save** and **Save As**
- **Autosave** with a configurable interval in `config.json` (enabled by default)
- **Backup save** on demand
- **Working directory management**: used for local image path resolution
- **Document statistics** (word, paragraph, line and character counts)
- **Zoom** (Cmd/Ctrl +/-/0) in Tauri mode
- **Jupyter notebook import and export**: a `.ipynb` file can be opened directly, converted to MyST Markdown on the fly, and *Save As* can write the document back to `.ipynb` -- code and text are carried over, cell outputs are not

### File access

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

### Changes made outside the editor

The editor notes when a file was last written, as it reads it and after each of its own saves. If the file has been written by something else in the meantime — another editor, a `git checkout` or `git pull`, a script, the same document open in a second window — saving stops to ask, with three ways out: save anyway, which replaces what is on disk; reload from disk, which replaces what is in the editor, unsaved changes included; or leave both alone, which is what you want when neither version is expendable — *Save As* then keeps yours under another name and the two can be compared.

The question is asked in two steps, because the native dialogs of both platforms carry two buttons and no more: first whether to save over the file, then, if not, whether to load its version instead. Declining both changes nothing.

Autosave does not ask: a dialog appearing on a timer while you type would be worse than what it reports. It holds off instead, says so once, and waits for you to save yourself and make the choice. Nothing is lost either way — your text is still in the editor.

A comparison that cannot be made is never treated as a conflict: a document with no file yet, a file opened through `<input type="file">`, a notebook whose Markdown sibling does not exist yet, or a modification time the system declines to give all save without a question. Differences below a second are ignored, since filesystems do not all keep the same resolution.
