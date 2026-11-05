# Project Context — cockpit

<!-- The project map. Outlives every effort in .handovers/. -->
<!-- Write standing conditions, not current status. See ~/.claude/skills/project-context. -->

## Destination
A Claude Code mod that keeps Ben oriented in every terminal tab: where the session stands (goal, now, done, next, constraints), how full the context is and when it last compacted, which workers run, and that compacts the session itself at a task boundary with a note that survives the compaction. It replaces what Ben does by hand today: typing `/compact`, asking for a post-compact message, and pasting it back.

## Intent, verbatim
> "what I really want to see is, as the AI is working, as you are working, I would want to see what files it's looking at, what modifications it's adding, and preferably I would want to have like a small explanation next to the reasoning for each modification"

> "I would want to have like a well-managed set of sessions where it's always clear what we're doing, you know, the big picture and also the drill down image."

> "this is the information I need, not like a rolling feed of what the model was writing."

> "I just want to know where I am currently on the context that we have. Like, you know, 0 to 1 million, where do we stand?"

> "automatic compaction and task boundary sounds like basically it automates the stuff that I'm doing by hand only because I have to"

> "Keep track of the workers and teamwork, because often they keep running while compaction happens, and the post-compaction state picks up their responses."

> "I would prefer if all repos got a board that used teamwork."

> "200K is a sensible threshold. Like, you know, it's not a hard limit. So if a task is long running and keeps going until, I don't know, 200-300K, that's also okay. But it should be an expected compaction at that point."

## Stakeholders
- Ben — the only user. Works in the terminal about 95% of the time, steers from the mobile app, keeps many narrow terminal tabs side by side.
- The `teamwork` and `source-port` skills — produce the worker rows the cockpit shows. They share the board through the `task-board` skill.
- The `handover-workflow` skill — owns cold handoffs to a fresh agent. The cockpit's compaction note is a lighter cousin and does not replace it.

## Invariants
- The always-on surface is the band above the prompt, never a sidebar. Ben's tabs are too narrow to dock a pane.
- The band is a situation block that is rewritten, not a feed that is appended. A reader who joins ten minutes late reads it once.
- The block is collapsible to two rows: the gauge and the "now" line.
- The main model writes the block through a tool call. No sidecar model summarises the transcript.
- Compaction is expected from 200k tokens and fires at a task boundary. It is never forced by the mod at a number; the engine's own auto-compact stays the backstop.
- Every compaction, manual or automatic, produces the note and the resume prompt. Ben never types "give me a post compact message" again.
- The note carries the worker roster, because workers keep running through compaction and the post-compaction session must expect their reports.
- Workers are read from the repo's board (`TASKS.md` through `task.py`), which lives in the repo and is committed by the script. Not from a global folder: that would break the board's git sync between Ben's machines.
- The mod has no DOM or Node. Everything outside it goes through `$`.
- The mod never writes files (ClaudeMods repo rule). The compaction note lives in `$.store`; the resume prompt goes into the conversation.
- The mod lives in `~/prod/ClaudeMods/cockpit/` beside context-bar, handover-report and tldr, and loads through `CLAUDE_CODE_PLUGIN_DIRS`.

## Decisions so far
<!-- index only: gist + rejected alternative, linking the ADR or handover map -->
- [task-board-skill](../.handovers/handover_001_task-board-skill.md) — the board becomes its own skill, called by teamwork and source-port. Rejected: teamwork owns it (source-port would depend on teamwork), source-port owns it (non-porting repos get no board).
- [situation-band](../.handovers/handover_002_situation-band.md) — band above the prompt with gauge plus goal, now, done, next, constraints. Rejected: docked pane (tabs too narrow), rolling feed (no big picture for a late joiner).
- [auto-compaction](../.handovers/handover_003_auto-compaction.md) — the mod compacts at a task boundary past the threshold and writes the note itself. Rejected: a skill Ben invokes (still manual), a hard cap (a long task may run to 300k).
- Context threshold is 200k tokens, a soft line. Rejected: a price-based line; the pricing page bills the full 1M at one rate for 4.6+ models, so the threshold buys speed and focus, not money.

## Not yet specified
<!-- the fog: questions not yet sharp, and work deliberately unfinished with its reason -->
- The change feed (file, diff, one-line reason per edit) as a drill-down behind a key or `/changes`. Deferred: it is not what a late joiner needs; version two. The first mockup is in [docs/mockup-v0-change-feed.html](docs/mockup-v0-change-feed.html).
- How the band presents in the mobile app, which has no terminal rows. Open until the band exists on the terminal.
- OpenCode workers that run outside a board are invisible to the cockpit. Open until every fan-out uses the board.
- What the engine does with a subagent report that arrives during compaction. Observe once the mod runs.
- Whether a push notification at turn end is wanted on mobile. Start without; add only if Ben reopens the app to check.

## Out of scope
<!-- ruled out for the project, with the reason. Never graduates. -->
- Accept or reject per hunk. The VS Code extension already does it; the cockpit observes.
- Per-token streaming of edits. Per tool call is enough and far simpler.
- A sidecar model that summarises the feed into the block. It lags, costs, and the main model already holds the state.
- A global board folder outside the repo. Breaks the git-based board sync between Ben's PC and Mac.
- Making solo, single-agent sessions fill the board. Their state is the situation block; the board earns its place only with more than one writer.
- Merging the compaction note into `handover_log.md`. The log is an index per effort; notes would bloat it.
- Writing the compaction note to a file in the working repo. The ClaudeMods rule says a mod never writes files.

## Efforts
- [../.handovers/handover_log.md](../.handovers/handover_log.md)
