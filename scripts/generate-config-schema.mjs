/**
 * Generate the JSON Schema the editor validates `config.json` against.
 *
 * The schema is read out of `src/config-defaults.js`, which is the only place
 * that knows what a setting is called, what it holds and what it is for: the
 * shape of each key comes from its default value, and its description from the
 * comment written above it -- the comments that are already there, already
 * maintained, and already the documentation of this file. One source, so the
 * schema cannot drift from the defaults the way a hand-written one would.
 *
 * The convention this relies on is the one the file already follows: a comment
 * immediately above a key describes that key. A trailing comment on the same
 * line serves when there is no block above, which is how the short tables of
 * shortcuts are annotated.
 *
 * Run with: npm run schemas
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "../src/config-defaults.js");
const out = resolve(here, "../src/public/schemas");

/**
 * Keys whose shape cannot be read off a default value.
 *
 * Two kinds. A closed set of values the default does not reveal -- `editorMode`
 * is a string, but not any string. And an open table, where the keys are the
 * user's own and a schema that listed the defaults would reject every addition:
 * those stay open, and are named here because nothing in the file says that a
 * table is open rather than merely small.
 *
 * Keyed by the dotted path, so a sub-key can be treated without touching its
 * parent.
 */
const OVERRIDES = {
  editorMode: { enum: ["Source", "Preview", "Both", "Diff", "Resolved", "Outline", "Inline"] },
  "pyodide.offline": { enum: ["auto", "never"] },
  "slides.verticalAlign": { enum: ["top", "center"] },
  "spellcheck.language": { type: "string" },
};

/**
 * Keys `config.json` accepts that `DEFAULT_CONFIG` does not hold.
 *
 * `data_directives` is merged into the built-in directive table rather than
 * into the configuration, so it is a real key of the file and absent from the
 * defaults; without it here, the schema would reject the very file the
 * application writes for a new user, since the starter includes it.
 */
const EXTRA = {
  data_directives: {
    description:
      "Directive definitions, added to the built-in table or overriding it. Each key is the directive's name, and its value says how the labelling and numbering system treats it: `kind` (the counter it belongs to -- `fig`, `table`, `eq`, or one of the proof families -- `null` for a directive that is not labelled), `label` (what is printed before the number), `numbered`, and `caption` (`arg`, `body` or `both` -- where the caption is read from).",
    type: "object",
    additionalProperties: {
      type: "object",
      properties: {
        kind: { description: "The counter this directive belongs to, or null when it is not labelled.", type: ["string", "null"] },
        label: { description: "What is printed before the number: Figure, Table, Exercise.", type: "string" },
        numbered: { description: "Whether the directive takes a number.", type: "boolean" },
        caption: { description: "Where the caption is read from.", enum: ["arg", "body", "both"] },
        argIsLabel: { description: "The directive's argument is its label, not its caption.", type: "boolean" },
        reference: { description: "The directive refers to another rather than being counted on its own.", type: "boolean" },
        refJoiner: { description: "What joins this directive to the one it refers to in a cross-reference.", type: "string" },
        fmKey: { description: "The frontmatter key under which this directive's numbering is configured.", type: "string" },
      },
      additionalProperties: true,
    },
  },
};

/** The text of the comments that describe a property, as markdown. */
const describe = (comments, prop, previousEnd) => {
  const above = comments
    .filter((c) => c.start >= previousEnd && c.end < prop.start)
    .map((c) => (c.type === "Line" ? c.value : c.value.replace(/^\s*\*+/gm, "")))
    .map((t) => t.trim());
  if (above.length) return above.join("\n").replace(/\n(?=\S)/g, " ").trim();

  // Nothing above: a trailing comment on the same line, if there is one.
  const trailing = comments.find((c) => c.start > prop.end && c.loc.start.line === prop.loc.end.line);
  return trailing ? trailing.value.trim() : "";
};

/** The JSON type of a default value, as far as it can be told statically. */
function shapeOf(node, path, comments) {
  const override = OVERRIDES[path];
  if (override) return { ...override };

  switch (node.type) {
    case "ObjectExpression":
      return { type: "object", properties: propertiesOf(node, path, comments), additionalProperties: false };
    case "ArrayExpression":
      return { type: "array" };
    case "TemplateLiteral":
      return { type: "string" };
    case "UnaryExpression":
      return shapeOf(node.argument, path, comments);
    case "BinaryExpression":
      // `60 * 60 * 1000` -- a duration written as a product, which is a number
      // however it is spelled.
      return { type: "number" };
    case "Literal":
      if (node.value === null) return {};
      if (typeof node.value === "boolean") return { type: "boolean" };
      if (typeof node.value === "number") return { type: "number" };
      if (typeof node.value === "string") return { type: "string" };
      return {};
    default:
      // An identifier, a call, a spread: the value is computed and says
      // nothing about its type. The key is still declared, so it is accepted
      // and completed; only its type is left open.
      return {};
  }
}

/** The properties of an object literal, described and shaped. */
function propertiesOf(node, path, comments) {
  const properties = {};
  let previousEnd = node.start;
  for (const prop of node.properties) {
    if (prop.type !== "Property") {
      previousEnd = prop.end;
      continue;
    }
    const name = prop.key.name ?? prop.key.value;
    const full = path ? `${path}.${name}` : String(name);
    const description = describe(comments, prop, previousEnd);
    const shape = shapeOf(prop.value, full, comments);
    properties[name] = description ? { description, ...shape } : shape;
    previousEnd = prop.end;
  }
  return properties;
}

const comments = [];
const text = readFileSync(source, "utf8");
const tree = parse(text, { ecmaVersion: "latest", sourceType: "module", locations: true, onComment: comments });

const declaration = tree.body
  .flatMap((n) => (n.type === "ExportNamedDeclaration" && n.declaration?.declarations ? n.declaration.declarations : []))
  .find((d) => d.id.name === "DEFAULT_CONFIG");
if (!declaration || declaration.init.type !== "ObjectExpression") {
  throw new Error("DEFAULT_CONFIG was not found in config-defaults.js, or is no longer an object literal");
}

const schema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://mystral-editor.local/schemas/config.schema.json",
  title: "Mystral Editor configuration (config.json)",
  type: "object",
  properties: {
    // Written by anyone who wants their own editor to find the schema; the
    // application does not need it, and must not reject it.
    $schema: { description: "The schema this file is validated against.", type: "string" },
    ...propertiesOf(declaration.init, "", comments),
    ...EXTRA,
  },
  additionalProperties: false,
};

mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, "config.schema.json"), JSON.stringify(schema, null, 2) + "\n");
const described = Object.values(schema.properties).filter((v) => v.description).length;
console.log(`config.schema.json: ${Object.keys(schema.properties).length} top-level properties, ${described} described`);
