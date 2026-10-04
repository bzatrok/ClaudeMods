import { expect, test } from 'claude-code/testing'

import { parseDestination, parseOpenQuestions, parseRows, parseWorktrees, splitBranches } from './parse'

const LOG = `# Handover Log

## Destination

**The active effort is the schema simplification.** Done looks like this: one template.

## Not yet specified

- **Whether hubs scope per entity.** Raised 2026-09-05 while
  scoping something.
- ~~**An answered one.**~~ **Answered 2026-08-27**
- **Where citations come from.** Raised 2026-09-17 by Ben.
- **An undated one.**

## Out of scope

| # | Slug | Goal | Status | Branch | Created | Completed |
|---|------|------|--------|--------|---------|-----------|
| 061 | ↳ hotfix (2026-09-05) | note before its row | ✅ done | hotfix/x | 2026-09-05 | 2026-09-05 |
| 061 | [sync-push](handover_061_sync-push.md) | goal with a | pipe | ✅ done | \`feature/sync-push\` | 2026-09-05 | 2026-09-05 |
| 061 | ↳ note (2026-09-06) | shipped | | | | |
| 059 | [review-loop](handover_059_review-loop.md) | goal | 🔄 in-progress | feature/a → feature/b | 2026-09-05 | — |
| 068 | [next-thing](handover_068_next-thing.md) | goal | ⏳ ready | — | 2026-10-01 | — |
`

test('rows read their status from the right, fold notes, split branches', () => {
  const rows = parseRows(LOG)
  expect(rows.map(r => [r.id, r.state])).toEqual([
    ['061', 'done'],
    ['059', 'in-progress'],
    ['068', 'open'],
  ])
  expect(rows[0]).toMatchObject({ slug: 'sync-push', branches: ['feature/sync-push'], notes: 2, lastNoteDate: '2026-09-06' })
  expect(rows[1]?.branches).toEqual(['feature/a', 'feature/b'])
  expect(rows[2]?.branches).toEqual([])
  expect(splitBranches('`a`, b and c')).toEqual(['a', 'b', 'c'])
})

test('destination is its first sentence, questions newest first without answered ones', () => {
  expect(parseDestination(LOG)).toBe('The active effort is the schema simplification.')
  expect(parseOpenQuestions(LOG)).toEqual([
    { title: 'Where citations come from.', raised: '2026-09-17' },
    { title: 'Whether hubs scope per entity.', raised: '2026-09-05' },
    { title: 'An undated one.', raised: null },
  ])
})

test('worktrees keep only those on a branch', () => {
  const porcelain = 'worktree /r\nHEAD 1\nbranch refs/heads/main\n\nworktree /r/.wt/a\nHEAD 2\nbranch refs/heads/feature/a\n\nworktree /r/.wt/d\nHEAD 3\ndetached\n'
  expect(parseWorktrees(porcelain)).toEqual([
    { path: '/r', branch: 'main' },
    { path: '/r/.wt/a', branch: 'feature/a' },
  ])
})

/** A repo where only `develop` has the log, feature/a is merged and feature/b is two ahead. */
function fakeGit(argv: readonly string[]): { exitCode: number; stdout: string } {
  const a = argv.slice(1).join(' ')
  const ok = (stdout = '') => ({ exitCode: 0, stdout })
  const fail = { exitCode: 1, stdout: '' }
  if (a === 'rev-parse --show-toplevel') return ok('/r/Repo')
  if (a.startsWith('log -1 --format=%ct %cr develop')) return ok('200 2 weeks ago')
  if (a.startsWith('log -1 --format=%ct %cr main')) return ok('100 3 weeks ago')
  if (a.startsWith('log -1 --format=%ct %cr')) return fail
  if (a === 'show develop:.handovers/handover_log.md') return ok(LOG)
  if (a.startsWith('rev-parse --verify --quiet refs/heads/')) {
    return ['main', 'develop', 'feature/a', 'feature/b'].includes(a.split('refs/heads/')[1] ?? '') ? ok() : fail
  }
  if (a === 'worktree list --porcelain') {
    return ok('worktree /r/Repo\nHEAD 1\nbranch refs/heads/main\n\nworktree /r/Repo/.wt/a\nHEAD 2\nbranch refs/heads/feature/a\n')
  }
  if (a === 'merge-base --is-ancestor feature/a main') return ok()
  if (a.startsWith('merge-base --is-ancestor')) return fail
  if (a === 'rev-list --count main..feature/b') return ok('2')
  if (a.startsWith('rev-list --count')) return ok('0')
  if (a.startsWith('log -1 --format=%cr')) return ok('3 days ago')
  if (a === 'rev-parse --abbrev-ref HEAD') return ok('main')
  if (a === 'status --porcelain') return ok(' M x\n?? y')
  if (a === 'rev-list --left-right --count main...develop') return ok('1\t8')
  if (a.startsWith('ls-tree')) return ok('.handovers/parked/Drop.cs.txt')
  return fail
}

test('/handover-report summarises the log and draws the pane', async ($, on) => {
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/r/Repo' }))
  on('clock.now', () => ({ value: 0 }))
  on('ui.open', ($, e) => ({ value: { id: e.id } }) as never)
  on('process.run', ($, e) => ({
    value: { ...fakeGit(e.argv), stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))

  await $.session.start({ cwd: '/r/Repo', surface: 'terminal', isInteractive: true })
  const result = await $.command.run({ command: 'handover-report', args: '' } as never)

  expect(result.text).toBe(
    'Handover report for Repo (log on develop, 2 weeks ago): 2 open — 059 review-loop (🔄 in-progress); ' +
      '068 next-thing (⏳ ready); 1 done; 3 open questions; 1/1 worktrees already merged.',
  )

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'handover-report',
      surface,
      component: 'Pane',
      requestId: 'handover-report',
      props: { title: 'Handovers', bodyColumns: 100 } as never,
    })
    expect(await ui.find({ type: 'Text', text: /merged into mainline/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /2 ahead of mainline/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /8 ahead, 1 behind/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /2 uncommitted/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Drop\.cs\.txt/ })).toBeDefined()
    await ui.unmount()
  }
})
