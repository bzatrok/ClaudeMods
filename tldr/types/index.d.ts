/** The TL;DR as drawn in the band above the prompt, one entry per line. */
export type TldrSummary = string[]

declare module 'claude-code' {
  interface PluginState {
    tldr: { isAuto: boolean; summary: TldrSummary | null }
  }
}
