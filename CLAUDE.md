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
| `docs/context/admission-process.md`         | HFSE's 13-step intake process (Open House → Orientation); maps ~1:1 to the 9-stage SIS pipeline (`STAGE_KEYS`, KD #51/#59)        |
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

**Current state (2026-06-03):** Sprint 53 — Markbook non-examinable polish, merged to `main` and deployed (4 commits). Derived **A/B/C/IP now actually render** in the score grid (the `letterDisplay` prop was dead); **per-term UG/E override entry** ships via a unified "Override" dropdown (—/N/A/UG/E) with an `OVERRIDE_LETTERS` allowlist in the entries + change-request routes (KD #104). The **publishing checklist** was compacted to one-line rows + a `max-h` scroll cap, and a **report-card-relevance audit** dropped the non-report-card "Administered dates" check, gated adviser-comments to T1–T3 (T4 has no FCA block, KD #49), and fixed an `is_na` missing-quarterly false positive (KD #75/#105). Letter-subject term-trend analysis (Alerts on MAPEH) **deferred to Ms. Chandana** — interim = the numeric-equivalent delta, unchanged. No migration. Preceded by Sprint 52 (2026-06-02) — migration 069 restores `stpApplicationStatus` (KD #119) + evaluation write-up counts by current roster (KD #120).

**Future work:** per-module compare trend charts (Admissions monthly, Attendance rate, Records movements, Markbook grade-distribution, Evaluation submission — deferred post-go-live); Sec 4 Economics card (no Sec 4 students yet); self-serve invite flow (KD #87 with `/auth/setup`); per-row overflow menus; attendance audit-log server-side pagination; cron auto-sync trigger (KD #90); VL bulk import parser (KD #94 follow-up); optional coordinator annotation on SOW; PTC digitization as a separate plug-in surface when HFSE is ready (DB tables intact, KD #114); **config-placement review (v-next)** — refine KD #48 so operator-tuned settings live in their business module while structural/system config stays in SIS Admin (tiebreaker: when a setting is coupled to a structural op like AY switching, structure wins). Clearest candidate: discount codes → Admissions. Deferred — no live users at v1 and no reported operator friction; revisit when real usage surfaces it. Do NOT reverse KD #118 (early-bird stays in SIS — coupled to AY rollover).

**Recent sprints** (full history in `docs/sprints/development-plan.md`; per-pass detail in `git log`):

- Sprint 53 (2026-06-03): Markbook non-examinable letter entry — derived A/B/C/IP wired into the score grid + per-term UG/E "Override" dropdown with `OVERRIDE_LETTERS` allowlist (KD #104); publishing-checklist compact one-line redesign + report-card-relevance audit (removed Administered-dates check, adviser-comments T1–T3 only, `is_na` quarterly fix — KD #75/#105); Alerts-on-letter-subjects deferred to Ms. Chandana. No migration.
- Sprint 52 (2026-06-02): Correctness fixes merged to prod — migration 069 restores `stpApplicationStatus` dropped by 067's `create_ay_admissions_tables` re-emit (KD #119); evaluation write-up counts by current roster, not stale `section_id` (KD #120); grade-change dialog + alert-chip redesign; test-seeder completeness (trajectories + admissions-first + AY9998); removed Markbook's manual add-student-to-section button + dead route (section membership flows only from admissions sync/assign/transfer — the SIS never creates identity, KD #51/#90/#67). Migration 069.
- Sprint 51 (2026-06-02): AY application window — SIS Admin owns open/switch/close (per-row `Switch`, single-select early-bird, rollover auto-open/close), Admissions read-only, readiness pill amber "Setup needed" (KD #118; extends KD #77/#48). No migration.
- Sprint 50 (2026-06-01): Late-enrollee position-aware joining-term decision — `resolveEnrolmentPosition` + Join-now/Start-next prompt across SIS + Markbook + Admissions editors; `enrollment_date` derived from chosen term (KD #117). No migration.
- Sprint 49 (2026-05-31): Attendance Daily view — Term sheet | Daily view toggle + "mark-the-exceptions" roster + today-centric day cards + student-lookup sheet + shared date-derived current-term resolver (`lib/sis/current-term.ts`) + global screen-size guard (KD #116). No migration.
- Sprint 48 (2026-05-30): Compare redesign — CompareGrid table rebuild (no heatmap, sticky col, AY borders, directional delta) + MultiSeriesTrendChart + Markbook subject-performance trend (KD #115).
- Sprints 28–46 (2026-04-29 → 2026-05-29): see development-plan.md. Highlights: KDs #63–113 + migrations 030–068; Sprint 44 = Markbook polish + SOW teardown (062–066); Sprint 45 = Records student detail (KDs #111–112, migration 067); Sprint 46 = edge-case hardening + attendance proration (KD #113, migration 068).

## Cross-reference note

Cross-references elsewhere in the repo such as "CLAUDE.md Hard Rule #N" or "CLAUDE.md KD #N" now resolve to `.claude/rules/hard-rules.md` and `.claude/rules/key-decisions.md` respectively. Numbering is preserved across all moves. KDs were split into per-topic files under `.claude/rules/key-decisions/` (the root file is the index + KD-to-topic map); existing "KD #N" cites still resolve via the index, and global numbering is unchanged.
