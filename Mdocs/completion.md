---
title: Suggestions and completion
extends: mdocs_fm.yml
---

Writing MyST means remembering directive names, their options, the labels one gave a figure three pages earlier and the exact key of a bibliography entry...
Mystral Editor keeps all of that at hand: as soon as a construct is recognisable from what has been typed, a popup proposes what can legitimately come next, read from the document itself rather than from a fixed list.

The popup opens on its own while typing. `Ctrl-Space` forces it, `↑` and `↓` move through it, `Enter` accepts and `Escape` closes it. Inside the editor of a code cell the same popup is accepted with `Tab` instead, since `Enter` is
needed to write Python.

## Directives

At the beginning of a line, after a `:::` or ` ``` ` fence, the popup lists the directives the editor knows, grouped by family: admonitions, exercises, media, mathematics, code and document structure.


```
:::{fig      ->   :::{figure} path/to/image.png
                  :name:
                  :alt:
                  :width:

                  <body>
                  :::
```

What is inserted is not just the name but the whole skeleton: the opening line with a placeholder for the argument when the directive takes one, the options most documents write, a placeholder for the body and the closing fence. `Tab` moves from one placeholder to the next. If an auto-closing plugin has already inserted the `}`, it is swallowed rather than left orphaned after the snippet.

One case is deliberately silent: a bare ` ``` ` with nothing typed after it would open the popup on every ordinary code fence, so there it waits for an explicit `Ctrl-Space`.

## Options

On a line beginning with `:` *inside* a directive's header, the popup proposes that directive's options. The enclosing directive is found by walking back up the option lines to the opening fence, so the proposal follows the directive actually being written: `:header-rows:` is offered under `{list-table}` and not under `{figure}`. The three options every directive accepts — `label`, `name` and `class` — are always in the list, marked `commun`; the others carry the name of the directive they belong to.

Options whose values form a closed set go one step further: accepting the name reopens the popup on the value. 
- `:align:` proposes `left`, `center`, `right`;
- `:context:` proposes `page`, `section`, `project`;
- `:enumerated:`, `:open:`, `:icon:`, `:linenos:`, `:literal:` and `:hidden:` propose `true` and `false`;
- `:depth:` proposes 1 to 6.

The list is a convenience, not a validator: an option that is not proposed is not refused either, and a directive is free to accept more than what is offered in our popups.

## Roles

Typing `{` proposes the roles, each with a one-line description of what it does. Accepting inserts the role with its backticks and leaves the cursor between them.

```
{ref      ->   {ref}`|`
```

Only the roles the renderer actually implements are proposed, so that the popup never suggests something that would come out as raw text in the preview.

## Labels and cross-references

For the roles that point at something in the document, that is `{ref}`, `{numref}`, `{eq}`; the popup reopens at once on the argument and lists the labels the document defines. `{eq}` restricts the list to equations; the other two show everything.

The list is the same table that drives the numbering and the hover previews, so it holds sections, figures, tables, equations, exercises, theorems, definitions and the rest, with the numbers they currently have, including those that come from an `{include}`. Each entry shows its family, its number and its caption:

```
{numref}`fig:      fig:results      Figure 3 — Results for the experiment
                   fig:setup        Figure 1 — Experimental setup
```

Matching is fuzzy and covers the title as well as the key, so a figure can be found by what its caption says when its label has been forgotten. Of course, only the key is inserted.

The same list serves the link form `[](#label)`, which is the MyST way of
referencing a target with one's own text:

```
[the results](#fig:results)
```

The argument of `{solution}` and `{solution-start}` is a special case: it must name the exercise the solution belongs to, so there the popup proposes the exercise labels alone.

## Citations

Inside brackets, after an `@`, the popup proposes the entries of the `.bib`
file attached to the document.

```
[@Amb      ->   [@AmbZoz08]
```

An entry is shown as its author and year followed by its title, e.g. `Amblard et al. 2008; Information theory...`, and the side panel gives authors, title, journal and year in full. Here too matching runs over authors and title, so a reference can be found from what one remembers of it. Several keys separated by semicolons complete one after the other: `[@AmbZoz08; @Cov06]`.

The `{cite}` role takes the same list, whether it holds one key or several separated by semicolons.

Note that completion is suppressed inside inline code and code blocks, where an `@` or a `{` means something else.


## Executable content: completions inside a code cell

The editor of a `{code-cell}` has its own completion, provided by [jedi](https://jedi.readthedocs.io/) running inside Pyodide: module and function names, attributes, arguments, each with the type and the description jedi reports.

It is installed at start-up, at the same time as the interpreter. If that installation fails (typically with no network), then completion is simply absent and `Tab` falls back to inserting four spaces, with a message in the browser console saying so.

Completion reads the text of the cell rather than the running interpreter as in IPython. It therefore works before anything has been run, it is the same whichever Python namespace the document uses, and, in exchange, it knows nothing of a variable that exists only because a cell was executed. To look at what is actually defined in the interpreter, use the variable inspector, the **Vars** button  described in [executable-content](executable-content.md).

See also [keyboard_shortcuts_en](keyboard_shortcuts_en.md) for the keys, and [directives-and-roles](directives-and-roles.md) for what each directive and role does.
