import type { CockpitBlock, CockpitGauge, CockpitNote, CockpitWorker } from '../types'

export const COOLDOWN_MS = 5 * 60_000
export const MAX_NOTES_PER_CWD = 20

export const PRESERVE =
  'Preserve verbatim: the goal, current step, done, next and constraints as last given to cockpit_update; the list of running workers with their rows and providers, because their reports arrive after compaction; every open decision the user has not answered; file paths touched this session.'

/** Appended to whatever the person typed after /compact. */
export function withPreserve(instructions: string | undefined): string {
  return instructions ? `${instructions}\n\n${PRESERVE}` : PRESERVE
}

/** Compact only at a closed unit of work, past the threshold, and not twice within the cooldown. */
export function shouldCompact(i: { block: CockpitBlock; gauge: CockpitGauge; threshold: number; now: number }): boolean {
  const { block, gauge } = i
  const isCooling = gauge.lastCompactionAt !== undefined && i.now - gauge.lastCompactionAt < COOLDOWN_MS

  return block.phaseDone && gauge.used >= i.threshold && !isCooling
}

/** Adds `note` and keeps the newest 20 of its cwd; other cwds are untouched. */
export function pushNote(all: CockpitNote[], note: CockpitNote): CockpitNote[] {
  const mine = [...all.filter(n => n.cwd === note.cwd), note].slice(-MAX_NOTES_PER_CWD)

  return [...all.filter(n => n.cwd !== note.cwd), ...mine]
}

export function notesFor(all: CockpitNote[], cwd: string): CockpitNote[] {
  return all.filter(n => n.cwd === cwd)
}

const workerLine = (w: CockpitWorker) =>
  `- ${[w.id, w.provider ?? '-', w.branch ?? '-', `since ${w.since ?? '-'}`].join(' · ')}`

/** The note as `/cockpit note` prints it. `n` counts entries for this cwd, this one included. */
export function buildNote(i: {
  cwd: string
  trigger: string
  n: number
  at: string
  block: CockpitBlock
  gauge: CockpitGauge
  workers: CockpitWorker[]
}): CockpitNote {
  const { block, gauge } = i
  const text = [
    `## ${i.at} — before compaction (${i.n}) — trigger ${i.trigger}`,
    `goal: ${block.goal}  now: ${block.now}  done: ${block.done}  next: ${block.next}  constraints: ${block.constraints}`,
    'workers:',
    ...i.workers.map(workerLine),
    `context: ${gauge.used} tokens (${Math.round(gauge.percent)}%)`,
  ].join('\n')

  return { cwd: i.cwd, header: text.split('\n')[0] as string, text }
}

/** The first message after a compaction. Without any update it still names the cwd, the command and the workers. */
export function resumePrompt(cwd: string, block: CockpitBlock, workers: CockpitWorker[]): string {
  const parts = [`Resume on ${cwd}. Run /cockpit note for the full pre-compaction state and read the memory files.`]
  if (block.updatedAt > 0) {
    parts.push(`Goal: ${block.goal}. Now: ${block.now}. Next: ${block.next}. Constraints: ${block.constraints}.`)
  }
  if (workers.length > 0) {
    const list = workers.map(w => `${w.id} · ${w.provider ?? '-'}`).join(', ')
    parts.push(`Workers still running: ${list}; expect their reports and merge through the board.`)
  }
  parts.push('Keep your context lean. Call cockpit_update first.')

  return parts.join(' ')
}
