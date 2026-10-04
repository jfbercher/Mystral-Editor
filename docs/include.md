# Including another file

`{include}` inserts another file into the document. The included text is parsed
as MyST, so its headings, labels, figures and tables belong to the document as
if they had been typed in place — which is what makes it usable for a shared
preamble, a chapter split across files, or a set of exercises reused from one
document to the next.

```
:::{include} sections/methods.md
:::
```

The path is relative to the document. The fenced spellings ` ```{include} `
and ` ```{literalinclude} ` are recognised too.

## What the document sees

The included content is not a black box. The scan that collects labels and
assigns numbers walks the document with its inclusions expanded, so everything
inside an included file takes part in the document it lands in:

Its headings appear in the side outline and in `{toc}`, and they are numbered
in the running text along with the host's — an included `## Method` between
sections 1 and 2 of the host becomes 1.1, not a heading out of sequence.

Its figures, tables and equations are numbered in reading order together with
the host's, rather than restarting at one.

Its labels can be referenced from the host, and the host's from it: there is
one namespace of labels for a document and everything it includes.

That last point has a consequence worth planning for. Two definitions of the
same label -- one in the host, one in an included file -- are a conflict, not a
merge. The document reports it, naming the file and line of each definition,
and the host's definition is the one that wins. Prefixing the labels of a file
meant to be reused (`meth-`, `tp3-`) is the usual way to avoid the clash.

## Selecting part of a file

Without options the whole file is included, minus its frontmatter, which is
stripped: an included file may carry its own metadata without that metadata
leaking into the host.

Part of a file is selected with, in order of convenience:

`:lines: 5-20,31` keeps those lines, counted in the original file.

`:start-at: <text>` and `:end-at: <text>` start and stop at the first line
containing that text, inclusive. `:start-after:` and `:end-before:` are their
exclusive counterparts.

`:start-line:` and `:end-line:` do the same by number, `end-line` being
exclusive.

## Including as code

`:literal:` shows the file as a code block instead of parsing it, which is what
to use for a script or a data file quoted in the text:

```
:::{include} analysis.py
:literal:
:lang: python
:filename:
:caption: The estimator, as it is run
:::
```

`:lang:` (aliases `:language:`, `:code:`) sets the language for highlighting,
and implies `:literal:`. `:filename:` shows the file's name above the block,
`:caption:` adds a caption below it, and `:label:` (alias `:name:`) and
`:class:` behave as they do on any block. `{literalinclude}` is a spelling of
the same thing.

Line numbering is not rendered. `:linenos:`, `:lineno-start:`,
`:number-lines:`, `:lineno-match:` and `:emphasize-lines:` are accepted but
ignored, with a warning in the browser console naming the file, rather than
being silently dropped: the fence renderer used here has no notion of line
numbers, and faking them would cost the syntax highlighting.

## Limits

**The included file is read once per session.** It is fetched the first time
the document renders and kept in memory afterwards, so editing the included
file while the document is open does not change what the document shows. This
is deliberate: re-reading a file on every keystroke would put a filesystem
access in the rendering path. Reload the editor to pick up the new version.

**Included content has no place in the editor.** It is not part of the
document's text, so it cannot be edited through the preview and the scroll sync
does not follow into it. In the outline, headings that came from an included
file are shown in italics, dimmed: they cannot be dragged, and a section cannot
be dropped onto them, since moving a section rewrites the document's own text.
Clicking one scrolls the preview to it. A code cell inside an included file
runs like any other, but an edit made to it in the preview is not written back
anywhere.

**Inclusion nests three levels deep,** and a file that includes itself — or a
cycle of files that include each other — is reported as an error rather than
followed.

**One file, one insertion point.** The same file may be included in several
documents, but including it twice in the same document gives its labels two
definitions, which is the conflict described above.
