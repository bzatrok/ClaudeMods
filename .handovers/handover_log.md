# Handover Log — cockpit v1

## Destination
Ben's terminal sessions carry a collapsible situation band above the prompt, the session compacts itself at a task boundary past 200k with a note and resume prompt it writes, and the board every fan-out uses comes from one shared `task-board` skill.

## Intent, verbatim
> "this is the information I need, not like a rolling feed of what the model was writing."

> "automatic compaction and task boundary sounds like basically it automates the stuff that I'm doing by hand only because I have to"

> "maybe these two skills could have like a task board skill that the agents call and they share, so that it's the same format."

## Invariants
See [PROJECT_CONTEXT.md](../cockpit/PROJECT_CONTEXT.md) and the repo `CLAUDE.md` rules. In addition for this effort: the mod folder is `cockpit/`, `$` only in `register.tsx`, `$.state` values declared in `types/index.d.ts`.

## Notes
- Executors of handover 002 and 003 read the `plugin-authoring` skill first. Its types file is the API; grep it, do not guess.
- Executor of handover 001 edits files under `~/.claude/skills`, which is not a git repo. No worktree, no PR. Back up each file it changes to `<file>.bak` before editing.
- Absolute tokens are available: `context-bar/hooks/layout.ts` derives `used` and `max` from `$.session.usage({ breakdown: 'summary' })`.
- Claim gate: OFF for this repo. Install with `~/.claude/hooks/install-review-gate.sh` if wanted.

## Decisions so far
<!-- index only: one line per decision, linking the handover that holds the detail -->
- [task-board-skill](handover_001_task-board-skill.md) — provider recorded as a `provider=<name>` token in Notes, required on claim. Rejected: a new column (breaks the IG2 board header).
- [task-board-skill](handover_001_task-board-skill.md) — the skill ships `scripts/task.py` copied from IG2 and installs it into a repo as `tools/task.py`. Rejected: calling the script from the skill folder (workers in worktrees need it in the repo, committed).
- [situation-band](handover_002_situation-band.md) — one tool `cockpit_update` with five text fields and `phase_done`. Rejected: parsing the model's prose.
- [situation-band](handover_002_situation-band.md) — nudge from `turn.complete` after a turn that edited files without an update. Rejected: nudge per tool call (noise).
- [auto-compaction](handover_003_auto-compaction.md) — the note lives in `$.store`, shown by `/cockpit note`; the resume prompt is injected as the first message after compaction by the `session.compact` hook. Rejected: a file in the repo (the ClaudeMods rule: a mod never writes files); appending to `handover_log.md` (index, not store); asking Ben to paste (what we are removing).
- [auto-compaction](handover_003_auto-compaction.md) — teamwork rule 10 ("the lead cannot trigger compaction") becomes false once the mod loads. Rejected: leaving the rule as is.

## Not yet specified
<!-- in-scope questions you can see coming but cannot yet state sharply -->
- Exact row budget the band gets in a non-fullscreen terminal. Read `maxRows` at render; the executor of 002 reports the numbers.

## Out of scope
<!-- ruled out of this effort, with the reason. It stays ruled out. -->
- The change feed drill-down. Version two, see PROJECT_CONTEXT.
- Changing IG2's live `tools/task.py` beyond what the shared script needs. IG2 is mid-port.

| # | Slug | Goal | Status | Branch | Created | Completed |
|---|------|------|--------|--------|---------|-----------|
| 001 | [task-board-skill](handover_001_task-board-skill.md) | Shared `task-board` skill; teamwork and source-port call it | ⬜ pending | — (no git under ~/.claude) | 2026-11-05 | — |
| 002 | [situation-band](handover_002_situation-band.md) | Band above the prompt: gauge, five lines, collapse, workers | 🔄 in-progress | feat/situation-band | 2026-11-05 | — |
| 003 | [auto-compaction](handover_003_auto-compaction.md) | Compact at a task boundary past 200k with note and resume prompt | ⬜ pending | feat/auto-compaction | 2026-11-05 | — |
