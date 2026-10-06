import { expect, test } from 'claude-code/testing'

import { buildPrompt, isWorthSummarising, lastReply, parseArgs, systemPrompt, toLines } from './summarize'

async function band($: never, surface: 'terminal' | 'desktop') {
  return ($ as any).ui.mount({
    plugin: 'tldr',
    surface,
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 80 },
  })
}

/** The host's `$.store`, in memory. */
function stubStore(on: any) {
  const data = new Map<string, unknown>()
  on('store.get', ($: never, e: { key: string }) => ({ value: data.get(e.key) }))
  on('store.set', ($: never, e: { key: string; value: unknown }) => {
    data.set(e.key, e.value)
    return { value: undefined }
  })
}

const msg = (role: 'user' | 'assistant', text: string) => ({ role, text, toolUses: [] })

test('picks the newest assistant reply that has text', () => {
  const messages = [msg('user', 'q'), msg('assistant', 'first'), msg('user', 'q2'), msg('assistant', ''), msg('user', 'r')]
  expect(lastReply(messages as never)).toBe('first')
  expect(lastReply([msg('user', 'only me')] as never)).toBeUndefined()
})

test('extra ask is appended only when given', () => {
  expect(buildPrompt('R', '')).not.toContain('Also:')
  expect(buildPrompt('R', ' one line ')).toContain('Also: one line')
})

test('blank lines are dropped', () => {
  expect(toLines('a\n\n- b  \n')).toEqual(['a', '- b'])
})

test('/tldr draws the summary in the band and leaves nothing for the model', async ($, on) => {
  let prompt = ''
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.messages', () => ({ value: [msg('user', 'q'), msg('assistant', 'long answer')] as never }))
  on('model.complete', ($, e) => {
    prompt = e.prompt
    return { value: { isAnswered: true, text: 'Short.\n\n- one', usage: {} } as never }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.render', { component: 'AbovePrompt' }, () => h('Box', {}) as never)
  stubStore(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const result = await $.command.run({ command: 'tldr', args: '' } as never)
  expect(prompt).toContain('long answer')
  expect(result.text).toBeUndefined()
  expect(result.context).toBeUndefined()
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await band($ as never, surface)
    expect(await ui.find({ type: 'Text', text: 'tl;dr' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '- one' })).toBeDefined()
    await ui.unmount()
  }
})

test('/tldr with no reply yet says so and calls no model', async ($, on) => {
  const logs: string[] = []
  let called = false
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.messages', () => ({ value: [msg('user', 'q')] as never }))
  on('model.complete', () => {
    called = true
    return { value: { isAnswered: true, text: 'x', usage: {} } as never }
  })
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  stubStore(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  await $.command.run({ command: 'tldr', args: '' } as never)
  expect(called).toBe(false)
  expect(logs).toEqual(['tldr: no reply to summarise yet'])
})

test('auto arg and short replies', () => {
  expect(parseArgs(' Auto ')).toEqual({ kind: 'auto' })
  expect(parseArgs('one line')).toEqual({ kind: 'summarise', level: undefined, ask: 'one line' })
  expect(parseArgs('ELI5 one line')).toEqual({ kind: 'summarise', level: 'eli5', ask: 'one line' })
  expect(parseArgs('eli6')).toEqual({ kind: 'summarise', level: undefined, ask: 'eli6' })
  expect(parseArgs('tune ELI5 not childish, just simple')).toEqual({ kind: 'tune', level: 'eli5', feedback: 'not childish, just simple' })
  expect(parseArgs('tune eli5').kind).toBe('usage')
  expect(parseArgs('tune eli6 simpler').kind).toBe('usage')
  expect(parseArgs('reset eli8')).toEqual({ kind: 'reset', level: 'eli8' })
  expect(isWorthSummarising('short')).toBe(false)
  expect(isWorthSummarising('x'.repeat(400))).toBe(true)
})

test('/tldr auto summarises main-loop answers only, after toggling on', async ($, on) => {
  let calls = 0
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('model.complete', () => {
    calls++
    return { value: { isAnswered: true, text: 'Short.', usage: {} } as never }
  })
  on('ui.status', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.start', ($, e) => e as never)
  on('ui.render', { component: 'AbovePrompt' }, () => h('Box', {}) as never)
  stubStore(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const long = 'x'.repeat(500)
  const turn = (extra: object) =>
    $.turn.complete({ answer: long, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', ...extra } as never)

  await turn({})
  expect(calls).toBe(0)

  const toggled = await $.command.run({ command: 'tldr', args: 'auto' } as never)
  expect(toggled.text).toBe('auto on.')
  await turn({ agentId: 'sub' })
  await turn({ answer: 'short' })
  expect(calls).toBe(0)

  await turn({})
  // summarise runs unawaited: let its promise chain settle
  for (let i = 0; i < 50; i++) await Promise.resolve()
  expect(calls).toBe(1)
  const ui = await band($ as never, 'terminal')
  expect(await ui.find({ type: 'Text', text: 'Short.' })).toBeDefined()
  await ui.unmount()
})

test('levels change the wording rules, never the keep-the-paths rule', () => {
  expect(systemPrompt('eli5')).toContain('5-year-old')
  expect(systemPrompt('eli15')).toContain('15-year-old')
  for (const level of ['eli5', 'eli15'] as const) expect(systemPrompt(level)).toContain('verbatim')
  expect(systemPrompt('eli5', { eli5: ' Talk like a pirate. ' })).toContain('Talk like a pirate.')
  expect(systemPrompt('eli5', { eli5: ' Talk like a pirate. ' })).not.toContain('5-year-old')
  expect(systemPrompt('eli5', { eli5: '  ' })).toContain('5-year-old')
})

test('/tldr eli5 remembers the level and summarises with it', async ($, on) => {
  const systems: string[] = []
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.messages', () => ({ value: [msg('user', 'q'), msg('assistant', 'long answer')] as never }))
  on('model.complete', ($, e) => {
    systems.push(e.system ?? '')
    return { value: { isAnswered: true, text: 'Short.', usage: {} } as never }
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  stubStore(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  await $.command.run({ command: 'tldr', args: '' } as never)
  await $.command.run({ command: 'tldr', args: 'eli5' } as never)
  await $.command.run({ command: 'tldr', args: '' } as never)
  expect(systems[0]).toContain('12-year-old')
  expect(systems[1]).toContain('5-year-old')
  expect(systems[2]).toContain('5-year-old')
})

test('a /config override reaches the model', { options: { eli12: 'Use only words of one syllable.' } }, async ($, on) => {
  let system = ''
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.messages', () => ({ value: [msg('user', 'q'), msg('assistant', 'long answer')] as never }))
  on('model.complete', ($, e) => {
    system = e.system ?? ''
    return { value: { isAnswered: true, text: 'Short.', usage: {} } as never }
  })
  on('ui.status', () => ({ value: undefined }))
  stubStore(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  await $.command.run({ command: 'tldr', args: '' } as never)
  expect(system).toContain('Use only words of one syllable.')
})

test('/tldr tune has sonnet rewrite the rules and saves them as the config field', async ($, on) => {
  const calls: { model: string; prompt: string }[] = []
  const saved: { key: string; value: unknown }[] = []
  const logs: string[] = []
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('model.complete', ($, e) => {
    calls.push({ model: String(e.model), prompt: e.prompt })
    return { value: { isAnswered: true, text: ' Use plain adult words. ', usage: {} } as never }
  })
  on('config.set', ($, e) => {
    saved.push({ key: e.key, value: e.value })
    return { value: e.value } as never
  })
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  stubStore(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  await $.command.run({ command: 'tldr', args: 'tune eli5 not childish, just simple' } as never)
  expect(calls[0]?.model).toBe('sonnet')
  expect(calls[0]?.prompt).toContain('5-year-old')
  expect(calls[0]?.prompt).toContain('not childish, just simple')
  expect(saved).toEqual([{ key: 'tldr.eli5', value: 'Use plain adult words.' }])
  expect(logs).toEqual(['tldr: eli5 rules now: Use plain adult words.'])

  await $.command.run({ command: 'tldr', args: 'reset eli5' } as never)
  expect(saved[1]).toEqual({ key: 'tldr.eli5', value: '' })
})
