#!/usr/bin/env node
/**
 * Delete a decision the operator withdrew as wrong from the start.
 *
 *   node brief-withdraw.mjs brief.json Q-3 R-2 … [--dry-run]
 *
 * Retracting (superseded) keeps an entry on the page, where every later session
 * reads it as ground to build on. Withdrawing deletes it. This script does the
 * part that needs no judgement:
 *
 *   - deletes the named entries and rulings
 *   - deletes the outstanding items blocked on them
 *   - deletes every change note, current or in history, that cites them, and
 *     any history block left with no notes
 *   - makes a ruling active again where a withdrawn ruling had replaced it
 *   - lists the ids in withdrawnIds, so the numbers are never issued again,
 *     and moves the brief's updated stamp
 *
 * Then it runs the validator and prints every citation still left: prose that
 * leans on the withdrawn decision has to be rewritten or removed by hand.
 * --dry-run prints what would be deleted, to name it to the operator first.
 *
 * Zero dependencies. Node 18+.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ownCitations, validateBrief } from "./validate-brief.mjs";

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const [file, ...ids] = args.filter((a) => a !== "--dry-run");
if (!file || !ids.length) {
  console.error("usage: brief-withdraw.mjs <brief.json> <Q-n|R-n>… [--dry-run]");
  process.exit(2);
}

const path = resolve(file);
const brief = JSON.parse(readFileSync(path, "utf8"));
const gone = new Set(ids);
const known = new Set([...(brief.decisions ?? []), ...(brief.rulings ?? [])].map((x) => x?.id));
const unknown = ids.filter((id) => !known.has(id));
if (unknown.length) {
  console.error(`${unknown.join(", ")} ${unknown.length === 1 ? "is" : "are"} not an entry or ruling in ${file}`);
  process.exit(1);
}

const cites = (v) => ownCitations(JSON.stringify(v), brief).some((id) => gone.has(id));
const deleted = [], restored = [];
const drop = (list, keep, one, many = `${one}s`) => {
  const kept = (list ?? []).filter(keep);
  const n = (list ?? []).length - kept.length;
  if (n) deleted.push(`${n} ${n === 1 ? one : many}`);
  return kept;
};

const now = new Date().toISOString().slice(0, 16) + "Z";
const out = { ...brief };
out.decisions = drop(brief.decisions, (e) => !gone.has(e?.id), "entry", "entries");
if (brief.rulings) {
  out.rulings = drop(brief.rulings, (r) => !gone.has(r?.id), "ruling").map((r) => {
    if (!gone.has(r?.replacedBy)) return r;
    restored.push(`${r.id} (it had been replaced by ${r.replacedBy})`);
    const { replacedBy, ...rest } = r;
    return { ...rest, status: "active", ...(r.updated && { updated: now }) };
  });
}
if (brief.outstanding) out.outstanding = drop(brief.outstanding, (o) => !gone.has(o?.blockedBy), "outstanding item");
if (brief.changes) out.changes = drop(brief.changes, (c) => !cites(c), "change note");
if (brief.history) {
  out.history = brief.history
    .map((h) => ({ ...h, changes: drop(h.changes, (c) => !cites(c), `note in history ${h.version}`, `notes in history ${h.version}`) }))
    .filter((h) => h.changes.length);
}
out.withdrawnIds = [...new Set([...(brief.withdrawnIds ?? []), ...ids])];
out.updated = now;

console.log(`${dry ? "would withdraw" : "withdrew"} ${ids.join(", ")} from "${brief.title}"`);
for (const d of deleted) console.log(`  ${dry ? "would delete" : "deleted"} ${d}`);
for (const r of restored) console.log(`  ${dry ? "would make" : "made"} ${r} active again`);
if (!dry) writeFileSync(path, JSON.stringify(out, null, 2) + "\n", "utf8");

const left = validateBrief(out).errors.filter((e) => e.message.includes("withdrawn"));
if (left.length) {
  console.log("  still citing a withdrawn id — rewrite or remove each, then validate:");
  for (const e of left) console.log(`    ${e.path} ${e.message}`);
}
