// Run with: node --test test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateBrief } from "../bin/validate-brief.mjs";
import { refusal } from "../bin/brief-guard.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const copy = () => {
  const f = join(mkdtempSync(join(tmpdir(), "brief-cli-")), "x.brief.json");
  cpSync(join(ROOT, "examples", "example.brief.json"), f);
  return f;
};
const brief = (...args) => spawnSync("node", [join(ROOT, "bin", "brief.mjs"), ...args], { encoding: "utf8" });
const read = (f) => JSON.parse(readFileSync(f, "utf8"));
const ok = (r) => assert.equal(r.status, 0, r.stderr);

const EVIDENCE = JSON.stringify({ kind: "code", ref: "import.py:40", note: "Retry re-runs the whole batch." });
const SOLUTIONS = [
  { id: "dedupe", label: "Skip invoices already posted", recommended: true, reversible: true, summary: "Check the invoice number before posting.", cost: { work: "One check and a test." } },
  { id: "manual", label: "Keep reversing by hand", reversible: true, summary: "Leave it and keep reversing duplicates by hand.", cost: { work: "Nothing now, manual work later." } },
];
const raise = (f, ...extra) => brief("raise", f,
  "--title", "Retries post invoices twice to the ledger", "--short", "double postings on retry",
  "--problem", "A retried import posts every invoice a second time.",
  "--brief", "Finance reverses the duplicates by hand, and nobody notices for days because totals balance.",
  "--evidence", EVIDENCE, "--solution", JSON.stringify(SOLUTIONS),
  "--unwound", JSON.stringify({ now: "A retry re-runs everything.", noDiagram: "One step repeats; nothing to draw." }),
  "--bearing", "escalated", "--bearing-reason", "The release ships without it.", ...extra);

test("a full run through the commands leaves a valid brief with stamps in order", () => {
  const f = copy();
  const was = read(f);
  ok(brief("refresh", f));
  let b = read(f);
  assert.equal(b.changes.length, 0);
  assert.deepEqual(b.history.at(-1), { version: was.updated, changes: was.changes });

  ok(raise(f));
  ok(brief("decide", f, "Q-4", "--chose", "dedupe", "--note", "Dedupe it."));
  ok(brief("rule", f, "--about", "Should duplicate postings be fixed without asking?", "--said", "Ask me first next time.", "--source", "chat, 2026-11-03", "--replaces", "R-2"));
  ok(brief("work", f, "add", "--summary", "Add the dedupe check", "--blocked-by", "Q-4"));
  ok(brief("complete", f, "Q-4", "--note", "Dedupe shipped.", "--evidence", JSON.stringify({ kind: "commit", ref: "abc123", note: "The check." })));
  ok(brief("work", f, "done", "W-4"));

  b = read(f);
  assert.deepEqual(validateBrief(b).errors, []);
  const q4 = b.decisions.find((e) => e.id === "Q-4");
  assert.equal(q4.status, "complete");
  assert.equal(q4.decision.chose, "dedupe");
  assert.deepEqual(b.rulings.find((r) => r.id === "R-2"), { ...b.rulings.find((r) => r.id === "R-2"), status: "replaced", replacedBy: "R-3" });
  assert.deepEqual(b.outstanding.map((o) => o.id), ["W-1", "W-2", "W-3", "W-4"]);
  assert.equal(b.outstanding[3].state, "done");
  assert.deepEqual(b.changes.map((c) => c.kind), ["raised", "changed", "note", "completed", "completed"]);
  const stamps = [...b.decisions, ...b.rulings, ...b.outstanding].map((x) => Date.parse(x.updated));
  assert.ok(stamps.every((s) => s <= Date.parse(b.updated)));
  assert.ok(!existsSync(`${f}.lock`));
});

test("refresh with nothing to move writes nothing", () => {
  const f = copy();
  ok(brief("refresh", f));
  const once = readFileSync(f, "utf8");
  ok(brief("refresh", f));
  assert.equal(readFileSync(f, "utf8"), once);
});

test("malformed input is refused and the file is left as it was", () => {
  const f = copy();
  const before = readFileSync(f, "utf8");
  for (const r of [
    raise(f, "--bearing", "non-blocking"),
    brief("rule", f, "--about", "Should this be asked again?", "--said", "no", "--source", "chat"),
    brief("decide", f, "Q-1", "--chose", "nope"),
    brief("set", f, "Q-1", "--evidence", JSON.stringify([{ text: "a pr" }])),
    brief("set", f, "Q-1", "--created", "2026-01-01T00:00Z"),
  ]) assert.equal(r.status, 1, r.stdout);
  assert.equal(readFileSync(f, "utf8"), before);
});

test("an id is never reissued, withdrawn ones included", () => {
  const f = copy();
  const b = read(f);
  writeFileSync(f, JSON.stringify({ ...b, withdrawnIds: ["Q-7"] }));
  ok(raise(f));
  assert.equal(read(f).decisions.at(-1).id, "Q-8");
  assert.equal(raise(f, "--id", "Q-1").status, 1);
});

test("errors already in the file do not block an unrelated change", () => {
  const f = copy();
  const b = read(f);
  b.decisions[0].bearing = "non-blocking";
  writeFileSync(f, JSON.stringify(b));
  const r = brief("note", f, "Q-2", "Q-2 re-checked against the current branch.");
  ok(r);
  assert.match(r.stdout, /earlier problem/);
});

test("set changes any field, nested or top level, and stamps the item", () => {
  const f = copy();
  ok(brief("set", f, "Q-2", "--unwound.no-diagram", "Nothing moves; one value is wrong.", "--change", "Q-2 says why it has no picture."));
  ok(brief("set", f, "brief", "--goal", "Ship the importer this week."));
  const b = read(f);
  assert.equal(b.decisions[1].unwound.noDiagram, "Nothing moves; one value is wrong.");
  assert.equal(b.decisions[1].updated, b.updated);
  assert.equal(b.goal, "Ship the importer this week.");
});

test("a second writer is refused while the lock is held, and a stale lock is cleared", () => {
  const f = copy();
  writeFileSync(`${f}.lock`, "");
  const r = brief("stamp", f);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /another session/);
  const old = new Date(Date.now() - 60_000);
  utimesSync(`${f}.lock`, old, old);
  ok(brief("stamp", f));
  assert.ok(!existsSync(`${f}.lock`));
});

test("new starts a brief and refuses to overwrite one", () => {
  const f = join(mkdtempSync(join(tmpdir(), "brief-cli-")), "brief.json");
  ok(brief("new", f, "--title", "Importer release", "--subject", "What stands between the importer and release.", "--goal", "Ship the importer."));
  ok(raise(f));
  assert.deepEqual(validateBrief(read(f)).errors, []);
  assert.equal(read(f).decisions[0].id, "Q-1");
  assert.equal(brief("new", f, "--title", "Again", "--subject", "Should not overwrite the first.").status, 1);
});

test("the guard refuses hand edits of brief JSON and lets the commands through", () => {
  assert.equal(refusal("Write", { file_path: "/w/specs/017/x.brief.json" }), "edit");
  assert.equal(refusal("Edit", { file_path: "brief.json" }), "edit");
  assert.equal(refusal("Edit", { file_path: "schema/problem-brief.schema.json" }), null);
  assert.equal(refusal("Bash", { command: `python3 -c "import json; json.dump(b, open('x.brief.json','w'))"` }), "shell");
  assert.equal(refusal("Bash", { command: "jq '.goal=1' brief.json > brief.json.new && mv brief.json.new brief.json" }), "shell");
  assert.equal(refusal("Bash", { command: "sed -i 's/a/b/' specs/brief.json" }), "shell");
  assert.equal(refusal("Bash", { command: `node ~/.claude/skills/problem-brief/bin/brief.mjs set brief.json Q-1 --short "x y"` }), null);
  assert.equal(refusal("Bash", { command: "node bin/render-brief.mjs brief.json out/index.html" }), null);
  assert.equal(refusal("Bash", { command: "cp brief.json previous.json" }), null);
  // A `>` closing a placeholder is no redirect (#34); a real one still is, spaced or not.
  assert.equal(refusal("Bash", { command: "git commit -m 'load brief.json and <slug>.brief.json once'" }), null);
  assert.equal(refusal("Bash", { command: "echo '{}' > x.brief.json" }), "shell");
  assert.equal(refusal("Bash", { command: "echo '{}'>brief.json" }), "shell");
  assert.equal(refusal("Bash", { command: "ls ~/.claude/briefs/<slug>/brief.json" }), null);
  // A heredoc or an input redirect right before the `>` is no placeholder.
  assert.equal(refusal("Bash", { command: "cat <<EOF>brief.json\n{}\nEOF" }), "shell");
  assert.equal(refusal("Bash", { command: "jq . <old.json>brief.json" }), "shell");
  assert.equal(refusal("Read", { file_path: "brief.json" }), null);
  // A brief named in a message or a heredoc body is text, not a write (#37); a heredoc fed to an interpreter still is.
  const issue = "gh issue create --title 'x' --body \"$(cat <<'EOF'\nThe guard should refuse sed -i or tee on session-a.brief.json, or > brief.json.\nEOF\n)\"";
  assert.equal(refusal("Bash", { command: issue }), null);
  assert.equal(refusal("Bash", { command: `git commit -m "fix: rm stale x.brief.json > note"` }), null);
  assert.equal(refusal("Bash", { command: `gh pr create --body 'writes brief.json with writeFile'` }), null);
  assert.equal(refusal("Bash", { command: "python3 - <<'EOF'\nimport json; json.dump({}, open('x.brief.json','w'))\nEOF" }), "shell");
  assert.equal(refusal("Bash", { command: "cat <<'EOF' > x.brief.json\n{}\nEOF" }), "shell");
  assert.equal(refusal("Bash", { command: "git commit -m 'notes' && sed -i 's/a/b/' brief.json" }), "shell");

  const r = spawnSync("node", [join(ROOT, "bin", "brief-guard.mjs"), "--hook"], {
    input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: "brief.json" } }), encoding: "utf8",
  });
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, "deny");
});
