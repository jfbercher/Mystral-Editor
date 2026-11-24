import markdownIt from "markdown-it";

const SRC_LINE_ID = "data-line-id";
/**
 * Derived from the position rather than random, so that re-rendering unchanged content yields
 * byte-identical HTML. Renderers compare rendered output to decide what to touch (see TextManager
 * and the Inline projection), and random ids would make every re-render look like a change.
 */
const lineId = (chunkId, line) => `${chunkId}-${line}`;
const inlineContainers = ["paragraph_open", "heading_open"];
const ignoreTypes = ["inline", "bullet_list_open", "ordered_list_open", "table_open", "td_open", "thead_open", "tbody_open"];

/** @param {markdownIt} md  */
export default function markdownSourceMap(md) {
  md.use(overrideDefaultDirectives);
  md.use(overrideDefaultRole);
  md.use(overrideHTML);
  md.use(wrapTextInSpan);
  md.use(wrapFencedLinesInSpan);

  md.core.ruler.after("linkify", "source_map", (state) => {
    if (state.env.lineMap == undefined || state.env.startLine == undefined || state.env.chunkId == undefined) return;

    function addLineAttr(token) {
      const line = token.map[0] + state.env.startLine - (state.env.chunkId !== 0);
      // Content pulled in by an {include} sits on virtual lines, past the end
      // of the document. It still needs an id -- that is how an unlabelled
      // equation finds its number -- but the id must not enter lineMap, which
      // everything that addresses the editor reads: the scroll sync and the
      // inline preview would ask CodeMirror for a line that does not exist.
      // It goes to a map of its own, which only the number lookups consult.
      const virtual = state.env.hostLineCount && line > state.env.hostLineCount;
      const map = virtual ? state.env.virtualLineMap : state.env.lineMap;
      if (map && !map.has(line)) {
        const id = lineId(state.env.chunkId, line);
        map.set(line, id);
        token.attrSet(SRC_LINE_ID, id);
      }
    }

    for (let idx = 0; idx < state.tokens.length; idx++) {
      // skip non empty list items
      if (state.tokens[idx].type === "list_item_open" && state.tokens[idx + 1].type !== "list_item_close") continue;

      if (inlineContainers.includes(state.tokens[idx].type)) {
        const inlineToken = state.tokens[idx + 1];
        let lineInParagraph = 0;
        for (const childToken of inlineToken.children) {
          if (childToken.type === "softbreak") {
            lineInParagraph++;
            continue;
          }

          // Strong emphasis leaves an empty text token where its delimiter
          // was: `**b**` parses as text(""), strong_open, text("b"),
          // strong_close, text(""). Rendered, that empty token used to carry
          // the line id -- the first child to be given a map wins it -- and
          // came out as an empty span in front of the <strong>. Single
          // emphasis leaves no such token, which is why bold misbehaved
          // where italic did not. Skip them: the id belongs on the text one
          // can see and click.
          if (childToken.type === "text" && childToken.content === "") continue;

          if (!childToken.type.includes("_open")) {
            childToken.map = [state.tokens[idx].map[0] + lineInParagraph, state.tokens[idx].map[0] + lineInParagraph + 1];
          }
        }
      } else if (state.tokens[idx].map && !ignoreTypes.includes(state.tokens[idx].type)) {
        addLineAttr(state.tokens[idx]);
      }

      // `includes(c)` compared a token to a list of type names, so the
      // filter never filtered. Inert as it stands -- none of the ignored
      // types ever appears among an inline token's children, and the output
      // over every document in docs/ is byte-identical either way -- but it
      // would have quietly failed the day one did.
      state.tokens[idx].children?.filter?.((c) => c.map && !ignoreTypes.includes(c.type))?.forEach?.((c) => addLineAttr(c));
    }
  });
}

/** The fallback renderer rule for unhandled and error directives does not output the token attributes into the html **/
function overrideDefaultDirectives(/** @type {markdownIt} */ md) {
  function newRule(defaultRule) {
    return (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      let html = defaultRule(tokens, idx, options, env, self);
      const asideCloseIdx = html.indexOf(">");
      html = html.slice(0, asideCloseIdx) + self.renderAttrs(token) + html.slice(asideCloseIdx);
      return html;
    };
  }

  md.renderer.rules.directive = newRule(md.renderer.rules.directive);
  md.renderer.rules["directive_error"] = newRule(md.renderer.rules["directive_error"]);
}

/** Add token attributes to unhandled roles */
function overrideDefaultRole(/** @type {markdownIt} */ md) {
  const defaultRule = md.renderer.rules.role;
  md.renderer.rules.role = (tokens, idx, options, env, self) => {
    let html = defaultRule(tokens, idx, options, env, self);
    const spanCloseIdx = html.indexOf(">");
    html = html.slice(0, spanCloseIdx) + self.renderAttrs(tokens[idx]) + html.slice(spanCloseIdx);
    return html;
  };
}

/**
 * Only an opening tag can carry an attribute.
 *
 * The line id is inserted before the first `>` of the rendered HTML, which is
 * right for `<div …>` and destructive for everything else. On a comment it fell
 * between the two dashes and the bracket: `<!-- note -->` came out as
 * `<!-- note -- data-line-id="x">`, which no longer closes. The browser then
 * read everything after it as part of the comment, and the rendering vanished
 * from there to the end of the chunk -- that is, to the next heading, since
 * that is where chunks are cut. One comment, half a section gone.
 *
 * The same would hold for a doctype, a processing instruction or a CDATA
 * section, and a closing tag has nowhere to put an attribute either: the id
 * landed on `</div data-line-id="x">`, where it marks nothing at all.
 *
 * Note for the next report: an HTML comment that is never closed still swallows
 * what follows, and that one is not ours -- markdown-it alone, with no rule
 * overridden, does exactly the same, as CommonMark prescribes for an unclosed
 * HTML block. mystmd will do likewise at build time.
 */
const CAN_CARRY_ATTRS = /^\s*<[a-zA-Z]/;

function overrideHTML(/** @type {markdownIt} */ md) {
  const override = (defaultRule) => (tokens, idx, options, env, self) => {
    let html = defaultRule(tokens, idx, options, env, self);
    if (!CAN_CARRY_ATTRS.test(html)) return html;
    const tagCloseIdx = html.indexOf(">");
    if (tagCloseIdx === -1) return html;
    html = html.slice(0, tagCloseIdx) + self.renderAttrs(tokens[idx]) + html.slice(tagCloseIdx);
    return html;
  };

  md.renderer.rules.html_block = override(md.renderer.rules.html_block);
  md.renderer.rules.html_inline = override(md.renderer.rules.html_inline);
}

/** We need some way to add line info to html text, so the idea is to wrap every text token in a span **/
function wrapTextInSpan(/** @type {markdownIt} */ md) {
  const defaultTextRule = md.renderer.rules.text;
  md.renderer.rules.text = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const defaultOutput = defaultTextRule(tokens, idx, options, env, self);
    // An empty text token carries nothing to map and nothing to show. Wrapped
    // all the same, it put an empty span in the document -- which is a node
    // the preview has to lay out, and which changed where a list marker fell.
    if (!defaultOutput && !token.attrs?.length) return defaultOutput;
    let html = `<span${self.renderAttrs(token)}>${defaultOutput}</span>`;
    return html;
  };
}

/** Currently the contents of a fenced code block are treated as a singular string so we need to wrap each line with a `span` to attach line metadata.
    If we ever decide to add syntax highlighting in fenced code blocks, this will need to be changed. **/
function wrapFencedLinesInSpan(/** @type {markdownIt} */ md) {
  const defaultFenceRule = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const defaultOutput = defaultFenceRule(tokens, idx, options, env, self);
    if (env.lineMap == undefined || env.startLine == undefined || env.chunkId == undefined) {
      return defaultOutput;
    }
    const token = tokens[idx];
    // Some markdown-it extensions use the `fence` rule for other things than code blocks (eg. mermaid graphs) so we don't want to modify those
    if (defaultOutput.includes("mermaid") || defaultOutput.includes("code-cell-host") || defaultOutput.includes("include-literal")) {
      return defaultOutput;
    }

    const parser = new DOMParser();
    const defaultHTML = parser.parseFromString(defaultOutput, "text/html");
    const codeElem = defaultHTML.querySelector("pre > code");
    const defaultContent = codeElem.innerHTML;
    const startLine = token.map[0] + env.startLine - (env.chunkId !== 0);
    // Same guard as addLineAttr: a fence inside an included file sits on
    // virtual lines, which must not reach the lineMap.
    if (env.hostLineCount && startLine > env.hostLineCount) return defaultOutput;
    codeElem.innerHTML = defaultContent
      .split("\n")
      .filter((_, i, lines) => i !== lines.length - 1)
      .map((l, i) => {
        const id = lineId(env.chunkId, startLine + i + 1);
        env.lineMap.set(startLine + i + 1, id);
        return `<span ${SRC_LINE_ID}="${id}">${l}</span>`;
      })
      .join("\n");

    return defaultHTML.body.innerHTML;
  };
}

export function findNearestElementForLine(lineNumber, lineMap, preview) {
  let id = null;
  let match = null;
  let num = lineNumber;
  for (; num >= 1; num--) {
    id = lineMap.get(num);
    if (id) {
      match = preview.querySelector(`[data-line-id="${id}"]`);
      // Folded elements have no layout, so callers cannot position anything against them.
      if (match?.offsetParent) break;
      match = null;
    }
  }

  return [match, num];
}

export function getLineById(lineMap, id) {
  if (!lineMap) return undefined;
  for (const [line, value] of lineMap.entries()) {
    if (value === id) {
      return line;
    }
  }
}
