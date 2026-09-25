/**
 * markdownInclude.js — the {include} directive.
 *
 * Inserts another file into the document: parsed as MyST by default, or shown
 * as a code block with :literal: / :lang:.
 *
 * The awkward part is that reading a file is asynchronous while markdown-it
 * renders synchronously. The same pattern as the {eval} role is used: the
 * directive asks the cache, renders a placeholder on a miss, and the cache
 * notifies when the content arrives, which triggers a re-render that finds it.
 * Nothing blocks, and the second pass is a normal synchronous render.
 */

import { Directive, directiveOptions } from "markdown-it-docutils";
import { readTextRelative } from "../utils/local_utils/fs.js";

// ─── Cache ───────────────────────────────────────────────────────────────────

/**
 * Included file contents, keyed by the path as written.
 * A value is {text} on success or {error} on failure -- a missing file is a
 * result to display, not a reason to keep retrying on every render.
 */
export const includeCache = {
  _map: new Map(),
  _listeners: new Set(),
  _epoch: 0,
  has(key) { return this._map.has(key); },
  get(key) { return this._map.get(key); },
  set(key, value) {
    this._map.set(key, value);
    this._listeners.forEach((fn) => fn(key));
  },
  /** Start reading a file once; further calls while it is in flight are no-ops. */
  resolve(key, promise) {
    if (this._map.has(key) || this._pending?.has(key)) return;
    (this._pending ??= new Set()).add(key);
    const epoch = this._epoch;
    Promise.resolve(promise)
      .then((text) => {
        this._pending.delete(key);
        if (this._epoch !== epoch) return;
        this.set(key, { text });
      })
      .catch((err) => {
        this._pending.delete(key);
        if (this._epoch !== epoch) return;
        this.set(key, { error: String(err?.message ?? err) });
      });
  },
  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  },
  /** Forget everything, so the next render reads the files again. */
  clear() {
    this._epoch++;
    this._map.clear();
    this._pending?.clear();
    this._listeners.forEach((fn) => fn(null));
  },
};

// ─── Content selection ───────────────────────────────────────────────────────

/** Strip a leading YAML frontmatter block from an included file. */
function stripFrontmatter(text) {
  const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(text);
  return m ? text.slice(m[0].length) : text;
}

/** Parse "1,3-5" into a predicate over 1-based line numbers. */
function lineSelector(spec) {
  const ranges = String(spec)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = /^(\d+)\s*-\s*(\d+)$/.exec(part);
      if (m) return [Number(m[1]), Number(m[2])];
      const n = Number(part);
      return Number.isFinite(n) ? [n, n] : null;
    })
    .filter(Boolean);
  return (n) => ranges.some(([a, b]) => n >= a && n <= b);
}

/**
 * Apply the selection options, in the order mystmd documents them.
 * Returns {text, firstLine} -- firstLine being the 1-based line of the first
 * kept line, which :lineno-match: needs.
 */
export function selectLines(text, options) {
  let lines = text.split("\n");
  let offset = 0;   // how many lines were dropped from the top

  if (options.lines) {
    const keep = lineSelector(options.lines);
    const kept = [];
    let first = null;
    lines.forEach((line, i) => {
      if (keep(i + 1)) { kept.push(line); if (first === null) first = i; }
    });
    return { text: kept.join("\n"), firstLine: (first ?? 0) + 1 };
  }

  const cut = (from) => { lines = lines.slice(from); offset += from; };

  if (options["start-at"] != null || options["start-after"] != null) {
    const needle = String(options["start-at"] ?? options["start-after"]);
    const i = lines.findIndex((l) => l.includes(needle));
    if (i >= 0) cut(options["start-at"] != null ? i : i + 1);
  } else if (options["start-line"] != null) {
    const n = Number(options["start-line"]);
    if (Number.isFinite(n)) cut(Math.max(0, n - 1));
  }

  if (options["end-at"] != null || options["end-before"] != null) {
    const needle = String(options["end-at"] ?? options["end-before"]);
    const i = lines.findIndex((l) => l.includes(needle));
    if (i >= 0) lines = lines.slice(0, options["end-at"] != null ? i + 1 : i);
  } else if (options["end-line"] != null) {
    const n = Number(options["end-line"]);
    // end-line is exclusive, and counted in the original file.
    if (Number.isFinite(n)) lines = lines.slice(0, Math.max(0, n - offset - 1));
  }

  return { text: lines.join("\n"), firstLine: offset + 1 };
}

// ─── Directive ───────────────────────────────────────────────────────────────

const escapeHtml = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/**
 * Files currently being expanded, to stop a file that includes itself -- or a
 * cycle across several files -- from recursing until the stack gives out.
 */
const expanding = new Set();

class IncludeDirective extends Directive {
  required_arguments = 1;
  optional_arguments = 0;
  final_argument_whitespace = true;
  has_content = false;

  option_spec = {
    literal:        directiveOptions.flag,
    lang:           directiveOptions.unchanged,
    language:       directiveOptions.unchanged,   // alias of lang
    code:           directiveOptions.unchanged,   // alias of lang
    caption:        directiveOptions.unchanged,
    label:          directiveOptions.unchanged,
    name:           directiveOptions.unchanged,   // alias of label
    class:          directiveOptions.class_option,
    linenos:        directiveOptions.flag,
    "lineno-start": directiveOptions.unchanged,
    "number-lines": directiveOptions.unchanged,
    filename:       directiveOptions.flag,
    lines:          directiveOptions.unchanged,
    "start-line":   directiveOptions.unchanged,
    "start-at":     directiveOptions.unchanged,
    "start-after":  directiveOptions.unchanged,
    "end-line":     directiveOptions.unchanged,
    "end-at":       directiveOptions.unchanged,
    "end-before":   directiveOptions.unchanged,
  };

  run(data) {
    const path = String(data.args[0] ?? "").trim();
    const options = data.options ?? {};
    const note = (cls, message) => {
      const token = this.createToken("html_block", "", 0, { map: data.map, block: true });
      token.content = `<div class="include-${cls}">${escapeHtml(message)}</div>\n`;
      return [token];
    };

    if (!path) return note("error", "include: no file given");

    const entry = includeCache.get(path);
    if (!entry) {
      includeCache.resolve(path, readTextRelative(path));
      return note("pending", `Including ${path}…`);
    }
    if (entry.error) return note("error", `include: cannot read "${path}" — ${entry.error}`);

    const { text, firstLine } = selectLines(stripFrontmatter(entry.text), options);

    const lang = options.lang ?? options.language ?? options.code;
    const literal = options.literal !== undefined || lang != null;

    if (literal) return this.literalTokens(data, path, text, firstLine, lang, options);

    if (expanding.has(path)) {
      return note("error", `include: "${path}" includes itself`);
    }
    expanding.add(path);
    try {
      // Parsed at the directive's own line: the included text has no lines of
      // its own in this document, so the source map points every element of it
      // at the include, which is where clicking in the preview should land.
      return this.nestedParse(text, data.map?.[0] ?? 0);
    } finally {
      expanding.delete(path);
    }
  }

  /** A code block, with the options that only make sense for one. */
  literalTokens(data, path, text, firstLine, lang, options) {
    const token = this.createToken("fence", "code", 0, {
      map: data.map,
      block: true,
      content: text.endsWith("\n") ? text : text + "\n",
      info: lang ?? "",
    });
    token.markup = "```";

    const classes = [].concat(options.class ?? [])
      .flatMap((c) => String(c).split(/\s+/)).filter(Boolean);
    // The span wrapper of the source map keys each line of a fence to a line of
    // this document. The lines of an included file are not in this document, so
    // it must leave this block alone -- hence the marker class it looks for.
    token.attrJoin("class", ["include-literal", ...classes].join(" "));
    const label = options.label ?? options.name;
    if (label) token.attrSet("id", String(label));

    // Line numbering is not rendered: the fence renderer here has no notion of
    // it, and faking it would cost the syntax highlighting. Say so rather than
    // setting attributes nobody reads.
    for (const name of ["linenos", "lineno-start", "number-lines", "lineno-match", "emphasize-lines"]) {
      if (options[name] !== undefined) {
        console.warn(`[include] :${name}: is not implemented; "${path}" is shown without it`);
      }
    }

    const caption = options.caption;
    const filename = options.filename !== undefined ? path : null;
    if (!caption && !filename) return [token];

    const open = this.createToken("html_block", "", 0, { map: data.map, block: true });
    open.content = `<figure class="include-figure">\n`
      + (filename ? `<figcaption class="include-filename">${escapeHtml(filename)}</figcaption>\n` : "");
    const close = this.createToken("html_block", "", 0, { map: data.map, block: true });
    close.content = (caption ? `<figcaption>${escapeHtml(caption)}</figcaption>\n` : "") + `</figure>\n`;
    return [open, token, close];
  }
}

export const includeDirectives = {
  include: IncludeDirective,
  literalinclude: IncludeDirective,
};
