import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CockpitBlock, CockpitGauge, CockpitNote, CockpitWorker } from '../types'
import { buildNote, notesFor, pushNote, resumePrompt, shouldCompact, withPreserve } from './compaction'
import { FILL_SYSTEM, fillPrompt, parseFill } from './fill'
import { EMPTY_BLOCK, EMPTY_GAUGE, buildRows, formatTokens, mergeWorkers, parseBoard } from './layout'

const COMMAND = 'cockpit'
const UPDATE_TOOL = 'mcp__cockpit__cockpit_update'
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const REFRESH_MS = 20_000
const NOTES_KEY = 'cockpit.notes'
const DEFAULT_THRESHOLD = 200_000
const BOARD_SCRIPT = 'tools/task.py'
const NUDGE = 'cockpit: the situation block is stale; call cockpit_update.'
const PROMPT_LINE =
  'Keep the cockpit current. Call cockpit_update when the goal, the current step, what is done, what comes next, or the constraints change. Set phase_done true when a unit of work closes and the next one has not started; any update without it clears the mark. One line per field, no markdown. Never ask the person to run /compact: the cockpit compacts by itself at a phase_done boundary once the context is past the threshold.'
const FIELD = { type: 'string', maxLength: 120 }

const SHAPE = { shape: 'cockpit-1' } as const
const block = atom({ plugin: 'cockpit', key: 'block' } as const, EMPTY_BLOCK, SHAPE)
const gauge = atom({ plugin: 'cockpit', key: 'gauge' } as const, EMPTY_GAUGE, SHAPE)
const workers = atom({ plugin: 'cockpit', key: 'workers' } as const, [] as CockpitWorker[], SHAPE)
const collapsed = atom({ plugin: 'cockpit', key: 'collapsed' } as const, false, SHAPE)
const editsSinceUpdate = atom({ plugin: 'cockpit', key: 'editsSinceUpdate' } as const, 0, SHAPE)

/** Expanding with an empty block fills it from the transcript, so a running session needs no first update. */
async function setCollapsed($: EngineInterface, value: boolean): Promise<void> {
  await update($, collapsed, () => value)
  if (value) return
  await refreshGauge($)
  await fill($)
}

const toggle = async ($: EngineInterface) => setCollapsed($, !(await read($, collapsed)))

/** Haiku states goal/now/done/next/constraints from the transcript; the model's own cockpit_update always wins. */
async function fill($: EngineInterface): Promise<void> {
  if ((await read($, block)).updatedAt > 0) return
  const prompt = fillPrompt(await $.session.messages())
  if (prompt === undefined) return
  $.ui.status('filling…')
  let result
  try {
    result = await $.model.complete({ model: 'haiku', system: FILL_SYSTEM, prompt, maxTokens: 300, effort: 'low', timeoutMs: 30_000 })
  } finally {
    $.ui.status(undefined)
  }
  if (!result.isAnswered) {
    $.ui.log(`cockpit: no fill (${result.reason})`)
    return
  }
  const filled = parseFill(result.text)
  if (filled === undefined) return
  const updatedAt = await $.clock.now()
  // a cockpit_update that landed while Haiku ran is newer: keep it
  await update($, block, prev => (prev.updatedAt > 0 ? prev : { ...prev, ...filled, updatedAt }))
}

async function refreshGauge($: EngineInterface): Promise<void> {
  const breakdown = (await $.session.usage({ breakdown: 'summary' })).context.breakdown
  if (!breakdown) return
  const used = breakdown.totalTokens
  const max = breakdown.rawMaxTokens
  const measuredAt = await $.clock.now()
  await update($, gauge, g => ({ ...g, used, max, percent: max > 0 ? (used / max) * 100 : 0, measuredAt }))
}

// last board read; the timer reuses it so the board script runs once per turn, not every tick
let board: ReturnType<typeof parseBoard> = []

/**
 * Running subagents, plus board rows from `tools/task.py` when `readBoard` and the repo has one.
 * A failed read keeps the last roster.
 */
async function refreshWorkers($: EngineInterface, cwd: string, readBoard: boolean): Promise<void> {
  try {
    if (readBoard) {
      if (await $.fs.exists(`${cwd}/${BOARD_SCRIPT}`)) {
        const run = await $.process.run(['python3', '-I', BOARD_SCRIPT, 'list', '--state', 'claimed'], { cwd })
        if (run.exitCode !== 0) return
        board = parseBoard(run.stdout)
      } else board = []
    }
    const subagents = (await $.agent.list())
      .filter(a => a.status === 'running')
      .map(a => ({
        worker: { id: a.description || a.type, kind: 'subagent' as const },
        names: [a.id, a.teammateId ?? '', a.description],
      }))
    await update($, workers, () => mergeWorkers(board, subagents))
  } catch {
    // keep the last roster
  }
}

/** Turn end reads the board; the timer during a turn reads only usage and subagents. */
async function refresh($: EngineInterface, cwd: string, readBoard: boolean): Promise<void> {
  await refreshGauge($)
  await refreshWorkers($, cwd, readBoard)
}

export const register: Register = (on, options) => {
  const threshold = typeof options.thresholdTokens === 'number' ? options.thresholdTokens : DEFAULT_THRESHOLD
  let cwd = ''
  let isWorking = false
  // a boundary the person marked with /cockpit done: model updates do not clear it, a compaction does
  let isMarkedByPerson = false
  let tick: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    await $.command.register({ name: COMMAND, description: 'Collapse or expand the cockpit band (`on`, `off`); `done` marks a task boundary; expanding fills an empty band from the conversation; `note` prints the latest pre-compaction note, `notes` lists them' })
    await $.tool.register({
      name: 'cockpit_update',
      description:
        'Update the situation block shown above the user\'s prompt. Send only the fields that changed; `now` is required.',
      inputSchema: {
        type: 'object',
        properties: {
          goal: FIELD,
          now: FIELD,
          done: FIELD,
          next: FIELD,
          constraints: FIELD,
          phase_done: { type: 'boolean' },
        },
        required: ['now'],
      },
    })
    tick?.cancel()
    tick = $.clock.every(REFRESH_MS, () => {
      if (isWorking) void refresh($, cwd, false)
    })

    const result = await next(e)
    // the band shows a real number before the first turn ends; a failed read keeps 0%
    await refreshGauge($).catch(() => undefined)
    return result
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const sub = e.args.trim()
    if (sub === 'note' || sub === 'notes') {
      const mine = notesFor(((await $.store.get(NOTES_KEY)) as CockpitNote[] | undefined) ?? [], cwd)
      if (mine.length === 0) return { text: 'No pre-compaction notes for this directory yet.' }

      return { text: sub === 'note' ? (mine[mine.length - 1] as CockpitNote).text : mine.map(n => n.header).join('\n') }
    }
    if (sub === 'done') {
      // the engine refuses a compaction under a command's turn: turn end compacts
      isMarkedByPerson = true
      await update($, block, b => ({ ...b, phaseDone: true }))
      return { text: `Boundary marked. Compacts at the next turn end once the context is past ${formatTokens(threshold)}.` }
    }
    if (sub === 'on' || sub === 'off') await setCollapsed($, sub === 'off')
    else await toggle($)
    return { text: (await read($, collapsed)) ? 'Cockpit collapsed.' : 'Cockpit expanded.' }
  })

  on('prompt.compose', async ($, e, next) => {
    const out = await next(e)

    return { sections: [...out.sections, { id: 'cockpit:update', text: PROMPT_LINE, scope: 'session' as const }] }
  })

  on('tool.call', { tool: UPDATE_TOOL }, async ($, e) => {
    const input = e as unknown as Partial<Record<keyof CockpitBlock | 'phase_done', string | boolean>>
    const text = (k: keyof CockpitBlock, prev: CockpitBlock) => (typeof input[k] === 'string' ? (input[k] as string) : prev[k])
    const updatedAt = await $.clock.now()
    await update($, block, prev => ({
      ...prev,
      goal: text('goal', prev) as string,
      now: text('now', prev) as string,
      done: text('done', prev) as string,
      next: text('next', prev) as string,
      constraints: text('constraints', prev) as string,
      // a mark lasts until the next update: work after it is no longer at the boundary
      phaseDone: input.phase_done === true || isMarkedByPerson,
      updatedAt,
    }))
    await update($, editsSinceUpdate, () => 0)

    return { result: 'ok' }
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (EDIT_TOOLS.has(e.tool)) await update($, editsSinceUpdate, n => n + 1)

    return result
  })

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) isWorking = true

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    isWorking = false
    await refresh($, cwd, true)

    const reply = (await read($, editsSinceUpdate)) > 0 ? { ...result, text: NUDGE } : result
    const compact = shouldCompact({
      block: await read($, block),
      gauge: await read($, gauge),
      threshold,
      now: await $.clock.now(),
    })
    if (compact) {
      try {
        const done = await $.session.compact({ instructions: withPreserve(undefined) })
        // the boundary is spent: the next one needs a new phase_done
        if (!done.skip) {
          const lastCompactionAt = await $.clock.now()
          await update($, gauge, g => ({ ...g, lastCompactionAt }))
          isMarkedByPerson = false
          await update($, block, b => ({ ...b, phaseDone: false }))
        }
      } catch {
        // a turn started or the engine refused: the next boundary tries again
      }
    }

    return reply
  })

  /** Down: preserve list and note (not on precompute). Up: the resume prompt as the last message. */
  on('session.compact', async ($, e, next) => {
    if (e.trigger === 'precompute') return next(e)

    const [b, g, w] = [await read($, block), await read($, gauge), await read($, workers)]
    const all = ((await $.store.get(NOTES_KEY)) as CockpitNote[] | undefined) ?? []
    const note = buildNote({
      cwd,
      trigger: e.trigger,
      n: notesFor(all, cwd).length + 1,
      at: new Date(await $.clock.now()).toISOString(),
      block: b,
      gauge: g,
      workers: w,
    })
    await $.store.set(NOTES_KEY, pushNote(all, note))

    const result = await next({ ...e, instructions: withPreserve(e.instructions) })
    if (result.skip !== undefined) return result

    const lastCompactionAt = await $.clock.now()
    await update($, gauge, x => ({ ...x, lastCompactionAt }))
    const resume = { role: 'user' as const, text: resumePrompt(cwd, b, w), toolUses: [] }

    return { ...result, messages: [...result.messages, resume] }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const isCollapsed = await read($, collapsed)
    const rows = buildRows({
      block: await read($, block),
      gauge: await read($, gauge),
      workers: await read($, workers),
      collapsed: isCollapsed,
      now: await $.clock.now(),
      threshold,
      // round border (2) + paddingX (2) across, border (2) down
      columns: Math.max(10, e.props.bodyColumns - 4),
      maxRows: Math.max(1, e.props.maxRows - 2),
    })
    // other mods (tldr) draw in the same band: stack above them, never replace them
    const rest = await next(e)
    const percent = (await read($, gauge)).percent
    const gaugeColor = percent >= 80 ? 'red' : percent >= 50 ? 'yellow' : 'green'

    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
          {rows.map(row =>
            row.kind === 'gauge' ? (
              <Box key={row.key} justifyContent="space-between">
                <Text wrap="truncate" color={gaugeColor}>
                  {row.text}
                </Text>
                <Button
                  key="collapse"
                  label={isCollapsed ? 'expand' : 'collapse'}
                  // c works only while the band holds the focus, so the label shows no key hint
                  hotkey="c"
                  onPress={() => toggle($)}
                />
              </Box>
            ) : (
              <Text key={row.key} wrap="truncate" dimColor={row.kind === 'worker'}>
                {row.label === undefined ? (
                  row.text
                ) : (
                  // a fragment draws as a Box, which a Text refuses: pass the children as a list
                  [
                    <Text key="label" bold color="cyan">
                      {row.label}
                    </Text>,
                    row.text.slice(row.label.length),
                  ]
                )}
              </Text>
            ),
          )}
        </Box>
        {rest}
      </Box>
    )
  })
}
