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

Every other paste is untouched: this answers only when the clipboard holds an image — and not even then if it also holds a table. A spreadsheet puts a picture of the selection in the clipboard next to the data itself, and an image of a table is the poorest of the representations on offer. The table wins, and the notice described below appears instead.

### Pasting a table

A table copied from a spreadsheet or a web page is pasted as it always was — the tab-separated text, exactly as the clipboard gives it. A paste must never surprise: if you wanted the text, you get the text. A notice then appears offering to convert what was just inserted into a MyST table, with a button. Ignore it and it fades, and nothing has happened; press it and the pasted text is replaced in one go, so a single undo brings the text back.

Which of the three forms it offers depends on the data rather than on taste:

- a **pipe table** when the table is small and plain — the lightest to read in the source, and what most people mean by a table in Markdown;
- **`{csv-table}`** when the data is regular and wide, or has no header row of its own: a CSV stays legible in the source and goes back to a spreadsheet without losing anything;
- **`{list-table}`** as soon as a cell holds more than flat text — emphasis, a link, a line break. Neither of the other two can carry those.

A pipe table's first row *is* its header, so a table whose source says it has none is never written that way: it would promote a row of data without saying so, and `{csv-table}` can declare the absence.

A table's own title comes with it. Wikipedia and many another page put one inside the table as a `<caption>`, and a table copied as plain text often carries it as a first line above the data; either way it becomes the caption of the result — the argument of `{csv-table}` or `{list-table}`, and for a pipe table, which has nowhere of its own to put one, a `{table}` directive wrapped around it. A trailing colon is dropped: it introduced the table in the page it came from, and under the table it reads as a sentence cut short. In plain text a first line is only taken for a title when it is short and every line below it is tab-separated — a paragraph above a table stays a paragraph.

What comes from HTML keeps its bold, its italics, its inline code and its links; the rest of the markup is dropped. What comes from tab-separated text is taken as plain, and its first row as the header — which is what a spreadsheet paste almost always is.

### Joining the lines a PDF broke

Text copied out of a PDF arrives with a newline at the end of every printed line, because that is what the page had. Markdown reads those as part of the paragraph, so it renders as one block either way — until the passage is edited, reflowed, exported or searched, at which point every line is a little wall. `Mod-Shift-j` puts it back together: the selection if there is one, otherwise the paragraph the caret is in, which is usually where one already is after reading what was pasted.

What it joins is a paragraph and nothing else. A blank line separates paragraphs and is kept; a line that begins something of its own — a heading, a list item, a quote, a table row, a fence, a directive, a definition, a MyST comment — keeps the break before it; a heading, a quote or a table row is never appended to; and inside a fenced or colon-delimited block nothing is touched at all, a line break there being the code's own. Markdown's explicit hard breaks, two spaces at the end of a line or a trailing backslash, are removed along the way: they are what the command is named after.

A word the page cut in two is put back together: `exem-` followed by `ple` gives `exemple`. The hyphen is kept when what follows begins with a capital, since `Marie-` before `Claire` is a name and not an accident — and in both readings nothing separates the two halves.

The joined passage stays selected, so a second thought is one undo away and the eye finds what moved.

### Pasting a page

A fragment copied from a web page or a word processor carries its markup in the clipboard — headings, lists, quotes, code, links — and pasting it as text flattens every one of them. The same notice therefore offers to convert it to Markdown, on the same terms: the paste itself is untouched, the offer is one button, and one undo puts the text back.

Headings, nested lists, blockquotes, code blocks, tables, emphasis and links all come across. Scripts, styles and a page's navigation furniture are dropped rather than flattened into paragraphs of menu entries, and Wikipedia's `[edit]` links beside its headings go with them; a footnote marker such as `[61]` keeps its number and loses its link, which pointed into a page you no longer have.

An image keeps the address it had on the page. It is not written to disk as a pasted image is: that would mean fetching it over the network, from a document, which is a decision of its own rather than a detail of this one. The image shows while the page it came from is up.

A table standing on its own is not offered this way but the way described above, which picks the form that suits its cells. A table *among* prose comes through here with everything else, as a pipe table — splitting the two would mean losing one of them.

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
