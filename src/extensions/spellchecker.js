import { Decoration, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { Compartment, Facet, RangeSetBuilder } from "@codemirror/state";
import Typo from "typo-js";

// Defines a configurable field in the CodeMirror
const dictionary = Facet.define({
  combine: (vals) => vals[vals.length - 1],
});

/** Holds the dictionary, so the language can change without rebuilding the editor. */
const spellcheckCompartment = new Compartment();

/**
 * Which candidate won used to be said nowhere -- the resolution from a
 * declared `fr` to an installed `fr_FR` is invisible, and a language silently
 * unchecked looks exactly like a language with no mistakes. So
 * `useSpellcheckLanguage` returns the name that loaded, and the caller puts
 * it where it belongs: in that editor's own options, since two tabs holding
 * documents in two languages have two dictionaries, and a module-level signal
 * could only ever hold the last one loaded.
 */

// Class which will be applied to misspelled words
const errorHighlight = Decoration.mark({ class: "cm-error" });

const dictReady = (dict) => dict && Object.keys(dict.rules ?? {}).length > 0;

/**
 * A word, for a spell checker, in any language.
 *
 * `\w` is ASCII, so the previous `\w+` cut "élève" into "l" and "ve" and
 * underlined both. That was invisible while the only dictionary was English
 * and would have made any other language a wall of red -- which is why this
 * had to be fixed before a second dictionary could be worth loading.
 *
 * Apostrophes are kept inside the word rather than cutting it, because French
 * needs both readings: "aujourd'hui" is one word in the dictionary, while
 * "l'élève" is an elision in front of another word. Which of the two it is,
 * only the dictionary knows -- so the whole token is offered first and the
 * part after the last apostrophe second.
 */
const WORD_RE = /\p{L}[\p{L}\p{M}]*(?:['’]\p{L}[\p{L}\p{M}]*)*/gu;

/** True when the dictionary accepts the word, under either reading. */
function accepts(dict, word) {
  if (dict.check(word)) return true;
  const cut = word.split(/['’]/).pop();
  return cut !== word && cut.length > 1 && dict.check(cut);
}

function doSpellcheck(/** @type {EditorView} */ view) {
  let from = view.visibleRanges[0]?.from || 0;
  let to = view.visibleRanges[0]?.to || undefined;

  const builder = new RangeSetBuilder();
  const dict = view.state.facet(dictionary);

  if (!dictReady(dict)) {
    return builder.finish();
  }

  const text = view.state.doc.sliceString(from, to);
  WORD_RE.lastIndex = 0;
  let m;
  while ((m = WORD_RE.exec(text))) {
    const word = m[0];
    // A single letter is not a spelling. French elision alone would otherwise
    // underline a word in three: l', d', n', qu'.
    if (word.length < 2) continue;
    if (!accepts(dict, word)) builder.add(from + m.index, from + m.index + word.length, errorHighlight);
  }

  return builder.finish();
}

const spellcheckExtension = ViewPlugin.fromClass(
  class {
    constructor(/** @type {EditorView} */ view) {
      this.decorations = doSpellcheck(view);
    }

    update(/** @type {ViewUpdate} */ update) {
      if (update.docChanged || update.viewportChanged) this.decorations = doSpellcheck(update.view);
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);

/**
 * Elements whose text is not prose.
 *
 * Code and mathematics are the obvious ones -- a variable name is not a
 * misspelling -- and KaTeX also builds a shadow copy of the formula in
 * `.katex-mathml`, which would be checked twice and underlined in a place
 * the reader cannot see.
 */
// `.cm-error` is in the list so that marking twice marks nothing twice: the
// widgets are rebuilt rather than re-marked today, but a function that
// damages what it has already done is a trap for whoever calls it next.
const NOT_PROSE = "code, pre, kbd, samp, var, tt, math, .katex, .katex-mathml, script, style, textarea, .cm-editor, .cm-error";

/**
 * Underline the misspelled words of a rendered fragment, in place.
 *
 * The editor's own checker decorates ranges of the *document*, so it has
 * nothing to say where the source is replaced by rendered HTML -- which is
 * the whole of Inline mode. There the text the reader sees is a DOM, so it is
 * marked as a DOM: the text nodes are walked, the words that the dictionary
 * refuses are wrapped in a span carrying the same `cm-error` class, and the
 * underline is the one from the source view.
 *
 * Text nodes are collected before any of them is replaced: a tree walker
 * whose tree changes under it stops being a reliable way to see the tree.
 *
 * @param {Element|DocumentFragment} root the rendered fragment, modified in place
 * @param {object} dict a Typo instance, or anything not ready, in which case nothing is done
 * @returns {number} how many words were marked
 */
export function markMisspellings(root, dict) {
  if (!root || !dictReady(dict)) return 0;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      return node.parentElement?.closest(NOT_PROSE) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });

  const texts = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n);

  let marked = 0;
  for (const node of texts) {
    const text = node.nodeValue;
    WORD_RE.lastIndex = 0;
    let m;
    let at = 0;
    let fragment = null;
    while ((m = WORD_RE.exec(text))) {
      const word = m[0];
      if (word.length < 2 || accepts(dict, word)) continue;
      fragment ??= document.createDocumentFragment();
      if (m.index > at) fragment.appendChild(document.createTextNode(text.slice(at, m.index)));
      const span = document.createElement("span");
      span.className = "cm-error";
      span.textContent = word;
      fragment.appendChild(span);
      at = m.index + word.length;
      marked += 1;
    }
    if (!fragment) continue;
    if (at < text.length) fragment.appendChild(document.createTextNode(text.slice(at)));
    node.parentNode?.replaceChild(fragment, node);
  }
  return marked;
}

// ─── Loading a dictionary ────────────────────────────────────────────────────

/**
 * One load per language name, for as long as the application runs.
 *
 * The *promise* is kept, not the dictionary: a dictionary used to be put in
 * here once it was parsed, so a second caller arriving during those two
 * seconds found nothing and parsed it all over again -- which is exactly what
 * two tabs, or one tab asked twice, did. Keeping the promise makes the second
 * caller wait for the first one's work instead of repeating it.
 *
 * A failed attempt is removed, so that a dictionary installed after the fact
 * is tried again rather than remembered as absent.
 */
const loaded = new Map();

/**
 * The region a bare language tag means, when doubling it is not the answer.
 *
 * `fr` finds `fr_FR` by doubling the tag, and most languages are like that.
 * English is not -- there is no `en_EN` -- and neither are the few below, so
 * a document declaring `en` found nothing at all. This is the one usual
 * spelling, not a preference: a document that wants another region says so,
 * `en_GB`, and gets it.
 */
const USUAL_REGION = {
  en: "en_US",
  cs: "cs_CZ",
  da: "da_DK",
  el: "el_GR",
  ja: "ja_JP",
  ko: "ko_KR",
  nb: "nb_NO",
  sv: "sv_SE",
  uk: "uk_UA",
  vi: "vi_VN",
  zh: "zh_CN",
};

/**
 * The names to try for a declared language, best first.
 *
 * `fr` is what one writes in a frontmatter; `fr_FR` is what the dictionary
 * folder is called. Trying both saves everyone from having to know that. The
 * list is tried in order and the first dictionary that loads wins, so a name
 * that does not exist costs one failed read and nothing else.
 */
function candidates(language) {
  const name = String(language ?? "").trim().replace("-", "_");
  if (!name) return [];
  const out = [name];
  if (!name.includes("_")) {
    const bare = name.toLowerCase();
    out.push(`${bare}_${bare.toUpperCase()}`);
    if (USUAL_REGION[bare]) out.push(USUAL_REGION[bare]);
  }
  return [...new Set(out)];
}

/**
 * The regional dictionaries installed for a bare tag, on the desktop build.
 *
 * The table above covers what is usual; this covers what is actually there.
 * A folder can be listed on the desktop and nowhere else, so this is the one
 * place where "there is only one `en_*` installed, take it" can be answered
 * rather than guessed. Several, and the usual region decides; failing that,
 * the first in alphabetical order, which at least is stable.
 */
async function installedDictionaries() {
  if (!("__TAURI_INTERNALS__" in window)) return [];
  try {
    const { appConfigDir, join } = await import("@tauri-apps/api/path");
    const { readDir } = await import("@tauri-apps/plugin-fs");
    const entries = await readDir(await join(await appConfigDir(), "dictionaries"));
    return entries.filter((e) => e.isDirectory).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

async function installedRegions(bare) {
  const found = (await installedDictionaries()).filter((n) => n.toLowerCase().startsWith(`${bare}_`));
  const usual = USUAL_REGION[bare];
  return usual && found.includes(usual) ? [usual, ...found.filter((n) => n !== usual)] : found;
}

/**
 * The dictionaries the user can choose from.
 *
 * Two sources, and neither can stand for the other. The ones installed in the
 * configuration folder are listed by reading it, which only the desktop build
 * can do. The ones shipped with the application are served over HTTP, and an
 * HTTP folder does not list itself -- hence `dictionaries/index.json`, a
 * manifest beside them naming what is there. A missing or unreadable manifest
 * is not an error: it means the application ships none, which is exactly what
 * a user who installed their own would expect to see.
 */
export async function availableDictionaries(dictionaryPath) {
  const base = String(dictionaryPath ?? "/dictionaries").replace(/\/$/, "");
  let bundled = [];
  try {
    const res = await fetch(`${base}/index.json`);
    if (res.ok) {
      const parsed = JSON.parse(await res.text());
      if (Array.isArray(parsed)) bundled = parsed.filter((n) => typeof n === "string");
    }
  } catch {
    /* no manifest: nothing is shipped, or it could not be read */
  }
  return [...new Set([...(await installedDictionaries()), ...bundled])].sort();
}

/** Where a per-document choice is remembered. One key per file. */
const choiceKey = (path) => `myst/dictionary:${path || "untitled"}`;

/**
 * The dictionary chosen by hand for this document, if there is one.
 *
 * Per document and per machine, which is the point: it is a reader's choice
 * about a file they have in front of them, not a property of the work. What
 * belongs to the work is the frontmatter's `language:`, which this overrides
 * and does not replace -- so a document opened elsewhere still says what it
 * is written in.
 */
export function storedDictionary(path) {
  try {
    return localStorage.getItem(choiceKey(path)) || null;
  } catch {
    return null;
  }
}

/** Remember a choice, or forget it when `name` is null. */
export function storeDictionary(path, name) {
  try {
    if (name) localStorage.setItem(choiceKey(path), name);
    else localStorage.removeItem(choiceKey(path));
  } catch (err) {
    console.warn("[spellcheck] the choice of dictionary could not be remembered:", err?.message ?? err);
  }
}

/** The two files of a hunspell dictionary, from wherever they are. */
/**
 * One file of the configuration folder, by the fastest route available.
 *
 * `readTextFile` hands the contents back through Tauri's IPC, which
 * serialises the whole string across the bridge: measured at **1834 ms for a
 * 1.2 MB dictionary**, where a disk read of that file is a few tens of
 * milliseconds. The asset protocol serves the same file to the webview as an
 * ordinary HTTP response, without that crossing.
 *
 * The IPC route is kept as the fallback rather than removed: the asset
 * protocol answers only for paths inside the scope declared in
 * `tauri.conf.json`, and a build whose scope is narrower -- or a future one
 * that tightens it -- should read the file slowly rather than not at all.
 */
async function readFileFast(path, readTextFile) {
  try {
    const { convertFileSrc } = await import("@tauri-apps/api/core");
    const res = await fetch(convertFileSrc(path));
    if (res.ok) return { text: await res.text(), via: "asset" };
    console.debug(`[spellcheck] the asset protocol answered ${res.status} for ${path}; reading through IPC instead`);
  } catch (err) {
    console.debug("[spellcheck] the asset protocol is not available here; reading through IPC:", err?.message ?? err);
  }
  return { text: await readTextFile(path), via: "ipc" };
}

async function readPair(name, dictionaryPath) {
  // The configuration folder first, so a user can add a language the
  // application does not ship -- and replace one it does. The same precedence
  // config.json and custom.css already have over the built-in defaults.
  if ("__TAURI_INTERNALS__" in window) {
    try {
      const { appConfigDir, join } = await import("@tauri-apps/api/path");
      const { exists, readTextFile } = await import("@tauri-apps/plugin-fs");
      const dir = await join(await appConfigDir(), "dictionaries", name);
      const aff = await join(dir, `${name}.aff`);
      const dic = await join(dir, `${name}.dic`);
      if ((await exists(aff)) && (await exists(dic))) {
        // Sequentially, and the small one first: the two go through the same
        // channel, and a 3 kB file tells us whether the fast route works
        // before the megabyte commits to it.
        const affRead = await readFileFast(aff, readTextFile);
        const dicRead = await readFileFast(dic, readTextFile);
        return [affRead.text, dicRead.text, dicRead.via];
      }
    } catch (err) {
      console.warn(`[spellcheck] could not read "${name}" from the configuration folder`, err);
    }
  }

  const base = `${String(dictionaryPath ?? "/dictionaries").replace(/\/$/, "")}/${name}`;
  const [aff, dic] = await Promise.all([fetch(`${base}/${name}.aff`), fetch(`${base}/${name}.dic`)]);
  if (!aff.ok || !dic.ok) throw new Error(`${name}: HTTP ${aff.status}/${dic.status}`);
  return [await aff.text(), await dic.text(), "http"];
}

/**
 * True when what came back is a hunspell dictionary and not something else.
 *
 * Needed because a missing file does not always answer like one. The desktop
 * build serves the application through its own protocol, which hands back the
 * page itself for a path it does not know -- so fetching a dictionary nobody
 * installed returned a cheerful 200 full of HTML. Typo parsed it without
 * complaint, produced a dictionary with no words in it, and the editor
 * underlined nothing: no error to report, no reason to try the next
 * candidate, and a broken dictionary cached under the language's name.
 *
 * A `.dic` begins with its word count, which is the cheapest thing in the
 * world to check and exactly what HTML does not have.
 */
function looksLikeDictionary(aff, dic) {
  if (!aff || !dic) return false;
  if (/^\s*</.test(aff) || /^\s*</.test(dic)) return false;
  return /^\uFEFF?\s*\d+\s*$/m.test(dic.slice(0, 200).split("\n")[0] ?? "");
}

/**
 * The dictionary for a language, loaded once.
 *
 * Built from data read here rather than by letting typo-js fetch for itself:
 * its own loader cannot reach the configuration folder of the desktop build,
 * and doing it here makes the wait explicit instead of leaving an empty
 * dictionary to be noticed later by `dictReady`.
 */
export async function loadDictionary(language, dictionaryPath) {
  const names = candidates(language);
  const bare = names[0]?.includes("_") ? null : names[0]?.toLowerCase();
  // Asked only when the usual names are not already the answer: listing a
  // folder is cheap, but it is a round trip through the desktop bridge, and
  // the common case does not need it.
  if (bare) {
    for (const name of await installedRegions(bare)) if (!names.includes(name)) names.push(name);
  }
  // Printed once per attempt: when a language resolves to nothing, the list
  // that was actually tried is the whole of the diagnosis, and reading it in
  // the console beats guessing from the one failure that got reported.
  console.debug(`[spellcheck] "${language}" -> trying ${names.join(", ")}`);
  for (const name of names) {
    if (loaded.has(name)) {
      try {
        const shared = await loaded.get(name);
        if (shared) return shared;
      } catch {
        /* the attempt that is already running failed; try the next name */
      }
      continue;
    }
    const attempt = (async () => {
      // Timed because the wait is the one thing a user notices about a
      // dictionary, and because the remedy depends on which half costs: a
      // slow read is a file or a protocol, a slow parse is typo-js building a
      // table of a few hundred thousand entries. Measured here rather than
      // guessed from a machine that is not yours.
      const startedRead = performance.now();
      const [aff, dic, via] = await readPair(name, dictionaryPath);
      const readMs = performance.now() - startedRead;
      if (!looksLikeDictionary(aff, dic)) throw new Error("not a hunspell dictionary");
      const startedParse = performance.now();
      const dict = new Typo(name, aff, dic);
      const parseMs = performance.now() - startedParse;
      console.debug(
        `[spellcheck] ${name}: read ${readMs.toFixed(0)} ms via ${via} (${(dic.length / 1e6).toFixed(1)} MB), ` +
          `parsed ${parseMs.toFixed(0)} ms, ${Object.keys(dict.dictionaryTable ?? {}).length} words`,
      );
      // Verified rather than assumed, for the same reason: an empty table is
      // a dictionary that accepts nothing, which looks exactly like one that
      // is still loading.
      if (!Object.keys(dict.dictionaryTable ?? {}).length) throw new Error("empty dictionary");
      return dict;
    })();
    loaded.set(name, attempt);
    try {
      return await attempt;
    } catch (err) {
      loaded.delete(name);
      // A failed candidate is a step, not a fault: `fr` is *expected* to find
      // nothing before `fr_FR` does. Only the last one is worth a warning,
      // and it is the loop's own message below that reports the real failure.
      const last = name === names[names.length - 1];
      const say = last ? console.warn : console.debug;
      say(`[spellcheck] no dictionary for "${name}"`, err?.message ?? err);
    }
  }
  return null;
}

/**
 * Point the editor at a language, or at the first of several that exists.
 *
 * The fallback is not a nicety, it is the whole correctness of this: a
 * document that declares `language: fr` on a machine with no French
 * dictionary would otherwise be left with the empty dictionary the editor
 * mounts with -- never having loaded any other -- and would be checked in no
 * language at all. "Keeps the checking it had" is only true of a document
 * that had some; one that declares another language from the moment it opens
 * never did.
 *
 * So each candidate is tried in turn, the declared language first and the
 * configured default behind it, and the console says which were missing.
 */
export async function useSpellcheckLanguage(view, languages, dictionaryPath) {
  if (!view) return;
  const wanted = (Array.isArray(languages) ? languages : [languages]).map((l) => String(l ?? "").trim()).filter(Boolean);

  for (const language of wanted) {
    const dict = await loadDictionary(language, dictionaryPath);
    if (view.destroyed) return null;
    if (dict) {
      view.dispatch({ effects: spellcheckCompartment.reconfigure(dictionary.of(dict)) });
      return dict.dictionary ?? language;
    }
  }
  console.warn(`[spellcheck] no dictionary found for ${wanted.join(", ") || "(nothing asked for)"}; spelling is not checked`);
  return null;
}

export { dictionary, spellcheckExtension, spellcheckCompartment };

export default function spellcheck(opts) {
  if (!opts) return [];

  const { dict = "en_US", dictionaryPath = "/dictionaries" } = opts;

  // Empty to begin with: the data arrives asynchronously, and `dictReady`
  // already means "underline nothing until it has". The caller asks for a
  // language once it has a view -- see CodeMirror.jsx -- and asks again
  // whenever the document declares another.
  void dict;
  void dictionaryPath;
  return [spellcheckCompartment.of(dictionary.of(new Typo())), spellcheckExtension];
}
