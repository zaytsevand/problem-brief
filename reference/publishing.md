# Publishing, comments, the chat summary, the question variant

## Publishing

1. Render from the JSON, then publish with the `Artifact` tool (load `artifact-design`
   first, as that tool requires). Pass every archify diagram in `files`.
2. **Hand the link back in chat** with the update summary. The operator reads on mobile and
   cannot see tool output; a brief published but not linked was not delivered.
3. **Update in place.** Republish to the same URL (`url:`, or the same local path within one
   session). No second page per subject. Without the URL, `action: "list"` first.
4. **Read comments before republishing** (`ArtifactComments`, `action: "read"`), fold them
   in, resolve only the threads you addressed.

## A comment is a ruling until proven otherwise

A comment sent to Claude is auto-answered before the session sees it; the wake-up names the
page and thread, not the comment. The automatic reply is not a record. Read the thread,
record what it rules in the JSON (entry `decision`, or a ruling with the thread as
`source`), republish, then resolve. A thread with nothing to record:

```bash
node ~/.claude/skills/problem-brief/bin/brief-comments.mjs --no-ruling <page link> <thread id> "<why>"
```

A comment about how to work in general → `feedback` memory; mark the thread `--no-ruling`
naming the memory.

## The chat summary

Computed, not written. With hooks installed, `brief-delta.mjs` runs on every publish and
hands you the summary: post it as it stands, plus the link and the JSON path. Without the
hook:

```bash
node ~/.claude/skills/problem-brief/bin/brief-delta.mjs previous.json brief.json
node ~/.claude/skills/problem-brief/bin/brief-delta.mjs previous-page.html brief.json
```

A hand-written one must match its shape:

- ≤400 words, bullets, state delta only: `Q-2: open → decided (name the fifth failure)`,
  `Q-6 raised: one plain line`, `R-4 recorded: one plain line`.
- No problem statements, evidence or options — the link carries those.
- Close with `Blocks the goal: …` and `Escalated, not blocking: …` (ids with short labels;
  `nothing` when so).
- First publish: counts per state plus those two lines. Nothing moved: one line, no republish.
- End with the JSON path.

## Freshness

Every republish is re-derived from the current code, branch and run — never from a snapshot,
an earlier draft or an hour-old subagent report. Re-check every factual claim (does the
path exist, is the count right). Stale text surviving a rebuild is this format's most
common correction.

## The question variant (`AskUserQuestion`)

It stops everything; use it only when the work cannot continue without the answer now,
never to deliver questions the page could hold. When the operator asks for it instead of a
page: same content rules (plain English, problem first, grouped by root cause, recommended
option first labelled `(Recommended)`), same state check and search first. Ask only
`blocks-goal` entries; list `escalated` ones in the message. Record each answer in the JSON
as it comes back, then the chat summary.
