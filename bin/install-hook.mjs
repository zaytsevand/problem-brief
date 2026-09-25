#!/usr/bin/env node
/**
 * Add, or remove, the SessionStart hook that puts a project's problem briefs
 * back in front of every new, resumed, cleared or summarised session.
 *
 *   node install-hook.mjs                     add it to ~/.claude/settings.json
 *   node install-hook.mjs --remove            take it out again
 *   node install-hook.mjs --settings FILE     use another settings file
 *
 * Safe to run repeatedly: an existing copy of the hook is replaced, never
 * duplicated, and every other hook in the file is left exactly as it was. The
 * previous file is kept beside it as settings.json.bak-problem-brief.
 *
 * Zero dependencies. Node 18+.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const i = args.indexOf("--settings");
const settingsPath = i > -1 ? args[i + 1] : join(homedir(), ".claude", "settings.json");
const remove = args.includes("--remove");

const script = join(dirname(fileURLToPath(import.meta.url)), "brief-context.mjs");
const MARK = "brief-context.mjs\" --hook";
const command = `node "${script}" --hook`;

let settings = {};
if (existsSync(settingsPath)) {
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch (err) {
    console.error(`${settingsPath} is not valid JSON, so it was left alone.\n  ${err.message}`);
    process.exit(1);
  }
  copyFileSync(settingsPath, settingsPath + ".bak-problem-brief");
}

const hooks = settings.hooks ?? {};
const ours = (group) => (group?.hooks ?? []).some((h) => String(h.command ?? "").includes(MARK));
const kept = (hooks.SessionStart ?? []).filter((g) => !ours(g));
if (!remove) {
  kept.push({
    matcher: "^(startup|resume|clear|compact)$",
    hooks: [{ type: "command", command, timeout: 10 }],
  });
}
if (kept.length) hooks.SessionStart = kept; else delete hooks.SessionStart;
if (Object.keys(hooks).length) settings.hooks = hooks; else delete settings.hooks;

mkdirSync(dirname(settingsPath), { recursive: true });
writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
console.log(remove ? `removed the problem-brief SessionStart hook from ${settingsPath}`
  : `added the problem-brief SessionStart hook to ${settingsPath}`);
