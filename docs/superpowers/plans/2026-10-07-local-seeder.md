# Local seeder — a complete, realistic fake dataset for the local Supabase stack

**Goal.** `npm run local:rebuild` wipes the local stack's people-data and rebuilds a
small but production-shaped fake dataset across **every live module**, on top of the
real setup data copied from production (`npm run local:refresh`). Every table
that has rows in production gets rows locally; only the counts are small.

**Sources.**

- Production profile (aggregates only): `…/scratchpad/prod-profile.md` (this session's
  scratchpad). Targets below come from it.
- The deleted seeder, `git show 56d00da9^:lib/sis/seeder/<file>` — reuse
  `names.ts`, `random.ts`, and the admissions personas from `admissions-minimal.ts`
  (renumbered). Do **not** revive its hand-rolled grade maths, fake audit rows or
  direct transfers — that is the false-bug source KD #52 cites.

**Out of scope, never written:** `directus_*`, `careers_*`, the dormant PTC tables
(`evaluation_checklist_items/_responses`, `evaluation_subject_comments`,
`evaluation_ptc_feedback`), `subject_weight_reconciliation_log`, and the setup
tables already copied (academic_years, terms, levels, level_aliases, subjects,
subject_configs, subject_level_offerings, subject_report_map, sections,
section_subjects, school_config, school_calendar, calendar_events,
evaluation_terms, role_permissions, houses, house_point_scales,
admission_options, approval_stages).

## Ground rules (every phase)

1. **Local only.** Every entry point refuses a Supabase URL that is not
   127.0.0.1/localhost (same guard as `scripts/local/seed-local.mjs`).
2. **Real write paths first.** Call the app's own lib functions / RPCs / triggers
   wherever they exist (student sync, `create_grading_sheets_for_ay`,
   `writeDailyBatch`, `transfer_student_section`, `generate_section_index_numbers`,
   `openApprovalRequest`/`decideApproval`, `createDisciplineRecord`,
   `openDeclarationApprovals`, `logAction`). Insert directly only where no writer
   exists (admissions tables — the portal owns them; house points; sheet locks;
   publications). Grades: write **raw scores only** — the derive trigger computes.
3. **Deterministic.** Seeded RNG (`random.ts` mulberry32), fixed "today" anchor
   2026-10-07 (AY2026 T4 in progress). Re-running produces the same data.
4. **Fake people, real shapes.** Invented names/contacts; values for categorical
   columns drawn from production's actual distributions **including its mess**
   (spelling variants, junk nationalities, blank-heavy columns, "Year 9"-style
   level labels). Free text is generated, never copied.
5. **Every edge case at least once** (listed per phase).
6. **Every new feature gets its own phase** (e.g. `sow`) that only ADDS rows and
   is idempotent on its own, so after a `git pull` a developer can run
   `npm run local:migrate` (new tables, keeps their test data) and
   `npm run local:seed -- --only <feature>` (new feature's rows, no wipe).
   Only reshaping existing fake data needs `npm run local:rebuild`.
7. Files live in `scripts/local/seed/` (TypeScript, run with `tsx`). Phase 0
   proves the harness can import `lib/**` (server-only / next/cache) before
   anything else is written.

## Target counts (from the profile)

| Area                                 | Target                                                                                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staff accounts                       | ~22: superadmin, coordinators, school_admin approvers (OIC P/S, Asst P, AEB), admissions, p_file_officer, ~14 teachers incl. relief                                   |
| students                             | ~330: ~175 in AY2025+AY2026, ~60 AY2025-only, ~70 AY2026-only, ~25 with no class row, 4 AY2027; 2–3 duplicate-name pairs; ~28% school_student_number; ~51% house      |
| section_students                     | AY2025 ~240 (18 withdrawn, 8 late T1–T3); AY2026 ~250 (12 withdrawn w/ dates, 12 late T3, index holes in ~1/3 of sections, 1 transfer); AY2027 4                      |
| Admissions apps/status/docs          | AY2025 ~300 (~25% no status row, legacy contract values, all medical/STP null); AY2026 ~290; AY2027 30 (26 Submitted / 3 Enrolled, 25 Current / 5 New, ~26 returning) |
| Discount codes                       | AY2026 20, AY2027 10, AY2025 0                                                                                                                                        |
| teacher_assignments                  | AY2026 only: 21 advisers, ~115 subject, 4 co-teachers, 3 ended reliefs + the 1 live relief for the SOW demo                                                           |
| grading_sheets                       | via RPC, ~1 per section_subject per term; lock pattern: AY2025 all, AY2026 T1–T2 all, T3 a few, T4 none; ~38 with custom weights                                      |
| grade_entries                        | ~12k raw scores: WW p50 87%, PT 85%, QA 77%; ~7% blank, <1% zero; AY2025 T4 quarterly-only; AY2026 T4 ~98% blank; ~8% non-examinable                                  |
| grade_audit_log / CRs / approvals    | ~150 / 2 applied / 6 requests (declarations: approved + rejected), 2 approver_assignments, 10 stage approvers                                                         |
| report_card_publications             | 1 (AY2026 T3)                                                                                                                                                         |
| attendance_daily / records           | every student × school day (~85k) via `writeDailyBatch`: 95% P, 2.5% EX (mc/vacation, ~30% with note), 1.3% A, 0.7% L; ~30% of students never absent                  |
| evaluation_writeups                  | ~1.1k, ~95% coverage AY2025 T1–T3 & AY2026 T1–T2, 2 in AY2026 T3                                                                                                      |
| p_file_revisions / outreach          | ~1.5k via doc-URL updates (trigger) / 3                                                                                                                               |
| student_declarations                 | 15 (absence w/ medical approved, plain absence, rejected, travel)                                                                                                     |
| discipline                           | 1 incident (+1 letter to cover both record types)                                                                                                                     |
| house points                         | 8 events, ~120 entries, ~30 places, 8 teams, ~15 members                                                                                                              |
| application_drafts / recovery_tokens | 10 / 5                                                                                                                                                                |
| classroom_notes                      | a few (live feature, unused in prod)                                                                                                                                  |
| audit_log                            | whatever the real write paths emit, topped up to ~2k attendance-dominated rows via `logAction`                                                                        |

## Phases — each gated by its check before the next starts

| #   | Phase                                                                                                                                                                                                                                    | Check (must pass)                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Harness: `scripts/local/seed/` runner, local guard, RNG/names, wipe of people-data tables (keeps setup data), staff accounts + approver wiring. Prove one `lib/**` writer imports and runs.                                              | Wipe → re-run leaves identical counts; a teacher logs in; `lib` import works                                                                            |
| 1   | People + admissions: students, AY2025/AY2026 apps/status/docs with profile distributions, sync through `syncOneStudent`, class lists, index numbers, houses, school numbers, late/withdrawn/transfer, the admissions-vs-class mismatches | Counts within ±10% of targets; returning students share a student number across years; `/records/students` and `/admissions` load with sensible numbers |
| 2   | Teacher assignments (AY2026) + reliefs                                                                                                                                                                                                   | Classroom shows each teacher their classes; relief panel shows the live cover                                                                           |
| 3   | Markbook: sheets via RPC, raw scores, custom weights, locks, AY2025 T4 quarterly-only, publication, grade audit, the 2 applied CRs                                                                                                       | Derive trigger produced the grades; distributions match targets; Hard Rule #1 canonical case untouched; grading sheet page renders                      |
| 4   | Attendance via `writeDailyBatch`                                                                                                                                                                                                         | No row on a non-teaching day; rollups match; % mix matches                                                                                              |
| 5   | Evaluation writeups                                                                                                                                                                                                                      | Coverage + lengths match                                                                                                                                |
| 6   | Approvals + declarations + discipline + classroom notes                                                                                                                                                                                  | Every approval state present; inboxes render                                                                                                            |
| 7   | P-Files revisions/outreach, house points, drafts/tokens, discount codes, AY2027 funnel                                                                                                                                                   | P-Files dashboard + house standings render                                                                                                              |
| 8   | `npm run local:rebuild` (stack reset → schema → setup data → seed), docs (`docs/context/24-local-dev.md`), CLAUDE.md pointer                                                                                                             | One command from empty to full, twice, same counts                                                                                                      |

Execution: one implementer subagent per phase, a reviewer pass after each, phase
check run and reported before the next phase starts.

## Local seeder — status (2026-10-07)

All phases done, each check passing:

| #   | Phase                                                                            | Status                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Harness, wipe, staff + approver wiring                                           | ✅ done                                                                                                                                                                                                                                                 |
| 1   | People + admissions                                                              | ✅ done                                                                                                                                                                                                                                                 |
| 2   | Teacher assignments + reliefs                                                    | ✅ done                                                                                                                                                                                                                                                 |
| 3   | Markbook (+ publication)                                                         | ✅ done                                                                                                                                                                                                                                                 |
| 4   | Attendance                                                                       | ✅ done                                                                                                                                                                                                                                                 |
| 5   | Evaluation writeups                                                              | ✅ done                                                                                                                                                                                                                                                 |
| 6   | Declarations + approvals, discipline, classroom notes                            | ✅ done (review fixes: audit / register repair after a crash, no cancelled filing — no app path withdraws one, ladders removed with a failed filing, run-date clock guard, trips never push a child over the vacation quota, incident on a Present day) |
| 7   | P-Files history + outreach, house points, drafts + recovery tokens               | ✅ done (review fixes: no re-upload before its application, plan from the seeded document rows, outreach re-read on re-run, recovery tokens point at status + documents records with no application, drafts dated from the run date)                    |
| 8   | `npm run local:rebuild`, `npm run local:refresh`, `docs/context/24-local-dev.md` | ✅ done — two rebuilds from empty, every check PASS, identical fingerprints                                                                                                                                                                             |

How to use it: `docs/context/24-local-dev.md`. The CLAUDE.md pointer is left
to the next docs sync (CLAUDE.md is not edited by this work); the status
snapshot in `docs/sprints/development-plan.md` points at the doc.
