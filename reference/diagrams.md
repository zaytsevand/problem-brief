# Diagrams

## When to draw

Every open or decided entry gets the judgement: a diagram in `unwound.diagrams`, or one
line in `unwound.noDiagram` saying why no picture helps ("a yes/no on a wording change;
no behaviour"). The page prints the line so the operator can overrule it; the validator
warns on an entry with neither. Cues that usually mean draw:

| The entry describes | Draw |
|---|---|
| Parties exchanging messages over time: calls, retries, deadlines, hand-offs | mermaid `sequenceDiagram` |
| A lifecycle: account, run or job states and what moves between them | mermaid `stateDiagram-v2` |
| An ordering or a branch | mermaid `flowchart` |
| Today versus proposed behaviour | one drawing of each, same kind |

## Which tool draws it

The choice is about who draws it, not about looks.

| Kind | Use for | How |
|---|---|---|
| `mermaid` | A shape stated in a few lines: a sequence, a branch, a divergence. | Diagram text in `source`; artefacts render mermaid natively. |
| `archify` | A real architecture, lifecycle, data-flow or workflow view. | Render with the `archify` skill, then embed the rendered page. |
| `svg` | A picture that already exists as a self-contained file, and only then. | Path in `file`; the renderer inlines it. |
| `image` | A screenshot: a mockup, a layout, wording shown in place. | PNG, JPEG or WebP path in `file`, plus `alt` and `caption`; the renderer embeds it. |

## Screenshots

Use a screenshot when the reader has to see something to answer: what a page looks like,
or what it says in place. The reader cannot open a mockup file, so a path to one, a link to
an HTML file or a line of its markup does not help them. Capture the picture and attach it.

```json
{ "kind": "image", "file": "shots/q2-wide.png", "fileDark": "shots/q2-wide-dark.png",
  "alt": "The settings page with the button reading Save changes.",
  "caption": "The new wording fits on one line at full width." }
```

- Put a screenshot of the evidence itself on the evidence item:
  `{"kind":"document","ref":"settings page","note":"…","image":{"file":"…","alt":"…"}}`.
  The note is its caption.
- Several pictures on one entry are shown as a row that wraps. A tap opens one at full
  size. For a layout question, attach a wide shot and a phone-width shot.
- `fileDark` is optional. When it is there, the page shows the picture that matches the
  reader's theme.
- `file` is relative to the brief's JSON. Keep the pictures in a folder beside it.
- One picture may be 1 MB at most; the validator refuses a larger one. Crop to the part
  that matters and keep the width at 1600 pixels or less. The renderer does not resize.
- An HTML mockup has to be opened and captured first. The Chrome browser tools can do
  this: open the file, set the window width, and save a screenshot.
- `extract-brief.mjs page.html brief.json` writes the pictures back next to the JSON.

If archify is not installed, say so rather than silently downgrading every picture to
mermaid — the reader will assume the simpler drawing was a choice. Install:
`git clone https://github.com/tt-a1i/archify ~/.claude/skills/archify`.

## Embedding an archify picture

Invoke the `archify` skill to render (it finds itself and iterates on layout), or:

```bash
node ~/.claude/skills/archify/bin/archify.mjs render lifecycle q3.lifecycle.json diagrams/q3.html
```

```json
{ "kind": "archify", "caption": "Where the run stops, and the step that does not exist yet.",
  "file": "diagrams/q3.html", "spec": "diagrams/q3.lifecycle.json", "archifyType": "lifecycle" }
```

- The drawing is carried inside the page by default (works everywhere). `"embed": "file"`
  references a companion instead — only where the publisher can carry companions; the
  renderer prints what to publish. A drawing that cannot be carried becomes a visible note.
- Render archify drawings in presentation mode, in their own frame, centred and scaled to the column.
- Never flatten to a still image; it throws away zoom, paths and lenses.
- Leave `height` alone; the renderer reads the drawing's `viewBox`. Keep `meta.viewBox`
  tight — shrink until archify complains, then back one step.
- Keep the `spec` path: the next refresh edits the picture instead of redrawing it from
  memory (which loses fallbacks and stores). One source per subject.
- Archify's validator is strict about crossings and label collisions. Adjust `col`,
  `yOffset`, `channelY`, `fromSide`/`toSide` or drop a label; never lower the quality profile.
