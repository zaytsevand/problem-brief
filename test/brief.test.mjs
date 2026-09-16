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
  assert.match(html, /<p class="bearing">Export only\.<\/p>/);
});

test("an entry card names its bearing once, in the header", () => {
  const html = render(brief([
    entry("Q-1", { bearing: "escalated", bearingReason: "Export only." }),
    entry("Q-2", { status: "decided", decision: { chose: "a", date: "2026-09-15" },
      bearing: "blocks-goal", bearingReason: "Needed to post." }),
  ]));
  const card = (id) => html.match(new RegExp(`<section class="entry[^"]*" id="${id}"[^]*?</header>([^]*?)(?=<section class="entry|$)`));
  const [q1, q1body] = [card("Q-1")[0], card("Q-1")[1]];
  assert.equal(q1.split("Escalated, not blocking").length - 1, 1, q1);
  assert.doesNotMatch(q1body, /Escalated, not blocking/);
  // A ruled entry's state chip says "Outstanding work", so its bearing joins it in the header.
  const [q2, q2body] = [card("Q-2")[0], card("Q-2")[1]];
  assert.match(q2.split("</header>")[0], /Outstanding work<\/span>[^]*Blocks the goal/);
  assert.doesNotMatch(q2body, /Blocks the goal/);
  assert.match(q2body, /<p class="bearing">Needed to post\.<\/p>/);
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
    changes: [{ kind: "raised", text: "Q-1 raised." }, { kind: "changed", text: "Q-2: open → decided, then reopened." }],
    background: "Nine reviewers read the code on 11 September.",
    source: "the nine-advisor review",
  }));
  const top = html.match(/<header class="top">([^]*?)<\/header>/)[1];
  assert.match(top, /<h2>Since the last version<\/h2><div class="tr">/);
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

/* ── changes: typed transitions, grouped and marked ────────────────────── */

test("changes are grouped by transition: changed, then closings, notes last", () => {
  const html = render(brief([
    entry("Q-1", { bearing: "escalated", bearingReason: "Export only." }),
  ], { changes: [
    { kind: "retracted", text: "Q-1 was overtaken." },
    "Most work is on local branches.",
    { kind: "completed", text: "The retry test landed." },
    { kind: "changed", text: "Q-1: open → decided." },
    { kind: "raised", text: "Q-1 raised." },
  ] }));
  const since = html.match(/<h2>Since the last version<\/h2>([^]*?)<\/section>/)[1];
  const order = [...since.matchAll(/data-kind="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ["changed", "completed", "retracted", "note"]);
  assert.match(html, /New since the last version[^]*class="tr-icon tr-raised"[^]*Since the last version/);
  for (const k of ["changed", "completed", "retracted"]) {
    assert.match(since, new RegExp(`data-kind="${k}"[^]*?<svg[^>]*class="tr-icon tr-${k}"`));
  }
  assert.match(since, /<h3[^>]*>Changed<span class="tr-n">1<\/span><\/h3>/);
  assert.match(since, /<h3[^>]*>Done<span class="tr-n">1<\/span><\/h3>/);
  assert.match(since, /<h3[^>]*>Retracted<span class="tr-n">1<\/span><\/h3>/);
});

test("an unknown transition kind is refused", () => {
  const r = messages(brief([entry("Q-1", { bearing: "escalated", bearingReason: "Export only." })],
    { changes: [{ kind: "moved", text: "Q-1 moved somewhere." }] }));
  assert.ok(r.errors.some((m) => m.includes("changes")), r.errors.join("\n"));
});

test("an untyped change is allowed but flagged", () => {
  const r = messages(brief([entry("Q-1", { bearing: "escalated", bearingReason: "Export only." })],
    { changes: ["Q-1 raised."] }));
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((m) => m.includes("changes[0]")), r.warnings.join("\n"));
});

test("a deliberate note is quiet and shown with the notes", () => {
  const b = brief([entry("Q-1", { bearing: "escalated", bearingReason: "Export only." })],
    { changes: [{ kind: "note", text: "Everything is on local branches." }, { kind: "raised", text: "Q-1 raised." }] });
  assert.deepEqual(messages(b).warnings, []);
  const since = render(b).match(/<h2>Since the last version<\/h2>([^]*?)<\/section>/)[1];
  assert.deepEqual([...since.matchAll(/data-kind="(\w+)"/g)].map((m) => m[1]), ["note"]);
});

/* ── new additions pinned to the top ───────────────────────────────────── */

test("new additions are pinned above everything, blockers first, then escalated, then other", () => {
  const html = render(brief([
    entry("Q-1", { short: "ledger posting", bearing: "escalated", bearingReason: "Export only." }),
    entry("Q-2", { short: "duplicate invoices", bearing: "blocks-goal", bearingReason: "Posting needs it." }),
    entry("Q-3", { status: "complete", resolution: { date: "2026-09-15", note: "Fixed in the importer." } }),
  ], { changes: [
    { kind: "completed", text: "Q-3 is done." },
    { kind: "raised", text: "Names can reach the logs.", id: "Q-1" },
    { kind: "raised", text: "New work: write the retry test." },
    { kind: "raised", text: "Q-2 raised: invoices post twice." },
  ] }));
  const top = html.match(/<div class="context">([^]*?)<\/header>/)[1];
  const first = top.match(/<section[^>]*>([^]*?)<\/section>/)[1];
  assert.match(first, /<h2>New since the last version<\/h2>/);
  const groups = [...first.matchAll(/data-bearing="([\w-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(groups, ["blocks-goal", "escalated", "other"]);
  assert.match(first, /data-bearing="blocks-goal"[^]*Q-2[^]*data-bearing="escalated"[^]*Names can reach the logs[^]*data-bearing="other"[^]*retry test/);
  const since = top.match(/<h2>Since the last version<\/h2>([^]*?)<\/section>/)[1];
  assert.doesNotMatch(since, /data-kind="raised"/);
  assert.ok(top.indexOf("New since the last version") < top.indexOf("Since the last version<"));
});

test("a raised change pointing at an unknown id is refused", () => {
  const r = messages(brief([entry("Q-1", { bearing: "escalated", bearingReason: "Export only." })],
    { changes: [{ kind: "raised", text: "Something new.", id: "Q-9" }] }));
  assert.ok(r.errors.some((m) => m.includes("Q-9")), r.errors.join("\n"));
});

/* ── done, with amendments to the ruling ───────────────────────────────── */

const ruled = { status: "complete", decision: { chose: "a", date: "2026-09-14" } };
const amendment = { ruled: "Deduplicate on the invoice number.", done: "Deduplicated on supplier and invoice number together.", why: "Two suppliers reuse invoice numbers." };

test("a completed entry can record amendments to its ruling, and they validate", () => {
  const b = brief([entry("Q-1", { ...ruled, resolution: { date: "2026-09-15", note: "Landed with a test.", amendments: [amendment] } })]);
  assert.deepEqual(messages(b).errors, []);
});

test("an amendment without its reason is refused", () => {
  const { why, ...noWhy } = amendment;
  const b = brief([entry("Q-1", { ...ruled, resolution: { date: "2026-09-15", note: "Landed.", amendments: [noWhy] } })]);
  assert.ok(messages(b).errors.some((m) => m.includes("why")), messages(b).errors.join("\n"));
});

test("the old free-text differs still works but asks to become an amendment", () => {
  const b = brief([entry("Q-1", { ...ruled, resolution: { date: "2026-09-15", note: "Landed.", differs: "Keyed on supplier too." } })]);
  const r = messages(b);
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((m) => m.includes("differs")), r.warnings.join("\n"));
});

test("an amended entry says so on its chip and inside the entry", () => {
  const html = render(brief([entry("Q-1", { ...ruled, resolution: { date: "2026-09-15", note: "Landed.", amendments: [amendment] } })]));
  assert.match(html, /<span class="chip chip-complete chip-amended chip-static">Complete · amended<\/span>/);
  const box = html.match(/<div class="amended">([^]*?)<\/div><\/div>/)?.[0] ?? "";
  assert.match(box, /Amended while carried out/);
  assert.match(box, /Ruled[^]*Deduplicate on the invoice number\./);
  assert.match(box, /Done instead[^]*supplier and invoice number together/);
  assert.match(box, /Why[^]*reuse invoice numbers/);
});

test("in the summary, a done item for an amended entry is marked and listed first", () => {
  const html = render(brief([
    entry("Q-1", { status: "complete", resolution: { date: "2026-09-15", note: "Landed as ruled." } }),
    entry("Q-2", { ...ruled, resolution: { date: "2026-09-15", note: "Landed.", amendments: [amendment] } }),
  ], { changes: [
    { kind: "completed", text: "Q-1 is done." },
    { kind: "completed", text: "Q-2 is done." },
  ] }));
  const done = html.match(/data-kind="completed"([^]*?)<\/div>/)[1];
  assert.match(done, /<li class="amended-item">[^]*tr-amended[^]*Q-2[^]*<span class="tag tag-amended">amended<\/span>[^]*<li>[^]*Q-1/);
});

test("an id cited twice in one passage carries its label only the first time", () => {
  const html = render(brief([
    entry("Q-1", { short: "ledger posting", bearing: "escalated", bearingReason: "Q-1 first, then Q-1 again." }),
  ]));
  assert.match(html, /Q-1 \(ledger posting\)<\/a> first, then <a class="qref" href="#Q-1"[^>]*>Q-1<\/a> again/);
});

test("an old differs note is shown as a remark, not as an amendment", () => {
  const html = render(brief([entry("Q-1", { ...ruled, resolution: { date: "2026-09-15", note: "Landed.", differs: "The comparison was not reported." } })]));
  assert.match(html, /Landed differently:<\/strong> The comparison was not reported\./);
  assert.doesNotMatch(html, /class="chip chip-complete chip-amended/);
});

test("a sentence that strings three or more entry ids together is flagged as a list", () => {
  const b = brief([
    entry("Q-1", { bearing: "escalated", bearingReason: "Export only." }),
    entry("Q-2", { bearing: "escalated", bearingReason: "Export only." }),
    entry("Q-3", { bearing: "escalated", bearingReason: "Export only." }),
  ], { context: "Three questions came in (Q-1, Q-2 and Q-3), all about the export." });
  const r = messages(b);
  assert.ok(r.warnings.some((m) => m.startsWith("context") && m.includes("list")), r.warnings.join("\n"));
  const ok = messages(brief([entry("Q-1", { bearing: "escalated", bearingReason: "See Q-1 and nothing else." })]));
  assert.ok(!ok.warnings.some((m) => m.includes("list")));
});
