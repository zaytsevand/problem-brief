#!/usr/bin/env node
/**
 * Retire the briefs a session leaves finished, when that session ends.
 *
 *   node brief-end.mjs --hook       run as a Claude Code SessionEnd hook
 *
 * The session that finished a brief's work is the one that knows it is
 * finished, and it is gone by the time the next SessionStart digest offers
 * retirement. A SessionEnd hook cannot ask the operator anything, so it only
 * retires what needs no ruling, and only on briefs this session owns (their
 * `owner` is the session's git branch):
 *
 *   - a throwaway brief, and
 *   - a brief with nothing live. Every brief is throwaway once its work is
 *     done: its rulings are written back into the project's spec suite (#38),
 *     and the retired JSON keeps them for the record.
 *
 * It never deletes a published page. What it retired is kept under the hooks'
 * state, and the next SessionStart in the project says so once, with how to
 * bring each one back.
 *
 * A hook must never break a session, so every failure is silent.
 *
 * Zero dependencies. Node 18+.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { briefsFor, currentBranch, endedFile, finished, memoryDirOf } from "./brief-context.mjs";

const RETIRE = join(dirname(fileURLToPath(import.meta.url)), "brief-retire.mjs");

export const dueAtEnd = (brief) => !brief.retired && (brief.throwaway === true || finished(brief));

function hook() {
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  const memoryDir = memoryDirOf(input);
  const branch = input.cwd ? currentBranch(input.cwd) : null;
  if (!memoryDir || !branch) return;

  const retired = [];
  for (const { path, brief } of briefsFor(memoryDir)) {
    if (brief.owner !== branch || !dueAtEnd(brief)) continue;
    try {
      const out = execFileSync("node", [RETIRE, path, "--memory-dir", memoryDir], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      retired.push({ title: brief.title, path, why: brief.throwaway ? "throwaway" : "nothing live", out: out.trim() });
    } catch { /* left registered: the SessionStart digest still offers it */ }
  }
  if (!retired.length) return;

  const file = endedFile(memoryDir);
  let log = [];
  try { log = JSON.parse(readFileSync(file, "utf8")); } catch { /* first one */ }
  log.push({ session: input.session_id ?? null, branch, at: new Date().toISOString().slice(0, 16) + "Z", retired });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(log, null, 2), "utf8");
  console.log(retired.map((r) => r.out).join("\n"));
}

if (process.argv.includes("--hook")) {
  try { hook(); } catch { /* never break a session */ }
  process.exit(0);
}
