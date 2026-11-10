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

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pictureProblem } from "./validate-brief.mjs";

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
     back next to the JSON, so the recovered brief renders again. The page may
     not be ours, so a file is written only when it passes the same picture
     rule the validator applies (a PNG, JPEG or WebP inside this folder, with
     no hidden or parent segment, whose bytes are that picture), only where
     its real path stays inside this folder, and never over a different file
     already there. Each skip is named, with what the render will show. */
  const base = realpathSync(dirname(resolve(outPath)));
  let skipped = 0;
  const skip = (file, why) => { skipped++; console.warn(`  ! skipped picture ${file}: ${why}`); };
  for (const [file, b64] of pictures()) {
    const buf = Buffer.from(b64, "base64");
    const problem = pictureProblem(file, buf);
    if (problem) { skip(file, problem.message.replace(/^"[^"]+" /, "")); continue; }
    const dest = resolve(base, file);
    // Checked before any folder is made: the nearest existing folder on the way, through any symlink, must be inside.
    let near = dirname(dest);
    while (!existsSync(near)) near = dirname(near);
    const inside = relative(base, realpathSync(near));
    if (inside.startsWith("..") || isAbsolute(inside)) { skip(file, `its folder leads outside ${base}`); continue; }
    mkdirSync(dirname(dest), { recursive: true });
    if (existsSync(dest)) {
      if (!readFileSync(dest).equals(buf)) skip(file, "a different file with that name is already there; move it aside to recover the page's copy");
      continue;
    }
    writeFileSync(dest, buf, { flag: "wx" });
    console.log(`  wrote picture ${file}`);
  }
  if (skipped) console.warn(`  ${skipped} picture${skipped === 1 ? "" : "s"} not written: until ${skipped === 1 ? "it is" : "they are"} restored, the rendered page shows a note in ${skipped === 1 ? "its" : "their"} place.`);
} else {
  process.stdout.write(text);
  const n = pictures().size;
  if (n) console.error(`${n} picture${n === 1 ? "" : "s"} on the page ${n === 1 ? "was" : "were"} not written. Give a second argument (brief.json) to write ${n === 1 ? "it" : "them"} back beside the JSON.`);
}

// The pictures the page embeds, by the path the brief names them with.
function pictures() {
  const pics = new Map();
  for (const [, file, b64] of html.matchAll(/<img data-brief-file="([^"]+)" src="data:image\/[a-z]+;base64,([^"]+)"/g)) {
    pics.set(file.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"), b64);
  }
  return pics;
}
