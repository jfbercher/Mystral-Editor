# Slides

A deck here is not a different kind of file. It is a document, cut into slides by markers it already knows how to write — which is the whole point: the admonitions, the cross-references, the bibliography, the maths with the document's own macros, the `{include}`s and the outputs of code cells are all still there, because nothing was converted.

:::{note} What exists so far
The **view** is in place: the document cut into slides, each drawn at projector size, with the overflows flagged. The fullscreen presentation and the standalone export are the next two steps, and they will read the same cut — that is the reason the cut lives in a function of its own.
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

A slide whose content does not fit its box is marked, with a red border and a band across its foot. That is the question the view exists to answer: a slide is a fixed box and a document does not know it is one, so the overflow is found here, before the lecture, rather than on the screen during it.

Everything stays alive in this view: the Pyodide kernel, the cell editors, the outputs. A cell can be edited and run while the deck is being written — and, later, during the lecture itself.

## How it works, and why it matters

The cut is made **in the source**, before rendering: in slide mode the preview's render chunks *are* the slides. A slide is therefore one element, and the view is a stylesheet.

The alternative — rendering as usual and regrouping the result afterwards — was rejected for a reason worth stating, because it is the constraint the whole feature is built around. Re-rendering a code cell destroys its editor, its output and its attachment to the kernel; the editor goes to some length elsewhere to avoid exactly that. A regrouping pass would also have to be redone at every keystroke. Cutting upstream costs nothing at runtime and leaves the cells alone.

One function decides where a cut falls, and both halves of the feature call it. If the view and the export ever disagreed on that, what was rehearsed would not be what is projected.

## Settings

| Key | Default | Meaning |
|---|---|---|
| `slides.width` | `1280` | Nominal width of a slide, in pixels. |
| `slides.height` | `720` | Nominal height. `1280×720` is 16:9, `1024×768` is 4:3. |
| `slides.fontSize` | `28` | Size of the text on a slide, in pixels **of the nominal slide** — so it means the same in a half-width panel and on the projector. Everything on a slide is sized in em, so this one value scales headings, lists, maths and code together. Roughly 15 lines of body text fit at 28, 11 at 36. |
| `slides.cutAtHeading` | `0` | Also cut at every heading of this level or above. `0` means markers only. |
| `slides.transition` | `"slide"` | How one slide gives way to the next in the presentation: `"none"`, `"fade"` or `"slide"`. |

See [customisation-reference](customisation-reference.md) for where `config.json` lives.
