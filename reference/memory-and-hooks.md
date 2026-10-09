# Memory, hooks, recovery and retiring

The brief is the one record of rulings on its subject; Claude
Code's memory only makes sure every session knows the brief exists. Nothing is copied
between them except rulings about how to work (below), because a copy drifts.

## Register the brief

On the first publish, and whenever the path, address or goal changes:

```bash
node ~/.claude/skills/problem-brief/bin/brief-memory.mjs brief.json --memory-dir <memory directory>
```

Writes one `project` memory file, `problem-brief-<name>.md` (where the JSON lives, where it
is published, the goal, "check it before asking anything"), and keeps its single line in
`MEMORY.md`. Re-running updates both. No memory directory → skip. After the first publish
store the page address in the brief's own `url`.

## Rulings about how to work

Most rulings stay in the brief. One about how Claude should work ("fix wording without
asking", "I read on my phone, keep it short") is also saved as a `feedback` memory with its
**Why:** and **How to apply:** lines; name the file in the ruling's `memory` field.

## Hooks

Installed from the skill's source repository (github.com/zaytsevand/problem-brief) with
`sh install.sh --hook` (`pwsh install.ps1 -Hook` on Windows); the install scripts live in
the repository, not in the installed skill directory. If `~/.claude/settings.json` does not mention
`brief-context.mjs`, tell the operator once; never add hooks unasked.

| Hook | Script | Does |
|---|---|---|
| SessionStart | `brief-context.mjs --hook` | Default-channel line; each registered brief's goal, active rulings, live entries, closed ids. At startup, resume, clear and after every summary. |
| PostToolUse `Artifact` | `brief-delta.mjs --hook` | After a brief is published: the computed chat summary of what moved. |
| UserPromptSubmit | `brief-comments.mjs` | A comment notification or a message citing a brief's ids gets the brief's path, the cited items' state, and "record the answer now". |
| PostToolUse `ArtifactComments` | `brief-comments.mjs` | Notes when a brief's comments were read. |
| PreToolUse `ArtifactComments` | `brief-comments.mjs` | Refuses to resolve a brief's thread until the brief was saved since it was read, or the thread is marked `--no-ruling`. |

Preview what a session will be shown: `node ~/.claude/skills/problem-brief/bin/brief-context.mjs brief.json`.

## Recovering a lost file

Never rebuild a brief from memory. Every rendered page embeds its data:

```bash
# Artifact tool, action "read", on the brief's URL saves the page; then
node ~/.claude/skills/problem-brief/bin/extract-brief.mjs page.html brief.json
```

A page older than embedded data: rebuild from the page text and record every ruling found.

## Retiring a brief

A registered brief is handed to every session at startup and after every summary. When
its work is finished, abandoned or it was a test:

```bash
node ~/.claude/skills/problem-brief/bin/brief-retire.mjs brief.json --memory-dir <memory directory>
```

Removes the pointer and `MEMORY.md` line, clears hook state, stamps `retired` in the JSON,
lists the pages it was published at. The JSON stays.

- **Offer it** when the SessionStart hook shows the brief as having nothing live. Retire
  unasked only a test brief or one the operator called finished.
- **Never delete the page unasked.** Deleting is permanent and breaks shared links. Ask,
  naming the page; delete with the `Artifact` `delete` action only on a yes.
- **Throwaway briefs**: set `"throwaway": true` on any brief made to try something out.
  When the test is over, offer the full cleanup (retire, delete pages on a yes, remove
  temporary hooks/files) at the next opportunity — no hook can do it at session end.
- **Nothing live left behind**: close, retract or move open/ruled entries before retiring.
- **Bring one back** by removing `retired` and registering again.
