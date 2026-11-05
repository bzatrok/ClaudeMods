import type { SessionMessage } from 'claude-code'

import type { CockpitBlock } from '../types'

/** Fields a fill may write; the rest of the block stays as it is. */
export type Filled = Pick<CockpitBlock, 'goal' | 'now' | 'done' | 'next' | 'constraints'>

const FIELDS = ['goal', 'now', 'done', 'next', 'constraints'] as const
const MAX_FIELD = 120
// the newest part of the conversation is what the band is about; older text only costs tokens
const MAX_TRANSCRIPT = 16_000

export const FILL_SYSTEM = [
  'You read a coding session transcript and state where it stands.',
  'Answer with exactly five lines, in this order: goal:, now:, done:, next:, constraints:.',
  'Each line holds one short plain sentence, at most 15 words, no markdown.',
  'goal is what the whole session is for. now is the step in progress. done is what is finished.',
  'next is the step after now. constraints are rules the person set. Write "none" when the transcript does not say.',
].join(' ')

/** The newest messages with text, oldest first, cut to the transcript budget. */
export function fillPrompt(messages: readonly SessionMessage[]): string | undefined {
  const lines: string[] = []
  let size = 0
  for (let i = messages.length - 1; i >= 0 && size < MAX_TRANSCRIPT; i--) {
    const m = messages[i]
    if (!m || m.text.trim() === '') continue
    const line = `${m.role}: ${m.text.trim()}`
    lines.unshift(line.slice(-(MAX_TRANSCRIPT - size)))
    size += line.length
  }
  return lines.length === 0 ? undefined : `<transcript>\n${lines.join('\n\n')}\n</transcript>`
}

/** Five `field: text` lines to block fields; undefined without a `now` line. */
export function parseFill(text: string): Filled | undefined {
  const out: Filled = { goal: '', now: '', done: '', next: '', constraints: '' }
  for (const raw of text.split('\n')) {
    const m = /^\s*[-*]?\s*(goal|now|done|next|constraints)\s*:\s*(.*)$/i.exec(raw)
    if (!m) continue
    const key = (m[1] as string).toLowerCase() as (typeof FIELDS)[number]
    const value = (m[2] as string).trim()
    out[key] = /^none\.?$/i.test(value) ? '' : value.slice(0, MAX_FIELD)
  }
  return out.now === '' ? undefined : out
}
