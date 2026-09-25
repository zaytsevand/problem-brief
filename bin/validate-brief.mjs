#!/usr/bin/env node
/**
 * Validate a problem brief before anything tries to render it.
 *
 *   node validate-brief.mjs my-brief.json
 *   node validate-brief.mjs my-brief.json --json    machine-readable output
 *
 * Two passes, because they catch different mistakes:
 *
 *   1. The schema. Types, required fields, patterns, and — most importantly —
 *      unknown properties. A brief written by an agent goes wrong by misspelling
 *      a field far more often than by malforming one, and a misspelt field is
 *      silently dropped by any renderer that does not check. `recommend` for
 *      `recommended` costs you the recommendation with no error anywhere.
 *
 *   2. The rules the schema cannot express: the recommended option must be
 *      listed first, a citation must say what it shows, an option must carry a
 *      price, a closed entry must carry proof, a status must agree with what
 *      the entry records, and every timestamp must agree with the others.
 *      It also warns when an entry reads like an earlier one, or like a
 *      question a standing ruling has already answered.
 *
 * Errors are written for whoever has to fix them — a readable path, what is
 * wrong, and what to do about it. An unknown field is matched against the
 * fields that do exist, so a typo comes back as a suggestion rather than a
 * shrug.
 *
 * Zero dependencies, so the schema keywords understood here are exactly the
 * ones the bundled schema uses. Node 18+.
 */

import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(HERE, "..", "schema", "problem-brief.schema.json");

/* ── how close are two field names ─────────────────────────────────────────
   Cheap edit distance, used only to turn "unknown property" into a suggestion. */

function distance(a, b) {
  const m = a.length, n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const row = [i];
    for (let j = 1; j <= n; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[n];
}

function nearest(word, candidates) {
  let best = null, bestD = Infinity;
  for (const c of candidates) {
    const d = distance(word.toLowerCase(), c.toLowerCase());
    if (d < bestD) { bestD = d; best = c; }
  }
  // Only suggest when it really is a near miss, not a different word entirely.
  return bestD <= Math.max(2, Math.floor(word.length / 3)) ? best : null;
}

/* ── the schema walk ───────────────────────────────────────────────────────
   Only the keywords the bundled schema actually uses. Anything else would be a
   silent no-op, so an unknown keyword is reported rather than ignored. */

const KNOWN_KEYWORDS = new Set([
  "$schema", "$id", "$ref", "$defs", "title", "description", "default",
  "type", "required", "properties", "additionalProperties", "items",
  "enum", "const", "pattern", "format",
  "minLength", "maxLength", "minItems", "maxItems", "minimum", "maximum",
  "allOf", "anyOf", "if", "then", "propertyNames",
]);

const typeOf = (v) =>
  v === null ? "null"
    : Array.isArray(v) ? "array"
      : Number.isInteger(v) ? "integer"
        : typeof v === "number" ? "number"
          : typeof v;

const matchesType = (v, t) =>
  t === "integer" ? Number.isInteger(v)
    : t === "number" ? typeof v === "number"
      : typeOf(v) === t;

class Validator {
  constructor(schema) { this.root = schema; this.errors = []; }

  deref(s) {
    if (!s || !s.$ref) return s;
    const path = s.$ref.replace(/^#\//, "").split("/");
    let node = this.root;
    for (const p of path) node = node?.[p];
    if (!node) throw new Error(`schema reference ${s.$ref} does not resolve`);
    return node;
  }

  add(path, message, hint) { this.errors.push({ path, message, hint }); }

  check(value, schema, path) {
    schema = this.deref(schema);
    if (!schema) return;

    for (const k of Object.keys(schema)) {
      if (!KNOWN_KEYWORDS.has(k)) {
        this.add(path, `the schema uses "${k}", which this validator does not implement`,
          "the rule was not applied — extend the validator or simplify the schema");
      }
    }

    if (schema.type && !matchesType(value, schema.type)) {
      this.add(path, `should be ${article(schema.type)}, but is ${article(typeOf(value))}`,
        exampleFor(schema.type));
      return; // every later keyword assumes the right type
    }

    if (schema.enum && !schema.enum.includes(value)) {
      this.add(path, `"${value}" is not allowed here`,
        `use one of: ${schema.enum.join(", ")}`);
    }
    if (schema.const !== undefined && value !== schema.const) {
      this.add(path, `must be "${schema.const}"`);
    }

    if (typeof value === "string") {
      if (schema.minLength && value.length < schema.minLength) {
        this.add(path, `is too short — ${value.length} characters, at least ${schema.minLength} expected`,
          schema.description);
      }
      if (schema.maxLength && value.length > schema.maxLength) {
        this.add(path, `is too long — ${value.length} characters, at most ${schema.maxLength} allowed`,
          schema.description);
      }
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
        this.add(path, `"${value}" is not the right shape`, patternHint(schema.pattern));
      }
      if (schema.format === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        this.add(path, `"${value}" is not a date`, "write it as YYYY-MM-DD, e.g. 2026-09-11");
      }
      if (schema.format === "date-time" && !isTimestamp(value)) {
        this.add(path, `"${value}" is not a timestamp`,
          "write it as YYYY-MM-DDTHH:MM with a time zone, e.g. 2026-09-15T09:40Z or 2026-09-15T10:40+01:00");
      }
    }

    if (typeof value === "number") {
      if (schema.minimum !== undefined && value < schema.minimum) {
        this.add(path, `${value} is below the minimum of ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        this.add(path, `${value} is above the maximum of ${schema.maximum}`);
      }
    }

    if (Array.isArray(value)) {
      if (schema.minItems && value.length < schema.minItems) {
        this.add(path, `needs at least ${schema.minItems} ${plural(schema.minItems, "item")}, has ${value.length}`,
          schema.description);
      }
      if (schema.maxItems && value.length > schema.maxItems) {
        this.add(path, `allows at most ${schema.maxItems} ${plural(schema.maxItems, "item")}, has ${value.length}`,
          schema.description);
      }
      if (schema.items) value.forEach((v, i) => this.check(v, schema.items, `${path}[${i}]`));
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      const known = Object.keys(schema.properties ?? {});
      for (const req of schema.required ?? []) {
        if (value[req] === undefined) {
          const d = schema.properties?.[req]?.description ?? this.deref(schema.properties?.[req])?.description;
          this.add(path, `is missing "${req}"`, d);
        }
      }
      for (const [k, v] of Object.entries(value)) {
        if (schema.properties?.[k]) {
          this.check(v, schema.properties[k], path ? `${path} → ${k}` : k);
        } else if (schema.additionalProperties === false) {
          const guess = nearest(k, known);
          this.add(path, `has an unknown field "${k}"`,
            guess ? `did you mean "${guess}"? Anything unknown is silently dropped when the page is built.`
              : `known fields here: ${known.join(", ")}`);
        }
      }
      // A conditional clause is a real rule, so a failure inside one is reported
      // at the point it applies rather than swallowed.
      for (const clause of schema.allOf ?? []) {
        if (clause.if && this.quiet(value, clause.if)) {
          if (clause.then) this.check(value, clause.then, path);
        } else if (!clause.if) {
          this.check(value, clause, path);
        }
      }
      if (schema.anyOf && !schema.anyOf.some((s) => this.quiet(value, s))) {
        const needs = schema.anyOf.map((s) => (s.required ?? []).join(" + ")).filter(Boolean);
        this.add(path, `needs at least one of: ${needs.join(", or ")}`, schema.description);
      }
    }
  }

  /* Does this value satisfy that schema, without recording anything? Used for
     if/then and anyOf, where a failure is a branch not taken, not an error. */
  quiet(value, schema) {
    const keep = this.errors;
    this.errors = [];
    this.check(value, schema, "");
    const ok = this.errors.length === 0;
    this.errors = keep;
    return ok;
  }
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const isTimestamp = (v) => TIMESTAMP.test(v) && !Number.isNaN(Date.parse(v));

const article = (t) => (/^[aeiou]/.test(t) ? `an ${t}` : `a ${t}`);
const plural = (n, w) => (n === 1 ? w : w + "s");

function exampleFor(t) {
  return {
    string: 'wrap it in quotes: "…"',
    array: "wrap it in brackets: [ … ]",
    object: "wrap it in braces: { … }",
    integer: "a whole number, no quotes",
    number: "a number, no quotes",
    boolean: "true or false, no quotes",
  }[t];
}

function patternHint(p) {
  if (p === "^Q-[0-9]+$") return 'entry ids look like "Q-1", "Q-2" — the letter Q, a hyphen, a number';
  if (p === "^[a-z0-9-]+$") return "lower-case letters, digits and hyphens only";
  return `it must match ${p}`;
}

/* ── the rules a schema cannot state ───────────────────────────────────────── */

function semanticErrors(brief) {
  const out = [];
  const at = (e, i) => `decisions[${i}]${e?.id ? ` (${e.id})` : ""}`;
  const seen = new Map();

  (brief.decisions ?? []).forEach((e, i) => {
    const where = at(e, i);
    if (e?.id) {
      if (seen.has(e.id)) {
        out.push({ path: where, message: `re-uses the id "${e.id}", already used by decisions[${seen.get(e.id)}]`,
          hint: "ids are how the reader cites an entry, so each must be unique and must never be reassigned" });
      }
      seen.set(e.id, i);
    }

    (e?.evidence ?? []).forEach((ev, j) => {
      if (ev && !ev.note) {
        out.push({ path: `${where} → evidence[${j}]`, message: "has no note",
          hint: "say in one sentence what this citation shows — a bare path proves nothing to the reader" });
      }
    });

    const sols = e?.solutions ?? [];
    const rec = sols.filter((s) => s?.recommended);
    if (sols.length && rec.length === 0) {
      out.push({ path: `${where} → solutions`, message: "has no recommended option",
        hint: 'mark exactly one with "recommended": true — an entry that does not recommend anything leaves the reader where they started' });
    }
    if (rec.length > 1) {
      out.push({ path: `${where} → solutions`, message: `recommends ${rec.length} options`,
        hint: "exactly one recommendation, or it is not a recommendation" });
    }
    if (sols.length && rec.length === 1 && !sols[0].recommended) {
      const n = sols.findIndex((s) => s.recommended);
      out.push({ path: `${where} → solutions`, message: `the recommended option is listed ${ordinal(n + 1)}, not first`,
        hint: "move it to the front of the array — the reader takes the first option as the recommendation" });
    }
    sols.forEach((s, j) => {
      if (s && !s.cost?.work) {
        out.push({ path: `${where} → solutions[${j}]`, message: "has no cost.work",
          hint: "say what it would actually take — an option with no price cannot be weighed against another" });
      }
    });

    if (e?.resolution?.differs) {
      out.push({ path: `${where} → resolution → differs`, severity: "warning",
        message: "is retired — record the drift as amendments instead",
        hint: 'write it as "amendments": [{ "ruled": …, "done": …, "why": … }], so the page can show what was ruled, what was done instead and why' });
    }
    if (e?.status === "complete") {
      const r = e.resolution;
      if (r && !r.note && !(r.evidence?.length)) {
        out.push({ path: `${where} → resolution`, message: "closes the entry without proof",
          hint: "add a note saying what happened, or evidence — a commit, a pull request, a test. A closed entry with no proof is a claim, not a record" });
      }
    }

    (e?.unwound?.diagrams ?? []).forEach((d, j) => {
      const p = `${where} → unwound → diagrams[${j}]`;
      if (d?.kind === "mermaid" && !d.source) {
        out.push({ path: p, message: 'is a mermaid drawing with no "source"', hint: "put the diagram text in source" });
      }
      if ((d?.kind === "archify" || d?.kind === "svg") && !d.file) {
        out.push({ path: p, message: `is ${article(d.kind)} drawing with no "file"`,
          hint: "point file at the rendered page or the .svg" });
      }
      if (d?.kind === "archify" && !d.spec) {
        out.push({ path: p, message: 'has no "spec"', severity: "warning",
          hint: "keep the archify source path, or the next refresh redraws the picture instead of editing it" });
      }
    });
  });

  const byId = new Map((brief.decisions ?? []).map((e) => [e?.id, e]));
  (brief.outstanding ?? []).forEach((o, i) => {
    if (!o?.blockedBy) return;
    const where = `outstanding[${i}]`;
    const target = byId.get(o.blockedBy);
    if (!target) {
      out.push({ path: where, message: `waits on "${o.blockedBy}", which is not an entry on this page`,
        hint: `entries on this page: ${[...byId.keys()].join(", ") || "none"}` });
      return;
    }
    const ts = target.status ?? "open";
    if (ts !== "open" && o.state === "blocked") {
      out.push({ path: where, message: `is marked blocked on ${o.blockedBy}, but ${o.blockedBy} is ${ts}`,
        hint: "the ruling it waited on has been made — set state to not-started, in-progress or done" });
    }
    if (ts === "superseded" && o.state !== "done") {
      out.push({ path: where, severity: "warning",
        message: `waits on ${o.blockedBy}, which is superseded`,
        hint: "the problem this work served went away — check whether the work is still wanted" });
    }
  });

  const KINDS = ["raised", "changed", "completed", "retracted", "note"];
  const checkChanges = (list, at) => (Array.isArray(list) ? list : []).forEach((c, i) => {
    const where = `${at}[${i}]`;
    if (typeof c === "string") {
      out.push({ path: where, severity: "warning", message: "has no kind, so it is shown last among the notes",
        hint: `write it as { "kind": …, "text": … } with kind one of ${KINDS.join(", ")}` });
    } else if (c?.id && !(brief.decisions ?? []).some((e) => e?.id === c.id)) {
      out.push({ path: `${where} → id`, message: `points at ${c.id}, which is not an entry on this page`,
        hint: "fix the id, or drop it if the change is not about one entry" });
    } else if (c && typeof c === "object" && !KINDS.includes(c.kind)) {
      const guess = typeof c.kind === "string" ? nearest(c.kind, KINDS) : null;
      out.push({ path: `${where} → kind`, message: `is ${JSON.stringify(c.kind)}, which is not a transition`,
        hint: (guess ? `did you mean "${guess}"? ` : "") + `use one of: ${KINDS.join(", ")}` });
    }
  });
  checkChanges(brief.changes, "changes");

  /* Earlier versions' notes are kept, never rewritten, so each block is one
     moment before this version and no two blocks claim the same moment. */
  const stamped = new Set();
  (Array.isArray(brief.history) ? brief.history : []).forEach((v, i) => {
    checkChanges(v?.changes, `history[${i}].changes`);
    if (typeof v?.version !== "string" || !isTimestamp(v.version)) return;
    if (stamped.has(v.version)) {
      out.push({ path: `history[${i}]`, message: `repeats the version stamp ${v.version}`,
        hint: "each earlier version is one block; merge the two, or fix the stamp" });
    }
    stamped.add(v.version);
    if (isTimestamp(brief.updated ?? "") && Date.parse(v.version) >= Date.parse(brief.updated)) {
      out.push({ path: `history[${i}]`, message: `is stamped ${v.version}, not earlier than the brief's updated stamp (${brief.updated})`,
        hint: "a history block is an earlier version — stamp it with the updated stamp the brief had before this refresh" });
    }
  });

  out.push(...stateErrors(brief), ...bearingErrors(brief), ...referenceErrors(brief), ...enumerationWarnings(brief), ...timestampErrors(brief),
    ...rulingErrors(brief), ...repeatWarnings(brief), ...dependencyErrors(brief), ...reversibleErrors(brief),
    ...estimateWarnings(brief));
  return out;
}

/* ── dependencies between entries ───────────────────────────────────────────
   One ruling often settles the ground another stands on. Saying so lets the
   page rank what waits on the reader by how much each ruling unblocks. */

function dependencyErrors(brief) {
  const out = [];
  const entries = (brief.decisions ?? []).filter(Boolean);
  const byId = new Map(entries.map((e) => [e.id, e]));
  const st = (e) => e.status ?? "open";
  entries.forEach((e, i) => {
    const where = `decisions[${i}] (${e.id})`;
    for (const id of e.blockedBy ?? []) {
      const b = byId.get(id);
      if (id === e.id) {
        out.push({ path: `${where} → blockedBy`, message: "waits on itself", hint: "drop its own id" });
      } else if (!b) {
        out.push({ path: `${where} → blockedBy`, message: `waits on ${id}, which is not an entry on this page`,
          hint: `entries on this page: ${[...byId.keys()].join(", ")}` });
      } else if (["open", "decided"].includes(st(e))) {
        if (st(b) === "superseded") {
          out.push({ path: `${where} → blockedBy`, severity: "warning", message: `waits on ${id}, which is retracted`,
            hint: "the ground it waited on went away — drop the dependency, or retract this entry too" });
        }
        if (e.bearing === "blocks-goal" && st(b) === "open" && b.bearing === "escalated") {
          out.push({ path: `${where} → blockedBy`, severity: "warning",
            message: `blocks the goal and waits on ${id}, which is only escalated`,
            hint: `whatever this waits on stands in the goal's way too — bracket ${id} as blocks-goal, or drop the dependency` });
        }
        if (st(e) === "decided" && st(b) === "open") {
          out.push({ path: `${where} → blockedBy`, severity: "warning", message: `was ruled while ${id}, which it waits on, is still open`,
            hint: `either the dependency is not real, or ${id} needs its ruling before this one is carried out` });
        }
      }
    }
  });
  // A cycle means neither entry can ever be ruled first.
  const state = new Map();
  const visit = (id, trail) => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "active") {
      const loop = trail.slice(trail.indexOf(id)).concat(id);
      out.push({ path: `decisions (${id})`, message: `waits on itself through ${loop.join(" → ")}`,
        hint: "one of these must be ruled first — drop the dependency that is not real" });
      return;
    }
    state.set(id, "active");
    for (const next of byId.get(id)?.blockedBy ?? []) if (byId.has(next) && next !== id) visit(next, [...trail, id]);
    state.set(id, "done");
  };
  for (const e of entries) visit(e.id, []);
  return out;
}

/* ── what cannot be undone ──────────────────────────────────────────────────
   How much the agent may decide alone follows from the cost of being wrong.
   Something that can be undone may be handled without asking; something that
   cannot is always the operator's call. */

function reversibleErrors(brief) {
  const out = [];
  (brief.mechanical ?? []).forEach((m, i) => {
    if (m?.reversible === false) {
      out.push({ path: `mechanical[${i}]`, message: "cannot be undone, so it cannot be handled without asking",
        hint: "make it an entry awaiting a ruling, with the irreversible option marked reversible: false" });
    }
  });
  (brief.decisions ?? []).forEach((e, i) => {
    if (!e || !["open", "decided"].includes(e.status ?? "open")) return;
    const sols = e.solutions ?? [];
    if (sols.length && sols.every((s) => s?.reversible === undefined)) {
      out.push({ path: `decisions[${i}] (${e.id}) → solutions`, severity: "warning",
        message: "says of no option whether it can be undone",
        hint: "mark each option reversible: true or false — the reader weighs an option that cannot be taken back differently" });
    }
  });
  return out;
}

/* ── estimates in the wrong currency ────────────────────────────────────────
   A "two days" figure is a guess at the pace of hand-written code. The work is
   done by agents, several times faster, so the figure misstates the cost. What
   the reader pays is attention, review and risk. */

const TIME_ESTIMATE = /\b(\d+(\.\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|half an?|a couple of|a few|several)[\s-]+(minute|hour|day|week|month|sprint)s?\b/i;

function estimateWarnings(brief) {
  const out = [];
  (brief.decisions ?? []).forEach((e, i) => {
    if (!e || !["open", "decided"].includes(e.status ?? "open")) return;
    (e.solutions ?? []).forEach((s, j) => {
      const hit = s?.cost?.work?.match(TIME_ESTIMATE);
      if (hit) {
        out.push({ path: `decisions[${i}] (${e.id}) → solutions[${j}] → cost → work`, severity: "warning",
          message: `estimates calendar time ("${hit[0]}")`,
          hint: "say what the work consists of and what it needs from the operator — review, a decision, access — not how long it would take by hand" });
      }
    });
  });
  return out;
}

/* ── standing rulings ──────────────────────────────────────────────────────
   The brief's memory of what the operator has already said. A ruling is never
   deleted; one that stops holding points at the ruling that took over, so the
   chain can always be followed to what holds now. */

function rulingErrors(brief) {
  const out = [];
  const rulings = brief.rulings ?? [];
  const entryIds = new Set((brief.decisions ?? []).map((e) => e?.id));
  const seen = new Map();
  rulings.forEach((r, i) => {
    if (!r) return;
    const where = `rulings[${i}]${r.id ? ` (${r.id})` : ""}`;
    if (r.id && seen.has(r.id)) {
      out.push({ path: where, message: `re-uses the id "${r.id}", already used by rulings[${seen.get(r.id)}]`,
        hint: "a ruling is cited by its id, so each must be unique and never reassigned — take the next free number" });
    }
    if (r.id) seen.set(r.id, i);
    if (r.replacedBy) {
      if (r.replacedBy === r.id) {
        out.push({ path: `${where} → replacedBy`, message: "points at itself", hint: "name the later ruling that took over" });
      } else if (!rulings.some((x) => x?.id === r.replacedBy)) {
        out.push({ path: `${where} → replacedBy`, message: `points at ${r.replacedBy}, which is not a ruling on this page`,
          hint: "record the new ruling first, then point the old one at it" });
      }
      if ((r.status ?? "active") === "active") {
        out.push({ path: where, message: `names ${r.replacedBy} as its replacement but is still marked active`,
          hint: 'set status to "replaced" — two rulings on the same question cannot both hold' });
      }
    }
    for (const id of r.entries ?? []) {
      if (!entryIds.has(id)) {
        out.push({ path: `${where} → entries`, message: `names ${id}, which is not an entry on this page`,
          hint: "fix the id, or drop it" });
      }
    }
  });
  (brief.decisions ?? []).forEach((e, i) => {
    for (const ev of [...(e?.evidence ?? []), ...(e?.resolution?.evidence ?? [])]) {
      if (ev?.kind === "ruling" && !seen.has(ev.ref)) {
        out.push({ path: `decisions[${i}]${e.id ? ` (${e.id})` : ""}`, message: `cites the ruling "${ev.ref}", which is not on this page`,
          hint: "a ruling cited as evidence must be recorded in rulings, with its id as the ref" });
      }
    }
  });
  return out;
}

/* ── the same question, asked again ─────────────────────────────────────────
   In a long session the conversation is summarised, and what the operator
   already answered drops out of view. The same problem then comes back under a
   new number, or an answered question is put to the operator again. A cheap
   word-overlap check cannot prove two items are the same, but it can make the
   writer look. */

const STOP = new Set(("that this with from have when which there their them they then than what were been into " +
  "only also does will would should could about after before while where these those other every each more most " +
  "some such just because being over under again still never always entry question").split(" "));

function words(...texts) {
  const out = new Set();
  for (const t of texts) {
    for (const w of String(t ?? "").toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length >= 4 && !STOP.has(w)) out.add(w.replace(/(ing|ed|es|s)$/, ""));
    }
  }
  return out;
}

function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.min(a.size, b.size);
}

const SAME_ENTRY = 0.6;
const ANSWERED = 0.5;

function repeatWarnings(brief) {
  const out = [];
  const entries = (brief.decisions ?? []).filter(Boolean);
  const bag = entries.map((e) => words(e.title, e.short, e.problem));
  const num = (id) => Number(String(id ?? "").split("-")[1]) || 0;
  entries.forEach((e, i) => {
    entries.forEach((f, j) => {
      if (j === i || num(f.id) >= num(e.id)) return;   // report on the later of the two
      const score = overlap(bag[i], bag[j]);
      if (score < SAME_ENTRY) return;
      out.push({ path: `decisions (${e.id})`, severity: "warning",
        message: `reads like ${f.id}, which is ${f.status ?? "open"} — ${Math.round(score * 100)}% of the shorter one's key words are shared`,
        hint: `if it is the same problem, fold the new material into ${f.id} (reopening it if it was closed, and saying what is new) rather than asking it again under a new number` });
    });
  });
  const live = (brief.rulings ?? []).filter((r) => r && (r.status ?? "active") === "active");
  entries.forEach((e, i) => {
    if ((e.status ?? "open") !== "open") return;
    for (const r of live) {
      if ((r.entries ?? []).includes(e.id)) continue;
      const score = overlap(bag[i], words(r.about, r.said));
      if (score < ANSWERED) continue;
      out.push({ path: `decisions (${e.id})`, severity: "warning",
        message: `is awaiting a ruling, but may already be answered by ${r.id}: "${r.about}"`,
        hint: `if ${r.id} answers it, record the ruling on the entry and move it on; if it is genuinely different, add ${e.id} to ${r.id}'s entries only when the ruling bears on it, and say in the entry why the ruling does not settle it` });
    }
  });
  return out;
}

/* ── bearing on the goal ────────────────────────────────────────────────────
   "Awaiting your ruling" used to mean two different things: the work cannot go
   on until you rule, and someone should rule on this some day. Presented side
   by side they compete for the same attention, and the reader ends up deferring
   unrelated questions one at a time. Every live entry now says which it is. */

function bearingErrors(brief) {
  const out = [];
  let blockers = 0;
  (brief.decisions ?? []).forEach((e, i) => {
    if (!e) return;
    const where = `decisions[${i}]${e.id ? ` (${e.id})` : ""}`;
    const st = e.status ?? "open";
    const live = st === "open" || st === "decided";
    if (live && !e.bearing) {
      out.push({ path: where, message: `is ${st === "open" ? "awaiting a ruling" : "ruled but not carried out"} and has no bearing`,
        hint: 'set bearing to "blocks-goal" if the goal cannot be reached without it, or "escalated" if it is a real decision that can wait — plus a one-line bearingReason' });
    }
    if (e.bearing && !e.bearingReason) {
      out.push({ path: `${where} → bearingReason`, message: `is missing — the entry is marked ${e.bearing} without saying why`,
        hint: "one line on why this is, or is not, on the goal's path" });
    }
    if (live && e.bearing === "blocks-goal") blockers++;
  });
  if (blockers && !brief.goal) {
    out.push({ path: "goal", message: `is missing, but ${blockers} entr${blockers === 1 ? "y blocks" : "ies block"} it`,
      hint: "state the goal in the operator's own words — an entry can only block a goal the page names" });
  }
  return out;
}

/* ── citations ──────────────────────────────────────────────────────────────
   Prose cites entries by id, and the page turns each citation into a link. A
   citation to an id that is not on the page is a dead link and, usually, a typo. */

const CITED = /\b[QR]-\d+\b/g;
/* Ids cited as this brief's own: bare, or under its binding's prefix. An id
   under another prefix points at another brief and is not checked here. */
const PREFIXED = /(?:\b([A-Za-z0-9][A-Za-z0-9._#-]*)\/)?\b([QR]-\d+)\b/g;
const ownCitations = (text, brief) =>
  [...String(text).matchAll(PREFIXED)].filter((m) => !m[1] || m[1] === brief.binding?.ref).map((m) => m[2]);

/* Three or more entries named in one sentence is a list written as prose: the
   reader has to unpick it, and the page cannot group it. */
function enumerationWarnings(brief) {
  const out = [];
  const walk = (v, path) => {
    if (typeof v === "string") {
      const hit = v.split(/(?<=[.!?])\s+/).find((sentence) => new Set(sentence.match(CITED) ?? []).size >= 3);
      if (hit) out.push({ path, severity: "warning", message: "names three or more entries in one sentence — write them as a list",
        hint: "one line per entry with what it is, e.g. a dash list, or typed changes in the summary" });
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) if (!["id", "rolledUp", "evidence"].includes(k)) walk(x, path ? `${path} → ${k}` : k);
    }
  };
  walk(brief, "");
  return out;
}

function referenceErrors(brief) {
  const ids = new Set([...(brief.decisions ?? []), ...(brief.rulings ?? [])].map((x) => x?.id));
  const seen = new Set();
  const out = [];
  const walk = (v, path) => {
    if (typeof v === "string") {
      for (const id of ownCitations(v, brief)) {
        if (ids.has(id) || seen.has(`${path}|${id}`)) continue;
        seen.add(`${path}|${id}`);
        out.push({ path, severity: "warning", message: `cites ${id}, which is not ${id.startsWith("R-") ? "a ruling" : "an entry"} on this page`,
          hint: `fix the id, or add the ${id.startsWith("R-") ? "ruling" : "entry"} it refers to` });
      }
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) if (k !== "id") walk(x, path ? `${path} → ${k}` : k);
    }
  };
  walk(brief, "");

  /* A cited entry is shown with its short label; without one the page cuts a
     label from the title, which reads worse than one the author chose. Only
     citations from outside the entry itself count. */
  const citedBy = new Map();
  const collect = (v, owner) => {
    if (typeof v === "string") {
      for (const id of ownCitations(v, brief)) if (id !== owner) citedBy.set(id, true);
    } else if (Array.isArray(v)) v.forEach((x) => collect(x, owner));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (k !== "id") collect(x, owner);
  };
  for (const [k, v] of Object.entries(brief)) {
    if (k === "decisions" && Array.isArray(v)) v.forEach((e) => collect(e, e?.id));
    else collect(v, null);
  }
  (brief.decisions ?? []).forEach((e, i) => {
    if (!e?.id) return;
    const at = `decisions[${i}] (${e.id})`;
    if (citedBy.has(e.id) && !e.short) {
      out.push({ path: at, severity: "warning", message: 'is cited elsewhere on the page but has no "short" label',
        hint: `the page cuts a label from the title instead — give it one of five words or fewer, e.g. "short": "${suggestShort(e.title)}"` });
    }
    if (typeof e.short === "string" && e.short.trim().split(/\s+/).length > 5) {
      out.push({ path: `${at} → short`, severity: "warning", message: "is longer than five words",
        hint: "it follows the id in running text, so it has to be brief — the title is where the detail goes" });
    }
  });
  return out;
}

function suggestShort(title) {
  return String(title ?? "").toLowerCase().split(/\s+/).slice(0, 5).join(" ");
}

/* ── state that contradicts its own record ──────────────────────────────────
   The most common way a refreshed brief goes wrong is an item whose status was
   never moved along: a ruling recorded on an entry still marked open, a proof of
   completion on an entry still marked decided. The record says one thing and
   the chip says another, and the reader believes the chip. */

function stateErrors(brief) {
  const out = [];
  (brief.decisions ?? []).forEach((e, i) => {
    if (!e) return;
    const where = `decisions[${i}]${e.id ? ` (${e.id})` : ""}`;
    const st = e.status ?? "open";
    if (st === "open" && e.decision) {
      out.push({ path: where, message: "records a ruling but is still marked open",
        hint: 'set status to "decided" — or "complete" with a resolution, if it has since been carried out' });
    }
    if ((st === "open" || st === "decided") && e.resolution) {
      out.push({ path: where, message: `records a resolution but is still marked ${st}`,
        hint: 'set status to "complete" — the resolution says it was carried out' });
    }
    if (e.decision?.chose && !(e.solutions ?? []).some((s) => s?.id === e.decision.chose)) {
      out.push({ path: `${where} → decision`, message: `chose "${e.decision.chose}", which is not one of this entry's options`,
        hint: `options here: ${(e.solutions ?? []).map((s) => s?.id).join(", ")}` });
    }
  });
  return out;
}

/* ── timestamps ─────────────────────────────────────────────────────────────
   Every item carries when it was written and when it last changed. The stamps
   must agree with each other and with the dates the item records, or the page
   is claiming a history that did not happen — usually because something was
   edited and its stamp was not moved. */

function timestampErrors(brief) {
  const out = [];
  const t = (v) => (typeof v === "string" && isTimestamp(v) ? Date.parse(v) : null);
  const day = (v) => (typeof v === "string" && isTimestamp(v) ? v.slice(0, 10) : null);
  const briefCreated = t(brief.created);
  const briefUpdated = t(brief.updated);

  if (briefCreated !== null && briefUpdated !== null && briefUpdated < briefCreated) {
    out.push({ path: "updated", message: "is earlier than created", hint: "a brief cannot change before it was written" });
  }
  if (brief.generated) {
    out.push({ path: "generated", severity: "warning",
      message: "is retired — the page shows one stamp, updated, and re-checking the facts moves it",
      hint: "delete generated; when you re-check every item's state and claim, move the brief's updated stamp to that moment" });
  }

  const item = (x, where) => {
    if (!x) return;
    const c = t(x.created), u = t(x.updated);
    if (c !== null && u !== null && u < c) {
      out.push({ path: where, message: "was updated before it was created", hint: "updated can never be earlier than created" });
    }
    if (c !== null && briefCreated !== null && c < briefCreated) {
      out.push({ path: where, message: "was created before the brief itself",
        hint: "move the brief's created back, or the item's forward" });
    }
    if (u !== null && briefUpdated !== null && u > briefUpdated) {
      out.push({ path: where, message: `changed at ${x.updated}, after the brief's own updated stamp (${brief.updated})`,
        hint: "move the brief's updated stamp whenever any item on it changes" });
    }
    return day(x.updated);
  };

  (brief.decisions ?? []).forEach((e, i) => {
    const where = `decisions[${i}]${e?.id ? ` (${e.id})` : ""}`;
    const changed = item(e, where);
    if (!changed) return;
    for (const [label, date] of [["ruling", e.decision?.date], ["resolution", e.resolution?.date]]) {
      if (date && date > changed) {
        out.push({ path: where, message: `records a ${label} dated ${date} but says it last changed ${changed}`,
          hint: "recording a ruling or a resolution is a change — move updated to when you recorded it" });
      }
    }
    if (e.decision?.date && e.resolution?.date && e.resolution.date < e.decision.date) {
      out.push({ path: `${where} → resolution`, message: `is dated ${e.resolution.date}, before the ruling (${e.decision.date})`,
        hint: "an option cannot be carried out before it was chosen" });
    }
  });
  (brief.mechanical ?? []).forEach((m, i) => item(m, `mechanical[${i}]`));
  (brief.outstanding ?? []).forEach((o, i) => item(o, `outstanding[${i}]`));
  (brief.rulings ?? []).forEach((r, i) => item(r, `rulings[${i}]${r?.id ? ` (${r.id})` : ""}`));
  return out;
}

const ordinal = (n) => ["", "first", "second", "third", "fourth", "fifth"][n] ?? `${n}th`;

/* ── public entry point ─────────────────────────────────────────────────── */

export function validateBrief(brief, schema) {
  const v = new Validator(schema ?? JSON.parse(readFileSync(SCHEMA_PATH, "utf8")));
  v.check(brief, v.root, "");
  const all = [...v.errors, ...semanticErrors(brief)];
  return {
    ok: all.every((e) => e.severity === "warning"),
    errors: all.filter((e) => e.severity !== "warning"),
    warnings: all.filter((e) => e.severity === "warning"),
  };
}

export function formatReport(result, file) {
  const lines = [];
  const say = (list, heading) => {
    if (!list.length) return;
    lines.push("", heading);
    for (const e of list) {
      lines.push(`  ${e.path || "the brief"} ${e.message}`);
      if (e.hint) lines.push(`      → ${e.hint}`);
    }
  };
  if (result.ok && !result.warnings.length) return `${file} is a valid problem brief.`;
  if (result.ok) lines.push(`${file} is valid, with ${result.warnings.length} thing${result.warnings.length === 1 ? "" : "s"} worth fixing.`);
  else lines.push(`${file} cannot be rendered yet — ${result.errors.length} problem${result.errors.length === 1 ? "" : "s"}.`);
  say(result.errors, "Must fix:");
  say(result.warnings, "Worth fixing:");
  return lines.join("\n");
}

/* ── CLI ────────────────────────────────────────────────────────────────── */

// Compare real paths. A hand-built file:// string never matched on Windows
// (backslashes), in a path with a space, or through a symlink such as an
// install.sh --link install, and the CLI then printed nothing and exited 0.
const invokedDirectly = () => {
  try { return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
};
if (process.argv[1] && invokedDirectly()) {
  const file = process.argv[2];
  const asJson = process.argv.includes("--json");
  if (!file) {
    console.error("usage: validate-brief.mjs <brief.json> [--json]");
    process.exit(2);
  }
  let brief;
  try {
    brief = JSON.parse(readFileSync(resolve(file), "utf8"));
  } catch (err) {
    // A JSON syntax error is the most common failure of all when a file is
    // generated, so it gets the line and column rather than a bare throw.
    console.error(`${file} is not valid JSON.\n  ${err.message}`);
    process.exit(1);
  }
  const result = validateBrief(brief);
  if (asJson) console.log(JSON.stringify(result, null, 2));
  else console.log(formatReport(result, file));
  process.exit(result.ok ? 0 : 1);
}
