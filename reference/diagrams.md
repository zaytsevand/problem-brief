# Diagrams

The choice is about who draws it, not about looks.

| Kind | Use for | How |
|---|---|---|
| `mermaid` | A shape stated in a few lines: a sequence, a branch, a divergence. | Diagram text in `source`; artefacts render mermaid natively. |
| `archify` | A real architecture, lifecycle, data-flow or workflow view. | Render with the `archify` skill, then embed the rendered page. |
| `svg` | A picture that already exists as a self-contained file, and only then. | Path in `file`; the renderer inlines it. |

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
