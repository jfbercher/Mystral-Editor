/**
 * What a word is, and when a dictionary accepts one.
 *
 * In a module of its own because both sides need it and neither may import
 * the other: the worker must not pull CodeMirror in, and the editor must not
 * pull a dictionary in. Keeping the two rules here is also what guarantees
 * that the words the editor underlines are the words the worker was asked
 * about -- two copies of this regular expression would drift, and the symptom
 * would be a word marked wrong that the dictionary never saw.
 */

/**
 * A word, for a spell checker, in any language.
 *
 * `\w` is ASCII, so a `\w+` cut "élève" into "l" and "ve" and underlined
 * both. That was invisible while the only dictionary was English and would
 * have made any other language a wall of red.
 *
 * Apostrophes are kept inside the word rather than cutting it, because French
 * needs both readings: "aujourd'hui" is one word in the dictionary, while
 * "l'élève" is an elision in front of another word. Which of the two it is,
 * only the dictionary knows -- so the whole token is offered first and the
 * part after the last apostrophe second.
 */
export const WORD_RE = /\p{L}[\p{L}\p{M}]*(?:['’]\p{L}[\p{L}\p{M}]*)*/gu;

/** A single letter is not a spelling: French elision alone would underline l', d', n', qu'. */
export const TOO_SHORT = 2;

/**
 * True when the dictionary accepts the word, under either reading.
 *
 * `check` is the dictionary's own test, passed in rather than imported, so
 * that this file knows nothing of typo-js and can be used on either side of
 * the worker boundary.
 */
export function accepts(check, word) {
  if (check(word)) return true;
  const cut = word.split(/['’]/).pop();
  return cut !== word && cut.length > 1 && check(cut);
}
