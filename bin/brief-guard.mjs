#!/usr/bin/env node
/**
 * PreToolUse hook: refuses a hand edit of a brief's JSON (Write, Edit, MultiEdit, or a
 * shell command that writes one with python, node, jq, sed, a redirect…) and names the
 * command to use instead. Every write goes through brief.mjs, which validates it, keeps
 * the stamps in order and holds a lock while it writes.
 *
 *   node brief-guard.mjs --hook       reads the hook input on stdin
 *
 * Zero dependencies. Node 18+.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "brief.mjs");
// brief.json, or name.brief.json — not problem-brief.schema.json or my-brief.json.
const BRIEF_FILE = /(?:^|[\/\\\s'"=.>])brief\.json(?![\w.-])/;
const WRITES = /json\.dumps?\b|JSON\.stringify|writeFile|write_text|\.write\(|open\([^)]*['"][wa]\+?['"]|(?<!<[\w.-]*)>>?\s*['"]?[^\s'"|;&]*brief\.json|\bsed\s+(-\w+\s+)*-i|\btee\b|\bsponge\b|\b(mv|rm)\s/;
// The skill's own scripts write briefs through the same validation; let them run.
const OURS = /\b(brief|brief-withdraw|brief-retire|brief-memory|extract-brief)\.mjs\b/;

// Text a command only carries — a heredoc body for cat or gh, a commit message, an issue body — writes nothing,
// whatever it names (#37). A heredoc on a line that runs an interpreter is code and stays.
const HEREDOC = /<<-?[ \t]*(['"]?)([\w-]+)\1([^\n]*)\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g;
const RUNS_CODE = /\b(python\d*(\.\d+)?|node|deno|bun|bash|sh|zsh|perl|ruby|jq|awk|sed|tee|sponge)\b/;
const MESSAGE = /(\s(?:-m|--message|--body|--title|--notes)(?:\s+|=))("(?:[^"\\]|\\.)*"|'[^']*')/g;

export function prose(cmd) {
  const bodies = cmd.replace(HEREDOC, (all, q, tag, rest, at) => {
    const line = cmd.slice(cmd.lastIndexOf("\n", at) + 1, at) + rest;
    // shortcut: judged by the heredoc's own line; a body piped on through a later line is missed — tighten if seen.
    return RUNS_CODE.test(line) ? all : `<<${q}${tag}${q}${rest}\n${tag}`;
  });
  return bodies.replace(MESSAGE, "$1''");
}

export function refusal(tool, input) {
  if (["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(tool)) {
    return BRIEF_FILE.test(String(input?.file_path ?? input?.notebook_path ?? "")) ? "edit" : null;
  }
  if (tool === "Bash") {
    const cmd = prose(String(input?.command ?? ""));
    // shortcut: a command that both runs one of our scripts and hand-writes a brief slips through; tighten if seen.
    return BRIEF_FILE.test(cmd) && WRITES.test(cmd) && !OURS.test(cmd) ? "shell" : null;
  }
  return null;
}

const reason = (how) =>
  `A brief's JSON is never ${how === "edit" ? "edited by hand" : "written from a shell script"}: ` +
  `that is how notes pile up unmoved, stamps go out of order and malformed entries get in. ` +
  `Use the command for the change; it validates before writing and refuses anything broken: ` +
  `node "${CLI}" new|raise|decide|complete|retract|rule|work|fix|note|set|refresh|stamp <brief.json> … ` +
  `(node "${CLI}" --help lists the flags; set <brief|Q-n|R-n|W-n> --field value changes any field).`;

if (process.argv.includes("--hook")) {
  let input = {};
  try { input = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { process.exit(0); }
  const how = refusal(input.tool_name, input.tool_input);
  if (how) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason(how) },
    }));
  }
}
