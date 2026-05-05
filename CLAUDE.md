# HFSE SIS — Claude Instructions

A Student Information System for HFSE International School, Singapore. Modules — Markbook, Attendance, P-Files, Records, SIS Admin — are surfaces of one student record, not sibling apps. The module switcher moves between them; `studentNumber` is the backbone.

## Stable rules — auto-loaded (every session)

These two are `@`-imported so they're always in context. Do not edit without explicit user approval.

@.claude/rules/always-do-first.md
@.claude/rules/hard-rules.md

## Stable rules — on-demand (read with the Read tool when relevant)

Not `@`-imported. Each file carries YAML frontmatter (`description`, `load: on-demand`) explaining its trigger. Read before acting when any of the "Read when..." conditions apply.

| Rule | Read when... |
| --- | --- |
| `.claude/rules/tech-stack.md` | Touching code, installing/upgrading a dep, debugging a framework behavior, or a Next.js 16 gotcha |
| `.claude/rules/project-layout.md` | Creating new files, moving code between modules, or deciding where a new route or lib lives |
| `.claude/rules/env-vars.md` | Touching `.env.local`, Supabase/auth plumbing, or Resend emails |
| `.claude/rules/key-decisions.md` | A "KD #N" reference appears in code or docs; cross-cutting architectural choices; doubt about module boundaries, roles, or conventions |
| `.claude/rules/design-system.md` | Before any UI / frontend code; when choosing a shadcn primitive, token, color, or layout |
| `.claude/rules/workflow.md` | Finishing work — before reporting a task done, or at session wrap-up |

## Reference docs

| Doc | Read when... |
| --- | --- |
| `docs/sprints/development-plan.md` | Starting any task — status snapshot + current sprint |
| `docs/context/01-project-overview.md` | Onboarding |
| `docs/context/02-grading-system.md` | Grade computation / formula |
| `docs/context/03-workflow-and-roles.md` | Permissions, locking, workflow |
| `docs/context/04-database-schema.md` | DB tables / queries |
| `docs/context/05-report-card.md` | Report card UI / PDF |
| `docs/context/06-admissions-integration.md` | Admissions sync |
| `docs/context/07-api-routes.md` | API contracts |
| `docs/context/08-admission-dashboard.md` | Admissions analytics |
| `docs/context/09-design-system.md` | UI tokens, hard rules, page→component matrix, pre-delivery checklist |
| `docs/context/09a-design-patterns.md` | Craft standard, canonical patterns, semantic color discipline |
| `docs/context/10-parent-portal.md` | Parent identity, linkage, SSO handoff |
| `docs/context/10a-parent-portal-ddl.md` | Frozen admissions DDL (AY-prefixed tables) |
| `docs/context/11-performance-patterns.md` | Any new page — auth/cache/parallel/loading checklist |
| `docs/context/12-p-files-module.md` | P-Files module — document types, statuses, architecture |
| `docs/context/13-sis-module.md` | Records module |
| `docs/context/14-modules-overview.md` | Cross-module architecture, shared identity, navigation |
| `docs/context/15-markbook-module.md` | Markbook module scope |
| `docs/context/16-attendance-module.md` | Attendance module (Phase 1 + 1.1 shipped) |
| `docs/context/17-process-flow.md` | Cross-module lifecycle + soft gates |
| `docs/context/18-ay-setup.md` | Superadmin AY-rollover wizard |
| `docs/context/19-evaluation-module.md` | Student Evaluation module — FCA writeups + virtue theme (KD #49) |
| `docs/context/20-dashboards.md` | Any dashboard work — before touching a module's landing page or `lib/<module>/dashboard.ts` |
| `docs/context/21-stp-application.md` | Singapore ICA Student Pass workflow (HFSE Edutrust Certified) — `stpApplicationType` gating + STP-conditional doc slots (KD #61) |

## Session context

<!--
Scratch surface for session-learned context, temporary caveats, in-flight
investigations. Safe to edit; pruned periodically. Stable rules do NOT go
here — they live in `.claude/rules/*.md`. Sprint-by-sprint history lives in
`docs/sprints/development-plan.md` + `git log`.
-->

**Current state (2026-05-05):** Sprint 33 in progress on `main` (uncommitted) — RBAC consolidation (drop `admin` role, merge into `school_admin`; school_admin gains all `/sis/admin/*` config sub-routes that were superadmin-only; superadmin retained as break-glass + IT). 6 roles total (`teacher | registrar | school_admin | superadmin | p-file | admissions`). Migration 039 + updates to KD #2 / #39 / #41 / #74. Sprints 31–32 (migrations 037, 038, KDs #76, #77) still uncommitted. Build clean.

**Recent sprints** (full history in `docs/sprints/development-plan.md`; per-pass detail in `git log`):
- Sprint 33 (2026-05-05, uncommitted): RBAC consolidation. Dropped `admin` role from `Role` union — was a functional twin of `school_admin`. Migration 039 flips live `admin` users to `school_admin` and refreshes `is_registrar_or_above()` to include `school_admin`. School_admin inherits everything `admin` had: grade-change approver pool eligibility (sole pool member; superadmin still excluded as the manager-not-actor), Markbook Change Requests inbox, audit-log export, and access to all `/sis/admin/*` config sub-routes (users, settings, template, subjects, school-config, evaluation-checklists, approvers) that were previously superadmin-only. Superadmin keeps full access for break-glass; day-to-day SIS Admin config now belongs to school_admin. ~70 files touched (TS role-string sweep across `requireRole(...)` arrays, page-level guards, sidebar registry, role-label maps); zero `'admin'` / `"admin"` tokens remain in `app/`, `lib/`, `components/`. KDs updated: #2 (role list), #39 (rewritten — admin retired, school_admin = consolidated generalist), #41 (approver pool now school_admin), #74 (oversight gate prose). Migration 039.
- Sprint 32 (2026-05-04, uncommitted): opt-in comparison (`RangeInput.cmpFrom/cmpTo: string | null`, `RangeResult.comparison/delta/comparisonRange` nullable, dashboards default to current-only, "Add comparison" button surfaces in `DateRangePicker`); AY-switchers clear stale `from/to/cmpFrom/cmpTo` so AY changes don't carry prior-AY dates into drill-downs; report-card page enrolment selection is transfer-aware + unions data across all enrolment rows + denominator from `school_calendar`; attendance grid uses `getDedupedSchoolCalendarForTerm` so primary/secondary precedence yields one row per date; module-dashboard audit fixes (attendance day-type donut audience-aware, records late-enrollee aggregate, evaluation virtue-theme NULL warning); AY-window helper derives Jan–Nov from AY code (KD #13); plain-English UI copy audit (drops "audit-logged on save", "transaction", "upsert", "soft delete", etc.; trust-strip footers reshaped to "AY · count · Refreshes every 10 minutes"); early-bird AY pipeline with `accepting_applications` flag, `/admissions/upcoming/applications` route, AY-Setup wizard toggle + AY-list row toggle, discount-code dialog AY picker. Migration 038; KD #77.
- Sprint 31 (2026-05-04, uncommitted): calendar audience scope + typed event categories + tentative-flag carry-forward + AY-label single-year clarification. Migration 037; KD #76 + extended KDs #13 / #50.
- Sprint 30 (2026-05-03, `110cef0`): role-aware audit closures + parent surface sidebar-less + publishing checklist hub + grading list dropdowns. KDs #73–#75 + migrations 035 + 036.
- Sprint 29 (2026-04-30, `1831924`): mid-year section transfer + late-enrollee term detection + admissions chase scope split + P-Files renewal-only scope + class-template subject CRUD. KDs #67–#72.
- Sprint 28 (2026-04-29, `8785f1c` + earlier): parent-portal re-upload trigger + P-Files renewal lifecycle + parent SSO via HMAC cookie + master class templates. KDs #63–#66 + migrations 030–034.


## Cross-reference note

Cross-references elsewhere in the repo such as "CLAUDE.md Hard Rule #N" or "CLAUDE.md KD #N" now resolve to `.claude/rules/hard-rules.md` and `.claude/rules/key-decisions.md` respectively. Numbering is preserved; only the host file moved.
