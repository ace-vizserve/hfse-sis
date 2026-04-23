---
description: Load project context — reads CLAUDE.md + development-plan.md and reports where the project stands. Run this at the start of any session.
allowed-tools: [Read, Glob, Grep, Bash]
---

# Bootstrap project context

`CLAUDE.md` is auto-loaded by Claude Code — and its `@.claude/rules/*.md` imports come in with it — but `docs/sprints/development-plan.md` is not, and even with all of that in context the model needs to actively orient itself before suggesting work. Run this command at the start of any session — or any time you've been away from the repo for a while — to load the situation into working memory.

Optional argument (`$ARGUMENTS`):

- empty (default) → fast briefing, no codebase exploration
- `deep` → also `git log --oneline -20`, list the last 10 modified files, count migrations, scan recent task list
- `sprint N` → focus the briefing on a specific sprint number

## Workflow

### 1. Read the source-of-truth files

- `CLAUDE.md` — already in context, but **re-read it** so the imports list, on-demand rule table, and session-context scratch are top-of-mind
- `.claude/rules/hard-rules.md` — auto-loaded via `@`-import in CLAUDE.md; re-read if not confident it's in working memory
- `.claude/rules/key-decisions.md` — **on-demand; read it now** as part of orientation, because many KDs inform routine judgment calls; after orientation, re-read only when a "KD #N" is cited or an architectural question comes up
- Other `.claude/rules/*.md` (tech-stack, project-layout, env-vars, workflow) — on-demand; read only if the session's task matches their frontmatter `description`
- `docs/sprints/development-plan.md` — not auto-loaded; read it in full

If any of these files are missing or unreadable, **stop and report** — the project is in an unknown state and you should not start work until it's resolved.

### 2. (only if `deep`) Probe recent activity

- `git log --oneline -20` — what's shipped recently?
- `git status` — uncommitted work in progress?
- `ls supabase/migrations/` — current migration count, latest one
- Glob `app/api/**/route.ts` — total API route count
- `TaskList` if available — recent completed / in-progress tasks

Skip this section entirely on the default fast path. It's there for "I haven't touched this in two weeks" mornings.

### 3. Synthesize a briefing

Reply with a tight, scannable status report. Structure:

```
## Project: HFSE SIS

**Stack:** [from CLAUDE.md tech stack — one line]
**Repo:** [single deployable / monorepo / etc — one line]

## Sprint status (from development-plan.md)

| Sprint | Status |
|---|---|
| 1 ... | ✅ / 🔶 / ⏸️ |
| ... |

## Where we are right now

[1-3 sentences pointing at the current sprint + what's the next concrete unblocking task. Pull from the most-recent "in progress" sprint or the top of the improvements backlog.]

## Hard rules (do not violate)

[List the 7 hard rules from `.claude/rules/hard-rules.md` by short title only — not the full text. The reader can open the file if they need detail.]

## Suggested next action

[ONE sentence. The single most valuable thing to do next, based on what's marked deferred / in-progress / blocking deployment. Be opinionated — the user can override.]
```

Keep the entire reply under ~40 lines. The point is to get oriented fast, not to dump every detail.

### 4. Honesty rules

- If the dev plan's "last updated" date is more than 2 weeks old, flag it and suggest running `/sync-docs` first.
- If the status snapshot in the dev plan disagrees with what you see in the codebase (e.g. a sprint marked done but the file it references doesn't exist), call it out — don't paper over it.
- Don't invent a current sprint. If everything is marked done or everything is marked not-started, say so.
- Don't suggest work that violates a hard rule.

## When to use

- **Always** at the start of a fresh session before suggesting any work
- After context compaction (the conversation got summarized and details may have been lost)
- After running `/sync-docs` to confirm the new state reads cleanly
- Before planning a new sprint, to make sure the prior sprint is actually closed
