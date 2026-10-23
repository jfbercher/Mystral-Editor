# Slides

A deck here is not a different kind of file. It is a document, cut into slides by markers it already knows how to write — which is the whole point: the admonitions, the cross-references, the bibliography, the maths with the document's own macros, the `{include}`s and the outputs of code cells are all still there, because nothing was converted.

:::{note} What exists so far
The **view**, the **presentation** and the **exports** are in place: the document cut into slides, drawn at projector size with the overflows flagged, projected one at a time with the cells still live, and written out as a standalone HTML deck or printed to PDF. A PDF comes out of the print dialog, and the deck exports to one standalone HTML file. What remains is polish, and it reads the same cut — that is the reason the cut lives in a function of its own.
:::

## Cutting a document into slides

Two markers, both of them horizontal rules, told apart by how they are written:

```
First slide.

---

Second slide.

----

Revealed after it.
```

`---` ends a slide. `----` ends a *fragment*: the part after it belongs to the same slide and is revealed separately during the presentation. Fragments are cumulative — what has been revealed stays on screen, which is what one wants when uncovering a list point by point.

`***` and `___` are left alone, so a plain horizontal rule inside a slide is still available.

One rule to learn, and it is markdown's own, not ours: **a blank line before the marker**. `----` written directly under a line of text is a level‑2 heading in setext syntax, not a rule — exactly as `---` directly under text is. The same mistake, and the same remedy, for both markers.

A document written before any of this can be cut without touching it: `slides.cutAtHeading: 2` in `config.json` also starts a slide at every `h1` and `h2`. Explicit markers always cut, whatever that setting says.

## The view

The **Slides** button puts the cut document in the preview pane, beside the source. The slides follow one another vertically and scroll like a document, so the rhythm of the deck is visible at a glance, the source stays under the author's eyes, and scroll synchronisation keeps working.

Each slide is drawn at its **nominal size** — 1280×720 by default, `slides.width` and `slides.height` in `config.json` — and then optically reduced to the width of the pane. This matters more than it sounds. A preview that let the text reflow to the width of the panel would wrap it differently from the projector, and would report an overflow where there is none or miss one that is there; it would lie, which is worse than having no preview. Reduced optically, what fits fits, at any panel width — so a half-width pane is not "too narrow", and the question of how wide to make it stops mattering.

The text is bigger than a document's, as it must be: `slides.fontSize` sets it, 28 pixels by default, and everything on a slide — headings, lists, maths, code, cell outputs — is sized in em, so that one number scales the whole slide together. The size is nominal, measured inside the 1280×720 box and reduced with it, so it means the same thing in a half-width panel and on the projector. As a rule of thumb, about fifteen lines of body text fit at 28 and eleven at 36; raising it is the quickest way to find out which slides are carrying too much.

### Per deck, in the frontmatter  

What a deck looks like usually belongs to the deck and not to the machine it is opened on — a 4:3 room, or a lecture whose slides carry three lines in very large type. A `slides:` block in the document's frontmatter overrides `config.json` for that file alone, and travels with it:  

```yaml
---
title: Fourier series
slides:
  fontSize: 40
  width: 1024
  height: 768
  verticalAlign: center
  cutAtHeading: 2
---
```

`fontSize`, `font-size` and `fontsize` are all accepted, as are `cutAtHeading` and `cut-at-heading`; a value that is not a positive number falls back to the setting rather than breaking the view.

### What `width` and `height` are for  

Not for how big the slides look — that is the zoom, below. They are the **shape of the box and how much goes in it**.

The shape first: `1280×720` is 16:9, `1024×768` is 4:3. Since the slide is always scaled to the width of the pane, what you see of these two numbers is the aspect ratio, and that should be the projector's.

Then the capacity. What decides how much text a slide holds is not the type size on its own but its size *relative to the box*: at `fontSize: 28` in a 1280-wide box a line runs to about seventy characters, and twenty-eight-pixel lines fit about fifteen times into 720. Double the box and leave the type size alone and you have halved the type, in effect, and doubled what fits. So in practice you set the pair once, to the room's projector, and from then on `fontSize` is the knob — it is the only one of the three that says anything about the deck rather than the hardware.

They matter again later, and more literally: the standalone export and the printed PDF will use these as real dimensions.

### Centring  

`slides.verticalAlign: center` puts the content in the middle of the box instead of flush with the top. Centring suits a deck of short slides; a lecture whose slides are uneven usually reads better flush to the top, where the titles line up from one slide to the next instead of drifting up and down. It is per deck too, so it can live in the frontmatter.

### Zoom, which is a different thing  

`Ctrl` (or `Cmd`) and the wheel, over the pane, makes the slides **bigger on screen**. There is a detent at 100%, and the level is remembered across sessions, like the width of a pane.

That is deliberately not the same control as the type size, and the distinction is what makes the view worth trusting. The type size changes *what fits on a slide* and belongs to the document; the zoom changes only *how big the picture of the slide is here* and belongs to whoever is looking at it. Enlarging the text to see better — the obvious shortcut — would make the pane disagree with the projector about what overflows, which is the one thing the view exists to get right.

So: if the slides look too small to read comfortably while editing, zoom. If they look too small *projected*, raise `fontSize` — and expect some slides to start overflowing, which is the view telling you something true.

A slide whose content does not fit its box is marked, with a red border and a band across its foot. That is the question the view exists to answer: a slide is a fixed box and a document does not know it is one, so the overflow is found here, before the lecture, rather than on the screen during it.

Everything stays alive in this view: the Pyodide kernel, the cell editors, the outputs. A cell can be edited and run while the deck is being written — and, later, during the lecture itself.

## Presenting  

The round **▶** at the top right of the pane starts the presentation, from the slide currently in view rather than from the beginning — so rehearsing the one slide you are working on costs nothing.

The pane then covers the window and asks the browser for real fullscreen. It asks rather than depends: a browser that refuses the request still gives a clean projection, because covering the window is done by the editor itself. `Escape` leaves.

One slide at a time, centred, as large as the display allows — both dimensions fit, which is why a 4:3 deck on a 16:9 screen gets bars rather than a crop.

### Moving through the deck  

| | |
|---|---|
| `Page Down`, `Page Up` | next, previous — **always**, even from inside a cell |
| `→` `↓` `Space` `Enter` | next |
| `←` `↑` `Backspace` | previous |
| `Home`, `End` | first slide, last slide fully revealed |
| click on the slide | next |
| `Escape` | leave |

Each step reveals the next fragment if the slide has one left, and otherwise moves on. Going back to a slide shows it as you left it — fully revealed — rather than making you uncover it again.

A click advances, except on something that was clearly aimed at: a cell's buttons or editor, a link, a figure to open.

### Cells during the lecture  

Everything stays live. A cell can be edited and run in front of the room, which is the reason this was not built on reveal.js or Marp.

That is also why `Page Down` and `Page Up` are listed first and marked *always*: they are what every presenter remote sends, and a remote has to keep working while the caret sits in a cell. The arrows and the space bar navigate too — except when the caret is inside a cell's editor, where they do what they must and move the caret. That single exception is what decides whether the mode is pleasant or unbearable.

A slide can of course overflow if a cell's output turns out longer than expected. That is the author's business, and the editing view flags it beforehand.

## Exporting  

While the slide view is open, the 📦 menu carries two more entries.

**Export slides (HTML)** writes one standalone file into `_build/exports` and opens it in your browser. It is also how you get a PDF — see below. It opens as a deck: one slide at a time, filling the window, with the same keys as the presentation — and `f` for fullscreen, since there is no editor around it to ask. The slide number is kept in the address, so a link can point at a slide.

Nothing is loaded from anywhere: the stylesheet, the theme and the navigation are all inside the file. The navigation is about seventy lines, which is the point — a deck that needs two hundred kilobytes of library to turn its own pages is a deck that stops working the day the library does.

The **code cells are frozen**: the code as text, the output as it last stood. Neither Pyodide nor CodeMirror is embedded, and that is deliberate — Pyodide is tens of megabytes of wasm plus its packages, which a file sent by email does not carry, and loading it from a CDN would only move the problem to a room with no network. The live cells stay in the editor, which is where the demonstration happens. An export is an export, and says so.

### The PDF  

There is no PDF command, and that is the design rather than a gap. Exporting the deck opens it in your browser; printing it from there — "Save as PDF" in the dialog — gives edge-to-edge pages at exactly the slide's dimensions, one slide per page, every fragment revealed, in the right orientation and with nothing to adjust. Two clicks, and they are the two you were already making.

A PDF command inside the application was built and taken out again, which is worth recording so it is not rebuilt. A stylesheet can declare the size and orientation of a printed page — the `@page` rule — and WebKit, which the desktop application runs inside on macOS, ignores that declaration. From inside the application the deck could therefore only be fitted to whatever sheet the dialog handed it, with the orientation chosen by hand, and the result was never quite right. Browsers honour the declaration, so the exported file prints correctly without any of that.

The remaining alternative would be to bundle a headless browser, which is what reveal.js and Marp both require to make their PDF — a dependency to install, locate on three platforms and explain. A browser already on the machine does the same job for nothing.

The same thing is on `shortcuts.print`, `Mod-Alt-p` by default — not plain `Mod-P`, which is the webview's own print on some platforms and is routinely claimed by a screenshot tool. It is a setting, so take whichever key is free on your machine; and if the key does nothing on yours, the menu entry does the same job.

The page is sized to the slide — 1280×720 or whatever the deck declares — so nothing is scaled or cropped on the way to the paper. That one rule has to be written at the moment of printing rather than kept in the stylesheet, because `@page` cannot read a custom property; it is written and then removed.

Printing is also how this editor avoids a dependency the alternatives carry: reveal.js and Marp both need a headless browser to produce a PDF, which would have to be installed, found and explained. A print dialog is already on every machine.

## How it works, and why it matters

The cut is made **in the source**, before rendering: in slide mode the preview's render chunks *are* the slides. A slide is therefore one element, and the view is a stylesheet.

The alternative — rendering as usual and regrouping the result afterwards — was rejected for a reason worth stating, because it is the constraint the whole feature is built around. Re-rendering a code cell destroys its editor, its output and its attachment to the kernel; the editor goes to some length elsewhere to avoid exactly that. A regrouping pass would also have to be redone at every keystroke. Cutting upstream costs nothing at runtime and leaves the cells alone.

The presentation moves nothing either. The slide being shown carries an attribute and the rest are hidden by a stylesheet; a fragment that has not been reached yet is made *invisible* rather than removed, so the slide does not reflow under the audience as a list is uncovered. Cells therefore survive the presentation exactly as they survive typing — same reason, same mechanism.

Printing reveals everything: a fragment that stayed hidden in a printed copy would hand out slides carrying their first third only, which is the kind of omission one discovers after distributing the file.

One function decides where a cut falls, and both halves of the feature call it. If the view and the export ever disagreed on that, what was rehearsed would not be what is projected.

## Settings

| Key | Default | Meaning |
|---|---|---|
| `slides.width` | `1280` | Nominal width of a slide, in pixels. |
| `slides.height` | `720` | Nominal height. `1280×720` is 16:9, `1024×768` is 4:3. |
| `slides.fontSize` | `28` | Size of the text on a slide, in pixels **of the nominal slide** — so it means the same in a half-width panel and on the projector. Everything on a slide is sized in em, so this one value scales headings, lists, maths and code together. Roughly 15 lines of body text fit at 28, 11 at 36. |
| `slides.verticalAlign` | `"top"` | Where the content sits in the box: `"top"` or `"center"`. |
| `slides.cutAtHeading` | `0` | Also cut at every heading of this level or above. `0` means markers only. |
| `slides.transition` | `"slide"` | How one slide gives way to the next in the presentation: `"none"`, `"fade"` or `"slide"`. |

See [customisation-reference](customisation-reference.md) for where `config.json` lives.
