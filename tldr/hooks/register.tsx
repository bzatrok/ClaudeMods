import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { buildPrompt, isAutoArg, isWorthSummarising, lastReply, SYSTEM, toLines } from './summarize'

const COMMAND = 'tldr'

/** Per session on purpose: every session starts off, `/tldr auto` turns it on for that session only. */
const isAuto = atom({ plugin: 'tldr', key: 'isAuto' } as const, false)
/** The box above the prompt; cleared when the next turn starts so it never describes an older reply. */
const summary = atom({ plugin: 'tldr', key: 'summary' } as const, null as string[] | null)

/**
 * The summary is drawn above the prompt, never sent: the model does not read
 * it and the conversation carries on untouched.
 */
async function summarise($: EngineInterface, reply: string, args: string): Promise<void> {
  $.ui.status('tldr…')
  const result = await $.model.complete({
    model: 'haiku',
    system: SYSTEM,
    prompt: buildPrompt(reply, args),
    maxTokens: 600,
    effort: 'low',
    timeoutMs: 30_000,
  })
  $.ui.status(undefined)

  if (!result.isAnswered) {
    $.ui.log(`tldr: no summary (${result.reason})`)
    return
  }
  await update($, summary, () => toLines(result.text))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'TL;DR of the last reply, not sent to the model ("auto" toggles it after every reply; else an extra ask, e.g. "one line")',
    })

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    if (isAutoArg(e.args)) {
      const enabled = !(await read($, isAuto))
      await update($, isAuto, () => enabled)
      return { text: enabled ? 'tldr auto on.' : 'tldr auto off.' }
    }

    const reply = lastReply(await $.session.messages())
    if (reply === undefined) {
      $.ui.log('tldr: no reply to summarise yet')
      return {}
    }
    await summarise($, reply, e.args)

    return {}
  })

  on('turn.start', async ($, e, next) => {
    await update($, summary, () => null)

    return next(e)
  })

  /** Main loop answers only; not awaited, so the turn ends without waiting on haiku. */
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.reason === 'answer' && isWorthSummarising(e.answer) && (await read($, isAuto))) {
      void summarise($, e.answer, '')
    }

    return result
  })

  /** Stacks under whatever else draws in the band (context-bar), never replaces it. */
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const lines = await read($, summary)
    if (e.props.hasSurvey || e.props.isWorking || lines === null) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const rest = await next(e)

    return (
      <Box flexDirection="column">
        {rest}
        <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
          <Text>
            <Text color="cyan">◆ </Text>
            <Text bold>tl;dr</Text>
          </Text>
          {lines.map(line => (
            <Text>{line}</Text>
          ))}
        </Box>
      </Box>
    )
  })
}
