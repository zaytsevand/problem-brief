#!/usr/bin/env node
/**
 * Render a problem brief from JSON into a single self-contained artefact page.
 *
 *   node render-brief.mjs brief.json out/index.html
 *
 * The layout is fixed on purpose. Content comes from the JSON; nothing about the
 * shape of the page is decided per-brief. That is the point: the reader learns
 * one layout once.
 *
 * Output is written for the Artifact tool, so it carries no <!doctype>, <html>,
 * <head> or <body> tags — those are supplied at publish time.
 *
 * Zero dependencies. Node 18+.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { validateBrief, formatReport } from "./validate-brief.mjs";

/* One drawing bigger than this is not worth carrying inside the page. */
const INLINE_MAX_BYTES = 4 * 1024 * 1024;
/* Past this the whole page is heavy, well before the 16 MB ceiling. */
const PAGE_WARN_BYTES = 6 * 1024 * 1024;

const notes = { inlined: 0, companions: new Set(), problems: [] };
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/* ── text ──────────────────────────────────────────────────────────────────
   A deliberately small subset of markdown: paragraphs, dash lists, bold,
   inline code and links. Anything more belongs in a diagram or a solution.   */

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/* Entries on this page, so a citation in any text can become a link. Set once
   per page, before anything is rendered. */
let ENTRIES = new Map();

/* Every entry id in running text becomes a link to that entry. A bare id also
   carries the entry's short label, because an id alone means nothing to a reader
   who does not hold every entry in their head. An id the author already put in
   brackets after the meaning — "its log entry (Q-33)" — is left unlabelled, so
   the meaning is not said twice. */
function citations(html) {
  let inTag = 0;
  const labelled = new Set();  // label an id once per passage, not every time it recurs
  return html.split(/(<[^>]+>)/).map((part) => {
    if (part.startsWith("<")) {
      if (/^<(a|code)[\s>]/.test(part)) inTag++;
      else if (/^<\/(a|code)>/.test(part)) inTag--;
      return part;
    }
    if (inTag) return part;
    return part.replace(/(\()?\b(Q-\d+)\b(?!\s*\()/g, (m, open, id) => {
      const e = ENTRIES.get(id);
      if (!e) return m;
      const label = e.short && !open && !labelled.has(id) ? ` (${esc(e.short)})` : "";
      labelled.add(id);
      return `${open ?? ""}<a class="qref" href="#${id}" title="${esc(e.title)}">${id}${label}</a>`;
    });
  }).join("");
}

function inline(s, { refs = true } = {}) {
  const html = esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return refs ? citations(html) : html;
}

/* Paragraphs, and dash or numbered lists — including a lead-in line followed
   directly by its list, which is how people actually write one. */
function prose(s) {
  if (!s) return "";
  const LIST = /^(-|\d+\.)\s+/;
  return String(s).trim().split(/\n\s*\n/).map((b) => {
    const lines = b.split("\n").map((l) => l.trim()).filter(Boolean);
    const runs = [];
    for (const l of lines) {
      const kind = LIST.test(l) ? (l.startsWith("-") ? "ul" : "ol") : "p";
      const last = runs.at(-1);
      if (last && last.kind === kind) last.lines.push(l);
      else runs.push({ kind, lines: [l] });
    }
    return runs.map((r) => r.kind === "p"
      ? `<p>${inline(r.lines.join(" "))}</p>`
      : `<${r.kind}>${r.lines.map((l) => `<li>${inline(l.replace(LIST, ""))}</li>`).join("")}</${r.kind}>`).join("");
  }).join("");
}

/* A timestamp is shown exactly as written — date, time and its own zone — so
   two readers in different places read the same moment. */
function stamp(v) {
  if (!v) return "";
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/);
  const text = m ? `${m[1]} ${m[2]} ${m[3] === "Z" ? "UTC" : m[3]}` : String(v);
  return `<time datetime="${esc(v)}">${esc(text)}</time>`;
}

const stamps = (x, first = "added") =>
  `${first} ${stamp(x.created)}` + (x.updated && x.updated !== x.created ? ` · last changed ${stamp(x.updated)}` : "");

/* ── diagrams ───────────────────────────────────────────────────────────── */

function diagram(d, baseDir) {
  const cap = `<figcaption>${inline(d.caption)}</figcaption>`;
  if (d.kind === "mermaid") {
    // Artifacts render mermaid natively — no library to load.
    return `<figure class="dgm"><pre class="mermaid">${esc(d.source.trim())}</pre>${cap}</figure>`;
  }
  if (d.kind === "svg") {
    const raw = readFileSync(resolve(baseDir, d.file), "utf8");
    const svg = raw.slice(raw.indexOf("<svg"));
    return `<figure class="dgm"><div class="dgm-svg">${svg}</div>${cap}</figure>`;
  }

  /* archify: the real page in its own frame, so its stylesheet cannot reach
     this one and the drawing keeps everything it can do — guided views, the
     focus control, hovering a step for its detail.

     It runs in archify's presentation mode, which centres the drawing and
     scales it to whatever room the frame has. The frame is then given the
     drawing's own proportions, plus a fixed allowance for archify's title bar
     and view buttons, so nothing is cropped and nothing is letterboxed. */
  const ratio = archifyShape(d, baseDir);          // height ÷ width of the drawing
  const chrome = 128;                              // title bar and view buttons, in pixels
  const sizing = d.height
    ? `height:${d.height}px`
    : `height:calc(100cqw * ${ratio.toFixed(4)} + ${chrome}px);min-height:${Math.round(360 * ratio) + chrome}px`;
  const spec = d.spec
    ? `<p class="dgm-src">Picture source: <code>${esc(d.spec)}</code> — edit that and re-render, never redraw.</p>`
    : "";

  /* A brief is published as one file, and not every publishing tool can carry a
     companion alongside it. A frame pointing at a companion that never arrives
     is a blank box — the one outcome worth ruling out — so by default the whole
     drawing goes inside the page. It costs about a tenth more bytes than the
     drawing itself and depends on nothing. */
  if (d.embed === "file") {
    notes.companions.add(d.file);
    return `<figure class="dgm dgm-fit">` +
      `<iframe class="dgm-frame" data-archify="${esc(d.file)}" src="${esc(d.file)}?present=1" ` +
      `style="${sizing}" loading="lazy" title="${esc(d.caption)}"></iframe>` +
      `<p class="dgm-open"><a href="${esc(d.file)}" target="_blank" rel="noopener">` +
      `Open this picture on its own →</a></p>` +
      `${cap}${spec}</figure>`;
  }

  let raw;
  try {
    raw = readFileSync(resolve(baseDir, d.file), "utf8");
  } catch {
    notes.problems.push(`${d.file} could not be read — its drawing is a note on the page instead of a picture`);
    return missingDiagram(d, "the rendered drawing could not be read");
  }
  if (raw.length > INLINE_MAX_BYTES) {
    notes.problems.push(`${d.file} is ${mb(raw.length)}, too large to carry inside the page — its drawing is a note instead. ` +
      `Simplify it, or set "embed": "file" if your publishing tool can carry companion files.`);
    return missingDiagram(d, `the drawing is ${mb(raw.length)}, too large to carry inside the page`);
  }

  notes.inlined += raw.length;
  /* A framed document has no query string, which is how archify is normally
     told to show the drawing alone. Tell it from the inside instead. */
  const framed = raw + `\n<script>document.documentElement.setAttribute('data-present','true');</script>`;
  return `<figure class="dgm dgm-fit">` +
    `<iframe class="dgm-frame" data-archify-inline="1" srcdoc="${esc(framed)}" ` +
    `style="${sizing}" loading="lazy" title="${esc(d.caption)}"></iframe>` +
    `${cap}${spec}</figure>`;
}

/* A drawing that cannot be carried becomes a visible, honest note. Never an
   empty frame: a reader cannot tell one from a broken page, and the drawing was
   there to explain something. */
function missingDiagram(d, why) {
  const where = d.spec || d.file;
  return `<figure class="dgm dgm-absent">` +
    `<div class="absent"><strong>This picture could not be included.</strong> ` +
    `<span>${esc(why)}.</span>` +
    (where ? ` <span>It is drawn from <code>${esc(where)}</code>.</span>` : "") +
    `</div><figcaption>${inline(d.caption)}</figcaption></figure>`;
}

/* The drawing's proportions come from the archify source where we have it, and
   from the rendered drawing's own coordinate box otherwise. Wrong proportions
   are what crop a drawing, so guessing is a last resort. */
function archifyShape(d, baseDir) {
  const clamp = (r) => Math.min(1.4, Math.max(0.35, r));
  if (d.spec) {
    try {
      const box = JSON.parse(readFileSync(resolve(baseDir, d.spec), "utf8"))?.meta?.viewBox;
      if (Array.isArray(box) && box[0] > 0 && box[1] > 0) return clamp(box[1] / box[0]);
    } catch { /* fall through to the rendered file */ }
  }
  try {
    const html = readFileSync(resolve(baseDir, d.file), "utf8");
    const m = html.match(/<svg[^>]*viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    if (m) return clamp(Number(m[2]) / Number(m[1]));
  } catch { /* fall through to the default */ }
  return 0.62;
}

const FILTER_SCRIPT = `
(function(){
  // Everything is in the document and visible before this runs, so a page with
  // no scripting still shows the whole brief. The filter only narrows it.
  var KEY = 'problem-brief-filter';
  var bar = document.querySelector('.filters');
  if (!bar) return;
  var buttons = [].slice.call(bar.querySelectorAll('[data-filter]'));
  var entries = [].slice.call(document.querySelectorAll('.entry[data-state]'));
  var blocks  = [].slice.call(document.querySelectorAll('[data-block]'));
  var tocRows = [].slice.call(document.querySelectorAll('.toc li[data-state]'));
  var tocHead = document.querySelector('[data-toc-head]');
  var tocNav  = document.querySelector('nav.toc');
  var empty   = document.querySelector('.toc .empty');
  var HEADS = {
    blocks: 'What blocks the goal', escalated: 'Escalated, not blocking the goal',
    open: 'What needs deciding',
    complete: 'Completed', superseded: 'Retracted',
    mechanical: 'Fixed without asking', outstanding: 'Outstanding work', all: 'Everything on this page'
  };

  function has(name){ return buttons.some(function(b){ return b.dataset.filter === name; }); }

  function apply(name, remember){
    if (!has(name)) name = 'all';
    var isState = ['blocks','escalated','open','outstanding','complete','superseded'].indexOf(name) > -1;
    function shown(el){ return name === 'all' || el.dataset.state === name || (name === 'outstanding' && el.dataset.state === 'decided'); }
    entries.forEach(function(el){ el.hidden = !shown(el); });
    tocRows.forEach(function(el){ el.hidden = !shown(el); });
    blocks.forEach(function(el){ el.hidden = !(name === 'all' || el.dataset.block === name); });
    // The contents list only earns its place when it lists entries.
    if (tocNav) tocNav.hidden = !(name === 'all' || isState);
    if (tocHead) tocHead.textContent = HEADS[name] || HEADS.all;
    // With one state selected every row would repeat the same label.
    tocRows.forEach(function(el){
      var m = el.querySelector('.done'); if (m) m.hidden = isState;
    });
    if (empty) empty.hidden = tocRows.some(function(el){ return !el.hidden; });
    buttons.forEach(function(b){ b.setAttribute('aria-pressed', String(b.dataset.filter === name)); });
    if (remember) { try { localStorage.setItem(KEY, name); } catch (_) {} }
  }

  bar.addEventListener('click', function(ev){
    var b = ev.target.closest('[data-filter]');
    if (b) apply(b.dataset.filter, true);
  });

  // A link to an entry must always reach it, whatever the filter was.
  function reveal(){
    var id = (location.hash || '').slice(1);
    if (!id) return false;
    var el = document.getElementById(id);
    if (!el || !el.dataset.state) return false;
    apply(el.dataset.state === 'decided' ? 'outstanding' : el.dataset.state, false);
    el.scrollIntoView();
    return true;
  }
  window.addEventListener('hashchange', reveal);

  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (_) {}
  if (!reveal()) apply(saved || DEFAULT_FILTER, false);
})();
`;

const STATE_LABEL = {
  blocks: "Blocks the goal",
  escalated: "Escalated, not blocking",
  open: "Awaiting your ruling",
  decided: "Outstanding work",
  complete: "Complete",
  superseded: "Retracted",
};
/* An entry awaiting a ruling is split by its bearing on the goal: what stops the
   goal comes first and is what the page opens on; a real decision that can wait
   stays visible without competing for the same attention. */
const STATE_ORDER = ["blocks", "open", "escalated", "decided", "complete", "superseded"];
const group = (e) => {
  const st = e.status ?? "open";
  if (st !== "open") return st;
  return { "blocks-goal": "blocks", escalated: "escalated" }[e.bearing] ?? "open";
};
const BEARING = { "blocks-goal": "tag-block", escalated: "tag-alt" };

/* Carried out, but not quite as ruled: the implementer drifted by their own
   decision and recorded what, and why. The old free-text `differs` is not
   counted — it mixed drifts with plain remarks, and a remark is not an amendment. */
const amendmentsOf = (e) => (e?.status === "complete" ? e.resolution?.amendments ?? [] : []);

/* ── entry ──────────────────────────────────────────────────────────────── */

const EV_LABEL = {
  code: "Code", document: "Document", finding: "Earlier finding",
  run: "Run", commit: "Commit", test: "Test", measurement: "Measurement",
};

function evidence(list) {
  const rows = list.map((ev) => {
    const unproven = ev.verified === false ? `<span class="tag tag-warn">not yet proven</span>` : "";
    const ref = ev.url
      ? `<a href="${esc(ev.url)}" target="_blank" rel="noopener"><code>${esc(ev.ref)}</code></a>`
      : `<code>${esc(ev.ref)}</code>`;
    return `<li><span class="ev-kind">${esc(EV_LABEL[ev.kind] ?? ev.kind)}</span>` +
      `<span class="ev-ref">${ref}${unproven}</span>` +
      `<span class="ev-note">${inline(ev.note)}</span></li>`;
  }).join("");
  return `<ul class="ev">${rows}</ul>`;
}

function solutions(list) {
  return list.map((s, i) => {
    const badge = s.recommended
      ? `<span class="tag tag-rec">Recommended</span>`
      : `<span class="tag tag-alt">Alternative</span>`;
    const cost = [
      ["Work", s.cost.work],
      ["Risk", s.cost.risk],
      ["Rules out", s.cost.forecloses],
    ].filter(([, v]) => v).map(([k, v]) =>
      `<div class="cost-row"><dt>${k}</dt><dd>${inline(v)}</dd></div>`).join("");
    const steps = s.steps?.length
      ? `<ol class="steps">${s.steps.map((x) => `<li>${inline(x)}</li>`).join("")}</ol>` : "";
    return `<article class="sol${s.recommended ? " sol-rec" : ""}">` +
      `<header><span class="sol-n">${i + 1}</span><h4>${inline(s.label)}</h4>${badge}</header>` +
      `${prose(s.summary)}${steps}<dl class="cost">${cost}</dl></article>`;
  }).join("");
}

function entry(e, baseDir) {
  const u = e.unwound ?? {};
  const dgms = (u.diagrams ?? []).map((d) => diagram(d, baseDir)).join("");

  const unwound = (u.now || u.target || dgms)
    ? `<section class="part"><h3>How it works today${u.whyWrong ? ", and why that is a problem" : ""}</h3>` +
      (u.now ? prose(u.now) : "") + dgms +
      (u.whyWrong ? `<div class="why"><h4>Why that is wrong</h4>${prose(u.whyWrong)}</div>` : "") +
      (u.target ? `<div class="target"><h4>Where it should end up</h4>${prose(u.target)}</div>` : "") +
      `</section>`
    : "";

  const rolled = e.rolledUp?.length
    ? `<details class="rolled"><summary>${e.rolledUp.length} finding${e.rolledUp.length > 1 ? "s" : ""} rolled into this one</summary>` +
      `<ul>${e.rolledUp.map((r) => `<li>${inline(r)}</li>`).join("")}</ul></details>` : "";

  const assume = e.assumptions?.length
    ? `<div class="assume"><h4>Not yet proven</h4><ul>${e.assumptions.map((a) => `<li>${inline(a)}</li>`).join("")}</ul></div>` : "";

  const chosen = (id) => inline(e.solutions.find((s) => s.id === id)?.label ?? id);

  const ruled = e.decision
    ? `<div class="ruled"><strong>Ruled ${esc(e.decision.date)}:</strong> ${chosen(e.decision.chose)}` +
      (e.decision.note ? ` — ${inline(e.decision.note)}` : "") + `</div>`
    : "";

  const r = e.resolution;
  const closed = e.status === "complete"
    ? `<div class="ruled ruled-done"><strong>Completed ${esc(r.date)}.</strong>` +
      (r.note ? ` ${inline(r.note)}` : "") +
      (r.differs ? `<div class="differs"><strong>Landed differently:</strong> ${inline(r.differs)}</div>` : "") +
      (amendmentsOf(e).length ? `<div class="amended"><h4>Amended while carried out</h4>` +
        amendmentsOf(e).map((a) => `<dl class="amend">` +
          (a.ruled ? `<div><dt>Ruled</dt><dd>${inline(a.ruled)}</dd></div>` : "") +
          `<div><dt>Done instead</dt><dd>${inline(a.done)}</dd></div>` +
          (a.why ? `<div><dt>Why</dt><dd>${inline(a.why)}</dd></div>` : "") + `</dl>`).join("") + `</div>` : "") +
      (r.evidence?.length ? evidence(r.evidence) : "") + `</div>`
    : e.status === "superseded"
      ? `<div class="ruled ruled-old">Retracted — the problem went away or was overtaken, so nothing was carried out. Kept for the record.</div>`
      : "";

  const status = closed + ruled;

  const state = e.status ?? "open";
  const g = group(e);
  const live = state === "open" || state === "decided";
  /* The bearing is named once, in the header. An open entry's state chip
     already is its bearing; a ruled one's says "Outstanding work", so the
     bearing gets a chip of its own beside it. The body keeps only the reason. */
  const bearingChip = live && e.bearing && state !== "open"
    ? `<span class="tag ${BEARING[e.bearing]}">${esc(STATE_LABEL[e.bearing === "blocks-goal" ? "blocks" : "escalated"])}</span>`
    : "";
  const bearing = live && e.bearing ? `<p class="bearing">${inline(e.bearingReason)}</p>` : "";
  return `<section class="entry${state !== "open" ? " entry-closed" : ""}" id="${esc(e.id)}" data-state="${g}">
  <header class="entry-head">
    <a class="qid" href="#${esc(e.id)}">${esc(e.id)}</a>
    <h2>${inline(e.title, { refs: false })}</h2>
    ${amendmentsOf(e).length
      ? `<span class="chip chip-${g} chip-amended chip-static">${esc(STATE_LABEL[g])} · amended</span>`
      : `<span class="chip chip-${g} chip-static">${esc(STATE_LABEL[g])}</span>`}${bearingChip}
  </header>
  <p class="stamps">${stamps(e, "raised")}</p>
  ${bearing}
  ${status}
  <section class="part part-problem"><h3>The problem</h3>${prose(e.problem)}</section>
  <section class="part"><h3>Why it matters</h3>${prose(e.brief)}</section>
  <section class="part"><h3>Evidence</h3>${evidence(e.evidence)}${assume}</section>
  ${unwound}
  <section class="part part-sol"><h3>Options</h3>${solutions(e.solutions)}</section>
  ${rolled}
</section>`;
}

/* ── transitions ────────────────────────────────────────────────────────────
   What moved since the last version, grouped by the kind of move and always in
   the same order: what is new, what changed, then what closed. Each kind has
   its own mark, drawn rather than typed so it keeps its shape in every font and
   takes its colour from the theme. Shape carries the meaning; colour repeats it. */

const TRANSITIONS = [
  ["raised", "New", '<circle cx="8" cy="8" r="6.25"/><path d="M8 5v6M5 8h6"/>'],
  ["changed", "Changed", '<circle cx="8" cy="8" r="6.25"/><path d="M4.75 8h6.25M8.75 5.5 11.25 8l-2.5 2.5"/>'],
  ["completed", "Done", '<circle cx="8" cy="8" r="6.25" class="fill"/><path d="m5.1 8.2 2 2 3.8-4.2" class="knock"/>'],
  ["amended", "Done, amended", '<circle cx="8" cy="8" r="6.25"/><path d="m5.1 8.2 2 2 3.8-4.2"/>'],
  ["retracted", "Retracted", '<circle cx="8" cy="8" r="6.25"/><path d="M4.6 11.4 11.4 4.6"/>'],
  ["note", "Notes", '<circle cx="8" cy="8" r="2" class="fill"/>'],
];

const trIcon = (kind) => `<svg class="tr-icon tr-${kind}" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">` +
  `${TRANSITIONS.find(([k]) => k === kind)[2]}</svg>`;
const changeText = (c) => inline(typeof c === "string" ? c : c.text);

/* New additions are what the reader has never seen, so they are pinned above
   everything else on the page whatever their weight — and within them, what
   stands in the goal's way comes first. */
function newAdditions(list) {
  const raised = list.filter((c) => typeof c === "object" && c.kind === "raised");
  if (!raised.length) return "";
  const bearingOf = (c) => {
    const id = c.id ?? String(c.text).match(/\bQ-\d+\b/)?.[0];
    const e = id && ENTRIES.get(id);
    const live = e && ((e.status ?? "open") === "open" || e.status === "decided");
    return live && e.bearing ? e.bearing : "other";
  };
  const groups = [["blocks-goal", "Blocks the goal"], ["escalated", "Escalated, not blocking"], ["other", "Other new work"]];
  return `<section class="new-additions"><h2>New since the last version</h2><div class="tr">` +
    groups.map(([key, label]) => {
      const items = raised.filter((c) => bearingOf(c) === key);
      if (!items.length) return "";
      return `<div class="tr-group" data-bearing="${key}"><h3 class="tr-head">${label}<span class="tr-n">${items.length}</span></h3><ul>` +
        items.map((c) => `<li>${trIcon("raised")}<span>${changeText(c)}</span></li>`).join("") + `</ul></div>`;
    }).join("") + `</div></section>`;
}

function transitions(list) {
  const kindOf = (c) => (typeof c === "string" ? "note" : c.kind);  // an untyped line is a note
  return `<div class="tr">` + TRANSITIONS.filter(([kind]) => kind !== "raised").map(([kind, label, glyph]) => {
    if (kind === "amended") return "";
    let items = list.filter((c) => kindOf(c) === kind);
    if (!items.length) return "";
    const amended = (c) => {
      if (kind !== "completed" || typeof c === "string") return false;
      const id = c.id ?? String(c.text).match(/\bQ-\d+\b/)?.[0];
      return amendmentsOf(ENTRIES.get(id)).length > 0;
    };
    // What landed differently from the ruling is what the reader must look at.
    items = [...items.filter(amended), ...items.filter((c) => !amended(c))];
    const icon = `<svg class="tr-icon tr-${kind}" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${glyph}</svg>`;
    return `<div class="tr-group" data-kind="${kind}"><h3 class="tr-head">${label}` +
      `<span class="tr-n">${items.length}</span></h3><ul>` +
      items.map((c) => amended(c)
        ? `<li class="amended-item">${trIcon("amended")}<span>${changeText(c)} <span class="tag tag-amended">amended</span></span></li>`
        : `<li>${icon}<span>${changeText(c)}</span></li>`).join("") +
      `</ul></div>`;
  }).join("") + `</div>`;
}

/* ── page ───────────────────────────────────────────────────────────────── */

const CSS = `
/* A case file, not a brochure: cool paper, ink, one indigo for reference marks.
   Green and amber are the only other hues and both mean something. */
:root{
  --bg:#f3f4f7; --card:#fff; --ink:#13161b; --ink-2:#474d57; --ink-3:#737a85;
  --line:#dde1e7; --line-2:#c2c8d1; --accent:#2f4b7c; --accent-soft:#e6ebf4;
  --rec:#1f6b53; --rec-soft:#e5f0eb; --warn:#845311; --warn-soft:#f8eedd;
  --code:#eceef2; --radius:6px;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --bg:#0f1217; --card:#171b21; --ink:#e5e9ef; --ink-2:#a7aeb9; --ink-3:#7a828d;
    --line:#252b34; --line-2:#353f4a; --accent:#90b1e1; --accent-soft:#192232;
    --rec:#6fbf9b; --rec-soft:#13241d; --warn:#d9a458; --warn-soft:#241d11;
    --code:#1c212a;
  }
}
:root[data-theme="dark"]{
  --bg:#0f1217; --card:#171b21; --ink:#e5e9ef; --ink-2:#a7aeb9; --ink-3:#7a828d;
  --line:#252b34; --line-2:#353f4a; --accent:#90b1e1; --accent-soft:#192232;
  --rec:#6fbf9b; --rec-soft:#13241d; --warn:#d9a458; --warn-soft:#241d11;
  --code:#1c212a;
}

body{background:var(--bg);color:var(--ink);
  font:16px/1.62 "Iowan Old Style",Charter,Georgia,ui-serif,"Times New Roman",serif;
  -webkit-text-size-adjust:100%;}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:3px;}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important;}}
.wrap{max-width:52rem;margin:0 auto;padding:0 20px;padding-block:40px 72px;}
h1,h2,h3,h4,.qid,.tag,.ev-kind,.sol-n,.cost dt,nav{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;}
p{margin:0 0 .85em;} p:last-child{margin-bottom:0;}
ul,ol{margin:0 0 .85em;padding-left:1.3em;} li{margin:.25em 0;}
a{color:var(--accent);}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.86em;
  background:var(--code);padding:.12em .38em;border-radius:4px;word-break:break-word;}

/* header */
.top{border-bottom:2px solid var(--line-2);padding-bottom:20px;margin-bottom:28px;}
.top h1{font-size:1.9rem;line-height:1.2;margin:0 0 .3em;letter-spacing:-.01em;text-wrap:balance;}
h2,h3,h4{text-wrap:balance;}
.subject{font-size:1.06rem;color:var(--ink-2);margin:0 0 .9em;}
/* The counts are the controls. They read as one row of switches, with the
   active one filled so the reader always knows what the page is showing. */
.filters{display:flex;flex-wrap:wrap;gap:.45em;margin:0 0 .8em;}
.chip{font-family:ui-sans-serif,system-ui,sans-serif;font-size:.8rem;line-height:1.2;
  padding:.4em .7em;border-radius:999px;border:1px solid var(--line-2);
  background:var(--card);color:var(--ink-2);cursor:pointer;}
.chip:hover{border-color:var(--accent);color:var(--ink);}
.chip-n{font-weight:650;font-variant-numeric:tabular-nums;margin-right:.15em;color:var(--ink);}
.chip[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#fff;}
.chip[aria-pressed="true"] .chip-n{color:#fff;}
:root[data-theme="dark"] .chip[aria-pressed="true"],
:root[data-theme="dark"] .chip[aria-pressed="true"] .chip-n{color:#10151d;}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]) .chip[aria-pressed="true"],
  :root:not([data-theme="light"]) .chip[aria-pressed="true"] .chip-n{color:#10151d;}
}
/* The same chip, not a button, marking one entry's own state. */
.chip-static{cursor:default;flex:none;align-self:center;font-size:.68rem;
  text-transform:uppercase;letter-spacing:.06em;padding:.3em .6em;}
.chip-static.chip-open{color:var(--warn);border-color:var(--warn);background:var(--warn-soft);}
.chip-static.chip-decided{color:var(--accent);border-color:var(--accent);background:var(--accent-soft);}
.chip-static.chip-complete{color:var(--rec);border-color:var(--rec);background:var(--rec-soft);}
.chip-static.chip-superseded{color:var(--ink-3);border-color:var(--line-2);background:transparent;}
.provenance{font-size:.82rem;color:var(--ink-3);margin:0 0 .8em;
  font-family:ui-sans-serif,system-ui,sans-serif;}
.toc .empty{color:var(--ink-3);font-size:.9rem;margin:.4em 0 0;}
.context{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
  padding:4px 18px 14px;margin:20px 0 0;font-size:.96rem;color:var(--ink-2);}
.context > section{padding:12px 0 2px;border-bottom:1px solid var(--line);}
.context > section:last-of-type{border-bottom:0;}
.context h2{font-size:.74rem;text-transform:uppercase;letter-spacing:.09em;color:var(--ink-3);margin:0 0 .5em;}
.context h3{font-size:.82rem;margin:.2em 0 .3em;color:var(--ink);}
.context ul{margin:.2em 0 .7em;padding-left:1.2em;}
.context li{margin:.2em 0;}
.context p{margin:.3em 0 .7em;}
.waiting-row ul{list-style:none;padding-left:0;}
.tr{display:grid;gap:.9em;margin:.2em 0 .8em;}
.tr-head{display:flex;align-items:baseline;gap:.45em;font-size:.82rem;margin:0 0 .25em;color:var(--ink);}
.tr-n{font-weight:500;color:var(--ink-3);font-variant-numeric:tabular-nums;font-size:.9em;}
.context .tr ul{list-style:none;padding-left:0;margin:0;}
.context .tr li{display:grid;grid-template-columns:16px minmax(0,1fr);gap:.6em;align-items:start;margin:.3em 0;}
.tr-icon{margin-top:.28em;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;}
.tr-icon .fill{fill:currentColor;}
.tr-icon .knock{stroke:var(--card);stroke-width:1.8;}
.tr-raised{color:var(--accent);}
.new-additions h2{color:var(--accent);}
.new-additions [data-bearing="blocks-goal"] .tr-head{color:var(--warn);}
.tr-changed{color:var(--warn);}
.tr-completed{color:var(--rec);}
.tr-retracted{color:var(--ink-3);}
.tr-amended{color:var(--warn);}
.tag-amended{color:var(--warn);border:1px solid var(--warn);background:var(--warn-soft);margin-left:.3em;vertical-align:.1em;}
.context .tr li.amended-item{background:var(--warn-soft);border-radius:5px;padding:.25em .4em;margin-left:-.4em;}
.chip-static.chip-amended{color:var(--warn);border-color:var(--warn);background:var(--warn-soft);}
.amended{margin:.7em 0 .2em;padding:.6em .8em;border:1px solid var(--warn);background:var(--warn-soft);border-radius:6px;color:var(--ink);}
.amended h4{margin:0 0 .4em;font-size:.72rem;text-transform:uppercase;letter-spacing:.09em;color:var(--warn);}
dl.amend{margin:0;display:grid;gap:.2em;}
dl.amend + dl.amend{margin-top:.6em;padding-top:.6em;border-top:1px solid var(--warn);}
dl.amend div{display:grid;grid-template-columns:7em minmax(0,1fr);gap:.6em;}
dl.amend dt{font-family:ui-sans-serif,system-ui,sans-serif;font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-3);padding-top:.25em;}
dl.amend dd{margin:0;}
@media (max-width:640px){dl.amend div{grid-template-columns:1fr;gap:0;}}
.tr-note{color:var(--ink-3);}
[data-kind="retracted"] li > span{color:var(--ink-3);}
.waiting-row .n{font-variant-numeric:tabular-nums;font-weight:650;margin-right:.3em;}
.background{padding:10px 0 0;}
.background summary{cursor:pointer;font-family:ui-sans-serif,system-ui,sans-serif;font-size:.74rem;
  text-transform:uppercase;letter-spacing:.09em;color:var(--ink-3);}
.background .source{color:var(--ink-3);font-size:.9em;}
.goal{margin:0 0 .5em;font-size:.98rem;color:var(--ink);}
.goal-k{font-family:ui-sans-serif,system-ui,sans-serif;font-size:.68rem;text-transform:uppercase;letter-spacing:.09em;
  font-weight:650;color:var(--accent);margin-right:.6em;}
a.qref{text-decoration:none;border-bottom:1px dotted currentColor;}
.bearing{font-size:.9rem;color:var(--ink-2);margin:.2em 0 1em;}
.tag-block{color:var(--warn);border:1px solid var(--warn);background:var(--warn-soft);}
.chip-static.chip-blocks{color:var(--warn);border-color:var(--warn);background:var(--warn-soft);}
.chip-static.chip-escalated{color:var(--ink-2);border-color:var(--line-2);background:var(--card);}
.tail .d p,.tail .d ul{margin:.3em 0;}

/* contents */
nav.toc{margin:0 0 34px;font-size:.9rem;}
nav.toc h2{font-size:.76rem;text-transform:uppercase;letter-spacing:.09em;color:var(--ink-3);margin:0 0 .7em;}
nav.toc ol{list-style:none;margin:0;padding:0;}
nav.toc li{margin:0;border-bottom:1px solid var(--line);}
nav.toc a{display:flex;gap:.7em;padding:.5em 0;text-decoration:none;color:var(--ink);align-items:baseline;}
nav.toc a:hover{color:var(--accent);}
nav.toc .n{color:var(--ink-3);font-variant-numeric:tabular-nums;flex:none;min-width:2.6em;}
nav.toc .done{color:var(--ink-3);font-size:.8em;flex:none;margin-left:auto;}

/* entry */
.entry{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
  padding:26px 26px 24px;margin:0 0 22px;}
.entry-closed{opacity:.72;}
.entry-head{display:flex;gap:.75em;align-items:baseline;margin:0 0 8px;
  border-bottom:1px solid var(--line);padding-bottom:14px;}
.qid{flex:none;font-size:.76rem;font-weight:650;letter-spacing:.06em;color:var(--accent);
  background:var(--accent-soft);padding:.3em .6em;border-radius:5px;text-decoration:none;}
.entry-head h2{font-size:1.32rem;line-height:1.28;margin:0;letter-spacing:-.005em;flex:1 1 12ch;min-width:0;}
.entry-head{flex-wrap:wrap;}
.entry-head .tag{flex:none;align-self:center;}
.stamps{font-family:ui-sans-serif,system-ui,sans-serif;font-size:.78rem;color:var(--ink-3);
  margin:0 0 16px;font-variant-numeric:tabular-nums;}
.tail li .stamps{margin:.35em 0 0;}
.part{margin:0 0 20px;} .part:last-child{margin-bottom:0;}
.part>h3{font-size:.74rem;text-transform:uppercase;letter-spacing:.09em;color:var(--ink-3);
  margin:0 0 .6em;font-weight:650;}
.part-problem>p{font-size:1.08rem;color:var(--ink);}
.why,.target,.assume{margin-top:14px;padding-left:14px;border-left:3px solid var(--line-2);}
.why h4,.target h4,.assume h4{font-size:.74rem;text-transform:uppercase;letter-spacing:.09em;
  color:var(--ink-3);margin:0 0 .5em;}
.assume{border-left-color:var(--warn);}

/* Evidence is a two-column table: the sort of thing on the left, the citation
   and what it shows on the right. The list owns the columns and each row borrows
   them, so every citation starts on the same vertical line however long the
   longest label happens to be. */
ul.ev{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:max-content minmax(0,1fr);}
ul.ev li{display:grid;grid-column:1/-1;grid-template-columns:subgrid;gap:.25em .8em;
  align-items:baseline;padding:.55em 0;border-top:1px solid var(--line);}
ul.ev li:first-child{border-top:0;padding-top:0;}
.ev-kind{font-size:.68rem;text-transform:uppercase;letter-spacing:.07em;color:var(--ink-3);
  border:1px solid var(--line-2);border-radius:4px;padding:.15em .45em;white-space:nowrap;
  justify-self:start;}
.ev-ref{grid-column:2;min-width:0;overflow-wrap:anywhere;
  display:flex;flex-wrap:wrap;align-items:baseline;gap:.4em;}
.ev-note{grid-column:2;color:var(--ink-2);font-size:.94rem;}
@supports not (grid-template-columns:subgrid){
  ul.ev{display:block;}
  ul.ev li{grid-template-columns:7.5rem minmax(0,1fr);}
}

/* diagrams */
.dgm{margin:18px 0;padding:0;}
.dgm-fit{container-type:inline-size;}
.dgm-frame{width:100%;max-width:100%;border:1px solid var(--line);border-radius:var(--radius);
  background:var(--bg);display:block;color-scheme:light dark;}
.dgm-open{margin:.5em 0 0;font-size:.82rem;font-family:ui-sans-serif,system-ui,sans-serif;}
.dgm-svg{border:1px solid var(--line);border-radius:var(--radius);padding:10px;
  overflow-x:auto;background:var(--bg);display:flex;justify-content:center;}
.dgm-svg svg{display:block;margin:0 auto;width:100%;max-width:100%;height:auto;}
.dgm svg{max-width:100%;height:auto;}
.dgm pre.mermaid{border:1px solid var(--line);border-radius:var(--radius);padding:14px;
  background:var(--bg);overflow-x:auto;margin:0;}
.dgm figcaption{font-size:.88rem;color:var(--ink-2);margin-top:.6em;
  font-family:ui-sans-serif,system-ui,sans-serif;}
.dgm-src{font-size:.78rem;color:var(--ink-3);margin:.35em 0 0;}
.dgm-absent .absent{border:1px dashed var(--line-2);border-radius:var(--radius);
  padding:14px 16px;background:var(--bg);color:var(--ink-2);font-size:.92rem;
  font-family:ui-sans-serif,system-ui,sans-serif;}
.dgm-absent .absent strong{color:var(--ink);}

/* solutions */
.sol{border:1px solid var(--line);border-radius:8px;padding:16px 18px;margin:0 0 12px;}
.sol:last-child{margin-bottom:0;}
.sol-rec{border-color:var(--rec);background:var(--rec-soft);}
.sol header{display:flex;gap:.6em;align-items:baseline;margin:0 0 .6em;flex-wrap:wrap;}
.sol-n{font-size:.74rem;color:var(--ink-3);font-variant-numeric:tabular-nums;}
.sol h4{font-size:1.02rem;margin:0;flex:1 1 14ch;line-height:1.35;}
.tag{font-size:.66rem;text-transform:uppercase;letter-spacing:.08em;font-weight:650;
  padding:.22em .5em;border-radius:4px;white-space:nowrap;}
.tag-rec{color:var(--rec);border:1px solid var(--rec);}
.tag-alt{color:var(--ink-3);border:1px solid var(--line-2);}
.tag-warn{color:var(--warn);background:var(--warn-soft);border:1px solid var(--warn);}
.steps{font-size:.95rem;color:var(--ink-2);}
dl.cost{margin:.8em 0 0;display:grid;gap:.3em;font-size:.9rem;}
.cost-row{display:grid;grid-template-columns:6.5em 1fr;gap:.7em;}
.cost dt{font-size:.7rem;text-transform:uppercase;letter-spacing:.07em;color:var(--ink-3);padding-top:.2em;}
.cost dd{margin:0;color:var(--ink-2);}

.ruled{background:var(--rec-soft);border:1px solid var(--rec);border-radius:6px;
  padding:.6em .8em;margin:0 0 12px;font-size:.93rem;}
.ruled:last-of-type{margin-bottom:18px;}
.ruled-old{background:transparent;border-color:var(--line-2);color:var(--ink-3);}
.ruled-done ul.ev{margin-top:.6em;font-size:.92em;}
.ruled-done ul.ev li{border-top-color:var(--rec);}
.differs{margin-top:.5em;color:var(--ink-2);}
.closed-set{margin-top:40px;}
.closed-set>h2{font-size:1.08rem;margin:0 0 .3em;font-family:ui-sans-serif,system-ui,sans-serif;}
.closed-set>.lede{color:var(--ink-3);font-size:.9rem;margin:0 0 1em;}
.closed-set .entry{margin-bottom:14px;}
ol.toc-closed{list-style:none;margin:0 0 22px;padding:0;font-size:.9rem;
  font-family:ui-sans-serif,system-ui,sans-serif;}
ol.toc-closed li{background:none;border:0;border-bottom:1px solid var(--line);
  border-radius:0;padding:0;margin:0;}
ol.toc-closed a{display:flex;gap:.7em;padding:.5em 0;text-decoration:none;
  color:var(--ink-2);align-items:baseline;}
ol.toc-closed a:hover{color:var(--accent);}
ol.toc-closed .n{color:var(--ink-3);font-variant-numeric:tabular-nums;flex:none;min-width:2.6em;}
ol.toc-closed .done{color:var(--rec);font-size:.8em;flex:none;margin-left:auto;}
details.rolled{margin-top:16px;font-size:.9rem;color:var(--ink-2);}
details.rolled summary{cursor:pointer;color:var(--ink-3);
  font-family:ui-sans-serif,system-ui,sans-serif;font-size:.84rem;}
details.rolled ul{margin-top:.6em;}

/* tail sections */
.tail{margin-top:40px;}
.tail>h2{font-size:1.08rem;margin:0 0 .3em;}
.tail>.lede{color:var(--ink-3);font-size:.9rem;margin:0 0 1em;}
.tail ul{list-style:none;margin:0;padding:0;}
.tail li{background:var(--card);border:1px solid var(--line);border-radius:8px;
  padding:12px 15px;margin:0 0 8px;font-size:.95rem;}
.tail li .d{color:var(--ink-2);font-size:.9rem;margin-top:.3em;}
.tail li .b{color:var(--ink-3);font-size:.8rem;margin-top:.35em;
  font-family:ui-sans-serif,system-ui,sans-serif;}
.done-mark{color:var(--rec);font-weight:650;margin-right:.4em;}

@media (max-width:640px){
  .wrap{padding-block:26px 48px;}
  .entry{padding:20px 17px;}
  .top h1{font-size:1.55rem;}
  ul.ev{grid-template-columns:minmax(0,1fr);}
  .ev-kind{grid-column:1;} .ev-ref,.ev-note{grid-column:1;}
  .cost-row{grid-template-columns:1fr;gap:.1em;}
  .entry-head{flex-wrap:wrap;gap:.5em;}
}
`;

const THEME_SCRIPT = `
(function(){
  // Embedded archify pages live in their own frame and cannot see the reader's
  // theme, so hand it to them and re-hand it whenever the reader switches.
  function effective(){
    var t = document.documentElement.getAttribute('data-theme');
    if (t === 'dark' || t === 'light') return t;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function paint(f, t){
    // An inlined frame shares this page's origin, so its document can be reached
    // directly — no reload, and no query string to carry the theme in.
    try {
      var doc = f.contentDocument;
      if (doc && doc.documentElement) {
        doc.documentElement.setAttribute('data-theme', t);
        doc.documentElement.setAttribute('data-present', 'true');
      }
    } catch (_) {}
  }
  function sync(){
    var t = effective();
    document.querySelectorAll('iframe[data-archify]').forEach(function(f){
      var want = f.getAttribute('data-archify') + '?present=1&theme=' + t;
      if (f.getAttribute('src') !== want) f.setAttribute('src', want);
    });
    document.querySelectorAll('iframe[data-archify-inline]').forEach(function(f){
      paint(f, t);
      if (!f.dataset.themeBound) {
        f.dataset.themeBound = '1';
        f.addEventListener('load', function(){ paint(f, effective()); });
      }
    });
  }
  sync();
  new MutationObserver(sync).observe(document.documentElement, {attributes:true, attributeFilter:['data-theme']});
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    (mq.addEventListener ? mq.addEventListener.bind(mq,'change') : mq.addListener.bind(mq))(sync);
  }
})();
`;

function page(brief, baseDir) {
  ENTRIES = new Map(brief.decisions.map((e) => [e.id, e]));
  const st = (e) => e.status ?? "open";
  /* One flow, ordered by state: what needs you first, then what is merely
     recorded. Nothing is hidden from the document — the filter decides what is
     on screen, and every entry keeps its number and its anchor for good. */
  const entries = [...brief.decisions].sort(
    (a, b) => STATE_ORDER.indexOf(group(a)) - STATE_ORDER.indexOf(group(b)));
  const count = (k) => brief.decisions.filter((e) => group(e) === k).length;
  const mech = brief.mechanical ?? [];
  const out = brief.outstanding ?? [];

  /* The counts were only ever a summary. They are the controls now: click one
     and the page shows that category alone. The page opens on what needs a
     ruling, because that is the only part that is waiting on the reader. */
  const buttons = [
    /* A ruling not yet carried out is work waiting to be done, so it is counted
       and shown with the outstanding work rather than as a category of its own. */
    ...STATE_ORDER.filter((k) => k !== "decided" && count(k)).map((k) =>
      ({ key: k, n: count(k), label: k === "blocks" ? "block the goal" : STATE_LABEL[k].toLowerCase() })),
    mech.length ? { key: "mechanical", n: mech.length, label: "handled without asking" } : null,
    count("decided") + out.length
      ? { key: "outstanding", n: count("decided") + out.filter((o) => o.state !== "done").length, label: "outstanding work" } : null,
  ].filter(Boolean);

  const filters = `<nav class="filters" role="group" aria-label="Show one part of the page">` +
    buttons.map((b) =>
      `<button type="button" class="chip chip-${b.key}" data-filter="${b.key}" aria-pressed="false">` +
      `<span class="chip-n">${b.n}</span> ${esc(b.label)}</button>`).join("") +
    `<button type="button" class="chip chip-all" data-filter="all" aria-pressed="false">everything</button>` +
    `</nav>`;

  /* Just the two moments. Re-checking the facts is a change, so it moves
     updated; what produced the findings lives with the background. */
  const provenance = `written ${stamp(brief.created)} · updated ${stamp(brief.updated)}`;

  const defaultFilter = ["blocks", "open", "escalated"].find((k) => count(k)) ??
    (count("decided") || out.some((o) => o.state !== "done") ? "outstanding" : "all");

  const ref = (e) => `<a class="qref" href="#${esc(e.id)}"><span class="n">${esc(e.id)}</span> ${inline(e.short ?? e.title, { refs: false })}</a>`;
  const waitingList = (label, list) => list.length
    ? `<div class="waiting-row"><h3>${label}</h3><ul>${list.map((e) => `<li>${ref(e)}</li>`).join("")}</ul></div>` : "";
  const blockers = brief.decisions.filter((e) => group(e) === "blocks");
  const escalated = brief.decisions.filter((e) => group(e) === "escalated");
  const unbracketed = brief.decisions.filter((e) => group(e) === "open");
  const waiting = blockers.length + escalated.length + unbracketed.length
    ? (brief.goal && !blockers.length ? `<p>Nothing blocks the goal.</p>` : "") +
      waitingList("Blocks the goal", blockers) + waitingList("Awaiting your ruling", unbracketed) +
      waitingList("Escalated, not blocking", escalated)
    : `<p>Nothing is waiting on a ruling.</p>`;

  const pinned = newAdditions(brief.changes ?? []);
  const rest = (brief.changes ?? []).filter((c) => !(typeof c === "object" && c.kind === "raised"));
  const changes = pinned + (rest.length
    ? `<section><h2>Since the last version</h2>${transitions(rest)}</section>` : "");
  const background = brief.background || brief.source
    ? `<details class="background"><summary>Background</summary>${prose(brief.background)}` +
      (brief.source ? `<p class="source">These findings come from ${inline(brief.source)}.</p>` : "") + `</details>` : "";
  const summary = `<div class="context">${changes}` +
    `<section><h2>Waiting on you</h2>${waiting}</section>` +
    (brief.context ? `<section>${prose(brief.context)}</section>` : "") +
    background + `</div>`;

  /* Say where the work stands, and only say it waits on an entry while that
     entry is still awaiting a ruling. */
  const outstandingState = (o) => {
    const target = o.blockedBy && brief.decisions.find((e) => e.id === o.blockedBy);
    const label = { "not-started": "Not started", "in-progress": "In progress", blocked: "Blocked", done: "Done" }[o.state ?? "not-started"];
    const cite = target ? citations(esc(o.blockedBy)) : esc(o.blockedBy);
    if (target && st(target) === "open" && o.state !== "done") return `Waits on ${cite}`;
    return label + (o.blockedBy ? ` · follows from ${cite}` : "");
  };

  const tocRow = (e) => `<li data-state="${group(e)}"><a href="#${esc(e.id)}">` +
    `<span class="n">${esc(e.id)}</span><span>${inline(e.title, { refs: false })}</span>` +
    `<span class="done">${esc(STATE_LABEL[group(e)].toLowerCase())}</span></a></li>`;

  const toc = `<nav class="toc"><h2 data-toc-head>What needs deciding</h2>` +
    `<ol>${entries.map(tocRow).join("")}</ol>` +
    `<p class="empty" hidden>Nothing in this category.</p></nav>`;

  const mechSec = mech.length ? `<section class="tail" data-block="mechanical">
    <h2>Already fixed</h2>
    <p class="lede">Unambiguous, no judgement needed, so it was done rather than asked about.</p>
    <ul>${mech.map((m) => `<li><span class="done-mark">✓</span>${inline(m.summary)}` +
      (m.detail ? `<div class="d">${prose(m.detail)}</div>` : "") +
      (m.evidence?.length ? `<div class="b">${m.evidence.map((e) => `<code>${esc(e.ref)}</code>`).join(" · ")}</div>` : "") +
      `<p class="stamps">${stamps(m)}</p></li>`).join("")}</ul></section>` : "";

  const outSec = out.length ? `<section class="tail" data-block="outstanding">
    <h2>Outstanding work</h2>
    <p class="lede">Agreed and understood, not yet done. Nothing here needs a ruling.</p>
    <ul>${out.map((o) => `<li>${o.state === "done" ? `<span class="done-mark">✓</span>` : ""}${inline(o.summary)}` +
      (o.detail ? `<div class="d">${prose(o.detail)}</div>` : "") +
      `<div class="b">${outstandingState(o)}</div>` +
      `<p class="stamps">${stamps(o)}</p></li>`).join("")}</ul></section>` : "";

  return `<title>${esc(brief.title)}</title>
<style>${CSS}</style>
<div class="wrap">
  <header class="top">
    <h1>${inline(brief.title)}</h1>
    <p class="subject">${inline(brief.subject)}</p>
    ${brief.goal ? `<p class="goal"><span class="goal-k">Goal</span>${inline(brief.goal)}</p>` : ""}
    <p class="provenance">${provenance}</p>
    ${filters}
    ${summary}
  </header>
  ${toc}
  ${entries.map((e) => entry(e, baseDir)).join("\n")}
  ${mechSec}
  ${outSec}
</div>
<script>${THEME_SCRIPT}</script>
<script>var DEFAULT_FILTER = '${defaultFilter}';${FILTER_SCRIPT}</script>
`;
}

/* ── main ───────────────────────────────────────────────────────────────── */

const [, , inPath, outPath] = process.argv;
if (!inPath) {
  console.error("usage: render-brief.mjs <brief.json> [out.html]");
  process.exit(2);
}
const baseDir = dirname(resolve(inPath));
let brief;
try {
  brief = JSON.parse(readFileSync(inPath, "utf8"));
} catch (err) {
  console.error(`${inPath} is not valid JSON.\n  ${err.message}`);
  process.exit(1);
}

/* Nothing renders unvalidated. A brief is usually written by a machine, and a
   silently dropped field produces a page that looks finished and is not. */
const result = validateBrief(brief);
if (!result.ok) {
  console.error(formatReport(result, inPath));
  process.exit(1);
}
if (result.warnings.length) console.warn(formatReport(result, inPath));
const html = page(brief, baseDir);
const dest = outPath ?? inPath.replace(/\.json$/, "") + ".html";
mkdirSync(dirname(resolve(dest)), { recursive: true });
writeFileSync(dest, html, "utf8");
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`wrote ${dest}  (${brief.decisions.length} entries, ${kb(html.length)})`);
if (notes.inlined) {
  console.log(`  ${kb(notes.inlined)} of that is drawings carried inside the page — nothing needs publishing alongside it.`);
}
if (notes.companions.size) {
  console.log("  these drawings are companion files and must be published alongside the page:");
  for (const f of notes.companions) console.log(`    ${f}`);
  console.log('  if your publishing tool cannot carry companions, drop "embed": "file" and they go inside the page instead.');
}
for (const problem of notes.problems) console.warn(`  ! ${problem}`);
if (html.length > PAGE_WARN_BYTES) {
  console.warn(`  ! the page is ${mb(html.length)}. It still works — the ceiling is 16 MB — but consider simplifying a ` +
    'drawing, or setting "embed": "file" on the largest ones if your publishing tool can carry companions.');
}
