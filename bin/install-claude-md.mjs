#!/usr/bin/env node
/**
 * Add, or remove, the one line in CLAUDE.md that makes a brief the default
 * channel for findings, decisions and questions.
 *
 *   node install-claude-md.mjs                  append it to ~/.claude/CLAUDE.md
 *   node install-claude-md.mjs --remove         take it out again
 *   node install-claude-md.mjs --file FILE      use another CLAUDE.md (a project's own)
 *
 * CLAUDE.md is loaded at the start of every session and survives a summary,
 * and it works whether or not the hooks are installed. The line carries a
 * marker, so running this again never adds a second copy, and --remove takes
 * out exactly that line and nothing else.
 *
 * Zero dependencies. Node 18+.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const MARK = "<!-- problem-brief -->";
const LINE = "- Findings, open decisions and questions for me go into a problem brief (the problem-brief skill) by default, " +
  "not only when I ask for one; chat carries the short summary of what moved and the link. Record every answer I give, " +
  "in chat or in a comment on the page, in the brief in the same turn. " + MARK;

const args = process.argv.slice(2);
const i = args.indexOf("--file");
const file = i > -1 ? args[i + 1] : join(homedir(), ".claude", "CLAUDE.md");
const remove = args.includes("--remove");

if (remove && !existsSync(file)) {
  console.log(`nothing to remove: ${file} does not exist`);
  process.exit(0);
}
const text = existsSync(file) ? readFileSync(file, "utf8") : "";
const kept = text.split("\n").filter((l) => !l.includes(MARK));
while (kept.length && kept[kept.length - 1] === "") kept.pop();
const next = remove ? kept : [...kept, ...(kept.length ? [""] : []), LINE];

mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, next.join("\n") + "\n", "utf8");
console.log(remove ? `removed the problem-brief line from ${file}` : `added the problem-brief line to ${file}`);
