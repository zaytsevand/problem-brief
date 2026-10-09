import { expect, test } from 'claude-code/testing'

import { judgeTurn } from '../hooks/turn'

test('a brief counts as written only when its own stamp moved', async () => {
  const before = { demo: '2026-10-06T10:00Z', other: '2026-10-06T09:00Z' }
  const read = judgeTurn(before, { ...before }, new Set(['demo']), [])
  expect(read.wrote).toBe(false)
  expect(read.claimed).toEqual([])

  const written = judgeTurn(before, { ...before, demo: '2026-10-06T11:00Z' }, new Set(['demo']), [])
  expect(written.wrote).toBe(true)
  expect(written.claimed).toEqual(['demo'])
})

test('another session moving a brief this turn never named does not count, unless it is ours', async () => {
  const before = { demo: 'a', other: 'b' }
  const elsewhere = judgeTurn(before, { demo: 'a', other: 'c' }, new Set(['demo']), [])
  expect(elsewhere.wrote).toBe(false)
  expect(elsewhere.claimed).toEqual([])

  const ours = judgeTurn(before, { demo: 'a', other: 'c' }, new Set(), ['other'])
  expect(ours.wrote).toBe(true)
  expect(ours.claimed).toEqual([])
})

test('a brief created during the turn counts as moved', async () => {
  const made = judgeTurn({}, { fresh: 'x' }, new Set(['fresh']), [])
  expect(made.moved).toEqual(['fresh'])
  expect(made.claimed).toEqual(['fresh'])
})
