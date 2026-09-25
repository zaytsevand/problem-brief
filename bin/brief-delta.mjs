#!/usr/bin/env node
/**
 * The chat summary for a publish, computed rather than written.
 *
 *   node brief-delta.mjs old.json new.json     summary of what moved between two versions
 *   node brief-delta.mjs new.json              first publish: counts, and what waits on the reader
 *   node brief-delta.mjs --hook                run as a Claude Code PostToolUse hook on Artifact
 *
 * The summary after a publish is the one part the operator is sure to read, and
 * a written one drifts back into retelling the brief. This one can only say
 * what moved: entries raised, states changed, rulings recorded, work added or
 * done, then what now blocks the goal and what is escalated. Capped at 400 words.
 *
 * As a hook it runs after every Artifact publish. When the published page is a
 * problem brief (it carries its own data), it compares that data with what was
 * published last time — a snapshot kept under ~/.claude/problem-brief/published —
 * and hands the summary back to Claude to post. A hook must never break a
 * session, so in hook mode every failure is silent.
 *
 * Zero dependencies. Node 18+.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stateHome } from "./brief-context.mjs";

const MAX_WORDS = 400;

const clip = (s, n = 90) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};
const st = (e) => e?.status ?? "open";
const label = (e) => clip(e.short ?? e.title, 60);
const STATE = { open: "open", decided: "decided", complete: "complete", superseded: "retracted" };
const BEARING = { "blocks-goal": "blocks the goal", escalated: "escalated" };
/* An id as the reader cites it: under the brief's binding, when it has one. */
export const fullId = (brief, id) => (brief?.binding?.ref ? `${brief.binding.ref}/${id}` : id);

function closingLines(brief) {
  const F = (id) => fullId(brief, id);
  const live = (brief.decisions ?? []).filter((e) => st(e) === "open");
  /* Past a dozen, the ids alone say enough; the page carries the labels. */
  const named = (list) => list.length > 12
    ? `${list.slice(0, 12).map((e) => F(e.id)).join(", ")} and ${list.length - 12} more`
    : list.map((e) => `${F(e.id)} (${label(e)})`).join(", ");
  const of = (bearing) => live.filter((e) => e.bearing === bearing);
  const loose = live.filter((e) => !e.bearing);
  return [
    `Blocks the goal: ${named(of("blocks-goal")) || "nothing"}`,
    `Escalated, not blocking: ${named(of("escalated")) || "nothing"}`,
    ...(loose.length ? [`Awaiting a ruling, not yet bracketed: ${named(loose)}`] : []),
  ];
}

export function delta(prev, next) {
  const lines = [];
  const F = (id) => fullId(next, id);
  if (!prev) {
    const n = (k) => (next.decisions ?? []).filter((e) => st(e) === k).length;
    const counts = [["open", "awaiting a ruling"], ["decided", "ruled, not yet carried out"],
      ["complete", "complete"], ["superseded", "retracted"]].filter(([k]) => n(k)).map(([k, w]) => `${n(k)} ${w}`);
    const r = (next.rulings ?? []).filter((x) => (x.status ?? "active") === "active").length;
    lines.push(`First publish: ${counts.join(", ") || "no entries"}` + (r ? `; ${r} standing ruling${r === 1 ? "" : "s"}` : "") + ".");
    return finish(lines, next);
  }

  /* New entries lead, as they do in the page's own change list: a question the
     reader has not seen yet is never left at the bottom. */
  const raised = [];
  const before = new Map((prev.decisions ?? []).map((e) => [e.id, e]));
  for (const e of next.decisions ?? []) {
    const p = before.get(e.id);
    if (!p) {
      raised.push(`${F(e.id)} raised${e.bearing && st(e) === "open" ? ` (${BEARING[e.bearing]})` : ""}: ${label(e)}`);
      continue;
    }
    before.delete(e.id);
    if (st(p) !== st(e)) {
      const chose = st(e) === "decided" && e.decision?.chose
        ? ` (${clip((e.solutions ?? []).find((s) => s.id === e.decision.chose)?.label ?? e.decision.chose, 70)})` : "";
      const verb = st(e) === "open" && ["complete", "superseded", "decided"].includes(st(p)) ? " — reopened" : "";
      lines.push(`${F(e.id)}: ${STATE[st(p)]} → ${STATE[st(e)]}${chose}${verb} — ${label(e)}`);
    } else if (st(e) === "open" && p.bearing !== e.bearing && e.bearing) {
      lines.push(`${F(e.id)}: ${BEARING[p.bearing] ?? "unbracketed"} → ${BEARING[e.bearing]} — ${label(e)}`);
    }
  }
  for (const id of before.keys()) {
    lines.push(`${F(id)} is missing from this version — entries are never deleted; restore it and retract it instead`);
  }

  const oldRulings = new Map((prev.rulings ?? []).map((r) => [r.id, r]));
  for (const r of next.rulings ?? []) {
    const p = oldRulings.get(r.id);
    if (!p) lines.push(`${F(r.id)} recorded: ${clip(r.about, 70)} → ${clip(r.said, 70)}`);
    else if ((p.status ?? "active") !== (r.status ?? "active") && r.replacedBy) lines.push(`${F(r.id)} replaced by ${F(r.replacedBy)}`);
  }

  const oldMech = new Set((prev.mechanical ?? []).map((m) => m.summary));
  for (const m of next.mechanical ?? []) if (!oldMech.has(m.summary)) lines.push(`Handled without asking: ${clip(m.summary, 110)}`);

  const oldOut = new Map((prev.outstanding ?? []).map((o) => [o.summary, o]));
  for (const o of next.outstanding ?? []) {
    const p = oldOut.get(o.summary);
    if (!p) lines.push(`Outstanding work added: ${clip(o.summary, 100)}`);
    else if ((p.state ?? "not-started") !== (o.state ?? "not-started")) {
      lines.push(`Outstanding work ${(o.state ?? "not-started").replace("-", " ")}: ${clip(o.summary, 90)}`);
    }
  }

  lines.unshift(...raised);
  if (!lines.length) lines.push("Nothing moved since the last publish.");
  return finish(lines, next);
}

function finish(lines, brief) {
  const closing = closingLines(brief);
  /* Count words as they will be printed, bullet and all, and keep room for the
     line that says how many were left out. */
  const words = (l) => l.split(/\s+/).filter(Boolean).length;
  const budget = MAX_WORDS - closing.reduce((n, l) => n + words(l), 0) - words("- …and 999 more changes — see the page");
  const kept = [];
  let used = 0;
  for (const l of lines) {
    if (used + words(`- ${l}`) > budget) break;
    kept.push(l);
    used += words(`- ${l}`);
  }
  if (kept.length < lines.length) kept.push(`…and ${lines.length - kept.length} more changes — see the page`);
  return [...kept.map((l) => `- ${l}`), "", ...closing].join("\n");
}

/* ── the hook ────────────────────────────────────────────────────────────── */


export function embedded(html) {
  const m = html.match(/<script type="application\/json" id="problem-brief-data">([\s\S]*?)<\/script>/);
  return m ? JSON.parse(m[1]) : null;
}

function hook() {
  let input = {};
  try { input = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { return; }
  if (input.tool_name !== "Artifact") return;
  const t = input.tool_input ?? {};
  if ((t.action ?? "publish") !== "publish" || !t.file_path) return;

  const brief = embedded(readFileSync(resolve(input.cwd ?? ".", t.file_path), "utf8"));
  if (!brief?.created) return;

  const dir = join(stateHome(), "published");
  const key = createHash("sha1").update(String(brief.created)).digest("hex").slice(0, 16);
  const snap = join(dir, `${key}.json`);
  const prev = existsSync(snap) ? JSON.parse(readFileSync(snap, "utf8")) : null;
  const text = delta(prev, brief);
  mkdirSync(dir, { recursive: true });
  writeFileSync(snap, JSON.stringify(brief), "utf8");

  /* A comment notification names the page, not the brief. Remember which page
     belongs to which brief, so the comment hooks can find the brief's JSON. */
  const url = t.url ?? JSON.stringify(input.tool_response ?? "").match(/https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]+/)?.[0];
  if (url) {
    const index = join(dir, "urls.json");
    let urls = {};
    try { urls = JSON.parse(readFileSync(index, "utf8")); } catch { /* first one */ }
    urls[url] = brief.created;
    writeFileSync(index, JSON.stringify(urls, null, 2), "utf8");
  }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: `problem-brief: the chat summary for the publish you just made, computed from the brief's own data ` +
        `against the previous publish. Post it as your update, as it stands. Add only the page's link and the path of the ` +
        `brief's JSON, and a few words where a line needs them. Do not retell the brief.\n\n${text}`,
    },
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--hook")) {
    try { hook(); } catch { /* never break a session */ }
    process.exit(0);
  }
  const files = process.argv.slice(2);
  if (!files.length || files.length > 2) {
    console.error("usage: brief-delta.mjs [old.json] new.json | --hook");
    process.exit(2);
  }
  const load = (f) => {
    const text = readFileSync(f, "utf8");
    return f.endsWith(".html") ? embedded(text) : JSON.parse(text);
  };
  const [prev, next] = files.length === 2 ? files.map(load) : [null, load(files[0])];
  console.log(delta(prev, next));
}
