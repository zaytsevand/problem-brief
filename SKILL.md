---
name: problem-brief
description: >-
  Use when asked to build, publish, refresh or update an artefact (or brief,
  findings report, open-questions page, decisions page) that lists problems,
  issues, findings, review results or open questions for the operator to rule
  on — each with a problem statement, explanation and possible solutions. Also
  use when the same material is delivered as AskUserQuestion instead of a page.
  REQUIRED composition — archify (drawings) and humanizer (prose); see
  Dependencies.
license: MIT
metadata:
  version: "1.1"
  requires:
    - archify
    - humanizer
---

# Problem Brief

## Overview

A **problem brief** is a published page whose one job is to let the operator make
rulings without opening the repository. It is not a status report and not a
findings dump. Every entry states a problem, proves it, and ends with a
recommended way out.

**Core principle: the reader was not in your session and will not open a file.**
If an entry cannot be understood from the page alone, it is not finished.

## When to Use

Triggers, in the operator's own words:

- "group issues by root cause and write an artefact on them"
- "build and publish a claude artefact with problem statement, elaboration, and fix solutions"
- "send me a published artefact with a list of questions"
- "any outstanding questions for me? Refresh artefact if so"
- "update the artefact with the reviewed problem statement"
- "is there an open questions artefact for that?"
- "present as an artefact" / "post an artefact to claude artefacts so I can review it"
- Adjudicating the output of a review — a multi-reviewer round, a static
  analysis pass, a benchmark run — down into decisions someone must make.

Also use it when the ask is `AskUserQuestion` rather than a page — same content
rules, no page (see **The question variant**).

**Do not use** for a progress update, a completion report, or anything the
operator has not been asked to decide. Those go in chat.

## Dependencies

Two skills do work this one delegates rather than reimplements. Both are
**required** for a full brief; the page still renders without them, but it
renders worse in a way that matters.

| Skill | Does what here | Without it |
|---|---|---|
| [`archify`](https://github.com/tt-a1i/archify) | Draws the architecture, lifecycle, data-flow and sequence pictures the third part of an entry leans on. | You are left with mermaid, which is fine for a branch or a divergence and poor for a real system view. Do **not** substitute a flat image. |
| [`humanizer`](https://github.com/blader/humanizer) | Strips the tells of machine-written prose before publishing. | The brief reads as generated, which is precisely what makes an operator stop trusting it. |

Install them:

```bash
# archify — clone into your skills directory
git clone https://github.com/tt-a1i/archify ~/.claude/skills/archify

# humanizer — a plugin, so it installs through the plugin system
/plugin marketplace add blader/humanizer
/plugin install humanizer@humanizer
```

Check both are present before starting a brief that needs drawings. If archify
is missing, say so rather than silently downgrading every picture to mermaid —
the reader cannot tell the difference and will assume the simpler drawing was a
choice.

## Start every run with a state check

**Before writing a word, bring the state of every item up to date.** Of all the
mistakes a refreshed brief makes, this one does the most damage. The chip
says *awaiting your ruling* on something ruled on three days ago, or *outstanding
work* on something merged yesterday, and the reader trusts the chip.

This comes first on every run: a new brief built from an old one, a refresh, or
folding in comments. Walk the whole file, item by item, nothing skipped:

| Item | Ask | Where to look |
|---|---|---|
| `open` entry | Has it been ruled on since — in chat, in a comment, in a commit message? | This conversation, `action: "comments"`, the branch log |
| `decided` entry | Has the chosen option been carried out? | Commits, merged pull requests, the tests, the tree itself |
| `complete` entry | Does the proof still stand — is the commit on the branch, does the test still exist? | The tree |
| any entry | Has the problem gone away or been overtaken? Then it is `superseded` (shown as *retracted*). | The tree, later rulings |
| `open` or `decided` entry | Does its `bearing` still hold against the goal? Re-judge every one whenever the goal changes. | The goal as the operator last stated it |
| `outstanding` item | Is it done? Is the entry it waited on still awaiting a ruling? | The tree; the entry's own status |
| `mechanical` item | Is the fix still in place? | The tree |

For each item that moves, record why (`decision`, `resolution`, the new
`state`) and move its `updated` stamp. Only then go on to the facts
(**Freshness**), the comments, and any new entries.

The validator catches a state that contradicts its own record: a ruling on an
entry still marked open, a resolution on one still marked decided, work marked
blocked on an entry that has been ruled, a ruling dated after the entry says it
last changed. It **cannot** see a ruling that lives only in chat or a commit
that was never recorded. That is what the walk above is for.

## The entry shape

Every entry, in this order. The order is the deliverable — do not reshuffle it.

| Part | What it is | Length |
|---|---|---|
| **a. Problem** | One or two plain sentences naming what is wrong. No preamble. | 1–2 sentences |
| **b. Brief explanation** | Why that matters, in the operator's terms. | 2–8 sentences |
| **c. Evidences** | Cite the verified evidences for the issue, grounded in real artefacts: code lines, documents, prior findings. | 1–4 items |
| **d. The unwound explanation** | How it actually works today, with a diagram where a diagram helps, and references — file paths with line numbers, commit SHAs, run IDs, spec paths. Then why that is wrong. Where there is no defect, state the target state instead. | as long as it needs |
| **e. Solutions** | At least one, better two or more. **The first is the recommendation** and is labelled as such. Each carries its cost — work, risk, what it forecloses. | 2+ options |

Number the entries so they can be cited back at you (`Q-1`, `Q-2`, `Q-3` — not
invented codes). An id is permanent: on a refresh, an entry keeps the number it
was given, a resolved one keeps its number and is marked ruled, and a new one
takes the next free number. Renumbering breaks every reference the operator has
already made.

`schema/problem-brief.schema.json` is the machine-readable form of this table.
Every field carries a description saying what belongs in it.

## An entry's life

An entry is never deleted and never renumbered. It moves through four states,
and the page is refreshed by moving entries along, not by rewriting it.

| `status` | Page shows | Means | Needs |
|---|---|---|---|
| `open` | *blocks the goal* or *escalated, not blocking* | Awaiting your ruling. | `bearing` and `bearingReason` |
| `decided` | *outstanding work* | A way forward was chosen. It has **not** been carried out. | `decision` — which option, when, and why; `bearing` and `bearingReason` |
| `complete` | *complete* | The chosen option has been carried out. Closed. | `resolution` — when, what happened, and proof |
| `superseded` | *retracted* | The problem went away or was overtaken. Nothing was carried out. | — |

**Closing an entry** means setting `status` to `complete` and filling in
`resolution`: the date, one or two plain sentences saying what happened, and
evidence — the commit, the pull request, the test that now covers it, the ruling
that cut the scope. Where what happened differs from the option that was chosen,
record it in `amendments` rather than quietly editing the option: one item per
drift, saying what was ruled, what was done instead, and why the implementer
chose to drift. That makes the entry **complete, with amendments**: its chip
reads *Complete · amended*, the drift is shown inside the entry, and a done item
about it is highlighted and listed first in the summary. A remark that is not a
drift from the ruling (a measurement not yet reported, a follow-up) belongs in
the resolution note, not in amendments. The old free-text `differs` still
renders as a remark, with a warning. The renderer refuses to close an entry
that carries no proof.

`complete` is deliberately wider than "fixed". Not every entry ends in a repair:
some end because the question was answered, some because the scope was cut, some
because a measurement was re-taken and settled the matter. All of those are the
chosen option carried out, so all of them are `complete`.

`decided` and `complete` are not the same thing, and conflating them is how a
page starts claiming work that has not happened. Ruling on an option closes the
question; it does not close the entry.

**How the page uses the states.** Every entry carries a chip saying where it
stands, and the counts along the top are the controls: click one and the page
shows that category alone. It opens on **blocks the goal**, because that is what
stands between the reader and what they are driving at; with nothing blocking,
it opens on the escalated questions. A ruled entry not yet carried out is shown
under **outstanding work** with the outstanding list, because that is what it is:
agreed work, waiting to be done. "Everything" shows the lot.

Nothing is ever removed from the document — a filter only decides what is on
screen. So a page with no scripting shows the whole brief, a link to `Q-3`
reaches it even when the filter would have hidden it (the page switches to that
entry's category), and the reader's last choice is remembered between visits.

That is what keeps a long-running brief readable: closed entries stay citable
for good without burying the three things that still need a decision.

**Timestamps.** The brief and every item on it (entries, handled fixes,
outstanding work) carry two stamps: `created`, when it was first written, and
`updated`, when it last changed in any way. Write them as a moment with its
zone, `2026-09-15T09:40Z`, because a brief is often refreshed more than once a
day.

- `created` is set once and never touched again.
- `updated` moves with **every** change to that item: wording, evidence,
  status, ruling, resolution. It does not move when nothing changed. Re-stamping
  every item on a refresh destroys the one thing the stamp is for, which is
  showing the reader what moved.
- The brief's own `updated` moves whenever anything on it does, so it is never
  earlier than any item's.
- Re-checking the facts and every item's state is a change to the brief: move
  the brief's own `updated` to that moment. There is one stamp for it, not two.
  `generated` is retired, and the validator warns when it is still present.

The page shows both stamps on every item, and only the two stamps on the
brief's own line, so the reader can see what is new since they last looked. The validator rejects stamps that contradict each other
or the dates the item records.

**Not every fix needs an entry.** Something unambiguous, with no judgement in
it, goes in `mechanical` — handled without asking, listed so you know it was
done. An entry is for something that needed you.

## Grouping

**Group by root cause, not by finding.** Five review findings that share one
cause are one entry with five symptoms, not five entries. Say which findings
rolled into each group.

Separate the material by what it demands of the reader:

- **Blocks the goal** — needs a ruling, and the goal cannot be reached without
  it. These are the brief. Mark them `"bearing": "blocks-goal"`.
- **Escalated, not blocking** — a real decision that belongs to the operator,
  but unrelated to the goal being driven now. Visible, never presented as a
  blocker, never asked one at a time in the middle of the work. Mark them
  `"bearing": "escalated"`.
- **Mechanical** — an unambiguous fix with no judgement in it. **Fix these
  yourself first**, then list them as already done. Never ask about them.
- **Outstanding work** — known, agreed, not yet done. A separate list at the
  end, not mixed into the decisions.

**The goal comes first.** Before bracketing anything, write `goal` in the
operator's own words: what the current work is driving towards. Every `open` and
`decided` entry then carries a `bearing` and a one-line `bearingReason` saying
why it is, or is not, on the goal's path. The validator refuses a live entry
without a bearing, a bearing without a reason, and a blocker on a brief with no
goal. When the operator defers something "because it doesn't block X", that is
a bearing, not a ruling.

## The summary at the top

The box above entry one is read first, often on a phone. It is structure, never
one paragraph:

- `changes` — what moved since the last version, one item per change, each
  with its `kind`: `raised` (new entry or work), `changed` (moved state without
  closing, or a ruling changed), `completed` (carried out), `retracted` (went
  away or was overtaken), or `note` (about the brief as a whole). The page
  groups them — changes, then closings, then notes — and marks each kind with
  its own icon. Write the kind; never order the list by hand.
- **New additions are pinned above everything**, whatever their weight: every
  `raised` change goes to a "New since the last version" block at the very top,
  split into what blocks the goal, then what is escalated, then other new work.
  The entry is taken from the change's `id`, or the first entry id in its text.
  A question the reader has not seen yet is never left at the bottom of the box.
- **Waiting on you** — built by the renderer from the entries: what blocks the
  goal, then what is escalated. Do not write it by hand.
- `context` — anything else the reader needs before entry one. Optional.
- `background` — earlier history, folded away. `source` goes with it, never on
  the stamp line.

Give every entry a `short` label of two to five words. Wherever an id stands
bare in text, the page shows it as `Q-29 (one-call page read)`, linked to the
entry; an id the prose already explains, in brackets after the meaning, is
linked without repeating the label. The validator warns on a cited id that is
not on the page.

## Language

The brief is read by a person, so it is written for a person.

- **Run the humanizer over the prose** (`humanizer:humanizer`) before publishing.
- **No jargon.** Every noun is either a real thing in the subject's own world —
  whatever that world is, named the way the people in it name it — or a widely
  used technical term (WebSocket, migration, foreign key). If a term is used in
  only this project, it is not a technical term; it is a coinage.
- **No broad coinages at all**: `gate`, `wire`, `fence`, `edge`, `antenna`,
  `witness`, `park`, `frame`. They carry no meaning outside the session that
  minted them.
- **Never assume an identifier rings a bell.** A requirement number, a task id,
  a review round, a specification number — each gets its plain-English meaning
  first, in the same sentence, with the identifier trailing as the pointer.
  *"the rule that two suppliers must independently show the fault (FR-018)"* is
  readable and still searchable; `FR-018` alone is neither.
- Problem first, background second. Never the reverse.
- **Two or more things enumerated are a list, not a sentence.** Every prose field
  renders `- ` and `1. ` lines as real lists, including a lead-in line followed
  straight by its list.
- Mark unproven claims as unproven, explicitly, and say what evidence would
  settle them.

## Write the data, not the page

**The page is never hand-written.** Content goes into a JSON file matching
`schema/problem-brief.schema.json`; the renderer turns that into the page. The
layout is therefore identical every time, which is the point — the reader learns
one layout once and never re-learns it.

```bash
# Linux / WSL
node ~/.claude/skills/problem-brief/bin/render-brief.mjs brief.json out/index.html
# Windows
node "$env:USERPROFILE\.claude\skills\problem-brief\bin\render-brief.mjs" brief.json out\index.html
```

**Validate before you render, every time.** A brief is usually written by a
machine, and the way a machine gets it wrong is by misspelling a field — which
no renderer notices, because the misspelt field simply is not there. The
content vanishes and the page still looks finished.

```bash
node ~/.claude/skills/problem-brief/bin/validate-brief.mjs my-brief.json
```

It checks the file against the schema — types, lengths, id shapes, dates, and
above all unknown fields, which come back matched against the field you probably
meant (`"recommend"` → *did you mean "recommended"?*). Then it checks the rules a
schema cannot state: exactly one recommended option and it must be listed first,
every citation carries a note, every option carries a price, a closed entry
carries proof, an id is never reused, outstanding work never waits on an entry
that does not exist, every status agrees with what its entry records, and every
timestamp agrees with the others.

Errors name the entry, the field, and what to do. Fix them all before rendering;
the renderer runs the same check and refuses anyway.

Add `--json` when another tool needs the result rather than a person.

`examples/example.brief.json` is a complete worked brief: three entries, both
diagram kinds, one closed as complete, plus the handled and outstanding lists,
all timestamped.
Start from it rather than from an empty file.

**Where the files go.** Put the brief JSON, the rendered page and the diagram
folder together in a working directory — the scratchpad if the brief is
throwaway, or beside the specification if it belongs to a feature. Keep the
JSON. The next refresh edits it; it does not start again.

## Diagrams

Three kinds, and the choice is about who draws it, not about looks.

| Kind | Use for | How |
|---|---|---|
| `mermaid` | A shape you can state in a few lines: a sequence, a branch, a divergence between two paths. | Put the diagram text in `source`. Artefacts render mermaid natively — nothing to load. |
| `archify` | A real architecture, lifecycle, data-flow or workflow view that deserves a proper picture. | Render it with `/archify`, then embed the rendered page. |
| `svg` | A picture that already exists as a self-contained file, and only then. | Give the path in `file`; the renderer inlines it, centred and scaled to the column. |

**Embedding an archify picture.** Render, then point at it:

```bash
# archify sits beside this skill in your skills directory
node "$(dirname "$(dirname "$0")")/archify/bin/archify.mjs" render lifecycle q3.lifecycle.json diagrams/q3.html

# or, spelt out — the skills directory differs by machine:
#   Linux / WSL   ~/.claude/skills/archify/bin/archify.mjs  (may be a link into ~/.agents/skills)
#   Windows       %USERPROFILE%\.claude\skills\archify\bin\archify.mjs
```

Simpler still, invoke the `/archify` skill and let it render — it knows where it
lives and it will iterate on the layout with you when its validator objects.

```json
{ "kind": "archify", "caption": "Where the run stops, and the step that does not exist yet.",
  "file": "diagrams/q3.html", "spec": "diagrams/q3.lifecycle.json",
  "archifyType": "lifecycle" }
```

The drawing goes in its own frame in archify's **presentation mode**, which
centres it and scales it to the room the frame has. It stays live: zoom, the
path, map and lens controls, hovering a step for its detail, the guided views.
Archify's stylesheet cannot reach the brief's, and the brief hands the frame the
reader's light or dark theme and re-hands it when the reader switches.

**The whole drawing goes inside the page.** A brief is published as one file,
and not every publishing tool can carry a companion file alongside it. A frame
pointing at a companion that never arrives is a blank box, and a reader cannot
tell a blank box from a broken page. Carrying the drawing inside costs about a
tenth more bytes than the drawing itself, works everywhere, and depends on
nothing — so it is the default and you need do nothing to get it.

Set `"embed": "file"` to reference the drawing as a companion instead. That
keeps the page small, which starts to matter somewhere past half a dozen
drawings, and it only works where the publishing tool can carry companions. The
renderer prints exactly what to publish when you ask for it.

**A drawing that cannot be carried becomes a visible note**, naming its source,
rather than an empty frame. That is deliberate: the reader is told the picture
is missing instead of being left to wonder whether the page is broken.

**Do not reach for a flat picture instead.** It throws away everything archify
draws it for, and it is not the fix for a picture that looks wrong in the page.

**Leave the height alone.** The renderer works the frame height out from the
drawing's own coordinate box — the `viewBox` in the archify source, or the
rendered drawing's own if there is no source to read. That is what stops the
picture being cropped, so setting `height` by hand undoes it. Set `height` only
when you have looked at the page and the automatic figure is wrong.

**Keep the coordinate box tight.** The frame inherits the drawing's proportions,
so a `viewBox` taller than the drawing needs becomes empty space in the brief.
Shrink `meta.viewBox` until archify complains, then go back one step.

**Keep the `spec` path.** That is how the next refresh edits the picture instead
of redrawing it, which is what loses the fallbacks and the stores.

Archify's validator is strict about crossings and label collisions and will
refuse to render until the layout is clean. That is the tool working. Adjust
`col`, `yOffset`, `channelY`, `fromSide`/`toSide` as its messages tell you, or
drop a label — do not fight it by lowering the quality profile.

## Publishing

1. Render the page from the JSON, then publish it with the `Artifact` tool.
   Load `artifact-design` first, as that tool requires. Pass every archify
   diagram in `files`.
2. **Hand the link back in chat, with the update summary** (see **Report back
   in chat**). The operator reads on mobile and cannot see tool output. A brief
   that was published but not linked was not delivered.
3. **Update in place.** When the brief already exists, republish to the same URL
   (`url:` parameter, or the same local file path within one session). Do not
   mint a second page for the same subject. If you do not have the URL, find it
   with `action: "list"` before publishing anything.
4. **Read comments before republishing** (`action: "comments"`), fold them in,
   then resolve the threads you actually addressed.

## Report back in chat

Every run ends with a short summary in chat: after a publish, after a refresh,
after an `AskUserQuestion` round. It is the only part the operator is certain
to read, so it says what **moved**, not what the brief says.

- **Up to 400 words**, as a bulleted list of changes.
- **The state delta only.** An entry that changed state reads
  `Q-2: open → decided (name the fifth failure)`; a new entry reads
  `Q-6 raised: one plain line`; handled fixes and outstanding work the same
  way. Say what changed in content only where it changes the ruling being asked
  for.
- **Do not repeat the brief.** No problem statements, no evidence, no options.
  The link carries those.
- Close with two lines, ids with their short labels: `Blocks the goal: Q-4
  (…)` and `Escalated, not blocking: Q-6 (…)`. Say `Blocks the goal: nothing`
  when that is so; it is the most useful line in the summary.
- On a first publish there is no earlier state, so list the counts per state
  and those two lines.
- If nothing moved, say so in one line and do not republish.

## Freshness — the failure that recurs most

This comes after the state check, and covers the claims rather than the
statuses. Every republish is re-derived from the current state of the code, the branch and
the run. Never from a snapshot file, an earlier draft, or a subagent's report
from an hour ago.

Before you republish, re-check every factual claim the page makes: does that
code path still exist, is that count still right, is the thing you describe
still in the tree. Nearly every correction a brief draws is the same one —
a sentence describing something that was true when it was written and has since
been changed or removed. Stale text surviving a rebuild is the failure mode of
this whole format, and the reader finds it before you do.

For diagrams: keep one source per subject and edit it. Do not redraw from
memory each time — a redrawn diagram silently loses the fallbacks, the
compensations and the stores that the original had.

## The question variant

When asked for `AskUserQuestion` instead of a page, the content rules are
unchanged — plain English, problem first, grouped by root cause, recommended
option first and labelled `(Recommended)`. Only the page is dropped. The state
check still comes first, so nothing already ruled on is asked again. Only
`blocks-goal` entries are asked; `escalated` ones are listed in the message, not
asked, so the operator can pull one forward if they choose. Record the
answers back into the JSON, moving each entry's status and `updated` stamp, and
end with the chat summary.

## Common mistakes

| Mistake | Fix |
|---|---|
| Entries are the review findings, one per finding | Group by root cause; symptoms live inside an entry |
| Asking about something you could just fix | Fix it, then list it as done |
| A problem with no recommendation | Always recommend one option and say why |
| Solutions with no cost attached | Price each one: work, risk, what it rules out |
| Identifiers standing in for meaning | Meaning first, identifier as the pointer |
| Publishing a second page for the same subject | Republish to the same URL |
| Republishing without re-deriving the facts | Re-check every claim against the tree first |
| Publishing without sending the link | Put the URL in your chat reply |
| Hand-writing the page's HTML | Write the JSON; the renderer owns the layout |
| Renumbering entries on a refresh | Ids are permanent; closed entries stay, marked closed |
| Deleting an entry once it is done | Set `status: "complete"` with a `resolution`; it moves to Closed |
| Marking something `complete` when only the ruling was made | That is `decided`; `complete` means it was carried out |
| Editing the ruling to match what landed, or a remark filed as a drift | Record each real drift in `resolution.amendments` — ruled, done instead, why (say "not recorded" if nobody wrote the reason); remarks go in the note |
| Using `"embed": "file"` without publishing the companion | Drop the setting — the drawing then travels inside the page |
| Flattening an archify picture to a still image | Embed the live page; flattening throws away what it is for |
| Setting a frame height by hand | Let the renderer read the drawing's proportions, or it gets cropped |
| Refreshing the facts but not the states | Walk every item's state first; a chip that is out of date is worse than no chip |
| Editing an item without moving its `updated` | Every change moves the stamp, and the brief's own stamp with it |
| Re-stamping every item on a refresh | Move `updated` only on the items that actually changed |
| Leaving finished outstanding work as `not-started` or `blocked` | Set `state: "done"`; it stays on the page |
| A chat summary that retells the brief | Bullets of what moved, ≤400 words, then the two lines: blocks the goal, escalated |
| Presenting an unrelated decision as a blocker | Bracket it `"bearing": "escalated"` with its reason; only what stands in the goal's way is `blocks-goal` |
| A headline summary written as one paragraph | `changes` as typed items; leave *waiting on you* to the renderer; history in `background` |
| A new question recorded only in "Waiting on you" | Add a `raised` change with its `id`, so it is pinned to the top |
| A change with no `kind` | Give it one, so it lands in its group with its icon; `note` only for the brief as a whole |
| Keeping `generated` beside `updated` | Delete it; a re-check moves `updated` |

## Red flags — stop and rewrite

- A sentence you cannot parse without opening a spec file.
- The word `gate`, `wire`, `fence` or `edge` in the prose.
- An entry that ends without a recommended option.
- Prose carried over verbatim from the previous version of the page.
- "The operator will know what I mean." They will not.
- Reaching for the HTML instead of the JSON.
- Starting to write before every item's state has been checked.
- An entry the conversation ruled on still reading *awaiting your ruling*.
- A brief with open entries and no `goal`.
- "The operator deferred it" recorded as a ruling rather than as `escalated`.

## What is in this skill

| Path | What it is |
|---|---|
| `schema/problem-brief.schema.json` | The data contract. Field descriptions say what belongs where. |
| `bin/render-brief.mjs` | JSON to page. Fixed layout, no dependencies, refuses malformed briefs. |
| `bin/validate-brief.mjs` | Schema check plus the rules a schema cannot state: recommendations, proof, states, timestamps. |
| `examples/example.brief.json` | A complete worked brief — start from this. |
| `examples/diagrams/*.lifecycle.json` | The archify picture source for the worked example. |
| `test/brief.test.mjs` | The validator and renderer behaviour, pinned. Run `node --test test/*.test.mjs`. |
