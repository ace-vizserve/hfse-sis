---
name: workflow
description: Four-step end-of-task checklist (dev plan → DoD → `npx next build` + manual test → `/sync-docs`). Read before marking work done or at session wrap-up.
load: on-demand
---

<!-- Stable rule. NOT auto-loaded. Read via the Read tool when relevant. Edit only with explicit user approval. -->

## Workflow

1. Read `docs/sprints/development-plan.md` for current sprint + status snapshot.
2. Build against the sprint's Definition of Done; never break a hard rule (see `.claude/rules/hard-rules.md`).
3. Verify with `npx next build` (clean compile required) + a manual happy-path test in the browser before marking anything done.
4. After meaningful work, run `/sync-docs` to keep this file and the dev plan accurate.
