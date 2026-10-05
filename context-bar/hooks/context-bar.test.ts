import { expect, mock, test } from 'claude-code/testing'

import type { ContextBarSnapshot } from '../types'
import { barSegments, categoryColors, formatShare, formatTokens, legendItems, legendLines } from './layout'

const SNAP: ContextBarSnapshot = {
  used: 212_000,
  max: 1_000_000,
  compactAt: 950_000,
  rows: [
    { name: 'system prompt', tokens: 3_400, color: 'promptBorder' },
    { name: 'messages', tokens: 186_000, color: 'permission' },
  ],
}

test('counts are exact below 100k and keep one decimal above', () => {
  expect(formatTokens(512)).toBe('512')
  expect(formatTokens(99_999)).toBe('99999')
  expect(formatTokens(100_000)).toBe('100.0k')
  expect(formatTokens(999_960)).toBe('1.0M')
  expect(formatTokens(3_400)).toBe('3400')
  expect(formatTokens(212_000)).toBe('212.0k')
  expect(formatTokens(1_000_000)).toBe('1.0M')
  expect(formatShare(3_400, 1_000_000)).toBe('0.3%')
  expect(formatShare(186_000, 1_000_000)).toBe('19%')
  expect(formatShare(9_970, 1_000_000)).toBe('1%')
  expect(formatShare(9_400, 1_000_000)).toBe('0.9%')
})

test('the bar fills its width, gives every category a cell and marks compaction', () => {
  const segments = barSegments(SNAP, 100)
  const total = segments.reduce((n, s) => n + s.text.length, 0)
  expect(total).toBe(100)
  expect(segments[0]).toEqual({ color: 'promptBorder', text: '█', isMarker: false })
  expect(segments[1]?.text.length).toBe(19)
  const marker = segments.findIndex(s => s.isMarker)
  const before = segments.slice(0, marker).reduce((n, s) => n + s.text.length, 0)
  expect(before).toBe(95)
})

test('every category gets its own colour, unknown ones from the spare list', () => {
  const colors = categoryColors(['system prompt', 'system tools', 'something new', 'another new'])
  expect(new Set(colors).size).toBe(4)
})

test('free space is drawn shaded, not as a solid category', () => {
  const free = barSegments(SNAP, 100).filter(s => s.color === null && !s.isMarker)
  expect(free.every(s => /^░+$/.test(s.text))).toBe(true)
})

test('legend ends with free space and wraps to the width', () => {
  const items = legendItems(SNAP)
  expect(items[items.length - 1]).toEqual({ color: null, name: 'free', tokens: '788.0k', share: '' })
  expect(legendLines(items, 30).length).toBeGreaterThan(1)
  expect(legendLines(items, 200).length).toBe(1)
})

/** A session.usage answer whose context holds `used` tokens. */
const usageWith = (used: number) => ({
  startedAt: 0,
  rateLimits: [],
  context: {
    window: 1_000_000,
    breakdown: {
      categories: [
        { name: 'System prompt', tokens: 3_400, color: 'promptBorder', isDeferred: false, kind: 'used' },
        { name: 'Messages', tokens: 186_000, color: 'permission', isDeferred: false, kind: 'used' },
        { name: 'Free space', tokens: 788_000, color: 'inactive', isDeferred: false, kind: 'free' },
      ],
      totalTokens: used,
      maxTokens: 1_000_000,
      rawMaxTokens: 1_000_000,
      autocompactSource: 'auto',
      percentage: 21,
      gridRows: [],
      model: 'test',
      memoryFiles: [],
      mcpTools: [],
      agents: [],
      autoCompactThreshold: 950_000,
      isAutoCompactEnabled: true,
      apiUsage: null,
    },
  },
})

test('/context-bar toggles the band on and off on every surface', async ($, on) => {
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: usageWith(212_000) }))

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const on1 = await $.command.run({ command: 'context-bar', args: '' } as never)
  expect(on1.text).toBe('Context bar on.')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'context-bar',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 80 } as never,
    })
    expect(await ui.find({ type: 'Text', text: /212\.0k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /compacts at 950\.0k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /free 788\.0k/ })).toBeDefined()
    await ui.unmount()
  }

  const off = await $.command.run({ command: 'context-bar', args: '' } as never)
  expect(off.text).toBe('Context bar off.')
})

test('the bar refreshes after every tool call, not only at turn end', async ($, on) => {
  let used = 212_000
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: usageWith(used) }))
  on('tool.call', () => ({ result: 'ok' }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'context-bar', args: '' } as never)

  used = 300_000
  await $.tool.call({ tool: 'Bash', input: { command: 'ls' } } as never)

  const ui = await $.ui.mount({
    plugin: 'context-bar',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 80 } as never,
  })
  expect(await ui.find({ type: 'Text', text: /300\.0k/ })).toBeDefined()
  await ui.unmount()
})
