/**
 * Parameters of a code cell: a value chosen by a control, applied by re-running.
 *
 * Deliberately not widgets. A cell declares what can be varied and the editor
 * offers a slider for it; applying writes the value **into the cell's own
 * code** and runs the cell again. There is no comms protocol, no widget
 * manager and no `ipywidgets` import -- and, more importantly, no change to
 * what the document is: the cell stays plain Python that anyone can run
 * elsewhere, with the chosen value in plain sight.
 *
 * That last point is the whole reason for writing the value back rather than
 * injecting it into the namespace. A cell reading an `n` that comes from
 * nowhere works here and raises `NameError` under `myst build --execute`, in
 * another editor, or for a reader who copies it. Keeping the document
 * self-contained costs one line rewritten per apply.
 *
 * The declaration is an option of the directive:
 *
 *     :params: n = 1..100 step 1, amp = 0.1..5
 *
 * The *range* is declared there; the *current value* is read from the code, so
 * there is one source of truth and no second place to keep in step.
 */

/** A number, or null -- `Number("")` being 0 is the trap this avoids. */
const num = (s) => {
  const t = String(s ?? "").trim();
  if (!t || !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return null;
  return Number(t);
};

/**
 * How many decimals a literal is written with.
 *
 * Read from the text and not from the parsed number, because `1.0` and `1`
 * are the same number and not the same declaration: the first says the
 * parameter is a float, and the cell may well depend on it being one.
 */
const decimalsOf = (s) => {
  const m = /^[-+]?(?:\d+)?(?:\.(\d*))?(?:[eE]([-+]?\d+))?$/.exec(String(s ?? "").trim());
  if (!m) return 0;
  return Math.max(0, (m[1] ?? "").length - (m[2] ? Number(m[2]) : 0));
};

/**
 * A readable step for a range that declares none.
 *
 * A hundredth of the span is the right order of magnitude and the wrong
 * number: `0.1..5` would step by 0.049, and every value the slider produced
 * would carry three decimals nobody chose. Rounded to 1, 2 or 5 times a power
 * of ten, the same range steps by 0.05 and `1..100` steps by 1.
 */
const niceStep = (span) => {
  const raw = span / 100;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
};

/**
 * Read a `:params:` declaration.
 *
 * `name = min..max` with an optional `step s`, separated by commas. Anything
 * that does not parse is skipped rather than guessed at: a malformed
 * declaration should cost its own control, not the whole cell.
 */
export function parseParams(spec) {
  const out = [];
  for (const piece of String(spec ?? "").split(",")) {
    // A flag. No range to give, so it is matched first and separately rather
    // than squeezed into the interval form.
    //
    // `debug = bool` says only that it is one; `debug = true` says that and
    // what it should start at, which is the more useful of the two -- a flag
    // declared without a value starts false every time, and a cell that wants
    // its option on by default has no way to say so. Compared without regard
    // to case, so `True`, `TRUE` and `FAlsE` all read as what they obviously
    // mean; only what is *written into the code* has to carry Python's
    // capitals.
    const flag = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(bool|boolean|flag|true|false)\s*$/i.exec(piece);
    if (flag) {
      const declared = flag[2].toLowerCase();
      out.push({ name: flag[1], type: "bool", initial: declared === "true" });
      continue;
    }

    // Lazy on both bounds, because `0.1..5` has dots on either side of the
    // separator: anything greedier swallows the `..` itself.
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\S+?)\s*\.\.\s*(\S+?)(?:\s+step\s+(\S+))?\s*$/.exec(piece);
    if (!m) continue;
    const [, name, lo, hi, st] = m;
    const min = num(lo);
    const max = num(hi);
    if (min === null || max === null || !(max > min)) continue;
    const given = num(st);
    const step = given && given > 0 ? given : niceStep(max - min);
    // The precision of the parameter is whatever its declaration shows, and at
    // least what the step requires: `amp = 0.1..5` is a float and stays one.
    const decimals = Math.min(
      10,
      Math.max(decimalsOf(lo), decimalsOf(hi), st ? decimalsOf(st) : 0, decimalsOf(String(step))),
    );
    out.push({ name, type: "number", min, max, step, decimals });
  }
  return out;
}

const NUMBER = "[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?";
const BOOL = "True|False";

/** The line that assigns `name`, as a RegExp with the value as group 2. */
const assignment = (name, pattern = `${NUMBER}|${BOOL}`) =>
  new RegExp(`^([ \\t]*${name}[ \\t]*=[ \\t]*)(${pattern})[ \\t]*$`, "m");

/** The value the code currently gives `name`, or null when it gives none. */
export function readValue(code, name) {
  const m = assignment(name, NUMBER).exec(String(code ?? ""));
  return m ? num(m[2]) : null;
}

/** The flag the code currently gives `name`, or null when it gives none. */
export function readFlag(code, name) {
  const m = assignment(name, BOOL).exec(String(code ?? ""));
  return m ? m[2] === "True" : null;
}

/**
 * A flag as Python writes it.
 *
 * `True` and `False`, with their capitals. Writing `true` would leave a cell
 * that raises `NameError` the first time the box is ticked -- which would
 * read as the feature being broken rather than as a spelling, and is the one
 * mistake worth guarding by hand.
 */
export function formatFlag(on) {
  return on ? "True" : "False";
}

/**
 * The code with `name` assigned `value`.
 *
 * Idempotent on purpose: the assignment is *replaced* when it exists, so
 * applying a hundred values leaves one line and not a hundred. When the cell
 * has no such line it is added at the top, which is where someone writing the
 * cell by hand would have put it.
 */
export function writeValue(code, name, value) {
  const text = String(code ?? "");
  const re = assignment(name);
  if (re.test(text)) return text.replace(re, `$1${value}`);
  return `${name} = ${value}\n${text}`;
}

/** Round to the step, so a slider cannot produce 0.30000000000000004. */
export function quantise({ min, step, decimals = 0 }, value) {
  const raw = min + Math.round((value - min) / step) * step;
  return Number(raw.toFixed(decimals));
}

/**
 * The value as it should be written in the code.
 *
 * `String(2)` is `"2"`, and substituting that for a `2.0` turns a float into
 * an int -- which is a real change in Python, and silently so: an array index
 * works, `//` changes meaning, and a `/` that used to be exact no longer is.
 * A parameter declared with decimals therefore keeps them, even at a round
 * value.
 */
export function formatValue({ decimals = 0 }, value) {
  return decimals > 0 ? Number(value).toFixed(decimals) : String(Number(value));
}
