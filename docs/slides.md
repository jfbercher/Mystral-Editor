# Slides

A deck here is not a different kind of file. It is a document, cut into slides by markers it already knows how to write — which is the whole point: the admonitions, the cross-references, the bibliography, the maths with the document's own macros, the `{include}`s and the outputs of code cells are all still there, because nothing was converted.

:::{note} What exists so far
The **view**, the **presentation** and the **exports** are in place: the document cut into slides, drawn at projector size with the overflows flagged, projected one at a time with the cells still live, and written out as a standalone HTML deck or printed to PDF. A PDF comes out of the print dialog, and the deck exports to one standalone HTML file. What remains is polish, and it reads the same cut — that is the reason the cut lives in a function of its own.
:::

## Cutting a document into slides

Two markers, each in two spellings:

```
First slide.

---

Second slide.

----

Revealed after it.
```

`---` ends a slide. `----` ends a *fragment*: the part after it belongs to the same slide and is revealed separately during the presentation. Fragments are cumulative — what has been revealed stays on screen, which is what one wants when uncovering a list point by point.

`+++` and `++++` mean the same two things:

```
First slide.

+++

Second slide.

++++

Revealed after it.
```

Both spellings work in the same document, and nothing distinguishes them once the deck is cut. Which to use is a matter of where the document comes from and what else you want to write in it.

`---` is what Marp, reveal.js and remark use, so it is what you already write if you have made slides elsewhere. `+++` is MyST's own structural division — the thing that separates the cells of a notebook — so it is already in any document converted from one, and it is the spelling to prefer when a page is both a deck and a notebook.

### Choosing one  

By default both spellings cut, which is convenient and leaves neither free. `slides.marker` picks one instead, and what it buys is what the other spelling goes back to meaning:

```yaml
slides:
  marker: plus
```

With `plus`, only `+++` cuts and `---` is a horizontal rule again — the line you asked for, drawn where you asked for it. With `dash`, only `---` cuts, which is what a document converted from a notebook usually wants: its `+++` lines are cell boundaries, and nobody asked for them to become sixty slides. With `both`, the default, either cuts and neither is free.

It governs **slide cuts only**. `----` and `++++` are fragment markers under every setting: a four-dash rule is an odd thing to write on purpose, where a three-dash one is not. And `***` and `___` are horizontal rules whatever you choose — they have always been the way out, and remain the shortest one.

`+++` can also carry metadata, the way MyST does it — `+++ {"fontSize": 44}` — and that is read. The comment block described under *Settings for one slide* still wins over it, and is the better place: strict JSON with its quotes is a poor thing to ask of someone writing a lecture.

One rule to learn, and it is markdown's own, not ours: **a blank line before the marker**. `----` written directly under a line of text is a level‑2 heading in setext syntax, not a rule — exactly as `---` directly under text is. The same mistake, and the same remedy, for every one of these markers.

A document written before any of this can be cut without touching it: `slides.cutAtHeading: 2` in `config.json` also starts a slide at every `h1` and `h2`. Explicit markers always cut, whatever that setting says.

## The view

The **Slides** button — or `Mod-Shift-m`, which `shortcuts.modeSlides` can change — puts the cut document in the preview pane, beside the source. The slides follow one another vertically and scroll like a document, so the rhythm of the deck is visible at a glance, the source stays under the author's eyes, and scroll synchronisation keeps working.

Each slide is drawn at its **nominal size** — 1280×720 by default, `slides.width` and `slides.height` in `config.json` — and then optically reduced to the width of the pane. This matters more than it sounds. A preview that let the text reflow to the width of the panel would wrap it differently from the projector, and would report an overflow where there is none or miss one that is there; it would lie, which is worse than having no preview. Reduced optically, what fits fits, at any panel width — so a half-width pane is not "too narrow", and the question of how wide to make it stops mattering.

The text is bigger than a document's, as it must be: `slides.fontSize` sets it, 28 pixels by default, and everything on a slide — headings, lists, maths, code, cell outputs — is sized in em, so that one number scales the whole slide together. The size is nominal, measured inside the 1280×720 box and reduced with it, so it means the same thing in a half-width panel and on the projector. As a rule of thumb, about fifteen lines of body text fit at 28 and eleven at 36; raising it is the quickest way to find out which slides are carrying too much.

**Code cells have their own size**, `slides.cellFontSize`, 18 by default. They need one: a cell's stylesheet is written in rem, which is rooted at the document rather than at the slide, so raising `fontSize` leaves every cell exactly as small as it is in an ordinary preview — and code is the one thing on a slide that has to be legible from the back of the room. It is smaller than the prose by default, because a line of code carries more characters and because code shown in a lecture is usually being pointed at rather than read through.

### Per deck, in the frontmatter  

What a deck looks like usually belongs to the deck and not to the machine it is opened on — a 4:3 room, or a lecture whose slides carry three lines in very large type. A `slides:` block in the document's frontmatter overrides `config.json` for that file alone, and travels with it:  

```yaml
---
title: Fourier series
slides:
  fontSize: 40
  cellFontSize: 28
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

### A header, a footer, a background  

```yaml
---
title: Fourier series
slides:
  header: Signal processing — M1
  footer: J.-F. Bercher
  footerPage: Slide {n}/{total}
  background: "#f7f7f5"
  padding: 28px 56px
  transition: fade 700ms
  headerStyle: "font-size: 18px; color: #888; border-bottom: 1px solid #ddd"
---
```

The footer is in two parts so that a page number can sit at the right while something else sits at the left. `footerPage` is a template — `{n}` and `{total}` are replaced — and defining it moves the number into the footer and takes away the badge in the corner, so it cannot appear twice. Leave `footerPage` out and the badge stays as it was.

`headerStyle` and `footerStyle` take CSS declarations as they stand. They are handed to the browser, which parses them, drops what it does not recognise, and keeps them inside the element they belong to — so a mistake costs that one line and never the stylesheet.

Both lines are part of the slide's column, so they reserve their own space and the overflow check counts them. A slide that no longer fits once it has a footer does not fit, and the editing view says so, which is the honest answer.

`slides.padding` sets the margin inside the slide — a CSS padding shorthand, `48px 56px` by default. It is the space above the header and below the footer as much as around the body, since both sit inside it, so `"28px 56px"` is the way to pull those two lines towards the edges without touching the sides. A value the browser does not accept is ignored rather than applied, so a typo costs the setting and not the layout.

The header and footer are **text**. They cannot hold MyST — a link, a date computed for you, a logo — because of how they are built, and widening that would be a different feature rather than a bigger string.

### Settings for one slide  

A slide can answer for itself, in a block of MyST comments written directly under its marker:

```
---
% fontSize: 44
% verticalAlign: center
% header: ""
% background: "#1d1f21"

# One big idea
```

It goes under either spelling of the marker. When the deck is cut at headings (`cutAtHeading`) there is no marker to write under, so the block goes under the heading instead:

```
## A denser topic

% fontSize: 22
% cellFontSize: 16

...
```

Either way, only the block at the very top of a slide counts, so a `%` comment written further down stays a comment, and a second heading ends the block like any other content.

Writing both — a `---` and then a heading, with `cutAtHeading` on — is one cut and not two. The marker and the heading that follows it belong to the same slide, so the block can go under either. The keys are `fontSize`, `cellFontSize`, `padding`, `background`, `verticalAlign`, `header`, `footer` and `footerPage`, each overriding the deck's own for that slide alone. An empty value is an answer and not an omission: `header: ""` is how a title slide asks for no header.

The two cases this earns its place for are a title slide centred in the middle of a deck aligned to the top, and a dense slide that wants a smaller body than the rest.

`%` rather than something on the marker: `---` has to stay a horizontal rule as far as the renderer is concerned — that is what lets the cut be read from the rendered page, and what keeps slide and fragment markers apart. Text after it would stop being a rule and would need a parsing rule of our own, which means touching the cut itself. MyST also gives `---` brace attributes of its own, which is a second reason to leave it alone. A `%` line is already a MyST comment and already invisible.

What a slide declares is carried by the slide element itself, because everything it can override is a custom property the slide's own rules already read. Nothing is applied afterwards, and the exported deck and the printed page inherit it without a line of code. Values are filtered rather than trusted, so a stray quote or semicolon costs the setting and nothing else.

### Centring  

`slides.verticalAlign: center` puts the content in the middle of the box instead of flush with the top. Centring suits a deck of short slides; a lecture whose slides are uneven usually reads better flush to the top, where the titles line up from one slide to the next instead of drifting up and down. It is per deck too, so it can live in the frontmatter.

### Zoom, which is a different thing  

`Ctrl` (or `Cmd`) and the wheel, over the pane, makes the slides **bigger on screen**. There is a detent at 100%, and the level is remembered across sessions, like the width of a pane.

That is deliberately not the same control as the type size, and the distinction is what makes the view worth trusting. The type size changes *what fits on a slide* and belongs to the document; the zoom changes only *how big the picture of the slide is here* and belongs to whoever is looking at it. Enlarging the text to see better — the obvious shortcut — would make the pane disagree with the projector about what overflows, which is the one thing the view exists to get right.

So: if the slides look too small to read comfortably while editing, zoom. If they look too small *projected*, raise `fontSize` — and expect some slides to start overflowing, which is the view telling you something true.

A slide whose content does not fit its box is marked, with a red border and a band across its foot — in the editing view only. Projecting, exporting and printing drop the warning: it is addressed to the author, before the lecture, and by then there is nothing to be done about it anyway. That is the question the view exists to answer: a slide is a fixed box and a document does not know it is one, so the overflow is found here, before the lecture, rather than on the screen during it.

Everything stays alive in this view: the Pyodide kernel, the cell editors, the outputs. A cell can be edited and run while the deck is being written — and, later, during the lecture itself.

## Presenting  

The round **▶** at the top right of the pane starts the presentation, from the slide currently in view rather than from the beginning — so rehearsing the one slide you are working on costs nothing.

The pane then covers the window and asks the browser for real fullscreen. It asks rather than depends: a browser that refuses the request still gives a clean projection, because covering the window is done by the editor itself. `Escape` leaves.

One slide at a time, centred, as large as the display allows — both dimensions fit, which is why a 4:3 deck on a 16:9 screen gets bars rather than a crop.

### Transitions  

`slides.transition` says how one slide gives way to the next: `none`, `fade`, `slide`, `slideUp`, `zoom`. `slide` and `slideUp` follow the direction of travel, so a slide arrives from the side you are going towards and comes back the way it left.

A duration may follow on the same line, because it is not a separate decision — one does not choose a transition and then, elsewhere, how long it lasts:

```yaml
slides:
  transition: fade 700ms
```

`700ms`, `1.2s` and a bare `700` all work; without one, 450ms, and nothing above three seconds.

There are five and there will not be many more. A transition is there to say *that was a slide, here is another*; past that it becomes a thing the room watches instead of listening to you. Anyone whose system asks for reduced motion gets none of them, whatever the deck declares.

They apply while presenting — the stacked editing view scrolls, so there is nothing to transition — and the exported deck carries them, since it is the same stylesheet and the same navigation.

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

While the slide view is open, the 📦 menu carries one more entry: 

**Export slides (HTML)** writes one standalone file into `_build/exports` and opens it in your browser. It is also how you get a PDF — see below. It opens as a deck: one slide at a time, filling the window, with the same keys as the presentation — and `f` for fullscreen, since there is no editor around it to ask. The slide number is kept in the address, so a link can point at a slide.

Nothing is loaded from anywhere: the stylesheet, the theme and the navigation are all inside the file. The navigation is about seventy lines, which is the point — a deck that needs two hundred kilobytes of library to turn its own pages is a deck that stops working the day the library does.

The **code cells are frozen**: the code as text, the output as it last stood. Neither Pyodide nor CodeMirror is embedded, and that is deliberate — Pyodide is tens of megabytes of wasm plus its packages, which a file sent by email does not carry, and loading it from a CDN would only move the problem to a room with no network. The live cells stay in the editor, which is where the demonstration happens. An export is an export, and says so.

### The PDF  

There is no PDF export command, and that is the design rather than a gap. Exporting the deck opens it in your browser; printing it from there — "Save as PDF" in the dialog — gives edge-to-edge pages at exactly the slide's dimensions, one slide per page, every fragment revealed, in the right orientation and with nothing to adjust. Two clicks, and they are the two you were already making.

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
| `slides.padding` | `"48px 56px"` | The margin inside a slide, as a CSS padding shorthand. It is the space above the header and below the footer as much as around the body, since both sit inside it. |
| `slides.header` | `""` | A line across the top of every slide. Empty means none, and costs no space. |
| `slides.footer` | `""` | The left-hand part of a line across the foot of every slide. |
| `slides.footerPage` | `""` | The right-hand part of the footer, as a template: `{n}` and `{total}` are replaced — `"Slide {n}/{total}"`, or just `"{n}"`. Setting it moves the slide number into the footer and removes the badge in the corner. |
| `slides.headerStyle` | `""` | CSS declarations applied to the header — `"font-size: 18px; color: #888; border-bottom: 1px solid #ddd"`. |
| `slides.footerStyle` | `""` | The same, for the footer. |
| `slides.background` | `""` | The slide's background, as any CSS colour. Empty follows the theme. |
| `slides.marker` | `"both"` | Which spelling cuts a slide: `"both"`, `"plus"` (only `+++`) or `"dash"` (only `---`). Slide cuts only — `----` and `++++` are always fragments. |
| `slides.transition` | `"slide"` | How one slide gives way to the next while presenting: `"none"`, `"fade"`, `"slide"`, `"slideUp"` or `"zoom"`, optionally followed by a duration on the same line — `"fade 700ms"`, `"slideUp 1.2s"`, or a bare number read as milliseconds. 450ms without one, clamped to 3s. An unknown name falls back to `"slide"`. |
| `slides.verticalAlign` | `"top"` | Where the content sits in the box: `"top"` or `"center"`. |
| `slides.cellFontSize` | `18` | Size of a code cell's text on a slide, same nominal pixels as `fontSize`. Separate because a cell's stylesheet is written in rem, which is rooted at the document rather than at the slide, so it cannot follow the prose on its own. |
| `slides.cutAtHeading` | `0` | Also cut at every heading of this level or above. `0` means markers only. |

See [customisation-reference](customisation-reference.md) for where `config.json` lives.
