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

**Current state (2026-07-31 — pushed to `origin/main` @ `79c8f8ac`):** **New KD #166/#167/#168; migrations 101–104 applied.** **(1) Capability layer** (KD #166, migrations 101/102) — authorization vocabulary is code (`lib/auth/capabilities.ts`), grants are data (`role_permissions`, edited by a superadmin at `/sis/admin/roles`). Driven by two real needs role-names can't meet: one person validates documents on BOTH sides of enrolment, and `school_admin` does two jobs. **`requireCapability` is signature-identical to `requireRole`**, so this is additive — the other ~90 `requireRole` sites are untouched and correct. `DEFAULT_ROLE_CAPABILITIES` reproduces prior behaviour exactly (asymmetries deliberately preserved, not tidied), and every failure path falls back to it, which is why the code was safe to deploy before 101 landed. **(2) Seven `SECURITY DEFINER` RPCs were callable by any signed-in session** (KD #167, migrations 103/104) — `authenticated` includes **parents** here, and DEFINER bypasses RLS, so a parent could renumber a class or seed grade entries straight through PostgREST. 103 revoked from `authenticated` only; **104 was needed because `anon` still held the grant** — revoke from both. **(3) Document Completeness table** (KD #168) — the 13-column status-dot matrix is gone; colour now encodes the ACTION (5) and the chip's word+icon the CAUSE (7), which is what lets the new permanent legend hold one meaning per swatch. Per-slot detail left the screen, not the CSV. **(4) P-Files student page** — every actionable document was rendering twice with different labels for the same dialogs; queue is now where you work, cards are the record. 2230 tests + build clean. **Not verified in a browser** — no logged-in pass on `/p-files` or `/admissions` for the new table, and `/sis/admin/roles` likewise unexercised by a real superadmin session. ⚠ Pre-existing flake `__tests__/attendance/student-lookup-sheet.test.tsx` (5s timeout, ~2 in 5 full runs, passes alone) can still redden CI.

**Since then (2026-07-31, all on main):** **KD #169 + migration 105 — the academic coordinator now has SIS Admin as a module**, not three URLs: she gets the switcher tile, the SIS sidebar, and `subjects.*` + `academic_year.*` (capped at school_admin's — no `academic_year.delete`). ⚠ **Migration 105 must be applied or the grant is inert** — `role_permissions` is authoritative over the code defaults once populated (KD #166), so a code-only deploy gives her the tile and bounces her off the two new pages. Also: the attendance dashboard's top-of-fold no longer waits on the full-year `buildAllRowSets` scan (narrow `getCompassionateOverQuota` + one `<Suspense>`), salvaged from a branch since deleted.

**Branch cleanup (2026-07-31):** `feat/sis-admin-consolidation` and `worktree-fix-drill-sheet-data-loss` were both **deleted unmerged**. The consolidation's spec/plan/mockup were lifted onto main and re-headed as abandoned (its plan file used to instruct an agent to implement it — now carries a stop notice); see the abandoned banner for why it's dead, not parked. From the drill-sheet branch only the attendance work was taken; its five other streaming commits are gone. Remaining local branches are `feat/role-permissions` (== main) and ~16 `worktree-agent-*` — none reviewed here.

**Recently landed and now stable (detail in the KDs, not here):** Classroom module (KD #160), column labels (KD #161), simplified CSV export (KD #162). Findings worth keeping: `residenceHistory` is **heterogeneously typed in prod** (JSON string from the portal/seeder, real array from the SIS edit route) so any type probe must scan every value, never the first non-null; `csv.extraColumns` means `defaultChecked:true` = always exported, omitted = **never**; and **the parent portal reads some tables DIRECTLY as the parent** — only `school_config` + `report_card_publications` are parent-readable, everything else silently returns zero rows.

**Future work (deferred backlog):** late-semantics **C1** (derive the late label from earliest-enrollment across the ~8 enum sites — hardening, not a bug) + multi-interval re-enrol proration (known limitation); per-module compare trend charts (post-go-live); Sec 4 Economics card (no Sec 4 students yet); self-serve invite flow (KD #87, `/auth/setup`); attendance audit-log server-side pagination; VL bulk-import parser (KD #94); PTC digitization as a separate surface (DB tables intact, KD #114); **config-placement review** — operator-tuned settings → business module, structural config stays in SIS Admin (KD #48; clearest candidate discount-codes → Admissions; **do NOT reverse KD #118** — early-bird stays in SIS).

**Recent sprints:** full sprint-by-sprint history (Sprint 28→67 + the 2026-07 bug-hunt, KDs #63–168, migrations 030–104) lives in `docs/sprints/development-plan.md` (status snapshot at top) + `git log`. Don't duplicate it here. Sprint-60 work (KD #144/#145/#146, migration 074, pagination fixes, seeder-fidelity batch) is on prod — see the dev-plan snapshot.

## Cross-reference note

Cross-references elsewhere in the repo such as "CLAUDE.md Hard Rule #N" or "CLAUDE.md KD #N" now resolve to `.claude/rules/hard-rules.md` and `.claude/rules/key-decisions.md` respectively. Numbering is preserved across all moves. KDs were split into per-topic files under `.claude/rules/key-decisions/` (the root file is the index + KD-to-topic map); existing "KD #N" cites still resolve via the index, and global numbering is unchanged.
