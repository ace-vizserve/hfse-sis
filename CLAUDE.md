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

**Current state (2026-07-29 latest — same UNPUSHED branch `feat/datatable-column-labels`):** **CSV export simplified** (new KD #162). All 16 exporting tables rendered the same ~1109-line five-section sheet; 14 had nothing to configure. Now 15 download instantly (content byte-identical to the old untouched export, rows from `table.getSortedRowModel()` so the file can't disagree with the screen), and `StudentDataTable` alone keeps a small sheet: row count + 3-option radio (What's on screen / Full application record / Full record + pipeline) reusing the existing raw-columns route untouched. `export-sheet.tsx` 1109→212 lines; `@dnd-kit` uninstalled. **Two findings worth remembering:** (1) your ruling "drop object columns" exposed that **`residenceHistory` is heterogeneously typed in prod** — JSON string from the portal/seeder, real array from the SIS edit route — so a first-non-null probe made the export **sort-dependent**; the rule is now scan-every-value. (2) `csv.extraColumns` semantics flipped with the picker's deletion: `defaultChecked:true` = always exported, omitted = **never** exported. **Also (your call): the `#` index-number column was removed from all four CROSS-SECTION surfaces** — `/records/students` + the 3 Academic Summary quick views — since an index is a roll number _within_ a section (KD #135 amended; data + masterfile S/N untouched; the hub drill sheet still shows one, pending your call). 2054 tests + build clean. **Not yet done: browser pass on the export changes.**

**Current state (2026-07-29 later — on branch `feat/datatable-column-labels`, UNPUSHED):** **DataTable column display names** (new KD #161, browser-verified): the shared shell's "Columns" menu AND the CSV header row both derived a label as `typeof header === 'string' ? header : column.id` — and since ~every table writes `header: ({column}) => <SortableHeader>`, that fell through to the raw id on **140 columns across 33 files** (`levelLabel`, `fcaName`, and generated ids like `writeups_<uuid>`). New `components/ui/data-table/column-label.ts` resolves `meta.label` → non-empty string header → `humanizeFieldName(id)`, plus a `ColumnMeta` augmentation. **Auto-humanize alone was measured insufficient** — 100 of 140 humanize to text differing from their header, ~40 into different WORDS (`owner`→"Owner" vs header "Level") — hence explicit labels everywhere. **The non-obvious gotcha: `enableHiding: false` does NOT exempt a column**, because the export gates on id + `excludeFromExport` only, so non-hidable identifier columns still ship their label as a CSV header; my first agent-batch instruction got this wrong and the widened guard caught 10 more columns plus a whole table I'd failed to assign. Guarded by a TS-compiler-API coverage test that auto-discovers consumers, proven to bite on both a removed label and a stale renamed header. **⚠ Branch caveat:** this branch also carries 6 commits from a PARALLEL session (evaluation sections list de-term-scoping + per-term write-up progress restore, and two PostgREST oversized-`.in()` URL-ceiling fixes) — it is not solely this work; decide how to split before any PR. 2022 tests + build clean.

**Current state (2026-07-29 — pushed to `origin/main` @ `16d18aef`):** **Classroom module shipped** (new KD #160) — one `section × term` staff workspace, as a PEER module (not a parent: the teaching modules keep all their cross-section surfaces). 8 phases, all on main. **Capability model is RLS-derived, not preference** — `lib/classroom/scope.ts` (pure, tested) resolves `adviser | subject | oversight`; attendance + FCA write-ups are `is_adviser_for_section` at the DB, so a subject-teacher-only user genuinely can't read them and gets a narrowed page. Two pinned invariants: `sectionIds` null = all, `[]` = none (conflating them shows every class to a role with none), and adviser beats subject regardless of DB row order. **Scope correction that removed a lot of speculative work: students and parents are NOT users of this system** — every vision feature premised on a student/parent consumer (resources, announcements, assignments, messaging) has no audience and is permanently out. Likewise nothing policy-shaped may enter Settings: "Default Score 0" breaks Hard Rule #3, rounding/auto-calc toggles break #1–2, custom excused reasons need a CHECK migration, "late after 8:15" has no timestamp to compute from. **Phase 7 was my over-reach and was reverted in Phase 8** — repointing every teaching module's nav at `/classroom` made a teacher's daily attendance 4 clicks. Handoff now happens at the ROW level per role: teachers land in the matching Classroom tab, oversight stays on the module's own surface. `/markbook/sections` gained teacher scoping it never had (it showed every user every class). **Migration 094 applied** (`classroom_notes`, private per-teacher, RLS select-own with NO oversight bypass). **Deferred:** subject-teacher-only users still see dead-end Attendance/Evaluation tiles (the switcher filters on role, not assignments); retiring the 3 section lists; embedding the grids. 1995 tests + build clean. **Not yet done: NOTHING in Classroom or the KD #157 validation-parity UI has been opened in a browser.**

**Future work (deferred backlog):** late-semantics **C1** (derive the late label from earliest-enrollment across the ~8 enum sites — hardening, not a bug) + multi-interval re-enrol proration (known limitation); per-module compare trend charts (post-go-live); Sec 4 Economics card (no Sec 4 students yet); self-serve invite flow (KD #87, `/auth/setup`); attendance audit-log server-side pagination; VL bulk-import parser (KD #94); PTC digitization as a separate surface (DB tables intact, KD #114); **config-placement review** — operator-tuned settings → business module, structural config stays in SIS Admin (KD #48; clearest candidate discount-codes → Admissions; **do NOT reverse KD #118** — early-bird stays in SIS).

**Recent sprints:** full sprint-by-sprint history (Sprint 28→67 + the 2026-07 bug-hunt, KDs #63–161, migrations 030–094) lives in `docs/sprints/development-plan.md` (status snapshot at top) + `git log`. Don't duplicate it here. Sprint-60 work (KD #144/#145/#146, migration 074, pagination fixes, seeder-fidelity batch) is on prod — see the dev-plan snapshot.

## Cross-reference note

Cross-references elsewhere in the repo such as "CLAUDE.md Hard Rule #N" or "CLAUDE.md KD #N" now resolve to `.claude/rules/hard-rules.md` and `.claude/rules/key-decisions.md` respectively. Numbering is preserved across all moves. KDs were split into per-topic files under `.claude/rules/key-decisions/` (the root file is the index + KD-to-topic map); existing "KD #N" cites still resolve via the index, and global numbering is unchanged.
