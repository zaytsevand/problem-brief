import type { FsEntry, On, RenderPropsOf } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const DIR = '/home/x/.claude/problem-brief/briefs'
const PATH = `${DIR}/demo.brief.json`
const FILES: Record<string, unknown> = {
  [PATH]: {
    title: 'Demo brief',
    goal: 'The index catches up with every merge.',
    decisions: [
      {
        id: 'Q-1', title: 'Should the job retry when it is killed?', short: 'job retry',
        status: 'open', bearing: 'blocks-goal', bearingReason: 'Runs keep dying.',
        problem: 'The job is killed for lack of memory.',
        evidence: [{ kind: 'run', ref: 'runner journal 17:48', note: 'OOM kill' }],
        unwound: { now: 'Every push starts the job.', whyWrong: 'Nothing retries it.' },
        solutions: [
          { label: 'Drop the job', recommended: false, reversible: false },
          { label: 'Retry once after a pause', recommended: true, reversible: true,
            summary: 'Re-launch once.', cost: { work: 'One workflow', risk: 'Masks a real fault', forecloses: 'Nothing' } },
        ],
      },
      { id: 'Q-2', title: 'Already ruled', status: 'decided' },
    ],
    changes: [{ kind: 'raised', id: 'Q-1', text: 'new' }],
  },
  [`${DIR}/other.brief.json`]: {
    title: 'Other brief',
    decisions: [{ id: 'Q-9', title: 'A question elsewhere', short: 'elsewhere', status: 'open' }],
  },
}

const PANE = {
  plugin: 'brief-sidebar',
  component: 'Pane',
  requestId: 'brief-sidebar',
  props: { title: 'Open questions', isFocused: true, bodyColumns: 60, placement: 'dock' } as unknown as RenderPropsOf['Pane'],
} as const

function seedDisk(on: On) {
  mock.env(on, { HOME: '/home/x' })
  mock.clock(on)
  on('fs.list', async (_$, e) => ({
    value: e.path === DIR
      ? Object.keys(FILES).map(p => ({ name: p.slice(DIR.length + 1), kind: 'file', size: 1, mtimeMs: 0 }) as FsEntry)
      : [],
  }))
  on('fs.read', async (_$, e) => ({ value: JSON.stringify(FILES[e.path]) }))
  on('ui.status', async () => ({ value: undefined }))
  on('tool.call', async () => ({ deny: 'stub' }))
}

const USER = { wait: false, origin: { kind: 'user' } } as const

test('no nudge before a brief is in play; a nudge naming it, its path and labels after', async ($, on) => {
  seedDisk(on)
  const seen: string[] = []
  on('prompt.submit', async (_$, e) => {
    seen.push((e.context ?? []).join('\n'))
    return { text: e.text, context: e.context }
  })

  await $.prompt.submit({ text: 'hello', ...USER } as never)
  expect(seen[0]).toBe('')

  await $.tool.call({ tool: 'Edit', file_path: PATH, old_string: 'a', new_string: 'b' })
  await $.prompt.submit({ text: 'go on', ...USER } as never)
  expect(seen[1]).toContain(PATH)
  expect(seen[1]).toContain('Q-1 (job retry)')
})

test('the session brief is open on top, other briefs folded to a count', async ($, on) => {
  seedDisk(on)
  await $.tool.call({ tool: 'Edit', file_path: PATH, old_string: 'a', new_string: 'b' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Button', text: /Should the job retry/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Blocks the goal  1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'This session' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Already ruled/ })).toBeUndefined()
    expect(await ui.find({ type: 'Button', text: /elsewhere/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '1 awaiting' })).toBeDefined()

    await ui.press({ key: 'f:other' })
    expect(await ui.find({ type: 'Button', text: /elsewhere/ })).toBeDefined()
    await ui.press({ key: 'f:demo' })
    await ui.unmount()
  }
})

test('a reply and a ruling each go to the model naming brief, entry and path', async ($, on) => {
  seedDisk(on)
  const texts: string[] = []
  on('prompt.submit', async (_$, e) => {
    texts.push(e.text)
    return { text: e.text, context: e.context }
  })
  await $.tool.call({ tool: 'Edit', file_path: PATH, old_string: 'a', new_string: 'b' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.input({ key: 'c:demo#Q-1:0', text: 'Yes, once, after a pause' })
  const reply = texts.find(t => t.includes('Comment on Q-1')) ?? ''
  expect(reply).toContain('Yes, once, after a pause')
  expect(reply).toContain(PATH)
  expect(await ui.find({ type: 'Text', text: /You said: Yes, once/ })).toBeDefined()

  expect(await ui.find({ type: 'Text', text: 'Cannot be undone' })).toBeDefined()
  await ui.press({ key: 'r:demo#Q-1:0' })
  const ruling = texts.find(t => t.includes('Ruling on Q-1')) ?? ''
  expect(ruling).toContain('take "Retry once after a pause"')
  expect(ruling).toContain(PATH)
})

test('reading a brief does not make it this session\'s', async ($, on) => {
  seedDisk(on)
  const seen: string[] = []
  on('prompt.submit', async (_$, e) => {
    seen.push((e.context ?? []).join('\n'))
    return { text: e.text, context: e.context }
  })
  await $.tool.call({ tool: 'Read', file_path: PATH })
  await $.prompt.submit({ text: 'look', ...USER } as never)
  expect(seen[0]).toBe('')
})

test('briefs open one at a time and questions show in full', async ($, on) => {
  seedDisk(on)
  await $.tool.call({ tool: 'Edit', file_path: PATH, old_string: 'a', new_string: 'b' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Markdown', text: /killed for lack of memory/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: /Nothing retries it/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /runner journal 17:48/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Risk: Masks a real fault/ })).toBeDefined()

  await ui.press({ key: 'f:other' })
  expect(await ui.find({ type: 'Button', text: /A question elsewhere/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: /killed for lack of memory/ })).toBeUndefined()

  await ui.press({ key: 'f:other' })
  expect(await ui.find({ type: 'Button', text: /A question elsewhere/ })).toBeUndefined()
  expect(await ui.find({ type: 'Markdown', text: /killed for lack of memory/ })).toBeUndefined()
})

test('an answered question leaves the pane when its brief is edited by bare file name', async ($, on) => {
  seedDisk(on)
  await $.tool.call({ tool: 'Edit', file_path: PATH, old_string: 'a', new_string: 'b' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Button', text: /Should the job retry/ })).toBeDefined()

  const brief = FILES[PATH] as { decisions: { status: string }[] }
  const before = brief.decisions[0]!.status
  brief.decisions[0]!.status = 'decided'
  try {
    await $.tool.call({ tool: 'Bash', command: 'cd ~/x && python3 edit.py demo.brief.json' })
    expect(await ui.find({ type: 'Button', text: /Should the job retry/ })).toBeUndefined()
  } finally {
    brief.decisions[0]!.status = before
  }
})
