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
 *      price, a closed entry must carry proof.
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
          const d = this.deref(schema.properties?.[req])?.description;
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

  const ids = new Set((brief.decisions ?? []).map((e) => e?.id));
  (brief.outstanding ?? []).forEach((o, i) => {
    if (o?.blockedBy && !ids.has(o.blockedBy)) {
      out.push({ path: `outstanding[${i}]`, message: `waits on "${o.blockedBy}", which is not an entry on this page`,
        hint: `entries on this page: ${[...ids].join(", ") || "none"}` });
    }
  });

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
