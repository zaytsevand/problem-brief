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
  version: "1.2"
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

**By default, without being asked.** Whenever the work turns up something the
operator has to rule on (a finding with more than one way out, an open
decision, a question), it goes into a brief: into the existing one for that
subject, or a new one. The brief is the primary channel for those; chat carries
the short summary of what moved and the link. Waiting to be asked is how the
habit fades: an instruction given once in chat drops out of attention in a long
session and is gone after a summary. The SessionStart hook repeats this at
every start and after every summary.

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

**Do not use** for a progress update or a completion report with nothing in it
to decide. Those go in chat.

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
folding in comments. **Load the brief's JSON first, never rebuild it from
memory.** If the file is not at hand, recover it from the published page (see
**Remember what was already answered**). Then walk the whole file, item by item,
nothing skipped:

| Item | Ask | Where to look |
|---|---|---|
| `open` entry | Has it been ruled on since — in chat, in a comment, in a commit message? | This conversation, `action: "comments"`, the branch log |
| `decided` entry | Has the chosen option been carried out? | Commits, merged pull requests, the tests, the tree itself |
| `complete` entry | Does the proof still stand — is the commit on the branch, does the test still exist? | The tree |
| any entry | Has the problem gone away or been overtaken? Then it is `superseded` (shown as *retracted*). | The tree, later rulings |
| `open` or `decided` entry | Does its `bearing` still hold against the goal? Re-judge every one whenever the goal changes. | The goal as the operator last stated it |
| `outstanding` item | Is it done? Is the entry it waited on still awaiting a ruling? | The tree; the entry's own status |
| `mechanical` item | Is the fix still in place? | The tree |
| standing ruling | Does it still hold, or did the operator later say otherwise? Then mark it `replaced` and record the new one. | This conversation, comments |
| this conversation | Did the operator answer, rule or judge anything that is not yet in the file? Record it now. | This conversation, every turn since the last run, not only the last one |
| earlier sessions | Was anything on this subject answered in a session the brief never heard about? | `memory-recall` (memsearch), where installed; the session's summary |

For each item that moves, record why (`decision`, `resolution`, the new
`state`) and move its `updated` stamp. Only then go on to the facts
(**Freshness**), the comments, and any new entries.

**Then move the current `changes` into `history`, before writing a single new
change note.** Add one block, `{ "version": <the brief's updated stamp before
this refresh>, "changes": <the changes array exactly as it stood> }`, and start
`changes` empty for this version. Never overwrite or trim the old notes: they
are the only record of *which* refresh an entry moved on, and an entry's
`resolution` never says that. Skip the move only when the old `changes` is
empty.

The validator catches a state that contradicts its own record: a ruling on an
entry still marked open, a resolution on one still marked decided, work marked
blocked on an entry that has been ruled, a ruling dated after the entry says it
last changed. It **cannot** see a ruling that lives only in chat or a commit
that was never recorded. That is what the walk above is for.

## Remember what was already answered

In a long session the conversation gets summarised, and answers given in it
drop out of view. The same problem then comes back under a new number, a
question already settled is asked again, and a judgement the operator gave
three hours ago is ignored. To the operator this is the worst failure the brief
can have: it tells them that what they said was not heard.

**The JSON is the memory, not the conversation.** Three rules follow from that.

**1. Record an answer the moment it is given.** When the operator answers,
rules, or states a judgement, write it into the JSON before doing anything
else, in the same turn. Do not keep it in mind to fold in at the next refresh;
by then the turn that held it may have been summarised away.

- An answer to an entry goes on that entry: `decision`, the new `status`, its
  `updated` stamp.
- Anything that outlives one entry goes in `rulings`: a preference ("don't ask
  me about wording, just fix it"), a scope cut, a "we do not care about X",
  an answer to a side question asked in passing. `about` is the question as it
  would be asked again, which is what a later check matches against. `said` is
  the answer in the operator's own words.
- A ruling that stops holding is never edited or deleted. Record the new one
  and mark the old one `replaced`, with `replacedBy` naming the new one.

**2. Search before you raise.** Before adding any entry, or asking anything in
`AskUserQuestion`, look for it among every entry, in every state, and every
active ruling. Where the `memory-recall` skill (memsearch) is installed, also
search it for the subject: it holds what was said in earlier sessions, including
answers that never reached the brief. Anything it turns up that the brief lacks
becomes a ruling, with the session note as its `source`.

| What you find | What to do |
|---|---|
| A ruling that answers it | Do not raise it. Apply the ruling. If that leaves an unambiguous fix, make it and list it as `mechanical`. |
| An entry with the same root cause, any state | Do not raise a new one. Add the new symptom or evidence to that entry. |
| That entry is closed, and the new evidence really does contradict the ruling or the resolution | Reopen **the same entry**: set it back to `open`, say in the brief what is new since it was ruled, cite the ruling. Never a new number, never the same question with nothing new. |
| Nothing | Raise it with the next free number. |

The validator backs this up with warnings: an entry whose key words largely
match an earlier entry's, and an open entry that looks answered by an active
ruling. Word overlap proves nothing either way, so read both and decide. If a
ruling does not settle the entry, say why in the entry.

**3. Never lose the file.** A brief that spans sessions lives at a durable path
beside the work it concerns, not in a session scratchpad. Name the path in the
chat summary, so it survives when the conversation is summarised. Every
rendered page also carries its own data, so a lost file can be recovered from
the published page:

```bash
# Artifact tool, action: "read", on the brief's URL, saves the page locally; then
node ~/.claude/skills/problem-brief/bin/extract-brief.mjs page.html brief.json
```

Rebuilding a brief from memory is how rulings get lost, so never do it. If the
page predates embedded data, rebuild from the page's text, and record every
ruling you find there. After the first publish, store the page's address in the
brief's own `url`, so the next session finds the page without asking.

## Claude's own memory

The brief is the one record of rulings on its subject. Claude Code's memory
makes sure every session knows it exists and sees what it says. Nothing is
copied between the two except where noted, because a copy drifts.

**Register the brief** in the project's persistent memory directory, the one
your system prompt names. Do it on the first publish, and again whenever the
path, the address or the goal changes:

```bash
node ~/.claude/skills/problem-brief/bin/brief-memory.mjs brief.json --memory-dir <memory directory>
```

It writes one ordinary memory file, `problem-brief-<name>.md`, of type
`project`: where the JSON lives, where it is published, the goal, and the
instruction to check it before asking anything. It also keeps that file's line
in `MEMORY.md`, the index loaded into every session. Running it again updates
both; it never adds a second line. With no memory directory, skip this step.

**The hook puts the rulings back after a summary.** The index tells a session
that the brief exists, but not what it says. The SessionStart hook,
`brief-context.mjs --hook`, fires at startup, resume and clear, and straight
after the conversation is summarised. It follows the pointers and puts every
active ruling, every live entry and the ids of the closed ones back in context.
It also always carries one line, whether or not a brief exists yet: findings,
decisions and questions go into a brief by default.

`./install.sh --hook` (`.\install.ps1 -Hook` on Windows) installs it with the
others:

| Hook | Script | Does |
|---|---|---|
| SessionStart | `brief-context.mjs` | Default-channel line; each registered brief's goal, rulings, live and closed entries. At startup, resume, clear and after every summary. |
| PostToolUse `Artifact` | `brief-delta.mjs` | After each publish of a brief: the chat summary of what moved. Also notes which page belongs to which brief. |
| UserPromptSubmit | `brief-comments.mjs` | A comment notification for a brief's page, or a message citing its ids, gets the brief's path, the cited items' state, and the instruction to record the answer now. |
| PostToolUse `ArtifactComments` | `brief-comments.mjs` | Reading a brief's comments notes when they were read. |
| PreToolUse `ArtifactComments` | `brief-comments.mjs` | Refuses to resolve a brief's thread until the brief has been saved since it was read, or it is marked `--no-ruling`. |

If `~/.claude/settings.json` does not mention `brief-context.mjs`, tell the
operator once that the hooks are missing and what they do. Do not add them
yourself without being asked. To see what a session will be shown:

```bash
node ~/.claude/skills/problem-brief/bin/brief-context.mjs brief.json
```

**A ruling about how to work goes to memory as well.** Most rulings are about
the brief's subject and stay in the brief. Some are about how Claude should
work: "fix wording without asking", "never propose a new dependency", "I read on
my phone, keep it short". Those hold beyond this brief, so also save each as a
`feedback` memory, with its **Why:** and **How to apply:** lines, following your
memory instructions. Name the file in the ruling's `memory` field, so the two
can be found from each other. This is the one thing copied, because it has to
work where the brief is not loaded.

## The entry shape

Every entry, in this order. The order is the deliverable — do not reshuffle it.

| Part | What it is | Length |
|---|---|---|
| **a. Problem** | One or two plain sentences naming what is wrong. No preamble. | 1–2 sentences |
| **b. Brief explanation** | Why that matters, in the operator's terms. | 2–8 sentences |
| **c. Evidences** | Cite the verified evidences for the issue, grounded in real artefacts: code lines, documents, prior findings. | 1–4 items |
| **d. The unwound explanation** | How it actually works today, with a diagram where a diagram helps, and references — file paths with line numbers, commit SHAs, run IDs, spec paths. Then why that is wrong. Where there is no defect, state the target state instead. | as long as it needs |
| **e. Solutions** | At least one, better two or more. **The first is the recommendation** and is labelled as such. Each carries its cost — work, risk, what it forecloses — and says whether it can be undone. | 2+ options |

Number the entries so they can be cited back at you (`Q-1`, `Q-2`, `Q-3` — not
invented codes). An id is permanent: on a refresh, an entry keeps the number it
was given, a resolved one keeps its number and is marked ruled, and a new one
takes the next free number. Renumbering breaks every reference the operator has
already made.

**Bound to the project's own tracker.** When the work runs under an item in
the project's tracking tool (a task or ticket, a specification, an
architecture decision record), set `binding` to it: its `ref` as the project
writes it (`JOB-42`, `spec-017`, `ADR-0009`), what kind of thing it is, its
title and link. Take it from where the work is already bound: the branch name,
the specification being implemented, the task the operator named. Never invent
one. Every id is then shown and cited with the prefix, `JOB-42/Q-3` and
`JOB-42/R-2`, so ids stay unambiguous when a project has several briefs and can
be cited in the tracker, in commit messages and in decision records. The file
keeps the ids bare; only how they are shown and cited changes, so adding a
binding later renumbers nothing. Cite another brief's entry with its own
prefix; the page leaves it as written.

Where the project records its decisions in that tool (an ADR, a spec's
decision log), the brief does not replace it: once a ruling is made, record it
there as well and cite the tool's record as evidence in the entry's
`resolution`.

**Pricing an option.** `cost.work` says what doing it consists of: what gets
changed, how much of it, and what it needs from the operator (a review, a
decision, access, a migration window). It never says "two days". A calendar
estimate is a guess at the pace of hand-written code, and the work is done by
agents several times faster, so the figure misstates the cost. What the reader
actually pays is their attention and the risk. The validator warns on a work
estimate given in hours, days or weeks.

**Can it be undone?** Mark every option `reversible: true` or `false`. It is
`false` when carrying it out cannot be undone, or when undoing it costs far
more than doing it: data deleted or rewritten, a migration run on real data, a
message or release sent to people, a public interface published, money spent.
Say what it rules out in `cost.forecloses`. The page tags such an option
*Cannot be undone*, and the validator warns on a live entry that marks none of
its options either way.

This is what sets how far you may go alone. Something that can be undone may be
handled without asking. Something that cannot is always the operator's call,
however obvious the answer looks.

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
done. An entry is for something that needed you. A fix that cannot be undone
always needs the operator, however unambiguous it is; the validator refuses a
`mechanical` item marked `reversible: false`.

**One ruling can free others.** When an entry cannot be ruled until another is
(its options depend on how the other is settled), list that other in the
entry's `blockedBy`. The page then shows what each entry waits on and what
ruling it unblocks, and *Waiting on you* puts the ruling that frees the most
work first. The validator refuses a dependency on an unknown entry and a cycle,
and warns when a goal blocker waits on something only escalated, since that
stands in the goal's way too.

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
- **Mechanical** — an unambiguous fix with no judgement in it, that can be
  undone. **Fix these yourself first**, then list them as already done. Never
  ask about them.
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

The box runs in this order: what waits on the reader, then what moved, then the
rest. The reader who opens the brief to decide something meets the decisions
first; the reader catching up on history scrolls one section.

- **Waiting on you** — built by the renderer from the entries: what blocks the
  goal, then what is escalated. Do not write it by hand.
- `changes` — what moved since the last version, one item per change, each
  with its `kind`: `raised` (new entry or work), `changed` (moved state without
  closing, or a ruling changed), `completed` (carried out), `retracted` (went
  away or was overtaken), or `note` (about the brief as a whole). The page
  shows them under one heading, *Since the last version*, grouped — new, then
  changes, then closings, then notes — and marks each kind with its own icon.
  Write the kind; never order the list by hand.
- **New additions lead the change list**, whatever their weight: every
  `raised` change is grouped first under that one heading, split into what
  blocks the goal, then what is escalated, then other new work. The entry is
  taken from the change's `id`, or the first entry id in its text. A question
  the reader has not seen yet is never left at the bottom of the box.
- `history` — every earlier version's change notes, one block per version,
  stamped. The page shows the latest version's notes by default with a
  *latest / all versions* switch beside the heading; the newest earlier block
  opens first and older ones stay folded. With no scripting, everything shows.
- `context` — anything else the reader needs before entry one. Optional.
- `background` — earlier history, folded away. `source` goes with it, never on
  the stamp line.

Give every entry a `short` label of two to five words. Wherever an id stands
bare in text, the page shows it as `Q-29 (one-call page read)`, linked to the
entry; an id the prose already explains, in brackets after the meaning, is
linked without repeating the label. An entry with no `short` is still labelled,
with its title cut at a word boundary, which reads worse than a label you chose.
The validator warns on a cited id that is not on the page, on a cited entry
with no `short` (and suggests one), and on a `short` longer than five words.

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
  straight by its list. The validator warns when one sentence names three or
  more entries.
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
timestamp agrees with the others. Rulings are checked too: ids unique, a
replaced ruling names what replaced it, a ruling cited as evidence exists. It
warns when an entry reads like an earlier one, or like a question an active
ruling already answers.

Errors name the entry, the field, and what to do. Fix them all before rendering;
the renderer runs the same check and refuses anyway.

Add `--json` when another tool needs the result rather than a person.

`examples/example.brief.json` is a complete worked brief: three entries, both
diagram kinds, one closed as complete, plus the handled and outstanding lists,
all timestamped.
Start from it rather than from an empty file.

**Where the files go.** Put the brief JSON, the rendered page and the diagram
folder together in a working directory: the scratchpad only if the brief will
not outlive the session, otherwise beside the specification or the work it
concerns. Keep the JSON. The next refresh edits it; it does not start again.

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
4. **Read comments before republishing** (`ArtifactComments`, `action: "read"`),
   fold them in, then resolve the threads you actually addressed.
5. **A comment is a ruling until proven otherwise.** A comment sent to Claude
   is answered automatically, before the session sees it, and the session is
   then woken by a notification that names the page and the thread but not the
   comment. The automatic reply is not a record. Read the thread, record what
   it rules, answers or judges in the brief's JSON (a decision on the entry, or
   a standing ruling with the thread as its `source`), republish, and only then
   resolve. With the hooks installed, resolving a brief's thread is refused
   until the brief has been saved since the thread was read. A thread with
   nothing to record (a typo report, a question already answered in the
   reply) is let through by saying why:

   ```bash
   node ~/.claude/skills/problem-brief/bin/brief-comments.mjs --no-ruling <page link> <thread id> "<why>"
   ```

   Something said in a comment that is about how to work in general, not about
   the brief's subject, goes to memory as a `feedback` memory; mark the thread
   with `--no-ruling` and name the memory in the note.

## Report back in chat

Every run ends with a short summary in chat: after a publish, after a refresh,
after an `AskUserQuestion` round. It is the only part the operator is certain
to read, so it says what **moved**, not what the brief says.

**The summary is computed, not written.** A written one drifts back into
retelling the brief. With the hooks installed, every `Artifact` publish of a
brief runs `brief-delta.mjs` as a PostToolUse hook: it compares the page's own
data with what was published last time and hands you the summary. Post it as
it stands. Add only the page's link, the path of the brief's JSON, and a few
words where a line needs them. Without the hook, compute it yourself from the
previous version (the previous page, or the JSON in git):

```bash
node ~/.claude/skills/problem-brief/bin/brief-delta.mjs previous.json brief.json
node ~/.claude/skills/problem-brief/bin/brief-delta.mjs previous-page.html brief.json
```

What it produces, and what a hand-written one must match when neither is
possible:

- **Up to 400 words**, as a bulleted list of changes.
- **The state delta only.** An entry that changed state reads
  `Q-2: open → decided (name the fifth failure)`; a new entry reads
  `Q-6 raised: one plain line`; a ruling recorded reads `R-4 recorded: one
  plain line`; handled fixes and outstanding work the same way. Say what changed in content only where it changes the ruling being asked
  for.
- **Do not repeat the brief.** No problem statements, no evidence, no options.
  The link carries those.
- Close with two lines, ids with their short labels: `Blocks the goal: Q-4
  (…)` and `Escalated, not blocking: Q-6 (…)`. Say `Blocks the goal: nothing`
  when that is so; it is the most useful line in the summary.
- On a first publish there is no earlier state, so list the counts per state
  and those two lines.
- If nothing moved, say so in one line and do not republish.
- End with the path of the brief's JSON, so a summarised session can find it.

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

**`AskUserQuestion` stops everything.** The operator has to drop what they are
doing to answer it. Use it only when the work cannot go on without the answer
now, and never to deliver a set of questions the page could hold. A question
that can wait goes on the page, where the operator answers it in their own time.
Deciding is not a reason to ask: if the answer can be undone and the brief or
its rulings settle it, act and list it as handled.

When the operator asks for `AskUserQuestion` instead of a page, the content rules are
unchanged — plain English, problem first, grouped by root cause, recommended
option first and labelled `(Recommended)`. Only the page is dropped. The state
check still comes first, and every question is searched against the entries
and the rulings, so nothing already answered is asked again. Only
`blocks-goal` entries are asked; `escalated` ones are listed in the message, not
asked, so the operator can pull one forward if they choose. Record each answer
into the JSON as soon as it comes back, moving each entry's status and
`updated` stamp, and anything broader as a ruling. End with the chat summary.

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
| Overwriting `changes` on a refresh | Move the old `changes` into `history`, stamped with the previous `updated`, then write the new ones |
| Re-stamping every item on a refresh | Move `updated` only on the items that actually changed |
| Leaving finished outstanding work as `not-started` or `blocked` | Set `state: "done"`; it stays on the page |
| A chat summary that retells the brief | Bullets of what moved, ≤400 words, then the two lines: blocks the goal, escalated |
| Presenting an unrelated decision as a blocker | Bracket it `"bearing": "escalated"` with its reason; only what stands in the goal's way is `blocks-goal` |
| A headline summary written as one paragraph | `changes` as typed items; leave *waiting on you* to the renderer; history in `background` |
| A new question recorded only in "Waiting on you" | Add a `raised` change with its `id`, so it leads the change list |
| A change with no `kind` | Give it one, so it lands in its group with its icon; `note` only for the brief as a whole |
| Keeping `generated` beside `updated` | Delete it; a re-check moves `updated` |
| Holding an answer in mind to record "at the next refresh" | Write it into the JSON in the turn it was given |
| Raising a problem that is already an entry, or already ruled on | Search every entry and every active ruling first; add to the existing entry |
| Re-asking a closed question with nothing new | Only new evidence reopens an entry, and it reopens the same id |
| A general judgement kept only as an entry's `decision.note` | Record it as a ruling so it applies beyond that entry |
| Rebuilding a lost brief from memory | Recover it with `extract-brief.mjs` from the published page |
| A brief no session will ever find again | Register it with `brief-memory.mjs`; set `url` after the first publish |
| Copying a brief's rulings into memory files | Memory holds the pointer; the brief holds the rulings. Only rulings about how to work are also saved, as `feedback` |
| Asking something an earlier session already answered | Search `memory-recall` too, where it is installed, and record what it finds |
| "About two days" in `cost.work` | Say what the work consists of and what it needs from the operator; agents make calendar guesses wrong |
| An option with no word on whether it can be undone | Mark `reversible`; say what it rules out in `forecloses` |
| Handling something that cannot be undone without asking | Make it an entry; only what can be undone is handled without asking |
| Two entries where one cannot be ruled before the other, and nothing says so | `blockedBy` on the one that waits |
| Reaching for `AskUserQuestion` to collect rulings | The page holds questions; ask only when the work cannot go on without the answer now |
| Writing the chat summary by hand | Post the one the publish hook computes, or run `brief-delta.mjs` |
| Taking the automatic reply to a comment as the end of it | Read the thread, record the ruling in the JSON, republish, then resolve |
| Waiting to be asked before starting a brief | Findings, decisions and questions go into a brief by default |

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
- "I think they already answered this" — then find the answer and record it,
  do not ask.
- The operator saying "I already told you".

## What is in this skill

| Path | What it is |
|---|---|
| `schema/problem-brief.schema.json` | The data contract. Field descriptions say what belongs where. |
| `bin/render-brief.mjs` | JSON to page. Fixed layout, no dependencies, refuses malformed briefs. |
| `bin/validate-brief.mjs` | Schema check plus the rules a schema cannot state: recommendations, proof, states, timestamps, rulings, repeated questions. |
| `bin/extract-brief.mjs` | Recovers the brief's JSON from a rendered or published page. |
| `bin/brief-memory.mjs` | Registers a brief in Claude Code's memory: one pointer file and its `MEMORY.md` line. |
| `bin/brief-context.mjs` | Prints what a session must not lose; with `--hook`, the SessionStart hook that restores it after a summary. |
| `bin/brief-delta.mjs` | The chat summary of what moved between two versions; with `--hook`, the PostToolUse hook that computes it on every publish. |
| `bin/brief-comments.mjs` | The comment and citation hooks; `--no-ruling` marks a thread as holding nothing to record. |
| `bin/install-hook.mjs` | Adds or removes all the hooks in `settings.json`; used by the installers. |
| `examples/example.brief.json` | A complete worked brief — start from this. |
| `examples/diagrams/*.lifecycle.json` | The archify picture source for the worked example. |
| `test/brief.test.mjs` | The validator and renderer behaviour, pinned. Run `node --test test/*.test.mjs`. |
