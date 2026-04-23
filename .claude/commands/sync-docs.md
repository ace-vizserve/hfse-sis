---
description: Reconcile CLAUDE.md and docs/sprints/development-plan.md with the current state of the codebase. Run after meaningful work.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, TaskList, TaskGet]
---

# Sync project docs to current reality

Three surfaces are the project's source of truth for "what's been built and what's the contract":

- `.claude/rules/*.md` — stable rules with YAML frontmatter declaring `load: always` or `load: on-demand`. Auto-loaded via `@`-import in CLAUDE.md: `hard-rules.md`, `always-do-first.md`. On-demand (pointer-only in CLAUDE.md, read via Read tool when the frontmatter `description` matches the task): `tech-stack.md`, `project-layout.md`, `env-vars.md`, `key-decisions.md`, `workflow.md`.
- `CLAUDE.md` — slim host: project one-liner, the two `@` imports, on-demand rules pointer table, reference-docs table, and the `## Session context` scratch area
- `docs/sprints/development-plan.md` — sprint-by-sprint status, task checkboxes, definition-of-done, deferrals backlog

Both **must** stay in sync with the actual codebase. This command is the maintenance routine that keeps them honest. Run it after any sprint, after merging a meaningful PR, or any time you suspect drift.

Optional argument (`$ARGUMENTS`) — a focus hint like `"sprint 4"`, `"env vars"`, `"project layout"`. If empty, do a full sweep.

## Workflow

### 1. Survey the codebase

Use Read / Glob / Grep / Bash (`git log --oneline -20`, `git status`, etc.) to inspect the current state. Specifically:

- **Migrations:** `supabase/migrations/*.sql` — what's the highest-numbered one? Any new since the last doc update?
- **API routes:** walk `app/api/` and list every `route.ts`. Compare to what `.claude/rules/key-decisions.md` and `development-plan.md` claim exists.
- **Pages:** walk `app/(dashboard)/` and `app/(auth)/` for new routes.
- **Lib modules:** new files in `lib/{compute,auth,sync,audit,supabase}/`.
- **Components:** new files in `components/{grading,admin,ui}/`.
- **Env vars:** `.env.local.example` — does the list match `.claude/rules/env-vars.md`?
- **Tech versions:** `package.json` — Next.js, React, Tailwind, `@supabase/*` versions still match `.claude/rules/tech-stack.md`?
- **Task list:** call `TaskList` and read recently completed / deferred tasks for hints about what shipped or got punted.

### 2. Diff against `CLAUDE.md` and `.claude/rules/*`

For each surface, check accuracy:

- **Reference docs table in `CLAUDE.md`:** has any `docs/context/*.md` file moved or been renamed? (Rare; usually skip.)
- **Hard rules (`.claude/rules/hard-rules.md`):** **NEVER edit these.** Only verify they're still enforced in code. Greps to run:
  - `grep -r "quarterly_grade !== 93" lib/compute/` — formula self-test still present
  - `grep -r "approval_reference" app/api/grading-sheets/` — post-lock gate still wired
  - `grep -r "is_locked" app/api/grading-sheets/\[id\]/entries/` — lock check on entry PATCH
  - `grep -rn "computeQuarterly" app/api/` — server-side compute (not client-side)
  - If any check comes up empty, **stop and report — a hard rule has regressed.** Do not silently update docs around it.
- **Tech stack (`.claude/rules/tech-stack.md`):** version pins still match `package.json`?
- **Next.js gotchas (same file):** any new breaking change discovered in `node_modules/next/dist/docs/` worth recording? Add it. (Don't proactively go hunting unless you hit one.)
- **Project layout tree (`.claude/rules/project-layout.md`):** does the tree match the actual directory structure? Add new significant folders, remove stale ones. Keep it brief — leaf detail belongs in the dev plan, not here.
- **Environment variables (`.claude/rules/env-vars.md`):** match `.env.local.example` exactly (modulo placeholder values).
- **Key decisions (`.claude/rules/key-decisions.md`):** has a new architectural choice been made? (e.g. "we added an X table", "we dropped Y service".) If yes, append with the next unused number; don't renumber existing KDs; don't restructure.
- **Session context (CLAUDE.md `## Session context` block):** prune anything stale or no longer relevant. This block is explicitly ephemeral — if an entry has become stable project policy, promote it into the relevant `.claude/rules/*.md` file and remove it here.

**Hard limit: keep `CLAUDE.md` under 80 lines.** Stable rules now live in `.claude/rules/` and are `@`-imported; CLAUDE.md's 80-line budget covers only the intro, imports, reference-docs table, session-context scratch, and cross-reference note. Rule files themselves have no line budget but should stay tight.

### 3. Diff against `docs/sprints/development-plan.md`

This file is allowed to grow; it's the long-form record.

- **Status snapshot table at the top:** every sprint's status accurate? Update the "last updated" date.
- **Per-sprint task checkboxes:** for each `[ ]` that's now shipped, flip to `[x]` and append an italic note pointing at the file/feature that delivered it (e.g. `_(via lib/foo.ts)_`).
- **Definition of Done bullets:** same — flip checkboxes, add evidence.
- **Deferred / partial items:** keep the `[ ]` but tag with an italic explanation of why and what would unblock it. Honesty over hiding gaps.
- **Cross-cutting improvements backlog:** add anything new that came up but was deliberately deferred. Remove items that have since been done.
- **Sprint headers:** update the emoji status (✅ Done / 🔶 Mostly done / ⏭️ Deferred / ⏸️ Not started).

### 4. Edit hygiene

- Use targeted `Edit` calls, not full `Write` rewrites — the diff has to be reviewable.
- Exception: rewriting a rule file or `CLAUDE.md` end-to-end is OK if structural changes are needed and the diff would be a mess otherwise. Justify in the summary.
- Stable rules in `.claude/rules/*.md` are immutable except with explicit user approval — they are `@`-imported into every session, so silent edits propagate everywhere. The doc references table in `CLAUDE.md` is also immutable unless a context file actually moved.
- Don't invent features. Only document what you can point at in the codebase.
- Don't delete deferred backlog items just because they're old. Mark them done if they shipped, or leave them as deferred with current reasoning.

### 5. Verify

Run `cd app && npx next build` (with placeholder env vars if `.env.local` is missing — see existing build commands in chat history). It must compile cleanly. If it doesn't, **stop and surface the build failure**; the docs can wait until the code is green.

### 6. Report

Reply with a tight summary:

- **Files changed:** `CLAUDE.md` (lines added/removed), `.claude/rules/*.md` (which files touched), `development-plan.md` (sections touched)
- **What shipped since last sync:** bullet list, one line each, pointing at the file or route
- **What's now marked deferred or partial that wasn't before:** with the reason
- **Hard-rule check results:** all seven rules confirmed enforced, OR which one regressed
- **Drift you couldn't reconcile:** anything that needs human input — e.g. "I see a new column on the schema but no doc explains why it was added"
- **Line counts:** `CLAUDE.md = N lines (budget 80)`, `.claude/rules/ = N files`, build status

Keep the summary under ~30 lines. The user reads this to decide whether to re-run with a focus argument or move on.
