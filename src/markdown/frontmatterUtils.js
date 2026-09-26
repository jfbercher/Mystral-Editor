import { load as yamlLoad } from "js-yaml";
import { readTextRelative } from "../utils/local_utils/fs.js";

/**
 * Frontmatter inherited through `extends`, keyed by the path as written.
 *
 * Reading a file is asynchronous while extractFrontmatter() is called from
 * synchronous rendering code, so this follows the pattern of {include} and the
 * {eval} role: a miss returns what is available now and starts the read, and
 * subscribers re-render once it lands. A failure is cached too -- a missing
 * file must not be re-read on every keystroke.
 */
export const extendsCache = {
  _map: new Map(),
  _pending: new Set(),
  _listeners: new Set(),
  _epoch: 0,
  get(key) { return this._map.get(key); },
  set(key, value) {
    this._map.set(key, value);
    this._listeners.forEach((fn) => fn(key));
  },
  resolve(key) {
    if (this._map.has(key) || this._pending.has(key)) return;
    this._pending.add(key);
    const epoch = this._epoch;
    readTextRelative(key)
      .then((text) => {
        this._pending.delete(key);
        if (this._epoch !== epoch) return;
        const data = yamlLoad(text);
        this.set(key, { data: data && typeof data === "object" ? data : {} });
      })
      .catch((err) => {
        this._pending.delete(key);
        if (this._epoch !== epoch) return;
        console.warn(`[frontmatter] extends: cannot read "${key}" —`, err?.message ?? err);
        this.set(key, { error: String(err?.message ?? err) });
      });
  },
  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  },
  clear() {
    this._epoch++;
    this._map.clear();
    this._pending.clear();
    this._listeners.forEach((fn) => fn(null));
  },
};

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Entries of exports and downloads are deduplicated by id, later winning. */
const DEDUPED_BY_ID = new Set(["exports", "downloads"]);

function concatDeduped(key, inherited, local) {
  const merged = [...inherited, ...local];
  if (!DEDUPED_BY_ID.has(key)) return merged;
  const byId = new Map();
  const out = [];
  for (const item of merged) {
    const id = isPlainObject(item) ? item.id : undefined;
    if (id === undefined) { out.push(item); continue; }
    if (byId.has(id)) out[byId.get(id)] = item;   // the later entry replaces
    else { byId.set(id, out.length); out.push(item); }
  }
  return out;
}

/**
 * Merge an inherited frontmatter with the document's own, mystmd's way:
 * lists are combined rather than replaced, objects are deep-merged, and any
 * other value written locally wins.
 */
export function mergeFrontmatter(inherited, local) {
  const out = { ...inherited };
  for (const [key, value] of Object.entries(local ?? {})) {
    const previous = out[key];
    if (Array.isArray(value) && Array.isArray(previous)) out[key] = concatDeduped(key, previous, value);
    else if (isPlainObject(value) && isPlainObject(previous)) out[key] = mergeFrontmatter(previous, value);
    else out[key] = value;
  }
  return out;
}

/** Paths of an `extends` value, which may be a single string or a list. */
const extendsPaths = (value) =>
  (Array.isArray(value) ? value : [value])
    .filter((p) => typeof p === "string" && p.trim())
    .map((p) => p.trim());

const MAX_EXTENDS_DEPTH = 5;

/**
 * Resolve the `extends` chain of a parsed frontmatter.
 *
 * Files are merged in the order written, then the document's own values on
 * top. An extended file may itself extend another; the depth is bounded, since
 * two files naming each other would otherwise recurse for ever.
 */
function resolveExtends(frontmatter, depth = 0, seen = new Set()) {
  const paths = extendsPaths(frontmatter?.extends);
  if (!paths.length) return frontmatter;

  const { extends: _dropped, ...own } = frontmatter;
  if (depth >= MAX_EXTENDS_DEPTH) {
    console.warn("[frontmatter] extends nested more than", MAX_EXTENDS_DEPTH, "deep; stopping");
    return own;
  }

  let inherited = {};
  for (const path of paths) {
    if (seen.has(path)) {
      console.warn(`[frontmatter] extends: "${path}" is already in the chain; ignoring the cycle`);
      continue;
    }
    if (/^https?:/i.test(path)) {
      console.warn(`[frontmatter] extends: remote URLs are not supported yet, ignoring "${path}"`);
      continue;
    }
    const entry = extendsCache.get(path);
    if (!entry) {
      extendsCache.resolve(path);       // renders again when it arrives
      continue;
    }
    if (entry.error) continue;          // already reported when it was read
    const nested = resolveExtends(entry.data, depth + 1, new Set([...seen, path]));
    inherited = mergeFrontmatter(inherited, nested);
  }
  return mergeFrontmatter(inherited, own);
}

/**
 * Extrait et parse le bloc frontmatter YAML (---...---) en tête d'un texte.
 *
 * The returned frontmatter has its `extends` chain resolved, so every caller
 * sees the effective values without knowing about it. `endLine` stays the end
 * of the block written in this document, which is what folding and the
 * rendered block need.
 *
 * @param {string} fullText
 * @returns {{ frontmatter: any, endLine: number } | null}
 */
export function extractFrontmatter(fullText) {
  const lines = fullText.split("\n");
  if (lines[0]?.trim() !== "---") return null;

  let endLine = null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endLine = i;
      break;
    }
  }
  if (endLine == null) return null;

  const yamlText = lines.slice(1, endLine).join("\n");
  try {
    const parsed = yamlLoad(yamlText);
    const frontmatter = isPlainObject(parsed) ? resolveExtends(parsed) : parsed;
    return { frontmatter, endLine };
  } catch (e) {
    console.error("Failed to parse frontmatter YAML:", e);
    return null;
  }
}
