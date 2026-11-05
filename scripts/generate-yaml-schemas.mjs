/**
 * Generate the JSON Schemas the YAML language server validates against.
 *
 * mystmd publishes no schema: it validates by hand, in TypeScript, with
 * `validateObjectKeys(input, { optional: PAGE_FRONTMATTER_KEYS, ... })`. But it
 * does export those key lists, so the schema is generated from the installed
 * version rather than written out and left to drift. Upgrade mystmd, run this
 * again, and the editor stops offering keys that version no longer knows.
 *
 * What it buys, before any value is typed: completion of the key names, and a
 * diagnostic on a key that does not exist. For a frontmatter of sixty-four
 * possible keys, catching a typo is most of the help.
 *
 * Run with: npm run schemas
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FRONTMATTER_ALIASES, PAGE_FRONTMATTER_KEYS, PROJECT_FRONTMATTER_KEYS, SITE_FRONTMATTER_KEYS } from "myst-frontmatter";
import { SITE_CONFIG_KEYS } from "myst-config";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../src/public/schemas");

/**
 * The keys this editor adds, which mystmd knows nothing about.
 *
 * They are declared with their shape rather than left open, because this is the
 * one place where a description can be written: the language server shows it on
 * hover, which is the whole point of the exercise for a frontmatter that has
 * grown large.
 */
const OURS = {
  python: {
    description:
      "Which Python namespace this document's code cells run in: `shared` (the default), `isolated` for one of its own, or any name for a namespace shared by the documents that give the same one.",
    anyOf: [{ enum: ["shared", "isolated"] }, { type: "string" }],
  },
  language: {
    description: "The dictionary the spell checker uses, as a language tag -- `fr`, `en-GB`.",
    type: "string",
  },
  shortCaptions: {
    description:
      "How a short caption is derived for the lists of figures and tables when a figure declares none: `sentence`, or a number of characters (10 or more). `false` prints captions in full.",
    anyOf: [{ enum: ["sentence", false] }, { type: "integer", minimum: 10 }],
  },
  "citation-style": {
    description: "How a citation is rendered in the text: `author-year`, or `numeric` (the default).",
    enum: ["author-year", "numeric"],
  },
  "citation-template": {
    description:
      "How one entry of the bibliography is rendered. A pattern over the fields of the entry: `{authors} ({year}). *{title}*. {container}{volume}{pages}.{doilink}`.",
    type: "string",
  },
  css: {
    description: "A style sheet, relative to the document, applied to the preview and to the exports.",
    type: "string",
  },
  slides: {
    description: "How this document is cut into slides and how a deck is drawn.",
    type: "object",
    properties: {
      marker: { description: "What separates two slides.", type: "string" },
      cutAtHeading: { description: "Start a new slide at every heading of this level or above.", type: ["integer", "boolean"] },
      width: { description: "Slide width in pixels.", type: "number" },
      height: { description: "Slide height in pixels.", type: "number" },
      fontSize: { description: "Base type size of a slide, in pixels. A slide is read from the back of a room.", type: "number" },
      cellFontSize: { description: "Type size of the code cells on a slide.", type: "number" },
      padding: { description: "Inner margin of a slide, as a CSS length.", type: "string" },
      verticalAlign: { description: "Where the content sits in the slide box.", enum: ["flex-start", "center", "flex-end"] },
      transition: { description: "How one slide gives way to the next.", type: "string" },
      transitionMs: { description: "How long that takes, in milliseconds.", type: "number" },
      background: { description: "Slide background, as a CSS colour.", type: "string" },
      header: { description: "Header line. Three parts separated by `|`.", type: "string" },
      footer: { description: "Footer line. Three parts separated by `|`.", type: "string" },
      headerStyle: { description: "CSS applied to the header line.", type: "string" },
      footerStyle: { description: "CSS applied to the footer line.", type: "string" },
      furniture: { description: "Show the header and footer.", type: "boolean" },
      align: { description: "Horizontal alignment inside a slide.", type: "string" },
    },
    // The editor reads both spellings of every two-word key, so the schema
    // accepts what the editor accepts rather than only its preferred form.
    additionalProperties: true,
  },
};

/**
 * What mystmd's own keys mean, in one line each.
 *
 * mystmd documents its frontmatter in prose, on the web, and nowhere the
 * generator can read: the TypeScript declarations carry almost no JSDoc (two
 * comments across the sixty-four page keys). So the descriptions are written
 * here, by hand, from https://mystmd.org/guide/frontmatter. The table is
 * deliberately partial and additive -- a key absent from it simply gets no
 * hover text, exactly as before, and a key mystmd drops disappears on its own
 * because the key lists, not this table, decide what the schema contains.
 */
const MYST = {
  // Identity and bibliography
  title: "The document's title.",
  subtitle: "A second line under the title.",
  short_title: "A shortened title, for running heads and navigation.",
  description: "One or two sentences describing the document, used in listings and link previews.",
  label: "An identifier this document can be cross-referenced by.",
  date: "The date of the work, as `YYYY-MM-DD`.",
  doi: "The DOI of the published version.",
  identifiers: "Other identifiers for this work, keyed by scheme.",
  arxiv: "arXiv identifier or URL.",
  pmid: "PubMed identifier.",
  pmcid: "PubMed Central identifier.",
  zenodo: "Zenodo record URL.",
  oxa: "Curvenote (oxa) identifier.",
  open_access: "Whether the published work is open access.",
  license: "The licence, as an SPDX identifier -- `CC-BY-4.0` -- or a map with `content` and `code`.",
  copyright: "Copyright line.",
  venue: "Where the work appeared: a journal, a conference, a series.",
  volume: "Volume of the venue.",
  issue: "Issue of the venue.",
  first_page: "First page in the printed venue.",
  last_page: "Last page in the printed venue.",
  subject: "The subject or section the work belongs to.",

  // People
  authors: "The authors, as a list of names or of objects with `name`, `email`, `orcid`, `affiliations`.",
  contributors: "People credited without being authors.",
  reviewers: "The reviewers of the work.",
  editors: "The editors of the work.",
  affiliations: "Institutions the people above belong to, declared once and referenced by id.",
  funding: "Funding and awards behind the work.",
  acknowledgments: "The acknowledgments section.",

  // Content
  abstract: "The abstract, inline or as a path to a file holding it.",
  summary: "A plain-language summary.",
  keypoints: "The key points of the work.",
  keywords: "Keywords describing the work.",
  tags: "Tags attached to the document.",
  dedication: "The dedication.",
  epigraph: "An epigraph printed at the head of the work.",
  data_availability: "The data-availability statement.",
  parts: "Named parts of the document -- `abstract`, `acknowledgments`, and any part a template asks for.",
  bibliography: "The `.bib` files the citations are resolved against.",
  abbreviations: "Abbreviations expanded on first use, as `{ SHORT: \"the long form\" }`.",
  math: "Macros available to every equation, as `{ \"\\\\macro\": \"definition\" }`.",
  numbering: "What gets numbered and how: headings, figures, equations, and their formats.",
  enumerator: "An explicit number for this document, overriding the computed one.",
  content_includes_title: "Whether the body already starts with the title, so it is not added twice.",

  // Images
  thumbnail: "The image that stands for the document in listings.",
  thumbnailOptimized: "The optimized thumbnail, written by the build. Not usually set by hand.",
  banner: "A wide image shown at the head of the page.",
  bannerOptimized: "The optimized banner, written by the build. Not usually set by hand.",

  // Execution
  kernelspec: "The Jupyter kernel the code cells run in.",
  jupytext: "Jupytext metadata, kept when a notebook is paired with this text file.",
  execute: "Execution settings for this document.",
  skip_execution: "Do not execute this document's code cells.",
  thebe: "Live-execution settings for the built site: the binder or server the page connects to.",
  binder: "A binder URL the live site offers.",

  // Links, source, exports
  github: "The repository the work lives in.",
  source: "Where this document comes from.",
  source_url: "A link to the source of this page.",
  edit_url: "A link that opens this page for editing.",
  exports: "The documents built from this one: `pdf`, `tex`, `docx`, `typst`, each with its own options.",
  downloads: "Files offered for download beside the page.",
  settings: "Per-document build settings.",
  options: "Template options, passed through to the site or export template.",
  social: "Social accounts shown with the work: `twitter`, `mastodon`, and the like.",
  site: "Site-level frontmatter for this page -- normally set in `myst.yml` instead.",

  // Project-only
  id: "The project's identifier.",
  toc: "The table of contents: the files and folders, in order. Omit it and the folder is walked.",
  references: "External MyST projects whose labels this one may cross-reference, keyed by name.",
  requirements: "Files listing the environment the project needs -- `requirements.txt`, an `environment.yml`.",
  resources: "Extra files the build should carry along.",
  static_files: "Folders copied into the built site as they are.",

  // Project configuration, beyond the project frontmatter
  remote: "The remote project this one is linked to.",
  index: "The file that serves as the project's landing page.",
  exclude: "Files and folders the build ignores.",
  plugins: "The plugins the build loads, as paths to `.mjs` files or as `{ type, path }` entries.",
  error_rules: "Rules that silence or re-rank particular build warnings.",

  // Site-only
  projects: "The projects this site is built from, each with a path and a slug.",
  nav: "The site's navigation bar.",
  actions: "The buttons in the site header, each with a title and a URL.",
  domains: "The domains the site is served at.",
  template: "The site template, by name or path.",
};

/**
 * The key names of a list, whatever shape the package publishes it in.
 *
 * `myst-frontmatter` exports plain arrays; `myst-config` exports an object with
 * `required` and `optional` arrays -- the shape its own validator takes. Both
 * are read here rather than one being assumed, since assuming cost a
 * `SITE_CONFIG_KEYS is not iterable` the first time.
 */
const keysOf = (list) =>
  Array.isArray(list) ? list : [...(list?.required ?? []), ...(list?.optional ?? [])];

/**
 * A key list as a properties object: named, described when MYST has a line for
 * it, and otherwise unconstrained -- the point is completion and typo
 * catching, not type checking a frontmatter mystmd itself validates later.
 *
 * The aliases come in with the keys. mystmd accepts `jupyter` for `thebe`,
 * `author` for `authors`, `image` for `thumbnail` and two dozen more, through
 * a map it exports; a schema built from the canonical names alone marks every
 * one of them as unknown. Each alias is included whenever the key it stands
 * for is, and says so on hover, so the reader learns the preferred spelling
 * rather than merely being left alone.
 */
const open = (lists) => {
  const keys = new Set(lists.flatMap(keysOf));
  const described = (k) => (MYST[k] ? { description: MYST[k] } : {});
  const entries = [...keys].map((k) => [k, described(k)]);
  const aliases = Object.entries(FRONTMATTER_ALIASES)
    .filter(([alias, target]) => keys.has(target) && !keys.has(alias))
    .map(([alias, target]) => [
      alias,
      { ...described(target), description: [`Alias of \`${target}\`.`, MYST[target]].filter(Boolean).join(" ") },
    ]);
  return Object.fromEntries([...entries, ...aliases]);
};

/** The project keys `myst-config` validates but does not export. */
const PROJECT_CONFIG_ONLY = ["remote", "index", "exclude", "plugins", "error_rules"];

const withOurs = (lists, ours) => ({ ...open([].concat(lists)), ...ours });

const pageSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://mystral-editor.local/schemas/frontmatter.schema.json",
  title: "MyST document frontmatter",
  type: "object",
  properties: withOurs([PAGE_FRONTMATTER_KEYS], OURS),
  additionalProperties: false,
};

const projectSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://mystral-editor.local/schemas/myst.schema.json",
  title: "MyST project configuration (myst.yml)",
  type: "object",
  properties: {
    version: { description: "Config format version.", type: ["number", "string"] },
    extends: { description: "Another configuration this one inherits from.", type: ["string", "array"] },
    project: {
      type: "object",
      // `myst-config` keeps its own five project keys in a PROJECT_CONFIG_KEYS
      // it does not export, so they are named here; everything else comes from
      // the exported frontmatter list.
      properties: withOurs([PROJECT_FRONTMATTER_KEYS, PROJECT_CONFIG_ONLY], OURS),
      additionalProperties: false,
    },
    site: { type: "object", properties: open([SITE_FRONTMATTER_KEYS, SITE_CONFIG_KEYS]), additionalProperties: false },
  },
  additionalProperties: false,
};

mkdirSync(out, { recursive: true });
for (const [name, schema] of [["frontmatter.schema.json", pageSchema], ["myst.schema.json", projectSchema]]) {
  writeFileSync(resolve(out, name), JSON.stringify(schema, null, 2) + "\n");
  console.log(`${name}: ${Object.keys(schema.properties).length} top-level propert(ies)`);
}
