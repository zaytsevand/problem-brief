#!/usr/bin/env node
/**
 * Add, or remove, the problem-brief hooks:
 *
 *   SessionStart  brief-context.mjs --hook   puts a project's briefs back in front of
 *                                            every new, resumed, cleared or summarised session
 *   PostToolUse   brief-delta.mjs --hook     after each Artifact publish of a brief, hands
 *                                            Claude the chat summary of what moved
 *   UserPromptSubmit,                        a comment on a brief's page, or a message citing
 *   Pre/PostToolUse brief-comments.mjs       its ids, gets recorded; a brief's comment thread
 *     (ArtifactComments) --hook              cannot be resolved until it has been
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

const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = [
  { event: "SessionStart", matcher: "^(startup|resume|clear|compact)$", script: "brief-context.mjs" },
  { event: "PostToolUse", matcher: "Artifact", script: "brief-delta.mjs" },
  { event: "UserPromptSubmit", script: "brief-comments.mjs" },
  { event: "PostToolUse", matcher: "ArtifactComments", script: "brief-comments.mjs" },
  { event: "PreToolUse", matcher: "ArtifactComments", script: "brief-comments.mjs" },
];

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
for (const h of HOOKS) {
  const mark = `${h.script}" --hook`;
  const ours = (group) => (group?.hooks ?? []).some((x) => String(x.command ?? "").includes(mark));
  const kept = (hooks[h.event] ?? []).filter((g) => !ours(g));
  if (!remove) {
    kept.push({ ...(h.matcher ? { matcher: h.matcher } : {}),
      hooks: [{ type: "command", command: `node "${join(here, h.script)}" --hook`, timeout: 10 }] });
  }
  if (kept.length) hooks[h.event] = kept; else delete hooks[h.event];
}
if (Object.keys(hooks).length) settings.hooks = hooks; else delete settings.hooks;

mkdirSync(dirname(settingsPath), { recursive: true });
writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
console.log(remove ? `removed the problem-brief hooks from ${settingsPath}`
  : `added the problem-brief hooks (${[...new Set(HOOKS.map((h) => h.event))].join(", ")}) to ${settingsPath}`);
