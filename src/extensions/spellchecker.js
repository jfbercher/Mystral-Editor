import { Decoration, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { Compartment, Facet, RangeSetBuilder } from "@codemirror/state";
import Typo from "typo-js";

// Defines a configurable field in the CodeMirror
const dictionary = Facet.define({
  combine: (vals) => vals[vals.length - 1],
});

/** Holds the dictionary, so the language can change without rebuilding the editor. */
const spellcheckCompartment = new Compartment();

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

// ─── Loading a dictionary ────────────────────────────────────────────────────

/** One Typo per language name, for as long as the application runs. */
const loaded = new Map();

/**
 * The names to try for a declared language.
 *
 * `fr` is what one writes in a frontmatter; `fr_FR` is what the dictionary
 * folder is called. Trying both saves everyone from having to know that.
 */
function candidates(language) {
  const name = String(language ?? "").trim().replace("-", "_");
  if (!name) return [];
  const out = [name];
  if (!name.includes("_")) out.push(`${name.toLowerCase()}_${name.toUpperCase()}`);
  return out;
}

/** The two files of a hunspell dictionary, from wherever they are. */
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
        return [await readTextFile(aff), await readTextFile(dic)];
      }
    } catch (err) {
      console.warn(`[spellcheck] could not read "${name}" from the configuration folder`, err);
    }
  }

  const base = `${String(dictionaryPath ?? "/dictionaries").replace(/\/$/, "")}/${name}`;
  const [aff, dic] = await Promise.all([fetch(`${base}/${name}.aff`), fetch(`${base}/${name}.dic`)]);
  if (!aff.ok || !dic.ok) throw new Error(`${name}: HTTP ${aff.status}/${dic.status}`);
  return [await aff.text(), await dic.text()];
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
  for (const name of candidates(language)) {
    if (loaded.has(name)) return loaded.get(name);
    try {
      const [aff, dic] = await readPair(name, dictionaryPath);
      if (!looksLikeDictionary(aff, dic)) throw new Error("not a hunspell dictionary");
      const dict = new Typo(name, aff, dic);
      // Verified rather than assumed, for the same reason: an empty table is
      // a dictionary that accepts nothing, which looks exactly like one that
      // is still loading.
      if (!Object.keys(dict.dictionaryTable ?? {}).length) throw new Error("empty dictionary");
      loaded.set(name, dict);
      return dict;
    } catch (err) {
      console.warn(`[spellcheck] no dictionary for "${name}"`, err?.message ?? err);
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
    if (view.destroyed) return;
    if (dict) {
      view.dispatch({ effects: spellcheckCompartment.reconfigure(dictionary.of(dict)) });
      return;
    }
  }
  console.warn(`[spellcheck] no dictionary found for ${wanted.join(", ") || "(nothing asked for)"}; spelling is not checked`);
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
