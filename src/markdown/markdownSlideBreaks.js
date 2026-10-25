import markdownIt from "markdown-it";

/**
 * Tell the two slide markers apart in the rendered HTML.
 *
 * `---` and `----` both render as a bare `<hr>`, and nothing downstream could
 * have known which was written -- except that markdown-it keeps the exact run
 * of characters in `token.markup`. Three lines here save the alternative,
 * which was to match source line numbers against rendered nodes, and which
 * would have broken on everything that shifts them: `{include}`, folded
 * frontmatter, a cell's output.
 *
 * `***` and `___` are left alone, so an author who wants a plain horizontal
 * rule in a deck still has one.
 *
 * The one rule to learn, and it is the same as markdown's own: a blank line
 * before the marker. `----` written directly under a line of text is a level-2
 * setext heading, not a rule -- exactly as `---` directly under text is.
 */
export function markdownSlideBreaks(/** @type {markdownIt} */ md) {
  md.renderer.rules.hr = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const markup = token.markup ?? "";
    // The class is added to the token rather than written out as HTML, so the
    // `data-line-id` the source map put there survives: a break that knows its
    // line is what lets moving the cursor change slide.
    // `slides.marker` may have left the dashes free, in which case a three-dash
    // rule is a rule and nothing more -- it must not be marked as a cut, or
    // the slide stylesheet would hide the very line the author asked for.
    // Four dashes stay a fragment under every setting: a four-dash rule is an
    // odd thing to write on purpose, where a three-dash one is not.
    const dashesCut = (env?.slideMarker ?? "both") !== "plus";
    const cls = /^-{4,}$/.test(markup) ? "fragment-break" : /^-{3}$/.test(markup) && dashesCut ? "slide-break" : null;
    if (cls && !String(token.attrGet("class") ?? "").split(/\s+/).includes(cls)) token.attrJoin("class", cls);
    return self.renderToken(tokens, idx, options);
  };
}

export default markdownSlideBreaks;
