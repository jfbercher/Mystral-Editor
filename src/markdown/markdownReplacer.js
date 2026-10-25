import MarkdownIt from "markdown-it";
import { Directive, directivePlugin, Role, rolePlugin, rolesDefault } from "markdown-it-docutils";
import { escapeRE } from "markdown-it/lib/common/utils";
import { Cite } from "../markdown/bibliography"
import { EvalRole } from "../markdown/markdownPyodide"

/**
 * @typedef {{
 *  target: string | RegExp,
 *  transform: (input: string) => string | Promise<string>
 * }} Transform
 *
 * A transformation which will be applied to the output of `markdown-it`.
 * `transform` will be applied to all matches of `target`.
 */

/**
 * Transform results, keyed by the matched input.
 *
 * This is also how async transforms deliver their output: they resolve into the cache, which
 * notifies its listeners, and each mode then re-renders and reads the finished HTML back out.
 * Delivery is therefore identical in Preview and Inline, and nothing depends on the markup a
 * transform produced still being in the document by the time its promise settles.
 */
export class TransformCache extends Map {
  #pending = new Map();
  #listeners = new Set();
  /** Bumped on clear() so in-flight promises cannot write or notify after invalidation. */
  #generation = 0;

  /** @param {(input: string) => void} listener - run with each settled input. @returns {() => void} unsubscribe */
  onChange(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  clear() {
    this.#generation++;
    this.#pending.clear();
    super.clear();
  }

  /** Store `promise`'s result under `input`; repeated inputs share the one in-flight promise. */
  resolve(input, promise, target) {
    if (this.#pending.has(input)) return;
    const generation = this.#generation;
    this.#pending.set(input, promise);

    promise
      .then((result) => {
        if (generation !== this.#generation) return;
        this.set(input, result);
      })
      .catch((err) => {
        console.error("Error in custom transform:", target, "Caused by input:", input, "Error:", err);
        if (generation !== this.#generation) return;
        // Cache the raw input so a failed transform isn't retried on every render.
        this.set(input, input);
      })
      .finally(() => {
        if (this.#pending.get(input) === promise) this.#pending.delete(input);
        if (generation !== this.#generation) return;
        this.#listeners.forEach((listener) => listener(input));
      });
  }
}

/**
 * Adds caching and async support to a transformation.
 *
 * @param {TransformCache} cache
 * @returns {(t: Transform) => Transform}
 */
const overloadTransform =
  (cache) =>
  ({ transform: originalTransform, target, ...rest }) => ({
    target,
    transform: (input, ...params) => {
      // `has`, not truthiness: a transform that legitimately resolves to "" would otherwise be
      // retried on every render, and since resolving now triggers a render, that would not settle.
      if (cache.has(input)) return cache.get(input);

      const result = originalTransform(input, ...params);
      if (typeof result?.then != "function") return result;

      // Async: leave the raw input in place for now. Resolving notifies the cache's listeners,
      // and the re-render that follows picks up the finished HTML from the cache above.
      cache.resolve(input, result, target);
      return input;
    },
    ...rest,
  });

/**
 * @param {string} txt
 * @param {Transform} transform
 */
const applyTransform = (txt, { transform, target }) => txt.replaceAll(target, transform);

/**
 * @param {Transform[]} transforms
 * @returns {function(MarkdownIt): void}
 */
const markdownReplacer = (transforms, cache) => (markdownIt) => {
  const mappedTransforms = transforms.map((t) => ({
    ...overloadTransform(cache)(t),
    /** A regular expression for a transform that only matches at the beggining of a string, useful for parsing */
    beginTarget: new RegExp(`^(?:${t.target instanceof RegExp ? t.target.source : escapeRE(t.target)})`, t.target.flags ?? "g"),
  }));

  const defaultTextRule = markdownIt.renderer.rules.text;
  markdownIt.renderer.rules.text = (...args) => mappedTransforms.reduce(applyTransform, defaultTextRule(...args));

  // This ruler entry ensures that no preexisting inline Markdown rules will be applied to any text that matches a transform.
  // The `text` rule above will handle it instead.
  markdownIt.inline.ruler.before("text", "transforms", (state, silent) => {
    const src = state.src.slice(state.pos, state.posMax);
    for (const transform of mappedTransforms) {
      /** Check if the current source fragment starts with a transform */
      const match = transform.beginTarget.exec(src);
      if (!match) continue;
      state.pos += match[0].length;
      if (silent) return true;

      const token = state.push("text", "", 0);
      token.content = src.slice(0, match[0].length);
      return true;
    }
    return false;
  });
};

/***************************** CUSTOM ROLES *****************************/

/**
 * @typedef {{
 *  target: string,
 *  transform: (input: string) => string | Promise<string>
 * }} RoleTransform
 *
 * A transformation which will be applied to the content of a MyST role specified as `target`
 */

/**
 * Three inline roles markdown-it-docutils does not ship: small caps, underline
 * and struck-out text. Written in the shape its own `sub` and `sup` use -- an
 * opening token, a text token, a closing one -- so the default renderer prints
 * them and nothing has to be escaped by hand.
 *
 * The content is not parsed as Markdown, exactly as `sub` and `sup` do not parse
 * theirs: `{u}` is for a run of text, not for a nested construction.
 */
const wrappingRoleOld = (tag, className) =>
  class extends Role {
    run({ content }) {
      const open = new this.state.Token(`${tag}_open`, tag, 1);
      if (className) open.attrSet("class", className);
      const text = new this.state.Token("text", "", 0);
      text.content = content;  //state.md.inline.parse
      const close = new this.state.Token(`${tag}_close`, tag, -1);
      return [open, text, close];
    }
  };

const wrappingRole = (tag, className) =>
  class extends Role {
    run({ content }) {
      const open = new this.state.Token(`${tag}_open`, tag, 1);

      if (className) open.attrSet("class", className);

      const children = [];
      this.state.md.inline.parse(
        content,
        this.state.md,
        {},
        children
      );

      const close = new this.state.Token(`${tag}_close`, tag, -1);

      return [open, ...children, close];
    }
  };


/** Small caps have no element of their own: a class, styled in preview.css. */
const SmallCaps = wrappingRole("span", "smallcaps");
const Underline = wrappingRole("u");
const Deleted = wrappingRole("del");

const CUSTOM_ROLE_RULE = "custom_role";

/**
 * @param {RoleTransform}
 * @returns {{ name: string, role: Role }}
 */
const toDocutilsRole = ({ target, transform }) => {
  const DocutilsRole = class extends Role {
    run({ content }) {
      const token = new this.state.Token(CUSTOM_ROLE_RULE, "span", 1);
      token.content = transform(content);
      return [token];
    }
  };

  return { name: target, role: DocutilsRole };
};

/**
 *  @param { Transform[] } transforms
 *  @returns {function(MarkdownIt): void}
 */
const useCustomRoles = (transforms, cache) => (markdownIt) => {
  let customRoles = transforms
    .map(overloadTransform(cache))
    .map(toDocutilsRole)
    .reduce((roles, { name, role }) => {
      roles[name] = role;
      return roles;
    }, {});
  customRoles = { ...customRoles, ...{ cite: Cite, eval: EvalRole, sc: SmallCaps, u: Underline, del: Deleted } };
  // The proof family's own reference role, under both of mystmd's spellings.
  // It is an alias of {numref} there -- only the kind "ref" substitutes the
  // target's title, every other kind goes through the numbered template -- so
  // the same class answers for all three, and markdownMath resolves them alike.
  customRoles = { ...customRoles, "prf:ref": rolesDefault.numref, "proof:ref": rolesDefault.numref };

  // Usually a markdownIt renderer rule would escape all html code. Here we create a rule
  // which explicitly does nothing so that all html returned by transforms is rendered.
  markdownIt.renderer.rules[CUSTOM_ROLE_RULE] = (tokens, idx, options, env, self) =>
    `<span ${self.renderAttrs(tokens[idx])}>${tokens[idx].content}</span>`;
  markdownIt.use(rolePlugin, { roles: customRoles });
};

const CUSTOM_DIRECTIVE_RULE = "custom_directive";

const toDocutilsDirective = ({ target, transform, required_arguments = 0, optional_arguments = 0, option_spec = {} }) => {
  const DocutilsDirective = class extends Directive {
    has_content = true;
    required_arguments = required_arguments;
    optional_arguments = optional_arguments;
    option_spec = option_spec;
    run(data) {
      const token = this.createToken(CUSTOM_DIRECTIVE_RULE, "div", 1, {
        map: data.map,
        block: true,
      });
      // We should support caching and async directives
      token.content = transform(data.body + JSON.stringify(data.args) + JSON.stringify(data.options), data, this);
      return [token];
    }
  };

  return { name: target, directive: DocutilsDirective };
};

const useCustomDirectives = (transforms, cache) => (markdownIt) => {
  const customDirectives = transforms
    .map(overloadTransform(cache))
    .map(toDocutilsDirective)
    .reduce((directives, { name, directive }) => {
      directives[name] = directive;
      return directives;
    }, {});

  markdownIt.renderer.rules[CUSTOM_DIRECTIVE_RULE] = (tokens, idx, options, env, self) =>
    `<div ${self.renderAttrs(tokens[idx])}>${tokens[idx].content}</div>`;
  markdownIt.use(directivePlugin, { directives: customDirectives });
};

/**
Removes MyST-style % comment lines before MarkdownIt parses the document.

It runs before the block parser so that a comment cannot interfere with the
Markdown syntax of the following lines -- which means it works on raw text,
with no idea of what is code and what is prose. A plain regex over the whole
source therefore also deleted "%" lines inside fenced blocks and directives:
a code-cell containing "%whos" lost that line before Python ever saw it, and
any document quoting a percent-first line in an example lost it too.

So the scan tracks fences (```, ~~~ and :::) and leaves their contents alone.
Lines are blanked rather than removed, to keep line numbers -- the source map
pairs rendered elements with source lines by counting them.

A literal "%" at the start of a line is written "\%", which CommonMark renders
as "%" on its own; it is enough here that such a line is not taken for a
comment.

Known limitation: an indented code block (four spaces, no fence) is not
detected, so a "%" line inside one is still treated as a comment.

Usage: markdownIt.use(mystComments);
*/
export function stripMystComments(src) {
  const lines = src.split("\n");
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const marker = /^[ \t]*(`{3,}|~{3,}|:{3,})(.*)$/.exec(line);
    if (marker) {
      const [, ticks, rest] = marker;
      const char = ticks[0];
      if (!fence) {
        fence = { char, len: ticks.length };
      } else if (char === fence.char && ticks.length >= fence.len && rest.trim() === "") {
        fence = null;   // a closing fence carries no info string
      }
      continue;         // a fence line is never a comment
    }
    if (fence) continue;
    if (/^[ \t]*%/.test(line)) lines[i] = "";
    // A fragment marker, written the MyST way. It is turned into the dash
    // spelling rather than given a path of its own: everything downstream --
    // the class on the rule, the cumulative reveal, the print override --
    // already works on that one, and two spellings of a marker should not
    // mean two mechanisms.
    //
    // Checked before the three-plus case, which would otherwise match it.
    if (/^[ \t]*\+{4,}[ \t]*$/.test(line)) lines[i] = "----";
    // Cell separations from an ipynb conversion, and -- in slide mode -- the
    // marker that opens a slide. Erased rather than rendered: the cut is read
    // from the source, so nothing is needed here, and a visible rule across
    // the top of every slide would have to be hidden again in CSS, which is
    // what the dash spelling costs us.
    else if (/^[ \t]*\+{3}/.test(line)) lines[i] = "";
  }
  return lines.join("\n");
}

const mystComments = markdownIt => {
  markdownIt.core.ruler.before("block", "myst_comments", state => {
    state.src = stripMystComments(state.src);
  });
};

export { markdownReplacer, useCustomRoles, useCustomDirectives,  mystComments  };
