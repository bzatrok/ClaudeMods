import type { SessionMessage } from 'claude-code'

export const SYSTEM = [
  'You rewrite one assistant reply as a TL;DR for the person who read it.',
  'Plain English, short words, no jargon the reply did not use.',
  'Lead with the answer or the outcome. Then at most 4 bullets: what changed, what is blocked, what the person must do.',
  'Keep every number, path, command and condition that matters. Drop everything else.',
  'Do not add facts. Do not address the assistant. No preamble, no heading.',
].join(' ')

/** The newest assistant message with text; tool-only turns have none. */
export function lastReply(messages: readonly SessionMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.role === 'assistant' && m.text.trim() !== '') return m.text
  }
  return undefined
}

/** `args` is an optional extra ask (`/tldr one line`), appended as an instruction. */
export function buildPrompt(reply: string, args: string): string {
  const extra = args.trim() === '' ? '' : `\n\nAlso: ${args.trim()}`
  return `<reply>\n${reply}\n</reply>\n\nWrite the TL;DR of this reply.${extra}`
}

/** One `$.ui.log` call per line; blank lines dropped so the notice stays compact. */
export function toLines(summary: string): string[] {
  return summary
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim() !== '')
}
