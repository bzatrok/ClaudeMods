import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { buildRows, parseBoard } from './layout'
import { resumePrompt } from './compaction'
import { fillPrompt, parseFill } from './fill'

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

const withUsage = (used: number) => {
  const u = usage as unknown as { context: { breakdown: object } }
  return { ...u, context: { ...u.context, breakdown: { ...u.context.breakdown, totalTokens: used } } } as never
}

const BOARD = 'T-1\tworker-a\tfeat/a\tclaude\t2026-11-05\nT-2\tworker-b\tfeat/b\tglm\t2026-11-05\n'

/** The engine beneath the mod: usage, a repo with a board, no subagents. */
function engine(on: On, used = 140_000) {
  on('clock.now', () => ({ value: Date.now() }))
  on('clock.every', () => ({ value: undefined }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', () => ({ value: { tool: TOOL } }))
  on('session.usage', () => ({ value: withUsage(used) }))
  on('fs.exists', () => ({ value: true }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: BOARD, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('agent.list', () => ({ value: [] }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'port the ACR secrets', toolUses: [] }] as never }))
  on('model.complete', () => ({
    value: { isAnswered: true, text: 'goal: move secrets\nnow: grant Key Vault Reader\ndone: none\nnext: test the pipeline\nconstraints: none', usage: {} } as never,
  }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: 'done' }))
  on('ui.render', () => h('Box', {}) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const kv = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: kv.get(e.key) }))
  on('store.set', (_, e) => {
    kv.set(e.key, e.value)
    return { value: undefined }
  })
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
  for (const re of [/context 140\.0k of 1\.0M/, /ship the band/, /writing tests/, /skeleton/, /review/, /no file writes/]) {
    expect(await full.find({ type: 'Text', text: re })).toBeDefined()
  }
  expect((await full.findAll({ type: 'Text', text: /^worker / })).length).toBe(2)
  await full.unmount()

  // 5 rows: the border takes 2, leaving gauge, goal and now
  const tight = await $.ui.mount(BAND(5))
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
  expect(await ui.find({ type: 'Text', text: /now: +n$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /goal/ })).toBeUndefined()
  await ui.unmount()
})

type Calls = { instructions: (string | undefined)[]; down: (string | undefined)[] }
/** Records `$.session.compact` calls reaching the engine; answers with a one-message summary. */
function compactEngine(on: On): Calls {
  const calls: Calls = { instructions: [], down: [] }
  on('session.compact', (_, e) => {
    calls.instructions.push(e.instructions)
    return { messages: [{ role: 'assistant', text: 'summary', toolUses: [] }] }
  })

  return calls
}

test('turn end compacts at a boundary past the threshold, and only then', async ($, on) => {
  engine(on, 250_000)
  const calls = compactEngine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  await $.tool.call({ tool: TOOL, now: 'n', phase_done: false } as never)
  await complete($)
  expect(calls.instructions.length).toBe(0)

  await $.tool.call({ tool: TOOL, now: 'n', phase_done: true } as never)
  await complete($)
  expect(calls.instructions.length).toBe(1)
  expect(calls.instructions[0]).toContain('Preserve verbatim')

  // a second boundary inside five minutes does not compact again
  await $.tool.call({ tool: TOOL, now: 'n', phase_done: true } as never)
  await complete($)
  expect(calls.instructions.length).toBe(1)
})

test('below the threshold a boundary does not compact', async ($, on) => {
  engine(on)
  const calls = compactEngine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: TOOL, now: 'n', phase_done: true } as never)
  await complete($)
  expect(calls.instructions.length).toBe(0)
})

test('a compaction stores the note and ends with the resume prompt', async ($, on) => {
  engine(on)
  compactEngine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: TOOL, goal: 'ship', now: 'testing', next: 'review', constraints: 'no writes' } as never)
  await complete($)

  const out = await $.session.compact({ trigger: 'plugin', messages: [{ role: 'user', text: 'hi', toolUses: [] }], instructions: 'keep the plan' })
  const last = out.messages?.[out.messages.length - 1]
  expect(last?.role).toBe('user')
  expect(last?.text.startsWith('Resume on /repo')).toBe(true)
  expect(last?.text).toContain('T-1 · claude')
  expect(last?.text).toContain('T-2 · glm')

  const note = await $.command.run({ command: 'cockpit', args: 'note' } as never)
  expect(note.text).toContain('before compaction (1) — trigger plugin')
  expect(note.text).toContain('goal: ship  now: testing')
  expect(note.text).toContain('- T-2 · glm · feat/b · since 2026-11-05')
  expect((await $.command.run({ command: 'cockpit', args: 'notes' } as never)).text).toContain('before compaction (1)')
})

test('resume prompt without any update still names cwd, command and workers', () => {
  const empty = { goal: '', now: '', done: '', next: '', constraints: '', updatedAt: 0, phaseDone: false }
  const text = resumePrompt('/r', empty, [{ id: 'w1', kind: 'board', provider: 'glm' }])
  expect(text).toContain('Resume on /r. Run /cockpit note')
  expect(text).toContain('w1 · glm')
  expect(text).not.toContain('Goal:')
})

test('layout: empty block shows the placeholder; board rows parse', () => {
  const rows = buildRows({
    block: { goal: '', now: '', done: '', next: '', constraints: '', updatedAt: 0, phaseDone: false },
    gauge: { used: 0, max: 0, percent: 0, measuredAt: 0 },
    workers: [],
    collapsed: false,
    now: 0,
    threshold: 200_000,
    columns: 80,
    maxRows: 12,
  })
  expect(rows.map(r => r.text)).toEqual(['context 0 of 0 ▯▯▯▯▯▯▯▯▯▯ · compacts at 200.0k · not compacted yet', 'now:         (no cockpit_update yet)'])
  expect(parseBoard(BOARD)[1]?.worker).toEqual({ id: 'T-2', kind: 'board', provider: 'glm', branch: 'feat/b', since: '2026-11-05' })
})

test('layout: the expected row follows the threshold, not a fixed percent', () => {
  const at = (used: number, threshold: number) =>
    buildRows({
      block: { goal: '', now: '', done: '', next: '', constraints: '', updatedAt: 0, phaseDone: false },
      gauge: { used, max: 1_000_000, percent: used / 10_000, measuredAt: 0 },
      workers: [],
      collapsed: false,
      now: 0,
      threshold,
      columns: 120,
      maxRows: 12,
    })[0]?.text ?? ''
  expect(at(50_000, 40_000)).toContain('compaction expected at next boundary')
  expect(at(250_000, 300_000)).not.toContain('compaction expected')
})

test('expanding an empty band fills it from the transcript; an update is never overwritten', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'cockpit', args: 'off' } as never)
  await $.command.run({ command: 'cockpit', args: 'on' } as never)

  const ui = await $.ui.mount(BAND(12))
  expect(await ui.find({ type: 'Text', text: /grant Key Vault Reader/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /move secrets/ })).toBeDefined()
  await ui.unmount()

  await $.tool.call({ tool: TOOL, now: 'mine' } as never)
  await $.command.run({ command: 'cockpit', args: 'off' } as never)
  await $.command.run({ command: 'cockpit', args: 'on' } as never)
  const again = await $.ui.mount(BAND(12))
  expect(await again.find({ type: 'Text', text: / mine$/ })).toBeDefined()
  await again.unmount()
})

test('fill parsing: five lines, none is empty, no now means no fill', () => {
  expect(parseFill('- goal: a\nnow: b\ndone: none\nnext: c\nconstraints: None.')).toEqual({ goal: 'a', now: 'b', done: '', next: 'c', constraints: '' })
  expect(parseFill('goal: a')).toBeUndefined()
  expect(fillPrompt([{ role: 'assistant', text: '  ', toolUses: [] } as never])).toBeUndefined()
})

test('/cockpit done marks a boundary that the next turn end compacts at; an update without phase_done clears a mark', async ($, on) => {
  engine(on, 250_000)
  const calls = compactEngine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  await $.tool.call({ tool: TOOL, now: 'n', phase_done: true } as never)
  await $.tool.call({ tool: TOOL, now: 'started the next task' } as never)
  await complete($)
  expect(calls.instructions.length).toBe(0)

  const out = (await $.command.run({ command: 'cockpit', args: 'done' } as never)) as { text: string }
  expect(out.text).toContain('Boundary marked.')
  expect(calls.instructions.length).toBe(0)
  // the model's own update in the next turn does not clear the person's mark
  await $.tool.call({ tool: TOOL, now: 'answering' } as never)
  await complete($)
  expect(calls.instructions.length).toBe(1)
})
