#!/usr/bin/env node
/**
 * Register a brief in Claude Code's memory for this project.
 *
 *   node brief-memory.mjs brief.json --memory-dir DIR [--url URL]
 *
 * DIR is the persistent memory directory your system prompt names — for Claude
 * Code, ~/.claude/projects/<project>/memory. The script writes one ordinary
 * memory file, problem-brief-<name>.md, pointing at the brief, and keeps its
 * line in MEMORY.md, the index loaded into every session. Running it again
 * updates both in place; it never adds a second line.
 *
 * The pointer holds where the brief is and what it is for, never the rulings
 * themselves: the brief's JSON is the one record, and a copy would drift. The
 * SessionStart hook (brief-context.mjs --hook) follows the pointer and puts the
 * rulings back in front of every new or summarised session.
 *
 * Zero dependencies. Node 18+.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : undefined; };
const file = args.find((a, i) => !a.startsWith("--") && !["--memory-dir", "--url"].includes(args[i - 1]));
const memoryDir = opt("--memory-dir");
if (!file || !memoryDir) {
  console.error("usage: brief-memory.mjs <brief.json> --memory-dir DIR [--url URL]");
  process.exit(2);
}

const path = resolve(file);
const brief = JSON.parse(readFileSync(path, "utf8"));
const url = opt("--url") ?? brief.url;
const slug = basename(path).replace(/(\.brief)?\.json$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "brief";
const name = `problem-brief-${slug}`;
const one = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const quote = (s) => JSON.stringify(one(s));

const rulings = (brief.rulings ?? []).filter((r) => (r.status ?? "active") === "active").length;
const live = (brief.decisions ?? []).filter((e) => ["open", "decided"].includes(e.status ?? "open")).length;

const body = `---
name: ${name}
description: ${quote(`Problem brief "${brief.title}" — the record of every ruling on this subject; load it before raising or asking anything about it`)}
metadata:
  type: project
  brief: ${quote(path)}${url ? `\n  url: ${quote(url)}` : ""}
---

The problem brief "${one(brief.title)}" records every question raised, every ruling given and every standing judgement on: ${one(brief.subject)}

- JSON: \`${path}\`${url ? `\n- Published: ${url}` : ""}${brief.goal ? `\n- Goal: ${one(brief.goal)}` : ""}
- At last registration: ${live} live ${live === 1 ? "entry" : "entries"}, ${rulings} standing ${rulings === 1 ? "ruling" : "rulings"}.

**Why:** answers given in chat are lost when a long session is summarised, and the same questions then come back. The brief keeps them.

**How to apply:** before raising a problem or asking a question on this subject, load the JSON and search its entries (every state) and its rulings (R-…). Record every new answer or judgement in the JSON in the same turn it is given. If the JSON is missing, recover it from the published page with the problem-brief skill's extract-brief.mjs — never rebuild it from memory.
`;

mkdirSync(memoryDir, { recursive: true });
writeFileSync(join(memoryDir, `${name}.md`), body, "utf8");

const indexPath = join(memoryDir, "MEMORY.md");
const line = `- [${one(brief.title)}](${name}.md) — problem brief: rulings and open questions; check before asking anything on it`;
const index = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : "";
const kept = index.split("\n").filter((l) => !l.includes(`(${name}.md)`));
while (kept.length && kept[kept.length - 1] === "") kept.pop();
writeFileSync(indexPath, [...kept, line].join("\n") + "\n", "utf8");

console.log(`registered ${name} in ${memoryDir}  (${live} live, ${rulings} rulings)`);
