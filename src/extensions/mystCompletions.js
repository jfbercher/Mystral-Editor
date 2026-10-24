import { snippetCompletion, startCompletion } from "@codemirror/autocomplete";
import { PROOF_FAMILY } from "../config-defaults.js";
import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";

/* ------------------------------------------------------------------ *
 * Reference tables
 *
 * These lists come from the MyST spec. Not all of them are implemented
 * yet, so they are commented below.
 * ------------------------------------------------------------------ */

/** Roles. All take content enclosed in backticks. */

const ROLES = [
  { name: "abbr", detail: "Abbreviation — text (definition)" },
  { name: "cite", detail: "Bibliographic citation — {cite}`key` or `key1; key2`" },
  // cite:p and cite:t stay out: markdownReplacer registers `cite` alone, so
  // offering them would propose a role the renderer does not know. They are
  // already in CITE_ROLES, so the day they are registered their argument
  // completion works without further change.
  //{ name: "cite:p", detail: "Parenthetical citation" },
  //{ name: "cite:t", detail: "Textual citation" },
  //{ name: "code", detail: "Inline code" },
  { name: "del", detail: "Struck-out text" },
  //{ name: "doc", detail: "Link to another document" },
  //{ name: "download", detail: "Download link" },
  { name: "eq", detail: "Reference to a numbered equation" },
  { name: "eval", detail: "Evaluate a Python expression inline (Pyodide)" },
  { name: "math", detail: "Inline mathematics" },
  { name: "numref", detail: "Numbered reference" },
  { name: "ref", detail: "Cross-reference" },
  // mystmd's reference role for the proof family; an alias of {numref}. The
  // `prf:ref` spelling works too but is not proposed, as for the directives.
  { name: "proof:ref", detail: "Numbered reference to a proof, theorem, …" },
  //{ name: "si", detail: "SI unit" },
  { name: "sc", detail: "Small caps" },
  { name: "sub", detail: "Subscript" },
  { name: "sup", detail: "Superscript" },
  //{ name: "term", detail: "Glossary term" },
  { name: "u", detail: "Underlined text" },
];

/**
 * Directives. `arg` = placeholder for the first argument on the opening line.
 * `opts` = pre-inserted `:key:` options, one per line.
 */
const DIRECTIVES = [
  // Admonitions

  { name: "note", group: "Admonition" },
  { name: "tip", group: "Admonition" },
  { name: "important", group: "Admonition" },
  { name: "warning", group: "Admonition" },
  { name: "caution", group: "Admonition" },
  { name: "attention", group: "Admonition" },
  { name: "danger", group: "Admonition" },
  { name: "error", group: "Admonition" },
  { name: "hint", group: "Admonition" },
  { name: "seealso", group: "Admonition" },
  { name: "admonition", group: "Admonition", arg: "Title" },
  // Exercices
  { name: "exercise", group: "Exercice", arg: "Titre", opts: ["label", "enumerated"] },
  //{ name: "solution", group: "Exercice", arg: "label-exercice", opts: ["label"] },
  { name: "solution", group: "Exercice", opts: ["label"] },
  { name: "exercise-start", group: "Exercice", opts: ["label"], noBody: true },
  { name: "exercise-end", group: "Exercice", noBody: true },
  { name: "solution-start", group: "Exercice", arg: "label-exercice", opts: ["label"], noBody: true },
  { name: "solution-end", group: "Exercice", noBody: true },

  // Figures, images, and tables

  { name: "figure", group: "Media", arg: "path/to/image.png", opts: ["name", "alt", "width"] },
  { name: "image", group: "Media", arg: "path/to/image.png", opts: ["alt", "width"], noBody: true },
  { name: "table", group: "Media", arg: "Title", opts: ["label"] },
  { name: "list-table", group: "Media", arg: "Title", opts: ["header-rows"] },
  //{ name: "csv-table", group: "Media", arg: "Title", opts: ["header-rows"] },
  //{ name: "iframe", group: "Media", arg: "https://" },
  //{ name: "mermaid", group: "Media" },

  // Mathematics and proofs

  { name: "math", group: "Math", opts: ["label"] },
  // The whole proof family, in the `proof:` spelling only: it is the one mystmd
  // prefers, and the one that survives a LaTeX or PDF export. The bare names
  // and the `prf:` ones are still parsed and numbered (markdownDirectives.js),
  // just not proposed.
  ...Object.keys(PROOF_FAMILY).map((name) => ({
    name: `proof:${name}`,
    group: "Math",
    arg: "Title",
    opts: ["label"],
  })),
   

  // Code

  { name: "code", group: "Code", arg: "python" },
  { name: "code-block", group: "Code", arg: "python" },
  { name: "code-cell", group: "Code", arg: "python" },
  //{ name: "literalinclude", group: "Code", arg: "path/to/file.py" },

  // Layout

  /*{ name: "aside", group: "Layout" },
  { name: "margin", group: "Layout" },
  { name: "sidebar", group: "Layout", arg: "Title" },
  { name: "card", group: "Layout", arg: "Title" },
  { name: "grid", group: "Layout", arg: "1 1 2 3" },
  { name: "grid-item-card", group: "Layout", arg: "Title" },
  { name: "tab-set", group: "Layout" },
  { name: "tab-item", group: "Layout", arg: "Title" },
  { name: "dropdown", group: "Layout", arg: "Title" },
  { name: "div", group: "Layout" },
  { name: "blockquote", group: "Layout" },
  */
  // Document

  /*
  { name: "bibliography", group: "Document" },
  { name: "glossary", group: "Document" },
  { name: "embed", group: "Document", arg: "#label" },
  { name: "raw", group: "Document", arg: "html" },
  */
  // The path is required: an {include} without one is an error, so the snippet
  // puts the cursor on it. Its options are all optional, and most documents use
  // none, so none are pre-written.
  { name: "include", group: "Document", arg: "path/to/file.md", noBody: true },
  // Table of contents
  { name: "toc", group: "Document", arg: "Title", opts: ["context", "depth", "class", "label", "dropdown", "open"] },
  { name: "table-of-contents", group: "Document", arg: "Title", opts: ["context", "depth", "class", "label", "dropdown", "open"] },
];


const COMMON_OPTIONS = ["label", "name", "class"];

const ADMONITION_KINDS = ["attention", "caution", "danger", "error", "hint", "important", "note", "seealso", "tip", "warning"];
const ADMONITION_OPTIONS = ["icon", "open", "enumerated", "enumerator"];

const DIRECTIVE_OPTIONS = {
  figure: ["alt", "align", "width", "height", "figwidth", "no-figures", "enumerated", "enumerator"],
  image: ["alt", "align", "width", "height"],
  table: ["align",  "enumerated", "width"],
  "list-table": ["header-rows", "align", "widths"],
  "csv-table": ["header-rows", "align", "widths", "file"],
  math: ["enumerated"],
  code: ["filename", "linenos", "lineno-start", "emphasize-lines"],
  "code-block": ["filename", "linenos", "lineno-start", "emphasize-lines"],
  // `align`, `caption` and `label` only matter to an export: they turn the
  // figure a cell produced into a figure of the document.
  "code-cell": ["tags", "linenos", "packages", "params", "figwidth", "align", "caption", "label"],
  literalinclude: ["lines", "language", "linenos", "start-at", "end-at"],
  admonition: ADMONITION_OPTIONS,
  dropdown: ["open", "icon"],
  card: ["header", "footer", "link"],
  "grid-item-card": ["header", "footer", "link", "columns"],
  "tab-item": ["sync", "selected"],
  iframe: ["width", "align"],
  include: [
    "lines", "start-line", "start-at", "start-after",
    "end-line", "end-at", "end-before",
    "literal", "lang", "caption", "linenos", "lineno-start", "filename",
  ],
  bibliography: ["filter"],
  exercise: ["enumerated", "hidden"],
  toc: ["context", "depth", "class", "label", "dropdown", "open"],
  "table-of-contents": ["context", "depth", "class", "label", "dropdown", "open"],
  ...Object.fromEntries(
    ADMONITION_KINDS.map(kind => [kind, ADMONITION_OPTIONS])
  ),
};

/** Options à domaine fermé : on complète aussi la valeur. */
const OPTION_VALUES = {
  align: ["left", "center", "right"],
  // What the table of contents covers. "section" is the one that reads the
  // document itself; "project" needs a multi-page project, and falls back to
  // the page here.
  context: ["page", "section", "project"],
  enumerated: ["true", "false"],
  depth: ["1", "2", "3", "4", "5", "6"],
  open: ["true", "false"],
  icon: ["true", "false"],
  linenos: ["true", "false"],
  literal: ["true", "false"],
  hidden: ["true", "false"],
};

/** Métadonnées d'affichage par `kind` de la refMap. */
const KIND_META = {
  fig: { word: "Figure", type: "class" },
  table: { word: "Table", type: "interface" },
  eq: { word: "Equation", type: "variable" },
  sec: { word: "Section", type: "namespace", boost: 1 },
};

/** Rôles qui prennent une cible du document, et les `kind` acceptés (null = tous). */
const TARGET_ROLES = { ref: null, numref: null, "proof:ref": null, "prf:ref": null, eq: ["eq"] };
const CITE_ROLES = new Set(["cite", "cite:p", "cite:t"]);
const ARG_ROLES = new Set([...CITE_ROLES, ...Object.keys(TARGET_ROLES)]);

/* ------------------------------------------------------------------ *
 * Snippets rôles / directives
 * ------------------------------------------------------------------ */

/**
 * Si un plugin de fermeture automatique a déjà inséré `}`, l'avaler :
 * sinon il se retrouve orphelin après le snippet.
 */
const swallowBrace = (completion, reopen = false) => ({
  ...completion,
  apply: (view, c, from, to) => {
    const next = view.state.sliceDoc(to, to + 1);
    completion.apply(view, c, from, next === "}" ? to + 1 : to);
    // L'insertion d'un snippet est programmatique : elle n'ouvre pas la popup toute seule.
    if (reopen) setTimeout(() => startCompletion(view), 0);
  },
});


const roleOptions = ROLES.map(({ name, detail }) =>
  swallowBrace(
    snippetCompletion("{" + name + "}`${}`", {
      label: "{" + name + "}",
      detail,
      type: "keyword",
    }),
    ARG_ROLES.has(name),
  ),
);

/**
 * Values the snippet pre-fills for the options where one default is obviously
 * more useful than an empty field. Written as a snippet placeholder, so it is
 * selected on arrival: typing replaces it, Tab keeps it.
 */
const OPTION_PLACEHOLDERS = {
  width: "100%",
  // `:params:` has a syntax nobody guesses, so the completion shows one
  // rather than offering an empty field and leaving the reader to find the
  // documentation. Selected on arrival, so typing replaces it.
  params: "n = 1..100 step 1",
};

/** Les options MyST se mettent juste après la ligne d'ouverture, une par ligne. */
const optionLines = (opts, blankAfter = true) =>
  opts ? opts.map((o) => ":" + o + ": ${" + (OPTION_PLACEHOLDERS[o] ?? "") + "}\n").join("") + (blankAfter ? "\n" : "") : "";

const directiveOptions = (fence, hasBrace) =>
  DIRECTIVES.map(({ name, arg, opts, group, noBody }) => {
    const head = (hasBrace ? "" : "{") + name + "}" + (arg ? " ${" + arg + "}" : "");
    // A directive that takes no content must not be given any: markdown-it-docutils
    // refuses it outright ("Has content but content not allowed"), and the body
    // placeholder -- with the blank line that separates it from the options -- was
    // enough to trigger that. For those, the closing fence follows the options.
    const body = noBody ? optionLines(opts, false) : optionLines(opts) + "${}\n";
    return swallowBrace(
      snippetCompletion(head + "\n" + body + fence, {
        label: name,
        detail: group,
        type: "class",
      }),
    );
  });

/* Identification du nom de la directive en cours */
const directiveCache = new Map();
const directivesFor = (fence, hasBrace) => {
  const key = fence + (hasBrace ? "+" : "");
  if (!directiveCache.has(key)) directiveCache.set(key, directiveOptions(fence, hasBrace));
  return directiveCache.get(key);
};

/** Remonte les lignes pour trouver la directive englobante. Renvoie son nom, ou null. */
const enclosingDirective = (state, pos) => {
  const startLine = state.doc.lineAt(pos).number;
  // Une directive n'a que quelques lignes d'options ; inutile de remonter loin.
  const floor = Math.max(1, startLine - 40);

  for (let n = startLine - 1; n >= floor; n--) {
    const text = state.doc.line(n).text;
    const open = /^\s*(?::{3,}|`{3,})\s*\{([\w:-]+)\}/.exec(text);
    if (open) return open[1];
    // Une clôture nue ou une ligne de texte ordinaire : on n'est plus dans l'en-tête.
    if (/^\s*(?::{3,}|`{3,})\s*$/.test(text)) return null;
    if (text.trim() && !/^\s*:[\w-]*:/.test(text)) return null;
  }
  return null;
};

/* ------------------------------------------------------------------ *
 * Complétions dynamiques : cibles du document et bibliographie
 * ------------------------------------------------------------------ */

const clip = (s, n = 70) => (!s ? "" : s.length > n ? s.slice(0, n - 1) + "…" : s);

/**
 * `label` sert au filtrage flou, `displayLabel` à l'affichage, `apply` à
 * l'insertion. On met donc le titre dans `label` pour pouvoir retrouver une
 * figure par son intitulé, tout en n'affichant et n'insérant que la clé.
 */
const searchable = (key, extra, rest) => ({
  label: extra ? `${key} ${extra}` : key,
  displayLabel: key,
  apply: key,
  ...rest,
});

/** @param {{ byLabel: Map<string, {number, kind, title, line}> }} refMap */
const targetCompletions = (refMap, kinds) => {
  const byLabel = refMap?.byLabel;
  if (!byLabel) return [];
  const out = [];
  for (const [label, entry] of byLabel) {
    if (kinds && !kinds.includes(entry.kind)) continue;
    const meta = KIND_META[entry.kind] ?? { word: entry.kind ?? "", type: "text" };
    const num = entry.number != null ? ` ${entry.number}` : "";
    out.push(
      searchable(label, entry.title, {
        detail: `${meta.word}${num}${entry.title ? " — " + clip(entry.title) : ""}`,
        type: meta.type,
        boost: meta.boost ?? 0,
      }),
    );
  }
  return out;
};

/** "P.-O. Amblard and S. Zozor and …" -> "Amblard et al." */
const shortAuthor = (author) => {
  if (!author) return "";
  const authors = author.split(/\s+and\s+/);
  const first = authors[0].trim();
  const last = first.includes(",") ? first.split(",")[0].trim() : first.split(/\s+/).pop();
  return authors.length > 1 ? `${last} et al.` : last;
};

const yearOf = (entry) => entry.year ?? entry.date?.slice(0, 4) ?? entry.raw?.match(/\byear\s*=\s*[{"]?(\d{4})/i)?.[1] ?? "";

const bibCompletions = (entries) =>
  (entries ?? []).map((e) => {
    const who = shortAuthor(e.author);
    const year = yearOf(e);
    const head = [who, year].filter(Boolean).join(" ");
    return searchable(e.id, `${e.author ?? ""} ${e.title ?? ""}`, {
      detail: `${head}${e.title ? " — " + clip(e.title) : ""}`,
      type: "constant",
      info: () => {
        const dom = document.createElement("div");
        dom.textContent = [e.author, e.title, e.journal ?? e.booktitle, year].filter(Boolean).join("\n");
        dom.style.whiteSpace = "pre-wrap";
        return dom;
      },
    });
  });

/* ------------------------------------------------------------------ *
 * Source de complétion
 * ------------------------------------------------------------------ */

/** Ne pas proposer de rôle à l'intérieur d'un code inline ou d'un bloc de code. */
/**
 * Directives dont le corps n'est pas du markdown : on n'y propose rien.
 * Les autres -- admonitions, théorèmes, exercices, figures -- ont un corps
 * markdown où les rôles et les citations s'écrivent normalement.
 */
const VERBATIM_DIRECTIVE = /^\s*(?::{3,}|`{3,})\s*\{(code|code-block|code-cell|literalinclude|math|mermaid|raw)\}/;

/** Une fence qui ouvre une directive à corps markdown. */
const isMarkdownDirectiveFence = (state, node) => {
  if (!node || node.name !== "FencedCode") return false;
  const first = state.doc.lineAt(node.from).text;
  if (VERBATIM_DIRECTIVE.test(first)) return false;
  return /^\s*(?::{3,}|`{3,})\s*\{[\w:-]+\}/.test(first);
};

/**
 * Les `$` d'un texte, les échappements retirés, `$$` comptant pour un.
 *
 * Écrit à la main plutôt qu'avec une expression régulière à rétro-assertion :
 * Safari ne les a supportées que tardivement, et le reste du code les évite
 * déjà pour cette raison.
 */
function countDollars(text) {
  let single = 0;
  let double = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      i++; // caractère échappé : \$ n'ouvre rien
      continue;
    }
    if (c !== "$") continue;
    if (text[i + 1] === "$") {
      double++;
      i++;
    } else {
      single++;
    }
  }
  return { single, double };
}

/**
 * Le curseur est-il dans une formule ?
 *
 * Dans `a_{` ou `\frac{`, l'accolade ouvre un groupe TeX, pas un rôle : la
 * popup des rôles n'y a rien à faire et masque ce qu'on est en train d'écrire.
 *
 * Le balayage est local, borné au bloc contigu qui précède le curseur — une
 * ligne vide ferme tout, puisqu'une formule de bloc n'en contient pas sans
 * cesser d'être un bloc pour markdown-it. C'est à la fois assez fiable et
 * assez court pour tourner à chaque frappe, et cela évite qu'un `$$` écrit
 * plus haut dans un exemple de code ne fausse une parité calculée sur tout le
 * document. Un `{math}`, lui, est déjà écarté par `inCode()`, qui range les
 * directives à corps verbatim du côté du code.
 */
function inMath(state, pos) {
  const { doc } = state;
  const line = doc.lineAt(pos);
  let block = line.text.slice(0, pos - line.from);

  for (let n = line.number - 1; n >= 1; n--) {
    const text = doc.line(n).text;
    if (!text.trim()) break;
    block = `${text}\n${block}`;
  }

  // Un environnement LaTeX ouvert et pas encore refermé.
  const begins = (block.match(/\\begin\{/g) ?? []).length;
  const ends = (block.match(/\\end\{/g) ?? []).length;
  if (begins > ends) return true;

  const { single, double } = countDollars(block);
  return double % 2 === 1 || single % 2 === 1;
}

/**
 * Pour le parseur, une directive est un bloc de code : le `colonFencedCodeParser`
 * de notre lezer fait des `:::` des nœuds `FencedCode`, dont le corps est un
 * `CodeText`. Sans la distinction ci-dessous, `inCode` répondait « oui » dans
 * une note ou un théorème, et la complétion de rôles ({ref}, {cite}…) comme
 * celle des citations y étaient tout simplement coupées.
 */
const inCode = (state, pos) => {
  let node = syntaxTree(state).resolveInner(pos, -1);
  for (; node; node = node.parent) {
    if (node.name === "InlineCode") return true;
    if (node.name === "CodeText" || node.name === "FencedCode") {
      const fence = node.name === "FencedCode" ? node : node.parent;
      return !isMarkdownDirectiveFence(state, fence);
    }
  }
  return false;
};


/**
 * @param {object} providers
 * @param {() => {byLabel: Map}} providers.getRefMap  Lu à chaque complétion.
 * @param {() => object[]} providers.getBibEntries    Idem.
 */
export const mystCompletionSource =
  ({ getRefMap, getBibEntries } = {}) =>
  (context) => {
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);

    const targets = (kinds) => targetCompletions(getRefMap?.(), kinds);
    const bib = () => bibCompletions(getBibEntries?.());

    const result = (from, options, validFor) => (options.length ? { from, options, validFor } : null);

    // --- 0a. Valeur d'une option : « :align: | » ---
    const value = /^\s*:([\w-]+):([ \t]*)([\w-]*)$/.exec(before);
    if (value) {
      const [, option, space, typed] = value;
      const choices = OPTION_VALUES[option];
      if (!choices) return null;
      return result(
        context.pos - typed.length,
        choices.map((v) => ({ label: v, apply: (space ? "" : " ") + v, type: "constant" })),
        /^[ \t]*[\w-]*$/,
      );
    }

    // --- 0b. Nom d'une option : « :| » en début de ligne ---
    const option = /^(\s*):([\w-]*)$/.exec(before);
    if (option) {
      const directive = enclosingDirective(context.state, context.pos);
      if (!directive) return null;
      const names = [...COMMON_OPTIONS, ...(DIRECTIVE_OPTIONS[directive] ?? [])];
      return result(
        context.pos - option[2].length,
        names.map((name) => ({
          label: name,
          // apply: name + ": ",
          apply: (view, c, from, to) => {
            view.dispatch({ changes: { from, to, insert: name + ": " }, selection: { anchor: from + name.length + 2 } });
            // Seules les options à domaine fermé ont quelque chose à proposer ensuite.
            if (OPTION_VALUES[name]) setTimeout(() => startCompletion(view), 0);
          },
          detail: DIRECTIVE_OPTIONS[directive]?.includes(name) ? directive : "commun",
          type: "property",
        })),
        /^[\w-]*$/,
      );
    }

    // 0c - Argument d'une solution : proposer les labels d'exercices connus.
    const sol = /^\s*(?::{3,}|`{3,})\s*\{solution(?:-start)?\}\s+([\w.:/-]*)$/.exec(before);
    if (sol) {
      return result(context.pos - sol[1].length, targets(["exercise"]), /^[\w.:/-]*$/);
    }

    // --- 1. Directive : début de ligne, après une clôture ::: ou ``` ---
    const fence = /^(\s*)(:{3,}|`{3,})[ \t]*(\{?)([\w:-]*)$/.exec(before);
    if (fence) {
      const [, , chars, brace, typed] = fence;
      const ambiguous = chars[0] === "`" && typed.length === 0 && !brace;
      if (ambiguous && !context.explicit) return null;
      return {
        from: context.pos - typed.length,
        options: directivesFor(chars, !!brace),
        validFor: /^[\w:-]*$/,
      };
    }

    // --- 2. Ancre de lien : [](#…) ---
    const anchor = /\[[^\]]*\]\(\s*#([\w.:/-]*)$/.exec(before);
    if (anchor) {
      const typed = anchor[1];
      return result(context.pos - typed.length, targets(null), /^[\w.:/-]*$/);
    }

    // --- 3. Citation : [@key], [@key1; @key2], [voir @key] ---
    const cite = /\[[^\]]*@([\w.:/-]*)$/.exec(before);
    if (cite) {
      const typed = cite[1];
      if (inCode(context.state, context.pos)) return null;
      return result(context.pos - typed.length, bib(), /^[\w.:/-]*$/);
    }

    // --- 4. Argument d'un rôle déjà ouvert : {ref}`… ---
    const open = /\{([\w:-]+)\}`([^`]*)$/.exec(before);
    if (open) {
      const [, role, typed] = open;
      const options = CITE_ROLES.has(role) ? bib() : role in TARGET_ROLES ? targets(TARGET_ROLES[role]) : null;
      if (!options) return null;
      return result(context.pos - typed.length, options, /^[^`]*$/);
    }

    // --- 5. Nom de rôle : on vient de taper `{` ---
    const role = context.matchBefore(/\{[\w:-]*$/);
    if (!role) return null;
    if (inCode(context.state, context.pos)) return null;
    // `a_{`, `\frac{`, `\begin{` : l'accolade appartient au TeX. Pas sur une
    // invocation explicite : un `$` isolé — un prix, par exemple — suffit à
    // faire croire à une formule, et Ctrl-Espace reste alors la porte de sortie.
    if (!context.explicit && inMath(context.state, context.pos)) return null;
    return { from: role.from, options: roleOptions, validFor: /^\{[\w:-]*$/ };
  };

/**
 * Branche la source sur toutes les langues de l'éditeur.
 * `autocompletion()` doit déjà être actif (c'est le cas dans `basicSetup()`).
 */
export const mystCompletions = (providers) => {
  const source = mystCompletionSource(providers);
  return EditorState.languageData.of(() => [{ autocomplete: source }]);
};
