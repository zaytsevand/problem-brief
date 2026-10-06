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

declare module 'claude-code' {
  interface PluginState {
    'brief-sidebar': {
      briefs: BriefView[]
      sessionSlug: string
      inPlay: string[]
      openBrief: string
      folded: string[]
      sent: Record<string, SentComment[]>
      upkeep: Upkeep
    }
  }
}
