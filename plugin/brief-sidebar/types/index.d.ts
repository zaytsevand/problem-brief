export type Group = 'blocks' | 'awaiting' | 'escalated'

export type Option = {
  label: string
  recommended: boolean
  irreversible: boolean
  summary?: string
  work?: string
  risk?: string
  forecloses?: string
}

export type Evidence = { ref: string; note?: string }

export type Entry = {
  id: string
  title: string
  label: string
  group: Group
  problem?: string
  brief?: string
  reason?: string
  evidence: Evidence[]
  now?: string
  whyWrong?: string
  target?: string
  options: Option[]
  unblocks: number
  isNew: boolean
}

export type BriefView = {
  slug: string
  title: string
  path: string
  url?: string
  goal?: string
  open: Entry[]
  decided: number
  updated?: string
}

export type SentComment = { text: string; at: number }

export type Upkeep = { turnsWithWork: number; lastWriteAt: number | null }

// A reply held for a brief's owner that was not running: the prompt it gets, and what the pane shows.
export type HeldReply = { owner: string; text: string; entry?: string; said?: string }

declare module 'claude-code' {
  interface PluginState {
    'brief-sidebar': {
      briefs: BriefView[]
      sessionSlug: string
      inPlay: string[]
      // Brief files this session named, as absolute paths: loaded wherever they live.
      paths: string[]
      openBrief: string
      folded: string[]
      sent: Record<string, SentComment[]>
      upkeep: Upkeep
      // Replies waiting in the shared store for another session, by brief path.
      held: Record<string, HeldReply[]>
    }
  }
}
