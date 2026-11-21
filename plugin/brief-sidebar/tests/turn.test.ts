import { expect, test } from 'claude-code/testing'

import { judgeTurn } from '../hooks/turn'

const START = Date.parse('2026-10-06T10:30:20Z')

test('a brief counts as written only when its own stamp moved', async () => {
  const before = { demo: '2026-10-06T10:00Z', other: '2026-10-06T09:00Z' }
  const read = judgeTurn(before, { ...before }, new Set(['demo']), [], START)
  expect(read.wrote).toBe(false)
  expect(read.claimed).toEqual([])

  const written = judgeTurn(before, { ...before, demo: '2026-10-06T11:00Z' }, new Set(['demo']), [], START)
  expect(written.wrote).toBe(true)
  expect(written.claimed).toEqual(['demo'])
})

test('another session moving a brief this turn never named does not count, unless it is ours', async () => {
  const before = { demo: 'a', other: 'b' }
  const elsewhere = judgeTurn(before, { demo: 'a', other: 'c' }, new Set(['demo']), [], START)
  expect(elsewhere.wrote).toBe(false)
  expect(elsewhere.claimed).toEqual([])

  const ours = judgeTurn(before, { demo: 'a', other: 'c' }, new Set(), ['other'], START)
  expect(ours.wrote).toBe(true)
  expect(ours.claimed).toEqual([])
})

test('a brief created during the turn counts as moved, even in the turn\'s first minute', async () => {
  const made = judgeTurn({}, { fresh: '2026-10-06T10:30Z' }, new Set(['fresh']), [], START)
  expect(made.moved).toEqual(['fresh'])
  expect(made.claimed).toEqual(['fresh'])
})

test('a brief first loaded this turn by reading it is not claimed: claim by editing, not reading', async () => {
  const old = judgeTurn({}, { example: '2026-09-15T09:00Z', bare: '' }, new Set(['example', 'bare']), [], START)
  expect(old.moved).toEqual([])
  expect(old.claimed).toEqual([])
  expect(old.wrote).toBe(false)
})
