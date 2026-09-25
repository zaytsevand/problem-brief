#!/usr/bin/env node
/**
 * Put what the operator has already ruled back in front of the session.
 *
 *   node brief-context.mjs brief.json          print the digest of one brief
 *   node brief-context.mjs --hook              run as a Claude Code SessionStart hook
 *
 * A long session is summarised, and the answers given in it drop out of view.
 * This prints the part of a brief a session must not lose: the goal, every
 * standing ruling, every entry still live, and the ids of the closed ones, so
 * nothing already settled is raised again.
 *
 * As a hook it runs at startup, resume, clear and — the case that matters most —
 * straight after the conversation has been summarised. It finds the briefs for
 * the current project through Claude Code's own memory: each brief has a
 * pointer file in the project's memory directory (written by brief-memory.mjs),
 * and that directory sits beside the session transcript the hook is handed.
 *
 * A hook must never break a session, so in hook mode every failure is silent.
 *
 * Zero dependencies. Node 18+.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_RULINGS = 30;
const MAX_TEXT = 220;
const MAX_CHARS = 9000;

const clip = (s, n = MAX_TEXT) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

const LIVE_LABEL = {
  "blocks-goal": "blocks the goal",
  escalated: "escalated, not blocking",
};

export function digest(brief, { path, url } = {}) {
  const lines = [];
  lines.push(`Problem brief "${brief.title}"` + (path ? ` — ${path}` : ""));
  if (url || brief.url) lines.push(`Published at ${url || brief.url}`);
  if (brief.goal) lines.push(`Goal: ${clip(brief.goal)}`);
  lines.push("Before raising a problem or asking a question on this subject, check it against the rulings and " +
    "entries below. Record any new answer in the brief's JSON in the same turn it is given.");

  const rulings = (brief.rulings ?? []).filter((r) => (r.status ?? "active") === "active");
  if (rulings.length) {
    lines.push("", "Standing rulings (already answered — do not ask again):");
    for (const r of rulings.slice(-MAX_RULINGS).reverse()) {
      lines.push(`- ${r.id} (${String(r.created).slice(0, 10)}) ${clip(r.about, 140)} → ${clip(r.said)}`);
    }
    if (rulings.length > MAX_RULINGS) lines.push(`- …and ${rulings.length - MAX_RULINGS} older rulings in the file`);
  }

  const entries = brief.decisions ?? [];
  const live = entries.filter((e) => ["open", "decided"].includes(e.status ?? "open"));
  if (live.length) {
    lines.push("", "Live entries:");
    for (const e of live) {
      const st = e.status ?? "open";
      const chose = st === "decided"
        ? `ruled "${clip((e.solutions ?? []).find((s) => s.id === e.decision?.chose)?.label ?? e.decision?.chose, 80)}", not yet carried out`
        : `awaiting a ruling, ${LIVE_LABEL[e.bearing] ?? "not yet bracketed"}`;
      lines.push(`- ${e.id} ${clip(e.short ?? e.title, 90)} — ${chose}`);
    }
  }

  const closed = entries.filter((e) => ["complete", "superseded"].includes(e.status));
  if (closed.length) {
    lines.push("", "Closed (settled — reopen the same id only on new evidence, never raise again): " +
      closed.map((e) => `${e.id} ${clip(e.short ?? e.title, 50)}`).join("; "));
  }
  return lines.join("\n");
}

/* Pointer files are ordinary Claude Code memory files whose metadata names a
   brief. Read just enough of the frontmatter to find it. */
function pointers(memoryDir) {
  if (!existsSync(memoryDir)) return [];
  return readdirSync(memoryDir)
    .filter((f) => f.startsWith("problem-brief-") && f.endsWith(".md"))
    .map((f) => {
      const text = readFileSync(join(memoryDir, f), "utf8");
      const front = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
      const field = (k) => {
        const v = front.match(new RegExp(`^\\s+${k}:\\s*(.+)$`, "m"))?.[1]?.trim();
        if (!v || !v.startsWith('"')) return v;
        try { return JSON.parse(v); } catch { return v.slice(1, -1); }
      };
      return { file: f, brief: field("brief"), url: field("url") };
    })
    .filter((p) => p.brief);
}

function hook() {
  let input = {};
  try { input = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { /* no input */ }
  const memoryDir = input.transcript_path ? join(dirname(input.transcript_path), "memory") : null;
  if (!memoryDir) return;

  const parts = [];
  for (const p of pointers(memoryDir)) {
    try {
      const brief = JSON.parse(readFileSync(p.brief, "utf8"));
      parts.push(digest(brief, { path: p.brief, url: p.url }));
    } catch {
      parts.push(`Problem brief pointer ${p.file} names ${p.brief}, which cannot be read.` +
        (p.url ? ` Recover it from ${p.url} with the problem-brief skill's extract-brief.mjs before raising anything on its subject.` : ""));
    }
  }
  if (!parts.length) return;

  let text = parts.join("\n\n");
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + "\n…(cut — read the brief's JSON for the rest)";
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text },
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--hook")) {
    try { hook(); } catch { /* never break a session */ }
    process.exit(0);
  }
  const file = process.argv[2];
  if (!file) {
    console.error("usage: brief-context.mjs <brief.json> | --hook");
    process.exit(2);
  }
  const brief = JSON.parse(readFileSync(file, "utf8"));
  console.log(digest(brief, { path: resolve(file) }));
}
