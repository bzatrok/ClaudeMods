import type { HandoverQuestion, HandoverRow, HandoverState, HandoverWorktree } from '../types'

const ROW_ID = /^\d{3}[a-z]?$/
const DATE = /(\d{4}-\d{2}-\d{2})/

/** Splits a markdown table line into trimmed cells, leading and trailing pipes dropped. */
function cells(line: string): string[] {
  return line.split('|').slice(1, -1).map(c => c.trim())
}

export function stateOf(status: string): HandoverState {
  if (/🔄|in[- ]progress/i.test(status)) return 'in-progress'
  // Closed without shipping still is not open work.
  if (/✅|done|superseded|abandoned|cancel|dropped/i.test(status)) return 'done'
  return 'open'
}

/** `feature/a → feature/b`, `a, b`, backticks: every branch named in the cell. */
export function splitBranches(cell: string): string[] {
  return cell
    .replace(/`/g, '')
    .split(/→|,|\s+and\s+/)
    .map(b => b.trim())
    .filter(b => b !== '' && b !== '—' && b !== '-')
}

/**
 * Reads the tracker table (`# | Slug | Goal | Status | Branch | Created | Completed`).
 * The Goal cell may hold pipes, so the last four cells are read from the right.
 * `↳` rows are notes on the row with the same number, and may sit before it.
 */
export function parseRows(log: string): HandoverRow[] {
  const rows: HandoverRow[] = []
  const notes = new Map<string, string[]>()

  for (const line of log.split('\n')) {
    if (!line.startsWith('|')) continue
    const c = cells(line)
    const id = c[0] ?? ''
    if (!ROW_ID.test(id) || c.length < 7) continue
    const slugCell = c[1] ?? ''

    if (slugCell.startsWith('↳')) {
      notes.set(id, [...(notes.get(id) ?? []), slugCell])
      continue
    }

    const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(slugCell)
    const status = c[c.length - 4] ?? ''
    rows.push({
      id,
      slug: link?.[1] ?? slugCell,
      file: link?.[2] ?? null,
      status,
      state: stateOf(status),
      branches: splitBranches(c[c.length - 3] ?? ''),
      created: c[c.length - 2] ?? '',
      completed: c[c.length - 1] ?? '',
      notes: 0,
      lastNoteDate: null,
    })
  }

  return rows.map(row => {
    const own = notes.get(row.id) ?? []
    const dates = own.map(n => DATE.exec(n)?.[1]).filter((d): d is string => d !== undefined)
    return { ...row, notes: own.length, lastNoteDate: dates.sort().at(-1) ?? null }
  })
}

/** The body of a `## <heading>` section, up to the next `## `. */
function section(log: string, heading: string): string | null {
  const lines = log.split('\n')
  const start = lines.findIndex(l => l.trim() === `## ${heading}`)
  if (start === -1) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(l => l.startsWith('## '))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n')
}

function plain(text: string): string {
  return text.replace(/\*\*|`|~~/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim()
}

/** The Destination's first sentence: what "done" looks like for the active effort. */
export function parseDestination(log: string): string | null {
  const body = section(log, 'Destination')
  if (body === null) return null
  const paragraph = body.split(/\n\s*\n/).map(p => p.trim()).find(p => p !== '')
  if (!paragraph) return null
  const text = plain(paragraph)
  const sentence = /^.+?[.!?](?=\s|$)/.exec(text)?.[0] ?? text

  return sentence
}

/**
 * `## Not yet specified`: one bullet per question, its title in bold.
 * A struck-through title (`- ~~**...**~~`) is answered and left out.
 * Newest first by the `Raised YYYY-MM-DD` date in its text; undated last.
 */
export function parseOpenQuestions(log: string): HandoverQuestion[] {
  const body = section(log, 'Not yet specified')
  if (body === null) return []

  const bullets: string[] = []
  for (const line of body.split('\n')) {
    if (line.startsWith('- ')) bullets.push(line)
    else if (bullets.length > 0 && line.startsWith(' ')) bullets[bullets.length - 1] += ` ${line.trim()}`
  }

  return bullets
    .filter(b => b.startsWith('- **'))
    .map(b => ({
      title: plain(/^- \*\*(.+?)\*\*/.exec(b)?.[1] ?? b.slice(2)),
      raised: /Raised (\d{4}-\d{2}-\d{2})/.exec(b)?.[1] ?? null,
    }))
    .sort((a, b) => (b.raised ?? '').localeCompare(a.raised ?? ''))
}

/** `git worktree list --porcelain`: each worktree with the branch it has checked out. */
export function parseWorktrees(porcelain: string): HandoverWorktree[] {
  return porcelain
    .split(/\n\s*\n/)
    .map(block => {
      const path = /^worktree (.+)$/m.exec(block)?.[1]
      const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1]
      return path && branch ? { path, branch } : null
    })
    .filter((w): w is HandoverWorktree => w !== null)
}
