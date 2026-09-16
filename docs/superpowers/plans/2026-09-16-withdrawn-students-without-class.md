# Handoff — withdrawn students without a class, and what shipped on 15–16 Sep

## Context

Two training sessions on 2026-09-15 (Miss Joann; the Admissions team) produced 27 action items. Working through them shipped four pieces of code and uncovered one data problem too large to finish in that session.

**The open problem:** 21 of AY2026's 23 withdrawn students have **no `section_students` row at all**. Mr Ace, 2026-09-16: _"you cant be an enrolled student and be withdrawn with no class assignment."_ Hard Rule #6 says a withdrawn student keeps their row and their retired index number; these children vanished from their rosters instead. Three were found and fixed one at a time (Jannat Ajmal, Ashley Rae Cama, and Muhammad Ibrahim still pending) before a remarks sweep turned up the rest in one pass.

**Why this session stops here:** placing them needs Miss Jo's masterlist, which Mr Ace has requested from Miss Apple Grace and has not yet received. The admissions record gives each child's **level**, not their **class or index number** — and a hole in a roster proves somebody is missing, never _who_. Guessing would put a child in another child's slot.

**The previous plan in this file (per-term grading weights) is DONE** — shipped as KD #218, migration 159 applied. Nothing from it is outstanding except a browser check.

---

## State of the repo

**Branch `main`, 11 commits ahead of `origin/main`, nothing pushed.** One of them (`5c4607f1` student search) is from another session — check before pushing.

```
f6a123f2  fix(sis): don't offer to assign a class to a student who has one
b179f4d0  chore(admissions): survey of what lives in the remarks fields
c81f9f03  feat(records): a withdrawal records the two dates the school keeps
5c4607f1  feat(search): one query for student search        ← another session
46e0af97  feat(records): the dates behind the counts, and one child's record as a file
284e1f9a  fix(sis): the index button says it renumbers, because it renumbers
adb72397  docs: sync for the per-term grading weights work (KD #218)
f65bdfbe  docs: record the two 2026-09-15 training sessions
1e2af350  feat(markbook): a term can say it has no exam (migration 159)
```

### Blocker before any deploy

✅ **Migration 163 APPLIED 2026-09-16** and verified against production: both columns readable, `withdrawal_approved_date` on 0 rows, `withdrawal_date` on 11 (the pre-163 auto-stamped dates plus Cama). Migration 159 was applied the day before. **Nothing is blocked on a migration any more.**

🔴 **Nothing from either day has been browser-verified.** Not one of these screens has been clicked by a human — see the list at the end.

### Uncommitted, deliberately

```
scripts/audit-withdrawn-without-class.ts            ← the audit behind this plan
scripts/backfill/gen-withdrawal-dates-from-remarks.ts
scripts/backfill/withdrawal-dates-from-remarks-apply.sql   ⚠ CONTAINS A STUDENT NAME
```

⚠ **The `.sql` must be gitignored before anything is committed** — it holds real names, and every other generated backfill file in this repo is ignored for that reason (see the `scripts/backfill/*-apply/` entries in `.gitignore`). The two `.ts` files are safe to commit.

---

## The main job: put 21 withdrawn students back on their rosters

### What is known

`npx tsx --env-file=.env.local scripts/audit-withdrawn-without-class.ts --ay AY2026` prints the whole picture and is safe to re-run. As of 2026-09-16:

- **21 withdrawn students have no class row.** 10 of them have **no `students` row at all** — the SIS does not know those children exist in any module.
- **27 index holes across 13 sections.** The counts do not match, so the holes are _partly_ these students and partly something else. Do not assume one explains the other.
- **Four of the 21 are not in a numbered class**: Ferrer (YoungStarter Little Star), Manlapaz (Youngstarters | Junior Stars), and Muhammad Ibrahim (Primary Six, no P6 hole to match).
- ⚠ **`E260303` and `E260494` are the same child** — "SANTOS, KAIRO ALONZO, VELASCO", Primary Four, two enrolee numbers. Same duplicate-application signature as the three student numbers merged on 2026-09-15. Resolve before placing him, or he goes in twice.

### What is waiting

**Miss Jo's masterlist, requested from Miss Apple Grace.** It carries the complete student list with withdrawn status, index numbers, sections and levels — which is exactly the mapping the SIS cannot infer.

### When it arrives

1. **Re-run the audit** — the numbers will have moved.
2. **Build one reviewed placement script** modelled on `scripts/backfill/apply-cama-s3-consistency-placement.ts`, which is the precedent Mr Ace has already read and approved. It shows the shape: a header carrying the reasoning, a dry run by default, a refusal if the slot is taken, a read-back afterwards, and an explicit note that a service-role write leaves no `audit_log` row.
3. **Create the missing `students` rows too** — 10 of the 21 need one, like Cama did. Not just a roster row.
4. **Set `withdrawal_date` from the masterlist or the remarks**, using `scripts/backfill/gen-withdrawal-dates-from-remarks.ts` for the ones the office wrote down. It is deliberately timid: it emits a row only when the last day is unambiguous, and puts everything else in a human pile.

⚠ **`unique (section_id, index_number)` is NON-DEFERRABLE.** If any placement needs to shift existing students, the target slot must be free before it is written — see the Ajmal script's header for a worked three-step sequence, or migration 147's negative-index staging for the general case.

⚠ **Withdrawn rows carry `withdrawal_date = null` harmlessly, but they will not appear in the Records Withdrawals count** — that count keys on the date, not the status. Worth raising with Mr Ace as its own question once the placements land.

---

## Also open, smaller

|                                |                                                                                                                                                                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Muhammad Ibrahim (H250921)** | Withdrawn, Primary Six, no roster row. Needs a class named — will likely come with the masterlist.                                                                                                                                                                             |
| **Term 3 grading import**      | The last real build item from the registrar session. No importer exists; T1 and T2 each needed their own design doc and plan plus correction passes. **Unblocked by migration 159** — without per-term weights it would corrupt Filipino and Global Perspectives a third time. |
| **S3 Consistency #25**         | Still an unexplained hole. #5 turned out to be Cama.                                                                                                                                                                                                                           |
| **Late-enrollee bucket**       | The renumber reads `enrollment_date > T1 start`, and 377 of 398 rows have `NULL` (which the backfill writes deliberately to mean "on time"). Mr Ace: resolves itself in AY2027 once enrolment runs through the system. **Do not reopen.**                                      |

---

## Gotchas from these two days — do not rediscover these

- 🔴 **Read `ay{YYYY}_enrolment_status` for a student's stage, never `_enrolment_applications`.** The latter still says "Registered" for students the office has withdrawn. This produced two confidently wrong answers before Mr Ace corrected it.
- 🔴 **`subjects.is_examinable` means numeric-vs-LETTER grading, not "has an exam."** It has no academic-year dimension. See KD #218.
- **The office's real records live in `applicationRemarks` and friends** — 477 of 495 AY2026 rows carry one. `scripts/audit-admissions-remarks.ts` surveys them. Reviewed with Mr Ace and deliberately **not** acted on beyond the withdrawal dates.
- **A new API route file does not reliably reach a running `next dev`.** Restart before reading any more code. Replicate the handler's queries in a throwaway `tsx` script first — that splits the data layer from the HTTP layer in one run.
- **Index numbers are auto-assigned** (`max + 1`, counting withdrawn) at placement, and alphabetised only by the deliberate Renumber A–Z. Mr Ace's rule: assign → number; anyone arriving after that is late and goes to the bottom. **This already works; a readiness card for it was built, measured, found to give bad advice, and deleted.**
- ⚠ **Match process weight to the task.** This session over-built twice — a dashboard card nobody needed, and a spiral of probes on a question that was already answered. When the user says "isn't that simple", stop and make it simple.

---

## Verification

Before claiming any of this is done:

```bash
npx tsc --noEmit -p tsconfig.json          # source only; .next/types noise is not yours
npx vitest run --pool=threads              # never the forks pool here
npx next build
npx prettier --check .                     # the pre-push hook runs this over the whole tree
```

Read-only probes, all safe against production:

```bash
npx tsx --env-file=.env.local scripts/audit-withdrawn-without-class.ts --ay AY2026
npx tsx --env-file=.env.local scripts/audit-admissions-remarks.ts --ay AY2026
npx tsx --env-file=.env.local scripts/audit-missing-component-weight.ts --ay AY2026
npx tsx --env-file=.env.local scripts/audit-grade-recompute-drift.ts
```

**The browser checks nobody has done**, all from 15–16 Sep:

1. Subject setup → a subject → untick **Exam** on a term. An S3 Filipino Term 3 sheet should then show **100** for a full-marks student, not 87.
2. A grading sheet → **Edit totals & slots** → the component chips, scoped to that one class.
3. Masterfile export → the new **T*n* Days missed** columns, in both xlsx and csv.
4. `/records/students/[studentNumber]` → the per-student export button.
5. Withdraw a student → the dialog should ask for **last day** and **approval date**, and refuse without the last day.
6. Edit Application on a student who already has a class → should say **"Already in …"**, not offer the picker.
