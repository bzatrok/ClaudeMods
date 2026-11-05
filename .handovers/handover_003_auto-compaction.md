# Handover 003 — auto-compaction with note and resume prompt

**Branch:** `feat/auto-compaction` (create, after 002 merged)  ·  **Author:** cockpit design session, 2026-11-05  ·  **Status:** pending
**Log:** [handover_log.md](handover_log.md)
**Serves:** the session compacts itself at a task boundary past 200k, and every compaction leaves a note and a resume prompt that carry the worker roster.
**Scope:** Extend the mod from handover 002. Depends on its state contract and its `session.compact` observer.

## 0. Shared context (read first)
- Read [PROJECT_CONTEXT.md](../cockpit/PROJECT_CONTEXT.md), the log, [situation-band](handover_002_situation-band.md), the repo `CLAUDE.md` (mod rules), and the `plugin-authoring` skill.
- Repo rule: the mod never writes files. The note lives in `$.store` and is shown by `/cockpit note`.
- Ben's hand-written resume prompts, which this replaces, read like: "Resume as lead-1 on ~/dev/IG2.iOS. Read the latest 'before compaction' entry in .handovers/handover_log.md and the memory files, then <two or three concrete next steps>. <Budget rules: which agents, how many, frugal>. Goal: <milestone>. Keep your context lean."
- Claim gate: OFF.

| Concern | Where |
|---|---|
| Trigger a compaction | `$.session.compact({ instructions })` — same as `/compact`, between turns, rejects while a turn runs; resolves `{ skip }` when vetoed |
| Observe and rewrite a compaction | `session.compact` hook: `e.trigger` (`manual`, threshold, `plugin`, `precompute`), `e.instructions`; `next(e)` resolves `{ messages }`; the hook may rewrite `messages` on the way up |
| Context fill | `$.session.usage().context` — use absolute tokens if the type has them, else `percent` × window |
| Note storage | `$.store` (persists across sessions; the repo rule forbids the mod writing files) |
| Config | `userConfig` option `thresholdTokens`, default `200000`, read once in `register` |

## 1 — Boundary detection  *(DECIDED)*
A boundary is: the last `cockpit_update` of the turn carried `phase_done: true`. Store `block.phaseDone`. A later `cockpit_update` with `phase_done` absent or false clears it.

## 2 — Trigger  *(DECIDED)*
On `turn.complete`, after handover 002's refresh: if `tokens ≥ thresholdTokens` and `block.phaseDone`, call `$.session.compact({ instructions })` after `next(e)` resolves (the turn must be over). `instructions` is the preserve list from item 4. Set `gauge.lastCompactionAt` when it resolves without `skip`. Never compact twice within 5 minutes. Never compact on a number alone: above the threshold without a boundary the gauge row says `compaction expected at next boundary` (handover 002 draws it) and nothing else happens.

## 3 — The note  *(DECIDED)*
Built by the `session.compact` hook on the way down, for every trigger except `precompute`. Pushed onto `$.store.cockpit.notes` (keep the last 20 per cwd). `/cockpit note` prints the latest entry for the session cwd; `/cockpit notes` lists their headers. Entry format, as printed:
```
## <ISO timestamp> — before compaction (<n>) — trigger <trigger>
goal: …  now: …  done: …  next: …  constraints: …
workers:
- <id> · <provider> · <branch> · since <Updated>
context: <tokens> tokens (<percent>%)
```
`n` counts entries for this cwd. The five lines come from `block`; the roster from `workers`.

## 4 — Preserve list  *(DECIDED)*
`instructions` passed to the compaction (both automatic and manual: rewrite `e.instructions` on the way down by appending):
"Preserve verbatim: the goal, current step, done, next and constraints as last given to cockpit_update; the list of running workers with their rows and providers, because their reports arrive after compaction; every open decision the user has not answered; file paths touched this session."

## 5 — Resume prompt  *(DECIDED)*
On the way up, append one user-role text message to `messages`:
"Resume on <cwd>. Run /cockpit note for the full pre-compaction state and read the memory files. Goal: <goal>. Now: <now>. Next: <next>. Constraints: <constraints>. Workers still running: <id · provider> …; expect their reports and merge through the board. Keep your context lean. Call cockpit_update first."
When `block.now` is empty (no update ever), the prompt still names the cwd, the command and the workers.

## 6 — Teamwork rule  *(DECIDED)*
Handover 001 already rewrote teamwork rule 10. Nothing to do here but confirm the sentence is there; if 001 has not run, leave it.

## 7 — Test  *(DECIDED)*
Extend `hooks/register.test.tsx`: seed block with `phaseDone: true` and usage above threshold, run `turn.complete`, assert `$.session.compact` was called with instructions containing "Preserve verbatim"; seed below threshold, assert no call; run the `session.compact` hook with two workers, assert the stored note and that the last message on the way up starts with "Resume on".

## Sequencing
1 → 3 → 4 → 5 → 2 → 7. Manual `/compact` exercises 3–5 before the trigger exists.

## Decisions — locked ✅
- Note in `$.store`, shown by `/cockpit note` — chose it over a file in the repo because the ClaudeMods rule says a mod never writes files, and the resume prompt already carries the state into the conversation. Rejected earlier: `handover_log.md` (index, not store).
- Resume prompt injected by the hook — chose it over asking Ben to paste; that is the manual step being removed.
- Boundary = `phase_done` from the model — chose it over a heuristic on tool calls; the model knows when a unit closed.
- No hard cap — chose it because a long task may run to 300k; the engine's own auto-compact is the backstop.
- Threshold 200k tokens as a `userConfig` option — chose tokens over percent so the number matches how Ben talks about it.

## Out of scope for this handover
- Deciding what to do with a subagent report that lands mid-compaction. Observe, write it in Not yet specified with what was seen.
- Notifications. Open in PROJECT_CONTEXT.

## Acceptance / pre-merge checklist
- `claude plugin validate cockpit`, `npx -p typescript@5 tsc -p cockpit`, `claude plugin test cockpit` clean.
- Loaded in a session: `/compact` stores a note, `/cockpit note` prints it, and the first message after compaction is the resume prompt.
- With `thresholdTokens` set to a small number in the session's plugin config, a `cockpit_update` with `phase_done: true` followed by turn end triggers compaction; without `phase_done` it does not and the gauge shows "expected".
- Two compactions cannot fire within 5 minutes.

---
**On completion:**
1. Update `.handovers/handover_log.md`. Set this handover's status to ✅ done and fill in the Completed date. If you could not finish, set 🔄 in-progress and add a note row that describes what remains.
2. Add each locked decision to the log's **Decisions so far**. One line: the gist plus the rejected alternative, linking this doc by name.
3. Move anything this work made sharp out of **Not yet specified**. Move anything it ruled out into **Out of scope**.
4. Commit, push the branch, and open the PR.
