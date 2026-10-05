---
name: problem-brief
description: >-
  Use by default, without being asked, whenever a session has findings, open
  decisions or questions for the operator to rule on: the brief is the primary
  channel for them, and chat carries only the summary and the link. Also use
  when asked to build, publish, refresh or update an artefact (or brief,
  findings report, open-questions page, decisions page) that lists problems,
  issues, findings, review results or open questions — each with a problem
  statement, explanation and possible solutions — and when the operator answers
  or comments on one. Also when the same material is delivered as
  AskUserQuestion instead of a page.
  REQUIRED composition — archify (drawings) and humanizer (prose); see
  Dependencies.
license: MIT
metadata:
  version: "1.4"
  requires:
    - archify
    - humanizer
---

# Problem Brief

## Overview

A **problem brief** is a published page whose one job is to let the operator rule
without opening the repository. Every entry states a problem, proves it, and ends with a
recommended way out. It is not a status report.

**The brief's JSON is the memory, not the conversation.** Answers given in chat are lost
when the session is summarised; to the operator, being asked again what they already
answered is the worst failure this skill can have.

**The reader was not in your session and will not open a file.** An entry that cannot be
understood from the page alone is not finished.

## When to use

- **By default, unasked**: anything the operator must rule on — a finding with more than
  one way out, an open decision, a question — goes into the brief for that subject (or a
  new one). Chat carries only the short summary of what moved and the link.
- Asked for an artefact/page/brief of problems, findings, review results or questions.
- The operator answers, rules or comments on something a brief holds — even mid-task.
- Not for a progress or completion report with nothing to decide; that goes in chat.

## When the operator answers or rules — this turn, before anything else

Whatever else you were doing, the turn the answer arrives produces these, in order:

1. **An answer in a comment on the page**: read the thread yourself (`ArtifactComments`,
   `action: "read"`, the page `url` and `thread_id`). The automatic reply the commenter
   already got is not a record, whatever it promised.
2. **The entry it answers**: `decision` (option chosen, date, the operator's words),
   `status` → `decided` (or `complete` if nothing is left to carry out, with `resolution`),
   `updated` stamp on the entry and the brief.
3. **A standing ruling for every part that outlives the entry** — a preference, a scope
   cut, "stop asking me about X", "we don't care about Y": a new `R-n` in `rulings` with
   `about` (the question as it would be asked again) and `said` (their exact words),
   `source` (chat + date). A ruling about how Claude should work is also saved as a
   `feedback` memory, named in the ruling's `memory` field.
4. A ruling that contradicts an earlier one: add the new one, mark the old `replaced` with
   `replacedBy`. Never edit or delete a ruling.
5. A `changed` item in `changes`; validate; render; republish to the same URL.
6. **A comment thread**: only now resolve it (`ArtifactComments`, `action: "resolve"`), so
   the ruling is in the saved file before the thread closes. A thread with nothing to
   record: `reference/publishing.md`.
7. Chat: the delta only (`Q-3: open → decided (…)`, `R-4 recorded: …`) plus the link and
   the JSON path. Then go back to the other task.

"I'll fold it in at the next refresh" loses it: by then the turn may be summarised away.
Being busy with something else is not a reason to defer.

## Before raising anything — search, by class

Before adding an entry or asking anything (including `AskUserQuestion`), name the
**class** of the question ("may a password hash sit in a tracked file", "is a release
reversible") and search for that class, not just the exact subject:

1. This brief's rulings and entries, every state.
2. Project memory (`MEMORY.md` and what it points to), including sibling briefs — a
   ruling on a sibling brief binds.
3. The project's recall index and governing documents (constitution, architecture notes).
4. Earlier sessions via `memory-recall`, where installed.

| You find | Do |
|---|---|
| A ruling that answers it — even if the step now feels risky | Do not ask. Apply it, cite the ruling id in what you report, list any resulting fix as `mechanical`. |
| An entry with the same root cause, any state | Add the new evidence to that entry. No new number. |
| That entry is closed and the new evidence really contradicts its ruling | Reopen **the same id**, say what is new, cite the ruling. |
| Nothing | Raise it with the next free number; record which sources you searched. |

A ruled risk feeling uncomfortable is not new evidence. New evidence is a fact the
operator did not have when they ruled.

## Start of every run — state check

Every run (a new brief, a refresh, folding in comments) starts here. The one write that
comes earlier is an answer that arrived this turn: record it first (above), then walk.

Load the JSON (never rebuild from memory; a lost file is recovered from the page — see
`reference/memory-and-hooks.md`). Walk every item before writing anything new:

- `open`: ruled since — in chat, in a comment (`ArtifactComments`, `action: "read"`), in a
  commit? Record it.
- `decided`: carried out? → `complete` with proof. `complete`: does the proof still stand?
- Anything overtaken → `superseded`. Every bearing re-judged against the current goal.
- Outstanding work done? Mechanical fixes still in place? Rulings still standing?
- Every operator answer in this conversation since the last run is in the file.
- Nothing live left → offer retiring; when the operator asks for it or calls the work
  finished, run `node ~/.claude/skills/problem-brief/bin/brief-retire.mjs brief.json
  --memory-dir <memory directory>` (`reference/memory-and-hooks.md`). It keeps the JSON.
  Never delete the published page unasked: ask, naming the page.

Then, before writing a single new change note, move the current `changes` into `history`: append
one block `{ "version": <the brief's updated stamp as last published, not today's>,
"changes": <the changes array exactly as it stood> }` and start `changes` empty. Never
trim or rewrite old notes; skip the move only when `changes` is empty. Then re-check every
factual claim against the current tree, branch and run.

## The entry — five parts, in this order

| Field | What it holds | Length |
|---|---|---|
| `problem` | What is wrong, in plain words. No preamble, no background, no options. | 1–2 sentences |
| `brief` | The explanation: why it matters, in the operator's terms. (Not the brief's name.) | 2–8 sentences |
| `evidence` | Verified artefacts: code lines, runs, commits, documents, each with a note. | 1–4 items |
| `unwound` | How it works today (`now`, diagrams, file:line refs), then `whyWrong`. | as needed |
| `solutions` | Recommended option first, labelled; each priced and marked `reversible`. | 2+ options |

Ids are `Q-n`, permanent, next free number for a new entry. Full field list, states and
the summary box: `reference/entry-format.md`.

## Writing for the operator

Every prose field (title, short, problem, explanation, options, rulings, chat summary):

- **Meaning first, identifier trailing.** Every requirement, task, spec, review-round or
  issue id gets its plain-English meaning in the same sentence: *"the rule that two
  employers' postings must independently show the bug (FR-018)"*, never `FR-018` alone.
  This applies to `title` and `short` too: a label made of ids is still an id.
- **No coinages.** A word used only in this project or session (`gate`, `wire`, `fence`,
  `edge`, `antenna`, `witness`, `park`, `frame`, `flipped`, `settle predicate`) is replaced
  by what it means, not quoted or glossed.
- `short` is a plain label of two to five words, never a sentence and never ids.
- Problem first, background second. Two or more enumerated things are a list.
- Mark unproven claims as unproven and say what evidence would settle them.
- Run `humanizer:humanizer` over the prose before publishing.

## Building and publishing

**REQUIRED SUB-SKILLS:** `archify` for architecture/lifecycle drawings and
`humanizer:humanizer` for prose. If archify is missing, say so rather than silently
falling back to mermaid.

1. Write JSON, never HTML. Start from `examples/example.brief.json`; the entry shape, ids,
   states, bearing, pricing, reversibility and summary box are in
   `reference/entry-format.md`.
2. Group by root cause. Write `goal` first; every live entry gets `bearing`
   (`blocks-goal` / `escalated`) and `bearingReason`. Recommended option first, every
   option priced and marked `reversible`. Fix unambiguous reversible things yourself and
   list them as `mechanical`; anything irreversible is always the operator's call.
3. Validate, then render:

   ```bash
   node ~/.claude/skills/problem-brief/bin/validate-brief.mjs brief.json
   node ~/.claude/skills/problem-brief/bin/render-brief.mjs brief.json out/index.html
   ```

4. Publish with the `Artifact` tool, republishing to the same URL; read comments first.
   Comments, the chat summary, `AskUserQuestion` and freshness: `reference/publishing.md`.
   Diagrams (mermaid, archify): `reference/diagrams.md`.
5. First publish: register the brief in memory and store its `url`
   (`reference/memory-and-hooks.md`).
6. Chat: the computed delta (≤400 words), ending with `Blocks the goal: …`,
   `Escalated, not blocking: …`, the link and the JSON path.

## Red flags — stop

- About to ask the operator something → did you search the rulings by class?
- "This feels risky, better check with them" when a ruling covers it.
- An answer acknowledged in chat but not yet in the JSON.
- "Q-3 noted" with the "stop asking me about…" part dropped instead of made a ruling.
- An id or coinage you cannot explain in plain words in the same sentence.
- An entry the conversation ruled on still reading *awaiting your ruling*.
- Reaching for the HTML instead of the JSON; publishing without sending the link.
- The operator saying "I already told you".

## Files

| Path | What |
|---|---|
| `schema/problem-brief.schema.json` | Data contract; field descriptions say what belongs where. |
| `examples/example.brief.json` | A complete worked brief — start here. |
| `reference/entry-format.md` | Entry shape, ids, states, timestamps, grouping, summary box, validate/render. |
| `reference/publishing.md` | Publishing, comments, chat summary, freshness, `AskUserQuestion`. |
| `reference/memory-and-hooks.md` | Memory registration, hooks, recovery, retiring. |
| `reference/diagrams.md` | Mermaid and archify diagrams. |
| `bin/*.mjs` | Validator, renderer, delta, context, comments, memory, retire, extract — run with `node`. |

The source repository (github.com/zaytsevand/problem-brief) also holds `install.sh` /
`install.ps1` (install, hooks, CLAUDE.md line) and `test/brief.test.mjs` (run
`node --test test/*.test.mjs`); neither is copied into the installed skill directory.
