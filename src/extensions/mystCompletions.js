import { snippetCompletion, startCompletion } from "@codemirror/autocomplete";
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
  //{ name: "cite", detail: "Bibliographic citation" },
  //{ name: "cite:p", detail: "Parenthetical citation" },
  //{ name: "cite:t", detail: "Textual citation" },
  //{ name: "code", detail: "Inline code" },
  //{ name: "del", detail: "Deleted text" },
  //{ name: "doc", detail: "Link to another document" },
  //{ name: "download", detail: "Download link" },
  { name: "eq", detail: "Reference to a numbered equation" },
  { name: "math", detail: "Inline mathematics" },
  { name: "numref", detail: "Numbered reference" },
  { name: "ref", detail: "Cross-reference" },
  //{ name: "si", detail: "SI unit" },
  { name: "sub", detail: "Subscript" },
  { name: "sup", detail: "Superscript" },
  //{ name: "term", detail: "Glossary term" },
  //{ name: "underline", detail: "Underlined text" },
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

  // Figures, images, and tables

  { name: "figure", group: "Media", arg: "path/to/image.png", opts: ["name", "alt", "width"] },
  { name: "image", group: "Media", arg: "path/to/image.png", opts: ["alt", "width"] },
  { name: "table", group: "Media", arg: "Title", opts: ["label"] },
  { name: "list-table", group: "Media", arg: "Title", opts: ["header-rows"] },
  //{ name: "csv-table", group: "Media", arg: "Title", opts: ["header-rows"] },
  //{ name: "iframe", group: "Media", arg: "https://" },
  //{ name: "mermaid", group: "Media" },

  // Mathematics and proofs

  { name: "math", group: "Math", opts: ["label"] },
  /*{ name: "proof", group: "Math", arg: "Title", opts: ["label"] },
  { name: "theorem", group: "Math", arg: "Title", opts: ["label"] },
  { name: "lemma", group: "Math", arg: "Title", opts: ["label"] },
  { name: "corollary", group: "Math", arg: "Title", opts: ["label"] },
  { name: "definition", group: "Math", arg: "Title", opts: ["label"] },
  { name: "remark", group: "Math", arg: "Title", opts: ["label"] },
  { name: "example", group: "Math", arg: "Title", opts: ["label"] },
  { name: "algorithm", group: "Math", arg: "Title", opts: ["label"] },
   */

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
  { name: "include", group: "Document", arg: "path/to/file.md" },
  { name: "toc", group: "Document" },
  { name: "embed", group: "Document", arg: "#label" },
  { name: "raw", group: "Document", arg: "html" },
  */
];


const COMMON_OPTIONS = ["label", "name", "class"];

const ADMONITION_KINDS = ["attention", "caution", "danger", "error", "hint", "important", "note", "seealso", "tip", "warning"];
const ADMONITION_OPTIONS = ["icon", "open", "enumerated", "enumerator"];

const DIRECTIVE_OPTIONS = {
  figure: ["alt", "align", "width", "height", "figwidth", "no-figures"],
  image: ["alt", "align", "width", "height"],
  table: ["align"],
  "list-table": ["header-rows", "align", "widths"],
  "csv-table": ["header-rows", "align", "widths", "file"],
  math: ["enumerated"],
  code: ["filename", "linenos", "lineno-start", "emphasize-lines"],
  "code-block": ["filename", "linenos", "lineno-start", "emphasize-lines"],
  "code-cell": ["tags"],
  literalinclude: ["lines", "language", "linenos", "start-at", "end-at"],
  admonition: ADMONITION_OPTIONS,
  dropdown: ["open", "icon"],
  card: ["header", "footer", "link"],
  "grid-item-card": ["header", "footer", "link", "columns"],
  "tab-item": ["sync", "selected"],
  iframe: ["width", "align"],
  include: ["start-after", "end-before", "literal"],
  bibliography: ["filter"],
  ...Object.fromEntries(
    ADMONITION_KINDS.map(kind => [kind, ADMONITION_OPTIONS])
  ),
};

/** Options à domaine fermé : on complète aussi la valeur. */
const OPTION_VALUES = {
  align: ["left", "center", "right"],
  enumerated: ["true", "false"],
  open: ["true", "false"],
  icon: ["true", "false"],
  linenos: ["true", "false"],
  literal: ["true", "false"],
};

/** Métadonnées d'affichage par `kind` de la refMap. */
const KIND_META = {
  fig: { word: "Figure", type: "class" },
  table: { word: "Table", type: "interface" },
  eq: { word: "Equation", type: "variable" },
  sec: { word: "Section", type: "namespace", boost: 1 },
};

/** Rôles qui prennent une cible du document, et les `kind` acceptés (null = tous). */
const TARGET_ROLES = { ref: null, numref: null, eq: ["eq"] };
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

/** Les options MyST se mettent juste après la ligne d'ouverture, une par ligne. */
const optionLines = (opts) => (opts ? opts.map((o) => ":" + o + ": ${}\n").join("") + "\n" : "");

const directiveOptions = (fence, hasBrace) =>
  DIRECTIVES.map(({ name, arg, opts, group }) => {
    const head = (hasBrace ? "" : "{") + name + "}" + (arg ? " ${" + arg + "}" : "");
    return swallowBrace(
      snippetCompletion(head + "\n" + optionLines(opts) + "${}\n" + fence, {
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
const inCode = (state, pos) => {
  let node = syntaxTree(state).resolveInner(pos, -1);
  for (; node; node = node.parent) {
    if (node.name === "InlineCode" || node.name === "CodeText") return true;
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
