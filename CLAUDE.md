# HFSE SIS — Claude Instructions

A Student Information System for HFSE International School, Singapore. Modules — Markbook, Attendance, Evaluation, P-Files, Records, Admissions, SIS Admin — are surfaces of one student record, not sibling apps. The module switcher moves between them; `studentNumber` is the backbone.

## Stable rules — auto-loaded (every session)

These two are `@`-imported so they're always in context. Do not edit without explicit user approval.

@.claude/rules/always-do-first.md
@.claude/rules/hard-rules.md

## Stable rules — on-demand (read with the Read tool when relevant)

Not `@`-imported. Each file carries YAML frontmatter (`description`, `load: on-demand`) explaining its trigger. Read before acting when any of the "Read when..." conditions apply.

| Rule                              | Read when...                                                                                                                                                                                                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.claude/rules/tech-stack.md`     | Touching code, installing/upgrading a dep, debugging a framework behavior, or a Next.js 16 gotcha                                                                                                                                                                                  |
| `.claude/rules/project-layout.md` | Creating new files, moving code between modules, or deciding where a new route or lib lives                                                                                                                                                                                        |
| `.claude/rules/env-vars.md`       | Touching `.env.local`, Supabase/auth plumbing, or Resend emails                                                                                                                                                                                                                    |
| `.claude/rules/key-decisions.md`  | A "KD #N" reference appears in code or docs; cross-cutting architectural choices; doubt about module boundaries, roles, or conventions. The file is a thin index — open it to find the topic file under `.claude/rules/key-decisions/` that holds the KD you need, then Read that. |
| `.claude/rules/design-system.md`  | Before any UI / frontend code; when choosing a shadcn primitive, token, color, or layout                                                                                                                                                                                           |
| `.claude/rules/workflow.md`       | Finishing work — before reporting a task done, or at session wrap-up                                                                                                                                                                                                               |

## Reference docs

| Doc                                         | Read when...                                                                                                                     |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `docs/sprints/development-plan.md`          | Starting any task — status snapshot + current sprint                                                                             |
| `docs/context/01-project-overview.md`       | Onboarding                                                                                                                       |
| `docs/context/02-grading-system.md`         | Grade computation / formula                                                                                                      |
| `docs/context/03-workflow-and-roles.md`     | Permissions, locking, workflow                                                                                                   |
| `docs/context/04-database-schema.md`        | DB tables / queries                                                                                                              |
| `docs/context/05-report-card.md`            | Report card UI / PDF                                                                                                             |
| `docs/context/06-admissions-integration.md` | Admissions sync                                                                                                                  |
| `docs/context/admission-process.md`         | HFSE's 13-step intake process (Open House → Orientation); maps ~1:1 to the 9-stage SIS pipeline (`STAGE_KEYS`, KD #51/#59)       |
| `docs/context/07-api-routes.md`             | API contracts                                                                                                                    |
| `docs/context/08-admission-dashboard.md`    | Admissions analytics                                                                                                             |
| `docs/context/09-design-system.md`          | UI tokens, hard rules, page→component matrix, pre-delivery checklist                                                             |
| `docs/context/09a-design-patterns.md`       | Craft standard, canonical patterns, semantic color discipline                                                                    |
| `docs/context/10-parent-portal.md`          | Parent identity, linkage, SSO handoff                                                                                            |
| `docs/context/10a-parent-portal-ddl.md`     | Frozen admissions DDL (AY-prefixed tables)                                                                                       |
| `docs/context/11-performance-patterns.md`   | Any new page — auth/cache/parallel/loading checklist                                                                             |
| `docs/context/12-p-files-module.md`         | P-Files module — document types, statuses, architecture                                                                          |
| `docs/context/13-sis-module.md`             | Records module                                                                                                                   |
| `docs/context/14-modules-overview.md`       | Cross-module architecture, shared identity, navigation                                                                           |
| `docs/context/15-markbook-module.md`        | Markbook module scope                                                                                                            |
| `docs/context/16-attendance-module.md`      | Attendance module (Phase 1 + 1.1 shipped)                                                                                        |
| `docs/context/17-process-flow.md`           | Cross-module lifecycle + soft gates                                                                                              |
| `docs/context/18-ay-setup.md`               | Superadmin AY-rollover wizard                                                                                                    |
| `docs/context/19-evaluation-module.md`      | Student Evaluation module — FCA writeups + virtue theme (KD #49)                                                                 |
| `docs/context/20-dashboards.md`             | Any dashboard work — before touching a module's landing page or `lib/<module>/dashboard.ts`                                      |
| `docs/context/21-stp-application.md`        | Singapore ICA Student Pass workflow (HFSE Edutrust Certified) — `stpApplicationType` gating + STP-conditional doc slots (KD #61) |

## Session context

<!--
Scratch surface for session-learned context, temporary caveats, in-flight
investigations. Safe to edit; pruned periodically. Stable rules do NOT go
here — they live in `.claude/rules/*.md`. Sprint-by-sprint history lives in
`docs/sprints/development-plan.md` + `git log`.
-->

**Current state (2026-07-28 later — on `main`, unpushed at time of writing):** Three shipped items + one parked idea. **Student Profile validation parity** (new KD #157): ported the admissions portal's NRIC/phone/email/postal format rules onto the shared profile schemas, replaced free-text nationality with a constrained country combobox (MIT `countries-list`; the first pick `country-state-city` is GPL-3.0 — caught in review, swapped), and masked passport/pass on BOTH the edit sheets and the view tabs. **The load-bearing subtlety: validation is changed-field-only** — both sheets submit the whole form, so a naive strict schema blocks saves on untouched legacy values; `build*UpdateSchema(changedFields)` + a fetch-before-parse diff in both PATCH routes. Built via full SDD (8 tasks → final opus review → 1 fix wave + 1 residual). **Grading sheet shows the live subject teacher** (new KD #158, your work): reads `teacher_assignments` instead of the drifting/empty `grading_sheets.teacher_name`; expect "No subject teacher assigned" until AY2026 teacher accounts exist. **Nav↔ROUTE_ACCESS two-directional invariant** (new KD #159): a "why can't school_admin see grading sheets?" report exposed an **invisible-page** class — school_admin had no Markbook Grading group at all, and academic_coordinator had no path to `/sis/admin/staff`; both fixed, plus a missing role guard on `/markbook/report-cards`, plus a whole-app regression test (with its prefix-level limitation documented). Also your **attendance sheet legend** moved above the grid (`16-attendance-module.md` updated). **Parked:** the "classroom axis" IA idea (one `section × term` home across Markbook/Attendance/Evaluation) — brainstormed and agreed in principle, no spec written; see the memory note, which carries the schema + readiness-engine evidence. **Not yet done:** manual browser check of the validation-parity UI (masked reveal, combobox, save round-trip on a student with legacy data).

**Current state (2026-07-28 — pushed to `origin/main` @ `d205e5c8`):** Two production bug fixes + one new cross-module feature, all via `git log`-visible commits directly on main (no branch/worktree this session). **Notification fire-and-forget → `after()` fix** (KD #123 update): 4 change-request notification-email call sites were silently dropped in prod — an un-awaited `void(async())` after the HTTP response has no guarantee of surviving Vercel freezing the function; switched to Next's `after()`, with a `next/server` mock added centrally in `vitest.setup.ts` for the resulting test-scope error. **Wide-grid sticky-column bleed-through fix** (KD #151 update): the Term sheet's sticky roster cells used near-transparent zebra/withdrawn backgrounds (`bg-muted/10`, `bg-muted/[0.04]`), letting horizontally-scrolled marks visibly show through; fixed to a flat opaque `bg-card`, matching the already-safe sticky-cell convention in `term-sheet-summary-table.tsx`. **Cross-module notification bell** (new KD #156): surfaces the existing `changeRequests` realtime badge (previously Markbook-sidebar-only) in every module's own header `<header>` bar via new `<NotificationBell>` + `getSidebarChangeRequestPreview` + extracted `useChangeRequestCount` hook; also widened `getSidebarChangeRequestCount`'s `superadmin` branch to unrestricted oversight visibility (fixes a latent pre-existing badge-vs-realtime scope disagreement, found via a controller-escalated design-review question, not a test). Built via full subagent-driven-development (spec → plan → 5 tasks + fix rounds → final whole-branch review → 1 fix wave → clean). 1838 tests + build clean. Spec/plan: `docs/superpowers/{specs,plans}/2026-07-28-cross-module-notification-bell*`.

**Current state (2026-07-12 — MERGED TO MAIN + PUSHED, `origin/main` @ `f145233a`):** the whole stack (`feat/insights-simplification` → `feat/levels-progression` → `feat/sis-admin-ia`, 64 commits) fast-forwarded onto main. **SIS Admin redesign** (umbrella spec `2026-07-11-sis-admin-redesign-umbrella.md`): **sub-project 1** Levels & progression (KD #153, migration 078 applied; footgun: `getCurrent/UpcomingAcademicYear` ignore their `_client` param — unusable on Bearer-only routes); **sub-project 2** IA redesign (KD #154: hub status+launch, one audit surface, staff directory merge, sync page deleted, no-dead-ends test) + **whole-module visual makeover** (KD #154 visual-pass note; approved mockup `2026-07-11-sis-admin-visual-redesign.html`) — with the **sidebar grouping subsequently reverted to the prod structure** (Year Setup/Organisation/Access/System groups carrying the post-#154 item names, no cadence hints — KD #154 revert note, commit `08d97c60`, user decision). A deeper "13→6" consolidation (KD-#155-candidate) was built then **halted by the user — parked unmerged on `feat/sis-admin-consolidation`; do not resume without explicit request.** 1095 tests + build clean at merge.

**Future work (deferred backlog):** late-semantics **C1** (derive the late label from earliest-enrollment across the ~8 enum sites — hardening, not a bug) + multi-interval re-enrol proration (known limitation); per-module compare trend charts (post-go-live); Sec 4 Economics card (no Sec 4 students yet); self-serve invite flow (KD #87, `/auth/setup`); attendance audit-log server-side pagination; VL bulk-import parser (KD #94); PTC digitization as a separate surface (DB tables intact, KD #114); **config-placement review** — operator-tuned settings → business module, structural config stays in SIS Admin (KD #48; clearest candidate discount-codes → Admissions; **do NOT reverse KD #118** — early-bird stays in SIS).

**Recent sprints:** full sprint-by-sprint history (Sprint 28→63 + the 2026-07 bug-hunt, KDs #63–152, migrations 030–076) lives in `docs/sprints/development-plan.md` (status snapshot at top) + `git log`. Don't duplicate it here. Sprint-60 work (KD #144/#145/#146, migration 074, pagination fixes, seeder-fidelity batch) is on prod — see the dev-plan snapshot.

## Cross-reference note

Cross-references elsewhere in the repo such as "CLAUDE.md Hard Rule #N" or "CLAUDE.md KD #N" now resolve to `.claude/rules/hard-rules.md` and `.claude/rules/key-decisions.md` respectively. Numbering is preserved across all moves. KDs were split into per-topic files under `.claude/rules/key-decisions/` (the root file is the index + KD-to-topic map); existing "KD #N" cites still resolve via the index, and global numbering is unchanged.
