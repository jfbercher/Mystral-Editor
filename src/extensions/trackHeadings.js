import { syntaxTree } from "@codemirror/language";
import { EditorState, StateField } from "@codemirror/state";
import { FOLD_MARKER } from "../text";

/**
 * The document's headings, kept up to date for the outline and the section
 * labels, without ever making the editor wait.
 *
 * ── What this used to cost ────────────────────────────────────────────────
 *
 * Every change asked `ensureSyntaxTree(state, state.doc.length, 10_000)`, that
 * is: parse the whole document, now, synchronously, and take up to ten seconds
 * over it. Measured on a real document under Tauri -- pasting a thousand
 * characters took **3 seconds**, twelve thousand took **6**, a single character
 * 35 ms. The size of the paste barely mattered because the cost was the
 * document, re-parsed from one end to the other at every keystroke. The same
 * paste in a browser was instant: JavaScriptCore is far slower at this parse
 * than V8, which is why only the Tauri builds suffered. And when the ten
 * seconds ran out, `ensureSyntaxTree` returned `null` and `.iterate` was called
 * on it -- a crash, which is how the cause was finally caught.
 *
 * ── What it costs now ─────────────────────────────────────────────────────
 *
 * Nothing is ever forced. Two paths:
 *
 *  - A change that cannot have created or destroyed a heading -- no `#` line,
 *    no setext underline, no fence marker anywhere near it -- only moves the
 *    ones already known, so their positions are mapped through the change and
 *    that is all. Typing in a paragraph, or pasting a thousand numbers, now
 *    costs a handful of microseconds.
 *
 *  - Otherwise the headings are read again, from the syntax tree when it
 *    happens to be complete, and from the lines themselves when it is not.
 *    The line reader costs 6 ms on an 18,000-line document and answers always,
 *    where the parser answered in seconds or not at all.
 */

/** Regions where a `#` is not a heading, and the markers that open them. */
const FENCE_OPEN = /^[ \t]{0,3}(`{3,}|~{3,}|:{3,})/;
const ATX = /^[ \t]{0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const SETEXT = /^[ \t]{0,3}(=+|-{2,})[ \t]*$/;

/**
 * Could this change have added or removed a heading?
 *
 * Asked of the text *around* the change, in the document as it was and as it
 * is: a heading appears when a `#` line is written and disappears when it is
 * unwritten, so one of the two sides must show one. Fences count too, because
 * opening or closing one flips whether every `#` below it is a heading at all.
 *
 * One line of margin on each side: a setext underline makes a heading of the
 * line above it, so touching either of them matters.
 *
 * Deliberately generous. A false yes costs one line scan; a false no would
 * leave the outline showing a section that is no longer there.
 */
function mayChangeHeadings(tr) {
  let suspect = false;
  const look = (state, from, to) => {
    if (suspect) return;
    const doc = state.doc;
    const first = doc.lineAt(Math.max(0, Math.min(from, doc.length)));
    const last = doc.lineAt(Math.max(0, Math.min(to, doc.length)));
    const start = doc.line(Math.max(1, first.number - 1)).from;
    const end = doc.line(Math.min(doc.lines, last.number + 1)).to;
    for (const line of doc.sliceString(start, end).split("\n")) {
      if (ATX.test(line) || SETEXT.test(line) || FENCE_OPEN.test(line)) {
        suspect = true;
        return;
      }
    }
  };
  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    look(tr.startState, fromA, toA);
    look(tr.state, fromB, toB);
  });
  return suspect;
}

/**
 * The same tree, with every position carried through a change -- or `null` when
 * the change moved none of them.
 *
 * `null` is the point of this function, not a detail. Writing the signal makes
 * the outline re-render, and typing at the end of a document moves no heading at
 * all: there is then nothing to tell anyone. Measured under Tauri on a 174 kB
 * document with a hundred headings, an outline re-render costs about 140 ms, so
 * the cheapest change is the one that does not announce itself.
 */
function mapHeadings(nodes, changes) {
  let moved = false;
  const walk = (list) =>
    list.map((node) => {
      const pos = typeof node.pos === "number" ? changes.mapPos(node.pos, 1) : node.pos;
      if (pos !== node.pos) moved = true;
      return { ...node, pos, children: walk(node.children ?? []) };
    });
  const mapped = walk(nodes);
  return moved ? mapped : null;
}

/**
 * The headings read from the lines, which is always possible.
 *
 * What a parser gives and this does not: a heading inside a blockquote or
 * indented into a list item. Neither appears in a document this editor is for,
 * and neither is worth a parse of the whole file at every keystroke.
 *
 * What it does get right, and had to: the frontmatter is skipped, so a YAML
 * comment is not a title, and fenced regions are skipped, so the `# commentaire`
 * of a Python cell is not one either. Verified on a document built to hold
 * both.
 */
export function scanHeadings(/** @type {EditorState} */ state) {
  const out = [];
  const doc = state.doc;
  let fence = null;
  let n = 1;

  if (doc.lines && doc.line(1).text.trim() === "---") {
    for (n = 2; n <= doc.lines; n++) {
      if (/^(---|\.\.\.)[ \t]*$/.test(doc.line(n).text)) {
        n++;
        break;
      }
    }
  }

  for (; n <= doc.lines; n++) {
    const line = doc.line(n);
    const text = line.text;
    const open = FENCE_OPEN.exec(text);

    if (fence) {
      // Closed by the same character, and by at least as many of them.
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length) fence = null;
      continue;
    }
    if (open) {
      fence = open[1];
      continue;
    }

    const atx = ATX.exec(text);
    if (atx) {
      out.push({ level: atx[1].length, text: (atx[2] ?? "").replace(FOLD_MARKER, ""), pos: line.from });
      continue;
    }
    // A setext underline titles the line above it -- unless that line is blank,
    // or is itself an ATX heading, in which case the dashes are something else
    // (a horizontal rule, or the start of a table).
    if (n > 1 && SETEXT.test(text)) {
      const prev = doc.line(n - 1);
      if (prev.text.trim() && !ATX.test(prev.text) && !FENCE_OPEN.test(prev.text)) {
        out.push({
          level: text.trimStart()[0] === "=" ? 1 : 2,
          text: prev.text.replace(FOLD_MARKER, "").trim(),
          pos: prev.from,
        });
      }
    }
  }
  return out;
}

/**
 * The headings, from the tree when it is ready and from the lines otherwise.
 *
 * `syntaxTree` returns whatever the background parser has reached, and never
 * waits; `tree.length` says how far that is. Taking it when it covers the
 * document keeps a parser's reading -- blockquotes and all -- for the common
 * case of a document that has been sitting there being parsed, and costs
 * nothing when it has not.
 */
function getHeadingsFlat(/** @type {EditorState} */ state) {
  const tree = syntaxTree(state);
  if (!tree || tree.length < state.doc.length) return scanHeadings(state);

  const headingsFlat = [];
  tree.iterate({
    enter(nodeRef) {
      const isATX = nodeRef.name.startsWith("ATXHeading");
      if (!isATX && !nodeRef.name.startsWith("SetextHeading")) return true;

      const level = parseInt(nodeRef.name.replace("ATXHeading", "").replace("SetextHeading", ""));
      const fullText = state.sliceDoc(nodeRef.from, nodeRef.to);
      headingsFlat.push({
        level,
        text: (isATX ? fullText.slice(level + 1) : fullText.split("\n")[0]).replace(FOLD_MARKER, ""),
        pos: nodeRef.from,
      });
      return false;
    },
  });
  return headingsFlat;
}

export const trackHeadings = (headings) =>
  StateField.define({
    create(state) {
      headings.value = nestHeadings(getHeadingsFlat(state));
    },
    update(_, tr) {
      if (!tr.docChanged) return;

      // The cheap path: nothing heading-like was touched, so the headings are
      // the same ones, further along.
      if (!mayChangeHeadings(tr)) {
        const known = headings.peek();
        if (!known?.length) return;
        const moved = mapHeadings(known, tr.changes);
        if (moved) headings.value = moved;
        return;
      }

      headings.value = nestHeadings(getHeadingsFlat(tr.state));
    },
  });

export function nestHeadings(headingsFlat) {
  const headingsNested = [];
  const levelMap = {};
  headingsFlat.forEach((h) => {
    const newItem = { ...h, children: [] };

    // Find the closest relative among the strictly lower levels,
    // not just h.level - 1, to manage "skipped" levels (ex: ## then ####).
    let parent = null;
    for (let lvl = h.level - 1; lvl >= 1; lvl--) {
      if (levelMap[lvl]) {
        parent = levelMap[lvl];
        break;
      }
    }

    if (h.level === 1 || !parent) {
      headingsNested.push(newItem);
    } else {
      parent.children.push(newItem);
    }

    // Cleans deeper levels: new invalid level N title invalids
    // any old "last title" of level > N as a parentage reference.
    Object.keys(levelMap).forEach((lvl) => {
      if (parseInt(lvl) >= h.level) delete levelMap[lvl];
    });
    levelMap[h.level] = newItem;
  });
  return headingsNested;
}
