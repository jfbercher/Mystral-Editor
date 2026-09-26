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
// The scan expands includes with these very functions: the renderer must
// select the same lines it did, or their line numbers drift apart.
import { selectLines, stripFrontmatter } from "./includeExpansion.js";

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

  /** 1-based line of this directive in the document, across chunks. */
  absoluteLine(data) {
    const env = this.state?.env ?? {};
    return data.map ? data.map[0] + (env.startLine ?? 0) - (env.chunkId ? 1 : 0) : null;
  }

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
      // Parse at the virtual lines the scan allocated to this include, when it
      // allocated any. The scanners walked the expanded document and left the
      // numbers of anything inside this file keyed on those lines; parsing at
      // the same offset is what lets an equation or a table find its own entry
      // rather than the include's. The source map is told to ignore lines past
      // the end of the document, so nothing addresses the editor with them.
      const env = this.state?.env ?? {};
      const entry = env.includeMap?.get(this.absoluteLine(data));
      const offset = entry
        ? entry.virtualStart - (env.startLine ?? 0) + (env.chunkId ? 1 : 0)
        : (data.map?.[0] ?? 0);
      return this.nestedParse(entry?.text ?? text, offset);
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
