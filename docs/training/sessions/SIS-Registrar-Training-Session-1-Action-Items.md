# SIS Registrar Training Session #1 — Action Items

**Source:** "SIS Training with Miss Joann" — Fathom recording, 15 Sep 2026 (44m)
**Recording:** 182969319
**Present:** Joann (Registrar), Ace Guevarra. 1:1, registrar / sysadmin focus.
**Compiled:** 15 Sep 2026 · timestamps are into the recording

**Why this file exists.** Same reason as the academics file: what someone said
in a room does not change, status changes weekly. **This file holds the words,
the todos and the open questions; `docs/sprints/development-plan.md` holds the
sprint status.** Quotes are verbatim from the transcript, which is not stored in
this repo.

**Everything below has been checked against the code.** Six of the twelve items
turned out to be already built, already decided, or resting on a mistaken
premise. Each says which, and cites the file. One is a live defect.

---

## Status

| #   | Ask                                              | Who           | Status                                                          | Where                                      |
| --- | ------------------------------------------------ | ------------- | --------------------------------------------------------------- | ------------------------------------------ |
| 1   | Per-term "examinable" toggle for subjects        | Joann (13:27) | ✅ **BUILT 2026-09-15 — migration 159 applied** (KD #218)       | See _Item 1_. Not yet browser-verified     |
| 2   | Import the missing term's grading data           | Ace (18:38)   | ⚠ **It is TERM 3, not Term 2** — corrected by Mr Ace 2026-09-15 | No T3 grading importer exists at all       |
| 3   | Validate the consolidated file against the SIS   | Joann (19:42) | 🔴 **Joann agreed it moves into the SIS** — 3 gaps now real     | `GET /api/markbook/masterfile/export`      |
| 4   | Teachers need the ±5% term-over-term highlight   | Joann (17:45) | ✅ **Shipped 2026-08-09** — "Look up student" is enough         | KD #179, `lib/markbook/alert-threshold.ts` |
| 5   | Message teachers about the blank-cell convention | Joann (27:40) | ✅ **Closed** — teachers already know the convention            | See _Item 5_                               |
| 6   | Add Ajmal to the system as withdrawn             | Ace (35:42)   | ✅ **Done the same day, applied to production**                 | S3 Consistency #1, withdrawn               |
| 7   | Relay the index-number ruling to Miss Ko         | Joann (31:17) | ✅ **Relayed 2026-09-15** — code agrees, one button does not    | Migration 147. ⚠ See _Item 7_              |
| 8   | Who writes the report card with two FCAs         | Ace (25:53)   | ✅ **Already decided and enforced 2026-09-09**                  | `lib/evaluation/adviser-of-record.ts`      |
| 9   | Log in and change password                       | Joann (01:47) | Joann's                                                         | —                                          |
| 10  | Explore the system before Term 4                 | Joann (35:59) | Joann's                                                         | Go-live is Term 4, October                 |
| 11  | Send Joann the session recording                 | Joann (37:05) | ✅ **Done 2026-09-15**                                          | To their chat                              |
| 12  | Report bugs and enhancements by PM               | Joann (36:51) | Process                                                         | ⚠ Third inbound support channel            |

---

## Item 1 — the per-term "examinable" toggle

### What was asked

Joann flagged that the examinable flag is set at subject creation only, so it is
fixed for the whole year. The cases given: **S3 Filipino has an exam in some
terms but not others**, and **Global Perspectives had no exam in Term 3** —
those subjects have PT scores only, and the PT score effectively is the exam.
The question was whether something has to be unticked per term.

Ace confirmed the feature does not exist and committed to adding it:
_"wala pa pong ganong feature, i-add ko na lang po siya."_

### The flag she was pointed at is the wrong one

`subjects.is_examinable` (`supabase/migrations/001_initial_schema.sql:95`) means
**numeric WW/PT/QA grading versus letter grading** — not "has an exam".
Migration 049 sets it false for MUSIC, ARTS, PE, HE, CL, CA, PEH and PMPD, and
its own comment says so: _"TRUE = numeric WW/PT/QA grading (Track 1,
examinable). FALSE = letter grade only (Track 2, …)"_.

Unticking it for S3 Filipino would turn Filipino into a **letter-graded**
subject, and it would do so in **every academic year at once** — the column has
no academic-year dimension, and the write route says as much:

> `subjects` has no AY dimension (migration 080's collapse), so a change here is
> GLOBAL — it applies to this subject in every AY, not just the one currently
> selected on the page.
> — `app/api/sis/admin/subjects/catalog/[id]/route.ts:30-32`

Migration 080 already considered and refused a per-academic-year `grade_type`
for the same reason. The UI label is honest — the control reads **"Grade type:
Numeric / Letter"** — only the column name misleads.

**Mr Ace named the fix, 2026-09-15:** _"our definition of examinable is wrong …
its the grading sheet that needs it instead of the subject, hence miss joann
said sometimes a filino grading sheets term has no QA or Exam."_

### The real defect, and it is live

`lib/compute/quarterly.ts:85-88`:

```ts
const initial =
  (ww_ps ?? 0) * input.ww_weight +
  (pt_ps ?? 0) * input.pt_weight +
  (qa_ps ?? 0) * input.qa_weight;
```

**A missing component contributes zero. It does not give its weight back.**

Worked through with Filipino's real weights (30 / 50 / 20):

- **A term with no exam.** A student on full marks for written work and
  performance tasks scores `100 × 0.30 + 100 × 0.50 + 0 × 0.20` = initial **80**,
  which transmutes to a quarterly grade of **87**.
- **Global Perspectives, PT scores only.** Written work and the exam are both
  absent, so `100 × 0.50` = initial **50**, transmuting to **72**.

The formula itself is correct and must not change (Hard Rule #1, Hard Rule #2).
**It is being handed the wrong weights.** Weights live on `subject_configs`, one
row per (subject, academic year) — there is no per-term weight anywhere in the
schema, and `grading_sheets` carries `ww_totals`, `pt_totals` and `qa_total` but
no weights at all.

⚠ **No test covers this.** `__tests__/compute/quarterly.test.ts` exercises a null
exam only in the case where _everything_ is null, which correctly returns null.
The case where written work and performance tasks are scored and the exam does
not exist is untested.

### The evidence that weights really are a per-term fact at HFSE

`scripts/backfill/gen-ay2026-t2-fil-gp-weight-correction.ts` exists because
HFSE's own Term 2 workbooks printed 40/40/20 for **Filipino and Global
Perspectives** where Term 1's printed 30/50/20 — Joann's exact two subjects.
Each term's masthead carries its own weights, and they move between terms.

Meanwhile every term import writes the academic-year-wide row with
`on conflict … qa_weight = excluded.qa_weight`
(`lib/sis/backfill/grading/build-grading-import.ts:343`), so **each term's
import overwrites the previous term's weights** and the grades already stored
stop matching their own config. Importing Term 3 will do it a third time.

**So this is a prerequisite for item 2, not just a feature for Joann.**

### ✅ BUILT — 2026-09-15, migration 159 applied

**Full account: KD #218.** A grading sheet now carries its own WW/PT/QA weights,
null meaning "inherit the subject". Two places set it: **Subject setup** for a
whole term (every class), and the grading sheet's **Edit totals & slots** for one
class — the per-section exception Mr Ace asked for, _"currently its per level and
there might be cases where its per section"_. Unticking Exam hands its share to
what is left, so Filipino with no exam grades 37/63 and Global Perspectives on
performance tasks alone grades 0/100/0.

⚠ **Measured first, and the live damage was two students, not a cohort** —
`scripts/audit-missing-component-weight.ts`, AY2025 completely clean across 348
sheets. The exposure is ahead of us, in the Term 3 import and Term 4 grading,
which makes this a **pre-import fix rather than a cleanup**.

⚠ **Still to do: browser-verify the canonical case** — an S3 Filipino Term 3
sheet with Exam unticked, a full-marks student showing 100 rather than 87.

⚠ **The create-subject form's wording was the other half of this.** It said
_"Examinable — counted toward the term/annual academic average"_, never mentioning
letter grades, while the edit form already said **Grade type: Numeric / Letter**.
Two screens, one column, two stories — and the reason Joann went looking for a
per-term exam switch. The create form now matches. The flag itself is untouched:
it is read by 47 files and is what makes music, art and PE letter-graded.

### ✅ DECIDED — Joann's own sentence is the rule

This was going to be sent back to her as "where does the exam's 20% go". **Mr
Ace, 2026-09-15: _"aint what miss joann enough?"_** — and he is right, it is.

_"Those subjects have PT scores only, and the PT score effectively is the exam"_
states the principle completely: **the components actually in use carry the whole
grade.** Nothing is computed out of 80.

So the rule is to redistribute the absent component's share across the ones still
in use, proportionally. Global Perspectives lands at PT 100%, which is her
sentence exactly. Filipino at 30/50/20 lands at **37 / 63** — its exact share is
37.5 / 62.5, and weights are whole percentages everywhere in the system, so the
spare point goes to the component already carrying more. Below one point of
effect on a grade; the value of fixing it is that the tie is now broken on
purpose rather than by floating-point accident, which is how the first
implementation did it.

⚠ **And the exact split never needed a policy decision anyway.** HFSE's own
workbooks print each term's weights in the masthead — that is how the Term 2
Filipino / Global Perspectives error was found in the first place. Proportional
is the **default**; the coordinator can type the real numbers, and her own Term 3
workbook already tells her what they are. Asking the school to invent a rule for
something their own file states would have been a made-up prerequisite.

---

## Item 2 — the missing term's grading data

On the recording, while demoing All Sheets, Ace said Terms 1, 3 and 4 are
reflecting and **Term 2** is missing.

⚠ **Corrected by Mr Ace, 2026-09-15:** _"term 3 grading data is whats missing
not term 2."_ Recorded here rather than edited into the line above, per this
file's convention.

**The repo agrees with the correction.** Term 1 and Term 2 grading importers both
exist, each with its own design doc and plan, and Term 2's was followed by five
separate correction passes — which is not what an un-run import looks like:

- `scripts/backfill/gen-ay2026-t1-primary-grading.ts`, `…-t1-secondary-grading.ts`
- `scripts/backfill/gen-ay2026-t2-primary-grading.ts`, `…-t2-secondary-grading.ts`
- corrections: `…-t2-fil-gp-weight-correction.ts`, `…-t2-ca-integrity2-correction.ts`,
  `…-t2-science-discipline1-correction.ts`, `…-t2-filipino-secondary-backfill.ts`,
  `…-sci-discipline1-t2-totals-correction.ts`

**There is no Term 3 grading importer of any kind.** Term 3 has attendance only
(`gen-ay2026-t3-attendance.ts`, `…-reimport.ts`, `…-stragglers.ts`). No plan, no
design doc, no generator.

**Scale.** Term 1 and Term 2 each needed their own design doc and multi-phase
plan, primary and secondary separately, plus correction passes afterwards. This
is its own piece of work, and it should not start until item 1 lands — otherwise
it repeats the Filipino / Global Perspectives weight corruption a third time.

---

## Item 3 — the consolidated file

Joann was emphatic that this is the single most important artefact:
_"consolidated file po talaga, importante sa lahat."_ Requested by Ms. Chandana.
It holds, per student per term, attendance (days present and **dates**) and
grades per subject; it computes who receives awards, and teachers link it to the
report card. Joann's real question: now that the SIS exists, is that file still
needed?

Ace showed Records → Students → academic overview plus the attendance section,
and said the critical part: _"hindi ko lang po sure kung tama yung pag-capture."_

**The equivalent already exists and it is not the page he showed.** It is the
masterfile export — `GET /api/markbook/masterfile/export`, XLSX or CSV, built by
`lib/markbook/masterfile-export.ts`. Per student it carries: identity block,
then per examinable subject `Term 1–4 · Overall · Award`, per non-examinable
subject `Term 1–4 · Final`, then `Overall Academic Award`, then per term
`School Days / Present / Late` with totals, then the FCA's comments. KD #122
records it was built from the exact workbook layout of the AY2025 masterfile,
and `docs/context/20-dashboards.md:204` names it as the designated student-level
artefact.

**Three provable gaps against what Joann described:**

1. **No attendance dates.** The export carries counts per term. Dates exist only
   on `/attendance/students/[studentNumber]`, under a stricter role gate, and are
   never joined to grades.
2. **No per-student export.** Handing Ms. Chandana one child means exporting the
   whole level. `/records/students/[studentNumber]` has no export button.
3. **Awards read 0/0/0 for most of the year, by design.** An award is a year-end
   fact needing all four terms. Measured on production 2026-08-18: of 1,732
   (student × examinable subject) pairs, **1,723 had exactly two terms marked and
   not one had four**. If the school expects this page to _drive_ awards
   mid-year, it structurally cannot — only standing is available, and it is
   deliberately never written back.

Ace also noted he split awards into a separate area rather than bundling them
into the consolidated view. That is `/markbook/awards`; the old
`/records/academic-summary/awards` route is now a redirect stub.

### ✅ DECIDED — the consolidated file moves into the SIS

**Mr Ace, 2026-09-15**, confirming Joann agreed to it. She had raised it as a
question on the recording — she recalled being told the consolidated would live
in the SIS going forward, and asked whether the file is still needed. It is not.

**This promotes all three gaps above from observations to work.** While the
spreadsheet still existed they were differences between two artefacts; now the
masterfile export is the only artefact, so anything the spreadsheet carried and
the export does not is simply lost to whoever used it:

1. **Attendance dates** — Joann named them explicitly as part of what the file
   holds. The export has counts only.
2. **A per-student export** — the file is handed to Ms. Chandana and linked to
   report cards per child. Exporting a whole level to deliver one student is not
   a replacement for that.
3. **Awards** — the consolidated file is what _computes who receives awards_.
   The SIS deliberately refuses to name an award before all four terms are
   marked, and awards were also split into `/markbook/awards`, away from where
   Joann expects them. **That is a real behaviour change for her, not a gap in
   coverage**, and she should be told before Term 4 rather than discovering it.

✅ **Getting the file, and telling Joann how awards now work: both covered.** Mr
Ace, 2026-09-15 — _"already covered"_. Not chased further here.

**What remains is build, not conversation:** attendance dates and a per-student
export, so the export can stand in for the file it replaces.

⚠ **Cross-reference to the Admissions session (item 20):** Wynne traced the index
corruption to the **Term 3 consolidated grading file** from Ms. Chandana, which
has a phantom blank row where Ajmal sat. The file Joann calls the most important
artefact in the school is the same file Wynne identified as the source of the
corruption.

---

## Item 4 — the ±5% highlight ✅ ALREADY SHIPPED

Joann described the existing practice: at the end of each grading period
teachers compare T1 vs T2 (or T1 vs T2 vs T3), and the sheet highlights any ±5%
difference, discussed at the last term.

**This was built on 2026-08-09 as KD #179**, from Miss Koh's ask at the
2026-07-31 academics training. `lib/markbook/alert-threshold.ts:15`:

```ts
export const GRADE_ALERT_THRESHOLD = 5;
```

It compares four measures per subject, not just the term grade — `Term grade`,
`Written work`, `Performance tasks`, `Exam` — because a term grade can hold
still while written work falls and the exam rises to cover it. On the teacher's
own grading sheet the flag is symmetric (`Math.abs(diff) >= 5`), mint for a rise
of 5 or more and destructive red for a fall, via "Look up student".

It already exists, and teachers can already see it on their own sheets. **Tell
Joann that and nothing else.**

### ✅ CLOSED — no registrar-facing version is wanted

A first draft of this file proposed building one, on the grounds that the ±5
flags live only on the teacher's grading sheet and the form adviser's class page
— `/records/academic-summary` is a tracking view with no threshold verdict and
`/markbook/insights` is subject-level aggregate, so neither flags a student.

**Mr Ace, 2026-09-15: _"look student is enough bro."_** The "Look up student"
dialog covers the need; a registrar-facing exception list is not wanted and is
not to be re-proposed.

⚠ **One divergence is recorded but NOT being fixed:** the adviser's at-risk list
keeps falls only (`lib/classroom/at-risk.ts:235`,
`if (diff > -GRADE_ALERT_THRESHOLD) continue;`) where the teacher's sheet flags
both directions. The school's spreadsheet highlights movement either way. Left
as-is deliberately — an adviser rings a parent about a child who is slipping, not
one who improved.

---

## Item 5 — the blank-cell convention

Context: some students enrol late, miss early quizzes, and need pro-rated
grades. Ace's answer is to leave the cell blank — blank is excluded from the
average, zero is included. That is Hard Rule #3 and it is correct.

Joann's concern is the one that matters: **if blank silently means pro-rated,
then every blank gets treated as pro-rated** — including a blank that exists
because a student took the test late, or was sick, or the teacher simply has not
entered the score yet. She wants teachers told explicitly so they annotate
whether a blank is a genuine late enrollee or a missed test.

Ace committed: _"mag-message po ako sa teachers tungkol po dyan."_

**Assessment.** She has identified a silent-failure mode in the grading logic
and the mitigation is a message asking people to be careful. That is weak for
something that changes computed grades. A reason on a blank is the actual fix.

✅ **CLOSED — no message needed.** Mr Ace, 2026-09-15: the convention is
**already known by teachers**. The message Ace committed to on the recording is
not owed.

⚠ **The silent-failure mode Joann described is unchanged by that**, and is
recorded here rather than dropped: a blank still cannot say whether it means
"pro-rated late enrollee", "sick", or "not entered yet". Nothing is proposed —
behaviour changes here need evidence of what teachers actually do, not a guess.
Revisit only if a wrong grade is traced back to a blank.

---

## Item 6 — Ajmal ✅ DONE THE SAME DAY

Ace admitted never entering Ajmal Janat Sadike, the withdrawn S3 Consistence
student, which is why index 1 sat empty and Antonio showed as 1.

**Applied to production 2026-09-15.** Jannat Ajmal (H250920) was `Withdrawn` in
admissions with **no `section_students` row at all** — so Hard Rule #6 was
broken, not the status. Mr Ace: _"shes an enrolled student that has been
withdrawn basically."_ She is back at **S3 Consistency #1, withdrawn**, with
Antonio → #2 and Calimbas → #3 per the masterlist. This was a deliberate
departure from KD #136, which freezes numbering and appends late arrivals.

Applied by `scripts/backfill/apply-ajmal-s3-consistency-placement.ts`.

⚠ **Three things this did not close:**

- Her brother **Muhammad Ibrahim (H250921, Primary Six)** was in the identical
  Withdrawn-with-no-class state. ✅ **PLACED 2026-09-17 — P6 Loyalty #2,
  withdrawn** (verified against production 2026-09-19). The school never had to
  answer: the house-colour CSV listed these children UNDER THEIR SECTION, which
  admissions never does, and P6 Loyalty had exactly one hole his surname fits
  alphabetically — between Abineta and Batino.
  `scripts/backfill/apply-withdrawn-placements-from-house-list.ts`.
  ⚠ His `withdrawal_date` is null, so he does not appear in the Records
  Withdrawals count, which keys on the date rather than the status.
- Her `withdrawal_date` is **null** — the school holds no date — so she will not
  appear in the Records Withdrawals count.
- S3 Consistency still has holes at **#5 and #25**.

⚠ The script writes as the service role, so **no `audit_log` row exists**; the
reasoning lives in the script header.

---

## Item 7 — the index-number ruling

Miss Ko asked Ace to change Kalimbas from index 3 to index 2, on the basis that
Antonio is 1. Joann opened the master file live: **number 1 is withdrawn
(Ajmal), number 2 is Antonio, number 3 is Kalimbas.** Instruction: tell Miss Ko
to check against the master list.

**Joann's governing rule, stated plainly:** the master list is permanent. You do
not move students up into blank cells. New students are added at the bottom.
When a student withdraws, their index stays blank and nobody replaces them —
_"dapat walang papalit sa index niya."_

The Admissions team reached the same conclusion independently three hours later
(session #2, item 20). Two separate meetings, same day, same answer. **Settled.**

**The code already agrees, in two of three places:**

- Withdrawn numbers are **burned** and excluded from the pool, never reused —
  migration 147, and `section_students.index_number` carries a non-deferrable
  `unique (section_id, index_number)`.
- Late enrollees and transfers **append at `max+1`**, counting withdrawn rows —
  `lib/sync/students.ts:280-284`, and the transfer RPC does the same.
- Withdrawn students still occupy their index on the roster, struck through and
  un-linked, and are excluded from the index-swap picker with the comment _"A
  student who has left keeps their number permanently."_

🔴 **But "Generate all indexes" contradicts the ruling.** It re-sorts the entire
on-time block alphabetically from scratch (migration 147, phase 1 flips every
non-withdrawn row negative, phase 2 reassigns from scratch). Only _withdrawn_
numbers are preserved. So adding one early-surname student and pressing it
shifts everyone after them — exactly the "moving students up" Joann forbade. Its
own dialog warns _"Regenerating will renumber everyone"_, but the button is
named as though it fills gaps.

**Worth doing:** rename the button and sharpen the warning before someone presses
it mid-term. The sanctioned tool for a single correction is the **swap**, which
is a permutation and can open no gap.

---

## Item 8 — two form class advisors ✅ ALREADY DECIDED

Ace noticed from Mr. Muhammad's timetable that some sections have two teachers
and implemented it as a co-teacher / co-advisor assignment. The open question:
if there are two FCAs, only one should write the report card comment — who?
Joann did not know; Ms. Wynne produces report cards. Ace: _"ask ko na lang po
siya."_

**This was already answered and enforced, six days earlier.**
`lib/evaluation/adviser-of-record.ts` exists as its own file for exactly this
reason, and its header records the decision:

> Mr Ace, 2026-09-09, shown that a co-adviser could open the write-up roster and
> then get a 403 on save: **"as co teacher the main FCA can only write that up."**

Everywhere else in the app a co-adviser _is_ an adviser — migration 124 gives a
co role the same access as its primary, and Classroom, Attendance and Markbook
all resolve them together. Evaluation is the one deliberate exception, because
the write-up becomes the form class adviser's comment on the report card and
that card prints one name.

⚠ The file also records _why_ it is a separate file: beside `listAdvisedSectionIds`
it read as a near-duplicate, _"the shape somebody deletes as an oversight during
a sweep, and deleting it hands one teacher's report card comment to another."_

**No need to ask Ms. Wynne.** There is no conflict and no last-write-wins.

---

## Waiting on the school

✅ **Muhammad Ibrahim's class placement** (item 6) — **CLOSED 2026-09-17**, and
not by the school: the house-colour list named his section and the alphabet
named his number. Nothing on this session is owed by the school any more.

✅ **Closed 2026-09-15, all by Mr Ace.** The exam-weight rule (Joann already
stated it), getting the consolidated file, telling Joann how awards now work, and
the blank-cell message to teachers — _"already covered"_, _"already known by
teachers"_. **Four of the five open questions in the first draft of this file
were answerable from what had already been said or done.** Ask the room, and the
record, before adding a question to a list.

✅ **Closed — a withdrawal date for Jannat Ajmal.** Mr Ace, 2026-09-15: **"no
record."** The school does not hold one, so `withdrawal_date` stays null and this
is now a permanent state rather than a pending input.

⚠ **It has a consequence worth deciding separately:** the Records Withdrawals
count keys on the date, so **she will never appear in it**. The question that
raises is whether that count should be "withdrawn students" or "students with a
recorded withdrawal date" — today it is silently the second. Not raised in the
session; not proposed as work.

---

## Joann's own items

- **#9 — log in and change password.** Joann had not logged in when the session
  started; Ace ran the whole demo from his own account. ⚠ Credentials were
  emailed individually on Sep 10; the Registrar still had not logged in five days
  later.
- **#10 — explore before Term 4.** Joann said she is overwhelmed and has not got
  a feel for the system; go-live is Term 4 in October. She is separately still
  building the Term 4 SharePoint and Excel grading sheet, because both systems
  run in parallel. **This is the parallel-running cost landing on one person**,
  weeks before go-live.
- **#12 — report bugs by PM.** ⚠ This is a different channel from the Feedback
  button given to teachers, and from the Admissions team's own route. **Three
  inbound support paths now converge on one person.**

---

## Ace's own items

✅ **#11 — send Joann the session recording.** Done, 2026-09-15.

✅ **Relay the index-number ruling to Miss Ko (item 7).** Done, 2026-09-15.
Settled twice on the same day by two separate meetings; nothing further is owed.
⚠ The code-side caveat in item 7 is **not** closed by this — the "Generate all
indexes" button still re-sorts every non-withdrawn student, which is the one
thing Joann's ruling forbids.
