import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { TldrSummary } from '../types'

import {
  buildPrompt,
  buildTunePrompt,
  DEFAULT_LEVEL,
  isLevel,
  isWorthSummarising,
  lastReply,
  levelRules,
  LEVELS,
  parseArgs,
  systemPrompt,
  toLines,
  TUNE_SYSTEM,
} from './summarize'
import type { Level } from './summarize'

const COMMAND = 'tldr'
const LEVEL_KEY = 'level'

/** Persisted: the reading level is a preference, kept across sessions. */
async function readLevel($: EngineInterface): Promise<Level> {
  const stored = await $.store.get(LEVEL_KEY)
  return typeof stored === 'string' && isLevel(stored) ? stored : DEFAULT_LEVEL
}

/** Per session on purpose: every session starts off, `/tldr auto` turns it on for that session only. */
const isAuto = atom({ plugin: 'tldr', key: 'isAuto' } as const, false)
/** The box above the prompt; cleared when the next turn starts so it never describes an older reply. */
const summary = atom({ plugin: 'tldr', key: 'summary' } as const, null as TldrSummary | null)

/**
 * The summary is drawn above the prompt, never sent: the model does not read
 * it and the conversation carries on untouched.
 */
async function summarise($: EngineInterface, options: PluginOptions, reply: string, args: string): Promise<void> {
  // the engine prefixes the plugin name: this reads `tldr: summarising…`
  $.ui.status('summarising…')
  let result
  try {
    result = await $.model.complete({
      model: 'haiku',
      system: systemPrompt(await readLevel($), options),
      prompt: buildPrompt(reply, args),
      maxTokens: 600,
      effort: 'low',
      timeoutMs: 30_000,
    })
  } finally {
    $.ui.status(undefined)
  }

  if (!result.isAnswered) {
    $.ui.log(`tldr: no summary (${result.reason})`)
    return
  }
  await update($, summary, () => toLines(result.text))
}

/** `options` holds the per-level overrides from `/config`; a change there reloads the module. */
/**
 * Sonnet rewrites the level's rules from the feedback: rare, and worth the better wording.
 * Saved as the plugin's `/config` field (`tldr.<level>`), so it is global and editable there.
 */
async function tune($: EngineInterface, options: PluginOptions, level: Level, feedback: string): Promise<void> {
  $.ui.status(`tuning ${level}…`)
  let result
  try {
    result = await $.model.complete({
      model: 'sonnet',
      system: TUNE_SYSTEM,
      prompt: buildTunePrompt(level, levelRules(level, options), feedback),
      maxTokens: 400,
      effort: 'low',
      timeoutMs: 60_000,
    })
  } finally {
    $.ui.status(undefined)
  }
  if (!result.isAnswered) {
    $.ui.log(`tldr: ${level} not changed (${result.reason})`)
    return
  }
  const rules = result.text.trim()
  const { deny } = await $.config.set({ key: `tldr.${level}`, value: rules })
  $.ui.log(deny === undefined ? `tldr: ${level} rules now: ${rules}` : `tldr: ${level} not saved (${deny})`)
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: `TL;DR of the last reply, not sent to the model ("auto" toggles it after every reply; ${LEVELS.join('/')} sets the reading level; "tune <level> <feedback>" rewrites a level's rules; else an extra ask, e.g. "one line")`,
    })

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const parsed = parseArgs(e.args)
    if (parsed.kind === 'auto') {
      const enabled = !(await read($, isAuto))
      await update($, isAuto, () => enabled)
      return { text: enabled ? 'auto on.' : 'auto off.' }
    }
    if (parsed.kind === 'usage') {
      $.ui.log(`tldr: ${parsed.text}`)
      return {}
    }
    if (parsed.kind === 'tune') {
      await tune($, options, parsed.level, parsed.feedback)
      return {}
    }
    if (parsed.kind === 'reset') {
      const { deny } = await $.config.set({ key: `tldr.${parsed.level}`, value: '' })
      $.ui.log(deny === undefined ? `tldr: ${parsed.level} back to built-in rules` : `tldr: ${parsed.level} not reset (${deny})`)
      return {}
    }
    if (parsed.level !== undefined) {
      await $.store.set(LEVEL_KEY, parsed.level)
      $.ui.log(`tldr: level ${parsed.level}`)
    }

    const reply = lastReply(await $.session.messages())
    if (reply === undefined) {
      $.ui.log('tldr: no reply to summarise yet')
      return {}
    }
    await summarise($, options, reply, parsed.ask)

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
      void summarise($, options, e.answer, '')
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
