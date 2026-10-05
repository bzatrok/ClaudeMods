import type { SessionContextBreakdown } from 'claude-code'

import type { ContextBarRow, ContextBarSnapshot } from '../types'

/** One run of identical cells in the bar. `color` null is free space. */
export type BarSegment = { color: string | null; text: string; isMarker: boolean }

const FILLED = '█'
export const FREE = '░'
const MARKER = '▏'

/**
 * Our own palette rather than /context's theme colours: several of those are greys
 * (system prompt, system tools) that read as one block beside each other.
 * Known categories keep a fixed colour; any other takes the next unused one.
 */
const CATEGORY_COLORS: Record<string, string> = {
  'system prompt': '#7aa2f7',
  'system tools': '#2ac3de',
  'mcp tools': '#bb9af7',
  'mcp server instructions': '#9d7cd8',
  'custom agents': '#9ece6a',
  'memory files': '#e0af68',
  skills: '#f7768e',
  messages: '#ff9e64',
}
const SPARE_COLORS = ['#73daca', '#b4f9f8', '#c0caf5', '#db4b4b', '#41a6b5', '#ff007c']

export function categoryColors(names: string[]): string[] {
  const taken = new Set(names.map(n => CATEGORY_COLORS[n]).filter(Boolean))
  const spare = SPARE_COLORS.filter(c => !taken.has(c))
  return names.map(n => CATEGORY_COLORS[n] ?? spare.shift() ?? '#c0caf5')
}

export function toSnapshot(breakdown: SessionContextBreakdown): ContextBarSnapshot {
  const used = breakdown.categories.filter(c => c.kind === 'used' && c.tokens > 0)
  const names = used.map(c => c.name.toLowerCase())
  const colors = categoryColors(names)
  const rows: ContextBarRow[] = used.map((c, i) => ({
    name: names[i] ?? c.name,
    tokens: c.tokens,
    color: colors[i] ?? c.color,
  }))

  return {
    used: breakdown.totalTokens,
    max: breakdown.rawMaxTokens,
    compactAt: breakdown.isAutoCompactEnabled ? (breakdown.autoCompactThreshold ?? null) : null,
    rows,
  }
}

/** 512, 3.4k, 212k, 1M, 1.2M — the way /context prints counts. */
/** Exact up to five digits; from 100,000 one fixed decimal, so the width stays steady. */
export function formatTokens(n: number): string {
  if (n < 100_000) return String(Math.round(n))
  if (n < 999_950) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** Under 1% keeps one decimal, so small categories do not all read 0%. */
export function formatShare(tokens: number, max: number): string {
  if (max <= 0) return '0%'
  const pct = (tokens / max) * 100
  // 0.97% rounds to "1.0%" with one decimal; from 0.95% up it reads as a whole percent.
  return pct < 0.95 ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`
}

export function percentColor(percent: number): string {
  if (percent >= 80) return 'red'
  if (percent >= 50) return 'yellow'
  return 'green'
}

/**
 * Lays the snapshot out over `width` cells: each used category gets its share,
 * at least one cell so a small one still shows; the rest is free space, with the
 * compaction threshold drawn as a marker.
 */
export function barSegments(snapshot: ContextBarSnapshot, width: number): BarSegment[] {
  if (width <= 0 || snapshot.max <= 0) return []

  const cells: (string | null)[] = []
  for (const row of snapshot.rows) {
    const share = Math.max(1, Math.round((row.tokens / snapshot.max) * width))
    for (let i = 0; i < share && cells.length < width; i++) cells.push(row.color)
  }
  while (cells.length < width) cells.push(null)

  const markerAt =
    snapshot.compactAt === null
      ? -1
      : Math.min(width - 1, Math.round((snapshot.compactAt / snapshot.max) * width))

  const segments: BarSegment[] = []
  cells.forEach((color, i) => {
    const isMarker = i === markerAt
    const char = isMarker ? MARKER : color === null ? FREE : FILLED
    const last = segments[segments.length - 1]
    if (last && last.color === color && last.isMarker === isMarker) {
      last.text += char
    } else {
      segments.push({ color, text: char, isMarker })
    }
  })

  return segments
}

/** One legend entry: `▌ name 3.4k 0.3%`; free space carries no share. */
export type LegendItem = { color: string | null; name: string; tokens: string; share: string }

export function legendItems(snapshot: ContextBarSnapshot): LegendItem[] {
  const items: LegendItem[] = snapshot.rows.map(row => ({
    color: row.color,
    name: row.name,
    tokens: formatTokens(row.tokens),
    share: formatShare(row.tokens, snapshot.max),
  }))
  const free = Math.max(0, snapshot.max - snapshot.used)
  items.push({ color: null, name: 'free', tokens: formatTokens(free), share: '' })

  return items
}

export function legendItemWidth(item: LegendItem): number {
  // "▌ " + name + " " + tokens + (" " + share) + two-cell gap
  return 2 + item.name.length + 1 + item.tokens.length + (item.share ? 1 + item.share.length : 0) + 2
}

/** Packs legend items into lines no wider than `width`. */
export function legendLines(items: LegendItem[], width: number): LegendItem[][] {
  const lines: LegendItem[][] = []
  let line: LegendItem[] = []
  let used = 0
  for (const item of items) {
    const w = legendItemWidth(item)
    if (line.length > 0 && used + w > width) {
      lines.push(line)
      line = []
      used = 0
    }
    line.push(item)
    used += w
  }
  if (line.length > 0) lines.push(line)

  return lines
}
