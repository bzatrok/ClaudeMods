import { expect, test } from 'claude-code/testing'

import { buildPrompt, lastReply, toLines } from './summarize'

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

test('/tldr logs the summary and leaves nothing for the model', async ($, on) => {
  const logs: string[] = []
  let prompt = ''
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.messages', () => ({ value: [msg('user', 'q'), msg('assistant', 'long answer')] as never }))
  on('model.complete', ($, e) => {
    prompt = e.prompt
    return { value: { isAnswered: true, text: 'Short.\n\n- one', usage: {} } as never }
  })
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const result = await $.command.run({ command: 'tldr', args: '' } as never)
  expect(prompt).toContain('long answer')
  expect(logs).toEqual(['TL;DR', 'Short.', '- one'])
  expect(result.text).toBeUndefined()
  expect(result.context).toBeUndefined()
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
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  await $.command.run({ command: 'tldr', args: '' } as never)
  expect(called).toBe(false)
  expect(logs).toEqual(['tldr: no reply to summarise yet'])
})
