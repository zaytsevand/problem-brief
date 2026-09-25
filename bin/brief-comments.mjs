#!/usr/bin/env node
/**
 * Make sure what the operator says about a brief gets recorded in it.
 *
 *   node brief-comments.mjs --hook                         run as a Claude Code hook (see below)
 *   node brief-comments.mjs --no-ruling URL THREAD [note]  mark a thread as read and holding nothing to record
 *
 * Answers reach a session by two routes, and both lose them:
 *
 *   A comment on the published page. It is answered automatically, through
 *   the ArtifactComments tool, before the session sees anything. The session is
 *   then woken by a notification that names the page and the thread but does
 *   not carry the comment. Unless the session reads the thread, the answer in
 *   it is replied to and never recorded.
 *
 *   A message in chat that rules on an entry by its id ("Q-3: go with the
 *   second option"). It is read, acted on, and dropped when the session is
 *   summarised.
 *
 * As a hook this script handles three events:
 *
 *   UserPromptSubmit              a comment notification for a brief's page, or a
 *                                 message citing a brief's ids, gets a reminder with
 *                                 the brief's path and the cited items' current state.
 *   PostToolUse ArtifactComments  reading a brief's comments notes when it was read.
 *   PreToolUse  ArtifactComments  resolving a brief's thread is refused until the
 *                                 brief's JSON has been saved since the thread was
 *                                 read, or the thread is marked as holding nothing
 *                                 to record (--no-ruling).
 *
 * A hook must never break a session, so in hook mode every failure is silent,
 * and a failure never blocks anything.
 *
 * Zero dependencies. Node 18+.
 */

import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { briefsFor, memoryDirOf, stateHome } from "./brief-context.mjs";

const PAGE = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]+/g;
const CITED = /(?:\b([A-Za-z0-9][A-Za-z0-9._#-]*)\/)?\b([QR]-\d+)\b/g;
const SELF = fileURLToPath(import.meta.url);

const clip = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

/* ── what has been read, and what was checked ────────────────────────────── */

const threadsFile = () => join(stateHome(), "threads.json");
function loadThreads() {
  try { return JSON.parse(readFileSync(threadsFile(), "utf8")); } catch { return {}; }
}
function saveThreads(t) {
  mkdirSync(stateHome(), { recursive: true });
  writeFileSync(threadsFile(), JSON.stringify(t, null, 2), "utf8");
}

const byUrl = (briefs, url) => briefs.find((b) => b.urls.has(url));

/* ── the reminders ───────────────────────────────────────────────────────── */

const fid = (brief, id) => (brief.binding?.ref ? `${brief.binding.ref}/${id}` : id);

function itemState(brief, id) {
  if (id.startsWith("R-")) {
    const r = (brief.rulings ?? []).find((x) => x.id === id);
    return r && `${fid(brief, id)} (standing ruling, ${r.status ?? "active"}): ${clip(r.about, 90)} → ${clip(r.said, 90)}`;
  }
  const e = (brief.decisions ?? []).find((x) => x.id === id);
  if (!e) return null;
  const st = e.status ?? "open";
  const bearing = st === "open" && e.bearing ? `, ${e.bearing === "blocks-goal" ? "blocks the goal" : "escalated"}` : "";
  return `${fid(brief, id)} (${clip(e.short ?? e.title, 60)}): ${st}${bearing}`;
}

function onPrompt(input, briefs) {
  const prompt = String(input.prompt ?? "");
  const notes = [];

  const isComment = /artifact-auto-react|comment thread/i.test(prompt);
  if (isComment) {
    const threads = [...new Set(prompt.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g) ?? [])];
    for (const url of new Set(prompt.match(PAGE) ?? [])) {
      const b = byUrl(briefs, url);
      if (!b) continue;
      notes.push(`A comment on the problem brief "${b.brief.title}" was answered automatically. The automatic reply is not a record. ` +
        `Read the thread${threads.length ? ` (${threads.join(", ")})` : ""} with ArtifactComments action "read", then record any ` +
        `ruling, answer or judgement in ${b.path} in this turn: a decision on the entry it settles, or a standing ruling. ` +
        `Republish, then resolve the thread. Resolving is refused until the brief has been saved since the thread was read; ` +
        `if the thread holds nothing to record, say why with: node "${SELF}" --no-ruling ${url} <thread> "<why>".`);
    }
  }

  /* A prefixed id names its brief. A bare one could be on any brief of this
     project; when it is on more than one, say so rather than guess. */
  const cites = [...prompt.matchAll(CITED)].map((m) => ({ pre: m[1], id: m[2] }));
  if (cites.length && !isComment) {
    const bare = new Map();
    for (const b of briefs) {
      const ref = b.brief.binding?.ref;
      const mine = [...new Set(cites.filter((c) => (c.pre ? c.pre === ref : true)).map((c) => c.id))];
      const found = mine.map((id) => itemState(b.brief, id)).filter(Boolean);
      for (const c of cites) if (!c.pre && itemState(b.brief, c.id)) bare.set(c.id, [...(bare.get(c.id) ?? []), b]);
      if (!found.length) continue;
      notes.push(`This message cites items on the problem brief "${b.brief.title}" (${b.path}):\n` +
        found.map((f) => `- ${f}`).join("\n") +
        `\nIf it rules on, answers or changes any of them, record that in the brief in this turn — a decision, a status, ` +
        `or a standing ruling — before anything else.`);
    }
    for (const [id, on] of bare) {
      if (on.length < 2) continue;
      notes.push(`${id} is on more than one brief: ${on.map((b) => `"${b.brief.title}"${b.brief.binding ? ` (${fid(b.brief, id)})` : ""}`).join(", ")}. ` +
        `Work out which one the operator means before recording anything, and cite it with its prefix from now on.`);
    }
  }
  return notes;
}

/* ── the hook ────────────────────────────────────────────────────────────── */

function hook() {
  let input = {};
  try { input = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { return; }
  const event = input.hook_event_name;
  const briefs = briefsFor(memoryDirOf(input));
  if (!briefs.length) return;

  if (event === "UserPromptSubmit") {
    const notes = onPrompt(input, briefs);
    if (notes.length) say("UserPromptSubmit", notes.join("\n\n"));
    return;
  }

  if (input.tool_name !== "ArtifactComments") return;
  const t = input.tool_input ?? {};
  const b = t.url && byUrl(briefs, t.url);
  if (!b) return;
  const threads = loadThreads();
  const page = (threads[t.url] ??= { read: {}, checked: {} });

  if (event === "PostToolUse" && t.action === "read") {
    page.read[t.thread_id ?? "*"] = Date.now();
    saveThreads(threads);
    say("PostToolUse", `These comments are on the problem brief "${b.brief.title}". Record any ruling, answer or judgement ` +
      `they hold in ${b.path} before resolving a thread — resolving is refused until the brief has been saved since this read.`);
    return;
  }

  if (event === "PreToolUse" && t.action === "resolve" && t.thread_id) {
    if (page.checked[t.thread_id]) return;
    const readAt = page.read[t.thread_id] ?? page.read["*"];
    const why = !readAt
      ? `Read this thread first (ArtifactComments action "read"): it is on the problem brief "${b.brief.title}", and what it says has to be recorded in ${b.path} before it is resolved.`
      : statSync(b.path).mtimeMs > readAt
        ? null
        : `The problem brief "${b.brief.title}" has not been saved since this thread was read. Record the ruling, answer or ` +
          `judgement it holds in ${b.path} (a decision on the entry, or a standing ruling), then resolve.`;
    if (!why) return;
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `${why} If the thread holds nothing to record, say why with: node "${SELF}" --no-ruling ${t.url} ${t.thread_id} "<why>"`,
      },
    }));
  }
}

function say(event, text) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }));
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args[0] === "--hook") {
    try { hook(); } catch { /* never break a session */ }
    process.exit(0);
  }
  if (args[0] === "--no-ruling" && args[1] && args[2]) {
    const threads = loadThreads();
    const page = (threads[args[1]] ??= { read: {}, checked: {} });
    page.checked[args[2]] = { at: new Date().toISOString(), note: args[3] ?? "" };
    saveThreads(threads);
    console.log(`thread ${args[2]} marked as holding nothing to record${args[3] ? `: ${args[3]}` : ""}`);
    process.exit(0);
  }
  console.error("usage: brief-comments.mjs --hook | --no-ruling <url> <thread> [why]");
  process.exit(2);
}
