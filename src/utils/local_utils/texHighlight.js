/**
 * The preamble `\hl` needs, added only to a document that uses it.
 *
 * `==highlighted==` is written into the `.tex` as `\hl{...}` by the marks
 * plugin, which can emit raw LaTeX but cannot add a package: a mystmd plugin
 * declares directives, roles and transforms and nothing else. So the command
 * arrives in a document that may not know it, and this pass is what makes it
 * compile.
 *
 * `soul` rather than a `\colorbox`: a highlighted phrase has to be able to
 * break across a line, and a box cannot. `xcolor` comes with it because
 * `\sethlcolor` takes one of its colours.
 *
 * ── The caveat worth knowing ──────────────────────────────────────────────
 *
 * `soul` reads its argument character by character, which is why it can break
 * lines and also why accented letters give it trouble. Under pdfLaTeX the
 * answer is `soulutf8`, which is loaded here when it is available and skipped
 * when it is not -- XeLaTeX and LuaLaTeX neither need it nor want it, and
 * asking for it unconditionally would break exactly the engines that handle
 * accents natively. If a highlight ever comes out mangled, the engine is the
 * thing to look at first.
 */

const PACKAGE_MARK = "\\usepackage{soul}";

const PREAMBLE = `
% Highlighted text, from \`==...==\` in the source.
\\usepackage{xcolor}
\\usepackage{soul}
% pdfLaTeX needs this for accented letters inside \\hl; XeLaTeX and LuaLaTeX
% do not have the package and do not need it.
\\IfFileExists{soulutf8.sty}{\\usepackage{soulutf8}}{}
\\sethlcolor{yellow!35}
`;

/**
 * Give a document that highlights something the package that does it.
 *
 * Shaped like `rewriteGrids` and `rewriteFloats`: the preamble goes in before
 * `\\begin{document}` when this file has one, and is handed back otherwise so
 * that the caller can put it in the file that does -- which is how a
 * multi-file export works.
 *
 * @returns {{text: string, highlights: number, preamble: string, preambleWritten: boolean}}
 */
export function addHighlightPreamble(text) {
  let out = String(text ?? "");
  const highlights = (out.match(/\\hl\{/g) ?? []).length;
  // Nothing to do, and that is the common case: most documents highlight
  // nothing, and a preamble they do not use is a package they may not have.
  if (!highlights || out.includes(PACKAGE_MARK)) {
    return { text: out, highlights, preamble: "", preambleWritten: false };
  }

  const docAt = out.indexOf("\\begin{document}");
  if (docAt === -1) return { text: out, highlights, preamble: PREAMBLE, preambleWritten: false };
  out = out.slice(0, docAt) + PREAMBLE + out.slice(docAt);
  return { text: out, highlights, preamble: PREAMBLE, preambleWritten: true };
}
