#!/usr/bin/env node
/**
 * Recover a brief's JSON from its rendered or published page.
 *
 *   node extract-brief.mjs page.html                 print the JSON
 *   node extract-brief.mjs page.html brief.json      write it to a file
 *
 * Every rendered page carries its own data. When the JSON is not at hand — a
 * new session, or one whose history has been summarised — read the published
 * page (the Artifact tool's read action saves it locally) and recover the brief
 * from it. The alternative is rebuilding it from memory, which is exactly how
 * answered questions and standing rulings get lost.
 *
 * Zero dependencies. Node 18+.
 */

import { readFileSync, writeFileSync } from "node:fs";

const [, , inPath, outPath] = process.argv;
if (!inPath) {
  console.error("usage: extract-brief.mjs <page.html> [brief.json]");
  process.exit(2);
}

const html = readFileSync(inPath, "utf8");
const m = html.match(/<script type="application\/json" id="problem-brief-data">([\s\S]*?)<\/script>/);
if (!m) {
  console.error(`${inPath} carries no brief data. It was rendered before pages carried their own data, ` +
    "or it is not a problem brief. Rebuild the JSON from the page by hand, and record every ruling on it.");
  process.exit(1);
}

const brief = JSON.parse(m[1]);
const text = JSON.stringify(brief, null, 2) + "\n";
if (outPath) {
  writeFileSync(outPath, text, "utf8");
  const n = (k) => (brief[k] ?? []).length;
  console.log(`wrote ${outPath}  (${n("decisions")} entries, ${n("rulings")} standing rulings, updated ${brief.updated})`);
} else {
  process.stdout.write(text);
}
