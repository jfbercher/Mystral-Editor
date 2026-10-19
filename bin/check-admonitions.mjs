#!/usr/bin/env node
/**
 * Dry run of the admonition pairing: reads a MyST source and the .tex mystmd
 * produced from it, and reports whether the two can be matched. Writes
 * nothing. This is the check the .tex post-processing will perform before it
 * is allowed to rewrite anything.
 *
 *   node bin/check-admonitions.mjs doc.md _build/exports/doc.tex
 *   node bin/check-admonitions.mjs doc.md            (finds the .tex beside it)
 */
import { readFileSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { scanAdmonitions } from "../src/utils/local_utils/scanAdmonitions.js";
import { framedBlocks, pairAdmonitions } from "../src/utils/local_utils/texAdmonitions.js";
import { expandIncludes } from "../src/markdown/includeExpansion.js";

const [, , mdPath, texArg] = process.argv;
if (!mdPath) {
  console.error("usage: node bin/check-admonitions.mjs <source.md> [export.tex]");
  process.exit(2);
}

const guessTex = () => {
  const stem = basename(mdPath).replace(/\.[^.]+$/, "");
  const here = dirname(mdPath);
  for (const p of [
    join(here, "_build", "exports", `${stem}.tex`),
    join(here, "_build", "exports", `${stem}.tex`.toLowerCase()),
    join(here, `${stem}.tex`),
  ]) {
    if (existsSync(p)) return p;
  }
  return null;
};

const texPath = texArg ?? guessTex();
if (!texPath || !existsSync(texPath)) {
  console.error(`No .tex found. Give one as the second argument, or run "myst build ${mdPath} --tex" first.`);
  process.exit(2);
}

// An {include} is one line in the source and a whole file in the .tex, so the
// scan has to see the document as the reader does. This is the same expansion
// the editor performs before its own scanners run.
const hostText = readFileSync(mdPath, "utf8");
const hostLineCount = hostText.split("\n").length;
const expansion = expandIncludes(hostText, (p) => {
  try {
    return readFileSync(resolve(dirname(mdPath), p), "utf8");
  } catch {
    console.log(`  ! {include} ${p} could not be read -- its admonitions will be missing`);
    return null;
  }
});

/** Where an expanded line really lives: the host file, or an included one. */
const whereOf = (expandedLine) => {
  const key = expansion.lineOf?.[expandedLine - 1] ?? expandedLine;
  if (key <= hostLineCount) return `L${String(key).padStart(4)}`;
  const inc = expansion.includes.find((i) => key >= i.virtualStart && key < i.virtualStart + i.text.split("\n").length + 1);
  if (!inc) return `L${String(key).padStart(4)}`;
  return `${basename(inc.path)}:${key - inc.virtualStart + 1}`;
};

const { items, warnings } = scanAdmonitions(expansion.text);
const blocks = framedBlocks(readFileSync(texPath, "utf8"));
const result = pairAdmonitions(items, blocks);

const included = expansion.expanded ? `, ${expansion.includes.length} include(s) expanded` : "";
console.log(`source : ${mdPath}  (${items.length} admonition${items.length === 1 ? "" : "s"}${included})`);
console.log(`tex    : ${texPath}  (${blocks.length} framed)`);
for (const w of warnings) console.log(`  ! ${w}`);

const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
// One column wide enough for the longest origin, so that an admonition coming
// from an included file does not shift the line it is on.
const WHERE_W = Math.max(6, ...items.map((it) => whereOf(it.line).length));
const show = (i, item, block) => {
  const where = (item ? whereOf(item.line) : "—").padEnd(WHERE_W);
  const name = (item?.name ?? "—").padEnd(11);
  const src = cut(JSON.stringify(item?.title ?? null), 34).padEnd(34);
  const tex = cut(JSON.stringify(block?.title ?? null), 34);
  const same = item && block && JSON.stringify(item.title ?? null) === JSON.stringify(block.title ?? null);
  console.log(`  ${String(i + 1).padStart(3)}  ${where}  ${name}${src}  ${same ? "=" : "~"}  ${tex}`);
};

if (result.ok) {
  console.log("\nPAIRING VERIFIED — the post-processing would be allowed to run.\n");
  result.pairs.forEach(({ item, block }, i) => show(i, item, block));
  const labelled = result.pairs.filter(({ item }) => item.label).length;
  console.log(`\n${labelled} of ${result.pairs.length} carry a :label: (those are the ones a \\label{} would be injected for).`);
  process.exit(0);
}

console.log(`\nREFUSED — ${result.reason}`);
console.log("The .tex would be left untouched. Side by side, as far as they agree:\n");
const n = Math.max(items.length, blocks.length);
for (let i = 0; i < n; i++) show(i, items[i], blocks[i]);
process.exit(1);
