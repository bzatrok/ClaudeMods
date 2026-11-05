# Handover 001 — task-board skill

**Branch:** none. `~/.claude/skills` is not a git repo. Work in place, back up each edited file to `<file>.bak` first.  ·  **Author:** cockpit design session, 2026-11-05  ·  **Status:** pending
**Log:** [handover_log.md](handover_log.md)
**Serves:** the board every fan-out uses comes from one shared skill, so the cockpit reads one format in every repo.
**Scope:** Create `~/.claude/skills/task-board/`. Move the board script and the board protocol out of the IG2 repo and the `source-port` skill into it. Point `teamwork` and `source-port` at it. Add the provider rule. No change to IG2's running board beyond nothing.

## 0. Shared context (read first)
- Read [PROJECT_CONTEXT.md](../cockpit/PROJECT_CONTEXT.md) and the log. The board invariant: it lives in the repo, is changed only by the script, is committed by the script on master, and can sync between machines through git.
- Claim gate: OFF.

| Concern | Path |
|---|---|
| The script to generalise | `~/dev/IG2.iOS/tools/task.py` (275 lines, already generic: columns come from the table header) |
| The board it edits | `~/dev/IG2.iOS/TASKS.md` (header lines 1–12 explain the row kinds; those are source-port's, not the board's) |
| Board rules today, source-port | `~/.claude/skills/source-port/SKILL.md` lines 79–83 (the Board bullet) and 184–192 (Where the tools are) |
| Board rules today, teamwork | `~/.claude/skills/teamwork/SKILL.md` rules 1, 9, 10 (lines 23–59) and the description line |
| Skill format to follow | `~/.claude/skills/discuss/SKILL.md` for frontmatter; `~/.claude/skills/handover-workflow/SKILL.md` for the writing rules |

## 1 — Create the skill  *(DECIDED)*
### Approach
Create `~/.claude/skills/task-board/SKILL.md` and `~/.claude/skills/task-board/scripts/task.py`.

`scripts/task.py` is a copy of IG2's `tools/task.py` with these edits only:
- Docstring: drop IG2 names. Say: the board is `TASKS.md` in the repo root, changed only through this script, which locks, rereads, edits one row and commits only `TASKS.md` on master. Keep the `--board` option and the `Remote:` sync line.
- `claim` and `next` take a required `--provider NAME` (examples: `sonnet`, `opus`, `haiku`, `deepseek`, `glm-low`, `glm-high`, `luna`). `set ... claimed` takes it as optional. The value is written into Notes as the first token, `provider=NAME`, before any existing note text. A claim without `--provider` exits 2 with a one-line message.
- `list` gains `--state claimed` output that prints ID, Owner, Branch, provider and Updated on one line each. The cockpit parses this output, so keep it stable: tab-separated, no header.
- Nothing else changes. Run the script's existing commands against a scratch copy of IG2's TASKS.md in `/tmp` to prove nothing broke: `list`, `claim X --session s1 --provider sonnet`, `set X review --session s1 --note "done"`, `show X`.

`SKILL.md` frontmatter:
```
name: task-board
description: The shared task board every multi-agent effort uses — TASKS.md in the repo root, changed only through tools/task.py. Use when teamwork or source-port starts in a repo, when a lead spawns or merges a worker row, when an agent must claim or hand back work, or when Ben asks "what is on the board". Not for single-agent sessions.
```
`SKILL.md` body, in this order, in the writing style of the handover skill (plain words, short sentences):
1. **What it is.** One file, one row per unit of work. The script is the only writer. Why: two agents can never claim the same row, and the board is versioned with the code.
2. **Install into a repo.** `mkdir -p tools && cp ~/.claude/skills/task-board/scripts/task.py tools/task.py`, then create `TASKS.md` from the template below if missing, commit both on master. Add the `Remote: origin master` line above the table when two machines share the board.
3. **The table.** Required columns: ID, Model, Depends on, State, Owner, Branch, Updated, Notes. States: open → claimed → review → done, plus blocked with the reason in Notes. A row is ready when open and every dependency is done.
4. **Commands.** The five from the docstring, each on one line with its purpose. Say that `--session` is the agent's session id and `--provider` names the model that works the row.
5. **The provider rule.** Every claim names its provider. The cockpit mod reads it to show who runs what. Without it the roster is blind.
6. **Who adds row kinds.** The board knows no row kinds. `source-port` defines `S- L- P- H- U- X-`. Another effort defines its own in the text above the table.
7. **Template** for a new `TASKS.md`: a two-line header ("Edited only by tools/task.py …"), then the table header row with the eight columns and one example row.

## 2 — Point teamwork at it  *(DECIDED)*
### Approach
Edit `~/.claude/skills/teamwork/SKILL.md`:
- Add to the description: "Every repo that fans out has a board from the `task-board` skill."
- Add a rule 0 before rule 1: "Run `task-board` first. No board, no workers." One sentence more: the install command.
- Rule 9: keep. Replace the inline `task.py set <id> claimed --session <sid> --note ...` with the same call plus `--provider <name>`.
- Rule 10: replace "The lead cannot trigger compaction itself." with "With the cockpit mod loaded, compaction fires at a task boundary past 200k and writes its own note. Without it, name the compact point and Ben runs `/compact`." Link `~/prod/ClaudeMods/cockpit/PROJECT_CONTEXT.md`.
- Where the text says "board" generically, leave it. Where it names `task.py` by path, point to `tools/task.py` installed from the skill.

## 3 — Point source-port at it  *(DECIDED)*
### Approach
Edit `~/.claude/skills/source-port/SKILL.md`:
- Board bullet (lines 79–83): first sentence becomes "The board comes from the `task-board` skill." Keep the row kinds sentence. Drop the sentence about the script, the lock and the commit: the skill owns that now.
- Where the tools are (lines 184–192): remove `task.py` from the IG2 tools list and add one line: "`task.py` is the `task-board` skill's; IG2's `tools/task.py` is its installed copy."
- Nothing else.

## Sequencing
1. Skill and script (item 1). Test the script on a `/tmp` copy of the IG2 board.
2. teamwork (item 2).
3. source-port (item 3).
4. Diff the three `.bak` files against the edited ones and paste the diffs in the completion note.

## Decisions — locked ✅
- Provider lives in Notes as `provider=<name>` — chose it over a new column because the IG2 board header is live and parsed by position.
- The skill installs a copy into `tools/task.py` — chose it over running from the skill folder because workers in worktrees and OpenCode agents need the script inside the repo, versioned.
- A third skill, not teamwork or source-port — chose it so non-porting repos get a board and source-port does not depend on teamwork.
- IG2's live script is left alone — chose it over upgrading IG2 now because IG2 is mid-port; it takes the new script at its next quiet point.

## Out of scope for this handover
- Any change to the cockpit mod. Handovers 002 and 003.
- Migrating IG2's existing claimed rows to carry `provider=`. Next claims will.
- Haegemonia's `row_start`/`row_finish`. Its repo was not found at `~/dev/Haegemonia-iOS`; it migrates when it resurfaces.

## Acceptance / pre-merge checklist
- `python3 -I ~/.claude/skills/task-board/scripts/task.py --help` prints the new usage.
- On a `/tmp` copy: claim without `--provider` exits 2; with it, Notes starts with `provider=sonnet`; `list --state claimed` prints tab-separated rows.
- `grep -n "task-board" ~/.claude/skills/teamwork/SKILL.md ~/.claude/skills/source-port/SKILL.md` shows the new references.
- `grep -n "cannot trigger compaction" ~/.claude/skills/teamwork/SKILL.md` finds nothing.
- The three `.bak` files exist next to their originals.

---
**On completion:**
1. Update `.handovers/handover_log.md`. Set this handover's status to ✅ done and fill in the Completed date. If you could not finish, set 🔄 in-progress and add a note row that describes what remains.
2. Add each locked decision to the log's **Decisions so far** that is not there yet. One line: the gist plus the rejected alternative, linking this doc by name.
3. Move anything this work made sharp out of **Not yet specified**. Move anything it ruled out into **Out of scope**.
4. No commit, push or PR: the files live under `~/.claude`. Paste the diffs in your final message.
