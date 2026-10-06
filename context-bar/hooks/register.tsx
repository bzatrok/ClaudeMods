import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ContextBarSnapshot } from '../types'
import {
  barSegments,
  formatTokens,
  legendItems,
  legendLines,
  percentColor,
  toSnapshot,
  FREE,
} from './layout'

const COMMAND = 'context-bar'

/** Per session on purpose: every session starts hidden, `/context-bar` shows it for that session only. */
const isVisible = atom({ plugin: 'context-bar', key: 'isVisible' } as const, false)
const snapshot = atom({ plugin: 'context-bar', key: 'snapshot' } as const, null as ContextBarSnapshot | null)

/** `summary` estimates locally: no token-count requests, so it is free to run every turn. */
async function refresh($: EngineInterface): Promise<void> {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const breakdown = usage.context.breakdown
  if (!breakdown) return
  await update($, snapshot, () => toSnapshot(breakdown))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Show the context window bar above the prompt (/context-bar off hides it)',
    })

    return next(e)
  })

  /** Bare `/context-bar` always shows (and refreshes) the bar; `/context-bar off` hides it. */
  on('command.run', { command: COMMAND }, async ($, e) => {
    const shown = e.args.trim().toLowerCase() !== 'off'
    await update($, isVisible, () => shown)
    if (shown) await refresh($)

    return { text: shown ? 'Context bar on.' : 'Context bar off.' }
  })

  /** Keeps the bar moving during long agent runs instead of only at turn end. */
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (await read($, isVisible)) await refresh($)

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (await read($, isVisible)) await refresh($)

    return result
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (await read($, isVisible)) await refresh($)

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = await read($, isVisible)
    const snap = await read($, snapshot)
    if (e.props.hasSurvey || !shown || snap === null) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    // round border (2) + paddingX (2)
    const inner = Math.max(10, e.props.bodyColumns - 4)
    const percent = snap.max > 0 ? Math.round((snap.used / snap.max) * 100) : 0
    const lines = legendLines(legendItems(snap), inner)

    // other mods (tldr) draw in the same band: stack above them, never replace them
    const rest = await next(e)

    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
          <Box justifyContent="space-between">
            <Text>
              <Text color="yellow">◆ </Text>
              <Text bold>context</Text>
            </Text>
            <Text>
              <Text bold>{formatTokens(snap.used)}</Text>
              <Text dimColor> of {formatTokens(snap.max)}</Text>
              {snap.compactAt !== null && (
                <Text dimColor> · compacts at {formatTokens(snap.compactAt)}</Text>
              )}
              <Text> </Text>
              <Text color="black" backgroundColor={percentColor(percent)}>
                {' '}
                {percent}%{' '}
              </Text>
            </Text>
          </Box>
          <Text wrap="truncate">
            {barSegments(snap, inner).map(seg =>
              seg.isMarker ? (
                <Text color="yellow">{seg.text}</Text>
              ) : seg.color === null ? (
                <Text dimColor>{seg.text}</Text>
              ) : (
                <Text color={seg.color}>{seg.text}</Text>
              ),
            )}
          </Text>
          {lines.map(line => (
            <Text wrap="truncate">
              {line.map(item => (
                <Text>
                  {item.color === null ? (
                    <Text dimColor>{FREE} </Text>
                  ) : (
                    <Text color={item.color}>▌ </Text>
                  )}
                  <Text>{item.name} </Text>
                  <Text>{item.tokens}</Text>
                  {item.share !== '' && <Text dimColor> {item.share}</Text>}
                  <Text>{'  '}</Text>
                </Text>
              ))}
            </Text>
          ))}
        </Box>
        {rest}
      </Box>
    )
  })
}
