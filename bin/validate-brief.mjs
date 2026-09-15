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
 *
 * Errors are written for whoever has to fix them — a readable path, what is
 * wrong, and what to do about it. An unknown field is matched against the
 * fields that do exist, so a typo comes back as a suggestion rather than a
 * shrug.
 *
 * Zero dependencies, so the schema keywords understood here are exactly the
 * ones the bundled schema uses. Node 18+.
 */

import { readFileSync } from "node:fs";
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
  (brief.changes ?? []).forEach((c, i) => {
    const where = `changes[${i}]`;
    if (typeof c === "string") {
      out.push({ path: where, severity: "warning", message: "has no kind, so it is shown last among the notes",
        hint: `write it as { "kind": …, "text": … } with kind one of ${KINDS.join(", ")}` });
    } else if (c && typeof c === "object" && !KINDS.includes(c.kind)) {
      const guess = typeof c.kind === "string" ? nearest(c.kind, KINDS) : null;
      out.push({ path: `${where} → kind`, message: `is ${JSON.stringify(c.kind)}, which is not a transition`,
        hint: (guess ? `did you mean "${guess}"? ` : "") + `use one of: ${KINDS.join(", ")}` });
    }
  });

  out.push(...stateErrors(brief), ...bearingErrors(brief), ...referenceErrors(brief), ...timestampErrors(brief));
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

const CITED = /\bQ-\d+\b/g;

function referenceErrors(brief) {
  const ids = new Set((brief.decisions ?? []).map((e) => e?.id));
  const seen = new Set();
  const out = [];
  const walk = (v, path) => {
    if (typeof v === "string") {
      for (const id of v.match(CITED) ?? []) {
        if (ids.has(id) || seen.has(`${path}|${id}`)) continue;
        seen.add(`${path}|${id}`);
        out.push({ path, severity: "warning", message: `cites ${id}, which is not an entry on this page`,
          hint: "fix the id, or add the entry it refers to" });
      }
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) if (k !== "id") walk(x, path ? `${path} → ${k}` : k);
    }
  };
  walk(brief, "");
  return out;
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

if (import.meta.url === `file://${process.argv[1]}`) {
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
