// Implements Q-3 of the session brief: a brief was written when its own updated stamp moved, whatever tool moved it.

export type Stamps = Readonly<Record<string, string>>

export type TurnVerdict = {
  // Briefs whose stamp moved, or which appeared with a stamp from this turn.
  moved: string[]
  // Whether a brief of this session, or one the turn named, was written.
  wrote: boolean
  // Briefs the turn named and wrote: they become this session's.
  claimed: string[]
}

// Stamps are minute-precise, so a write in the turn's first minute carries that minute.
const MINUTE = 60_000

export function judgeTurn(
  before: Stamps,
  after: Stamps,
  named: ReadonlySet<string>,
  mine: readonly string[],
  startedAt: number,
): TurnVerdict {
  const since = startedAt - (startedAt % MINUTE)
  // A brief first seen this turn counts only if it was written this turn: reading one is no claim.
  const writtenNow = (stamp: string) => Date.parse(stamp) >= since
  const moved = Object.keys(after).filter(slug =>
    slug in before ? after[slug] !== before[slug] : writtenNow(after[slug] ?? ''),
  )
  const claimed = moved.filter(slug => named.has(slug))

  return { moved, wrote: moved.some(slug => named.has(slug) || mine.includes(slug)), claimed }
}
