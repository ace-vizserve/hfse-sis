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

**Current state (2026-06-08, Sprint 58–59 — all on prod):** **Academic Summary** is now a hub (`/records/academic-summary`) with Awards/Attendance/Comments quick-view routes; the masterfile is export-only (.xlsx/.csv) (KD #134). Per-section **index numbers** surfaced across the student-listing surfaces + a registrar **"Generate class index"** tool (alphabetical, withdrawn retired/never reused, orders by **section-tenure** so mid-year transfers bottom-pin; migrations 071/072, KD #135/#136). **Virtue-theme editor** moved to Evaluation (`/evaluation/virtue-themes`, registrar+, KD #137). The four **section lists** are now `<DataTable>`s with a `⋯` row-actions menu — **Generate-index reachable from Markbook** so the registrar needn't enter SIS Admin (KD #84 update). Late-semantics **C1 deferred** (the enum already labels transfers `active`) + **C2 dropped** (re-stamping `enrollment_date` on reactivation would prorate real pre-withdrawal attendance out). **RBAC (no code):** Joann = **operator** (student + grades workflow — incl. QA-max via the per-sheet TotalsEditor, publishing, attendance, evaluation oversight, sections); school_admin = **configurator**. Blow-by-blow: dev-plan snapshot + `git log`.

**Future work (deferred backlog):** late-semantics **C1** (derive the late label from earliest-enrollment across the ~8 enum sites — hardening, not a bug) + multi-interval re-enrol proration (known limitation); per-module compare trend charts (post-go-live); Sec 4 Economics card (no Sec 4 students yet); self-serve invite flow (KD #87, `/auth/setup`); attendance audit-log server-side pagination; **namespace the 6 remaining `url={{ enabled: true }}` DataTable consumers** (grading/change-requests/audit-log/all-publications/cohort/feedback — phantom-facet footgun, KD #84); cron auto-sync trigger (KD #90); VL bulk-import parser (KD #94); PTC digitization as a separate surface (DB tables intact, KD #114); **config-placement review** — operator-tuned settings → business module, structural config stays in SIS Admin (KD #48; clearest candidate discount-codes → Admissions; **do NOT reverse KD #118** — early-bird stays in SIS).

**Recent sprints:** full sprint-by-sprint history (Sprint 28→59, KDs #63–137, migrations 030–072) lives in `docs/sprints/development-plan.md` (status snapshot at top) + `git log`. Don't duplicate it here.

## Cross-reference note

Cross-references elsewhere in the repo such as "CLAUDE.md Hard Rule #N" or "CLAUDE.md KD #N" now resolve to `.claude/rules/hard-rules.md` and `.claude/rules/key-decisions.md` respectively. Numbering is preserved across all moves. KDs were split into per-topic files under `.claude/rules/key-decisions/` (the root file is the index + KD-to-topic map); existing "KD #N" cites still resolve via the index, and global numbering is unchanged.
