import { load as yamlLoad } from "js-yaml";
import { readTextRelative, currentFileDir, isTauri } from "../utils/local_utils/fs.js";

/**
 * YAML files read for the frontmatter, keyed by the path as written -- the
 * project's myst.yml and whatever its `extends` chain names.
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
  /** @param {(key: string) => Promise<string>} [reader] how to read this key. */
  resolve(key, reader = readTextRelative) {
    if (this._map.has(key) || this._pending.has(key)) return;
    this._pending.add(key);
    const epoch = this._epoch;
    reader(key)
      .then((text) => {
        this._pending.delete(key);
        if (this._epoch !== epoch) return;
        const data = yamlLoad(text);
        this.set(key, { data: data && typeof data === "object" ? data : {} });
      })
      .catch((err) => {
        this._pending.delete(key);
        if (this._epoch !== epoch) return;
        console.warn(`[frontmatter] cannot read "${key}" —`, err?.message ?? err);
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

/* ------------------------------------------------------------------ *
 * The project's myst.yml
 *
 * mystmd knows `extends` in a myst.yml and nowhere else: a page's frontmatter
 * cannot extend anything. A document inherits from its project and may then
 * override or complete what it inherited -- which is what is implemented here,
 * so that the editor shows what `myst build` will produce.
 *
 * Where the file is looked for follows the mode: beside the document under
 * Tauri, in the working folder in a local web session, and at the root of the
 * site for a deployed build, where public/myst.yml ends up. The lookup is the
 * one readTextRelative already performs for the first two; the third is a plain
 * fetch, tried when there is no folder to read from.
 * ------------------------------------------------------------------ */

/** Read the project's myst.yml, wherever this mode keeps it. */
async function readMystYml() {
  try {
    return await readTextRelative("myst.yml");
  } catch (err) {
    // No document folder and no working folder: a deployed web build. The file
    // may have been shipped with the site, at its root.
    if (isTauri() || typeof fetch !== "function" || typeof document === "undefined") throw err;
    const res = await fetch(new URL("myst.yml", document.baseURI), { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  }
}

/**
 * Cache key of the project file. It carries the document's folder, since two
 * documents open side by side may belong to two different projects. The leading
 * NUL keeps it apart from the paths an `extends` chain names.
 */
const mystYmlKey = () => `\u0000myst.yml\u0000${currentFileDir.value ?? ""}`;

/**
 * The frontmatter a YAML file hands down to the pages.
 *
 * A project file wraps it in `project:`; a plain frontmatter file -- the kind
 * an `extends` usually names -- carries it at the top level, and the few keys
 * that belong to the project file itself are dropped.
 */
function frontmatterOfYaml(data) {
  if (!isPlainObject(data)) return {};
  if (isPlainObject(data.project)) {
    const { extends: _chained, ...own } = data.project;
    return own;
  }
  const { version: _v, site: _s, exclude: _x, extends: _e, ...own } = data;
  return own;
}

/**
 * The frontmatter a myst.yml hands down to its pages, with its own `extends`
 * chain resolved underneath it.
 *
 * `extends` is read both at the top level, where mystmd documents it, and
 * inside `project:`, where it is also written in practice.
 *
 * The chain is read through the same relative lookup as the project file, so an
 * extended file is expected beside it -- which is where mystmd looks too, the
 * project file being the one that names it.
 */
function resolveMystYml(data, depth = 0, seen = new Set()) {
  const own = frontmatterOfYaml(data);
  const paths = [...extendsPaths(data?.extends), ...extendsPaths(data?.project?.extends)];
  if (!paths.length) return own;

  if (depth >= MAX_EXTENDS_DEPTH) {
    console.warn("[frontmatter] myst.yml extends nested more than", MAX_EXTENDS_DEPTH, "deep; stopping");
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
    inherited = mergeFrontmatter(inherited, resolveMystYml(entry.data, depth + 1, new Set([...seen, path])));
  }
  return mergeFrontmatter(inherited, own);
}

/**
 * The project frontmatter in effect for the document being rendered, or {} when
 * there is no project -- which is the ordinary case for a single file.
 *
 * Synchronous, like everything that renders: a first call starts the read and
 * returns nothing, and the cache asks for another render when the file lands.
 */
export function projectFrontmatter() {
  const key = mystYmlKey();
  const entry = extendsCache.get(key);
  if (!entry) {
    extendsCache.resolve(key, readMystYml);
    return {};
  }
  if (entry.error) return {};
  return resolveMystYml(entry.data);
}

/** Documents whose ignored `extends` has already been reported. */
const _warnedExtends = new Set();

/**
 * `extends` in a document is not a MyST key: mystmd would not honour it, so the
 * editor must not either, or the preview and the build would disagree. Said
 * once per value rather than on every render.
 */
function warnDocumentExtends(value) {
  const seen = JSON.stringify(value);
  if (_warnedExtends.has(seen)) return;
  _warnedExtends.add(seen);
  console.warn(
    "[frontmatter] `extends:` in a document's frontmatter is ignored: mystmd accepts it in myst.yml only. " +
      "Move these settings to the project file beside the document.",
  );
}

/**
 * Parse le bloc frontmatter YAML (---...---) en tête d'un texte.
 *
 * `frontmatter` is the effective one: the project's values with the document's
 * own merged on top, so every caller sees what the build will use without
 * knowing where each value came from. `endLine` stays the end of the block
 * written in this document, which is what folding and the rendered block need.
 *
 * Returns null when the document has no block at all -- the shape the structural
 * callers expect. Use effectiveFrontmatter() to read values, since a document
 * without a block still belongs to its project.
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
    if (!isPlainObject(parsed)) return { frontmatter: parsed, endLine };
    const { extends: ignored, ...own } = parsed;
    if (ignored !== undefined) warnDocumentExtends(ignored);
    return { frontmatter: mergeFrontmatter(projectFrontmatter(), own), endLine };
  } catch (e) {
    console.error("Failed to parse frontmatter YAML:", e);
    return null;
  }
}

/**
 * The document's own frontmatter, without the project's.
 *
 * What `myst build <file>` honours: mystmd reads the page's own block and does
 * not apply the project's `exports` to a single-file build, so the export check
 * has to ask this narrower question.
 */
export function documentFrontmatter(fullText) {
  const lines = fullText.split("\n");
  if (lines[0]?.trim() !== "---") return {};
  const endLine = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (endLine < 1) return {};
  try {
    const parsed = yamlLoad(lines.slice(1, endLine).join("\n"));
    if (!isPlainObject(parsed)) return {};
    const { extends: _ignored, ...own } = parsed;
    return own;
  } catch {
    return {};
  }
}

/**
 * The frontmatter in effect for a document, block or no block.
 *
 * What the renderer and the export check should read: a document with no
 * frontmatter of its own still inherits its project's macros, numbering,
 * bibliography and exports.
 */
export function effectiveFrontmatter(fullText) {
  return extractFrontmatter(fullText)?.frontmatter ?? projectFrontmatter();
}
