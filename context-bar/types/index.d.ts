/** One used category of the window, as /context lists it. */
export type ContextBarRow = { name: string; tokens: number; color: string }

/** The window at the end of the last turn, measured against the compaction window. */
export type ContextBarSnapshot = {
  used: number
  max: number
  compactAt: number | null
  rows: ContextBarRow[]
}

declare module 'claude-code' {
  interface PluginState {
    'context-bar': { isVisible: boolean; snapshot: ContextBarSnapshot | null }
  }
}
