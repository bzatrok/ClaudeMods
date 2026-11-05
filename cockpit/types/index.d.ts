import type { Shaped } from 'claude-code'

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

declare module 'claude-code' {
  interface PluginState {
    cockpit: {
      block: Shaped<CockpitBlock>
      gauge: Shaped<CockpitGauge>
      workers: Shaped<CockpitWorker[]>
      collapsed: Shaped<boolean>
      editsSinceUpdate: Shaped<number>
    }
  }
}
