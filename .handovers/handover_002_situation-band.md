# Handover 002 — situation band

**Branch:** `feat/situation-band` (create)  ·  **Author:** cockpit design session, 2026-11-05  ·  **Status:** pending
**Log:** [handover_log.md](handover_log.md)
**Serves:** the always-on orientation: gauge plus goal, now, done, next, constraints, and the worker roster, above the prompt in every tab.
**Scope:** Build the mod skeleton and the band in `~/prod/ClaudeMods/cockpit/`. No compaction logic (handover 003). The mod loads in every session through `CLAUDE_CODE_PLUGIN_DIRS`; a new session picks it up, no settings change.

## 0. Shared context (read first)
- Read [PROJECT_CONTEXT.md](../cockpit/PROJECT_CONTEXT.md), the log, and the repo `CLAUDE.md` (mod rules: `$` only in `register.tsx`, pure logic in sibling `.ts` files, the mod never writes files).
- `context-bar/hooks/register.tsx` and `layout.ts` are the house example: `$.session.usage({ breakdown: 'summary' })` is free, and `toSnapshot` turns the breakdown into `used` and `max` tokens. Copy that approach; do not import across mod folders.
- Load the `plugin-authoring` skill before writing a line. Its types file is the API. Grep it for every name below; this doc names what exists, the types file gives the exact shape.
- Claim gate: OFF.

| Concern | Where |
|---|---|
| Band drawing | `ui.render` hook on `{ component: 'AbovePrompt' }`; props `maxRows`, `bodyColumns`, `isWorking`, `hasSurvey`. Example `examples/band.tsx` and its contract `band-state.d.ts` in the skill folder |
| Context fill | `$.session.usage({ breakdown: 'summary' })` → `used`/`max` tokens as `context-bar/hooks/layout.ts` derives them |
| Model-written state | `$.tool.register({ name, description, inputSchema })` in `session.start`; handled by a `tool.call` hook on that tool name |
| System-prompt line | `prompt.compose` hook: `next(e)` then add one section last, `scope: 'session'` |
| Turn end | `turn.complete` hook; may return `{ text }` (one line, shown to the model) |
| Workers | `$.agent.list()` for Claude subagents; `$.process.spawn({ argv: ['python3','-I','tools/task.py','list','--state','claimed'] })` for board rows (output format from handover 001: tab-separated ID, Owner, Branch, provider, Updated; no header) |
| Timer | `$.clock.every(ms, fn)` |
| State | `atom`/`read`/`update` over `$.state`, every key declared in `types/index.d.ts` under the mod's name |
| Command | `$.command.register({ name: 'cockpit', description })` + `command.run` hook |

## 1 — Skeleton  *(DECIDED)*
Files under `cockpit/`: `.claude-plugin/plugin.json` (`name: "cockpit"`, `version: "0.1.0"`, `types: "./types/index.d.ts"`), `hooks/hooks.json` (`{ "modules": ["./register.tsx"] }`), `hooks/register.tsx` (everything that touches `$`), `hooks/layout.ts` (pure: row building, truncation, drop order), `types/index.d.ts`, `hooks/cockpit.test.ts`, `tsconfig.json` copied from `context-bar/`.
From the repo root, `claude plugin validate cockpit` passes before anything else is written.

## 2 — State contract  *(DECIDED)*
`PluginState.cockpit`:
- `block: { goal, now, done, next, constraints: string; updatedAt: number; phaseDone: boolean }` — all strings default `""`.
- `gauge: { used: number; max: number; percent: number; lastCompactionAt?: number; measuredAt: number }`.
- `workers: Array<{ id: string; kind: 'board' | 'subagent'; provider?: string; branch?: string; since?: string }>`.
- `collapsed: boolean` (default false).
- `editsSinceUpdate: number`.
Use `shape` (see `reference.md` in the skill) so a reload with older stored values does not throw.

## 3 — The tool the model writes with  *(DECIDED)*
Register `cockpit_update` in `session.start`. Schema: `{ goal?, now, done?, next?, constraints?: string (each ≤ 120 chars), phase_done?: boolean }`, `now` required. The `tool.call` hook stores the fields it received, keeps the others, sets `updatedAt`, resets `editsSinceUpdate`, and returns a one-word result `ok`. It never calls `next(e)` through to the engine; the tool is the mod's own.

## 4 — System-prompt line  *(DECIDED)*
`prompt.compose` adds one section, last, scope session:
"Keep the cockpit current. Call cockpit_update when the goal, the current step, what is done, what comes next, or the constraints change. Set phase_done true when a unit of work closes and the next one has not started. One line per field, no markdown."

## 5 — Nudge  *(DECIDED)*
`tool.call` on `Edit`, `Write`, `MultiEdit`, `NotebookEdit`: after `next(e)`, increment `editsSinceUpdate`.
`turn.complete`: if `editsSinceUpdate > 0` and the block was not updated this turn, return `{ text: "cockpit: the situation block is stale; call cockpit_update." }`. Otherwise `next(e)`.

## 6 — Gauge  *(DECIDED)*
Refresh `gauge` (`used`, `max`, `percent`) from `$.session.usage({ breakdown: 'summary' })` on `turn.complete` and every 20 s while `isWorking` (start the timer in `session.start`, keep its handle in a module variable). `lastCompactionAt` is set by a `session.compact` hook that only observes (`next(e)` then stamp). Handover 003 extends that hook; keep it in one function.

## 7 — Workers  *(DECIDED)*
Refresh on `turn.complete` and on the same timer:
- Board: if `tools/task.py` exists under the session cwd (`$.fs` stat or a failed read), spawn the list command and parse rows. On any failure, keep the last roster and set nothing else.
- Subagents: `$.agent.list()`, running ones only, `kind: 'subagent'`.
Merge: board rows first, then subagents whose id matches no board Owner.

## 8 — Drawing  *(DECIDED)*
Expanded, top to bottom, each one row, truncated to `bodyColumns`:
1. `ctx 14% ▮▮▯▯▯▯▯▯▯▯ · compacted 23m ago · 2 workers` — bar of ten cells; when `percent ≥ 20` append ` · compaction expected at next boundary`; when `lastCompactionAt` is unset write `not compacted yet`.
2. `goal  <text>` 3. `now   <text>` 4. `done  <text>` 5. `next  <text>` 6. `constraints  <text>`
7. One row per worker: `worker <id> · <provider> · <branch> · since <Updated>`, at most 4 rows, then `+n more`.
Collapsed: rows 1 and 3 only.
Empty block (no update yet): row 1 and `now   (no cockpit_update yet)`.
If the tree would exceed `maxRows`, drop worker rows first, then `constraints`, then `done`.
`hasSurvey` true → `next(e)`.
A `Button` with hotkey `c` and label `[c] collapse` / `[c] expand` on row 1's right end toggles `collapsed`; `/cockpit` does the same.

## 9 — Test  *(DECIDED)*
`hooks/cockpit.test.ts` with `claude plugin test cockpit`: seed `$.state.cockpit` with a block and two workers, render `AbovePrompt` at `maxRows: 12` and `bodyColumns: 80`, assert the six text rows and two worker rows; render at `maxRows: 3`, assert rows 1–3 only; call `cockpit_update` and assert the state; run `turn.complete` after an Edit without an update and assert the nudge text.

## Sequencing
1 → 2 → 3 → 8 (static block) → 6 → 7 → 4 → 5 → 9. Validate and type-check after each step. context-bar stays as it is; it is hidden by default and does not collide.

## Decisions — locked ✅
- Band, not pane — chose it because Ben's tabs are narrow and a pane docks only from 110 columns in fullscreen.
- Tool call, not prose parsing — chose it because the fields arrive structured and the model already holds the state.
- Nudge at turn end, not per edit — chose it to keep noise out of the transcript.
- Board via the script's `list` output — chose it over parsing `TASKS.md` so the format is owned in one place (handover 001).
- Drop order under pressure: workers, constraints, done — chose it because now and next are what a late joiner needs most.

## Out of scope for this handover
- Compaction, the note, the resume prompt: handover 003.
- The change feed drill-down: version two.
- Mobile presentation: open in PROJECT_CONTEXT.

## Acceptance / pre-merge checklist
- `claude plugin validate cockpit` clean. `npx -p typescript@5 tsc -p cockpit` clean once types are laid. `claude plugin test cockpit` green.
- In a new session (the folder auto-loads) in a terminal at least 100 columns wide: the band shows, `c` collapses, a `cockpit_update` call from the model fills the five rows, an Edit without an update produces the nudge at turn end.
- In `~/dev/IG2.iOS` with a claimed row: the worker row shows with its provider.
- Report the `maxRows` seen in a non-fullscreen 40-row terminal in the completion note (closes a Not yet specified line).

---
**On completion:**
1. Update `.handovers/handover_log.md`. Set this handover's status to ✅ done and fill in the Completed date. If you could not finish, set 🔄 in-progress and add a note row that describes what remains.
2. Add each locked decision to the log's **Decisions so far**. One line: the gist plus the rejected alternative, linking this doc by name.
3. Move anything this work made sharp out of **Not yet specified**. Move anything it ruled out into **Out of scope**.
4. Commit, push the branch, and open the PR.
