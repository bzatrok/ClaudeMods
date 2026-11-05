/** Same shape as the engine's `Shaped`: a value stored under a tag, read as absent under another. */
export type CockpitShaped<T> = { shape: string; value: T }

/** The five lines the model writes through `cockpit_update`. Strings default to "". */
export type CockpitBlock = {
  goal: string
  now: string
  done: string
  next: string
  constraints: string
  updatedAt: number
  phaseDone: boolean
}

/** Context fill, measured at `measuredAt`; `lastCompactionAt` is set by the `session.compact` hook. */
export type CockpitGauge = {
  used: number
  max: number
  percent: number
  lastCompactionAt?: number
  measuredAt: number
}

export type CockpitWorker = {
  id: string
  kind: 'board' | 'subagent'
  provider?: string
  branch?: string
  since?: string
}

/** One pre-compaction note, as stored in `$.store` under `cockpit.notes`. */
export type CockpitNote = { cwd: string; header: string; text: string }

declare module 'claude-code' {
  interface PluginState {
    cockpit: {
      block: CockpitShaped<CockpitBlock>
      gauge: CockpitShaped<CockpitGauge>
      workers: CockpitShaped<CockpitWorker[]>
      collapsed: CockpitShaped<boolean>
      editsSinceUpdate: CockpitShaped<number>
    }
  }
}
