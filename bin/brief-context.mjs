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
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MAX_RULINGS = 30;
const MAX_TEXT = 220;
const MAX_CHARS = 9000;

/* Where the hooks keep what they learn between calls: snapshots of each
   published brief, which page belongs to which brief, which comment threads
   were read. */
export const stateHome = () => process.env.PROBLEM_BRIEF_HOME || join(homedir(), ".claude", "problem-brief");

/* The one line every session gets, whether or not a brief exists yet. An
   instruction given once in chat fades in a long session and is gone after a
   summary; this comes back at every start and after every summary. */
export const REMINDER = "problem-brief: findings, open decisions and questions for the operator go into a problem brief " +
  "(the problem-brief skill) by default, not only when the operator asks for one. Chat carries the short summary of " +
  "what moved and the link. Record every answer or judgement in the brief in the turn it is given, including answers " +
  "given in comments on the published page. AskUserQuestion only when the work cannot go on without the answer now.";

const clip = (s, n = MAX_TEXT) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

const LIVE_LABEL = {
  "blocks-goal": "blocks the goal",
  escalated: "escalated, not blocking",
};

const RETIRE = join(dirname(fileURLToPath(import.meta.url)), "brief-retire.mjs");

/* Nothing waits on the reader, and no agreed work is left: the brief has done
   its job. Its full digest would only cost every session tokens. */
export const finished = (brief) =>
  !(brief.decisions ?? []).some((e) => ["open", "decided"].includes(e.status ?? "open")) &&
  !(brief.outstanding ?? []).some((o) => (o.state ?? "not-started") !== "done");

export function digest(brief, { path, url, memoryDir, pages = [] } = {}) {
  /* A throwaway brief is never worth its full digest. What a session needs to
     know is that it is still around, and where it is published, so the
     cleanup is offered until it is done. */
  if (brief.throwaway) {
    const where = [...new Set([url, brief.url, ...pages].filter(Boolean))];
    return `Throwaway brief "${brief.title}"${path ? ` — ${path}` : ""} is still registered` +
      (where.length ? `, published at ${where.join(", ")}` : "") + `. If the test it was made for is over, offer the operator ` +
      `to clean it up: retire it (node "${RETIRE}" "${path ?? "<brief.json>"}" --memory-dir "${memoryDir ?? "<memory directory>"}") ` +
      `and, on their yes, delete ${where.length === 1 ? "its page" : "its pages"} with the Artifact tool's delete action.`;
  }
  if (finished(brief)) {
    const rulings = (brief.rulings ?? []).filter((r) => (r.status ?? "active") === "active").length;
    return `Problem brief "${brief.title}"${path ? ` — ${path}` : ""}: nothing live (${(brief.decisions ?? []).length} closed, ` +
      `${rulings} standing ruling${rulings === 1 ? "" : "s"}). If its work is finished, retire it, which takes it out of memory ` +
      `and these hooks: node "${RETIRE}" "${path ?? "<brief.json>"}" --memory-dir "${memoryDir ?? "<memory directory>"}". ` +
      `Ask the operator before deleting its published page.`;
  }
  const lines = [];
  lines.push(`Problem brief "${brief.title}"` + (path ? ` — ${path}` : ""));
  if (url || brief.url) lines.push(`Published at ${url || brief.url}`);
  if (brief.binding) lines.push(`Works under ${brief.binding.ref}${brief.binding.system ? ` (${brief.binding.system})` : ""}` +
    `${brief.binding.title ? `: ${clip(brief.binding.title, 100)}` : ""}. Cite its ids as ${brief.binding.ref}/Q-n and ${brief.binding.ref}/R-n.`);
  if (brief.goal) lines.push(`Goal: ${clip(brief.goal)}`);
  lines.push("Before raising a problem or asking a question on this subject, check it against the rulings and " +
    "entries below. Record any new answer in the brief's JSON in the same turn it is given.");

  const rulings = (brief.rulings ?? []).filter((r) => (r.status ?? "active") === "active");
  if (rulings.length) {
    lines.push("", "Standing rulings (already answered — do not ask again):");
    for (const r of rulings.slice(-MAX_RULINGS).reverse()) {
      lines.push(`- ${(brief.binding?.ref ? `${brief.binding.ref}/${r.id}` : r.id)} (${String(r.created).slice(0, 10)}) ${clip(r.about, 140)} → ${clip(r.said)}`);
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
      lines.push(`- ${(brief.binding?.ref ? `${brief.binding.ref}/${e.id}` : e.id)} ${clip(e.short ?? e.title, 90)} — ${chose}`);
    }
  }

  const closed = entries.filter((e) => ["complete", "superseded"].includes(e.status));
  if (closed.length) {
    lines.push("", "Closed (settled — reopen the same id only on new evidence, never raise again): " +
      closed.map((e) => `${(brief.binding?.ref ? `${brief.binding.ref}/${e.id}` : e.id)} ${clip(e.short ?? e.title, 50)}`).join("; "));
  }
  return lines.join("\n");
}

/* Pointer files are ordinary Claude Code memory files whose metadata names a
   brief. Read just enough of the frontmatter to find it. */
export function pointers(memoryDir) {
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

export const memoryDirOf = (input) => input?.transcript_path ? join(dirname(input.transcript_path), "memory") : null;

/* Every brief registered for this project, loaded, with where it lives and the
   addresses it is known to be published at. */
export function briefsFor(memoryDir) {
  if (!memoryDir) return [];
  let urls = {};
  try { urls = JSON.parse(readFileSync(join(stateHome(), "published", "urls.json"), "utf8")); } catch { /* none yet */ }
  const out = [];
  for (const p of pointers(memoryDir)) {
    try {
      const brief = JSON.parse(readFileSync(p.brief, "utf8"));
      const known = new Set([p.url, brief.url].filter(Boolean));
      for (const [u, created] of Object.entries(urls)) if (created === brief.created) known.add(u);
      out.push({ path: p.brief, brief, urls: known });
    } catch { /* unreadable briefs are reported by the SessionStart hook */ }
  }
  return out;
}

function hook() {
  let input = {};
  try { input = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { /* no input */ }
  const memoryDir = memoryDirOf(input);

  const parts = process.env.PROBLEM_BRIEF_REMINDER === "off" ? [] : [REMINDER];
  let published = {};
  try { published = JSON.parse(readFileSync(join(stateHome(), "published", "urls.json"), "utf8")); } catch { /* none yet */ }
  for (const p of memoryDir ? pointers(memoryDir) : []) {
    try {
      const brief = JSON.parse(readFileSync(p.brief, "utf8"));
      if (brief.retired) continue;
      const pages = Object.keys(published).filter((u) => published[u] === brief.created);
      parts.push(digest(brief, { path: p.brief, url: p.url, memoryDir, pages }));
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
