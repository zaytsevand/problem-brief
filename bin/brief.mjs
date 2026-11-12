#!/usr/bin/env node
/**
 * The only way a brief's JSON is written. Every command takes a lock on the file,
 * validates the result and refuses to write anything that would add a validator
 * error, and raises the brief's `updated` stamp above every stamp inside it.
 *
 *   node brief.mjs new      <brief.json> --title … --subject … [--goal …]
 *   node brief.mjs raise    <brief.json> --title … --short … --problem … --brief …
 *                           --evidence '{…}'… --solution '{…}'… [--unwound '{…}'] [--diagram '{…}'…]
 *                           [--bearing blocks-goal|escalated --bearing-reason …] [--id Q-n]
 *   node brief.mjs decide   <brief.json> <Q-n> --chose <solution id> [--note …]
 *                           [--add-solution '{…}']
 *   node brief.mjs complete <brief.json> <Q-n> --note … --evidence '{…}'… [--date …]
 *   node brief.mjs retract  <brief.json> <Q-n> [--note …]
 *   node brief.mjs rule     <brief.json> --about … --said … --source … [--entries Q-1,Q-2]
 *                           [--replaces R-n] [--memory …]
 *   node brief.mjs work     <brief.json> add --summary … [--detail …] [--blocked-by …] [--state …]
 *   node brief.mjs work     <brief.json> update|done <W-n|position> [--field value…]
 *   node brief.mjs fix      <brief.json> --summary … [--detail …] [--reversible true]
 *   node brief.mjs note     <brief.json> [Q-n] <text> [--kind changed|note|…]
 *   node brief.mjs set      <brief.json> <brief|Q-n|R-n|W-n|mechanical.N> --field value…
 *                           set Q-n --diagram '{…}' adds a picture and keeps the ones already there
 *   node brief.mjs refresh  <brief.json>      move current changes into history, once per refresh
 *   node brief.mjs stamp    <brief.json>      raise updated above every item's stamp
 *
 * A value starting with { or [ is read as JSON, and true, false and null are literals;
 * set --field null removes a field, and --a.b sets a nested one. Every command that changes
 * an entry writes its change note; --change "<text>" replaces the default wording.
 * --dry-run validates and prints, and writes nothing.
 *
 * Zero dependencies. Node 18+.
 */

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { formatReport, validateBrief } from "./validate-brief.mjs";

class Refusal extends Error {}
const fail = (msg) => { throw new Refusal(msg); };

// The sidebar scans one folder; a brief kept anywhere else is found through this list, one absolute path a line.
// Every brief write passes through here, so the list is the one record of where briefs live.
const BRIEFS = join(homedir(), ".claude", "problem-brief", "briefs");
function remember(path) {
  const abs = resolve(path);
  if (dirname(abs) === BRIEFS) return;
  const list = join(BRIEFS, ".paths");
  try {
    if (existsSync(list) && readFileSync(list, "utf8").split("\n").includes(abs)) return;
    mkdirSync(BRIEFS, { recursive: true });
    appendFileSync(list, abs + "\n", "utf8");
  } catch {
    // The brief is written; a sidebar that misses it is the lesser loss.
  }
}

const now = () => new Date().toISOString().slice(0, 16) + "Z";
const today = () => new Date().toISOString().slice(0, 10);
const later = (a, b) => ((Date.parse(b) || 0) > (Date.parse(a) || 0) ? b : a);
const touch = (x) => { x.updated = later(now(), x.updated); };
const listOf = (v) => (v == null ? undefined : Array.isArray(v) ? v : String(v).split(/[\s,]+/).filter(Boolean));
const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const addChange = (b, kind, text, id) => (b.changes ??= []).push(defined({ kind, text, id }));

function childStamps(b) {
  const items = [...(b.decisions ?? []), ...(b.rulings ?? []), ...(b.mechanical ?? []), ...(b.outstanding ?? [])];
  return [...items.flatMap((x) => [x?.created, x?.updated]), ...(b.history ?? []).map((h) => h?.version)].filter(Boolean);
}
const stamp = (b) => { b.updated = [b.updated, ...childStamps(b)].filter(Boolean).reduce(later); };

// Withdrawn numbers are never issued again.
function nextId(b, prefix, list) {
  const used = [...(list ?? []).map((x) => x?.id), ...(b.withdrawnIds ?? [])]
    .filter((id) => typeof id === "string" && id.startsWith(`${prefix}-`))
    .map((id) => Number(id.slice(prefix.length + 1)) || 0);
  return `${prefix}-${Math.max(0, ...used) + 1}`;
}

const setPath = (o, key, v) => {
  const keys = key.split(".");
  const last = keys.pop();
  for (const k of keys) o = o[k] ??= {};
  if (v === null) delete o[last];
  else o[last] = v;
};

/* ── arguments ──────────────────────────────────────────────────────────── */

const LISTS = new Set(["evidence", "solution", "addSolution", "diagram"]);
const camel = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
function value(s, flag) {
  if (!/^\s*[[{]/.test(s) && !["true", "false", "null"].includes(s)) return s;
  try { return JSON.parse(s); } catch (e) { fail(`${flag} is not valid JSON: ${e.message}`); }
}
function parse(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { pos.push(a); continue; }
    const key = camel(a.slice(2));
    if (key === "dryRun") { flags.dryRun = true; continue; }
    if (i + 1 >= argv.length) fail(`${a} needs a value`);
    const v = value(argv[++i], a);
    if (LISTS.has(key)) (flags[key] ??= []).push(...[v].flat());
    else flags[key] = v;
  }
  return { pos, flags };
}

/* ── finding things ─────────────────────────────────────────────────────── */

function entry(b, id) {
  const e = (b.decisions ?? []).find((x) => x?.id === id);
  if (!e) fail(`${id} is not an entry in this brief`);
  return e;
}

// Blocked only while what it waits on is still open: another brief, or an open entry here.
const waitsOn = (b, ref) => !!ref && (!/^Q-\d+$/.test(ref) || ((b.decisions ?? []).find((e) => e.id === ref)?.status ?? "open") === "open");

// Outstanding items get a W-n id the first time any work command touches the list,
// so later commands name an item exactly instead of matching its summary.
function workIds(b) {
  for (const o of b.outstanding ?? []) if (!o.id) o.id = nextId(b, "W", b.outstanding);
}
function workItem(b, ref) {
  workIds(b);
  const list = b.outstanding ?? [];
  const o = /^\d+$/.test(ref ?? "") ? list[Number(ref) - 1] : list.find((x) => x.id === ref);
  if (!o) fail(`${ref ?? "(nothing)"} is not an outstanding item: name it W-n or by position (1 is the first)`);
  return o;
}

function target(b, ref) {
  if (ref === "brief") return b;
  if (/^Q-\d+$/.test(ref)) return entry(b, ref);
  if (/^R-\d+$/.test(ref)) return (b.rulings ?? []).find((r) => r.id === ref) ?? fail(`${ref} is not a ruling in this brief`);
  if (/^W-\d+$/.test(ref)) return workItem(b, ref);
  const m = /^mechanical\.(\d+)$/.exec(ref ?? "");
  if (m) return b.mechanical?.[Number(m[1]) - 1] ?? fail(`${ref}: there is no mechanical item at that position`);
  fail(`say what to change: brief, Q-n, R-n, W-n or mechanical.N (got ${ref ?? "nothing"})`);
}

function assign(x, fields) {
  for (const [k, v] of Object.entries(fields)) {
    if (k === "id" || k === "created") fail(`--${k} is set once and never changed`);
    setPath(x, k, v);
  }
}

/* ── commands ───────────────────────────────────────────────────────────── */

const COMMANDS = {
  new(b, [], { title, subject, goal, ...rest }) {
    const n = now();
    Object.assign(b, defined({ title, subject, goal, created: n, updated: n, ...rest, decisions: [] }));
    return `started "${title}"`;
  },

  raise(b, [], f) {
    const { change, evidence, solution, id: given, blockedBy, diagram, ...rest } = f;
    const id = given ?? nextId(b, "Q", b.decisions);
    if ((b.decisions ?? []).some((e) => e.id === id)) fail(`${id} is already an entry; raise takes the next free number unless --id names an unused one`);
    const n = now();
    const { title, short, problem, brief, unwound: stated, ...more } = rest;
    const unwound = diagram ? { ...stated, diagrams: [...(stated?.diagrams ?? []), ...diagram] } : stated;
    (b.decisions ??= []).push(defined({
      id, created: n, updated: n, title, short, problem, brief,
      evidence: evidence ?? [], unwound, solutions: solution ?? [], status: "open",
      blockedBy: listOf(blockedBy), ...more,
    }));
    addChange(b, "raised", change ?? `${id} raised: ${short ?? title}.`, id);
    return `raised ${id}`;
  },

  decide(b, [id], { chose, note, date, addSolution, change }) {
    const e = entry(b, id);
    if (addSolution) e.solutions = [...(e.solutions ?? []), ...addSolution];
    const s = (e.solutions ?? []).find((x) => x.id === chose);
    if (!s) fail(`--chose ${chose ?? "(missing)"} is not one of ${id}'s options: ${(e.solutions ?? []).map((x) => x.id).join(", ")}`);
    const was = e.status ?? "open";
    e.status = "decided";
    e.decision = defined({ chose, date: date ?? today(), note });
    touch(e);
    addChange(b, "changed", change ?? `${id}: ${was} → decided (${s.label}).`, id);
    return `${id}: ${was} → decided (${chose})`;
  },

  complete(b, [id], { note, evidence, date, resolution, change }) {
    const e = entry(b, id);
    const was = e.status ?? "open";
    e.status = "complete";
    e.resolution = defined({ date: date ?? today(), note, evidence, ...resolution });
    touch(e);
    addChange(b, "completed", change ?? `${id}: ${was} → complete.${note ? ` ${note}` : ""}`, id);
    return `${id}: ${was} → complete`;
  },

  retract(b, [id], { note, change }) {
    const e = entry(b, id);
    e.status = "superseded";
    touch(e);
    addChange(b, "retracted", change ?? `${id} retracted: ${note ?? e.short ?? e.title}.`, id);
    return `${id} retracted`;
  },

  rule(b, [], { about, said, source, entries, memory, replaces, change }) {
    const id = nextId(b, "R", b.rulings);
    const n = now();
    if (replaces) {
      const old = (b.rulings ?? []).find((r) => r.id === replaces) ?? fail(`--replaces ${replaces} is not a ruling in this brief`);
      if (old.status === "replaced") fail(`${replaces} was already replaced by ${old.replacedBy}; replace that one instead`);
      old.status = "replaced";
      old.replacedBy = id;
      touch(old);
    }
    (b.rulings ??= []).push(defined({ id, created: n, updated: n, about, said, source, entries: listOf(entries), memory }));
    addChange(b, "note", change ?? `${id} recorded: ${about}${replaces ? ` (replaces ${replaces})` : ""}`);
    return `recorded ${id}${replaces ? `, ${replaces} marked replaced` : ""}`;
  },

  work(b, [action, ref], f) {
    const { change, ...fields } = f;
    if (action === "add") {
      workIds(b);
      const id = nextId(b, "W", b.outstanding);
      const n = now();
      const { summary, detail, blockedBy, state, ...more } = fields;
      (b.outstanding ??= []).push(defined({ id, summary, created: n, updated: n, detail, blockedBy, state: state ?? (waitsOn(b, blockedBy) ? "blocked" : "not-started"), ...more }));
      if (change) addChange(b, "note", change);
      return `added ${id}`;
    }
    const o = workItem(b, ref);
    if (action === "update") {
      assign(o, fields);
      touch(o);
      if (change) addChange(b, "changed", change);
      return `updated ${o.id}`;
    }
    if (action === "done") {
      assign(o, fields);
      o.state = "done";
      touch(o);
      addChange(b, "completed", change ?? `Done: ${o.summary}`);
      return `${o.id} done`;
    }
    fail("work takes add, update or done");
  },

  fix(b, [], { summary, detail, reversible, evidence, change, ...more }) {
    const n = now();
    (b.mechanical ??= []).push(defined({ summary, created: n, updated: n, detail, reversible, evidence, ...more }));
    if (change) addChange(b, "note", change);
    return `listed mechanical.${b.mechanical.length} as done`;
  },

  note(b, pos, { kind }) {
    const id = /^Q-\d+$/.test(pos[0] ?? "") ? pos[0] : undefined;
    const text = pos.slice(id ? 1 : 0).join(" ");
    if (!text) fail("note needs the text of the change note");
    addChange(b, kind ?? "note", text, id);
    return `noted${id ? ` on ${id}` : ""}`;
  },

  set(b, [ref], { change, diagram, ...fields }) {
    if (!Object.keys(fields).length && !diagram) fail("set needs at least one --field value");
    const x = target(b, ref);
    if (diagram) {
      if (!/^Q-\d+$/.test(ref)) fail("--diagram adds a picture to an entry: name it Q-n");
      ((x.unwound ??= {}).diagrams ??= []).push(...diagram);
    }
    assign(x, fields);
    if (x !== b) touch(x);
    if (change) addChange(b, "changed", change, /^Q-\d+$/.test(ref) ? ref : undefined);
    return `set ${[...Object.keys(fields), ...(diagram ? ["diagram"] : [])].join(", ")} on ${ref}`;
  },

  refresh(b) {
    if (!b.changes?.length) return "no current changes to move; nothing to do";
    const n = b.changes.length;
    // The block is stamped with the version the notes belong to: updated as last published.
    (b.history ??= []).push({ version: b.updated, changes: b.changes });
    b.changes = [];
    return `moved ${n} change note${n === 1 ? "" : "s"} into history as ${b.history.at(-1).version}`;
  },

  stamp() {
    return "stamped";
  },
};

/* ── the one write path ─────────────────────────────────────────────────── */

const LOCK_STALE_MS = 30_000;
const key = (e) => `${e.path} ${e.message}`;

function run(command, file, pos, flags) {
  const path = resolve(file), lock = `${path}.lock`;
  let fd;
  try {
    fd = openSync(lock, "wx");
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    if (Date.now() - statSync(lock).mtimeMs < LOCK_STALE_MS) fail(`${file} is being written by another session (${basename(lock)}); run the command again in a moment`);
    unlinkSync(lock); // left by a writer that crashed
    fd = openSync(lock, "wx");
  }
  try {
    let before = null;
    if (command === "new") {
      if (existsSync(path)) fail(`${file} already exists`);
    } else {
      try { before = JSON.parse(readFileSync(path, "utf8")); } catch (e) { fail(`${file}: ${e.message}`); }
    }
    const after = structuredClone(before ?? {});
    const said = COMMANDS[command](after, pos, flags);
    if (command === "refresh" && !before.changes?.length) return console.log(said);
    if (command !== "stamp") after.updated = later(now(), after.updated);
    stamp(after);

    const here = dirname(path);   // pictures are named relative to the brief, and checked on disk
    // A bad picture is refused here, where the author adds it; a render of the same brief shows a note instead.
    const strict = { pictures: "refuse" };
    const was = before ? validateBrief(before, undefined, here, strict) : { errors: [], warnings: [] };
    const known = new Set([...was.errors, ...was.warnings].map(key));
    // A new brief has no entries until the first raise.
    if (command === "new") for (const e of validateBrief(after, undefined, here, strict).errors) if (e.path === "decisions") known.add(key(e));
    const result = validateBrief(after, undefined, here, strict);
    const fresh = result.errors.filter((e) => !known.has(key(e)));
    if (fresh.length) {
      fail(`${command} refused; nothing was written.\n${formatReport({ ok: false, errors: fresh, warnings: [] }, file)}`);
    }
    if (!flags.dryRun) {
      writeFileSync(`${path}.tmp`, JSON.stringify(after, null, 2) + "\n", "utf8");
      renameSync(`${path}.tmp`, path);
      remember(path);
    }
    console.log(`${flags.dryRun ? "would have " : ""}${said} — ${file}, updated ${after.updated}`);
    const warned = result.warnings.filter((e) => !known.has(key(e)));
    for (const w of warned) console.log(`  worth fixing: ${w.path || "the brief"} ${w.message}`);
    const left = result.errors.length - fresh.length;
    if (left) console.log(`  ${left} earlier problem${left === 1 ? "" : "s"} still in the file: node validate-brief.mjs ${file}`);
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}

const USAGE = readFileSync(new URL(import.meta.url), "utf8").match(/\/\*\*([\s\S]*?)\*\//)[1].replace(/^ \* ?/gm, "").trim();
const [command, file, ...rest] = process.argv.slice(2);
if (!command || command === "--help" || command === "-h" || !(command in COMMANDS) || !file) {
  console.error(USAGE);
  process.exit(command && command !== "--help" && command !== "-h" ? 2 : 0);
}
try {
  const { pos, flags } = parse(rest);
  run(command, file, pos, flags);
} catch (e) {
  if (!(e instanceof Refusal)) throw e;
  console.error(e.message);
  process.exit(1);
}
