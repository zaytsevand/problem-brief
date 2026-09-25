#!/usr/bin/env node
/**
 * Retire a brief: take it out of Claude's memory and the hooks, and keep it
 * for the record.
 *
 *   node brief-retire.mjs brief.json --memory-dir DIR
 *
 * A brief whose work is finished, or abandoned, or that was only ever a test,
 * keeps costing something while it stays registered: every session in the
 * project is handed it at start and after every summary, and the hooks keep
 * its snapshot, its page and its comment threads. Retiring undoes all of that:
 *
 *   - removes its pointer file and its line in MEMORY.md,
 *   - clears what the hooks keep for it: the snapshot of its last publish,
 *     which page belongs to it, which of its threads were read,
 *   - stamps "retired" in the brief's JSON (and moves "updated"), so it is
 *     not registered again by mistake,
 *   - lists the pages it was published at.
 *
 * It never deletes the published page. Deleting a page cannot be undone and
 * breaks its link for everyone, so it is done with the Artifact tool's delete
 * action, and only when the operator asks.
 *
 * Zero dependencies. Node 18+.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pointers, stateHome } from "./brief-context.mjs";

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : undefined; };
const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--memory-dir");
const memoryDir = opt("--memory-dir");
if (!file) {
  console.error("usage: brief-retire.mjs <brief.json> --memory-dir DIR");
  process.exit(2);
}

const path = resolve(file);
const brief = JSON.parse(readFileSync(path, "utf8"));
const done = [];

/* memory: the pointer file and its index line */
if (memoryDir) {
  for (const p of pointers(memoryDir)) {
    if (resolve(p.brief) !== path) continue;
    unlinkSync(join(memoryDir, p.file));
    const index = join(memoryDir, "MEMORY.md");
    if (existsSync(index)) {
      const lines = readFileSync(index, "utf8").split("\n").filter((l) => !l.includes(`(${p.file})`));
      writeFileSync(index, lines.join("\n"), "utf8");
    }
    done.push(`removed ${p.file} and its line in MEMORY.md`);
  }
}

/* the hooks' state: which pages are this brief's, their snapshot, their threads */
const home = stateHome();
const read = (f, empty) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return empty; } };
const urlsFile = join(home, "published", "urls.json");
const urls = read(urlsFile, {});
const pages = new Set([brief.url, ...Object.keys(urls).filter((u) => urls[u] === brief.created)].filter(Boolean));
for (const u of pages) delete urls[u];
if (existsSync(urlsFile)) {
  if (Object.keys(urls).length) writeFileSync(urlsFile, JSON.stringify(urls, null, 2), "utf8"); else unlinkSync(urlsFile);
}
const snap = join(home, "published", `${createHash("sha1").update(String(brief.created)).digest("hex").slice(0, 16)}.json`);
if (existsSync(snap)) { unlinkSync(snap); done.push("removed the snapshot of its last publish"); }
const threadsFile = join(home, "threads.json");
const threads = read(threadsFile, {});
let cleared = 0;
for (const u of pages) if (threads[u]) { delete threads[u]; cleared++; }
if (cleared) {
  if (Object.keys(threads).length) writeFileSync(threadsFile, JSON.stringify(threads, null, 2), "utf8"); else unlinkSync(threadsFile);
  done.push(`cleared the comment-thread records of ${cleared} page${cleared === 1 ? "" : "s"}`);
}

/* the brief itself: stamped, and kept */
if (!brief.retired) {
  const now = new Date().toISOString().slice(0, 16) + "Z";
  const out = {};
  for (const [k, v] of Object.entries(brief)) {
    out[k] = k === "updated" ? now : v;
    if (k === "updated") out.retired = now;
  }
  writeFileSync(path, JSON.stringify(out, null, 2) + "\n", "utf8");
  done.push(`stamped retired ${now} in ${path}`);
}

const live = (brief.decisions ?? []).filter((e) => ["open", "decided"].includes(e.status ?? "open")).map((e) => e.id);
console.log(`retired "${brief.title}"`);
for (const d of done) console.log(`  ${d}`);
if (live.length) console.log(`  ! ${live.join(", ")} still live — nothing will remind a session of ${live.length === 1 ? "it" : "them"} now`);
if (pages.size) {
  console.log("  published at (not deleted — ask the operator, then use the Artifact tool's delete action):");
  for (const u of pages) console.log(`    ${u}`);
}
