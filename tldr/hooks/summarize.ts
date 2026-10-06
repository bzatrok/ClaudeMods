import type { SessionMessage } from 'claude-code'

/** Reading levels, simplest first; `/tldr <level>` picks one and it is remembered across sessions. */
export const LEVELS = ['eli5', 'eli8', 'eli12', 'eli15'] as const
export type Level = (typeof LEVELS)[number]
export const DEFAULT_LEVEL: Level = 'eli12'

const LEVEL_RULES: Record<Level, string> = {
  eli5: 'Write for a 5-year-old: tiny words, one idea per sentence, an everyday comparison instead of any technical term. At most 3 short sentences, no bullets.',
  eli8: 'Write for an 8-year-old: simple words, short sentences, explain any technical term in a few plain words or leave it out. Formulas and symbols are never copied.',
  eli12: 'Write for a smart 12-year-old: plain words, technical terms only when needed and then explained in passing. No formulas or symbols; describe what they mean.',
  eli15: 'Write for a bright 15-year-old: normal vocabulary, key technical terms kept with a short gloss. At most one formula, only if it is the point.',
}

export function isLevel(word: string): word is Level {
  return (LEVELS as readonly string[]).includes(word)
}

/** The level only changes the wording: paths, commands and numbers the person must act on are kept at every level. */
export function systemPrompt(level: Level): string {
  return [
    'You rewrite one assistant reply as a TL;DR for the person who read it.',
    LEVEL_RULES[level],
    'Lead with the answer or the outcome in one or two sentences. Then up to 4 bullets with the points that matter most; do not label bullets with fixed headings.',
    'Keep every file path, command and number the person has to act on, verbatim. Drop everything else.',
    'Do not add facts. Do not address the assistant. No preamble, no heading.',
    'Plain text only: no bold, no italics, no headings; bullets start with "- ".',
  ].join(' ')
}

/** The newest assistant message with text; tool-only turns have none. */
export function lastReply(messages: readonly SessionMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.role === 'assistant' && m.text.trim() !== '') return m.text
  }
  return undefined
}

/** Below this a reply is already short enough to read as is. */
const MIN_CHARS = 400

export function isWorthSummarising(answer: string): boolean {
  return answer.trim().length >= MIN_CHARS
}

export type Parsed =
  | { kind: 'auto' }
  /** `level` set when the first word names one: it is remembered; `ask` is what is left. */
  | { kind: 'summarise'; level: Level | undefined; ask: string }

/** `/tldr auto` toggles; `/tldr eli5 [ask]` sets the level, then summarises; else the args are an extra ask. */
export function parseArgs(args: string): Parsed {
  const trimmed = args.trim()
  if (trimmed.toLowerCase() === 'auto') return { kind: 'auto' }
  const [first = '', ...rest] = trimmed.split(/\s+/)
  const word = first.toLowerCase()
  if (isLevel(word)) return { kind: 'summarise', level: word, ask: rest.join(' ') }
  return { kind: 'summarise', level: undefined, ask: trimmed }
}

/** `args` is an optional extra ask (`/tldr one line`), appended as an instruction. */
export function buildPrompt(reply: string, args: string): string {
  const extra = args.trim() === '' ? '' : `\n\nAlso: ${args.trim()}`
  return `<reply>\n${reply}\n</reply>\n\nWrite the TL;DR of this reply.${extra}`
}

/** Blank lines dropped so the box stays compact. */
export function toLines(summary: string): string[] {
  return summary
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim() !== '')
}
