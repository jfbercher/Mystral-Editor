// https://github.com/lezer-parser/markdown/blob/main/src/markdown.ts
import { tags } from "@lezer/highlight";
import { Element, Table } from "@lezer/markdown";

const Type = {
  FencedCode: 3,
  CodeMark: 39,
  CodeText: 40,
  CodeInfo: 41,
};

export const colonFencedCodeParser = {
  /** @type {import("@lezer/markdown").BlockParser[]} */
  parseBlock: [
    {
      name: "ColonFenceCode",
      parse(cx, line) {
        let fenceEnd = isFencedCode(line);
        if (fenceEnd < 0) return false;
        let from = cx.lineStart + line.pos,
          ch = line.next,
          len = fenceEnd - line.pos;
        let infoFrom = line.skipSpace(fenceEnd),
          infoTo = skipSpaceBack(line.text, line.text.length, infoFrom);
        let marks = [elt(Type.CodeMark, from, from + len)];
        if (infoFrom < infoTo) marks.push(elt(Type.CodeInfo, cx.lineStart + infoFrom, cx.lineStart + infoTo));

        for (let first = true; cx.nextLine() && line.depth >= cx.stack.length; first = false) {
          let i = line.pos;
          if (line.indent - line.baseIndent < 4) while (i < line.text.length && line.text.charCodeAt(i) == ch) i++;
          if (i - line.pos >= len && line.skipSpace(i) == line.text.length) {
            for (let m of line.markers) marks.push(m);
            marks.push(elt(Type.CodeMark, cx.lineStart + line.pos, cx.lineStart + i));
            cx.nextLine();
            break;
          } else {
            if (!first) addCodeText(marks, cx.lineStart - 1, cx.lineStart);
            for (let m of line.markers) marks.push(m);
            let textStart = cx.lineStart + line.basePos,
              textEnd = cx.lineStart + line.text.length;
            if (textStart < textEnd) addCodeText(marks, textStart, textEnd);
          }
        }
        cx.addNode(cx.buffer.writeElements(marks, -from).finish(Type.FencedCode, cx.prevLineEnd() - from), from);
        return true;
      },
    },
  ],
};

function isFencedCode(line) {
  if (line.next != 58 /* ':' */) return -1;
  let pos = line.pos + 1;
  while (pos < line.text.length && line.text.charCodeAt(pos) == line.next) pos++;
  if (pos < line.pos + 3) return -1;
  if (line.next == 96) for (let i = pos; i < line.text.length; i++) if (line.text.charCodeAt(i) == 96) return -1;
  return pos;
}

function space(ch) {
  return ch == 32 || ch == 9 || ch == 10 || ch == 13;
}

function skipSpaceBack(line, i, to) {
  while (i > to && space(line.charCodeAt(i - 1))) i--;
  return i;
}

function elt(type, from, to, children) {
  return new Element(type, from, to, children);
}

function addCodeText(marks, from, to) {
  let last = marks.length - 1;
  if (last >= 0 && marks[last].to == from && marks[last].type == Type.CodeText) marks[last].to = to;
  else marks.push(elt(Type.CodeText, from, to));
}

export const tableParser = {
  defineNodes: [
    { name: "Table", block: true },
    { name: "TableHeader", style: { "TableHeader/...": tags.monospace } },
    "TableRow",
    { name: "TableCell", style: tags.monospace },
    { name: "TableDelimiter", style: tags.monospace },
  ],
  parseBlock: Table.parseBlock,
};

/** @type {import("@lezer/markdown").MarkdownConfig} */
export const roleParser = {
  defineNodes: [{ name: "Role", style: tags.monospace }],
  parseInline: [
    {
      name: "Roles",
      parse(cx, next, start) {
        if (next != 123 /* '{' */ || (start && cx.char(start - 1) == 123)) return -1;
        let pos = start + 1;
        while (pos < cx.end && cx.char(pos) != 125 /* '}' */) pos++;
        if (pos == cx.end || cx.char(pos + 1) != 96 /* '`' */) return -1;
        pos += 2;
        while (pos < cx.end && cx.char(pos) != 96 /* '`' */) pos++;
        if (cx.char(pos) != 96) return -1;

        return cx.addElement(cx.elt("Role", start, pos + 1));
      },
      before: "InlineCode",
    },
  ],
};

/**
 * Transform markers, matched **in place**.
 *
 * An inline parser is called at every character position, and a paragraph is one
 * inline section: 250 soft-broken lines of numbers are a single section of
 * twelve thousand characters. This hook used to open with
 * `cx.slice(start, cx.end)` -- a copy from here to the end of the section -- so
 * it cost twelve thousand copies of twelve thousand characters, *before* even
 * looking at whether there was a transform to match. And `transforms` defaults
 * to `[]`, so that was usually the whole of the work.
 *
 * V8 hid it: a `slice` there is a SlicedString that copies nothing, which is why
 * the editor was instant in a browser. JavaScriptCore flattens the string to
 * hand it to a regular expression, so the same paste took seconds under Tauri --
 * 144 million characters copied and as many allocations to collect. Measured
 * from the other end: pasting 12 kB cost 1633 ms inside the transaction, in a
 * document holding nothing else.
 *
 * So nothing is copied. A sticky expression is matched against the section's own
 * text at the right offset, which is exactly what anchoring a copy did, and a
 * string target is compared in place. `cx.text` and `cx.offset` are the fields
 * `cx.slice` itself reads.
 *
 * ── What `^` in a target now means, and why it changed ───────────────────
 *
 * It means the start of the inline section, which is what the expression says.
 * Under the old copy it meant "here", at every position, because every position
 * was the start of its own copy -- so `(^|(?<=\s))#\d+`, written to match an
 * issue number *in front of which there is a space*, matched `x#42` as well. Two
 * of the five transforms configured in `src/index.html` are written that way, so
 * this is not a hypothetical: it is why a first attempt at this fix changed
 * nothing at all, an exception having been kept for exactly those targets.
 *
 * Measured on those five real targets: the one and only difference is a `#42`
 * glued to a word character, which is no longer marked. Start of paragraph,
 * after a space, start of a soft-broken line, the `repo/name#12` forms and
 * `|date|` all behave identically. The regular expression now does what it says.
 */
export const customTransformsParser = (transforms) => {
  // `y` rather than `^`: the match is tied to the offset we ask for, which is
  // what anchoring a copy achieved, without the copy.
  const begins = transforms.map(({ target }) =>
    target instanceof RegExp ? new RegExp(`(?:${target.source})`, target.flags.replace(/[gy]/g, "") + "y") : target,
  );

  return {
    defineNodes: [{ name: "Transform", style: tags.macroName }],
    parseInline: [
      {
        name: "Transforms",
        parse(cx, _, start) {
          // Nothing to look for: the common case, and the one that used to cost
          // the most, since the copy was made before the loop that found nothing.
          if (!begins.length) return -1;

          const at = start - cx.offset;
          for (const begin of begins) {
            if (typeof begin === "string") {
              if (cx.text.startsWith(begin, at)) return cx.addElement(cx.elt("Transform", start, start + begin.length));
            } else {
              begin.lastIndex = at;
              const match = begin.exec(cx.text);
              if (match) return cx.addElement(cx.elt("Transform", start, start + match[0].length));
            }
          }
          return -1;
        },
        before: "Link",
      },
    ],
  };
};

/** Adapted from https://github.com/lezer-parser/markdown/blob/8d4523b16bed48ccd0d5c8b50374a105adb255fe/src/extension.ts#L137 */
class TaskParser {
  nextLine() {
    return false;
  }

  finish(cx, leaf) {
    cx.addLeafElement(
      leaf,
      cx.elt("Checkbox", leaf.start, leaf.start + leaf.content.length, [
        cx.elt("CheckboxMarker", leaf.start, leaf.start + 3),
        ...cx.parser.parseInline(leaf.content.slice(3), leaf.start + 3),
      ]),
    );
    return true;
  }
}

/** @returns {import("@lezer/markdown").MarkdownConfig} */
export const checkboxParser = {
  defineNodes: [
    { name: "Checkbox", block: true, style: tags.content },
    { name: "CheckboxMarker", style: tags.meta },
  ],
  parseBlock: [
    {
      name: "Checkbox",
      leaf(cx, leaf) {
        return /^\[[ xX]\][ \t]/.test(leaf.content) ? new TaskParser() : null;
      },
      after: "SetextHeading",
    },
  ],
};
