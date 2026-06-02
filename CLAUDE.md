# HFSE SIS — Claude Instructions

A Student Information System for HFSE International School, Singapore. Modules — Markbook, Attendance, P-Files, Records, SIS Admin — are surfaces of one student record, not sibling apps. The module switcher moves between them; `studentNumber` is the backbone.

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

**Current state (2026-06-02):** Sprint 52 — correctness fixes + docs sync, merged to `main` and deployed. **Migration 069** restores `stpApplicationStatus` that migration 067's `create_ay_admissions_tables` re-emit silently dropped — new-AY creation failed until fixed; 069 heals existing AY tables idempotently, applied to prod + test (KD #119). **Evaluation** per-section write-up counts now resolve by current roster `student_id` instead of the stale denormalized `evaluation_writeups.section_id`, so a mid-year transfer (KD #67) no longer inflates "pending" (KD #120). Grade-change dialog + score-grid alert chip redesigned; readiness-pill "Setup needed" polish (KD #118); test-seeder completeness (per-student term trajectories so grade-swing alerts populate, admissions-first build, AY9998). Preceded by Sprint 51 — AY application window relocated to SIS Admin (KD #118).

**Future work:** per-module compare trend charts (Admissions monthly, Attendance rate, Records movements, Markbook grade-distribution, Evaluation submission — deferred post-go-live); Sec 4 Economics card (no Sec 4 students yet); self-serve invite flow (KD #87 with `/auth/setup`); per-row overflow menus; attendance audit-log server-side pagination; cron auto-sync trigger (KD #90); VL bulk import parser (KD #94 follow-up); optional coordinator annotation on SOW; PTC digitization as a separate plug-in surface when HFSE is ready (DB tables intact, KD #114); **config-placement review (v-next)** — refine KD #48 so operator-tuned settings live in their business module while structural/system config stays in SIS Admin (tiebreaker: when a setting is coupled to a structural op like AY switching, structure wins). Clearest candidate: discount codes → Admissions. Deferred — no live users at v1 and no reported operator friction; revisit when real usage surfaces it. Do NOT reverse KD #118 (early-bird stays in SIS — coupled to AY rollover).

**Recent sprints** (full history in `docs/sprints/development-plan.md`; per-pass detail in `git log`):

- Sprint 52 (2026-06-02): Correctness fixes merged to prod — migration 069 restores `stpApplicationStatus` dropped by 067's `create_ay_admissions_tables` re-emit (KD #119); evaluation write-up counts by current roster, not stale `section_id` (KD #120); grade-change dialog + alert-chip redesign; test-seeder completeness (trajectories + admissions-first + AY9998); removed Markbook's manual add-student-to-section button + dead route (section membership flows only from admissions sync/assign/transfer — the SIS never creates identity, KD #51/#90/#67). Migration 069.
- Sprint 51 (2026-06-02): AY application window — SIS Admin owns open/switch/close (per-row `Switch`, single-select early-bird, rollover auto-open/close), Admissions read-only, readiness pill amber "Setup needed" (KD #118; extends KD #77/#48). No migration.
- Sprint 50 (2026-06-01): Late-enrollee position-aware joining-term decision — `resolveEnrolmentPosition` + Join-now/Start-next prompt across SIS + Markbook + Admissions editors; `enrollment_date` derived from chosen term (KD #117). No migration.
- Sprint 49 (2026-05-31): Attendance Daily view — Term sheet | Daily view toggle + "mark-the-exceptions" roster + today-centric day cards + student-lookup sheet + shared date-derived current-term resolver (`lib/sis/current-term.ts`) + global screen-size guard (KD #116). No migration.
- Sprint 48 (2026-05-30): Compare redesign — CompareGrid table rebuild (no heatmap, sticky col, AY borders, directional delta) + MultiSeriesTrendChart + Markbook subject-performance trend (KD #115).
- Sprint 46 (2026-05-29): Edge case hardening + attendance proration — 11 fixes across 7 modules + migration 068 (KD #113) + SIS Admin staff redesign/sidebar.
- Sprints 28–45 (2026-04-29 → 2026-05-29): see development-plan.md. Highlights: KDs #63–112 + migrations 030–067; Sprint 44 = Markbook polish + SOW teardown (062–066); Sprint 45 = Records student detail (KDs #111–112, migration 067).

## Cross-reference note

Cross-references elsewhere in the repo such as "CLAUDE.md Hard Rule #N" or "CLAUDE.md KD #N" now resolve to `.claude/rules/hard-rules.md` and `.claude/rules/key-decisions.md` respectively. Numbering is preserved across all moves. KDs were split into per-topic files under `.claude/rules/key-decisions/` (the root file is the index + KD-to-topic map); existing "KD #N" cites still resolve via the index, and global numbering is unchanged.
