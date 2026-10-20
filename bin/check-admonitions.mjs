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
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { scanAdmonitions } from "../src/utils/local_utils/scanAdmonitions.js";
import { framedBlocks, pairAdmonitions, rewriteAdmonitions } from "../src/utils/local_utils/texAdmonitions.js";
import { expandIncludes } from "../src/markdown/includeExpansion.js";
import { findProofLabels } from "../src/markdown/scanProofLabels.js";
import { repairProofLabels } from "../src/utils/local_utils/texProofLabels.js";
import { separateEnvironments } from "../src/utils/local_utils/texTidy.js";

const argv = process.argv.slice(2);
const writeAt = argv.indexOf("--write");
const outPath = writeAt !== -1 ? argv[writeAt + 1] : null;
if (writeAt !== -1) argv.splice(writeAt, outPath ? 2 : 1);
const colorsAt = argv.indexOf("--colors");
const colorsPath = colorsAt !== -1 ? argv[colorsAt + 1] : null;
if (colorsAt !== -1) argv.splice(colorsAt, colorsPath ? 2 : 1);
const [mdPath, texArg] = argv;
if (!mdPath) {
  console.error(
    "usage: node bin/check-admonitions.mjs <source.md> [export.tex] [--write <out.tex>] [--colors <config.json>]",
  );
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

const blocks = framedBlocks(readFileSync(texPath, "utf8"));

// Whether {exercise} and {solution} occupy a rank depends on whether the
// exercise plugin was in use for this build: with it they are framed boxes,
// without it mystmd drops them. Rather than ask, try both and keep the
// reading that pairs -- the verification is what decides, which is the whole
// point of having one.
const attempts = [true, false].map((withExercises) => {
  const scan = scanAdmonitions(expansion.text, { withExercises });
  return { withExercises, ...scan, result: pairAdmonitions(scan.items, blocks) };
});
const chosen = attempts.find((a) => a.result.ok) ?? attempts[0];
const { items, warnings, result } = chosen;
if (result.ok && chosen.withExercises && items.some((i) => ["exercise", "solution"].includes(i.name))) {
  console.log("  (exercises and solutions counted: the export was built with the plugin)");
}

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
  console.log(`\n${labelled} of ${result.pairs.length} carry a :label: (those are the ones a \\label{} is injected for).`);

  if (outPath) {
    // Either a whole config.json or a bare { kind: "RRGGBB" } map, so that the
    // user's own file can be pointed at without extracting anything from it.
    let colors;
    if (colorsPath) {
      const parsed = JSON.parse(readFileSync(colorsPath, "utf8"));
      colors = parsed.export?.admonitionColors ?? parsed.admonitionColors ?? parsed;
    }
    const { text, rewritten, numbered, rejected } = rewriteAdmonitions(readFileSync(texPath, "utf8"), result.pairs, {
      colors,
    });
    for (const r of rejected) console.log(`  ! not a six-digit hex colour, default kept -- ${r}`);

    // Second, independent pass: see texProofLabels.js for why it exists and
    // when it can go away.
    const proofLabels = findProofLabels(expansion.text.split("\n"));
    const proof = repairProofLabels(text, proofLabels);
    for (const r of proof.repairs) {
      if (r.outcome === "repaired") console.log(`  proof label restored: ${r.identifier} -> ${r.label}`);
      if (r.outcome === "absent") console.log(`  ! proof label ${JSON.stringify(r.label)} not found in the .tex as ${r.identifier}`);
      if (r.outcome === "ambiguous") console.log(`  ! proof label ${JSON.stringify(r.label)} is ambiguous once lowercased -- left alone`);
    }
    writeFileSync(outPath, separateEnvironments(proof.text));
    console.log(
      `\nWrote ${outPath}: ${rewritten} box(es) restyled, ${labelled} labelled, ` +
        `${numbered} showing a number (those the .tex refers to with \\ref)` +
        `${proof.repaired ? `, ${proof.repaired} proof label(s) restored` : ""}.`,
    );
  } else {
    console.log("Add --write <out.tex> to produce the rewritten .tex (the original is never modified).");
  }
  process.exit(0);
}

console.log(`\nREFUSED — ${result.reason}`);
console.log("The .tex would be left untouched. Side by side, as far as they agree:\n");
const n = Math.max(items.length, blocks.length);
for (let i = 0; i < n; i++) show(i, items[i], blocks[i]);
process.exit(1);
