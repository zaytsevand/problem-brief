---
name: problem-brief
description: >-
  Publishes and maintains a problem brief: a page of findings, open decisions and
  questions for the operator, each with the problem, evidence and a recommended way out,
  kept as JSON that records every ruling so nothing is asked twice. Use by default,
  without being asked, whenever work turns up something the operator must decide (a
  finding with more than one way out, a risk, an open question, a choice between
  options), even mid-task and even when the operator only asked for an investigation.
  Also use when asked to build, publish, refresh or update a brief, findings report,
  open-questions or decisions page; when the operator answers, rules on or comments on
  anything a brief holds, in chat or in a comment on the page; when questions would
  otherwise go out through AskUserQuestion; and when retiring a brief whose work is
  done. Not for a progress, status or completion report with nothing to decide, for
  running a chorus review, or for converting chorus records to the shared schema.
license: MIT
metadata:
  version: "1.9"
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

**Every write to a brief's JSON goes through `brief`**, short here for
`node ~/.claude/skills/problem-brief/bin/brief.mjs`. Never edit the file by hand or with a
script: each command validates the result and refuses to write anything broken, writes the
change note, keeps the stamps in order and locks the file while it writes. `brief --help`
lists every command and flag; `brief set <file> <brief|Q-n|R-n|W-n> --field value` changes
any field the others do not cover.

## When to use

- **By default, unasked**: anything the operator must rule on — a finding with more than
  one way out, an open decision, a question — goes into the brief for that subject (or a
  new one). Chat carries only the short summary of what moved and the link.
- Asked for an artefact/page/brief of problems, findings, review results or questions.
- The operator answers, rules or comments on something a brief holds — even mid-task.
- Not for a progress or completion report with nothing to decide; that goes in chat.

## Called as `/problem-brief` with nothing else asked — walk the open questions

The default action is an interactive walk of every `open` entry, the escalated ones as well as
the goal blockers:

1. Pick the brief: the one this session owns, else the one registered for this project in
   memory. More than one candidate: ask which first, in one `AskUserQuestion`.
2. Run the state check (below), so nothing already answered is asked again.
3. Ask every entry still `open` through `AskUserQuestion`, goal blockers first, following
   the question variant in `reference/publishing.md`: four per dialog, read-back, one
   record and publish at the end.
4. No open entries: say so in one line with the link; do not publish.

Arguments after the command (`/problem-brief refresh`, a subject, a request) replace this
default with what they ask for.

## When the operator answers or rules — this turn, before anything else

Whatever else you were doing, the turn the answer arrives produces these, in order:

1. **An answer in a comment on the page**: read the thread yourself (`ArtifactComments`,
   `action: "read"`, the page `url` and `thread_id`). The automatic reply the commenter
   already got is not a record, whatever it promised.
2. **The entry it answers**: `brief decide <file> Q-n --chose <option> --note "<their
   words>"` (`--add-solution '{…}'` when they chose something not on the list). Nothing
   left to carry out: then `brief complete <file> Q-n --note … --evidence '{…}'`.
3. **A standing ruling for every part that outlives the entry** — a preference, a scope
   cut, "stop asking me about X", "we don't care about Y": `brief rule <file> --about
   "<the question as it would be asked again>" --said "<their exact words>" --source
   "chat, <date>" --entries Q-n`. A ruling about how Claude should work is also saved as a
   `feedback` memory, named with `--memory`.
4. A ruling that contradicts an earlier one: `brief rule … --replaces R-n` marks the old
   one replaced. Never edit or delete a ruling, unless the operator withdraws it (below).
5. **Back into the project's spec suite, if it keeps one.** The brief is Claude's record;
   the project runs on its own. Look for one: `.specify/` with `specs/<feature>/spec.md`
   (speckit), `docs/adr/` or `docs/decisions/` (ADRs), a `docs/specs/` tree. Pick the
   document that governs what was decided (the `binding`, else the spec the work
   implements) and write the decision in that suite's own form:
   - speckit spec: a line under `## Clarifications` → `### Session YYYY-MM-DD`,
     `- Q: <about> → A: <what was decided> (brief Q-3)`, and amend the requirement or
     scope line the decision changes so the spec no longer says the opposite;
   - ADRs: a new ADR for an architectural choice; an ADR it overturns gets its status
     changed to superseded, pointing at the new one;
   - a constitution or other governing principles: never edit; a decision that
     contradicts one is a new entry for the operator.

   Name the paths in the decision's or ruling's `specs` (`brief set <file> Q-n|R-n
   --specs '["<path>"]'`). It is a reversible repo edit, so no question is needed, but it
   counts as carrying out: on a brief this session does not own it becomes an
   `outstanding` item instead (`brief work <file> add`).

   **No spec suite: Claude's native memory instead.** Save a `project` memory, one
   decision per file: the decision as a fact, then **Why:** (the operator's reason) and
   **How to apply:**, linking the brief's pointer memory as `[[problem-brief-<name>]]`
   and citing the entry id, plus its line in `MEMORY.md`. Name the file in the decision's
   or ruling's `memory`. It is the project's lasting record, so it stays when the brief
   is retired (`brief set <file> Q-n|R-n --memory <file>`). A ruling about how Claude
   works already went to a `feedback` memory in step 3, and that covers it.
6. Validate; render; republish to the same URL. The commands wrote the change notes.
7. **A comment thread**: only now resolve it (`ArtifactComments`, `action: "resolve"`), so
   the ruling is in the saved file before the thread closes. A thread with nothing to
   record: `reference/publishing.md`.
8. Chat: the delta only (`Q-3: open → decided (…)`, `R-4 recorded: …`) plus the link and
   the JSON path. Then go back to the other task.

"I'll fold it in at the next refresh" loses it: by then the turn may be summarised away.
Being busy with something else is not a reason to defer.

**Recording is not carrying out.** This session owns a brief when the brief's `owner` names
this session, branch or worktree, or, with no `owner`, when this session created, published or
edited it before the ruling arrived. A ruling on a brief it does not own is still recorded
(steps 1–8, with step 5 left as an outstanding item), but nothing it decides is carried out here: no code, infrastructure or other
change. Add the follow-up with `brief work <file> add --summary … --detail "unowned: …"`, and say in one line of chat that the ruling landed here and who should carry it
out. A ruling worded as an order ("add X to Y") is not a go-ahead for a brief this session
does not own: ask once before acting on it.

**Withdrawn, not retracted.** `superseded` is for a problem that went away. When the operator
says a decision was misunderstood or wrong from the start and asks for it removed, delete
it and everything built on it with `bin/brief-withdraw.mjs`, which lists the ids in
`withdrawnIds`. Name the ids to the operator first (`--dry-run`); procedure:
`reference/entry-format.md`.

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
| Nothing, and the fix is easy and can be undone | Do not raise it. Carry it out and list it as `mechanical`. |
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
- Every decision and ruling since the last run written back (step 5 above): to the spec
  suite, whose `specs` paths still say what was decided, or else to a memory file.
- Every operator answer in this conversation since the last run is in the file.
- Nothing live left → offer retiring; when the operator asks for it or calls the work
  finished, run `node ~/.claude/skills/problem-brief/bin/brief-retire.mjs brief.json
  --memory-dir <memory directory>` (`reference/memory-and-hooks.md`). It keeps the JSON.
  Never delete the published page unasked: ask, naming the page.

Then, before writing a single new change note, run `brief refresh <file>` once: it moves
the current `changes` into `history`, stamped with the version they belong to, and does
nothing when there are none. Then re-check every factual claim against the current tree,
branch and run; move entries along with `brief decide`, `complete`, `retract`, outstanding
work with `brief work <file> update|done W-n`, and anything else with `brief set`.

## The entry — five parts, in this order

| Field | What it holds | Length |
|---|---|---|
| `problem` | What is wrong, in plain words. No preamble, no background, no options. | 1–2 sentences |
| `brief` | The explanation: why it matters, in the operator's terms. (Not the brief's name.) | 2–8 sentences |
| `evidence` | Verified artefacts: code lines, runs, commits, documents, each with a note. | 1–4 items |
| `unwound` | How it works today (`now`, diagrams, file:line refs), then `whyWrong`. Diagram or `noDiagram` (below). | as needed |
| `solutions` | Recommended option first, labelled; each priced and marked `reversible`. | 2+ options |

Raise it with `brief raise <file> --title … --short … --problem … --brief … --evidence
'{…}' --solution '{…}' --unwound '{…}' --bearing … --bearing-reason …`; it takes the next
free number and writes the `raised` note.

**The diagram judgement, on every open or decided entry.** Ask: does it describe behaviour
or states, and would a picture make it answerable? Parties exchanging messages over time →
`sequenceDiagram`; states and transitions → `stateDiagram-v2`; today versus proposed → a
drawing of each. Draw it, or write one line in `unwound.noDiagram` on why no picture helps.
The page prints that line; the validator warns when neither is there.

**Show what the reader has to see.** The reader works from the published page, often on a
phone, and cannot open a file. When the question is about how something looks or what it
says in place (a mockup, a layout, new wording on a page), take a screenshot and attach
it: `{"kind":"image","file":"shots/q2-wide.png","alt":…,"caption":…}` in
`unwound.diagrams`, or an `image` on the evidence item. The renderer embeds it in the page.
Attach a wide shot and a phone-width shot when layout matters. A path, a link to an HTML
file or a line of markup is never the thing to look at, and it is not evidence for a
visual question. The validator warns when an entry names such a file and carries no
picture. To add a picture later: `brief set <file> Q-n --diagram '{…}'`.

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
- Run `humanizer:humanizer` over the prose before you render. The renderer bakes the prose
  into the page, so humanizing after a render means rendering twice.

## Building and publishing

**REQUIRED SUB-SKILLS:** `archify` for architecture/lifecycle drawings and
`humanizer:humanizer` for prose. If archify is missing, say so rather than silently
falling back to mermaid.

1. Write JSON through `brief`, never HTML: `brief new <file> --title … --subject … --goal …`,
   then `brief raise` per entry. `examples/example.brief.json` shows a finished one; the
   entry shape, ids, states, bearing, pricing, reversibility and summary box are in
   `reference/entry-format.md`.
2. Group by root cause. Write `goal` first; every live entry gets `bearing`
   (`blocks-goal` / `escalated`) and `bearingReason`. Recommended option first, every
   option priced and marked `reversible`. Fix unambiguous reversible things yourself and
   list them with `brief fix <file> --summary …`; anything irreversible is always the operator's call.
   A reversible, small fix that would block the goal is not a blocker: do it, list it as
   `mechanical` with how to undo it. Never change a ruling unasked; if a ruled option cannot
   be carried out at all, take its reversible fallback and record that you did. The
   validator warns on an `open` goal blocker whose recommended option is `reversible: true`.
3. Humanize, then validate, then render, every time; the prose must be final before the
   renderer sees it:

   ```bash
   node ~/.claude/skills/problem-brief/bin/validate-brief.mjs brief.json
   node ~/.claude/skills/problem-brief/bin/render-brief.mjs brief.json out/index.html
   ```

4. Publish with the `Artifact` tool, republishing to the same URL; read comments first.
   Comments, the chat summary, `AskUserQuestion` and freshness: `reference/publishing.md`.
   Diagrams (mermaid, archify) and screenshots: `reference/diagrams.md`.
5. First publish: register the brief in memory and store its `url`
   (`reference/memory-and-hooks.md`). Registering sets `owner` to the current git branch
   (`--owner` to name another); the session-start digest warns a session on a different branch.
6. Chat: the computed delta (≤400 words), ending with `Blocks the goal: …`,
   `Escalated, not blocking: …`, the link and the JSON path.

## Red flags — stop

- About to ask the operator something → did you search the rulings by class?
- "This feels risky, better check with them" when a ruling covers it.
- An answer acknowledged in chat but not yet in the JSON.
- A decision that lives only in the brief: neither in the project's spec nor in memory.
- "Q-3 noted" with the "stop asking me about…" part dropped instead of made a ruling.
- An id or coinage you cannot explain in plain words in the same sentence.
- An entry the conversation ruled on still reading *awaiting your ruling*.
- Reaching for the HTML instead of the JSON; publishing without sending the link.
- Opening a brief's JSON in an editor, or writing it from python, `jq` or `sed`, instead of `brief`.
- Rendering, then humanizing: a render after a prose change is a render thrown away.
- Starting work on a ruling for a brief this session does not own.
- Marking a decision the operator withdrew as `superseded`, so it stays on the page.
- The operator saying "I already told you".

## Files

| Path | What |
|---|---|
| `schema/problem-brief.schema.json` | Data contract; field descriptions say what belongs where. |
| `examples/example.brief.json` | A complete worked brief — start here. |
| `reference/entry-format.md` | Entry shape, ids, states, timestamps, grouping, summary box, validate/render. |
| `reference/publishing.md` | Publishing, comments, chat summary, freshness, `AskUserQuestion`. |
| `reference/memory-and-hooks.md` | Memory registration, hooks, recovery, retiring. |
| `reference/diagrams.md` | Mermaid and archify diagrams, and screenshots. |
| `bin/brief.mjs` | Every write to a brief: new, raise, decide, complete, retract, rule, work, fix, note, set, refresh, stamp. |
| `bin/*.mjs` | Validator, renderer, delta, context, comments, memory, retire, withdraw, extract, guard hook — run with `node`. |

The source repository (github.com/zaytsevand/problem-brief) also holds `install.sh` /
`install.ps1` (install, hooks, CLAUDE.md line) and `test/brief.test.mjs` (run
`node --test test/*.test.mjs`); neither is copied into the installed skill directory.
