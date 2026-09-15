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
  version: "1.0"
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

| `status` | Means | Needs |
|---|---|---|
| `open` | Awaiting your ruling. | — |
| `decided` | A way forward was chosen. It has **not** been carried out. | `decision` — which option, when, and why |
| `complete` | The chosen option has been carried out. Closed. | `resolution` — when, what happened, and proof |
| `superseded` | The problem went away or was overtaken. Nothing was carried out. | — |

**Closing an entry** means setting `status` to `complete` and filling in
`resolution`: the date, one or two plain sentences saying what happened, and
evidence — the commit, the pull request, the test that now covers it, the ruling
that cut the scope. Where what happened differs from the option that was chosen,
say so in `differs` rather than quietly editing the option. The renderer refuses
to close an entry that carries no proof.

`complete` is deliberately wider than "fixed". Not every entry ends in a repair:
some end because the question was answered, some because the scope was cut, some
because a measurement was re-taken and settled the matter. All of those are the
chosen option carried out, so all of them are `complete`.

`decided` and `complete` are not the same thing, and conflating them is how a
page starts claiming work that has not happened. Ruling on an option closes the
question; it does not close the entry.

**How the page uses the states.** Every entry carries a chip saying where it
stands, and the counts along the top are the controls: click one and the page
shows that category alone. It opens on **awaiting your ruling**, because that is
the only part waiting on the reader. "Everything" shows the lot.

Nothing is ever removed from the document — a filter only decides what is on
screen. So a page with no scripting shows the whole brief, a link to `Q-3`
reaches it even when the filter would have hidden it (the page switches to that
entry's category), and the reader's last choice is remembered between visits.

That is what keeps a long-running brief readable: closed entries stay citable
for good without burying the three things that still need a decision.

## The headline summary

The box under the counts is the first thing the reader sees, often on a phone.
It is built from fields, not written as one paragraph:

| Field | Shown as | Holds |
|---|---|---|
| `changes` | **Since the last version** — a list | One item per entry that moved state or is new: *"Q-3 is complete: the resume action landed."* Leave it out on a first version. |
| — | **Waiting on you** | Worked out from the entries still `open`, so it can never disagree with the counts. Nothing to write. |
| `context` | Free text | Only what the reader needs before entry one. Short. |
| `background` | **Background**, folded away | Earlier history the reader may want but does not need to make a ruling. |

Never put the changes, the waiting list or old history into `context`. That is
how the summary turns back into a wall.

The stamps (`generated`) and the `source` get a line each, so the source never
reads as part of the date line.

## Citing entries

**An id is always followed by a short label.** Give every entry a `short` label
of five words or fewer. Wherever prose on the page cites `Q-3`, the renderer
links it to the entry and adds the label the first time it appears in that
field: *Q-3 (resuming a handed-back import)*. The same goes for `blockedBy` in
outstanding work and for the waiting list.

- Write the bare id in the JSON and let the page add the label. If you write a
  label yourself, as `Q-3 (…)`, the page links the id and leaves your words alone.
- An entry with no `short` gets a label cut from its title, which reads worse.
  The validator warns about every cited entry that has none.
- An id inside `code` or a link is left as written.

**Not every fix needs an entry.** Something unambiguous, with no judgement in
it, goes in `mechanical` — handled without asking, listed so you know it was
done. An entry is for something that needed you.

## Grouping

**Group by root cause, not by finding.** Five review findings that share one
cause are one entry with five symptoms, not five entries. Say which findings
rolled into each group.

Separate the material by what it demands of the reader:

- **Decisions** — needs a ruling. These are the brief.
- **Mechanical** — an unambiguous fix with no judgement in it. **Fix these
  yourself first**, then list them as already done. Never ask about them.
- **Outstanding work** — known, agreed, not yet done. A separate list at the
  end, not mixed into the decisions.

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
- **Two or more things named in a row make a list.** Entries, reasons, files,
  steps, changes: end the lead-in with a colon and put each item on its own
  `- ` line (or `1. ` where the order matters). This applies to every prose
  field, including `context`, `subject`, the problem and explanation, the
  unwound text, option summaries and costs, decision and resolution notes, and
  the details of handled and outstanding work. The page renders those lines as
  real lists, and a paragraph can come before or after the list in the same
  field.

  ```json
  "brief": "The person is left with nothing to act on:\n- no button that resumes\n- no saved position\n- no message saying what to do"
  ```
- Problem first, background second. Never the reverse.
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
carries proof, an id is never reused, and outstanding work never waits on an
entry that does not exist.

It also warns, without refusing, about the writing rules above. It flags:

- prose that cites an id that is not on the page
- a cited entry with no `short` label
- a sentence that names three or more things in a row, or cites two or more entries, when it should be a list

Errors name the entry, the field, and what to do. Fix them all before rendering;
the renderer runs the same check and refuses anyway.

Add `--json` when another tool needs the result rather than a person.

`examples/example.brief.json` is a complete worked brief: three entries, both
diagram kinds, one closed as complete, plus the handled and outstanding lists.
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
2. **Hand the link back in chat.** The operator reads on mobile and cannot see
   tool output. A brief that was published but not linked was not delivered.
3. **Update in place.** When the brief already exists, republish to the same URL
   (`url:` parameter, or the same local file path within one session). Do not
   mint a second page for the same subject. If you do not have the URL, find it
   with `action: "list"` before publishing anything.
4. **Read comments before republishing** (`action: "comments"`), fold them in,
   then resolve the threads you actually addressed.

## Freshness — the failure that recurs most

Every republish is re-derived from the current state of the code, the branch and
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
option first and labelled `(Recommended)`. Only the page is dropped.

## Common mistakes

| Mistake | Fix |
|---|---|
| Entries are the review findings, one per finding | Group by root cause; symptoms live inside an entry |
| Asking about something you could just fix | Fix it, then list it as done |
| A problem with no recommendation | Always recommend one option and say why |
| Solutions with no cost attached | Price each one: work, risk, what it rules out |
| Identifiers standing in for meaning | Meaning first, identifier as the pointer |
| An entry with no `short` label | Give it one; the page shows it after every citation of the id |
| The summary written as one paragraph | Use `changes` and `background`; keep `context` short |
| "A, B, C and D" in a sentence | One `- ` line per item |
| Publishing a second page for the same subject | Republish to the same URL |
| Republishing without re-deriving the facts | Re-check every claim against the tree first |
| Publishing without sending the link | Put the URL in your chat reply |
| Hand-writing the page's HTML | Write the JSON; the renderer owns the layout |
| Renumbering entries on a refresh | Ids are permanent; closed entries stay, marked closed |
| Deleting an entry once it is done | Set `status: "complete"` with a `resolution`; it moves to Closed |
| Marking something `complete` when only the ruling was made | That is `decided`; `complete` means it was carried out |
| Using `"embed": "file"` without publishing the companion | Drop the setting — the drawing then travels inside the page |
| Flattening an archify picture to a still image | Embed the live page; flattening throws away what it is for |
| Setting a frame height by hand | Let the renderer read the drawing's proportions, or it gets cropped |

## Red flags — stop and rewrite

- A sentence you cannot parse without opening a spec file.
- The word `gate`, `wire`, `fence` or `edge` in the prose.
- An entry that ends without a recommended option.
- Prose carried over verbatim from the previous version of the page.
- "The operator will know what I mean." They will not.
- Reaching for the HTML instead of the JSON.

## What is in this skill

| Path | What it is |
|---|---|
| `schema/problem-brief.schema.json` | The data contract. Field descriptions say what belongs where. |
| `bin/render-brief.mjs` | JSON to page. Fixed layout, no dependencies, refuses malformed briefs. |
| `examples/example.brief.json` | A complete worked brief — start from this. |
| `examples/diagrams/*.lifecycle.json` | The archify picture source for the worked example. |
