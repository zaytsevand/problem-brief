// Run with: node --test test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateBrief } from "../bin/validate-brief.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLE = join(ROOT, "examples", "example.brief.json");
const example = () => JSON.parse(readFileSync(EXAMPLE, "utf8"));

const T = "2026-09-15T10:00Z";
const option = { id: "a", label: "Do it", recommended: true, summary: "Deduplicate on the invoice number before posting.", cost: { work: "An hour." } };
const entry = (id, extra = {}) => ({
  id, created: T, updated: T, title: `Entry ${id}`,
  problem: "The importer posts invoices twice when retried.", brief: "Duplicate postings reach the ledger and have to be reversed by hand, which nobody notices for days.",
  evidence: [{ kind: "code", ref: "a.py:1", note: "Shows it." }],
  solutions: [option], ...extra,
});
const brief = (decisions, extra = {}) => ({
  title: "Test brief", subject: "A brief used by the tests.", created: T, updated: T,
  goal: "Ship the importer.", decisions, ...extra,
});
const messages = (b) => {
  const r = validateBrief(b);
  return { ok: r.ok, errors: r.errors.map((e) => `${e.path} ${e.message}`), warnings: r.warnings.map((e) => `${e.path} ${e.message}`) };
};

function render(b) {
  const dir = mkdtempSync(join(tmpdir(), "brief-"));
  const src = join(dir, "b.json"), out = join(dir, "b.html");
  writeFileSync(src, JSON.stringify(b));
  execFileSync("node", [join(ROOT, "bin", "render-brief.mjs"), src, out], { stdio: "pipe" });
  return readFileSync(out, "utf8");
}

/* ── issue #5: bearing on the goal ─────────────────────────────────────── */

test("the bundled example is valid", () => {
  const r = messages(example());
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test("a goal with one blocker and two escalated entries validates", () => {
  const b = brief([
    entry("Q-1", { bearing: "blocks-goal", bearingReason: "The importer cannot post without it." }),
    entry("Q-2", { bearing: "escalated", bearingReason: "Only affects the export, not the import." }),
    entry("Q-3", { bearing: "escalated", bearingReason: "A housekeeping question." }),
  ]);
  assert.deepEqual(messages(b).errors, []);
});

test("an open entry with no bearing is refused", () => {
  const r = messages(brief([entry("Q-1")]));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((m) => m.includes("Q-1") && m.includes("bearing")), r.errors.join("\n"));
});

test("a ruled entry not yet carried out needs a bearing too", () => {
  const r = messages(brief([entry("Q-1", { status: "decided", decision: { chose: "a", date: "2026-09-15" } })]));
  assert.ok(r.errors.some((m) => m.includes("Q-1") && m.includes("bearing")), r.errors.join("\n"));
});

test("a bearing with no reason is refused", () => {
  for (const bearing of ["blocks-goal", "escalated"]) {
    const r = messages(brief([entry("Q-1", { bearing })]));
    assert.ok(r.errors.some((m) => m.includes("bearingReason")), `${bearing}: ${r.errors.join("\n")}`);
  }
});

test("a blocker on a brief with no goal is refused", () => {
  const b = brief([entry("Q-1", { bearing: "blocks-goal", bearingReason: "Needed." })]);
  delete b.goal;
  assert.ok(messages(b).errors.some((m) => m.includes("goal")));
});

test("a closed entry does not need a bearing", () => {
  const b = brief([entry("Q-1", { status: "superseded" })]);
  assert.deepEqual(messages(b).errors, []);
});

test("the page opens on the blockers, and escalated entries have their own filter", () => {
  const html = render(brief([
    entry("Q-1", { bearing: "blocks-goal", bearingReason: "Needed to post." }),
    entry("Q-2", { bearing: "escalated", bearingReason: "Export only." }),
    entry("Q-3", { bearing: "escalated", bearingReason: "Housekeeping." }),
  ]));
  assert.match(html, /data-filter="blocks"[^>]*>\s*<span class="chip-n">1<\/span> block the goal/);
  assert.match(html, /data-filter="escalated"[^>]*>\s*<span class="chip-n">2<\/span> escalated, not blocking/);
  assert.match(html, /id="Q-1" data-state="blocks"/);
  assert.match(html, /id="Q-2" data-state="escalated"/);
  assert.match(html, /apply\(saved \|\| DEFAULT_FILTER/);
  assert.match(html, /var DEFAULT_FILTER = 'blocks'/);
  assert.match(html, /class="goal"[^]*Ship the importer\./);
  assert.match(html, /Escalated, not blocking<\/span>Export only\./);
});

/* ── the header: stamps only, structured summary ───────────────────────── */

test("the grey line carries the two stamps and nothing else", () => {
  const html = render(brief([entry("Q-1", { bearing: "escalated", bearingReason: "Later." })], {
    created: "2026-09-11T12:29Z", updated: T, source: "the nine-advisor review",
  }));
  const line = html.match(/<p class="provenance">([^]*?)<\/p>/)[1];
  assert.ok(line.includes("written") && line.includes("updated"), line);
  assert.ok(!line.includes("nine-advisor"), "source must not share the stamp line");
  assert.ok(!line.includes("re-checked"), line);
});

test("generated is retired: its re-check moves updated instead", () => {
  const r = messages(brief([entry("Q-1", { bearing: "escalated", bearingReason: "Later." })], { generated: "2026-09-15" }));
  assert.ok(r.warnings.some((m) => m.includes("generated")), r.warnings.join("\n"));
});

test("the summary renders as lists: what changed, and what waits on the reader", () => {
  const html = render(brief([
    entry("Q-1", { short: "posting to the ledger", bearing: "blocks-goal", bearingReason: "Needed to post." }),
    entry("Q-2", { short: "export format", bearing: "escalated", bearingReason: "Export only." }),
  ], {
    changes: ["Q-1 raised.", "Q-2: open → decided, then reopened."],
    background: "Nine reviewers read the code on 11 September.",
    source: "the nine-advisor review",
  }));
  const top = html.match(/<header class="top">([^]*?)<\/header>/)[1];
  assert.match(top, /<h2>Since the last version<\/h2><ul><li>/);
  assert.match(top, /<h2>Waiting on you<\/h2>/);
  assert.match(top, /Blocks the goal[^]*href="#Q-1"[^]*posting to the ledger/);
  assert.match(top, /Escalated, not blocking[^]*href="#Q-2"[^]*export format/);
  assert.match(top, /<details class="background"><summary>Background<\/summary>[^]*nine-advisor review/);
});

test("entry ids in prose become links carrying their short label", () => {
  const html = render(brief([
    entry("Q-1", { short: "posting to the ledger", bearing: "blocks-goal", bearingReason: "Needed." }),
    entry("Q-2", { bearing: "escalated", bearingReason: "See Q-1 first." }),
  ]));
  assert.match(html, /See <a class="qref" href="#Q-1"[^>]*>Q-1 \(posting to the ledger\)<\/a> first\./);
});

test("a cited id that does not exist is flagged", () => {
  const b = brief([entry("Q-1", { bearing: "escalated", bearingReason: "Depends on Q-9." })]);
  assert.ok(messages(b).warnings.some((m) => m.includes("Q-9")));
});

test("a paragraph followed by a list renders both", () => {
  const html = render(brief([entry("Q-1", {
    bearing: "escalated", bearingReason: "Later.",
    brief: "Three things break when it happens:\n- the import\n- the export\n- the report",
  })]));
  assert.match(html, /<p>Three things break when it happens:<\/p><ul><li>the import<\/li><li>the export<\/li><li>the report<\/li><\/ul>/);
});

test("with a goal and no blocker, the page says nothing blocks it", () => {
  const html = render(brief([entry("Q-1", { bearing: "escalated", bearingReason: "Export only." })]));
  const top = html.match(/<header class="top">([^]*?)<\/header>/)[1];
  assert.match(top, /Nothing blocks the goal\./);
  assert.match(html, /var DEFAULT_FILTER = 'escalated'/);
});

test("ruled-but-not-carried-out entries are outstanding work, under one filter", () => {
  const b = brief([
    entry("Q-1", { bearing: "escalated", bearingReason: "Export only." }),
    entry("Q-2", { status: "decided", decision: { chose: "a", date: "2026-09-15" },
      bearing: "blocks-goal", bearingReason: "Posting needs it." }),
  ], { outstanding: [
    { summary: "Write the retry test.", state: "not-started", created: T, updated: T },
    { summary: "Rename the column.", state: "done", created: T, updated: T },
  ] });
  const html = render(b);
  assert.doesNotMatch(html, /data-filter="decided"/);
  assert.match(html, /data-filter="outstanding"[^>]*>\s*<span class="chip-n">2<\/span> outstanding work/);
  assert.match(html, /id="Q-2" data-state="decided"/);
  assert.match(html, /<span class="chip chip-decided chip-static">Outstanding work<\/span>/);
  assert.doesNotMatch(html, /On the goal's path:/);
});

test("a superseded entry reads as retracted", () => {
  const html = render(brief([
    entry("Q-1", { bearing: "escalated", bearingReason: "Export only." }),
    entry("Q-2", { status: "superseded" }),
  ]));
  assert.match(html, /data-filter="superseded"[^>]*>\s*<span class="chip-n">1<\/span> retracted/);
  assert.match(html, /<span class="chip chip-superseded chip-static">Retracted<\/span>/);
  assert.doesNotMatch(html, /no longer live/i);
});
