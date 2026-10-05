import type { Register } from 'claude-code'

import { buildPrompt, lastReply, SYSTEM, toLines } from './summarize'

const COMMAND = 'tldr'

/**
 * Output goes through `$.ui.log` only: notice lines are not messages, so the
 * model never reads the summary and the conversation carries on untouched.
 */
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'TL;DR of the last reply, not sent to the model (optional: extra ask, e.g. "one line")',
    })

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const messages = await $.session.messages()
    const reply = lastReply(messages)
    if (reply === undefined) {
      $.ui.log('tldr: no reply to summarise yet')
      return {}
    }

    $.ui.status('tldr…')
    const result = await $.model.complete({
      model: 'haiku',
      system: SYSTEM,
      prompt: buildPrompt(reply, e.args),
      maxTokens: 600,
      effort: 'low',
      timeoutMs: 30_000,
    })
    $.ui.status(undefined)

    if (!result.isAnswered) {
      $.ui.log(`tldr: no summary (${result.reason})`)
      return {}
    }
    for (const line of ['TL;DR', ...toLines(result.text)]) $.ui.log(line)

    return {}
  })
}
