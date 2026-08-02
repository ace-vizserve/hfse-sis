# HFSE SIS — Claude Instructions

A Student Information System for HFSE International School, Singapore. Modules — Markbook, Attendance, Evaluation, P-Files, Records, Admissions, SIS Admin — are surfaces of one student record, not sibling apps. The module switcher moves between them; `studentNumber` is the backbone.

## Stable rules — auto-loaded (every session)

**Everything inside `.claude/rules/` is read into context automatically, every session.** That is a Claude Code behaviour, not something a file can opt out of — a `load: on-demand` line in a file's frontmatter is descriptive only and does not stop it loading. So only four files live there, deliberately:

@.claude/rules/always-do-first.md
@.claude/rules/hard-rules.md

- `.claude/rules/design-system.md` — binding design pointer; too important to risk missing (it is small, and only points at the full docs).
- `.claude/rules/key-decisions.md` — the KD index, so a "KD #N" cite resolves with no extra read.

Do not edit any of the four without explicit user approval, and **do not add new files to `.claude/rules/`** — anything put there is paid for in every session. On-demand material goes in `docs/` (below).

## Stable rules — on-demand (read with the Read tool when relevant)

These live **outside** `.claude/rules/`, so they cost nothing until read. Read before acting when any of the "Read when..." conditions apply.

| Rule                           | Read when...                                                                                                                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/rules/tech-stack.md`     | Touching code, installing/upgrading a dep, debugging a framework behavior, or a Next.js 16 gotcha                                                                                                                                                      |
| `docs/rules/project-layout.md` | Creating new files, moving code between modules, or deciding where a new route or lib lives                                                                                                                                                            |
| `docs/rules/env-vars.md`       | Touching `.env.local`, Supabase/auth plumbing, or Resend emails                                                                                                                                                                                        |
| `docs/rules/workflow.md`       | Finishing work — before reporting a task done, or at session wrap-up                                                                                                                                                                                   |
| `docs/key-decisions/*.md`      | A "KD #N" reference appears in code or docs; cross-cutting architectural choices; doubt about module boundaries, roles, or conventions. Find the topic file via the always-loaded index at `.claude/rules/key-decisions.md`, then Read only that file. |

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

**On prod, stable (detail in the KDs, not here):** capability layer + `SECURITY DEFINER` lockdown (KD #166/#167, migrations 101–104); Document Completeness table (KD #168); academic coordinator gains SIS Admin, loses document validation (KD #169 + #166 update, migrations 105/106); home offers work by JOB not role (KD #170); scoped FCA attendance dashboard (KD #171); Classroom timeline grouping (KD #172); link-layer/capability consistency (KD #173); Classroom module (KD #160), column labels (KD #161), CSV export (KD #162). Run **`scripts/audit-role-permissions.ts`** after any grant change — the live `role_permissions` table is authoritative over the code defaults, so a code-only edit is inert. **Findings worth keeping:** `residenceHistory` is **heterogeneously typed in prod** (JSON string from the portal/seeder, real array from the SIS edit route) so any type probe must scan every value, never the first non-null; `csv.extraColumns` means `defaultChecked:true` = always exported, omitted = **never**; **the parent portal reads some tables DIRECTLY as the parent** — only `school_config` + `report_card_publications` are parent-readable, everything else silently returns zero rows; and non-examinable subjects store a **band-representative integer** (95/87/82/70) in `quarterly_grade` standing in for a letter, so never compare those against the formula.

**Current state (2026-08-01 — NOT yet committed; migrations 107 + 108 applied to prod):** triage of the 2026-07-31 academics-training feedback produced **KD #174/#175/#176**. **(1) Grades** — `sync_grading_sheets_from_config` resized denominators and never recomputed, so a subject-config save could leave wrong grades on printed report cards; recompute moved to TS (`lib/grading/recompute-sheet.ts`, shared with the totals route), 107 returns `sheet_ids`, failure is a 500 plus a re-runnable `/resync`. 108 stops the RPC writing `qa_total`: **SQL owns array shape, TS owns values.** Two SOW rules — a slot reduction that would erase entered marks is **refused** (409), a deliberately-set per-section exam total is **preserved**; both no-ops at AY start so Joann's SOW broadcast keeps zero friction. **(2) Security** — that definer RPC was in **neither** KD #167 revoke list and truncates score arrays; 107 revokes it, verified live (anon → `42501`). **(3) Teachers** — the Classroom roster linked every student name to registrar-only `/records`, bouncing every form adviser; all ~35 call sites classified, 4 fixed, unguarded `/markbook/sections/[id]/attendance` retired to a redirect. 2406 tests + typecheck + build + prettier clean. **Grade data:** `scripts/audit-grade-recompute-drift.ts` (read-only) reports **AY2026 CLEAN** — 260 sheets, 4,634 entries; the one drifted sheet (SCI · Discipline 1 · T2) came from the backfill import, and its **grades were right while its totals were wrong**, so it was repaired by restoring totals, not recomputing. AY2025 has a residual **58 entries across 50 sheets** (closed year, all locked) — undecided. ⚠ **No browser pass on ANY of it:** form adviser sees plain names with a working "Report card"; a register submit renders as `Class · date · Absent → Present`; a `qa_max` change shows sane audit counts.

**Future work (deferred backlog) — the 2026-07-31 training items, the WW/PT max-score gap, and the open questions are tracked in `docs/sprints/development-plan.md`.** Also: late-semantics **C1** (derive the late label from earliest-enrollment across the ~8 enum sites — hardening, not a bug) + multi-interval re-enrol proration (known limitation); per-module compare trend charts (post-go-live); Sec 4 Economics card (no Sec 4 students yet); self-serve invite flow (KD #87, `/auth/setup`); attendance audit-log server-side pagination; VL bulk-import parser (KD #94); PTC digitization as a separate surface (DB tables intact, KD #114); **config-placement review** — operator-tuned settings → business module, structural config stays in SIS Admin (KD #48; clearest candidate discount-codes → Admissions; **do NOT reverse KD #118** — early-bird stays in SIS).

**Recent sprints:** full sprint-by-sprint history (Sprint 28→67 + the 2026-07 bug-hunt, KDs #63–168, migrations 030–104) lives in `docs/sprints/development-plan.md` (status snapshot at top) + `git log`. Don't duplicate it here. Sprint-60 work (KD #144/#145/#146, migration 074, pagination fixes, seeder-fidelity batch) is on prod — see the dev-plan snapshot.

## Cross-reference note

Cross-references elsewhere in the repo such as "CLAUDE.md Hard Rule #N" or "CLAUDE.md KD #N" now resolve to `.claude/rules/hard-rules.md` and `.claude/rules/key-decisions.md` respectively. Numbering is preserved across all moves. KDs were split into per-topic files under `docs/key-decisions/` (the root file is the index + KD-to-topic map); existing "KD #N" cites still resolve via the index, and global numbering is unchanged.

Historical plan and spec docs under `docs/superpowers/` cite the older `.claude/rules/key-decisions/<topic>.md` paths. Those are archival records of past work and were deliberately left as-written — read them as "the topic file for that KD", which now lives under `docs/key-decisions/`.
