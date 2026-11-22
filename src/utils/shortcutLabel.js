/**
 * A keyboard shortcut, as a reader of this platform writes it.
 *
 * The configuration keeps CodeMirror's spelling -- "Mod-Shift-d", where Mod is
 * Cmd on macOS and Ctrl elsewhere -- which is exactly right for binding a key
 * and wrong for showing one: nobody looking at a toolbar reads "Mod". On macOS
 * the symbols are what every other application shows, and elsewhere the words,
 * joined by `+` as Windows and Linux write them.
 *
 * An empty or malformed binding gives an empty string: a button whose shortcut
 * has been cleared in config.json shows its name alone rather than a stray
 * pair of brackets.
 */
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");

const MAC_SYMBOLS = { mod: "⌘", cmd: "⌘", meta: "⌘", ctrl: "⌃", alt: "⌥", shift: "⇧" };
const OTHER_WORDS = { mod: "Ctrl", cmd: "Ctrl", meta: "Ctrl", ctrl: "Ctrl", alt: "Alt", shift: "Shift" };

/** Keys with a sign of their own, which every toolbar shows rather than spells. */
const KEY_SIGNS = {
  arrowup: "\u2191",
  arrowdown: "\u2193",
  arrowleft: "\u2190",
  arrowright: "\u2192",
  enter: "\u21b5",
  escape: "Esc",
  space: "Space",
};

/** The name of the key itself: a letter in capitals, a named key as written. */
function keyName(key) {
  if (!key) return "";
  const sign = KEY_SIGNS[key.toLowerCase()];
  if (sign) return sign;
  if (key.length === 1) return key.toUpperCase();
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function shortcutLabel(binding) {
  const text = String(binding ?? "").trim();
  if (!text) return "";
  const parts = text.split("-");
  const key = keyName(parts.pop());
  const table = IS_MAC ? MAC_SYMBOLS : OTHER_WORDS;
  const mods = parts.map((m) => table[m.toLowerCase()]).filter(Boolean);
  if (!key) return "";
  return IS_MAC ? mods.join("") + key : [...mods, key].join("+");
}

/** `name (⌘⇧D)`, or just the name when there is no binding. */
export function withShortcut(name, binding) {
  const label = shortcutLabel(binding);
  return label ? `${name} (${label})` : name;
}
