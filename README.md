# problem-brief

A Claude Code skill for turning review findings into a page someone can make
decisions from.

Reviews produce lists. Lists are not decisions. This skill takes whatever came
out of a review — a multi-reviewer round, a static analysis pass, a benchmark
run — groups it by root cause, and renders a page where each entry states one
problem, proves it, and ends with a recommended way out and what that way costs.

The layout is fixed by a renderer rather than written by hand, so the reader
learns it once and never re-learns it.

## What an entry looks like

Five parts, always in this order:

1. **The problem** — one or two plain sentences naming what is wrong.
2. **Why it matters** — in the reader's terms, not the codebase's.
3. **Evidence** — one to four citations, each with a note saying what it shows.
4. **How it works today** — with a drawing where a drawing helps, and why that
   is wrong. Or the target state, where there is no defect.
5. **Options** — the recommendation first and labelled, each priced by work,
   risk, and what it rules out.

You write the content as JSON. The renderer produces the page. It refuses to
render an entry with no recommended option, a citation with no note, or an
option with no cost — the mistakes that make a brief unusable.

## Install

**macOS and Linux**

```sh
git clone https://github.com/zaytsevand/problem-brief
cd problem-brief
./install.sh              # or ./install.sh --link to track the repo
```

**Windows**

```powershell
git clone https://github.com/zaytsevand/problem-brief
cd problem-brief
.\install.ps1             # or .\install.ps1 -Link
```

Both install into your skills directory (`~/.claude/skills` on macOS and Linux,
`%USERPROFILE%\.claude\skills` on Windows), report whether the two skills this
one composes are present, and take `--uninstall` / `-Uninstall` to reverse.
Needs Node 18 or newer for the renderer; nothing else, and no npm install.

## Dependencies

| Skill | Does what here | Without it |
|---|---|---|
| [archify](https://github.com/tt-a1i/archify) | Draws the architecture, lifecycle, data-flow and sequence pictures. | You are left with mermaid — fine for a branch, poor for a real system view. |
| [humanizer](https://github.com/blader/humanizer) | Strips the tells of machine-written prose before publishing. | The brief reads as generated, which is what makes a reader stop trusting it. |

The install scripts check for both and print how to get them.

## Use it

Ask Claude Code for a brief and the skill picks itself up:

> group the review findings by root cause and build me a brief

Validate first — always, and especially when the JSON was generated:

```sh
node ~/.claude/skills/problem-brief/bin/validate-brief.mjs my-brief.json
```

It checks the file against the schema and against the rules a schema cannot
state, and reports an unknown field as the field you probably meant:

```
decisions[0] → solutions[0] has an unknown field "recommend"
    → did you mean "recommended"? Anything unknown is silently dropped when the page is built.
```

That matters because a misspelt field is not a crash. It is content quietly
missing from a page that still looks finished.

Then render:

```sh
node ~/.claude/skills/problem-brief/bin/render-brief.mjs my-brief.json out/index.html
```

`examples/example.brief.json` is a complete worked brief — three entries, both
kinds of drawing, one already closed, plus the handled and outstanding lists.
Start from it rather than from an empty file.

## The top of the page

The summary under the counts is structure, not a paragraph:

- **Since the last version**, from typed `changes`, with new entries first.
- **Waiting on you** is worked out from the entries, so it cannot disagree with the counts.
- `context` is short free text.
- `background` is folded away.

Wherever prose cites an entry, the page links the id and adds the entry's
`short` label: *Q-3 (resuming a handed-back import)*. An entry with no label
gets one cut from its title. Lines starting `- ` or `1. ` in any prose field
render as real lists, and the validator warns when a sentence enumerates
things that should have been one.

## An entry's life

An entry is never deleted and never renumbered, because its number is how people
cite it. It moves through four states instead:

| State | Page shows | Means |
|---|---|---|
| `open` | blocks the goal / escalated, not blocking | Waiting on a ruling. |
| `decided` | outstanding work | A way forward was chosen; it has not been carried out. |
| `complete` | complete | The chosen option was carried out. Closed, with proof. |
| `superseded` | retracted | The problem went away or was overtaken. |

A brief names its `goal`, and every entry still waiting on a ruling or on work
says how it bears on that goal: it **blocks the goal**, or it is **escalated,
not blocking** — a real decision for the reader that can wait.

Every run starts by bringing those states up to date, before any facts are
re-checked. The brief and every item on it carry `created` and `updated`
timestamps, and the page shows both, so the reader can see what moved. The
validator rejects a status that contradicts the entry's own record (a ruling
on an entry still marked open, work marked blocked on something already ruled)
and timestamps that contradict each other. Each run ends with a short chat
summary of what changed state.

The brief is also the session's memory. Every answer or judgement the operator
gives is written into it straight away, on the entry it settles or as a
standing ruling (`R-1`, `R-2`, …) when it reaches further. Nothing is raised
before it has been checked against every entry and every ruling, and the
validator warns when an entry looks like an earlier one or like a question
already answered. Each rendered page carries its own data, so a session that
has lost the JSON recovers it with `bin/extract-brief.mjs` instead of
rebuilding it from memory.

It plugs into Claude Code's own memory. `bin/brief-memory.mjs` registers a
brief as one pointer file in the project's memory directory, listed in
`MEMORY.md`, so every session knows the brief exists. The optional
SessionStart hook (`./install.sh --hook`, or `.\install.ps1 -Hook`) follows
those pointers at startup, resume, clear and after every summary, and puts the
standing rulings and live entries back in context. That is the moment answers
used to be lost.

The counts along the top of the page are filters — click one and the page shows
that category alone. It opens on what blocks the goal, since that is what is
waiting on the reader. Above the entries, a short summary lists what waits on
the reader, then what changed since the last version, with earlier history
folded away. Every earlier version's change notes are kept too, behind a
*latest / all versions* switch. Everything stays in the document, so a link to
an entry reaches it whatever the filter was, and a page without scripting shows
the whole brief.

## Drawings

Three kinds:

- **mermaid** — inline, rendered natively by the page. For a shape you can state
  in a few lines.
- **archify** — the rendered archify page, embedded live in its own frame. Keeps
  its zoom, guided views and detail-on-hover. The frame takes the drawing's own
  proportions so nothing is cropped. The whole drawing travels **inside** the
  page by default, so the page stands alone and nothing has to be published
  beside it; `"embed": "file"` references it as a companion instead, for briefs
  large enough that page size matters. A drawing that cannot be carried becomes
  a visible note naming its source, never an empty frame.
- **svg** — a self-contained file, inlined, centred and scaled.

Keep the archify source file. The next refresh edits the drawing rather than
redrawing it, which is what loses the fallbacks and the error paths.

## Licence

MIT. See [LICENSE](LICENSE).
