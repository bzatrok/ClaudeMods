/** Where a handover sits by its Status column: ✅ done, 🔄 in progress, anything else open. */
export type HandoverState = 'done' | 'in-progress' | 'open'

/** One row of the log's tracker table, with its `↳` note rows folded in. */
export type HandoverRow = {
  id: string
  slug: string
  file: string | null
  status: string
  state: HandoverState
  branches: string[]
  created: string
  completed: string
  notes: number
  lastNoteDate: string | null
}

/** A branch a handover names, as git sees it now. */
export type HandoverBranch = {
  name: string
  exists: boolean
  isMerged: boolean
  ahead: number
  lastCommit: string | null
  worktree: string | null
}

export type HandoverOpenItem = { row: HandoverRow; branches: HandoverBranch[] }

export type HandoverWorktree = { path: string; branch: string }

export type HandoverQuestion = { title: string; raised: string | null }

export type HandoverReport =
  | { kind: 'missing'; reason: string }
  | {
      kind: 'report'
      repo: string
      source: string
      sourceAge: string
      destination: string | null
      open: HandoverOpenItem[]
      doneCount: number
      lastDone: HandoverRow | null
      questions: HandoverQuestion[]
      checkout: { branch: string; dirty: number }
      trunk: string
      trunkDrift: { name: string; ahead: number; behind: number } | null
      worktrees: number
      staleWorktrees: HandoverWorktree[]
      parked: string[]
      generatedAt: number
    }

declare module 'claude-code' {
  interface PluginState {
    'handover-report': { report: HandoverReport | null; isLoading: boolean }
  }
}
