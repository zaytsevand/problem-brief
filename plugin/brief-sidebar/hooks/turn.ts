// Implements Q-3 of the session brief: a brief was written when its own updated stamp moved, whatever tool moved it.

export type Stamps = Readonly<Record<string, string>>

export type TurnVerdict = {
  // Briefs whose stamp moved, or which appeared, during the turn.
  moved: string[]
  // Whether a brief of this session, or one the turn named, was written.
  wrote: boolean
  // Briefs the turn named and wrote: they become this session's.
  claimed: string[]
}

export function judgeTurn(
  before: Stamps,
  after: Stamps,
  named: ReadonlySet<string>,
  mine: readonly string[],
): TurnVerdict {
  const moved = Object.keys(after).filter(slug => after[slug] !== before[slug])
  const claimed = moved.filter(slug => named.has(slug))

  return { moved, wrote: moved.some(slug => named.has(slug) || mine.includes(slug)), claimed }
}
