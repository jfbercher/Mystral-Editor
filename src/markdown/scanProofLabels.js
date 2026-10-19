import { PROOF_FAMILY } from "../config-defaults.js";

/**
 * Find the labels of the proof family in a MyST source.
 *
 * Pure: a text in, positions and labels out. Two callers need it and neither
 * should drag the other's dependencies along -- the editor marks the labels
 * mystmd will mangle (`proofLabelCase.js`), and the LaTeX post-processing
 * repairs them in the `.tex`, from a plain node script with no CodeMirror in
 * sight.
 *
 * Which of them matter is the caller's business: this returns them all.
 */

/** Any fence; `info` empty means a closing one. */
const FENCE_RE = /^ {0,3}([:~`])\1{2,}[ \t]*(.*)$/;

/** `{proof:theorem}`, `{prf:theorem}` or `{theorem}`, as a fence's info string. */
const PROOF_INFO_RE = new RegExp(String.raw`^\{(?:proof:|prf:)?(?:${Object.keys(PROOF_FAMILY).join("|")})\}`);

/** An option line, and the label options among them. */
const OPTION_RE = /^\s*:[\w-]+:/;
const LABEL_OPTION_RE = /^(\s*:(?:label|name):\s*)(\S+)/;

/**
 * Every `:label:` / `:name:` of the proof family, in reading order.
 *
 * The fences are tracked so that a directive shown inside a code block is not
 * reported: in a document about MyST, that is most of them.
 *
 * @param {Iterable<string>} lines
 * @returns {{from: number, to: number, label: string}[]}
 */
export function findProofLabels(lines) {
  const out = [];
  const stack = [];
  let offset = 0;
  let inOptions = false;

  for (const line of lines) {
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const char = fence[1];
      const indent = line.length - line.trimStart().length;
      const len = /^(.)\1*/.exec(line.slice(indent))[0].length;
      const info = fence[2].trim();
      const top = stack[stack.length - 1];

      if (top && char === top.char && len >= top.len && info === "") {
        stack.pop();
        inOptions = false;
      } else if (!top?.code) {
        if (info !== "") {
          // A directive is `{name}`; anything else opened with a backtick or a
          // tilde is code, whose content is not read.
          const code = char !== ":" && !info.startsWith("{");
          stack.push({ char, len, code });
          inOptions = !code && PROOF_INFO_RE.test(info);
        } else if (char !== ":") {
          stack.push({ char, len, code: true });
        }
      }
      offset += line.length + 1;
      continue;
    }

    if (inOptions && !stack[stack.length - 1]?.code) {
      const label = LABEL_OPTION_RE.exec(line);
      if (label) {
        const [, prefix, value] = label;
        out.push({ from: offset + prefix.length, to: offset + prefix.length + value.length, label: value });
      } else if (!OPTION_RE.test(line)) {
        // The first line that is not an option: the body has started.
        inOptions = false;
      }
    }
    offset += line.length + 1;
  }

  return out;
}
