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

### Pasting an image

An image in the clipboard — a screenshot, a picture copied from a page or a spreadsheet — is pasted into the document as a figure. The bytes are written beside the document, in a folder of their own, and a `{figure}` pointing at the new file is inserted with the caret on its caption line, which is empty and waiting:

```markdown
:::{figure} pasted-images/my-notes-20261120-143012.png
:name: my-notes-20261120-143012
:alt: Pasted image

:::
```

The `:name:` is the file's own stem, unique by construction, so the figure is numbered and referenceable from the moment it is pasted — rename it to something you would willingly type in a `{ref}`, or delete the line. The `:alt:` is a placeholder and says so: the only thing available to fill it with automatically would be the file name, and an alternative text reading `my-notes-20261120-143012.png` is worse, for a reader who depends on it, than an honest line asking to be replaced.

The folder is `pasted-images`, next to the document, and `pastedImagesDir` in `config.json` renames it. A folder of its own is not tidiness: it is what makes cleaning up decidable later. In a folder nothing else writes to, *delete what no document refers to any more* is a question one can answer without risk, whereas the same sweep over a general images folder would reach pictures put there by hand. The inserted path stays relative to the document, so the export and the site resolve it.

The file name carries the moment of the paste, which keeps two of them from colliding, and a name: the pasted file's own when it has one worth keeping — a file copied in the Finder or in Explorer brings its name along, and `diagramme-flux` says more than `my-notes` — and the document's otherwise. A system screenshot called *Capture d'écran 2026-11-20 à 14.30.12* is a date rather than a subject, and counts as having none.

Two things worth knowing. An undo takes back the figure and not the file: a text editor's undo does not reach the disk, and the orphan left behind is the price — the dedicated folder is what will make it recoverable. And a document that has never been saved has no folder to write beside, so the picture goes into the document itself as a `data:` URL and a message says so; saving first and pasting again writes a file instead. In the browser, the same holds until a working folder is chosen.

Every other paste is untouched: this answers only when the clipboard holds an image.

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
