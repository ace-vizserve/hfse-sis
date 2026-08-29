# Phase 5 reconciliation — row-at-a-time writes and write amplification

Branch `perf/app-wide-query-pass`. Written 2026-08-29, at the end of Phase 5.

**What this document is for.** `scripts/audit/row-at-a-time-writes.ts` enumerates every
`.insert(` / `.update(` / `.upsert(` / `.rpc(` in `lib/` and `app/` that sits inside a loop or a
`.map()`. It reports twelve. This file resolves **every one of them** to _fixed_ or _exempt, with
a reason and a measured row count_, so a later pass can read this instead of re-auditing the
category. It also records the two rows the scanner cannot see, and the separate read-after-write
sweep.

**"Probably fine" is not a reason.** Every exemption below carries a production row count, taken by
`scripts/probe-write-amplification-scale.ts` (read-only) on 2026-08-29, or a code constant that can
be counted by reading one file. A loop over three rows is not a finding; the only way to tell a
three-row loop from a six-hundred-row one is to count.

---

## Production scale, measured 2026-08-29

`npx tsx --env-file=.env.local scripts/probe-write-amplification-scale.ts`

| Measure                                                 | Value                              |
| ------------------------------------------------------- | ---------------------------------- |
| `academic_years` rows                                   | 3                                  |
| …with `accepting_applications = true`                   | 2                                  |
| terms per AY                                            | 4 (AY2025), 3 (AY2026), 4 (AY2027) |
| `grading_sheets`, all years                             | 880                                |
| `grading_sheets` unlocked, all years                    | 32                                 |
| distinct `subject_configs` holding an unlocked sheet    | 8                                  |
| **most unlocked sheets under any ONE `subject_config`** | **8**                              |
| `approval_request_stages`, all                          | 16                                 |
| open named stages (the re-point loop's ceiling)         | 3                                  |
| active configured `approval_stages`                     | 2                                  |
| AY2025 `subject_configs`                                | 18                                 |
| **AY2025 `grading_sheets`**                             | **620**                            |
| AY2025 sections                                         | 22                                 |
| `public.students`                                       | 760                                |

⚠ The AY2026 terms row still reads **3**, not 4. That is the known Term 4 gap, not a measurement
artefact, and it is not this phase's to fix.

---

## The enumeration — twelve rows, all resolved

Line numbers are as of commit `a7335523`.

### Fixed

| #   | Site                                                                          | What it was                                       | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `lib/grading/recompute-sheet.ts:233` — `.update(...)` inside `.map()` > `for` | one UPDATE per grade entry, 26 deep for one sheet | **FIXED — `1095b494`.** Bounded waves of `WRITE_CONCURRENCY = 8`, mirroring `writeDailyBatch`. The shape the scanner still flags is deliberate and must stay: the one-upsert-per-sheet form does **not** work (`grade_entries.grading_sheet_id` and `.section_student_id` are `not null` with no default, and Postgres checks NOT NULL on the proposed tuple _before_ conflict resolution). roundTrips stay at 26 by design; only wave depth moves, 26 → 5. This does **not** make the write atomic, and saying so is part of the fix. |

Four more sites left the enumeration entirely because their loops are gone:

| Site (pre-Phase-5)                                                          | Verdict                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/audit/log-action.ts` — `logActions` was N single-row inserts           | **FIXED — `76b93e47`.** One array insert, with a per-row fallback on insert error so one bad row cannot lose 199 good ones. Row shaping extracted to a pure `toAuditRow()` used by both paths and pinned at 30 rows `toEqual`. Budget 30/1 → 1/1.                                                                                                                      |
| `app/api/relief/book/route.ts` — N identical UPDATEs                        | **FIXED — `31c3b22c`.** One `.update(patch).in('id', ids)`. The documented `done`/`failed` partial-write split became unreachable and was deleted rather than left implying an impossible state. Budget 13/13 → 4/4.                                                                                                                                                   |
| `lib/attendance/mutations.ts` — 525 sequential rollup RPCs on a term import | **FIXED — `3f541df7`, and measured first.** 404 unique (term, student) pairs at a median 85 ms = ~34.5 s of rollup latency in one HTTP request. Bounded waves of **four** — half `writeDailyBatch`'s eight, because an import's fan-out is the larger one → ~8.6 s. The old comment argued against _unbounded_ parallelism and still stands; nothing here is uncapped. |
| `app/api/attendance/daily/route.ts` — `requireCurrentAyCode` per cell       | **FIXED — `c7945582`.** `academic_years(ay_code)` folded into the sections select the handler already issues. Flagged as a **semantic change, not a refactor**: it now invalidates _the section's_ year rather than "whatever is current", which is the more correct answer for a back-dated correction.                                                               |

Item 6 of the brief — batching the grid client-side — was a **decision not to act**, and it holds.
Per-cell optimistic write/revert means a failed batch reverts cells marked minutes apart, and a lost
attendance mark is a compliance defect. The "375 cells per sitting" figure must not be used to argue
otherwise: 302 distinct (teacher, day) pairs at median 375 / max 401 against a ~400-student school
are bulk-import rows attributed to a service account. Interactive marking of one ~25-student class
cannot produce 401.

### Exempt

| #   | Site                                                                                     | Loop bound (measured)                            | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2   | `lib/approvals/config.ts:356` — `.update(...)` inside `for`                              | **exactly 3, always**                            | It is not a fan-out. Moving a stage up or down is a park/swap: write `stage_order = 32767`, move the neighbour into the vacated slot, move self into the neighbour's. The three writes are **order-dependent by construction** — they exist to dodge the unique index — so batching them would break the thing they are for. There are 2 active configured stages in production.                                                                                                                                                                                                                      |
| 3   | `lib/approvals/materialise.ts:336` — `.update(...)` inside `for`                         | **≤ 3**                                          | `repointWaitingStages` walks the _open, named-resolver_ stages of one flow. Production holds 16 `approval_request_stages` in total and **3** open named ones; the loop `continue`s on a label mismatch and again when the pool is unchanged, so the real write count is ≤ 3 and usually 0. It fires only when an administrator edits an approver step — twice, ever.                                                                                                                                                                                                                                  |
| 4   | `lib/grading/sync-config-sheets.ts:295` — qa_total restore                               | **≤ 8**                                          | Both loops walk the **unlocked** sheets of **one** subject config. 32 unlocked sheets exist school-wide across 8 configs, and the most any single config holds is **8**. Both writes are further conditional on the value actually changing (`stored !== prior` / `stored !== next`), so the common case is zero writes. This file is also on the pagination allowlist in `__tests__/data/no-unpaginated-high-volume-reads.test.ts`, whose stale-entry assertion fails the build if its shape changes — changing it to save at most 8 round trips on a rare admin action is not a trade worth making. |
| 5   | `lib/grading/sync-config-sheets.ts:306` — qa_total apply                                 | **≤ 8**                                          | Same loop, same bound, same reason.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 6   | `lib/p-files/freshen-document-statuses.ts:99` — `.update(...)` inside `.map()`           | **exactly 16, in ONE wave**                      | A scanner false positive: the `.map()` is the argument to a `Promise.all`, so this is already the parallel form. The count is a code constant — 8 slots carry an `expiryCol` in `lib/p-files/document-config.ts`, × {expire, revive} = 16 — and the two directions have mutually exclusive `WHERE` clauses on the status column so they cannot race for a row. They cannot be merged into one statement: each writes a different column to a different value.                                                                                                                                         |
| 7   | `lib/sync/students.ts:648` — student update                                              | **≤ 1**                                          | See the block note below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 8   | `lib/sync/students.ts:675` — enrolment insert                                            | **≤ 1**                                          | See the block note below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 9   | `lib/sync/students.ts:705` — status change                                               | **1, or 2 after a mid-year transfer**            | See the block note below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 10  | `app/api/grading-sheets/lock-overdue/route.ts:73` — `.update(...)` inside `for`          | **⌈sheets / 200⌉ — 4 for a whole backfilled AY** | A scanner false positive, and the opposite of the defect: this **is** the chunked bulk form. The loop slices ids 200 at a time and issues `.update(patch).in('id', slice)`, because the overdue scan spans every academic year and PostgREST serialises `.in()` into the URL (it fails past ~14.3 KB / ~396 uuids). Its own comment explains the chunk.                                                                                                                                                                                                                                               |
| 11  | `app/api/sections/[id]/students/[enrolmentId]/route.ts:350` — `.rpc(...)` inside `for`   | **≤ 4 (terms per AY)**                           | One `recompute_attendance_rollup` per term of the section's academic year, and an AY has 3–4 terms. It fires only when `enrollment_date` actually changed on one enrolment, compared against the prior value, so an idempotent re-save does nothing. The `continue` on a failed term is deliberate — the edit has already committed and a rollup hiccup is warned, never 500'd — so a batched call would have to reproduce per-term partial tolerance to buy back three round trips.                                                                                                                  |
| 12  | `app/api/sis/ay-setup/accepting-applications/route.ts:108` — `.update(...)` inside `for` | **≤ 2**                                          | `computeEarlyBirdClosures` returns the non-current years that must close so the toggle stays single-select. Production has **3** academic years, **2** currently accepting, so the ceiling is 2 and the usual case is 1. Each write is paired with its own `logAction` row naming the year it closed; collapsing the updates would either lose that per-year audit detail or keep the loop anyway to write it.                                                                                                                                                                                        |

**Rows 7–9, the `lib/sync/students.ts` block.** These read like row-at-a-time writes and are not.
`syncOneStudent` calls `buildSyncPlan([admissionsRow], snapshot)` — a **one-row** roster against a
snapshot holding **one** student — so the planner can emit at most one student upsert and at most
one enrolment insert. `enrollment_status_changes` is bounded by that one student's own enrolment
rows in the AY: one normally, two after a mid-year transfer. Batching them collapses nothing.

The roster-sized caller is `POST /api/students/sync`, which already writes in single batched
statements, and the per-student fan-out through `syncOneStudent` is capped at waves of five by
`app/api/sis/students/auto-sync/route.ts`. A note saying all of this now sits in the source, above
the loops, together with the reason the object literals stay field-scoped (KD #178 — widening them
to a spread would null every student's house on the next nightly cron with no error and no audit
entry; `__tests__/sis/students-sync-preserves-attributes.test.ts` bans the spread outright).

⚠ **The brief said the chunked form "sits 20 lines below" in this file. It does not.**
`lib/sync/students.ts` contains no chunked _write_ at all; the only chunk-shaped helper it uses is
`fetchAllPages`, which is a read.

---

## Two rows the scanner cannot see

`scripts/audit/row-at-a-time-writes.ts` walks `lib/` and `app/` only. `scripts/` is outside it, and
that is where the real instance of item 7 was.

| Site                                                           | Bound (measured) | Verdict                 |
| -------------------------------------------------------------- | ---------------- | ----------------------- |
| `scripts/backfill/ay2025-grades.ts` — `subject_configs` upsert | **18**           | **FIXED — `2d3a8ea8`.** |
| `scripts/backfill/ay2025-grades.ts` — `grading_sheets` upsert  | **620**          | **FIXED — `2d3a8ea8`.** |

Both wrote one row per round trip while the `grade_entries` pass twenty lines below already chunked
at 500 — 638 statements doing the work of four. Both now reuse that shape, with `CHUNK` hoisted so
the three writes cannot drift apart. `ignoreDuplicates: true` is untouched so the script stays
idempotent, and neither chunk can carry an in-batch duplicate because both source `Map`s are keyed
on exactly their conflict target.

One behaviour genuinely improves: resolving every sheet row _before_ writing any of them means a
missing `subject_config` is now fatal **before** a partial prefix of sheets has landed.

⚠ **The brief's figures for this file were wrong in both directions** — it said "~260 sheets and
~100 configs". Production holds **620** sheets and **18** configs for AY2025. It was right that this
is the real instance.

---

## The read-after-write category — swept, not sampled

The brief named one instance and said the category was otherwise clean. **It was not: there were
two, and the second is the one that runs on a schedule.**

**What was searched.** Every `.insert(` and `.upsert(` in `app/`, `lib/` **and** `scripts/` — 56
sites — resolved to its table by the nearest preceding `.from('…')`, then checked for a _separate_
later `.from('<same table>')….select(` within 120 lines. Plus every `.rpc(` followed by a `.select(`
within 20 lines. Ten insert/upsert sites and one rpc site matched the shape; each was read.

| Site                                                     | Verdict                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/api/students/sync/route.ts`                         | **FIXED — `a7335523`.** Re-selected `students` by `student_number` to build the enrolment payload. Now seeds `idByNumber` from the snapshot and fills it from `.insert(…).select('id, student_number')`. A student the planner did not plan to insert _was_ in the snapshot — that is exactly how the planner decided — so there is no third case.                        |
| `lib/sync/students.ts`                                   | **FIXED — `a7335523`. Not named by the brief.** `syncOneStudent` inserted, then read `students` back by `student_number` for every fresh enrolment. That is the nightly auto-sync's unsynced queue, five students to a wave, so it paid the extra trip **per newly-enrolled child** rather than once per run. Now captured from `.insert(…).select('id')`.                |
| `app/api/sis/admin/subjects/level-offerings/route.ts:87` | Clean. `.select('subject_id')` is chained on the upsert itself, and is there to tell an actual change from a `DO NOTHING` no-op so the audit row does not claim a state change that never happened. The later select the scanner saw is the _delete_ branch doing the same thing.                                                                                         |
| `lib/approvals/materialise.ts:171`                       | Clean. `.select('id').single()` is chained on the insert. The later read lives inside the `23505` branch — the row already existed and **nothing was written**, so that is a genuine lookup, not a read-back.                                                                                                                                                             |
| `lib/approvals/materialise.ts:233`                       | Clean. `.insert(stageRows)` needs no ids back. The later read of the same table is `repointWaitingStages`, a different function with a different purpose.                                                                                                                                                                                                                 |
| `lib/approvals/config.ts:259`                            | Clean. `.select('id, flow, stage_order, label, resolver').single()` chained on the insert.                                                                                                                                                                                                                                                                                |
| `lib/approvals/config.ts:398`                            | Clean. `.select('id').single()` chained on the insert.                                                                                                                                                                                                                                                                                                                    |
| `lib/attendance/calendar.ts:380`                         | Clean. Takes `count: 'exact'` off the upsert instead of re-reading. The later match is a different exported function further down the file.                                                                                                                                                                                                                               |
| `app/api/attendance/calendar/route.ts:69`                | Clean. Same `count: 'exact'` pattern; the later select belongs to the bulk-upsert branch, a different code path.                                                                                                                                                                                                                                                          |
| `app/api/report-card-publications/route.ts:144`          | Clean. `.select(…).single()` chained on the upsert. The later write-then-read on the same table is the **atomic `notified_at` claim** (`.update(…).is('notified_at', null).select()`), which exists because two concurrent publishes once both emailed every parent in the section. It must stay exactly as it is.                                                        |
| `scripts/backfill/ay2025-grades.ts:256, :308`            | **Exempt, and necessary.** Both upserts pass `ignoreDuplicates: true`, so PostgREST issues `ON CONFLICT DO NOTHING` and returns **nothing for rows that already existed**. On an idempotent re-run the follow-up select is the only way to resolve ids for the rows the write skipped. Chaining `.select()` would return the fresh rows only, and silently lose the rest. |
| `scripts/verify-approval-migrations.ts:86`               | Clean. A read-only verifier; the `.rpc(` is the anon-key permission probe that migration 103 taught us to make.                                                                                                                                                                                                                                                           |

**The category is now clean.** Both real instances are fixed and every other match is accounted for
above. A future pass should not re-audit it.

---

## Budgets — none moved

| Surface                   | roundTrips | waves | Touched by Phase 5 items 7–8? |
| ------------------------- | ---------- | ----- | ----------------------------- |
| `buildReportCard`         | 11         | 11    | no                            |
| adviser dashboard         | 42         | 11    | no                            |
| classroom section page    | 11         | 2     | no                            |
| `recomputeSheetEntries`   | 26         | 5     | no (set by `1095b494`)        |
| `logActions` (30 rows)    | 1          | 1     | no (set by `76b93e47`)        |
| relief bulk book          | 4          | 4     | no (set by `31c3b22c`)        |
| attendance student detail | 20         | 12    | no                            |

No budgeted surface reaches `app/api/students/sync/route.ts`, `lib/sync/students.ts`'s commit path
or the AY2025 backfill script, and `__tests__/perf/query-budget.test.ts` is green unchanged.
`npx vitest run __tests__/sis __tests__/perf __tests__/data --testTimeout=30000` → **106 files,
990 tests, all passing.** `npx tsc --noEmit` clean.

---

## What the brief got wrong

1. **`lib/sync/students.ts` is not a per-row-upsert finding.** Its three flagged loops each run at
   most once, because the planner is handed a one-row roster. Exempt, not fixed.
2. **"The chunked form sits in the same file" is false for `lib/sync/students.ts`.** There is no
   chunked write in it; `fetchAllPages` is a read helper.
3. **The AY2025 backfill numbers were wrong in both directions** — "~260 sheets and ~100 configs"
   against a measured **620 sheets and 18 configs**. The conclusion it drew from them was still
   right.
4. **The read-after-write category was not "otherwise clean".** There were two instances, and the
   unnamed one — `lib/sync/students.ts` — is the one on the nightly cron. It was found by grepping
   the _shape_ across `app/`, `lib/` and `scripts/` rather than opening the one site the brief named.
   This is the third time on this pass that searching the concept instead of the named site changed
   the answer.
