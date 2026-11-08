import { Decoration, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { Compartment, Facet, RangeSetBuilder, StateEffect } from "@codemirror/state";
import SpellWorker from "../lsp/spellWorker.js?worker";
import { WORD_RE, TOO_SHORT } from "./spellWords.js";

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

const dictReady = (checker) => Boolean(checker?.ready);

/**
 * Asked for when a verdict arrives, so that what is already drawn is redrawn.
 *
 * The answers come back after the decorations were built, which is the whole
 * point of asking elsewhere; something has to say "ask me again".
 */
export const spellRefresh = StateEffect.define();

/** The views to tell. A view registers when its plugin is created. */
const listeners = new Set();

function refreshAll() {
  for (const view of listeners) {
    if (view.destroyed) listeners.delete(view);
    else view.dispatch({ effects: spellRefresh.of(null) });
  }
}

/**
 * The worker holding the dictionaries, and one checker per dictionary.
 *
 * A checker is what the editor actually consults: a table of verdicts, word
 * by word, filled as the worker answers. Everything the editor does stays
 * synchronous -- a decoration pass and a widget being built cannot wait --
 * and the only asynchronous part is learning the verdict for words never
 * seen before. A document asks about a few thousand distinct words; the
 * dictionary holds three million forms, and stays where it was parsed.
 */
let worker = null;
const checkers = new Map();
/** Words seen but not yet sent, per dictionary name. */
const asking = new Map();
/** Words sent and not yet answered, per request. The verdict applies to these and to no others. */
const inFlight = new Map();
let nextRequest = 1;
let askTimer = null;

function spellWorker() {
  if (worker) return worker;
  worker = new SpellWorker();
  worker.addEventListener("message", (ev) => {
    const msg = ev.data ?? {};
    const checker = checkers.get(msg.name);
    if (!checker) return;
    if (msg.type === "loaded") {
      checker.ready = true;
      checker.words = msg.words;
      checker.version += 1;
      checker.resolve?.(checker);
      refreshAll();
    } else if (msg.type === "failed") {
      checker.failed = msg.message;
      checker.resolve?.(null);
    } else if (msg.type === "verdict") {
      // The words of *that* request, and not whatever has accumulated since.
      // Reading the pending set instead was a real defect: a word added while
      // the question was in flight had never been asked about, yet the answer
      // was applied to it -- it was filed as correct, for good, and nothing
      // ever asked again. The region painted first never lost its mistakes.
      const asked = inFlight.get(msg.id);
      // An answer whose question is unknown files nothing: better to ask
      // again than to file words against the wrong question, which is the
      // defect this id was introduced for.
      if (!asked) return;
      inFlight.delete(msg.id);
      const refused = new Set(msg.refused);
      for (const word of asked) checker.verdicts.set(word, refused.has(word));
      checker.version += 1;
      refreshAll();
    }
  });
  worker.addEventListener("error", (ev) => {
    console.error("[spellcheck] the worker failed:", ev.message || ev);
  });
  return worker;
}

/**
 * Ask about the words whose verdict is not known yet.
 *
 * Batched on a timer rather than sent word by word: a viewport holds
 * hundreds of them, and the answer to all of them costs one message.
 */
function ask(checker, word) {
  let pending = asking.get(checker.name);
  if (!pending) {
    pending = new Set();
    asking.set(checker.name, pending);
  }
  pending.add(word);
  clearTimeout(askTimer);
  askTimer = setTimeout(() => {
    for (const [name, words] of [...asking]) {
      if (!words.size) continue;
      // Taken out of the pending set as it is sent: what comes after this
      // moment belongs to the next question, not to this one's answer.
      asking.delete(name);
      const id = nextRequest++;
      inFlight.set(id, words);
      spellWorker().postMessage({ type: "check", id, name, words: [...words] });
    }
  }, 30);
}

/**
 * Is this word wrong?
 *
 * A word nobody has asked about yet is treated as correct, and asked about:
 * underlining a word while waiting for the verdict would make every new word
 * flash red as it is typed.
 */
export function isWrong(checker, word) {
  if (!dictReady(checker) || word.length < TOO_SHORT) return false;
  const known = checker.verdicts.get(word);
  if (known !== undefined) return known;
  ask(checker, word);
  return false;
}

/**
 * Underline the misspelled words of what is on screen.
 *
 * Every visible range, and not just the first. `visibleRanges` is cut wherever
 * the view replaces or folds a piece of the document -- a folded frontmatter,
 * a `{toc}` drawn as a widget, an inline-preview block -- so the first range
 * can be three characters long while the screen is full of text. Reading only
 * that one left the top of a document permanently unchecked, and, worse,
 * *erased* what a correct pass had just marked: the ranges it did not look at
 * were not left alone, they were rebuilt as empty.
 */
function doSpellcheck(/** @type {EditorView} */ view) {
  const builder = new RangeSetBuilder();
  const checker = view.state.facet(dictionary);

  // Before the dictionary is there, nothing is marked -- and nothing is
  // asked either: a word is only questioned once there is something to
  // question. The redraw comes from `spellRefresh`, when the worker answers.
  if (!dictReady(checker)) return builder.finish();

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    WORD_RE.lastIndex = 0;
    let m;
    while ((m = WORD_RE.exec(text))) {
      const word = m[0];
      if (isWrong(checker, word)) builder.add(from + m.index, from + m.index + word.length, errorHighlight);
    }
  }

  return builder.finish();
}

const spellcheckExtension = ViewPlugin.fromClass(
  class {
    constructor(/** @type {EditorView} */ view) {
      this.view = view;
      // Registered so that a verdict arriving later can ask for a redraw.
      listeners.add(view);
      this.decorations = doSpellcheck(view);
    }

    update(/** @type {ViewUpdate} */ update) {
      const answered = update.transactions.some((tr) => tr.effects.some((e) => e.is(spellRefresh)));
      // And when the dictionary is replaced: choosing another from the status
      // bar reconfigures the compartment, which is neither a document change
      // nor a scroll, so the view kept the previous language's underlines
      // until something else happened to redraw it.
      const swapped = update.startState.facet(dictionary) !== update.state.facet(dictionary);
      if (update.docChanged || update.viewportChanged || answered || swapped) this.decorations = doSpellcheck(update.view);
    }

    destroy() {
      listeners.delete(this.view);
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
 * @param {object} checker the dictionary's checker, or anything not ready, in which case nothing is done
 * @returns {number} how many words were marked
 */
export function markMisspellings(root, checker) {
  if (!root || !dictReady(checker)) return 0;

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
      if (!isWrong(checker, word)) continue;
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
      // Read here, parsed there. The files are read on this side because the
      // asset protocol lives here -- 28 ms for a megabyte, against 1.8 s
      // through the IPC -- and the two strings then cross to the worker,
      // which a megabyte of text does cheaply. What must not cross is the
      // parsed table: measured, a structured clone of it costs more than
      // parsing the file again.
      const startedRead = performance.now();
      const [aff, dic, via] = await readPair(name, dictionaryPath);
      const readMs = performance.now() - startedRead;
      if (!looksLikeDictionary(aff, dic)) throw new Error("not a hunspell dictionary");

      // `version` counts what this checker knows, and is the only way a
      // consumer can tell that it has learned something: the object itself
      // never changes, its table grows. The inline preview reads it to decide
      // whether a widget it already drew is still up to date.
      const checker = { name, ready: false, verdicts: new Map(), words: 0, version: 0 };
      const settled = new Promise((resolve) => {
        checker.resolve = resolve;
      });
      checkers.set(name, checker);
      const startedParse = performance.now();
      spellWorker().postMessage({ type: "load", name, aff, dic });
      const got = await settled;
      if (!got) throw new Error(checker.failed ?? "the worker could not load it");
      console.debug(
        `[spellcheck] ${name}: read ${readMs.toFixed(0)} ms via ${via} (${(dic.length / 1e6).toFixed(1)} MB), ` +
          `parsed ${(performance.now() - startedParse).toFixed(0)} ms in the worker, ${checker.words} words`,
      );
      return checker;
    })();
    loaded.set(name, attempt);
    try {
      return await attempt;
    } catch (err) {
      loaded.delete(name);
      checkers.delete(name);
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
      return dict.name ?? language;
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
  // Nothing until a dictionary is asked for: an editor with no checker simply
  // underlines nothing, which is what it did with an empty Typo.
  return [spellcheckCompartment.of(dictionary.of(null)), spellcheckExtension];
}
