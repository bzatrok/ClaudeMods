import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { buildRows, parseBoard } from './layout'

const TOOL = 'mcp__cockpit__cockpit_update'
const BAND = (maxRows: number) => ({
  plugin: 'cockpit',
  surface: 'terminal' as const,
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows, bodyColumns: 80 } as never,
})

const usage = {
  startedAt: 0,
  rateLimits: [],
  context: {
    window: 1_000_000,
    breakdown: {
      categories: [],
      totalTokens: 140_000,
      maxTokens: 1_000_000,
      rawMaxTokens: 1_000_000,
      autocompactSource: 'auto',
      percentage: 14,
      gridRows: [],
      model: 'test',
      memoryFiles: [],
      mcpTools: [],
      agents: [],
      isAutoCompactEnabled: true,
      apiUsage: null,
    },
  },
} as never

const BOARD = 'T-1\tworker-a\tfeat/a\tclaude\t2026-11-05\nT-2\tworker-b\tfeat/b\tglm\t2026-11-05\n'

/** The engine beneath the mod: usage, a repo with a board, no subagents. */
function engine(on: On) {
  on('clock.now', () => ({ value: Date.now() }))
  on('clock.every', () => ({ value: undefined }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', () => ({ value: { tool: TOOL } }))
  on('session.usage', () => ({ value: usage }))
  on('fs.exists', () => ({ value: true }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: BOARD, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('agent.list', () => ({ value: [] }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: 'done' }))
  on('ui.render', () => h('Box', {}) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
}

type Turned = { turn: { complete: (input: unknown) => Promise<{ text: string }> } }
/** The test kit types no `$.turn.complete`, but the engine answers it. */
const complete = ($: unknown) =>
  ($ as Turned).turn.complete({ answer: '', durationMs: 1, isAborted: false, reason: 'answer', turnId: 't' })

test('the band shows six rows and the workers, and drops rows to fit maxRows', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: TOOL,
    goal: 'ship the band',
    now: 'writing tests',
    done: 'skeleton',
    next: 'review',
    constraints: 'no file writes',
  } as never)
  await complete($)

  const full = await $.ui.mount(BAND(12))
  for (const re of [/ctx 14%/, /goal  +ship the band/, /now +writing tests/, /done +skeleton/, /next +review/, /constraints +no file writes/]) {
    expect(await full.find({ type: 'Text', text: re })).toBeDefined()
  }
  expect((await full.findAll({ type: 'Text', text: /^worker / })).length).toBe(2)
  await full.unmount()

  const tight = await $.ui.mount(BAND(3))
  expect(await tight.find({ type: 'Text', text: /goal/ })).toBeDefined()
  expect(await tight.find({ type: 'Text', text: /now/ })).toBeDefined()
  expect(await tight.find({ type: 'Text', text: /^(done|next|constraints|worker)/ })).toBeUndefined()
  await tight.unmount()
})

test('an Edit without cockpit_update gets the nudge, an update clears it', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts' } as never)
  expect((await complete($)).text).toBe('cockpit: the situation block is stale; call cockpit_update.')

  await $.tool.call({ tool: TOOL, now: 'fixed' } as never)
  expect((await complete($)).text).toBe('done')
})

test('/cockpit collapses to the gauge and now rows', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: TOOL, goal: 'g', now: 'n' } as never)
  await $.command.run({ command: 'cockpit', args: '' } as never)

  const ui = await $.ui.mount(BAND(12))
  expect(await ui.find({ type: 'Text', text: /now +n/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /goal/ })).toBeUndefined()
  await ui.unmount()
})

test('layout: empty block shows the placeholder; board rows parse', () => {
  const rows = buildRows({
    block: { goal: '', now: '', done: '', next: '', constraints: '', updatedAt: 0, phaseDone: false },
    gauge: { used: 0, max: 0, percent: 0, measuredAt: 0 },
    workers: [],
    collapsed: false,
    now: 0,
    columns: 80,
    maxRows: 12,
  })
  expect(rows.map(r => r.text)).toEqual(['ctx 0% ▯▯▯▯▯▯▯▯▯▯ · not compacted yet', 'now   (no cockpit_update yet)'])
  expect(parseBoard(BOARD)[1]?.worker).toEqual({ id: 'T-2', kind: 'board', provider: 'glm', branch: 'feat/b', since: '2026-11-05' })
})
