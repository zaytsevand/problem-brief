# Entry format, states and the summary box

Contents: [The entry shape](#the-entry-shape) · [An entry's life](#an-entrys-life) ·
[Grouping and bearing](#grouping-and-bearing) · [The summary box](#the-summary-box) ·
[Write the data, validate, render](#write-the-data-validate-render)

`schema/problem-brief.schema.json` is the machine-readable
form of everything here; every field carries a description.

## The entry shape

Every entry, in this order. The order is the deliverable.

| Part | What it is | Length |
|---|---|---|
| **a. Problem** | One or two plain sentences naming what is wrong. No preamble. | 1–2 sentences |
| **b. Brief explanation** | Why that matters, in the operator's terms. | 2–8 sentences |
| **c. Evidences** | Verified evidence grounded in real artefacts: code lines, documents, prior findings. | 1–4 items |
| **d. The unwound explanation** | How it works today, with a diagram where one helps, and references (file:line, commit SHAs, run IDs, spec paths). Then why that is wrong. With no defect, state the target state instead. | as long as it needs |
| **e. Solutions** | At least one, better two or more. **The first is the recommendation**, labelled as such. Each carries its cost (work, risk, what it forecloses) and says whether it can be undone. | 2+ options |

**Ids.** `Q-1`, `Q-2`… never invented codes. An id is permanent: a refreshed entry keeps
its number, a resolved one keeps it and is marked closed, a new one takes the next free
number. Give every entry a `short` label of two to five words; bare ids in text render as
`Q-29 (one-call page read)`.

**Binding.** When the work runs under a tracker item (task, spec, ADR), set `binding`
(`ref`, kind, title, link) from where the work is already bound — branch name, spec being
implemented, task the operator named. Never invent one. Ids are then cited as `JOB-42/Q-3`;
the file keeps them bare. Once a ruling is made, record it in the project's own decision
log too and cite that record in the entry's `resolution`.

**Pricing an option.** `cost.work` says what the work consists of — what changes, how much,
what it needs from the operator (review, decision, access, migration window). Never "two
days": agents work at a different pace, and the reader pays in attention and risk.

**Can it be undone?** Mark every option `reversible: true|false`. It is `false` when it
cannot be undone or undoing costs far more than doing: data deleted or rewritten, a
migration on real data, a message or release sent, a public interface published, money
spent. Say what it rules out in `cost.forecloses`. Reversible → may be handled without
asking. Irreversible → always the operator's call, however obvious.

## An entry's life

Never renumbered, and never deleted unless withdrawn (below). The page is refreshed by moving entries along.

| `status` | Page shows | Means | Needs |
|---|---|---|---|
| `open` | *blocks the goal* / *escalated, not blocking* | Awaiting a ruling. | `bearing`, `bearingReason` |
| `decided` | *outstanding work* | A way forward was chosen, **not yet carried out**. | `decision` (option, date, why), `bearing`, `bearingReason` |
| `complete` | *complete* | The chosen option was carried out (a fix, an answer, a scope cut, a settled measurement). | `resolution`: date, what happened, proof |
| `superseded` | *retracted* | The problem went away or was overtaken. | — |

**Withdrawing.** The one exception to "never deleted": the operator says a decision was
misunderstood or wrong from the start and asks for it removed. Leaving it as `superseded`
keeps it on the page, where every later session reads it as ground to build on.

1. Work out every entry and ruling that exists only because of the withdrawn one, and
   preview the deletion; name the ids and what it prints to the operator before going on:

   ```bash
   node ~/.claude/skills/problem-brief/bin/brief-withdraw.mjs brief.json Q-3 R-2 --dry-run
   ```

2. Run it without `--dry-run`. It deletes those entries and rulings, the outstanding items
   blocked on them and every `changes` and `history` note that cites them; makes a ruling
   active again where a withdrawn one had replaced it; lists the ids in `withdrawnIds`, so
   no number is issued again; and moves `updated`. No marker stays.
3. It ends with every citation still left (prose, an amendment, a mechanical item,
   evidence). Those need judgement: rewrite or remove each, then validate until it passes.
4. Comment threads on a deleted entry: resolve them after marking each with
   `brief-comments.mjs --no-ruling <url> <thread> "withdrawn"`.

Git keeps what was deleted; the brief does not. The chat delta reports `Q-n withdrawn and deleted`.

`decided` ≠ `complete`: ruling closes the question, not the entry. Where what was done
drifts from what was ruled, add one `resolution.amendments` item per drift (ruled, done
instead, why — "not recorded" if nobody wrote it); remarks go in the resolution note. The
renderer refuses to close an entry without proof.

**Timestamps.** The brief and every item carry `created` (set once) and `updated` (moves with
every change to that item, and only then), as `2026-09-15T09:40Z`. The brief's own
`updated` is never earlier than any item's; a full re-check moves it. `generated` is retired.

**Mechanical.** An unambiguous, reversible fix with no judgement goes in `mechanical`:
fixed first, listed as done, never asked about. The validator refuses `reversible: false`
there.

**`blockedBy`.** When an entry cannot be ruled before another, list the other in its
`blockedBy`; *Waiting on you* then puts the ruling that frees the most work first.

## Grouping and bearing

Group by root cause, not by finding: five findings with one cause are one entry with five
symptoms; say which findings rolled in.

Write `goal` first, in the operator's own words. Every `open`/`decided` entry carries a
`bearing` and one-line `bearingReason`:

- `blocks-goal` — the goal cannot be reached without this ruling.
- `escalated` — the operator's decision, but not on the goal's path. Never presented as a
  blocker, never asked one at a time mid-work.
- **Mechanical** — fix it yourself first, list it as done.
- **Outstanding work** — agreed, not done; a separate list at the end.

"Deferred because it doesn't block X" is a bearing, not a ruling. Re-judge every bearing
when the goal changes.

## The summary box

Read first, often on a phone; structure, never one paragraph. Order: what waits on the
reader, what moved, the rest.

- **Waiting on you** — built by the renderer. Do not write it.
- `changes` — one item per change with its `kind`: `raised`, `changed`, `completed`,
  `retracted`, `note`. The renderer groups them (new first). Every new entry needs a
  `raised` change with its `id`.
- `history` — earlier versions' `changes`, one stamped block each. On every refresh, move
  the current `changes` into `history` as `{ "version": <previous updated>, "changes": [...] }`
  before writing new ones; never overwrite or trim. Skip only when `changes` is empty.
- `context` — optional, anything needed before entry one.
- `background` — earlier history, folded; `source` goes with it.

## Write the data, validate, render

The page is never hand-written. Start from `examples/example.brief.json`.

```bash
node ~/.claude/skills/problem-brief/bin/validate-brief.mjs brief.json      # every time, before rendering
node ~/.claude/skills/problem-brief/bin/render-brief.mjs brief.json out/index.html
```

The validator catches misspelt fields (the usual machine error: the content silently
vanishes), the one-recommended-option-first rule, prices, proof on closed entries, id reuse,
status/record contradictions, stamp contradictions, rulings, and warns on entries that look
like earlier ones or already answered by a ruling. Fix every error; the renderer refuses
anyway. `--json` for machine output.

**Where the files go.** JSON, page and diagram folder together: the scratchpad only if the
brief will not outlive the session, otherwise beside the spec or work it concerns. Keep the
JSON; the next refresh edits it.
