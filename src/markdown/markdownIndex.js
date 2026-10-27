/**
 * An index: terms marked in the text, gathered into a list.
 *
 * Two halves, as MyST has them. The `{index}` role marks a word where it is
 * used and says nothing visible about it; `{show-index}` prints what has been
 * marked. Everything between the two is bookkeeping.
 *
 *     {index}`Fourier transform`
 *     {index}`the transform <Fourier transform>`
 *     {index}`pair: transform; Fourier`
 *
 * What is supported, and what is deliberately not, is listed in
 * docs/directives-and-roles.md. In short: the five prefixes MyST documents,
 * the `display <term>` form, and a single page's index. Not: an index spanning
 * a whole project, and the `{index}` *directive* form, which marks a place
 * rather than a word and has no text to show.
 */

import { Directive } from "markdown-it-docutils";
import { Role } from "markdown-it-docutils";

/** The prefixes MyST documents, and what each does with its parts. */
const PREFIXES = ["single", "pair", "triple", "see", "seealso"];

/** Directives whose body is code rather than prose -- their text is shown, not read. */
const CODE_DIRECTIVE_RE = /^\{(code|code-block|code-cell|literalinclude)\}/;

const norm = (s) => String(s ?? "").trim().replace(/\s+/g, " ");

/** A term as a key: case and spacing should not split one entry into two. */
export const termKey = (s) => norm(s).toLowerCase();

/**
 * One `{index}` role's content, read.
 *
 * Returns the text to show on the page and the entries to file it under --
 * several of them for `pair` and `triple`, which is the whole point of those
 * prefixes.
 */
export function parseIndexEntry(content) {
  const raw = String(content ?? "").trim();
  if (!raw) return null;

  // `display <term>`: what the reader sees, then what it is filed under.
  const angled = /^(.*?)\s*<([^<>]+)>$/.exec(raw);
  let display = angled ? norm(angled[1]) : "";
  const spec = angled ? angled[2].trim() : raw;

  const colon = /^([A-Za-z]+)\s*:\s*(.*)$/.exec(spec);
  const prefix = colon && PREFIXES.includes(colon[1].toLowerCase()) ? colon[1].toLowerCase() : "single";
  const body = colon && PREFIXES.includes(colon[1].toLowerCase()) ? colon[2] : spec;

  const parts = body
    .split(";")
    .map(norm)
    .filter(Boolean);
  if (!parts.length) return null;

  // Without an explicit display, the page shows the terms themselves -- the
  // prefix is a filing instruction and not prose, so it never appears. A
  // `see` shows only its own term: the thing it points at belongs in the
  // index, not in the sentence.
  if (!display) display = prefix === "see" || prefix === "seealso" ? parts[0] : parts.join(", ");

  const entries = [];
  const add = (term, sub = "", see = null) => {
    if (term) entries.push({ term, sub, see });
  };

  if (prefix === "pair" && parts.length >= 2) {
    add(parts[0], parts[1]);
    add(parts[1], parts[0]);
  } else if (prefix === "triple" && parts.length >= 3) {
    // Sphinx files a triple six ways; two are enough to find a term from any
    // of the three, which is what an index is for. The simplification is
    // documented rather than hidden.
    add(parts[0], `${parts[1]} ${parts[2]}`);
    add(parts[1], `${parts[0]} ${parts[2]}`);
    add(parts[2], `${parts[0]} ${parts[1]}`);
  } else if ((prefix === "see" || prefix === "seealso") && parts.length >= 2) {
    add(parts[0], "", { kind: prefix, target: parts.slice(1).join(", ") });
  } else {
    add(parts[0], parts[1] ?? "");
  }

  return entries.length ? { display, entries, prefix } : null;
}

const ROLE_RE = /\{index\}`([^`]+)`/g;

/**
 * Every `{index}` of the document, in order, with an id each.
 *
 * Read from the raw source for the same reason the other scanners are: a
 * `{show-index}` can sit above the terms it lists, and the renderer walks the
 * document in chunks that know nothing of one another.
 */
export function scanIndex(fullText) {
  const lines = String(fullText ?? "").split("\n");
  /** @type {Map<string, {term: string, subs: Map<string, string[]>, refs: string[], see: any[]}>} */
  const entries = new Map();
  /** Occurrence ids by role content, in order: the role takes them in turn. */
  const ids = new Map();
  let count = 0;

  const fences = [];
  const inCode = () => fences.some((f) => f.code);

  for (const line of lines) {
    const fence = /^ {0,3}(`{3,}|~{3,}|:{3,})[ \t]*(.*)$/.exec(line);
    if (fence) {
      const char = fence[1][0];
      const len = fence[1].length;
      const info = fence[2].trim();
      const top = fences[fences.length - 1];
      if (top && char === top.char && len >= top.len && info === "") fences.pop();
      else if (!inCode()) fences.push({ char, len, code: !info.startsWith("{") || CODE_DIRECTIVE_RE.test(info) });
      continue;
    }
    if (inCode()) continue;

    ROLE_RE.lastIndex = 0;
    let m;
    while ((m = ROLE_RE.exec(line))) {
      const parsed = parseIndexEntry(m[1]);
      if (!parsed) continue;
      const id = `index-${++count}`;
      if (!ids.has(m[1])) ids.set(m[1], []);
      ids.get(m[1]).push(id);

      for (const entry of parsed.entries) {
        const key = termKey(entry.term);
        if (!entries.has(key)) entries.set(key, { term: entry.term, subs: new Map(), refs: [], see: [] });
        const record = entries.get(key);
        if (entry.see) {
          if (!record.see.some((s) => s.kind === entry.see.kind && s.target === entry.see.target)) record.see.push(entry.see);
          continue;
        }
        if (entry.sub) {
          const subKey = termKey(entry.sub);
          if (!record.subs.has(subKey)) record.subs.set(subKey, { sub: entry.sub, refs: [] });
          record.subs.get(subKey).refs.push(id);
        } else {
          record.refs.push(id);
        }
      }
    }
  }

  return { entries, ids, count };
}

/** A short signature of the index, for the chunk cache. */
export function indexSignature(index) {
  const parts = [];
  for (const [key, rec] of index.entries) {
    parts.push(`${key}:${rec.refs.join(",")}:${rec.see.map((s) => s.kind + s.target).join("|")}`);
    for (const [subKey, sub] of rec.subs) parts.push(`  ${subKey}:${sub.refs.join(",")}`);
  }
  return parts.join("\n");
}

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const INDEX_MARK_RULE = "index_mark_html";

/**
 * The `{index}` role: a word, and a note that it belongs in the index.
 *
 * It renders the text and an anchor, nothing more -- an index entry is not
 * meant to be seen where it is marked. The anchor is what `{show-index}`
 * links back to.
 *
 * The ids come from the scan rather than from a counter kept here, so a term
 * marked three times is linked three times and always at the same anchors.
 * They are handed out by role *content* rather than by position, because a
 * cached chunk keeps the html it already had, ids included, and never asks
 * for another.
 */
export class IndexRole extends Role {
  run({ content }) {
    const parsed = parseIndexEntry(content);
    const token = new this.state.Token(INDEX_MARK_RULE, "", 0);
    if (!parsed) {
      token.content = "";
      return [token];
    }

    const env = this.state.env ?? {};
    const pool = env.indexIds?.get(String(content)) ?? [];
    if (!env.indexSeen) env.indexSeen = new Map();
    const seen = env.indexSeen.get(String(content)) ?? 0;
    env.indexSeen.set(String(content), seen + 1);
    const id = pool[seen] ?? pool[pool.length - 1] ?? "";

    const title = parsed.entries.map((e) => (e.sub ? `${e.term} — ${e.sub}` : e.term)).join(" · ");
    token.content =
      `<span class="index-entry"${id ? ` id="${id}"` : ""} title="${escapeHtml(`Index: ${title}`)}">` +
      `${escapeHtml(parsed.display)}</span>`;
    return [token];
  }
}

/** A term's occurrences, as links. */
function renderRefs(refs) {
  return refs.map((id, i) => `<a class="index-ref" href="#${id}">${i + 1}</a>`).join(" ");
}

/**
 * `{show-index}`: everything marked, in alphabetical order.
 *
 * The numbers beside a term are its occurrences in document order. There are
 * no page numbers to give -- the page is the whole document here -- so they
 * are counters, not locations.
 */
export function renderIndex(index) {
  if (!index || !index.entries.size) {
    return '<div class="myst-index myst-index-empty">No index entries in this document.</div>';
  }

  const sorted = [...index.entries.values()].sort((a, b) =>
    a.term.localeCompare(b.term, undefined, { sensitivity: "base" }),
  );

  const items = sorted.map((rec) => {
    const parts = [`<li class="index-term"><span class="index-term-name">${escapeHtml(rec.term)}</span>`];
    if (rec.refs.length) parts.push(` <span class="index-refs">${renderRefs(rec.refs)}</span>`);
    for (const see of rec.see) {
      const label = see.kind === "see" ? "see" : "see also";
      parts.push(` <span class="index-see">${label} ${escapeHtml(see.target)}</span>`);
    }
    if (rec.subs.size) {
      const subs = [...rec.subs.values()]
        .sort((a, b) => a.sub.localeCompare(b.sub, undefined, { sensitivity: "base" }))
        .map((x) => `<li class="index-sub">${escapeHtml(x.sub)} <span class="index-refs">${renderRefs(x.refs)}</span></li>`)
        .join("");
      parts.push(`<ul class="index-subs">${subs}</ul>`);
    }
    parts.push("</li>");
    return parts.join("");
  });

  return `<div class="myst-index"><ul class="index-terms">${items.join("")}</ul></div>`;
}

export class ShowIndexDirective extends Directive {
  required_arguments = 0;
  optional_arguments = 0;
  has_content = false;
  option_spec = {};

  run(data) {
    const token = this.createToken("html_block", "", 0, { map: data.map, block: true });
    token.content = renderIndex(this.state?.env?.index) + "\n";
    return [token];
  }
}

/** The renderer rule the role's token needs. */
export function markdownIndexRole(md) {
  md.renderer.rules[INDEX_MARK_RULE] = (tokens, idx) => tokens[idx].content;
}

export const indexDirectives = {
  "show-index": ShowIndexDirective,
};
