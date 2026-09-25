// Run with: node --test test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateBrief } from "../bin/validate-brief.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLE = join(ROOT, "examples", "example.brief.json");
const example = () => JSON.parse(readFileSync(EXAMPLE, "utf8"));

const T = "2026-09-15T10:00Z";
const option = { id: "a", label: "Do it", recommended: true, reversible: true, summary: "Deduplicate on the invoice number before posting.", cost: { work: "One check before posting, and a test for it." } };
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
  // Issue #9: what asks the reader to act comes before the history.
  assert.ok(top.indexOf("<h2>Waiting on you</h2>") < top.indexOf("<h2>Since the last version</h2>"));
  assert.ok(top.indexOf("<h2>Since the last version</h2>") < top.indexOf('class="background"'));
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
  assert.match(since, /^<div class="tr"><div class="tr-group" data-bearing="escalated">[^]*?class="tr-icon tr-raised"/);
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
  const b = brief([entry("Q-1", { short: "ledger posting", bearing: "escalated", bearingReason: "Export only." })],
    { changes: [{ kind: "note", text: "Everything is on local branches." }, { kind: "raised", text: "Q-1 raised." }] });
  assert.deepEqual(messages(b).warnings, []);
  const since = render(b).match(/<h2>Since the last version<\/h2>([^]*?)<\/section>/)[1];
  assert.deepEqual([...since.matchAll(/data-kind="(\w+)"/g)].map((m) => m[1]), ["note"]);
  assert.ok(since.indexOf('data-bearing="other"') < since.indexOf('data-kind="note"'));
});

/* ── new additions pinned to the top ───────────────────────────────────── */

test("new additions lead the one change section, blockers first, then escalated, then other", () => {
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
  // Issue #9: one heading for the period, the new items pinned first inside it.
  assert.doesNotMatch(top, /New since the last version/);
  assert.equal([...top.matchAll(/<h2>Since the last version<\/h2>/g)].length, 1);
  const since = top.match(/<h2>Since the last version<\/h2>([^]*?)<\/section>/)[1];
  const groups = [...since.matchAll(/data-(bearing|kind)="([\w-]+)"/g)].map((m) => m[2]);
  assert.deepEqual(groups, ["blocks-goal", "escalated", "other", "completed"]);
  assert.match(since, /data-bearing="blocks-goal"[^]*Q-2[^]*data-bearing="escalated"[^]*Names can reach the logs[^]*data-bearing="other"[^]*retry test/);
  assert.match(since, /<h3[^>]*>New, blocking the goal<span class="tr-n">1<\/span><\/h3>/);
  assert.doesNotMatch(since, /data-kind="raised"/);
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

/* ── issue #8: earlier versions' change notes are kept ─────────────────── */

const V1 = "2026-09-13T09:00Z", V2 = "2026-09-14T09:00Z";
const withHistory = (extra = {}) => brief([
  entry("Q-1", { short: "ledger posting", bearing: "escalated", bearingReason: "Export only." }),
], {
  created: V1,
  changes: [{ kind: "changed", text: "Q-1: open → decided." }],
  history: [
    { version: V1, changes: [{ kind: "raised", text: "Q-1 raised.", id: "Q-1" }] },
    { version: V2, changes: [{ kind: "note", text: "Second pass over the importer." }] },
  ],
  ...extra,
});

test("earlier versions' change notes validate in history", () => {
  const r = messages(withHistory());
  assert.equal(r.ok, true, r.errors.join("\n"));
  assert.deepEqual(r.warnings, []);
});

test("history is checked like changes: kinds, ids, and its own stamps", () => {
  const bad = messages(withHistory({ history: [
    { version: V1, changes: [{ kind: "moved", text: "Q-1 moved." }] },
    { version: V2, changes: [{ kind: "raised", text: "Something new.", id: "Q-9" }] },
    { version: "2026-09-16T09:00Z", changes: [{ kind: "note", text: "From the future." }] },
    { version: V2, changes: [{ kind: "note", text: "Same stamp twice." }] },
  ] }));
  assert.equal(bad.ok, false);
  const has = (s) => assert.ok(bad.errors.some((m) => m.includes(s)), `${s}\n${bad.errors.join("\n")}`);
  has("history[0].changes[0]");
  has("Q-9");
  has("history[2]");
  has("history[3]");
  assert.equal(messages(withHistory({ history: [{ version: V1, changes: [] }] })).ok, false);
});

test("a brief without history renders no version switch", () => {
  const html = render(brief([entry("Q-1", { bearing: "escalated", bearingReason: "Export only." })],
    { changes: [{ kind: "changed", text: "Q-1: open → decided." }] }));
  assert.doesNotMatch(html, /data-changes-view/);
  assert.doesNotMatch(html, /class="version"/);
});

test("earlier versions render newest first under a latest / all switch, all in the document", () => {
  const html = render(withHistory());
  const since = html.match(/<section class="changes">([^]*?)<\/section>/)[1];
  assert.match(since, /<button[^>]*data-changes-view="latest"[^>]*aria-pressed="true"/);
  assert.match(since, /<button[^>]*data-changes-view="all"/);
  // Nothing is hidden in the markup, so a page with no scripting shows every version.
  const versions = [...since.matchAll(/<details class="version"( open)? data-version="([^"]+)"/g)];
  assert.deepEqual(versions.map((m) => m[2]), [V2, V1]);
  assert.deepEqual(versions.map((m) => Boolean(m[1])), [true, false], "only the newest earlier version starts open");
  assert.doesNotMatch(since, /<details class="version"[^>]*hidden/);
  assert.match(since, /data-version="2026-09-14T09:00Z"[^]*Second pass over the importer/);
  assert.match(since, /data-version="2026-09-13T09:00Z"[^]*<h3 class="tr-head">New<span class="tr-n">1<\/span>[^]*Q-1/);
  // The current version's notes still come first and are not inside a version block.
  assert.ok(since.indexOf("Q-1</a>: open → decided") < since.indexOf('class="version"'));
  assert.match(html, /problem-brief-changes/);
});

test("SKILL.md tells a refresh to move changes into history, never overwrite them", () => {
  const skill = readFileSync(join(ROOT, "SKILL.md"), "utf8");
  assert.match(skill, /`history`/);
  assert.match(skill, /move[^.]*`changes`[^.]*into `history`/i);
});

/* ── carried over from PR #4 ───────────────────────────────────────────── */

test("an entry with no short label is cited with a label cut from its title", () => {
  const html = render(brief([
    entry("Q-1", { title: "The importer posts invoices twice when the network drops mid-batch",
      bearing: "escalated", bearingReason: "Export only." }),
    entry("Q-2", { bearing: "escalated", bearingReason: "Depends on Q-1." }),
  ]));
  assert.match(html, /<a class="qref" href="#Q-1"[^>]*>Q-1 \(the importer posts invoices twice…\)<\/a>/);
});

test("a cited entry with no short label is flagged, with a suggestion", () => {
  const b = brief([
    entry("Q-1", { title: "Duplicate invoices reach the ledger", bearing: "escalated", bearingReason: "Export only." }),
    entry("Q-2", { short: "retry test", bearing: "escalated", bearingReason: "Depends on Q-1." }),
  ]);
  const r = messages(b);
  assert.ok(r.warnings.some((m) => m.includes("(Q-1)") && m.includes('no "short"')), r.warnings.join("\n"));
  const hint = validateBrief(b).warnings.find((w) => w.path.includes("(Q-1)")).hint;
  assert.match(hint, /"short": "duplicate invoices reach the ledger"/);
  assert.ok(!r.warnings.some((m) => m.includes("(Q-2)") && m.includes("no \"short\"")), r.warnings.join("\n"));
});

test("a short label longer than five words is flagged", () => {
  const r = messages(brief([entry("Q-1", { short: "a label that is far too long", bearing: "escalated", bearingReason: "Later." })]));
  assert.ok(r.warnings.some((m) => m.includes("short") && m.includes("five words")), r.warnings.join("\n"));
});

test("the validator CLI runs from a path with a space in it", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "brief ")), "with space");
  mkdirSync(join(dir, "bin"), { recursive: true });
  mkdirSync(join(dir, "schema"));
  cpSync(join(ROOT, "bin", "validate-brief.mjs"), join(dir, "bin", "validate-brief.mjs"));
  cpSync(join(ROOT, "schema", "problem-brief.schema.json"), join(dir, "schema", "problem-brief.schema.json"));
  const out = execFileSync("node", [join(dir, "bin", "validate-brief.mjs"), EXAMPLE], { encoding: "utf8" });
  assert.match(out, /is a valid problem brief/);
});

/* ── answered questions stay answered ──────────────────────────────────── */

const ruling = (id, extra = {}) => ({
  id, created: T, updated: T, source: "chat, 2026-09-15",
  about: "Should retried invoices be deduplicated before posting?",
  said: "Yes. Deduplicate on the invoice number, always.", ...extra,
});
const live = { bearing: "blocks-goal", bearingReason: "Posting is the goal." };
const distinct = (id, title, problem) => entry(id, { ...live, title, problem });

test("standing rulings validate, and a replaced one must name what replaced it", () => {
  assert.equal(messages(brief([entry("Q-1", live)], { rulings: [ruling("R-1")] })).ok, true);
  const r = messages(brief([entry("Q-1", live)], { rulings: [ruling("R-1", { status: "replaced" })] }));
  assert.ok(r.errors.some((m) => m.includes('missing "replacedBy"')));
});

test("a ruling pointing at another but still active is refused", () => {
  const r = messages(brief([entry("Q-1", live)], {
    rulings: [ruling("R-1", { replacedBy: "R-2" }), ruling("R-2", { about: "Something else entirely, about currencies." })],
  }));
  assert.ok(r.errors.some((m) => m.includes("still marked active")));
});

test("ruling ids are unique, and a ruling cited as evidence must exist", () => {
  const r = messages(brief([entry("Q-1", { ...live, evidence: [{ kind: "ruling", ref: "R-9", note: "The operator said so." }] })],
    { rulings: [ruling("R-1"), ruling("R-1")] }));
  assert.ok(r.errors.some((m) => m.includes('re-uses the id "R-1"')));
  assert.ok(r.errors.some((m) => m.includes('cites the ruling "R-9"')));
});

test("an entry that reads like an earlier one is flagged on the later one", () => {
  const r = messages(brief([
    distinct("Q-1", "Retried invoices are posted twice", "A retried import posts the same invoice to the ledger twice."),
    distinct("Q-7", "Invoices posted twice after a retry", "When the import is retried the same invoice is posted to the ledger twice."),
    distinct("Q-8", "The currency column is ignored", "Amounts in euros are read as pounds because the currency column is never parsed."),
  ]));
  assert.equal(r.warnings.filter((m) => m.includes("reads like")).length, 1);
  assert.ok(r.warnings.some((m) => m.startsWith("decisions (Q-7) reads like Q-1")));
});

test("an open entry a standing ruling already answers is flagged", () => {
  const q = distinct("Q-4", "Deduplicate retried invoices before posting?", "Retried invoices are posted twice; should they be deduplicated before posting?");
  const r = messages(brief([q], { rulings: [ruling("R-1")] }));
  assert.ok(r.warnings.some((m) => m.includes("may already be answered by R-1")));
  const linked = messages(brief([q], { rulings: [ruling("R-1", { entries: ["Q-4"] })] }));
  assert.ok(!linked.warnings.some((m) => m.includes("may already be answered")));
});

test("rulings get their own section and filter, and R- ids link to them", () => {
  const html = render(brief([entry("Q-1", { ...live, brief: "Settled in principle by R-1, but the mechanism is still open and needs a ruling." })],
    { rulings: [ruling("R-1")] }));
  assert.match(html, /data-filter="rulings"/);
  assert.match(html, /<li id="R-1" data-reveal="rulings">/);
  assert.match(html, /<a class="qref" href="#R-1"/);
});

test("the page carries its own data, and extract-brief recovers it exactly", () => {
  const b = brief([entry("Q-1", { ...live, problem: "A </script> in the text must not end the data block early." })],
    { rulings: [ruling("R-1")] });
  const html = render(b);
  const dir = mkdtempSync(join(tmpdir(), "brief-"));
  writeFileSync(join(dir, "p.html"), html);
  const got = JSON.parse(execFileSync("node", [join(ROOT, "bin", "extract-brief.mjs"), join(dir, "p.html")], { encoding: "utf8" }));
  assert.deepEqual(got, b);
});

/* ── Claude Code memory and the SessionStart hook ──────────────────────── */

const bin = (name) => join(ROOT, "bin", name);
const run = (name, args, input) => execFileSync("node", [bin(name), ...args], { encoding: "utf8", input });

test("the digest lists active rulings, live entries and closed ids — and leaves replaced rulings out", () => {
  const b = brief([entry("Q-1", { ...live, short: "retried invoices" }),
    entry("Q-2", { status: "superseded", short: "old currency bug" })],
  { rulings: [ruling("R-1", { status: "replaced", replacedBy: "R-2" }), ruling("R-2", { about: "Which currency do amounts default to?", said: "Pounds, always." })] });
  const dir = mkdtempSync(join(tmpdir(), "brief-"));
  writeFileSync(join(dir, "b.json"), JSON.stringify(b));
  const text = run("brief-context.mjs", [join(dir, "b.json")]);
  assert.match(text, /R-2 .*Which currency.*→ Pounds, always\./);
  assert.doesNotMatch(text, /R-1/);
  assert.match(text, /Q-1 retried invoices — awaiting a ruling, blocks the goal/);
  assert.match(text, /Closed .*Q-2 old currency bug/);
});

test("registering a brief writes one pointer and one index line, however often it runs", () => {
  const dir = mkdtempSync(join(tmpdir(), "brief-"));
  const mem = join(dir, "memory");
  writeFileSync(join(dir, "importer.brief.json"), JSON.stringify(brief([entry("Q-1", live)], { rulings: [ruling("R-1")] })));
  mkdirSync(mem);
  writeFileSync(join(mem, "MEMORY.md"), "- [Someone else](other.md) — keep me\n");
  for (let k = 0; k < 2; k++) run("brief-memory.mjs", [join(dir, "importer.brief.json"), "--memory-dir", mem, "--url", "https://example.test/a"]);
  const index = readFileSync(join(mem, "MEMORY.md"), "utf8").trim().split("\n");
  assert.equal(index.length, 2);
  assert.equal(index[0], "- [Someone else](other.md) — keep me");
  assert.match(index[1], /\(problem-brief-importer\.md\)/);
  const pointer = readFileSync(join(mem, "problem-brief-importer.md"), "utf8");
  assert.match(pointer, /^---\nname: problem-brief-importer\n/);
  assert.match(pointer, /type: project/);
});

test("the hook finds the project's briefs through the memory pointers beside the transcript", () => {
  const dir = mkdtempSync(join(tmpdir(), "brief-"));
  const mem = join(dir, "project", "memory");
  mkdirSync(mem, { recursive: true });
  writeFileSync(join(dir, "importer.brief.json"), JSON.stringify(brief([entry("Q-1", live)], { rulings: [ruling("R-1")] })));
  run("brief-memory.mjs", [join(dir, "importer.brief.json"), "--memory-dir", mem]);
  const out = JSON.parse(run("brief-context.mjs", ["--hook"], JSON.stringify({ transcript_path: join(dir, "project", "s.jsonl"), source: "compact" })));
  assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(out.hookSpecificOutput.additionalContext, /R-1 .*Deduplicate on the invoice number/);
});

test("the hook is silent when there is nothing to say, and never fails", () => {
  assert.equal(run("brief-context.mjs", ["--hook"], JSON.stringify({ transcript_path: "/nowhere/s.jsonl" })), "");
  assert.equal(run("brief-context.mjs", ["--hook"], "not json"), "");
});

test("installing the hook keeps every other hook, never duplicates, and removes cleanly", () => {
  const dir = mkdtempSync(join(tmpdir(), "brief-"));
  const settings = join(dir, "settings.json");
  const other = { matcher: "startup", hooks: [{ type: "command", command: "echo hi" }] };
  writeFileSync(settings, JSON.stringify({ model: "x", hooks: { SessionStart: [other] } }));
  run("install-hook.mjs", ["--settings", settings]);
  run("install-hook.mjs", ["--settings", settings]);
  let s = JSON.parse(readFileSync(settings, "utf8"));
  assert.equal(s.model, "x");
  assert.equal(s.hooks.SessionStart.length, 2);
  assert.deepEqual(s.hooks.SessionStart[0], other);
  assert.match(s.hooks.SessionStart[1].hooks[0].command, /brief-context\.mjs" --hook$/);
  run("install-hook.mjs", ["--settings", settings, "--remove"]);
  s = JSON.parse(readFileSync(settings, "utf8"));
  assert.deepEqual(s.hooks.SessionStart, [other]);
});

/* ── what cannot be undone, dependencies, estimates ────────────────────── */

test("a fix that cannot be undone is refused as handled without asking", () => {
  const r = messages(brief([entry("Q-1", live)], { mechanical: [{ summary: "Dropped the old ledger table.", created: T, updated: T, reversible: false }] }));
  assert.ok(r.errors.some((m) => m.includes("cannot be handled without asking")));
});

test("an option that cannot be undone is tagged, and a live entry that marks none is flagged", () => {
  const html = render(brief([entry("Q-1", { ...live, solutions: [{ ...option, reversible: false }] })]));
  assert.match(html, /tag-warn">Cannot be undone/);
  const r = messages(brief([entry("Q-1", { ...live, solutions: [{ ...option, reversible: undefined }] })]));
  assert.ok(r.warnings.some((m) => m.includes("whether it can be undone")));
});

test("a work estimate in calendar time is flagged on live entries", () => {
  const r = messages(brief([entry("Q-1", { ...live, solutions: [{ ...option, cost: { work: "About two days of work." } }] })]));
  assert.ok(r.warnings.some((m) => m.includes('estimates calendar time ("two days")')));
});

test("dependencies: unknown ids, self and cycles are refused", () => {
  const r = messages(brief([
    distinct("Q-1", "Retried invoices are posted twice", "A retried import posts the same invoice twice."),
    { ...distinct("Q-2", "The currency column is ignored", "Amounts in euros are read as pounds."), blockedBy: ["Q-3", "Q-2", "Q-9"] },
    { ...distinct("Q-3", "Supplier names are matched loosely", "Two suppliers with similar names are merged."), blockedBy: ["Q-2"] },
  ]));
  assert.ok(r.errors.some((m) => m.includes("waits on itself") && !m.includes("through")));
  assert.ok(r.errors.some((m) => m.includes("waits on Q-9")));
  assert.ok(r.errors.some((m) => m.includes("through Q-2 → Q-3 → Q-2") || m.includes("through Q-3 → Q-2 → Q-3")));
});

test("a goal blocker waiting on an escalated entry is flagged", () => {
  const r = messages(brief([
    { ...distinct("Q-1", "Retried invoices are posted twice", "A retried import posts the same invoice twice."), blockedBy: ["Q-2"] },
    distinct("Q-2", "The currency column is ignored", "Amounts in euros are read as pounds."),
  ].map((e) => e.id === "Q-2" ? { ...e, bearing: "escalated", bearingReason: "Not on the path." } : e)));
  assert.ok(r.warnings.some((m) => m.includes("waits on Q-2, which is only escalated")));
});

test("the page says what each entry waits on and unblocks, and ranks rulings by what they free", () => {
  const html = render(brief([
    distinct("Q-1", "Retried invoices are posted twice", "A retried import posts the same invoice twice."),
    distinct("Q-2", "The currency column is ignored", "Amounts in euros are read as pounds."),
    { ...distinct("Q-3", "Supplier names are matched loosely", "Two suppliers with similar names are merged."), blockedBy: ["Q-2"] },
    { ...distinct("Q-4", "Credit notes are posted as invoices", "A credit note is posted as a positive amount."), blockedBy: ["Q-3"] },
  ]));
  assert.match(html, /Waits on <a class="qref" href="#Q-2"/);
  assert.match(html, /Ruling this unblocks <a class="qref" href="#Q-3"/);
  const waiting = html.slice(html.indexOf("Waiting on you"), html.indexOf("</section>", html.indexOf("Waiting on you")));
  assert.ok(waiting.indexOf('href="#Q-2"') < waiting.indexOf('href="#Q-1"'), "Q-2 unblocks two, so it comes first");
  assert.match(waiting, /unblocks 2/);
});

/* ── the chat summary, computed ────────────────────────────────────────── */

test("the summary lists what moved, new entries first, then what waits on the reader", async () => {
  const { delta } = await import("../bin/brief-delta.mjs");
  const before = brief([distinct("Q-1", "Retried invoices are posted twice", "A retried import posts the same invoice twice.")]);
  const after = brief([
    { ...before.decisions[0], status: "decided", decision: { chose: "a", date: "2026-09-15" } },
    { ...distinct("Q-2", "The currency column is ignored", "Amounts in euros are read as pounds."), bearing: "escalated", bearingReason: "Not on the path." },
  ], { rulings: [ruling("R-1")] });
  const text = delta(before, after);
  const lines = text.split("\n");
  assert.match(lines[0], /^- Q-2 raised \(escalated\)/);
  assert.match(text, /- Q-1: open → decided \(Do it\)/);
  assert.match(text, /- R-1 recorded: Should retried invoices/);
  assert.match(text, /Blocks the goal: nothing\nEscalated, not blocking: Q-2/);
  assert.match(delta(after, after), /Nothing moved since the last publish/);
  assert.match(delta(after, brief([after.decisions[1]])), /Q-1 is missing from this version/);
});

test("the summary stays under 400 words however much moved", async () => {
  const { delta } = await import("../bin/brief-delta.mjs");
  const many = Array.from({ length: 120 }, (_, k) => distinct(`Q-${k + 1}`, `Problem number ${k + 1} with a long headline here`, "Something is wrong in a way that needs a ruling soon."));
  const text = delta(brief([]), brief(many));
  assert.ok(text.split(/\s+/).length <= 400, `${text.split(/\s+/).length} words`);
  assert.match(text, /more changes — see the page/);
});

test("the publish hook summarises against the previous publish, and ignores anything else", () => {
  const dir = mkdtempSync(join(tmpdir(), "brief-"));
  const env = { ...process.env, PROBLEM_BRIEF_SNAPSHOTS: join(dir, "snaps") };
  const hookRun = (input) => execFileSync("node", [bin("brief-delta.mjs"), "--hook"], { encoding: "utf8", input: JSON.stringify(input), env });
  const publish = (b) => {
    writeFileSync(join(dir, "index.html"), render(b));
    return hookRun({ tool_name: "Artifact", tool_input: { file_path: "index.html" }, cwd: dir });
  };
  const first = JSON.parse(publish(brief([entry("Q-1", live)])));
  assert.equal(first.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.match(first.hookSpecificOutput.additionalContext, /First publish: 1 awaiting a ruling/);
  const second = JSON.parse(publish(brief([entry("Q-1", live)], { rulings: [ruling("R-1")] })));
  assert.match(second.hookSpecificOutput.additionalContext, /- R-1 recorded/);
  assert.equal(hookRun({ tool_name: "Artifact", tool_input: { action: "comments", url: "x" }, cwd: dir }), "");
  assert.equal(hookRun({ tool_name: "Bash", tool_input: {}, cwd: dir }), "");
});

test("the installer adds both hooks and removes both", () => {
  const dir = mkdtempSync(join(tmpdir(), "brief-"));
  const settings = join(dir, "settings.json");
  run("install-hook.mjs", ["--settings", settings]);
  let s = JSON.parse(readFileSync(settings, "utf8"));
  assert.equal(s.hooks.PostToolUse[0].matcher, "Artifact");
  assert.match(s.hooks.PostToolUse[0].hooks[0].command, /brief-delta\.mjs" --hook$/);
  run("install-hook.mjs", ["--settings", settings, "--remove"]);
  s = JSON.parse(readFileSync(settings, "utf8"));
  assert.equal(s.hooks, undefined);
});
