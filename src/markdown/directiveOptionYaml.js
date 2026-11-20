import { load as yamlLoad } from "js-yaml";

/**
 * Directive options that YAML refuses, and mystmd accepts.
 *
 * `markdown-it-docutils` reads a directive's options by stripping the `:`
 * from each line, joining what is left into a YAML document and loading it.
 * mystmd does nothing of the kind: an option's value is a string, and the
 * directive decides what to make of it. The two therefore disagree about
 * which documents exist -- and they disagree on examples from mystmd's own
 * documentation:
 *
 *     :header: "Treat", "Quantity", "Description"
 *     :caption: A title: with a colon in it
 *
 * Both are ordinary option values to mystmd and neither is valid YAML: the
 * first opens a quoted scalar and then finds more text, the second looks
 * like a mapping inside a mapping. Each raises a parsing error, so the
 * directive does not render at all -- the document exported and would not
 * preview, which is the worst way for the two to differ.
 *
 * This pass quotes such a value before the library sees it, so that YAML
 * reads as a string what the author meant as one. Only values YAML actually
 * *refuses* are touched: a value it accepts keeps the type it would have had,
 * so `:header-rows: 1` is still a number and `:linenos: false` still a
 * boolean.
 *
 * Done on the source rather than by patching the library, and within the
 * line rather than across lines: the character count of a line changes, its
 * number does not, and the source map is built on line numbers.
 */

/** An option line, as the library recognises one: `:key:` or `:key: value`. */
const OPTION = /^(\s*):([A-Za-z_][\w-]*):(\s*)(.*)$/;

/** A directive opening: ```` ```{name} ````, `:::{name}`, `~~~{name}`. */
const DIRECTIVE_OPEN = /^\s*(:{3,}|`{3,}|~{3,})\{[A-Za-z][\w-]*\}/;

/** A plain fence, whose content is code and none of our business. */
const PLAIN_FENCE = /^\s*(`{3,}|~{3,})(?!\{)/;

/** The marker a fence closes with, to find the end of a block we must skip. */
const fenceMarker = (line) => (line.match(/^\s*(`{3,}|~{3,}|:{3,})/) ?? [])[1] ?? null;

/**
 * Does YAML read this line as the option it is meant to be?
 *
 * The test that matters is whether it throws: `caption: A title: with a
 * colon`, `header: "a", "b"` and `caption: - a` all do, and those are the
 * lines this pass exists for.
 *
 * The key is checked as well, and honestly it never fires: every shape tried
 * -- a mapping, a list, a percentage, a quoted word -- either throws or comes
 * back under the key it was written with. It is a guard on an invariant the
 * rest of the function assumes, not the cure for a defect anyone has seen.
 */
function yamlAccepts(key, text) {
  try {
    const out = yamlLoad(text);
    if (out === null || typeof out !== "object" || Array.isArray(out)) return false;
    const keys = Object.keys(out);
    return keys.length === 1 && keys[0] === key;
  } catch {
    return false;
  }
}

/** The same value, as a YAML single-quoted scalar. */
const quoted = (value) => `'${String(value).replace(/'/g, "''")}'`;

/**
 * Rewrite the option lines that YAML would refuse.
 *
 * Only the header of a directive block is considered -- the run of `:key:`
 * lines immediately after its opening -- which is exactly where the library
 * looks for them. Everything else in the document, including whatever a code
 * block happens to contain, is left alone.
 */
export function repairDirectiveOptions(source) {
  const lines = String(source ?? "").split("\n");
  let changed = false;

  /** The line that closes the block opened at `from`, or the end of the text. */
  const closeOf = (from, marker) => {
    const closes = new RegExp(`^\\s*${marker[0] === "`" ? "`" : marker[0] === "~" ? "~" : ":"}{${marker.length},}\\s*$`);
    for (let k = from + 1; k < lines.length; k++) if (closes.test(lines[k])) return k;
    return lines.length;
  };

  for (let i = 0; i < lines.length; i++) {
    const marker = fenceMarker(lines[i]);

    if (PLAIN_FENCE.test(lines[i])) {
      // A code fence: skipped whole, so that a `:key: value` written inside
      // an example stays an example.
      i = closeOf(i, marker);
      continue;
    }
    if (!DIRECTIVE_OPEN.test(lines[i])) continue;

    for (let j = i + 1; j < lines.length; j++) {
      const match = OPTION.exec(lines[j]);
      if (!match) break; // the options end at the first line that is not one
      const [, indent, key, space, value] = match;
      if (!value.trim()) continue; // a bare flag parses as null, which is fine
      if (yamlAccepts(key, `${key}:${space}${value}`)) continue;
      lines[j] = `${indent}:${key}:${space || " "}${quoted(value)}`;
      changed = true;
    }

    // A colon-fenced block is walked through rather than skipped, because
    // those nest: a card inside a grid has options of its own, and they
    // deserve the same repair. Its closing marker is no danger, a run of
    // colons being nobody's code fence.
    //
    // A backtick or tilde block is skipped whole. Its closing fence would
    // otherwise be read as the opening of a code fence and everything after
    // it passed over -- which is exactly what happened, and what left a
    // figure's caption unrepaired two blocks further down.
    if (marker && marker[0] !== ":") i = closeOf(i, marker);
  }

  return changed ? lines.join("\n") : source;
}

/** The markdown-it plugin, run before the block parser sees the source. */
export default function directiveOptionYaml(md) {
  md.core.ruler.before("block", "directive_option_yaml", (state) => {
    state.src = repairDirectiveOptions(state.src);
    return true;
  });
}
