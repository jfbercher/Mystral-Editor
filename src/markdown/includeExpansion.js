/**
 * includeExpansion.js — the text as the scanners must see it.
 *
 * Labels, cross-references and the numbering of figures, tables and equations
 * are computed by walking the document's text. An {include} is a single line
 * there, so everything inside the included file was invisible to them: its
 * labels unresolvable, its figures unnumbered, and its headings absent from the
 * outline.
 *
 * This builds an expanded text in which each include is replaced by the
 * content it pulls in, so the scanners see the document as the reader does,
 * in the right order — which is what the counters need.
 *
 * The delicate part is line numbers. Everything downstream is keyed by line:
 * the scanners' byLine map, the source map that pairs rendered elements with
 * source lines, the scroll sync. Expanding shifts every line after an include,
 * so the expansion carries a map back to the original:
 *
 *   - a line that exists in the document maps to its own line number;
 *   - a line that came from an included file maps to a VIRTUAL line, allocated
 *     past the end of the document.
 *
 * Virtual lines are not lines of this document, and nothing that addresses the
 * editor may use them; they exist so that the scanners and the renderer can
 * agree on a common key for included content. The renderer gets the same
 * allocation through the env, and parses each included block at its virtual
 * offset, so a figure inside a file finds its number where the scan left it.
 */

/** A line opening an include: ":::{include} path" or "```{include} path". */
const INCLUDE_OPEN = /^[ \t]*(:{3,}|`{3,}|~{3,})\{(include|literalinclude)\}[ \t]*(.*)$/;

/**
 * Locate the include blocks of a text, in document order.
 * Nested fences are tracked so that an include written inside a code block is
 * left alone -- it is an example, not a directive.
 *
 * @returns {{line: number, endLine: number, path: string, literal: boolean, options: string[]}[]}
 *          lines are 1-based; endLine is the closing marker.
 */
export function findIncludeBlocks(text) {
  const lines = text.split("\n");
  const blocks = [];
  let fence = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const marker = /^[ \t]*(`{3,}|~{3,}|:{3,})(.*)$/.exec(line);
    if (!marker) continue;
    const [, ticks, rest] = marker;
    const char = ticks[0];

    if (fence) {
      if (char === fence.char && ticks.length >= fence.len && rest.trim() === "") {
        if (fence.include) {
          fence.include.endLine = i + 1;
          blocks.push(fence.include);
        }
        fence = null;
      }
      continue;
    }

    const open = INCLUDE_OPEN.exec(line);
    fence = { char, len: ticks.length, include: null };
    if (open) {
      const [, , kind, argument] = open;
      fence.include = {
        line: i + 1,
        endLine: null,
        path: argument.trim(),
        literal: kind === "literalinclude",
        options: [],
      };
    }
  }
  // An unclosed include block still counts: the directive parser is lenient.
  if (fence?.include) {
    fence.include.endLine = lines.length;
    blocks.push(fence.include);
  }
  return blocks;
}

/** Options written inside the block, as ":name: value" lines. */
function readOptions(lines, from, to) {
  const options = new Map();
  for (let i = from; i < to; i++) {
    const m = /^[ \t]*:([\w-]+):[ \t]*(.*)$/.exec(lines[i]);
    if (!m) break;
    options.set(m[1], m[2].trim());
  }
  return options;
}

const VIRTUAL_GAP = 1000;

/**
 * Expand the include blocks of a text.
 *
 * @param {string} hostText
 * @param {(path: string) => (string|null)} getText  cached content, or null
 * @param {{maxDepth?: number}} [opts]
 * @returns {{
 *   text: string,
 *   lineOf: number[],          // expanded line (0-based) → line key (host or virtual)
 *   includes: {path: string, hostLine: number, virtualStart: number, text: string}[],
 *   expanded: boolean,
 * }}
 */
export function expandIncludes(hostText, getText, { maxDepth = 3 } = {}) {
  const hostLines = hostText.split("\n");
  // Virtual lines start well past the document so that a line number can be
  // told apart from a real one by its value alone.
  let nextVirtual = hostLines.length + VIRTUAL_GAP;
  const includes = [];

  const expandInto = (lines, baseKeys, depth, seen) => {
    const outLines = [];
    const outKeys = [];
    const blocks = findIncludeBlocks(lines.join("\n"));
    const byStart = new Map(blocks.map((b) => [b.line, b]));

    for (let i = 0; i < lines.length; i++) {
      const block = byStart.get(i + 1);
      if (!block) {
        outLines.push(lines[i]);
        outKeys.push(baseKeys[i]);
        continue;
      }

      // Keep the directive itself: it is a line of the document, and the
      // renderer still has to see it.
      for (let k = i; k < block.endLine && k < lines.length; k++) {
        outLines.push(lines[k]);
        outKeys.push(baseKeys[k]);
      }
      const consumedTo = Math.min(block.endLine, lines.length);

      const options = readOptions(lines, i + 1, consumedTo - 1);
      const literal = block.literal || options.has("literal") || options.has("lang");
      const content = block.path && !literal && depth < maxDepth && !seen.has(block.path)
        ? getText(block.path)
        : null;

      if (content != null) {
        const innerLines = content.split("\n");
        const virtualStart = nextVirtual;
        nextVirtual += innerLines.length + 1;
        includes.push({ path: block.path, hostLine: block.line, virtualStart, text: content });

        const innerKeys = innerLines.map((_, k) => virtualStart + k);
        const nested = expandInto(innerLines, innerKeys, depth + 1, new Set([...seen, block.path]));
        outLines.push(...nested.lines);
        outKeys.push(...nested.keys);
      }
      i = consumedTo - 1;
    }
    return { lines: outLines, keys: outKeys };
  };

  const baseKeys = hostLines.map((_, i) => i + 1);
  const { lines, keys } = expandInto(hostLines, baseKeys, 0, new Set());

  return {
    text: lines.join("\n"),
    lineOf: keys,
    includes,
    expanded: includes.length > 0,
  };
}

/** True for a line number allocated to included content rather than the document. */
export const isVirtualLine = (line, hostLineCount) => line > hostLineCount;
