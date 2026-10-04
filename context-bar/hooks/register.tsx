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
} from './layout'

const COMMAND = 'context-bar'
const STORE_KEY = 'isVisible'

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
      description: 'Toggle the context window bar above the prompt',
    })
    const stored = (await $.store.get(STORE_KEY)) === true
    await update($, isVisible, () => stored)
    if (stored) await refresh($)

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    const shown = !(await read($, isVisible))
    await update($, isVisible, () => shown)
    await $.store.set(STORE_KEY, shown)
    if (shown) await refresh($)

    return { text: shown ? 'Context bar on.' : 'Context bar off.' }
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

    return (
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
              <Text color="gray" dimColor>
                {seg.text}
              </Text>
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
                  <Text color="gray" dimColor>
                    ▌{' '}
                  </Text>
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
    )
  })
}
