/**
 * The dictionaries, and the questions put to them, off the main thread.
 *
 * Why the dictionary lives here and never leaves: typo-js expands every affix
 * when it parses, so a 1.2 MB French dictionary becomes a table of three
 * million forms, and building it takes seconds. Measured before this was
 * written, it is also *cheaper to rebuild than to transfer*: a structured
 * clone of that table costs more than parsing the file again. So nothing is
 * sent back but answers -- the words a dictionary refuses, which is all the
 * editor needs to underline them.
 *
 * The files are read on the main thread, where the asset protocol is, and
 * handed over as two strings: a megabyte of text crosses a `postMessage`
 * cheaply, where the parsed table could not.
 */
import Typo from "typo-js";
import { accepts } from "../extensions/spellWords.js";

/** One parsed dictionary per name, for as long as the worker lives. */
const dictionaries = new Map();

self.onmessage = (ev) => {
  const msg = ev.data ?? {};

  if (msg.type === "load") {
    const known = dictionaries.get(msg.name);
    if (known) {
      self.postMessage({ type: "loaded", name: msg.name, words: known.words, already: true });
      return;
    }
    try {
      const started = performance.now();
      const dict = new Typo(msg.name, msg.aff, msg.dic);
      const words = Object.keys(dict.dictionaryTable ?? {}).length;
      // An empty table is a dictionary that accepts nothing, which looks
      // exactly like one that is still loading. Said here rather than
      // discovered as a document with every word underlined.
      if (!words) throw new Error("empty dictionary");
      dictionaries.set(msg.name, { dict, words });
      self.postMessage({ type: "loaded", name: msg.name, words, ms: performance.now() - started });
    } catch (err) {
      self.postMessage({ type: "failed", name: msg.name, message: String(err?.message ?? err) });
    }
    return;
  }

  if (msg.type === "check") {
    const entry = dictionaries.get(msg.name);
    // No dictionary: nothing is refused. Underlining everything while one
    // loads would be worse than underlining nothing.
    const refused = entry ? msg.words.filter((word) => !accepts((w) => entry.dict.check(w), word)) : [];
    // The id travels back untouched: the answer belongs to the words of that
    // question, and the asker files it against exactly those.
    self.postMessage({ type: "verdict", id: msg.id, name: msg.name, refused });
  }
};
