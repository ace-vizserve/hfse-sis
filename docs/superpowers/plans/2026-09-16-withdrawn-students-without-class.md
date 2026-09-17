# Handoff — withdrawn students without a class, and what shipped on 15–16 Sep

## Context

Two training sessions on 2026-09-15 (Miss Joann; the Admissions team) produced 27 action items. Working through them shipped four pieces of code and uncovered one data problem too large to finish in that session.

**The open problem:** 21 of AY2026's 23 withdrawn students had **no `section_students` row at all**. Mr Ace, 2026-09-16: _"you cant be an enrolled student and be withdrawn with no class assignment."_ Hard Rule #6 says a withdrawn student keeps their row and their retired index number; these children vanished from their rosters instead.

> ### ✅ UPDATE 2026-09-17 — 7 of them are placed. **13 remain.**
>
> **What unblocked it was not the masterlist.** The school sent a **house-colour allocation CSV**, and it lists these children **under their section** — the mapping admissions never had, because admissions records a child's LEVEL, not their CLASS.
>
> ✅ **It reproduces two known-good answers**: the same file puts Ashley Rae Cama and Jannat Ajmal in S3 Consistency, matching the two placements Mr Ace approved by hand on 15–16 Sep. A source that independently agrees with verified work was worth trusting for the rest.
>
> Index numbers came from the **alphabet** — each child's section had exactly one hole their surname fits, the same reasoning the approved Cama placement used. `scripts/backfill/apply-withdrawn-placements-from-house-list.ts` re-checks both neighbours against the LIVE roster before writing and refuses if they have moved. Placed: Singson Alexxa (P2 Humility #25), Bruno (P4 Trust #5), Santos Kairo Alonzo (P4 Trust #25), Min Phone Naing (P5 Commitment #9), Boquiren (P5 Tenacity #3), **Muhammad Ibrahim Ajmal (P6 Loyalty #2)** — the one outstanding from this plan — and Chanco (S2 Integrity 2 #8).
>
> `withdrawn with no class: 21 → 13` · `index holes: 27 → 13`
>
> ⚠ **The audit still reports 15, and 2 of those are phantoms.** It matches on the **AY2026 `studentNumber`**, and Santos Kairo Alonzo holds three numbers: `H240037` (his real one, from AY2025 P3 Courageous #3), `H233489` (minted fresh on his AY2026 record) and `V260494` (a VizSchool application). He is placed under `H240037`; the audit looks for `H233489`, finds nobody, and reports him missing — twice, once per admissions row. **The audit inherited the same broken assumption that caused the problem**: that a Current student's AY2026 record carries their real number. Left loud on purpose — the fix belongs on the admissions row, not in the check. Mr Ace on the VizSchool row: _"maybe the parent mis appleid to vizschool and should be regular that simple."_

### The 13 that remain, and what each one needs

**1. Section known, index number is not — 5 children.** The house list names their section; the remaining holes are in the **non-alphabetical tail** where late arrivals were appended, so position proves nothing. S2 Integrity 2 has 4 holes for 3 children.

| Child                    | Section        |
| ------------------------ | -------------- |
| SINGSON, Adrianna Maxine | P5 Tenacity    |
| SUZARA, Ichigo           | P5 Commitment  |
| IRAWAN, Joan             | S2 Integrity 2 |
| ZIAUDEEN, Shahid Mohamed | S2 Integrity 2 |
| GANELO, Caleigh Clerize  | S2 Integrity 2 |

**→ Ask the school for: their index numbers.**

**2. Not on the house list at all — 6 children.** They left before the allocation was made. Admissions gives a level, and P1/P2/P3 each have several sections, so the class is genuinely unrecorded anywhere.

| Child                        | Level         |
| ---------------------------- | ------------- |
| NAVA, Scarlette Leigh        | Primary Three |
| SALCEDO, Dylan Kristoff      | Primary Two   |
| MACARAEG, Quine              | Primary Two   |
| BARRERA, Seian Mhel          | Primary One   |
| BALATBAT, Patrick William Jr | Primary One   |
| BALATBAT, Irie Zane          | Primary Three |

**→ Ask the school for: class AND index number.**

**3. Youngstarters — 2 children.** FERRER, Luna Eilish and MANLAPAZ, Shaun Danuel. Blocked on Youngstarters existing in the SIS at all — parked by Mr Ace until it can be adopted together with its grading sheets, attendance and evaluation write-ups.

⚠ **7 of the 13 have no `students` row**, so they need creating as well as placing — the Cama case, not the Ajmal one.

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

|                                |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Muhammad Ibrahim (H250921)** | Withdrawn, Primary Six, no roster row. Needs a class named — will likely come with the masterlist.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Term 3 grading import**      | 🔴 **BLOCKED 2026-09-17 — Miss Joann: the T3 sheets are under FINAL CHECKING, so wait.** Importing mid-check would load figures she is still changing, and every correction after that is a second import over the top. The code side is ready: no importer exists yet (T1 and T2 each needed their own design doc, plan and correction passes), but **migration 159 removed the real blocker** — without per-term weights it would have corrupted Filipino and Global Perspectives a third time. Start when she says the sheets are final, not before. |
| **S3 Consistency #25**         | Still an unexplained hole. #5 turned out to be Cama.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Late-enrollee bucket**       | The renumber reads `enrollment_date > T1 start`, and 377 of 398 rows have `NULL` (which the backfill writes deliberately to mean "on time"). Mr Ace: resolves itself in AY2027 once enrolment runs through the system. **Do not reopen.**                                                                                                                                                                                                                                                                                                               |

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
