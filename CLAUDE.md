# Claude Code mods

Personal mods (plugins of function hooks), one folder per mod. Loaded in every session via
`CLAUDE_CODE_PLUGIN_DIRS=~/prod/ClaudeMods` in `~/.claude/settings.json`, which loads every subfolder
with a `.claude-plugin/plugin.json` — a new mod folder loads without touching settings.

| Mod | What it does |
|---|---|
| `context-bar/` | `/context-bar` shows a stacked context-window bar above the prompt, `/context-bar off` hides it; per session, starts hidden |
| `handover-report/` | `/handover-report` opens a pane with the state of `.handovers/handover_log.md` |
| `tldr/` | `/tldr [extra ask]` summarises the last reply with haiku in a bordered box above the prompt (under context-bar, cleared on the next turn); `/tldr auto` does it after every reply (per session, starts off); `/tldr eli5|eli8|eli12|eli15` sets the reading level (persisted, default eli12); `/tldr tune <level> <feedback>` has sonnet rewrite that level's rules into the `/config` field `tldr.<level>`, `/tldr reset <level>` clears it; the model never reads it |

## Commands (per mod folder)
```bash
claude plugin validate <mod>   # manifest + what the module hooks and calls
claude plugin test <mod>       # runs hooks/*.test.ts against the engine
npx -p typescript@5 tsc -p <mod>   # after the engine has laid .claude-plugin/types/ once
```

## Rules
- `$` never crosses an import: anything calling `$.…` lives in `register.tsx`; pure logic goes in sibling `.ts` files.
- Mod values live in `$.state` (declared in `types/index.d.ts`), persisted preferences in `$.store`.
- Actions that change repos or files only fill the prompt box (`$.prompt.fill`); the mod never writes on its own.
