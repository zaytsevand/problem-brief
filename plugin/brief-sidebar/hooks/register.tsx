import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { BriefView, Entry, Evidence, Group, Option } from '../types'

const PANE = 'brief-sidebar'
const TITLE = 'Open questions'
// openBrief holds a slug, '' for "the first of this session's", or NONE once the person folded everything.
const NONE = '-'

const briefs = atom({ plugin: 'brief-sidebar', key: 'briefs' } as const, [])
const sessionSlug = atom({ plugin: 'brief-sidebar', key: 'sessionSlug' } as const, '')
const inPlay = atom({ plugin: 'brief-sidebar', key: 'inPlay' } as const, [])
const openBrief = atom({ plugin: 'brief-sidebar', key: 'openBrief' } as const, '')
const folded = atom({ plugin: 'brief-sidebar', key: 'folded' } as const, [])
const sent = atom({ plugin: 'brief-sidebar', key: 'sent' } as const, {})
const upkeep = atom(
  { plugin: 'brief-sidebar', key: 'upkeep' } as const,
  { turnsWithWork: 0, lastWriteAt: null },
)

// A bare file name counts too: a command run from inside the briefs folder names only the file.
const BRIEF_PATH = /([A-Za-z0-9._-]+)\.brief\.json/g
const WRITES_FILE = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const SHELL_WRITE = /(^|[^>])>[^>&]|\bmv\b|\bsponge\b|\btee\b|\bnode\b|\bpython3?\b/
const SHELL_WORK = /\bgit (commit|push|merge)\b|\bgh pr (create|merge|edit)\b/

// The published page's order of attention and its own words for each group.
const GROUPS: { key: Group; heading: string }[] = [
  { key: 'blocks', heading: 'Blocks the goal' },
  { key: 'awaiting', heading: 'Awaiting your ruling' },
  { key: 'escalated', heading: 'Escalated, not blocking' },
]

type Raw = Record<string, unknown>

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
}

function list(v: unknown): Raw[] {
  return Array.isArray(v) ? (v as Raw[]) : []
}

function obj(v: unknown): Raw {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {}
}

// Same rule as the page: never a bare id, so cut the title at a word boundary when there is no short label.
function labelOf(raw: Raw): string {
  const short = str(raw.short)
  if (short) return short
  const title = str(raw.title) ?? '(untitled)'
  if (title.length <= 40) return title
  const cut = title.slice(0, 40)

  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 20))}…`
}

function groupOf(raw: Raw): Group {
  if (raw.bearing === 'blocks-goal') return 'blocks'
  if (raw.bearing === 'escalated') return 'escalated'

  return 'awaiting'
}

function toOption(s: Raw): Option {
  const cost = obj(s.cost)

  return {
    label: str(s.label) ?? '',
    recommended: s.recommended === true,
    irreversible: s.reversible === false,
    summary: str(s.summary),
    work: str(cost.work),
    risk: str(cost.risk),
    forecloses: str(cost.forecloses),
  }
}

function toEntry(raw: Raw, unblocks: number, isNew: boolean): Entry {
  const unwound = obj(raw.unwound)
  const evidence: Evidence[] = list(raw.evidence)
    .map(ev => ({ ref: str(ev.ref) ?? '', note: str(ev.note) }))
    .filter(ev => ev.ref !== '')

  return {
    id: str(raw.id) ?? '?',
    title: str(raw.title) ?? '(untitled)',
    label: labelOf(raw),
    group: groupOf(raw),
    problem: str(raw.problem),
    brief: str(raw.brief),
    reason: str(raw.bearingReason),
    evidence,
    now: str(unwound.now),
    whyWrong: str(unwound.whyWrong),
    target: str(unwound.target),
    options: list(raw.solutions)
      .map(toOption)
      .filter(o => o.label !== '')
      .sort((a, b) => Number(b.recommended) - Number(a.recommended)),
    unblocks,
    isNew,
  }
}

function toBrief(slug: string, path: string, raw: Raw): BriefView {
  const entries = list(raw.decisions)
  const waiting = list(raw.outstanding).filter(o => o.state !== 'done')
  const raised = new Set(list(raw.changes).filter(c => c.kind === 'raised').map(c => str(c.id)))
  const open = entries
    .filter(d => d.status === 'open')
    .map(d => {
      const id = str(d.id)
      return toEntry(d, waiting.filter(o => o.blockedBy === id).length, raised.has(id))
    })
    // The ruling that frees the most other work goes first, as on the page.
    .sort((a, b) => b.unblocks - a.unblocks)

  return {
    slug,
    path,
    title: str(raw.title) ?? slug,
    url: str(raw.url),
    goal: str(raw.goal),
    updated: str(raw.updated),
    open,
    decided: entries.filter(d => d.status === 'decided').length,
  }
}

function slugsIn(text: string): string[] {
  return [...text.matchAll(BRIEF_PATH)].map(m => m[1] ?? '').filter(Boolean)
}

function countsLine(b: BriefView): string {
  const n = (g: Group) => b.open.filter(q => q.group === g).length
  const parts = [
    n('blocks') && `${n('blocks')} blocking`,
    n('awaiting') && `${n('awaiting')} awaiting`,
    n('escalated') && `${n('escalated')} escalated`,
  ].filter(Boolean)

  return parts.join(', ') || 'nothing waiting on you'
}

function commentPrompt(brief: BriefView, q: Entry, text: string): string {
  return [
    `Comment on ${q.id} ("${q.title}") in the problem brief "${brief.title}":`,
    '',
    text,
    '',
    `Record this in ${brief.path} this turn (on ${q.id}: decision, status or a ruling,`,
    'as the problem-brief skill says), act on it, and republish the brief page.',
  ].join('\n')
}

function rulingPrompt(brief: BriefView, q: Entry, o: Option): string {
  return [
    `Ruling on ${q.id} ("${q.title}") in the problem brief "${brief.title}": take "${o.label}".`,
    '',
    `Record it in ${brief.path} this turn: the decision on ${q.id}, status decided,`,
    'then carry it out as the problem-brief skill says and republish the brief page.',
  ].join('\n')
}

let dir = ''
// The folder's names, sizes and times when last read: a change in any of them means a brief moved.
let seen = ''

function signature(listing: readonly { name: string; size: number; mtimeMs: number }[]): string {
  return listing.map(f => `${f.name}:${f.size}:${f.mtimeMs}`).sort().join('|')
}

// Cheap enough to run every few seconds: one listing, and a full read only when something changed.
async function refreshIfChanged($: EngineInterface): Promise<void> {
  if (!dir) return reload($)
  const listing = await $.fs.list(dir).catch(() => [])
  if (signature(listing) !== seen) await reload($)
}

async function reload($: EngineInterface): Promise<void> {
  if (!dir) {
    dir = `${(await $.env.get('HOME')) ?? ''}/.claude/problem-brief/briefs`
  }
  const listing = await $.fs.list(dir).catch(() => [])
  seen = signature(listing)
  const loaded: BriefView[] = []
  for (const f of listing) {
    if (f.kind !== 'file' || !f.name.endsWith('.brief.json')) continue
    const slug = f.name.slice(0, -'.brief.json'.length)
    const path = `${dir}/${f.name}`
    try {
      loaded.push(toBrief(slug, path, JSON.parse(await $.fs.read(path)) as Raw))
    } catch {
      // A brief mid-write or malformed: skip it until the next refresh.
    }
  }
  loaded.sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? ''))
  await update($, briefs, () => loaded)
  await refreshStatus($)
}

// This session's briefs: the one named after the session, then those it wrote or answered.
async function ownSlugs($: EngineInterface): Promise<string[]> {
  const own = await read($, sessionSlug)
  const rest = await read($, inPlay)

  return [...new Set([own, ...rest].filter(Boolean))]
}

async function refreshStatus($: EngineInterface): Promise<void> {
  const mine = await ownSlugs($)
  const ours = (await read($, briefs)).filter(b => mine.includes(b.slug))
  if (ours.length === 0) {
    $.ui.status(undefined)
    return
  }
  const blocking = ours.reduce((n, b) => n + b.open.filter(q => q.group === 'blocks').length, 0)
  const open = ours.reduce((n, b) => n + b.open.length, 0)
  const { turnsWithWork } = await read($, upkeep)
  const head = blocking > 0 ? `brief: ${blocking} blocking, ${open} open` : `brief: ${open} open`
  const stale = turnsWithWork > 0 ? `, not updated for ${turnsWithWork} turn(s)` : ''
  $.ui.status(head + stale)
}

async function upkeepNote($: EngineInterface): Promise<string | null> {
  const mine = await ownSlugs($)
  const ours = (await read($, briefs)).filter(b => mine.includes(b.slug))
  if (ours.length === 0) return null

  const { turnsWithWork } = await read($, upkeep)
  const lines = [
    'Problem-brief upkeep (brief-sidebar mod). Briefs in play this session:',
    ...ours.map(b => {
      const open = b.open.map(q => `${q.id} (${q.label})`).join(', ') || 'none'
      return `- ${b.title}: ${b.path}; open: ${open}`
    }),
    'If this message answers, rules on or comments on any entry, record it in that brief this turn,',
    'and record any new finding, decision or question there rather than only in chat.',
  ]
  if (turnsWithWork > 0) {
    lines.push(
      `The last ${turnsWithWork} turn(s) changed code or git state without touching a brief:`,
      'check whether an entry moved (decided to complete, new finding) and update the brief.',
    )
  }

  return lines.join('\n')
}

export const register: Register = on => {
  let wroteBrief = false
  let didWork = false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'brief-sidebar',
      description: 'Show the problem briefs\' open questions in a sidebar',
    })
    const id = await $.session.id().catch(() => '')
    await update($, sessionSlug, () => (id ? `session-${id.slice(0, 8)}` : ''))
    await reload($)
    $.clock.every(3_000, () => void refreshIfChanged($).catch(() => undefined))
    void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  on('command.run', { command: 'brief-sidebar' }, async $ => {
    await reload($)
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Open-questions sidebar opened.' }
  })

  on('tool.call', async ($, e, next) => {
    const touched = slugsIn(JSON.stringify(e))
    const isShell = e.tool === 'Bash'
    const command = isShell ? String((e as unknown as Raw).command ?? '') : ''

    try {
      const writes = WRITES_FILE.has(e.tool) || (isShell && SHELL_WRITE.test(command))
      // Only a write makes a brief this session's: reading one to look at it does not.
      if (touched.length > 0 && writes) {
        await update($, inPlay, l => [...new Set([...l, ...touched])])
        wroteBrief = true
      } else if (touched.length === 0 && (WRITES_FILE.has(e.tool) || (isShell && SHELL_WORK.test(command)))) {
        didWork = true
      }
    } catch {
      // Bookkeeping only: never let it stand in the tool call's way.
    }

    const result = await next(e)
    if (touched.length > 0) await reload($).catch(() => undefined)

    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (wroteBrief) {
      const now = await $.clock.now()
      await update($, upkeep, () => ({ turnsWithWork: 0, lastWriteAt: now }))
    } else if (didWork) {
      await update($, upkeep, u => ({ ...u, turnsWithWork: u.turnsWithWork + 1 }))
    }
    wroteBrief = false
    didWork = false
    await refreshStatus($)

    return next(e)
  })

  // The nudge: every prompt carries the briefs in play and, when work outran the brief, a reminder.
  on('prompt.submit', async ($, e, next) => {
    const lines = await upkeepNote($).catch(() => null)

    return lines ? next({ ...e, context: [...(e.context ?? []), lines] }) : next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Link, Markdown } = els
    // The mobile surface has no text field: questions show, replies go through the chat there.
    const Input = 'Input' in els ? els.Input : null

    const all = await read($, briefs)
    const own = await read($, sessionSlug)
    const mine = await ownSlugs($)
    const chosen = await read($, openBrief)
    const shut = await read($, folded)
    const notes = await read($, sent)

    const ours = all
      .filter(b => mine.includes(b.slug))
      .sort((a, b) => Number(b.slug === own) - Number(a.slug === own))
    const others = all
      .filter(b => !mine.includes(b.slug) && b.open.length > 0)
      .sort((a, b) => {
        const blocks = (x: BriefView) => x.open.filter(q => q.group === 'blocks').length
        return blocks(b) - blocks(a)
      })
    const quiet = all.filter(b => !mine.includes(b.slug) && b.open.length === 0).length
    const shown = [...ours, ...others]
    // One brief open at a time: the one pressed last, else the first of this session's.
    const current =
      chosen === NONE ? '' : shown.some(b => b.slug === chosen) ? chosen : (ours[0]?.slug ?? '')

    const toggleBrief = (slug: string) =>
      void update($, openBrief, () => (slug === current ? NONE : slug))
    const toggleQuestion = (k: string) =>
      void update($, folded, l => (l.includes(k) ? l.filter(x => x !== k) : [...l, k]))

    const send = (brief: BriefView, k: string, prompt: string, shownText: string) =>
      void (async () => {
        const at = await $.clock.now()
        await update($, sent, m => ({ ...m, [k]: [...(m[k] ?? []), { text: shownText, at }] }))
        await update($, inPlay, l => [...new Set([...l, brief.slug])])
        await $.prompt.submit({ text: prompt, asUser: true })
      })().catch(err => $.ui.toast(`Reply not sent: ${String(err)}`))

    // Laid out like the Claude app's own sidebar: grey section labels, a fixed icon column, and every
    // child aligned to its parent's text column, so each level of the brief sits one step further in.
    const ICON = 2

    const label = (text: string, key?: string) => (
      <Text key={key} dimColor>
        {text}
      </Text>
    )

    // A row with a glyph in the icon column; what follows the row hangs from the text column.
    const item = (key: string, icon: RenderChildren, head: RenderChildren, body?: RenderChildren) => (
      <Box key={key} flexDirection="column">
        <Box>
          <Box width={ICON} flexShrink={0}>
            {icon}
          </Box>
          <Box flexGrow={1}>{head}</Box>
        </Box>
        {body ? (
          <Box flexDirection="column" marginLeft={ICON}>
            {body}
          </Box>
        ) : null}
      </Box>
    )

    const section = (key: string, heading: string, body?: string) =>
      body ? (
        <Box key={key} flexDirection="column" marginTop={1}>
          {label(heading)}
          <Markdown text={body} />
        </Box>
      ) : null

    const option = (brief: BriefView, q: Entry, k: string, o: Option, i: number) =>
      item(
        `o:${k}:${i}`,
        <Text color={o.recommended ? 'cyan' : undefined} dimColor={!o.recommended}>
          {o.recommended ? '●' : '○'}
        </Text>,
        <Text bold>{o.label}</Text>,
        <Box flexDirection="column" marginBottom={1}>
          {o.recommended && <Text color="cyan">Recommended</Text>}
          {o.irreversible && <Text color="yellow">Cannot be undone</Text>}
          {o.summary && <Markdown text={o.summary} />}
          {o.work && <Text dimColor>Work: {o.work}</Text>}
          {o.risk && <Text dimColor>Risk: {o.risk}</Text>}
          {o.forecloses && <Text dimColor>Rules out: {o.forecloses}</Text>}
          <Box marginTop={1}>
            <Button
              key={`r:${k}:${i}`}
              label="Take this option"
              variant={o.recommended ? 'primary' : 'secondary'}
              onPress={() => send(brief, k, rulingPrompt(brief, q, o), `Took "${o.label}"`)}
            />
          </Box>
        </Box>,
      )

    const question = (brief: BriefView, q: Entry) => {
      const k = `${brief.slug}#${q.id}`
      const isOpen = !shut.includes(k)
      const thread = notes[k] ?? []
      const last = thread[thread.length - 1]
      // A brief cached by an older load of the mod may lack these lists until the next reload.
      const evidence = q.evidence ?? []
      const options = q.options ?? []
      const isBlocking = q.group === 'blocks'

      const head = (
        <Box>
          <Button
            key={`x:${k}`}
            plain
            label={`${q.id}  ${isOpen ? q.title : q.label}`}
            onPress={() => toggleQuestion(k)}
          />
          {q.isNew && <Text color="cyan"> new</Text>}
          {q.unblocks > 0 && <Text dimColor> unblocks {q.unblocks}</Text>}
        </Box>
      )
      const body = (
        <Box flexDirection="column">
          {isOpen && q.reason && (
            <Text dimColor italic>
              {q.reason}
            </Text>
          )}
          {isOpen && section(`p:${k}`, 'The problem', q.problem)}
          {isOpen && section(`b:${k}`, 'Why it matters', q.brief)}
          {isOpen && section(`n:${k}`, 'How it works today', q.now)}
          {isOpen && section(`w:${k}`, 'Why that is wrong', q.whyWrong)}
          {isOpen && section(`t:${k}`, 'Where it should end up', q.target)}
          {isOpen && evidence.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              {label('Evidence')}
              {evidence.map((ev, i) =>
                item(
                  `e:${k}:${i}`,
                  <Text dimColor>•</Text>,
                  ev.note ? <Text>{ev.note}</Text> : <Text dimColor>{ev.ref}</Text>,
                  ev.note ? <Text dimColor>{ev.ref}</Text> : undefined,
                ),
              )}
            </Box>
          )}
          {isOpen && options.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              {label('Options')}
              {options.map((o, i) => option(brief, q, k, o, i))}
            </Box>
          )}
          {last && (
            <Text dimColor italic wrap="truncate-end">
              You said: {last.text}
              {thread.length > 1 ? ` (and ${thread.length - 1} earlier)` : ''}
            </Text>
          )}
          {Input && (
            <Box width="100%" borderStyle="round" borderDimColor paddingX={1}>
              <Input
                key={`c:${k}:${thread.length}`}
                placeholder={`Reply on ${q.id}`}
                submitLabel="send"
                onSubmit={(text: string) => {
                  const reply = text.trim()
                  if (reply) send(brief, k, commentPrompt(brief, q, reply), reply)
                }}
              />
            </Box>
          )}
        </Box>
      )

      return (
        <Box key={`q:${k}`} flexDirection="column" marginTop={1}>
          {item(
            `qi:${k}`,
            <Text color={isBlocking ? 'red' : undefined} dimColor={!isBlocking}>
              {isBlocking ? '●' : '○'}
            </Text>,
            head,
            body,
          )}
        </Box>
      )
    }

    const briefBody = (b: BriefView) => (
      <Box flexDirection="column">
        {b.goal && <Text dimColor>Goal: {b.goal}</Text>}
        {b.url && <Link href={b.url} label="Open the brief's page" />}
        {GROUPS.map(g => {
          const qs = b.open.filter(q => q.group === g.key)
          if (qs.length === 0) return null
          return (
            <Box key={`g:${b.slug}:${g.key}`} flexDirection="column" marginTop={1}>
              {label(`${g.heading}  ${qs.length}`)}
              {qs.map(q => question(b, q))}
            </Box>
          )
        })}
        {b.decided > 0 && (
          <Box marginTop={1}>
            <Text dimColor>{b.decided} ruled, being carried out</Text>
          </Box>
        )}
      </Box>
    )

    const briefRow = (b: BriefView) => {
      const isOpen = b.slug === current
      const blocks = b.open.some(q => q.group === 'blocks')
      return (
        <Box key={`b:${b.slug}`} flexDirection="column" marginTop={isOpen ? 1 : 0}>
          {item(
            `bi:${b.slug}`,
            <Text dimColor>{isOpen ? '⌄' : '›'}</Text>,
            <Box justifyContent="space-between">
              <Button key={`f:${b.slug}`} plain label={b.title} onPress={() => toggleBrief(b.slug)} />
              {!isOpen && (
                <Text color={blocks ? 'red' : undefined} dimColor={!blocks}>
                  {countsLine(b)}
                </Text>
              )}
            </Box>,
            isOpen ? briefBody(b) : undefined,
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" paddingX={1} gap={1}>
        <Box flexDirection="column">
          {label('This session')}
          {ours.length === 0 && (
            <Text dimColor>No brief yet. One appears once the session writes a brief or you reply in one.</Text>
          )}
          {ours.map(briefRow)}
        </Box>
        {others.length > 0 && (
          <Box flexDirection="column">
            {label("Other sessions' briefs")}
            {others.map(briefRow)}
            {quiet > 0 && <Text dimColor>{quiet} more with nothing waiting on you</Text>}
          </Box>
        )}
      </Box>
    )
  })
}
