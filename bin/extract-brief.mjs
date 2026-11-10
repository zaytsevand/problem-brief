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

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

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
  /* The JSON names each picture by path; the page carries the bytes. Write them
     back next to the JSON, so the recovered brief renders again. A path that
     climbs out of that folder is not followed: the page may not be ours. */
  const base = dirname(resolve(outPath));
  const pics = new Map();
  for (const [, file, b64] of html.matchAll(/<img data-brief-file="([^"]+)" src="data:image\/[a-z]+;base64,([^"]+)"/g)) {
    pics.set(file.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"), b64);
  }
  for (const [file, b64] of pics) {
    const dest = resolve(base, file);
    if (relative(base, dest).startsWith("..") || isAbsolute(relative(base, dest))) {
      console.warn(`  ! skipped ${file}: it points outside ${base}`);
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, Buffer.from(b64, "base64"));
    console.log(`  wrote picture ${file}`);
  }
} else {
  process.stdout.write(text);
}
