import type { CockpitBlock, CockpitGauge, CockpitWorker } from '../types'

export const EMPTY_BLOCK: CockpitBlock = {
  goal: '',
  now: '',
  done: '',
  next: '',
  constraints: '',
  updatedAt: 0,
  phaseDone: false,
}

export const EMPTY_GAUGE: CockpitGauge = { used: 0, max: 0, percent: 0, measuredAt: 0 }

const BAR_CELLS = 10
const MAX_WORKER_ROWS = 4

/** One drawn row. `gauge` is row 1: the caller adds the collapse button at its right end. */
/** `label` is the padded heading at the start of `text`, drawn bold by the band. */
export type BandRow = { kind: 'gauge' | 'line' | 'worker'; key: string; text: string; label?: string }

// the longest heading, 'constraints:': every value starts in the same column
const LABEL_WIDTH = 12

export function clip(text: string, width: number): string {
  if (width <= 0) return ''
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`
}

export function bar(percent: number): string {
  const filled = Math.min(BAR_CELLS, Math.max(0, Math.round((percent / 100) * BAR_CELLS)))
  return '▮'.repeat(filled) + '▯'.repeat(BAR_CELLS - filled)
}

export function formatAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  return `${Math.round(s / 3600)}h`
}

/** Same format as context-bar's: exact below 100k, then k, then M. */
export function formatTokens(n: number): string {
  if (n < 100_000) return String(Math.round(n))
  if (n < 999_950) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export function gaugeText(gauge: CockpitGauge, workers: number, now: number, threshold: number): string {
  const compacted =
    gauge.lastCompactionAt === undefined
      ? 'not compacted yet'
      : `compacted ${formatAgo(now - gauge.lastCompactionAt)} ago`
  // absolute numbers like context-bar: a percent hides which window it is a share of
  const parts = [`context ${formatTokens(gauge.used)} of ${formatTokens(gauge.max)} ${bar(gauge.percent)}`]
  parts.push(gauge.used >= threshold ? 'compaction expected at next boundary' : `compacts at ${formatTokens(threshold)}`)
  parts.push(compacted)
  if (workers > 0) parts.push(`${workers} worker${workers === 1 ? '' : 's'}`)

  return parts.join(' · ')
}

export function workerText(w: CockpitWorker): string {
  const tail = [w.provider, w.branch, w.since === undefined ? undefined : `since ${w.since}`]
  return [`worker ${w.id}`, ...tail.filter((t): t is string => t !== undefined)].join(' · ')
}

export type BandInput = {
  block: CockpitBlock
  gauge: CockpitGauge
  workers: CockpitWorker[]
  collapsed: boolean
  now: number
  /** tokens past which compaction waits for the next boundary */
  threshold: number
  columns: number
  maxRows: number
}

/**
 * Rows top to bottom. Over `maxRows` it drops worker rows, then constraints, done, next, goal:
 * `now` and the gauge are what a late joiner needs most.
 */
export function buildRows(i: BandInput): BandRow[] {
  const { block, columns } = i
  const gauge: BandRow = { kind: 'gauge', key: 'gauge', text: gaugeText(i.gauge, i.workers.length, i.now, i.threshold) }
  const hasBlock = block.updatedAt > 0
  const labelled = (key: string, label: string, value: string): BandRow => ({
    kind: 'line',
    key,
    label: `${label}:`.padEnd(LABEL_WIDTH),
    text: clip(`${`${label}:`.padEnd(LABEL_WIDTH)} ${value}`, columns),
  })
  const now = labelled('now', 'now', hasBlock ? block.now : '(no cockpit_update yet)')
  if (i.collapsed || !hasBlock) return [gauge, now]

  const line = (key: keyof CockpitBlock, label: string): BandRow => labelled(key, label, String(block[key]))
  const shown = i.workers.slice(0, MAX_WORKER_ROWS)
  const workerRows: BandRow[] = shown.map(w => ({
    kind: 'worker',
    key: `worker-${w.id}`,
    text: clip(workerText(w), columns),
  }))
  if (i.workers.length > shown.length) {
    workerRows.push({ kind: 'worker', key: 'worker-more', text: `+${i.workers.length - shown.length} more` })
  }

  let rows = [
    gauge,
    line('goal', 'goal'),
    now,
    line('done', 'done'),
    line('next', 'next'),
    line('constraints', 'constraints'),
    ...workerRows,
  ]
  const dropSeq = [...workerRows.map(r => r.key).reverse(), 'constraints', 'done', 'next', 'goal']
  for (const key of dropSeq) {
    if (rows.length <= i.maxRows) break
    rows = rows.filter(r => r.key !== key)
  }

  return rows
}

/** `task.py list` rows: tab-separated ID, Owner, Branch, provider, Updated; no header. */
export function parseBoard(stdout: string): { worker: CockpitWorker; owner: string }[] {
  return stdout
    .split('\n')
    .filter(l => l.trim() !== '')
    .map(l => l.split('\t'))
    .map(([id = '', owner = '', branch = '', provider = '', updated = '']) => ({
      owner,
      worker: {
        id,
        kind: 'board' as const,
        ...(provider && { provider }),
        ...(branch && { branch }),
        ...(updated && { since: updated }),
      },
    }))
}

/** Board rows first, then subagents whose names match no board owner. */
export function mergeWorkers(
  board: { worker: CockpitWorker; owner: string }[],
  subagents: { worker: CockpitWorker; names: string[] }[],
): CockpitWorker[] {
  const owners = new Set(board.map(b => b.owner))
  return [
    ...board.map(b => b.worker),
    ...subagents.filter(s => !s.names.some(n => owners.has(n))).map(s => s.worker),
  ]
}
