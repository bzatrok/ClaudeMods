import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { HandoverBranch, HandoverOpenItem, HandoverReport, HandoverWorktree } from '../types'
import { parseDestination, parseOpenQuestions, parseRows, parseWorktrees } from './parse'

const COMMAND = 'handover-report'
const PANE = 'handover-report'
const QUESTIONS_SHOWN = 5
const WORKTREES_SHOWN = 6

const LOG_PATH = '.handovers/handover_log.md'
const PARKED_PATH = '.handovers/parked/'
// Handovers live on trunk; the freshest copy of the log among these wins.
const LOG_REFS = ['develop', 'main', 'master', 'HEAD']

async function git($: EngineInterface, cwd: string, ...args: string[]): Promise<{ ok: boolean; out: string }> {
  const r = await $.process.run(['git', ...args], { cwd, timeoutMs: 15_000 })
  return { ok: r.exitCode === 0, out: r.stdout.trim() }
}

/** The ref whose last commit to the log is newest, so a stale checkout does not hide new rows. */
async function freshestLogRef($: EngineInterface, root: string): Promise<{ ref: string; age: string } | null> {
  let best: { ref: string; at: number; age: string } | null = null
  for (const ref of LOG_REFS) {
    const r = await git($, root, 'log', '-1', '--format=%ct %cr', ref, '--', LOG_PATH)
    if (!r.ok || r.out === '') continue
    const [at, ...age] = r.out.split(' ')
    const when = Number(at)
    if (best === null || when > best.at) best = { ref, at: when, age: age.join(' ') }
  }
  return best && { ref: best.ref, age: best.age }
}

async function firstExisting($: EngineInterface, root: string, names: string[]): Promise<string | null> {
  for (const name of names) {
    if ((await git($, root, 'rev-parse', '--verify', '--quiet', `refs/heads/${name}`)).ok) return name
  }
  return null
}

async function branchState(
  $: EngineInterface,
  root: string,
  name: string,
  mainline: string | null,
  worktrees: HandoverWorktree[],
): Promise<HandoverBranch> {
  const worktree = worktrees.find(w => w.branch === name)?.path ?? null
  const exists = (await git($, root, 'rev-parse', '--verify', '--quiet', `refs/heads/${name}`)).ok
  if (!exists) return { name, exists, isMerged: false, ahead: 0, lastCommit: null, worktree }

  const isMerged = mainline !== null && (await git($, root, 'merge-base', '--is-ancestor', name, mainline)).ok
  const ahead = mainline === null ? 0 : Number((await git($, root, 'rev-list', '--count', `${mainline}..${name}`)).out) || 0
  const lastCommit = (await git($, root, 'log', '-1', '--format=%cr', name)).out || null

  return { name, exists, isMerged, ahead, lastCommit, worktree }
}

/** Reads the log and asks git about everything it names. Read-only: no fetch, no writes. */
async function gather($: EngineInterface, now: number): Promise<HandoverReport> {
  const cwd = await $.session.cwd()
  const top = await git($, cwd, 'rev-parse', '--show-toplevel')
  if (!top.ok) return { kind: 'missing', reason: `${cwd} is not inside a git repository.` }

  const root = top.out
  const source = await freshestLogRef($, root)
  if (source === null) return { kind: 'missing', reason: `No ${LOG_PATH} committed in ${root}.` }

  const log = (await git($, root, 'show', `${source.ref}:${LOG_PATH}`)).out
  const rows = parseRows(log)
  const mainline = await firstExisting($, root, ['main', 'master'])
  const worktrees = parseWorktrees((await git($, root, 'worktree', 'list', '--porcelain')).out)

  const open = await Promise.all(
    rows
      .filter(r => r.state !== 'done')
      .map(async row => ({
        row,
        branches: await Promise.all(row.branches.map(b => branchState($, root, b, mainline, worktrees))),
      })),
  )

  // A worktree whose branch is already in the mainline holds nothing left to ship.
  const staleWorktrees: HandoverWorktree[] = []
  for (const w of worktrees) {
    if (w.path === root || w.branch === mainline || mainline === null) continue
    if ((await git($, root, 'merge-base', '--is-ancestor', w.branch, mainline)).ok) staleWorktrees.push(w)
  }

  const done = rows.filter(r => r.state === 'done')
  const branch = (await git($, root, 'rev-parse', '--abbrev-ref', 'HEAD')).out
  const status = (await git($, root, 'status', '--porcelain')).out
  const trunk = source.ref === 'HEAD' ? branch : source.ref

  let trunkDrift: { name: string; ahead: number; behind: number } | null = null
  if (mainline !== null && trunk !== mainline) {
    const counts = (await git($, root, 'rev-list', '--left-right', '--count', `${mainline}...${trunk}`)).out.split(/\s+/)
    trunkDrift = { name: trunk, behind: Number(counts[0]) || 0, ahead: Number(counts[1]) || 0 }
  }

  const parked = (await git($, root, 'ls-tree', '--name-only', source.ref, PARKED_PATH)).out
    .split('\n')
    .filter(p => p !== '')
    .map(p => p.slice(PARKED_PATH.length))

  return {
    kind: 'report',
    repo: root.split('/').at(-1) ?? root,
    source: source.ref,
    sourceAge: source.age,
    destination: parseDestination(log),
    open,
    doneCount: done.length,
    lastDone: done.reduce<(typeof done)[number] | null>(
      (latest, r) => (latest === null || r.id > latest.id ? r : latest),
      null,
    ),
    questions: parseOpenQuestions(log),
    checkout: { branch, dirty: status === '' ? 0 : status.split('\n').length },
    trunk,
    trunkDrift,
    worktrees: worktrees.filter(w => w.path !== root).length,
    staleWorktrees,
    parked,
    generatedAt: now,
  }
}

const report = atom({ plugin: 'handover-report', key: 'report' } as const, null as HandoverReport | null)
const isLoading = atom({ plugin: 'handover-report', key: 'isLoading' } as const, false)

async function refresh($: EngineInterface): Promise<HandoverReport> {
  await update($, isLoading, () => true)
  try {
    const next = await gather($, await $.clock.now())
    await update($, report, () => next)
    return next
  } finally {
    await update($, isLoading, () => false)
  }
}

/** The transcript line: the model reads it too, so it carries the open rows by number. */
export function summarize(r: HandoverReport): string {
  if (r.kind === 'missing') return `Handover report: ${r.reason}`
  const open = r.open.map(o => `${o.row.id} ${o.row.slug} (${o.row.status})`).join('; ')
  return [
    `Handover report for ${r.repo} (log on ${r.source}, ${r.sourceAge}):`,
    `${r.open.length} open${open ? ` — ${open}` : ''};`,
    `${r.doneCount} done; ${r.questions.length} open questions;`,
    `${r.staleWorktrees.length}/${r.worktrees} worktrees already merged.`,
  ].join(' ')
}

function branchLine(b: HandoverBranch): string {
  if (!b.exists) return 'no local branch'
  const parts = [b.isMerged ? 'merged into mainline' : `${b.ahead} ahead of mainline`]
  if (b.lastCommit) parts.push(`last commit ${b.lastCommit}`)
  if (b.worktree) parts.push('has worktree')
  return parts.join(' · ')
}

function relative(path: string, root: string): string {
  const at = path.indexOf(`/${root}/`)
  return at === -1 ? path : path.slice(at + root.length + 2)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Show open handovers, their branches and the state of the handover log',
    })
    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    void $.ui.open({ id: PANE, title: 'Handovers', focus: true, closeOnEscape: true })
    const r = await refresh($)
    return { text: summarize(r) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const r = await read($, report)
    const loading = await read($, isLoading)

    if (r === null) return <Text dimColor>Reading the handover log…</Text>
    if (r.kind === 'missing') return <Text color="yellow">{r.reason}</Text>

    const heading = (label: string, count?: number) => (
      <Box marginTop={1}>
        <Text bold>{label}</Text>
        {count !== undefined && <Text dimColor> {count}</Text>}
      </Box>
    )

    const openItem = (item: HandoverOpenItem) => (
      <Box flexDirection="column">
        <Text wrap="truncate">
          <Text color={item.row.state === 'in-progress' ? 'yellow' : 'cyan'} bold>
            {item.row.id}
          </Text>
          <Text> {item.row.slug} </Text>
          <Text dimColor>{item.row.status}</Text>
        </Text>
        <Text dimColor wrap="truncate">
          {'    '}created {item.row.created}
          {item.row.notes > 0 &&
            ` · ${item.row.notes} note${item.row.notes === 1 ? '' : 's'}, last ${item.row.lastNoteDate ?? '?'}`}
        </Text>
        {item.branches.map(b => (
          <Text wrap="truncate">
            {'    '}
            <Text color={b.isMerged ? 'green' : b.exists ? 'white' : 'red'}>{b.name}</Text>
            <Text dimColor> {branchLine(b)}</Text>
          </Text>
        ))}
      </Box>
    )

    const drift = r.trunkDrift
    return (
      <Box flexDirection="column">
        <Box justifyContent="space-between">
          <Text wrap="truncate">
            <Text bold>{r.repo}</Text>
            <Text dimColor>
              {' '}
              · log on {r.source}, {r.sourceAge}
            </Text>
          </Text>
          <Button key="refresh" label={loading ? 'Reading…' : 'Refresh'} hotkey="r" onPress={() => refresh($)} />
        </Box>
        {r.destination && (
          <Text wrap="wrap">
            <Text dimColor>Destination </Text>
            {r.destination}
          </Text>
        )}

        {heading('Open', r.open.length)}
        {r.open.length === 0 && <Text color="green">Nothing open.</Text>}
        {r.open.map(openItem)}
        <Text dimColor wrap="truncate">
          {r.doneCount} done
          {r.lastDone && ` · latest ${r.lastDone.id} ${r.lastDone.slug} (${r.lastDone.completed || r.lastDone.created})`}
        </Text>

        {heading('Open questions', r.questions.length)}
        {r.questions.slice(0, QUESTIONS_SHOWN).map(q => (
          <Text wrap="truncate">
            <Text dimColor>{q.raised ?? '          '} </Text>
            {q.title}
          </Text>
        ))}
        {r.questions.length > QUESTIONS_SHOWN && (
          <Text dimColor>…and {r.questions.length - QUESTIONS_SHOWN} more in "Not yet specified"</Text>
        )}

        {heading('Repository')}
        <Text wrap="truncate">
          <Text dimColor>checkout </Text>
          {r.checkout.branch}
          <Text color={r.checkout.dirty > 0 ? 'yellow' : 'green'}>
            {r.checkout.dirty > 0 ? ` · ${r.checkout.dirty} uncommitted` : ' · clean'}
          </Text>
        </Text>
        {drift && (
          <Text wrap="truncate">
            <Text dimColor>{drift.name} vs mainline </Text>
            {drift.ahead} ahead, {drift.behind} behind
          </Text>
        )}
        <Text wrap="truncate">
          <Text dimColor>worktrees </Text>
          {r.worktrees}
          {r.staleWorktrees.length > 0 && (
            <Text color="yellow"> · {r.staleWorktrees.length} already merged (cleanup candidates)</Text>
          )}
        </Text>
        {r.staleWorktrees.slice(0, WORKTREES_SHOWN).map(w => (
          <Text dimColor wrap="truncate">
            {'    '}
            {relative(w.path, r.repo)}
          </Text>
        ))}
        {r.staleWorktrees.length > WORKTREES_SHOWN && (
          <Text dimColor>
            {'    '}…and {r.staleWorktrees.length - WORKTREES_SHOWN} more
          </Text>
        )}
        {r.parked.length > 0 && (
          <Text wrap="truncate">
            <Text dimColor>parked </Text>
            {r.parked.join(', ')}
          </Text>
        )}
      </Box>
    )
  })
}
