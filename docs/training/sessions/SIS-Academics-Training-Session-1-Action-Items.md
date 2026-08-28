# SIS Academics Training Session #1 — Action Items

**Session 1 of the faculty training** (~1 hour, ran long). Present: Christina
Labrador, Chandana Dileep, Koh Suat Hoon, Melissa Balantac, Wynne Lynn Faustino,
Hermilita Mendoza, Marrie Aines Juni, Joel Castro. Demo driven by Ace Guevarra.

**Source:** Fathom recording — transcript with speaker attribution and
timestamps, plus an auto-generated summary. The transcript is not stored in this
repo; the quotes below were taken from it verbatim and are the authoritative
record of what was asked.

**Why this file exists.** These items were first tracked only as a section of
`docs/sprints/development-plan.md`, summarised in my own words. Twice that
summary lost something load-bearing, and a third time a correction written to
fix it went wrong the same way — see _Corrections_ at the bottom. What
someone said in a room does not change; status changes weekly. They are split
accordingly: **this file holds the words, the todos and the open questions; the
dev plan holds the sprint status.**

**Questions before code.** _Questions to send_ below holds the plain-English
questions each item still needs answered, written so the person who asked can
answer them without a developer present. Every block states what the feature
reaches **today** — which modules see it, whether it is on the report card,
whether parents can see it — so the school confirms a boundary rather than
inventing one. Ask them in the room, not in a design doc. Replies land verbatim
in _Answers received_, and a block that has been answered stays where it is
rather than being edited into the reply.

---

## Status

| #   | Ask                                                   | Who                                                  | Status                                               | Where                                                                           |
| --- | ----------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | Comment on an excused absence                         | Christina (31:07), Melissa (32:44)                   | **Shipped** 2026-08-03                               | KD #177, migration 109                                                          |
| 2   | House colour                                          | Chandana (23:35)                                     | **Done** — named + list loading                      | KD #178, migrations 110 / 111                                                   |
| 3   | Whole-year T1→T3 view for one student                 | Christina (57:59)                                    | **Shipped** 2026-08-03                               | Records → Academic tab                                                          |
| 4   | Flag at-risk students on scores, not just term grades | Koh (55:10)                                          | **Shipped** 2026-08-09                               | KD #179 (subject) + #182 (adviser)                                              |
| 5   | Teacher-visible student profile                       | Christina (16:08), Melissa (21:53), Chandana (22:36) | **Shipped** 2026-08-09                               | KD #181 — Classroom drawer                                                      |
| 6   | Upload the medical certificate                        | Christina (31:07)                                    | ⚠ **RESHAPED 2026-08-17 — the PARENT files it**      | Her own child's school SIS. Blocked on what approval does                       |
| 7   | Disciplinary records / incident reports               | Christina (18:20)                                    | **SHIPPED 2026-08-21, browser-verified 2026-08-24**  | Five screens. Migrations 120–122. Outcome still nowhere                         |
| 8   | Awards beyond Gold/Silver/Bronze                      | Christina (19:08)                                    | ⚠ **Sample arrived 2026-08-14 — wrong kind**         | Principal's List is an ACADEMIC honour, not a competition                       |
| 9   | House points                                          | Chandana (23:51)                                     | **Rules known 2026-08-12**                           | Same table as #8 — scoring sheet                                                |
| 10  | More than two grade-change approvers                  | Wynne (45:30)                                        | **Answered 2026-08-14**                              | "Teachers cannot choose the approvers"                                          |
| 11  | Second approval route keyed on publication            | Christina (46:04)                                    | ⚠ **FORM ARRIVED 2026-08-27 — and it REFRAMES this** | Not a grade-change form. See _Answers received_. Membership question still open |
| —   | WW/PT max scores have no home in SIS Admin            | (found in triage)                                    | **Closed** — working as intended                     | KD #176                                                                         |
| —   | Relief teacher marking another section's register     | Marrie (33:18)                                       | Policy — the school owns it                          | See _Waiting on the school_                                                     |
| —   | Teachers' dashboard — lesson planning + SOW           | Christina (2026-08-21)                               | ⚠ **NEW — reopens SOW, removed twice**               | Nothing scoped. See _Answers received_                                          |

Three pre-existing defects surfaced during triage and were fixed first:
**KD #174** (in-page link reachability), **KD #175** (a missed `SECURITY DEFINER`
revoke), **KD #176** (subject config is a ceiling, not a broadcast).

---

## Todos

### Ours

- **T1 — the FCA half of Koh's ask. Shipped 2026-08-09** as KD #182. A
  **Look up student** button on Classroom → Grades — the same words and the
  same two-view shape as the attendance sheet and the grading sheet, so it is
  one habit across three surfaces. It ranks the class by the steepest single
  fall across **every subject the class takes**, and the second view carries
  what fell plus the parents' numbers, because her sentence ended at
  "contact the parents".

  **Adviser and oversight only**, the same bar as the report card: a subject
  teacher already has this for their own subject on their own sheet, and every
  other subject's marks for the whole class is a different thing. Hidden in
  Term 1, which has nothing behind it to compare against.

  **Still open with her, and both are in the unsent message:** whether anyone
  should be _notified_ when a student is flagged (the bell carries only
  grade-change requests today), and how big a drop should count — five points
  is a display heuristic nobody at HFSE has expressed an opinion about.

  **Reviewed with Mr Ace 2026-08-21 — four outcomes.**
  1. ✅ **FIXED — the FCA list named the wrong term.** `baselineFor` resolves
     the comparison term **per metric** (it walks back to the most recent prior
     term carrying a mark, since a subject can go unmarked for a term), so one
     student's falls can be measured from different terms. The panel printed
     `drops[0].priorTermLabel` — the **worst** fall's term — as a single caption
     over all of them. Now: one quiet caption when every row shares a baseline,
     the term on each row when they disagree. `at-risk-lookup.tsx` + 2 tests.
     Mr Ace's rule, and it is the general one: **be honest about what is being
     compared against.**
  2. ✅ **Max scores changing between terms are already handled — do not
     re-derive this.** Mr Ace asked what happens when an exam is out of 50 in T1
     and 60 in T2. Nothing: `PS = (Σ scores) / (Σ matching maxes) × 100`, stored
     per entry as `ww_ps`/`pt_ps`/`qa_ps`, so **"Exam 81 → 55" is 81% → 55%**,
     not marks. Weights cannot drift either — migration 080 collapsed them to
     one set per subject. And **ON THIS SHEET** compares a sheet against its own
     average, never across terms.
  3. ✅ **SHIPPED 2026-08-21 — one shape across all three lookups, and the
     term comparison is settled by showing every term.** All three now open to
     **the whole roster in index order** with a search box and an **All students
     / Only flagged · ‹term›** dropdown; the term is named in the option so an
     empty result never reads as "this class has no problems". The grading
     sheet's grouped headings ("Needs a look" / "Everyone else") are gone — the
     reader chooses. Opening a student shows **every term side by side**, each
     column carrying the change from the one before, which answers the
     T4-against-T2 ask **without a picker** and removes the question a picker
     could not answer honestly (what to show when the chosen term has no mark).
     New shared `components/shared/term-history-table.tsx` — one table, used by
     the grading sheet and by the adviser panel once per subject, fallen
     subjects open and steady ones collapsed. `rankAtRisk` now returns the whole
     roster (`drops: []`, `worstDiff: null` for the steady), so Term 1 shows the
     class instead of a blank panel. Attendance rows carry the rate and mark
     anything below `AT_RISK_ATTENDANCE_THRESHOLD_PCT` (90) — no new route, just
     `getRollupForSection` passed down from the register page. Full suite green
     (3,133).

     ⚠ **Two defects were found and fixed while building this, both worth
     keeping in mind.** First, **raw floats reached the screen**: the adviser's
     panel printed `String(n)`, so a real class showed
     `−40.833299999999994` beside a child's name. Component percentages are
     genuine fractions, and the grading sheet had a private `fmt` that handled
     it while the panel written later did not — **two surfaces owning private
     copies of the same rule is the bug**. There is now exactly one:
     `lib/markbook/format-grade.ts`, and nothing may render a grade figure
     without it. Second, **a bare percentage is unreadable**. Mr Ace, on the
     first build: _"add more details to it like max scores the actual score then
     percentage, currently its like what the hell im looking at here."_ Every
     component cell now shows the marks under the percentage — "44 / 50" under
     "88%" — which needed `ww_scores`/`ww_totals` loading for prior terms
     (`sumTaken` in `grade-diff.ts`); the percentage is what makes terms
     comparable when a paper's total changes, the marks are what a teacher
     recognises from the sheet, so the screen carries both. And the **term grade
     is now its own table**, separate from what it is made of — _"can you
     separate term grade and WW, PT, Exams?"_ — because a weighted 0–100 figure
     and a percentage of one paper are not the same kind of number and should
     not sit in one grid.

  4. ✅ **SUPERSEDED 2026-08-24 by outcome 7 below.** The 2026-08-21 shape put
     a term-grade chart, three 48px component charts and a four-part table on
     screen at once. It is recorded here because the reasoning still holds —
     one panel, both surfaces, headline → chart → table, and per-term max
     scores shown on the row — but the layout below replaced it.
     Mockup: `https://claude.ai/code/artifact/7a67c6df-eda7-4e92-a79c-bc9b363eff64`.

  5. ✅ **ONE MEASURE AT A TIME — BUILT 2026-08-24 (KD #188), and this is the
     first version that does what her verb asked for.** A segmented tab strip
     (Term grade · Written work · Performance tasks · Exam, default term grade)
     drives the figure, the chart and the marks table together. Mr Ace:
     _"see that graphs? it must change depending on the selected tab."_

     ⚠ **The tabs carry the flags, and that is the whole reason hiding three
     measures is allowed.** Her verb was **"flag out"**; a control showing one
     measure has to say where the problem is before it is clicked, or finding
     it means clicking all four. So every tab prints its own change and a fall
     past five points carries a dot — the same dot the Classroom subject tabs
     already use.

     ⚠ **The case is real production data, and it is her case exactly.** A
     student whose **term grade moved −3 while his exam fell 40.8**, written
     work having risen 23.4 and covered for it. A −3 term grade does not flag,
     does not turn red, and would never put that child on a list — which is
     precisely what she was complaining about at 55:10, and what the widening
     at 56:00 (_"not only for the quizzes, but also for exam, for overall…
     **alongside** with the term grades comparison"_) asked to fix.

     ⚠ **A charting defect that the tests could not see.** `TrendChart`'s
     compact variant rendered no `<YAxis>`, so recharts fitted the axis top to
     each series: a steady 88–92 line and a 92 → 55 collapse both filled their
     box, under a caption promising "all on one 0–100 scale". `TrendChart` now
     takes `domain`/`ticks`/`showValues`/`tone`, and a fixed `[0,100]` is
     mandatory wherever charts are read against each other. It survived because
     `TrendChart` is `next/dynamic ssr:false` and renders a skeleton in jsdom —
     `__tests__/markbook/subject-term-panel.test.tsx` now mocks it and asserts
     its **props**.

     ⚠ **A hand-drawn mockup does not predict recharts.** The approved mockup
     anchored its end labels; recharts centres a `LabelList` on its point, so
     "88%" landed on the y-axis and "73%" was sliced by the right edge. **Judge
     a charting change against the library, never against the mockup.**

     Also: the measure name is no longer repeated in the body (the selected tab
     names it, and at 22% column width it wrapped to three lines); the table is
     open rather than folded; Score and Out of are **removed** on the term
     grade rather than dashed; and subject weights are plumbed through to
     Classroom so both surfaces read alike. **"On this sheet" stays
     grading-sheet-only** — it needs the raw slot scores off the sheet being
     marked, which Classroom does not carry. Full suite green (3,152).
     ✅ **Browser-verified by Mr Ace, 2026-08-24.**

  6. <!-- superseded detail retained below -->**Detail of the 2026-08-21 build, kept for its reasoning:** Mockup

     approved: `https://claude.ai/code/artifact/7a67c6df-eda7-4e92-a79c-bc9b363eff64`.
     **New `components/shared/subject-term-panel.tsx` is the whole detail view**,
     rendered identically by the grading sheet and by Classroom — Mr Ace: _"use
     identical designs for grading sheet look up and classroom grades lookup its
     basically the same data bro."_ The only difference the data forces is the
     subject tab strip: an adviser has every subject, a subject teacher has the
     one they are marking. Shape follows attendance deliberately: **headline
     figure → chart → table**, so a teacher who has read one lookup has read all
     three. **Three small charts** (written work / tasks / exam) share one
     0–100 scale — that is the point of the feature, since a term grade can sit
     still while written work collapses and the exam covers for it, which is
     invisible in a single line. Charts reuse the existing `TrendChart` with a
     new **`variant="compact"`** (no y-axis, grid or tooltip) rather than a
     second charting path. The table gained real columns — **Term · Score · Out
     of · Percentage · Change** — and sits behind a fold.

     ⚠ **Max scores differing per term is handled, and visibly.** Mr Ace asked
     how. The total lives on the ROW, so Written work reads 44/50, 42/50, then
     48.6/60. **A total that changed from the term before is tinted and carries
     an ↑**, with a footnote saying the score is no longer comparable but the
     percentage is — without it, somebody reads 40.5 → 33 down the Score column
     and concludes a child collapsed when the exam simply went from 50 marks to 60. The footnote also states that **marks count only the assessments the
     student actually sat** (Blank ≠ Zero), so two students in one term can
     legitimately show different totals.

     ⚠ **The term grade is in the table as well as the chart** — its Score and
     Out of cells stay empty, because a weighted figure out of 100 has no
     denominator and inventing one would be a lie. It was chart-only for one
     revision, which put those figures out of reach of a screen reader.

     ⚠ **The LIST row was redesigned last, and only because Mr Ace saw it.**
     It had been left alone through the whole detail rebuild, so it still
     stacked a line per FALL — the same subject twice whenever two of its
     components dropped, plus a `SINCE TERM 1 — AY2026` footer. His words:
     _"what the hell is this design."_ It is now one line per student in the
     grading sheet's shape: index number, name, **worst fall per SUBJECT** (max
     three, then "+2 more"), and the steepest figure on the right. **A list is
     scanned; the detail is read.** ⚠ Making the row a single button changed its
     accessible name, which broke twelve selectors at once — the same trap
     `loadingText` sprang in KD #186. `sharedBaseline` is gone with it: the row
     no longer names a baseline because it no longer claims one, and the detail
     table sets each term against the one immediately before it.

     ⚠ **Falls stayed destructive red, on Mr Ace's call.** The mockup used burnt
     orange after the dataviz validator failed red-against-mint for
     deuteranopia (ΔE 5.8, under the floor of 8). Consistency with the rest of
     the app won; the sign and the arrow carry the meaning for colourblind
     readers, so colour is never doing the work alone. **If the app's semantic
     palette is ever revisited, this pair is the known weak point.**

  7. ⚠ **SUPERSEDED — dynamic term comparison.** _"not just previous term, like
     term 4 can be compared to term 2… same for attendance as well."_ **Partly
     already built, which is why it needs checking before scoping:** the
     **subject teacher's** dialog (`grade-lookup-dialog.tsx`) already has a term
     picker and its caption names the selected term. The **FCA's** list has no
     picker. **Attendance** already lists every prior term but computes no
     difference against any of them — a different job, not the same one.
  8. ⚠ **Unguarded: an in-progress term.** `loadSectionAtRisk` reads the sheet
     as it stands — no lock, no completeness check — and Blank ≠ Zero (Hard Rule
     #3) drops nulls from both sides of the ratio. So a finished T1 against a T2
     holding two of four tasks can read as a fall when the sheet is just
     unfinished. Not a maths bug; the caption simply does not say the current
     term is still in progress. **Wording, not formula. Not done.**

  ⚠ **"Flag" vs "look up" — CLOSED, do not re-raise.** Her verb was "flag out
  students", which surfaces itself; what shipped is a pull, and the button looks
  the same whether the list is empty or holds five names. A count on the trigger
  was proposed. **Mr Ace: _"look up student button seems fine as long as its
  showing them correct data."_** Correctness over prominence.

  ⚠ **"Flag" versus "look up" — raised and CLOSED by Mr Ace, 2026-08-21.** Her
  verb was _"flag out students"_, which surfaces itself; what shipped is a
  **pull** — you must remember to open it, and the button looks identical
  whether the list is empty or holds five names (plain `Button`, no count). A
  count on the trigger was proposed as the middle ground between a notification
  and nothing. **Mr Ace: _"look up student button seems fine as long as its
  showing them correct data."_ Parked — do not build the count, and do not
  re-raise it.** Correctness is the priority instead.

  ### ⚠ NEW ASK — dynamic term comparison (Mr Ace, 2026-08-21). Not built.

  > _"add in dynamic term comparison not just previous term, like term 4 can be
  > compared to term 2 for example you get the point. same for attendance as
  > well."_

  **The reader chooses the baseline term.** Today it is chosen for them:
  `baselineFor` (`lib/classroom/at-risk.ts`) walks backwards from the most
  recent prior term and takes **the most recent one that actually carries a mark
  for that metric**. That is deliberate — a subject can go unmarked for a whole
  term — but it is automatic, and T4-against-T2 is not expressible.

  ⚠ **One wrinkle to settle before building, because it is not a picker bolted
  on:** the baseline today is resolved **per metric**, so written work can
  compare against T1 while the exam compares against T2 within the same student.
  An explicitly chosen term either overrides that skipping (and then a metric
  unmarked in the chosen term shows nothing) or coexists with it (and then the
  caption is lying about what was compared). **Pick one deliberately.**

  ⚠ **"Same for attendance as well"** — the attendance lookup
  (`components/attendance/student-lookup-sheet.tsx`) needs the same treatment.
  Scope it as one feature across both surfaces, not two builds: they already
  share the button, the words and the two-view shape, and letting them diverge
  on how a baseline is picked would break the one-habit-across-three-surfaces
  property that made this pattern worth reusing.

  ✅ **The comparison is sound against changing max scores — checked 2026-08-21,
  and this is worth not re-deriving.** Mr Ace asked what happens if an exam is
  out of 50 in T1 and 60 in T2. **Nothing: the dialog compares percentages, not
  marks.** `PS = (Σ scores) / (Σ matching maxes) × 100` (`lib/compute/quarterly.ts`),
  stored per entry as `ww_ps` / `pt_ps` / `qa_ps`, so each component is
  normalised against its own total before anything is compared. "Exam 81 → 55"
  is 81% → 55%. **Weights cannot drift either** — migration 080 collapsed them
  to one set per subject, so they are identical in every term; were they
  per-term, the term-grade line could move with no change in performance at all.
  And the **ON THIS SHEET** block never crosses terms — it compares one sheet
  against its own average, so max scores are irrelevant there by construction.
  **This matters more once the baseline is user-chosen**, since T4-against-T2
  spans more room for the totals to have changed.

  ⚠ **What IS unguarded: an in-progress term.** `loadSectionAtRisk` reads the
  sheet as it stands — **no lock, no completeness check** — and Blank ≠ Zero
  (Hard Rule #3) excludes a null from both numerator and denominator. So the
  current term's percentage is computed on **what has been entered so far**: a
  finished T1 against a T2 holding two of four performance tasks can read
  "-13.3" when the sheet is simply not done. **Not a maths bug** — it is a true
  statement about work completed to date, and early warning is the point — but
  the caption says _"Compared with Term 1"_ without saying the current term is
  still in progress, so it reads as a finished comparison. **A wording fix, not
  a formula fix.** Not yet done.

- **T2 — the student profile** (#5). **Shipped 2026-08-09.** Three people asked
  five versions of "when I click the name I want to see X". Three of those five
  things already existed in Records; teachers simply could not reach that
  module.

  Built as a **drawer inside Classroom**, not as access to Records — the
  question in the old version of this entry ("is Classroom the teacher's home
  for everything, or a page reached from it?") is answered by neither. Opening
  the registrar's page to teachers would have handed them passport numbers,
  home addresses and the family's fee arrangement to surface an allergy.
  Instead `View details` on the class roster opens a panel with three tabs —
  Medical, Learning, Contacts — over a deliberately narrow field set. A
  **medical flag sits above the tabs and stays visible on all of them**, so it
  cannot be navigated away from.

  Authorisation is the section, twice: the caller must hold a classroom
  capability over it, and the student must be on that roster. So a teacher
  cannot read a child they do not teach by guessing a student number. Adviser
  and subject teacher alike — Melissa asked as a subject teacher.

  The student's **name** is the trigger too, for viewers who cannot open the
  permanent record. That gives the name somewhere to go again after KD #174
  correctly took its link away.

  **Still open:** whether teachers may _add_ to any of this (question 3 in the
  rewritten message above). And the **Grades tab** — see T1.

- **T3 — MC upload** (#6). ⚠ **RESHAPED 2026-08-17: the parent files it, not the
  FCA.** Christina showed Mr Ace how her own child's school SIS does it and he
  took it — _"this is the best way since parents are the ones who initially have
  the doc."_ Full design in _Answers received_. **This supersedes the FCA-uploads
  spec** and un-parks the version she raised herself on 2026-08-12.

  ⚠ **The approval CHAIN is answered; the approval BEHAVIOUR is not, and the
  chain arriving must not be read as closing this item.** Restated 2026-08-25:
  _"Form Class Adviser then Officer in Charge (Primary or Secondary)"_, sequential,
  which is what was already recorded. **Two things are still unknown, and the
  first is the blocker:**
  1. **What approval actually _does_.** Does the Officer in Charge approving
     **write the register** — turn that day's `A` into `EX` — or does it only
     tell the adviser, who still marks it themselves? This decides whether the
     parent portal writes into attendance or merely raises a request, and it
     cannot be assumed either way. Everything else about the form can be
     designed without it.
  2. **Who the Officer in Charge is.** "OIC" exists nowhere in this system — not
     a role, not a capability, not a column — and it now gates two unrelated
     flows, since it is also the middle station of the pre-issuance grade-change
     chain. Needed: a name per school half, and whether it is a standing
     position or named per case.

  Two smaller ones worth folding into the same ask rather than sending twice:
  **what a rejection does** to a mark already entered, and whether a declaration
  filed **after** the absence (the MC arrives Monday for Friday) is the same
  flow — that is the common case, not the exception.

  ⚠ **"Ms Tin" is Christina — Tin is her nickname** (Mr Ace, 2026-08-18,
  correcting this file's first write-up, which called them two people and
  therefore "two independent sources"). **It is one source saying the same thing
  twice**: unprompted on 2026-08-12, then demonstrating the screen. Her sons
  being at another school is the same fact from both angles. That is not weaker
  evidence — it is the most invested kind there is — but it must not be counted
  as corroboration. **It also resolves the AEB roster: the "Ms Tin" among its
  five members is Christina**, so the board includes the Principal.

  The security note below still stands for whichever shape wins: the storage
  bucket appears public-by-URL (`getPublicUrl` everywhere, no signed URLs in the
  codebase) and its policies are not in this repo. Granting teachers the existing
  document capability would hand them replace-rights over every enrolled
  student's passport and birth certificate. ⚠ **And the scale changed**: a
  parent-facing form plus an approval queue plus a write into the attendance
  register is an order of magnitude past an upload button, against a portal that
  can read only `school_config` + `report_card_publications` today.

- **T4 — run the students sync against a student who already has a house** and
  confirm it survives. A test guards it, but that test reads source code; only
  the sync running proves it.
- **T5 — disciplinary records** (#7) and **awards** (#8), each needing its own
  table. Do **not** extend `lib/compute/awards.ts`: "award" there means a tier
  derived from a numeric average, with no entity, id, date or issuer.

  **The incident-report form is now known** — sample arrived 2026-08-13, fields
  and findings in _Answers received_. Three things it changes before anything is
  designed. **It is already computer-generated and already numbered** (case 702),
  so this is a replacement of a running digital process, not a first system of
  record. **The filer is an office, not a class role** — our FCA-records
  assumption is wrong. And **the form has no outcome field at all**, so the half
  of Christina's ask that named "a warning letter or suspension" is not on the
  paper we were sent and has to be asked for separately.

  Also: **the student is optional on the form** (`if applicable`), while #7's
  whole shape is "open a student, see their incidents". Decide whether the SIS
  holds only the student-linked subset. Nobody has asked for the rest.

  **#7 SHIPPED — backend applied 2026-08-18 (migrations 120, 121, 122), the five
  screens landed 2026-08-21 (`031b3610`), browser-verified by Mr Ace 2026-08-24.**
  `student_discipline_records` + `lib/discipline/{queries,mutations}.ts` +
  `lib/schemas/discipline.ts` + three routes under
  `app/api/classroom/[sectionId]/students/[studentNumber]/discipline/`.

  **The five screens.** Filing and editing live in the **Classroom student
  drawer** (`components/classroom/student-discipline-panel.tsx` — list, detail
  and form as three views in ONE panel, because nested dialogs are banned; the
  form replaces the body, tabs and all). Plus a per-class list
  `/classroom/[sectionId]/discipline` with its own File-a-record button and
  student picker, a read-only-plus-edit tab on the Records student page, and the
  school-wide register `/records/discipline`.

  ⚠ **The register was Mr Ace's call on 2026-08-21, over my objection**, and it
  supersedes the "do not pre-build that screen" note that sat here and in the dev
  plan. Nobody at the school asked for it; his answer was _"its common sense for
  software development bro"_ and he was right — until it existed, a record was
  reachable class by class only. It carries a **Slips outstanding** count and a
  **Slip back** facet (Returned / Not yet / —), so "which letters are still
  outstanding" is two clicks. **Surfacing is not chasing:** no reminder, no
  computed deadline, no notification.

  Two deliberate deviations from the approved mockup
  (`https://claude.ai/code/artifact/27b69d3a-206a-47c5-a826-cb0cdde7d8a6` —
  update THAT url, never publish a new one): chips use the real `Badge` + §9.3
  recipes rather than the mockup's hand-rolled pill, and the date field starts
  **blank, not today**, because a pre-filled date gets accepted without being
  read.

  **Two gaps Mr Ace found in the browser pass, both fixed** (`fca9d240`): the
  class Discipline list had no click target at all — fine until `/records/
discipline` made the student name a link, and teachers cannot open Records, so
  that list was a dead end (the name now opens the drawer straight on the
  Discipline tab via a new `initialTab` prop); and the Records student page had
  no way across to the class (now a sixth Classroom tile in the quick-action
  grid, greyed with "No class assigned" when there is no active placement).

  Decisions, all Mr Ace's:
  - **ONE table with a `record_type`, not two** — _"one list is fine for now its
    basically a type atp no?"_ The attendance warning letter hangs off no
    incident, so incidents and letters are siblings, never parent/child, and one
    chronological list is the whole point of the ask.
  - **Filing is open to any staff member** (Chandana's rule), **editing is the
    filer plus leadership**. **Filing lives in Classroom, not Records** — teachers
    cannot open Records at all. **No new capability**: reach is gated by the
    section exactly as the KD #181 drawer is, which also sidesteps KD #166's
    "a code-only capability is inert until `role_permissions` has the row".
  - **`nature` ships as free text** until the school sends the picklist. The
    student is **required** despite being optional on their form.
  - **`details`/`remarks` never reach `audit_log`** — append-only and
    coordinator-readable, the same privacy line as `ex_note` (migration 109).
  - **No sequence number.** Their cases run to 702 and nobody has decided whether
    those come across; a second unrelated numbering scheme would make that call
    harder, not easier.

  ⚠ **The system decides nothing and generates nothing**, and that survived a
  direct challenge — see the warning-letter sample in _Answers received_. No
  threshold, no detection, no letters produced, and `lib/compute/awards.ts` is
  untouched even though that letter asserts an attendance shortfall forfeits
  academic awards.

- **T6 — rename the four house rows. Done; migration 111 applied 2026-08-06.**
  Rather than choose between "Orange House" and "Orange House – The Flame" —
  her answer supports either, since her picture calls the colour one thing and
  the name another — the two are **separate columns**. `name` is the colour and
  stays the only thing rendered; `title` ("The Flame") and `core_values` are
  stored and shown nowhere, ready for Mr Lloyd's logos next year. No component
  changed. The colour tokens already matched her colours, so no token work.
  Verified live through `listHouses()`.
- **T7 — there is no way to assign a house in bulk**, and the list that arrived
  needs one. One per-student `PATCH` at
  `app/api/sis/students/[enroleeNumber]/house/route.ts`, driven from the profile
  tab, is the only write path. **No longer blocked** — the live allocation is the
  20 class tabs, the ones written with the `🔵` emoji, **410 students**. Carry
  into the design: the superseded master tab still sits in the same file, the
  sheet has no student numbers so matching is by name, and five rows cannot be
  matched at all. **Built 2026-08-06** as `scripts/backfill/gen-house-assignment.ts`,
  following the attendance/grading pattern — preview + apply SQL, output
  gitignored, run through the SQL editor. No review screen, no CRUD page.

  **402 of 410. Dry run against production is clean: 402 set, 0 overwrites, 0
  unresolved student numbers.** Resulting sizes Orange 102 / Green 104 / Blue 95
  / Yellow 101 — eight short of the sheet's own totals, which is exactly the
  eight withdrawn students. Awaiting `house-assignment-apply.sql`.

  391 matched automatically; **the other eleven are carried as
  `MANUAL_RESOLUTIONS` in the generator**, each with the reasoning beside it.
  They are not name guesses: matching the roster against the sheet leaves
  exactly one unassigned student per class, and the sheet's tab codes map onto
  our section names precisely (`SEC 1D1` = Discipline 1, `SEC 2I1`/`I2` =
  Integrity 1 and 2, `SEC 3` = Consistency, `SEC 4` = Excellence), so each
  pairing is corroborated by the child sitting in the class the tab represents.
  Two guards keep the list honest: an override naming a student who is not on
  the live roster **throws**, and one that no sheet row needed is reported as
  stale — which is what will happen when Hanafi corrects the sheet upstream.

  The least certain is `Ajith Sharwan, Micheal` → AJITH KUMAR, Sarwan, the only
  one resting on elimination rather than a legible name; it is flagged as such
  in the code and in his message.

  **All 19 misses are now explained**, after a check that was missed first time
  round — see below. **Eight have WITHDRAWN** and are still on the sheet;
  excluding them is the correct outcome, not a shortfall. **The other eleven are
  on the sheet under a different name** and are individually identified.

- **T11 — check the roster against the sheet, not only the sheet against the
  roster.** Chandana said houses were allocated to "all the students". Only the
  sheet→roster direction was ever checked, so students the sheet **never
  mentions** were invisible: they simply would have had no house, and nothing in
  the school breaks when a child has none. Run 2026-08-06
  (`house/check-reverse-gap.ts`), it changed the picture:
  - **405 enrolled students, 390 named on the sheet, 15 not.**
  - **Eleven of the fifteen are on the sheet after all**, written differently —
    and having a roster row to compare against is what identified them. `Ariana`
    is Ariana Megan **Pabayos**; `Richie` is Richie Lyandrei **Martinez**;
    `Matthew` is Matthew Jordan **Udtuhan**; `Rabaya` is Mst **Rabiya** Akter.
    **`TAYEB, Taseen` and `TOKI, Sayeda` have their first and last names the
    wrong way round** — they are Taseen Tayeb and Sayeda Toki, which is why a
    surname lookup found nothing and an earlier note wrongly called them absent
    from AY2026.
  - **Three are genuinely missing from the sheet**: Pin Sin Huang (Diligence),
    Lushi Liquiran (Humility), James Aaron Alcantara (Integrity 2). So "all the
    students" is not quite true, and only this direction could have found it.
  - The fifteenth is the `Test, Testing Two` record.

  ⚠ **The script's first run reported "0 enrolled, 0 missing" — a clean bill of
  health produced by a broken query.** It selected a column that does not exist
  on that table; supabase-js returned `data: null` with the error in a field
  nothing read. Any check whose healthy answer is a zero needs its inputs
  asserted, or it cannot tell "nothing wrong" from "nothing ran".

- **T10 — bulk house assignment: decided against, for good reasons rather than
  as a deferral** (Mr Ace, 2026-08-06). Assigning stays one student at a time
  from the permanent record.

  **Because a house is permanent, the only recurring volume is new enrolees — a
  handful a year**, which is exactly what a per-student picker suits. The single
  moment of real volume is the initial ~400, and the import covers that. After
  it lands, 19 students need setting by hand and then a trickle.

  ⚠ **Reopen only if the school ever re-balances houses across classes.** That
  would mean hundreds of changes at once and the picker would be the wrong tool
  — but it also contradicts a house being permanent, so it should not happen.

  If it is ever built, the pieces are already there: `DataTable` supports row
  selection with bulk actions (used by the grading sheet, document completeness
  and cohorts) and `StudentDataTable` simply does not enable it. The honest
  scope is one action, one dialog and one endpoint looping the existing PATCH
  logic — an hour, not a project. Two things would matter: **report which rows
  did not write** (a wrong or missing house is invisible, since nothing in the
  school breaks when a child has none), and **make "no house" filterable** — the
  House facet holds an empty string for unassigned students today, so
  select-and-assign has no starting point. Audit and permission come free from
  reusing the existing route.

- **T8 — house in the parent portal. A nice-to-have, and priced accordingly.**
  Her words were _"**would be good** if parents can see their child's house name
  in the parents portal"_ — a preference, not a request, and the softest of her
  four answers. An earlier draft of this entry read "the house belongs in the
  parent portal", which is a paraphrase that quietly promoted it; corrected
  2026-08-06.

  **Nothing about house is outstanding that the school is waiting on.** This is
  the only one of her answers not already true in code, but "not built" and "a
  gap" are different things, and it also happens to be the one item that needs
  another team. Bottom of the list. Audited 2026-08-06:
  - **The parent portal is a separate Next.js codebase**
    (`docs/context/10-parent-portal.md`). This repo has no parent UI, only
    `/api/parent/v2/*` that the portal calls. We can expose a house; somebody
    else has to render it.
  - ⚠ **The obvious payload has a trap.** `/api/parent/v2/students` is the child
    list, which is the right home given "not the report card" — but it drops any
    student with no **active publication window**
    (`app/api/parent/v2/students/route.ts`, the `activePubs.length === 0`
    guard). House added there would appear only during a report-card release and
    be absent the rest of the year, which is not what "parents can see their
    child's house" means.
  - **The alternative is the KD #165 route** — an RLS policy letting a parent
    read `houses` and their own `students.house_id` directly, which is already
    how the portal reads `school_config`. No publication window involved. But
    `students` is not parent-readable today, so the predicate needs designing
    rather than copying.
  - Needs a conversation with whoever maintains the portal. **Does not gate T6 or
    T7, and should not be started before either.**

  For the record, the other three of her answers are already true in code:
  `HouseChip` and `HouseTile` render `name` alone (no symbol, no logo); house
  appears nowhere in the report-card code; and it appears nowhere in
  `lib/compute/awards.ts`.

- **T9 — staff are in houses too.** Hanafi's sheet carries a tab allocating ~44
  staff across the four houses. Nothing in the system models this, nobody asked
  for it, and it is recorded here only so it is not discovered late. Do not
  build it.

### Waiting on the school

- **Chandana** — **three things outstanding as of 2026-08-14, all files.** She
  was sent the same four asks as Christina and **answered all four on 2026-08-14**
  (see _Answers received_), promising samples she has not yet handed over:
  1. ~~**Incident report / warning letter samples**~~ — **a warning letter
     arrived 2026-08-14** (supplied by Mr Ace; the `.docx` is authored in Word
     and last edited by Chandana herself). See _Answers received_. ⚠ **It does
     not close the outcome question.** It is a **first warning on ATTENDANCE**,
     triggered by the register rather than by any incident — so #7 has two
     independent entry points, and **whatever records a suspension is still
     unproduced by any source.**
  2. ~~**The award certificate sample**~~ — **arrived 2026-08-14 from Christina.**
     Satisfied, though not with the file this item expected; see #8 above.
  3. ~~**New, created by her reply: the "specific AEB approval form".**~~
     ✅ **ARRIVED 2026-08-27** — `CO.1.1-F01-V02 AEB Approval Form.docx`, written
     up in _Answers received_. A grid of five names, so the board signs as a
     body; and ⚠ it turns out **not to be a grade-change form at all**, which
     reframes #11. **Asking for the artefact beat asking anyone to describe
     their process — third time that move has worked.**
  4. **Still hers, and the only thing outstanding: does the AEB membership
     change?** Sent in the same 2026-08-21 message; the form cannot answer it.
     It matters because a rotating board means an old approval must keep who was
     on it **then** (KD #147), not re-render with today's roster.

  Earlier and closed: house was fully answered 2026-08-06; the mid-year SOW
  question was answered 2026-08-12 (rare, and applies to the current year —
  confirms the KD #176 accepted cost); and the house-points rules arrived as the
  live scoring sheet. All in _Answers received_.

  **A house belongs to the child and stays with them — confirmed by Mr Ace,
  2026-08-06. Closed; do not reopen it.** This had been left here as "dropped
  rather than asked", which is why it kept resurfacing as an open question every
  time the file was re-read. It is the premise the whole design rests on and it
  is now settled, so `students.house_id` on the cross-AY row is right, the
  "stays with the student" copy on the house tile is true, and the sync test is
  guarding the right thing.

  Two things that had looked like evidence against it are not. Hanafi's master
  tab differing from the class tabs on 292 students is **one supersede**, not
  annual churn; and each class being evenly balanced is how the initial
  allocation was carried out, not something re-done each year. Both are
  compatible with a permanent house.

  Also dropped, and staying dropped: whether siblings share a house — it would
  only matter if the system assigned houses, and Hanafi already has.

- **Mr Hanafi — the teacher deployment file, 2026-08-12.** He replied on the
  AY2026 teaching assignments. **Three of four answered**; the fourth ("full names
  for the report cards") he echoed back rather than answering — **and it turned
  out to be largely unnecessary.**

  **`Teachers Deployment_Updated 29 Jun 26_Teacherscopy (1).xlsx` (repo root) already
  holds nearly everything.** Its `Teachers List` sheet carries **26 teachers, 24
  with `@hfse.edu.sg` addresses**, and **the email encodes the legal name** —
  `firstname.lastname`. So the full names were never blocked on him. They are not
  guessable from the nicknames, which is why this looked blocked: **Ms Carl is
  Christine Sarmiento, Ms Tina is Natividad Laguyo, Ms Aida is Zuraidah Zainal,
  Ms J is Jocelyn Saguid, Mr "Jospeh" (sic, roster typo) is Joseph Ong.**

  **The timetable sheets carry the assignments**, laid out as side-by-side column
  blocks per class, not stacked — read per column band or two classes merge into
  one row. **The Assembly / Homeroom cell names the form class adviser**; every
  other cell is `Subject` + teacher, i.e. a subject teacher. That yields 20 of 21
  advisers.

  **Still genuinely missing:** Ms Jasmine and Ms Li (no email, so no legal name —
  they use `jasmine.hfhse@gmail.com` and `liqun0815@gmail.com`), **P4 Trust's
  adviser, whose cell just says "New Teacher"** — never asked, it was not one of
  the four. Mr Ace has also asked for the current-AY list, since this file is
  dated 29 June and still carries AY2024/AY2025 rows near the bottom.

  ~~the **English relief teacher** for Sec 1 Discipline 2 / Sec 3 Consistency,
  which is with Ms Marrie~~ — **two secondary relief part-time teachers arrived
  2026-08-25**, verbatim in _Answers received_: **Mr Chong Jun Hien** (Science
  and Global Perspectives) and **Ms Fong Mei Yin Elaine** (English). Ms Fong
  matches the English gap on subject and school half, ⚠ **but the message names
  no classes**, so which sections she covers is still unconfirmed. Neither has an
  account yet.

  ⚠ **SUPERSEDED 2026-08-27 — the file has since been imported and the leftovers
  are now a written message.** 123 assignments across 19 teachers are loaded and
  18 of 21 classes have their adviser. What the file cannot settle is seven
  items, drafted as _To Hanafi — the AY2026 deployment_ below. **Two of the gaps
  once recorded here were never his to answer** — Sec 1 Discipline 1's missing
  subjects and Sec 1 Discipline 2's silence were our own parser bug (KD #194),
  fixed and re-imported. **Do not fold them back into a message to him.**

- **Mr Hanafi (house)** — **closed 2026-08-11, nothing outstanding.** He answered on
  2026-08-06 and sent both sheets. The follow-up about unmatched names was
  **dropped rather than sent** (Mr Ace's call): ~12 of 410 students go without a
  house and the eleven hand-matched names go in unconfirmed, which is the
  accepted cost. Do not reopen this as an open question — it was decided, not
  forgotten.
- **Christina** — **answered 2026-08-12, and the approvals answer reopened
  everything.** See _Answers received_. What is still hers:
  1. ~~**Does the five-step chain belong in the SIS at all?**~~ **Closed the same
     day — it does, and she said so at the training (50:57).** See the ✅ note in
     _Answers received_. Left here struck through because this line was written
     before that quote was found and has been read as open since. Only _how_
     remains.
  2. ~~**Who records an award.**~~ **Decided by Mr Ace 2026-08-12: FCA and up.**
     She answered only who views. Not hers any more.
  3. ~~**The samples she promised by email.**~~ **BOTH ARRIVED — closed.** The
     **incident report** came 2026-08-13; the **certificate** came 2026-08-14,
     alongside a warning letter nobody had asked for. All three are in _Answers
     received_. ⚠ **The certificate is not the file this item expected** — it is
     a Principal's List, an academic honour computed from grades, not the
     competition certificate #8 describes. That is a finding, not a delivery
     failure, and it is written up under its own heading.
  4. **New, and created by that sample: where is the disciplinary _outcome_
     recorded?** The incident form has no field for one. She asked at 18:20 to
     see "whether the student received a warning letter or suspension", and the
     form she sent records the incident and the counselling referral, not the
     sanction. Either there is a second form, or it is not written down anywhere.
     ⚠ **Chandana was asked the same thing and did not answer it either**
     (2026-08-14) — she named who _handles_ a case by severity, not what sanction
     is recorded. **Four sources now, nobody has said where the outcome lives** —
     the warning letter that arrived 2026-08-14 did not close it either, since it
     turned out to be about attendance rather than the outcome of an incident.

     **Mr Ace is asking Chandana and Christina directly (2026-08-18).** What he
     already knows, and what the question should assume: _"suspension is the last
     anyways like any other rule there are strikes before suspension."_ So it
     sits at the end of a ladder, and the SIS already shows the strikes leading
     up to it in date order. **Ask what gets written down when one happens, and
     on what form — not whether they suspend students.**

     ⚠ **A "suspended" tag on the student was considered and argued against the
     same day.** A tag carries no date and no end, so somebody has to remember to
     clear it, and a student suspended in March still reads as suspended in
     November. A suspension is an **event with a start and a length**, which is
     exactly what the record list already models. If the answer makes it real,
     the cheap shape is a **third `record_type`** beside `incident` and `letter`
     — same list, same dates, the strikes sitting above it in order — not a flag
     on `students`. **Do not build either until they answer.**

  5. **New: confirm the five-station pre-issuance chain is real.** It rests on one
     line of one message and contradicts her own 46:04. **Chandana's 2026-08-14
     reply is silent on it** — she described only the post-issuance AEB route — so
     it has neither been corroborated nor challenged, and it is the expensive
     half of #10/#11.
  6. **New: what generates these today, and does case 702 come across?** The PDF
     is computer-generated and sequentially numbered, so the existing cases are a
     migration question, not a fresh start.

  ~~Revised 2026-08-11: the approver count was already answered at 46:04, "two
  approvers, Ms. Chandana and I only."~~ **That is no longer operative.** Her
  2026-08-12 reply describes two different routes, neither of which is two
  approvers. Wynne's "can we add more" (45:30) is answered — yes, five, twice
  over, and in one case in a fixed order.

  Also hers: the relief-teacher policy, **raised by Marrie at 33:18** and
  answered in the room by Christina (designate an admin rather than share a
  login): admins can already write any section's attendance, but the audit log
  has no on-behalf-of concept and advisers cannot read it.

- **Wynne** — **half answered 2026-08-25.** The message sent 2026-08-21 carried
  two asks and one has come back.
  1. ~~**The additional P-Files document types.**~~ **Arrived 2026-08-25** — see
     _Answers received_. Eight genuinely new slots, and it closes the admin
     session's #5 and #11 together. ⚠ **The relay does not name the sender**, so
     it is filed against her because hers was the only outstanding ask for it;
     confirm before quoting her.
  2. **The Transcript of Records template — still outstanding.** The data layer
     is complete and cross-AY on `studentNumber`; the template is the whole
     blocker. She asked for it directly at 1:00:57 and **offered the template
     herself** in the same exchange, so this is a reminder, not a cold request.

### To correct with the team

- **Koh was told she could change an exam paper's total via a change request**
  (she asked at 47:20, the answer came at 48:00). She cannot. That is
  coordinator-only subject config, blocked at the schema, at a DB `CHECK`, and
  at the apply RPC.
- ~~**The two approvers are NOT a dual signature.**~~ **Withdrawn 2026-08-11 —
  this was never a correction, because she never made the claim.** The first to
  act does set the status and nothing reads `secondary_decision`, but her 46:04
  words were _"it would require two approvers, Ms. Chandana and I only"_ — a
  statement about **who** approves, not about how many signatures are needed.
  "Christina assumes both must agree" was our inference, written here as though
  it were hers, and it nearly went to her as a correction to something she had
  not said. **Current behaviour stands.** Mr Ace's call. What _is_ changing is
  that the two approvers become her and Chandana by rule rather than by the
  teacher's choice.
- **Chandana's 53:09 question is an unqualified yes**, and always has been —
  production already runs eleven different Maths exam totals across sections.

---

## Questions to send

Ready to copy. Send separately — short lists get answered.

**Ask only what the build needs, and anchor every question to something they
actually said.**

- **Reach** — "should this appear on the report card?", "do parents see it?",
  "does it affect the awards?" **Ask these only about something already live.**
  House is why they exist: it was on production for days, read in exactly three
  places, and nobody had ever confirmed that was wanted. For something not yet
  built there is no default to ratify — the default is staff-only, same as
  everything else — so a reach question there is not a safeguard, it is an
  invitation to design a bigger feature than the one requested. The school will
  ask for more once they can see it.
- **Mechanics** — "where is the file stored?", "how long is it kept?", "is there
  a leaderboard?" These are ours to decide. **Leave them out.**
- **Anything they did not raise is not a question.** This is the one that bloats
  a message fastest, because each invented question looks reasonable on its own.

Each block opens by stating what the feature reaches _today_, so the reply is a
confirmation rather than an invitation to design.

Entries marked **⚠** are places where the system does not work the way somebody
in the room believed it did. Those are corrections, not questions.

### ✅ Decided by Mr Ace, 2026-08-11 — do not ask her these

Nine questions became four plus two file requests. **Everything below is settled;
re-raising any of it with the school is a mistake.**

| Was asked                                                     | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Can every teacher see a student's details, or only the FCA?   | **All teachers who teach the student.** Confirms what shipped.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Should teachers be able to _add_ to medical / learning needs? | **No — read-only, permanently.** Parents encode it on the application form; the office stays the only editor. Not a question, a principle.                                                                                                                                                                                                                                                                                                                                                                                        |
| Who can see a disciplinary record?                            | ~~Teachers who teach the student.~~ **Reopened and put to her, 2026-08-11.** The first answer covered viewing but left "who writes an incident record" undecided, and the awards decision had the mirror gap — who records was settled, who sees was not. Both file requests now also ask **who should see them and who should record them**, so each feature gets both halves from the person who owns the policy. Our working assumptions stay teachers-who-teach-them for viewing and FCA for recording; her answer overrides. |
| Who enters an award?                                          | **The form class adviser**, for now. Subject teachers will not do this.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Who can open an uploaded medical certificate?                 | **The student's form class adviser, plus `school_admin` and above.** Not every teacher who teaches the student — narrower than the disciplinary record and narrower than the Classroom student drawer, deliberately: an MC is a document about one absence, and the FCA is the one chasing it. The message says this in plain English ("the form class adviser and the office"); the role list is the build spec. Who _uploads_ it is still open.                                                                                 |
| Must both approvers agree before a grade change takes effect? | **Question withdrawn — keep the current behaviour.** Her words at 46:04 were _"it would require two approvers, Ms. Chandana and I only"_ — she never said both must sign. "Both must agree" was **our inference**, recorded as an assumption in _To correct with the team_ and never checked against what she actually said. Do not present it to her as a correction.                                                                                                                                                            |
| Should the two approvers always be her and Chandana?          | **Yes — build it, do not ask.** The pre-publication flow is right; only the teacher-picks-the-approvers part changes.                                                                                                                                                                                                                                                                                                                                                                                                             |

**Two design questions became requests for a file instead** (disciplinary
records, awards/certificates). Asking "what fields do you want?" makes her design
a form; asking to see two real incident reports lets us build around the form the
school already uses. This is the move that worked on Hanafi — asking to _see_ his
sheet surfaced a scoring scheme and a conflicting allocation that his summary of
it had not mentioned.

**The AEB question was wrong, not just long.** It asked _"who is AEB, in terms of
actual people?"_ — presuming a person. Wynne's phrasing (45:46, _"you still have
the AEB, right?"_) reads as a body or a process. It now asks what AEB **is** and
what should happen when a change is requested after publication.

📄 **The five blocks to Christina are no longer sent as five messages.** They
were consolidated on 2026-08-11 into one —
`docs/training/2026-08-11-questions-for-academic-head.md` — which is what
actually goes to her. **That file is the live version; the five blocks below are
kept as the working record of how each ask was arrived at.** If an ask changes,
change it in both or the next person to read this file will send the stale one.

Why the format changed, given this section says "send separately": that rule
exists because Chandana answered 2 of 7 questions in one long message. The
failure there was questions buried in prose, not question count. Four answers and
two file requests for one person is one conversation, not five.

**It briefly became a Word document and then stopped being one.** At nine
questions across five topics that was right — it needed headings and a fill-in
box under each question. Once Mr Ace answered five of the nine himself and two
more turned into "send me the file you already use", 441 words of plain text
carried it, and a .docx was ceremony. The generator survives at
`scripts/md-to-docx.py` if a future school-facing document needs one; the
markdown is the source and it renders headings, callouts and bordered answer
boxes.

**Trimmed 2026-08-11.** The four blocks to Christina carried roughly twenty
questions between them and now carry six. Almost everything cut was invented
here rather than asked for in the room — report-card and parent reach questions
on features that do not exist, storage mechanics, and one question she had
already answered on the recording. The rule above is the corrected version; the
previous wording said to ask the reach questions always, which is what produced
the bloat.

### To Chandana — house · sent, answered 2026-08-06

**Kept as sent.** Questions 4 and 5 came back; 1, 2, 3, 6 and 7 did not. Her
reply is in _Answers received_; the follow-up is the next block.

> Hi Ms Chandana,
>
> The house field is live. Before I go further I want to check I have put it in
> the right places.
>
> **Right now a house is saved on the student's record and shown in three
> places:** the student list in Records, the student's own record page, and the
> class roster. It does **not** appear on the report card, parents cannot see
> it, and it has no effect on grades or on the Gold/Silver/Bronze awards.
>
> 1. Is that right, or should a house show up somewhere else in the system?
> 2. Should it appear on the report card?
> 3. Should parents be able to see which house their child is in?
> 4. What are the four houses called, and what colour is each? **One thing to
>    flag before you decide:** our classes are already named after virtues — P1
>    Respect, P1 Grit. If the houses use virtue names too, staff will see the
>    same word meaning two different things on one screen.
> 5. Who decides which house a student goes into? Is there an existing list I
>    can load, or should I set them up one by one?
>
> On house points:
>
> 6. Could you describe how house points work at HFSE — what earns a point, and
>    who records them?
> 7. You mentioned points and awards together. The awards in the system today
>    (Gold, Silver, Bronze) are worked out purely from a student's average marks
>    — nothing else feeds them. Should an award also give that student's house
>    some points?
>
> Thank you.

### To Chandana — house, follow-up · sent, answered 2026-08-06

**All five answered. Nothing on house is open with her.** Reply in _Answers
received_.

> Hi Ms Chandana,
>
> Thank you — the names and colours are exactly what I needed, and I have
> written to Mr Hanafi for the list.
>
> Three of my earlier questions did not get answered, and they are the ones that
> decide what I build next. As a reminder, a house today is saved on the
> student's record and shown to staff in three places: the student list, the
> student's own record page, and the class roster.
>
> 1. Should a house appear on the report card?
> 2. Should parents be able to see which house their child is in?
> 3. Should a house, or its points, have any effect on the Gold, Silver and
>    Bronze awards? At the training you mentioned awards and house points in the
>    same breath, so I want to be sure I have not misread it. Today those awards
>    are worked out purely from a student's average marks, and nothing else
>    feeds them.
>
> Two smaller things, from your message and the picture:
>
> 4. Your message said the houses go by colour only, but the picture gives each
>    one a name and a set of values as well — Orange House – The Flame, and so
>    on. On screen, should it read **Orange House**, or **Orange House – The
>    Flame**?
> 5. You mentioned a house symbol. Is there a real symbol or crest I should be
>    using, or is the coloured circle in the picture the symbol?
>
> Thank you.

### To Hanafi — the house list and the points · sent, answered 2026-08-06

**Not a training attendee.** He is named in Chandana's reply as the owner of
both the list and the points, and this was a cold first contact — hence the
introduction, and hence asking to _see_ his file rather than asking him to
describe a system. **That paid off:** the sheets carry a written scoring scheme
and a second, conflicting allocation, neither of which appeared in his summary
of them. Reply and findings in _Answers received_; the one blocking question is
the block below.

> Hi Mr Hanafi,
>
> I am Ace — I build the school's student information system, the one the
> teachers now use for grades, attendance and report cards. Ms Chandana tells me
> you are the person who keeps the house list and the house points.
>
> **Where things stand on my side.** Every student's record now has a place for
> their house, and staff can see it in three places: the student list, the
> student's own record page, and the class roster. It is not on the report card
> and parents cannot see it. The four houses are set up but still carry
> placeholder names, and **no student has been assigned to one yet** — that is
> the part I need from you. There is nothing about house points in the system at
> all.
>
> 1. Could you send me your list of which student is in which house, in whatever
>    form you keep it — Excel, a Google Sheet, even a photo of a printout. Their
>    full name and their house is enough. If your list happens to carry the
>    student number too, that saves me matching people up by name.
> 2. Could you also send how you record the points at the moment — the actual
>    file, exactly as it is, with nothing tidied up for me. I am not asking you
>    to explain it or design anything. I would rather see how it really works
>    before deciding whether it should live in the system at all, because the
>    surest way to get this wrong is to build something that does not match what
>    you already do.
> 3. One thing only you can answer: should the house standings be something
>    staff can see inside the system, or is that list yours to keep and share
>    when you choose?
>
> Thank you.

### To Hanafi — the names I cannot match · NOT SENDING, dropped 2026-08-11

🚫 **Mr Ace's call: drop both remaining questions and do not send this at all.**
Kept below as the record of what was matched by hand, which is the only place it
is written down.

**What that accepts, so it is not discovered later as a surprise.** Roughly 12 of
410 students go without a house: the 3 below whom Hanafi's sheet never listed,
the 8 the generator could not match, and possibly PANGILINAN Rafael Noah if the
trailing space in `"H250326 "` is real in the database. **And the eleven manual
matches in the table below go in unconfirmed** — they were matched by class and
first name, which is good but not certain. If a wrong one landed, a student sits
in the wrong house until somebody notices. That is the accepted cost of not
asking; all of it is reversible from the permanent record's house tile.

**Was two questions; the first was answered.** Which allocation is live was
settled internally on 2026-08-06 — the per-class tabs.

⚠ **The "eight students have left the school" claim was cut, 2026-08-11 — it was
never established.** The generator reports all eight as tier `none`, but a row
reaches `none` for **three** different reasons that its output cannot tell
apart: the application is Withdrawn/Cancelled (`gen-house-assignment.ts:200–205`),
the application has **no `studentNumber`** (`:214` — the comment there names real
enrolled children dropped this way), or the name genuinely matches nothing. Only
the first means the child left.

The message asserted the first for all eight and asked Hanafi to delete them from
his sheet. Had any one of them been a spelling mismatch or a missing student
number, we would have told a colleague to remove a currently-enrolled child from
the house list.

**Resolved by removing the claim, not by chasing it — Mr Ace's call, 2026-08-11,
and the right one.** Eight of 410 is a 2% gap, the cost of leaving them is that a
few students show a blank house until someone notices, and the fix then is
trivial. The message now says only that eight could not be matched confidently
and that Hanafi need do nothing about them, which is true regardless of which of
the three reasons applies.

**If it is ever reopened:** `house/check-house-unmatched-8.ts` (read-only, two
SELECTs, no filters) prints the actual reason per student and resolves the padded
`H250326` at the same time. The generator's own `NOT WRITTEN` block cannot —
it only ever prints `none`.

> Hi Mr Hanafi,
>
> Thank you — both sheets are exactly what I needed, and the points legend
> answered more than I had asked.
>
> I have loaded the list — 402 of the 410 students are in. I worked out most of
> the trickier ones myself, so this is mainly to confirm rather than to ask.
> (Eight I could not match against our records with enough confidence to be
> sure, so I have left those alone for now — nothing you need to do.)
>
> 1. **Three students are missing from the list entirely**, and have no house:
>    Pin Sin Huang (P4 Diligence), Lushi Liquiran (P2 Humility) and James Aaron
>    Alcantara (Sec 2 I2). Which houses should they be in?
> 2. **Please confirm these eleven** — the names are written differently on the
>    sheet than in our records, so I matched them by class and I would rather
>    check than guess:
>
>    | On your sheet              | Our records                    |
>    | -------------------------- | ------------------------------ |
>    | Ariana (Sec 3)             | Ariana Megan **Pabayos**       |
>    | Richie (Sec 3)             | Richie Lyandrei **Martinez**   |
>    | Matthew (Sec 3)            | Matthew Jordan **Udtuhan**     |
>    | Rabaya (P3 Courageous)     | Mst **Rabiya** Akter           |
>    | Shen Bustamante (Sec 2I2)  | Bustamante, Shen               |
>    | TAYEB, Taseen (P4 Trust)   | **Taseen, Tayeb** — name order |
>    | TOKI, Sayeda (Sec 1D1)     | **Sayeda, Toki** — name order  |
>    | Ajith Sharwan, Micheal     | AJITH KUMAR, **Sarwan**        |
>    | CHIO, Karlyle Aleksndr…    | Karlyle **Aleksandr** Ysmael   |
>    | CALIMBAS, Audrey Elizabeth | Audrey Calimbas                |
>    | FAYLONA, Lucas Paulus      | Lucas Faylona                  |
>
> One small thing you may want to know: there is still an older sheet in the
> same file listing every class in one long run, without the colour circles. I
> am ignoring it and using the per-class sheets, but it might be worth removing
> so nobody loads the wrong one later.
>
> Thank you po.

### To Hanafi — the AY2026 deployment · NOT SENT, written 2026-08-27

**Written after the import, not before it** — which is the point. 123 of his
assignments are loaded and every question below is a leftover the file itself
cannot settle, so none of them asks him to describe a system or to decide
something already built. Each names the cell it came from.

⚠ **Do not ask whether Sec 1 Discipline 2 is running.** An earlier version of
this block did, and it was wrong: it has a full five-day timetable, its own
adviser (Ms J), and **16 students, 14 of them active**. What is genuinely
unresolved is the _Cambridge_ timetable sitting beside it, which is question 1.

⚠ **P1 Respect was dropped from this list on 2026-08-27.** CLAUDE.md called it
"a live section the file never names"; it holds **2 students, 0 active**, so it
is an empty leftover and there is nothing to ask him. Checked, not assumed.

**Two things deliberately not asked.** Whether the AY2024/AY2025 rows near the
bottom of the file should be removed — his file, his housekeeping, and we read
past them correctly. And anything about how cover or co-teaching is _recorded_ —
that is ours to decide and he has no view of it.

⚠ **CUT FROM SEVEN TO SIX on 2026-08-27, and the cut is the useful part.** Mr
Ace asked whether these were really the gaps. They were not — they came from the
generator's **skip list, which only reports rows it REFUSED TO WRITE** and is
silent about a sheet that simply ends up with nobody. Measuring the real thing
(every AY2026 grading sheet against its assignments) gave **125 sheets, 99
staffed, 26 with no teacher**, and reclassified the list:

| Unstaffed sheets                      | Cause                             | His?         |
| ------------------------------------- | --------------------------------- | ------------ |
| S1 Discipline 2 × 8                   | Cambridge collision               | **yes — Q1** |
| Mandarin × 4                          | Ms Jasmine / Ms Li, no email      | **yes — Q4** |
| SS × 2 (S3, S4)                       | Humanities shared                 | **yes — Q3** |
| MAPEH × 2 (P2 Humility, P4 Diligence) | STAR shared                       | **yes — Q3** |
| P5 Commitment FIL + MANDARIN          | ambiguous "Mother Tongue"         | **yes — Q5** |
| S3 Consistency English                | "Relief Teacher"                  | **yes — Q6** |
| PE × 3 (S2 I2, S3, S4)                | **our own subject-mapping bug**   | no           |
| P1 Obedience Christian Living         | stray sheet, only one in the year | no           |
| P1 Respect × 3                        | dead section, 0 active students   | no           |

**What that removed from the message: the whole of the old question 7.** P4
Trust is staffed and correct (`radhika.putrevu@` is on it now), and P2
Gentleness / Gratitude match no live section, so neither costs a sheet. They
were in the draft because they were **true**, not because the build needed them
— which is exactly the accretion this file has recorded twice before. ⚠ **Being
true is not the test.** Six remain and every one of them costs real mark sheets.

**Also learned, and not his problem:** PE lives in the catalogue under two codes
(`PEH` for the Global classes, `PESTD` for the Standard ones), his file writes
one phrase for all of them, and our importer mapped every class to `PEH`. Fixed
in the generator; see KD #194.

> Hi Mr Hanafi,
>
> Thank you for the deployment file — it has done almost all of the work. This
> year's teaching assignments are now loaded into the system, and **every class
> but two has its form class adviser recorded**, which was the piece holding up
> report cards. The two are the first two questions below.
>
> Six things I could not work out from the file on my own. I have deliberately
> left each one blank rather than guess, because a wrong teacher on a class is
> worse than a missing one.
>
> 1. **Secondary One Discipline 2 — is "Cambridge" a separate class?** Your file
>    has two timetables for it. One is headed _SECONDARY ONE DISCIPLINE 2
>    STANDARD_, with Ms J as adviser and a full five-day timetable. The other is
>    headed _SECONDARY 1D2 (Cambridge)_, with Ms Carl as adviser and **no teacher
>    named in any of its eight subject cells**. Our system has one Secondary One
>    Discipline 2. Are these one class taught two ways, or two separate classes?
>    ⚠ **Until I know, that whole class has no teachers recorded** — I did not
>    want to pick one timetable over the other by accident.
> 2. **Secondary Four Excellence names two form class advisers** — the cell reads
>    _"Ms Med & Ms Elaine"_. The report card prints one adviser's name, so I need
>    to know whose it should be. (The other one is not lost — I can record her
>    alongside, with exactly the same access to the class.)
> 3. **Four subjects are shared between two teachers**, which I take to be
>    ordinary timetabling rather than a mistake — all three views in your file
>    agree on every one of them. But a mark sheet has one owner, so for each of
>    these, **who should the marks belong to?** The other teacher gets the same
>    access to the class either way.
>
>    | Class             | Subject    | Shared between                            |
>    | ----------------- | ---------- | ----------------------------------------- |
>    | P2 Humility       | STAR       | Ms Jing (Mon–Wed, Fri) / Mr Hanafi (Thu)  |
>    | P4 Diligence      | STAR       | Ms Jing (Thu) / Mr Hanafi (Fri)           |
>    | Sec 3 Consistency | Humanities | Ms Elaine (Tue, Fri) / Ms Carl (Tue, Wed) |
>    | Sec 4 Excellence  | Humanities | Ms Elaine (Wed, Thu) / Ms Carl (Thu, Fri) |
>
> 4. **Ms Jasmine Zhou Qi and Ms Li Qun have no school email address** on the
>    Teachers List — the file gives personal Gmail addresses for both. The system
>    can only give an account to a school address, so until they have one **their
>    four Mother Tongue classes have no teacher recorded**: P1 Patience, P2
>    Honesty, P3 Courtesy and P4 Diligence. Can the school issue them
>    `@hfse.edu.sg` addresses?
> 5. **P5 Commitment's cell says only "Mother Tongue"**, and that class has both
>    Mandarin and Filipino running. Which of the two is that slot, and who
>    teaches it?
> 6. **Secondary Three Consistency's English cell says "Relief Teacher".** Is
>    that Ms Fong Mei Yin Elaine, who was named to me as the English relief
>    teacher on 25 August? And does she cover any other classes?
>
> Nothing here is urgent except the first two — those are the ones stopping
> report cards for Secondary One Discipline 2 and Secondary Four Excellence.
> The rest only mean a mark sheet is waiting for a name.
>
> Thank you.

### To the office — the Term 4 dates · NOT SENT, written 2026-08-27

🔴 **This one is time-critical and nothing else on the list is.** AY2026 has
term rows for 1, 2 and 3 only. **Term 3 ends Friday 4 September**, and after
that date no term owns a single day — so from 7 September **attendance cannot
be marked anywhere in the school**, and a parent filing an absence for those
dates is either refused or silently expands to zero days. Nothing on any
screen explains why.

⚠ **Most of the answer is already in the school's own calendar, which is why
this asks for one date rather than four.** `AY 2026 Calendar.png` gives **Start
of Term 4 = Monday 14 September**, term break 7–11 September, and the yearend
school holiday running 24–30 November. What it never states is where Term 4
**ends** — it can only be inferred from the holiday starting the day after.
Mr Ace's call, 2026-08-27: **ask, do not infer.** So the message states what we
already have and asks only for the missing piece.

⚠ **Do not ask them to list the Term 4 holidays from scratch.** They are on the
same poster (2 Oct Children's Day, 8–9 Nov Deepavali, 23 Oct Term 4 Marking
Day, 6 Nov Awards Deliberation Day). Reading them back for confirmation is one
line; asking them to compile a list is homework, and this file has recorded
twice what happens when a message grows.

**What we do with the answer, so nobody has to ask twice:** re-run Create AY
for AY2026 on `/sis/ay-setup/manage` (idempotent — it inserts only the missing
term row and copies nothing else), set the dates, then seed the calendar and
mark the closures. ⚠ **The seeding is not optional tidying**: a term with dates
but no calendar rows blocks nothing at all, so weekends would become markable.

> Good afternoon,
>
> One quick thing about the school calendar, and it is time-sensitive.
>
> The system currently has Term 4 missing for this academic year — Terms 1, 2
> and 3 are set up, Term 3 ends on Friday 4 September, and there is nothing
> after it. From Monday 7 September onwards teachers will not be able to mark
> attendance at all, and parents filing an absence or travel declaration for
> those dates will be turned away.
>
> From the AY2026 calendar I have Term 4 starting on **Monday 14 September**,
> after the 7–11 September term break. What the calendar does not say is when
> Term 4 **ends**. The yearend school holiday begins on 24 November, so I
> assume the last day of term is either **Friday 20 November** or **Monday 23
> November** — could you confirm which?
>
> And could you confirm these are the non-school days inside Term 4, which I
> have taken from the same calendar:
>
> - 2 October — Children's Day
> - 23 October — Term 4 Marking Day
> - 6 November — Awards Deliberation Day
> - 8 and 9 November — Deepavali and the day in lieu
>
> If there are others, or if any of the above has moved, please let me know.
>
> Once I have the end date I can set Term 4 up straight away.
>
> Thank you.

### To Christina — 1 of 5 · student details for teachers

⚠ **Rewritten 2026-08-09, because the original was wrong on its central claim,
and shipped since.** The old question 3 told her the system had nowhere to
record a special-needs declaration. It has: `additionalLearningNeeds` and
`otherLearningNeeds` are on the enrolment form, on the application row, on the
Records page and in the edit sheet. Sending that question would have asked her
to specify something the school already collects. See _Answers received_ →
_What production actually holds_ for the counts.

The drawer described below is now live, so what remains for her is confirmation
and the one genuinely open question (whether teachers may add to it).

**Trimmed 2026-08-11.** "Is that the right set — medical, learning needs,
contacts — or is something missing?" is cut. It is open-ended fishing with no
build attached; she will either say nothing or invent scope on the spot. The two
that remain both have consequences: one ratifies a live permissive default, the
other decides whether teachers get write access to medical data.

**The counts are now dated in the message rather than stated as standing fact.**
They came from an ad-hoc query on 2026-08-09 and no script reproduces them, so
they cannot be re-verified without going back to production. "When I looked at
the start of August" is true and checkable; the bare present tense was not.

> Hi Ms Christina,
>
> On the allergies and special-needs information you wanted teachers to see.
>
> **This is now built, and I want to check I have it right rather than ask you
> to design it.** A teacher opens a student from their own class list and sees
> three things: any medical conditions and allergies, anything recorded under
> learning needs, and the parents' contact numbers. It is read-only. Teachers
> still cannot open the Records module — this is inside their own class.
>
> **On the special-needs declarations you mentioned** — "diagnosed with ADHD,
> for instance" — those are already being collected on the enrolment form, in a
> box called Additional learning needs. When I looked at the start of August,
> **65 families had written something there, and about half of it was real**:
> ADHD, autism spectrum disorder, speech and language delay, shadow support,
> SPED. The rest is parents typing "NA", which the system now hides. So this was
> on file all along; it simply never reached a teacher.
>
> 1. Every teacher who teaches that student can see it, including subject
>    teachers, not only the form class adviser. Is that what you want?
> 2. Should teachers be able to **add** to any of this, or only read it? At the
>    moment only the office can change it.
>
> One thing worth knowing: **the tick-box medical fields are nearly all empty.**
> On the same look at the start of August, out of 498 students there were 4 with
> allergies recorded, 1 with asthma, and none at all for epilepsy, diabetes or
> heart conditions. One parent described
> their child's epilepsy in the learning-needs box instead, where the tick-box
> would never have found it. If the school holds this information somewhere
> else, it is worth getting it into the system so it reaches teachers.
>
> Thank you.

### To Christina — 2 of 5 · medical certificates

**Trimmed 2026-08-11, four questions to two.** Her ask (31:07) was two things:
can we still edit the attendance, and can we upload the MC. The first was
answered in the room. Where the file is stored is mechanics — ours to decide, and
it follows from who uploads it anyway. The report-card line stays because it is
a live behaviour she has never been told about, but as a statement, not a
question.

**Second pass the same day:** the two questions had been merged into one, which
would have got one answer to a two-part question. Split. The merged version also
explained that teacher-upload is harder than office-upload — **cut deliberately.**
That is our constraint, not hers, and putting it in front of her steers the
answer toward the cheaper build. If she says teachers, the security work is ours
to do.

**Facts in this block are verified** (2026-08-11): the rollup at
`068_attendance_late_enrollee_proration.sql:54` counts `P`, `L` and `EX` into
`days_present`, and `ATTENDANCE_ROWS` in `components/report-card/report-card-document.tsx:386`
renders only School Days / Days Present / Days Late — `days_excused` and
`days_absent` are stored and never shown.

> Hi Ms Christina,
>
> On uploading the medical certificate.
>
> **Right now** a teacher can mark a student excused and type a note saying an
> MC was submitted. That note is only visible inside the Attendance module. The
> certificate itself cannot be uploaded anywhere.
>
> 1. Who would upload it — the teacher who marked the absence, or the office?
> 2. Who needs to be able to open it afterwards?
>
> One thing worth knowing, because it is easy to miss: **an excused absence
> already counts as present on the report card.** The card shows only Number of
> School Days, Days Present and Days Late — so a student who was out on an MC is
> not shown as absent at all, and the reason never appears on it. Tell me if that
> should change.
>
> Thank you.

### To Christina — 3 of 5 · disciplinary records

**Trimmed 2026-08-11, six questions to three.** Her ask (18:20) was already a
spec — open a student, see the incidents they were involved in for the whole
year, warning letter or suspension. The report-card, parent, awards-effect and
FCA-comment questions were invented here; she raised none of them, nothing is
built, so the default is staff-only. Asking would have offered her four features
she never requested.

**Corrected the same day: the first trim went too far.** "Where are incident
reports kept today?" had been cut as invented — it is not. She said "we file
incident reports" herself, and the answer decides whether this is a migration of
existing records or a fresh start. Restored. The rule is _anchored in something
they said_, and that question is anchored; over-cutting is its own failure.

**Verified 2026-08-11:** there is genuinely nothing behavioural in the schema.
The five migration hits for `incident`/`disciplin` are all false positives —
"Discipline" as a **subject name** in the schedule seeds (074, 090), "KD #119
discipline" meaning rigour, and one code comment.

> Hi Ms Christina,
>
> On the incident reports and disciplinary records.
>
> **Right now there is nothing about behaviour in the system at all.** What you
> described — open a student and see the incidents they were involved in across
> the year, and whether it was a warning letter or a suspension — is all
> buildable, and it would sit on the student's record where you would expect to
> find it. Staff only.
>
> 1. Where are incident reports written and kept at the moment? You mentioned you
>    already file them, and knowing where they live decides whether we bring the
>    existing ones across or start fresh from here.
> 2. When an incident is recorded, would you want to **upload the report or
>    warning letter itself**, or type a short summary of what happened, or both?
> 3. Who should be able to see a student's record — every teacher who teaches
>    them, only the form class adviser, or only leadership? I ask because you said
>    "click the name of the student", and that page is one teachers cannot open
>    today.
>
> Thank you.

### To Christina — 4 of 5 · awards and certificates

**Trimmed 2026-08-11, five questions to one.** Her ask (19:08) named most of the
fields itself, so question 1 became an assumption to correct rather than a
question to answer. Report card and parents were invented here. House points is
Chandana's thread and Hanafi's sheet — it does not belong in a message to
Christina, and Chandana has already confirmed points do not touch the academic
tiers.

> Hi Ms Christina,
>
> On the awards and certificates of participation.
>
> **Right now the system only has Gold, Silver and Bronze**, worked out
> automatically from a student's average marks, and visible to staff only. What
> you described is a different thing altogether — competitions, certificates of
> participation, something you can pull up at the end of the year to cite at the
> moving up ceremony. So it needs its own place rather than being added onto
> those three.
>
> I am assuming each entry would record the **award name, the date, who gave it,
> and the certificate file** where there is a soft copy. Tell me if anything is
> missing.
>
> 1. Who would enter these — the teacher who ran the activity, or the office?
>
> Thank you.

### To Christina — 5 of 5 · grade-change approvals

**Trimmed 2026-08-11, five questions to three — and two of the three are
corrections, not questions.** She answered the count and the names herself at
46:04 ("two approvers, Ms. Chandana and I only"), so asking again is asking her
to repeat herself; Wynne's "can we add more" was overridden in the room by that
answer. "Should anything else need approval" was invented here. What is genuinely
unknown is who AEB is — the term is never expanded anywhere, by anyone.

> Hi Ms Christina,
>
> On approving grade changes. You described two routes — two approvers before the
> report book goes out, AEB approval after it has been issued. Two things about
> how the system works today do not match that, and there is one thing I still
> need from you.
>
> 1. ⚠ **Whoever responds first decides the request.** The second person's
>    response is recorded, and the system does ask them for it, but it cannot
>    change the outcome — the change goes through, or does not, on the first
>    reply alone. So it is not really two signatures. If you need both of you to
>    agree before a change takes effect, tell me and I will change it.
> 2. ⚠ **The teacher raising the request chooses which two approvers it goes
>    to**, from a list of everyone eligible. You said it should be you and Ms.
>    Chandana only — today the system does not enforce that.
> 3. On the second route: **who is AEB, in terms of actual people?** I have the
>    rule — once the report book has been issued, the request goes to them instead
>    — but I need to know who to send it to, and whether it is one person or
>    several.
>
> Thank you.

### To Koh — at-risk students

⚠ **Rewritten 2026-08-10.** The original told her only subject teachers could
see the flagging and asked, as question 1, whether the form class adviser
should get it too. That shipped on 2026-08-09 as KD #182, so sending the old
version would have asked her to decide something already built — the same
mistake the message to Christina made about learning needs. Both of her
genuinely open questions survive below.

**Trimmed again 2026-08-11 — this block now asks her nothing.** All three
questions are gone and it is a notification plus a correction, which is the right
shape for it.

- **"Should anyone be told when a student is flagged?"** — cut. Notification is
  not built and she never asked for it; she asked to "flag out students", which
  is a list, and she has one. Same invented-question pattern removed from
  Christina's blocks the same day; it survived only because it was already
  written.
- **The five-point threshold** — **decided by Mr Ace 2026-08-11: keep 5 as the
  default, do not ask.** The message now states the number and offers to change
  it after she has used it for a term. Asking a teacher to pick a sensitivity
  threshold before she has seen the feature fire is asking her to guess.
- **"Should this ever reach parents?"** — **decided by Mr Ace 2026-08-11: no,
  and do not ask.** The teachers want the ability to see and monitor; contacting
  the parent stays the teacher's own judgement, as it already is. The message
  already states it is staff-only, so the fact reaches her without the question.

What remains is worth sending on its own: she learns the feature shipped and
reaches both people she named, and she gets the ⚠ correction about exam totals.

**The exam-total correction is verified** (2026-08-11): change requests can only
carry `ww_scores`, `pt_scores`, `qa_score`, `letter_grade` or `is_na` — enforced
twice, at the zod enum in `lib/schemas/change-request.ts:3` and a DB `CHECK` at
`009_change_requests.sql:31` — and the row keys off a `grade_entry_id`, so it
cannot address subject config at all. She was told wrong in the session.

> Hi Ms Koh,
>
> The at-risk flagging you asked for is in, and it reaches both of the people
> you named.
>
> **A subject teacher** sees it on their own grading sheet — a **Look up
> student** button listing who needs a look in that subject, with what dropped
> and by how much.
>
> **A form class adviser** now has the same button in Classroom, under Grades.
> Theirs covers **every subject the class takes**, ranked by the steepest fall,
> and opening a student shows what slipped along with the parents' phone
> numbers — since you said the point of the flag was contacting them.
>
> Nobody is notified; you open it yourself. It is not on the report card and
> parents cannot see it.
>
> A drop of five points or more is what raises a flag. If that turns out to be
> too sensitive or not sensitive enough once you have used it for a term, tell me
> and I will change the number.
>
> One thing you will notice: subjects marked with letters rather than numbers —
> MAPEH and the like — show as a band change, "A → C", instead of a points
> drop. A five-point movement in those subjects usually just means the letter
> moved, which is not the same thing as a child slipping.
>
> ⚠ Also a correction to something you were told in the session. You asked
> (47:20) whether an exam's total marks could be changed through a change
> request — the answer given was yes, but that is not right. Total marks are part of the
> subject settings and are changed by the academic coordinator (Ms Joann).
> Change requests are for a student's scores only. Sorry for the confusion.
>
> Thank you.

### To Christina — the book list, the subject names, and two open questions · NOT SENT, written 2026-08-28

**Why this is one message and not two.** Mr Ace confirmed on 2026-08-28 that the
admin session's **"Tin" is Christina** — so the admin file's #3 (the book list)
and #4 (the approved subject names) are hers, not a separate person's, and they
join the two things already outstanding on her own thread. Four asks, one send.
Sending two messages to the same person in the same week is how a list grows.

**Every ask is anchored to something she said**, which is this file's rule:
#3 and #4 are hers from the admin recording (48:44, 50:36/52:16); the
five-station chain is her own 2026-08-12 reply; the outcome question comes from
her 18:20 ask to see "whether the student received a warning letter or
suspension".

⚠ **The STAR wording is a genuine conflict, not a request for confirmation.**
The admin session recorded "Sports, Talent, Arts, and **Research**"; Mr Hanafi's
deployment workbook writes "Sports, Talent, Arts and **Rhythm**" throughout
(`scripts/backfill/gen-teacher-assignments.ts:199,773`). Two school documents
disagree and only she can say which is approved. **Ask it as a conflict** —
asking her to "confirm the name" invites a yes to whichever version we quote.

⚠ **The outcome question is the fourth ask on this subject and it must not
widen.** Mr Ace already knows the shape — _"suspension is the last anyways like
any other rule there are strikes before suspension"_ — and the system already
shows the strikes. **Ask what gets written down when one happens and on what
form. Do not ask whether they suspend students**, and do not propose a
`record_type` for it; that is ours to decide once she answers.

**Not asked, and why not:** showing her Classroom before scoping SOW. It is the
right next move on her teachers'-dashboard ask, but it is a **demonstration, not
a question** — it belongs in a call, not in a list of things she has to answer.
Also not asked: who records an award (decided by Mr Ace 2026-08-12), who the AEB
members are (resolved 2026-08-12), and whether the five-station chain belongs in
the SIS (she answered that in the room at 50:57).

> Hi Ms Christina,
>
> Four things, and two of them are quick.
>
> **1. The book and supplies list.** During the admin session you mentioned
> tracking which books and materials each student has been issued, because there
> have been disputes about it before. I can build that, but I need the list of
> what is issued per level first. Whatever form it is already in is fine.
>
> **2. The subject names, and one conflict.** I want to get the approved subject
> names into the system exactly as they should appear. There is one I cannot
> resolve on my own — I have the full name of STAR written two different ways in
> two school documents:
>
> - Sports, Talent, Arts, and **Research**
> - Sports, Talent, Arts and **Rhythm**
>
> Could you tell me which is the approved wording? And if there are any other
> subject names that should read differently from what is in the system now,
> please send those too.
>
> **3. The approval steps before a report book is issued.** You mentioned a
> sequence — subject monitor, then subject head, then the officer in charge,
> then the Assistant Principal, then the Principal. I want to check I have that
> right before building it, because during the training you also mentioned two
> approvers for a grade change. Are those two different situations, and is the
> five-step sequence the one that applies before a report book is issued?
>
> **4. Where a disciplinary outcome is written down.** In the training you asked
> to be able to see whether a student had received a warning letter or a
> suspension. The incident report form you kindly sent records the incident and
> the counselling referral, but there is no field on it for the outcome. So when
> a student is given a warning letter or a suspension, what gets written down,
> and on which form? If it is recorded somewhere other than that form, a blank
> copy would help.
>
> Thank you po!

### To Wynne · SENT 2026-08-21

✅ **Sent, and it carried one more item than the draft below.** Mr Ace asked for
the **Transcript of Records template** as written, **plus the additional list of
documents to track for student P-Files**. The P-Files half is new — it did not
come from this session and is not one of the eleven action items; it will change
`DOCUMENT_SLOTS` if she names slots the system does not hold.

✅ **The P-Files half came back 2026-08-25 — and it does name slots we do not
hold, eight of them.** Verbatim and cross-checked in _Answers received_ → _The
P-Files document list_. ⚠ **The Transcript of Records half is still outstanding.**

**Only one send now remains outstanding: Koh** (a notification plus the
exam-total correction — it asks her nothing).

**Trimmed 2026-08-11, two items to one.** The approver question was hers (45:30)
but Christina answered it in the same exchange at 46:04 — two for the normal
route, AEB after issue. Asking Wynne for a number would be asking her to decide
something the Academic Head had already decided ninety seconds later on the same
recording. The remaining unknown is who AEB is, and that is Christina's to
answer, not Wynne's.

> Hi Ms Wynne,
>
> **Transcript of Records** — you offered to send the template during the
> training. The data is all there and goes back across school years, so the
> template is the only thing I am waiting on. Could you send a copy, or a recent
> one with the student's details removed?
>
> Thank you.

### To Chandana — the AEB approval form · SENT 2026-08-21 · ✅ HALF ANSWERED

✅ **The form arrived 2026-08-27** and is written up in _Answers received_ →
_Chandana — the AEB approval form_. **The anchor question is answered: a grid of
five names, so the board signs as a body.** It also reframes #11 — the form is
not about grade changes.

⚠ **One half is still outstanding: does the AEB membership change?** The form
cannot answer it. If a reminder goes out, ask only that — do not re-ask for the
form or for the members' names.

**Sent by Mr Ace, in his own words.**

> hi ms. chandana,
>
> you mentioned po that grade changes after the report book is issued will
> require the AEB approval form and approval from all AEB members.
>
> may i request po a copy of the AEB approval form? blank po or a recent one
> with the student's details removed, whichever is easier.
>
> also po, does the AEB membership change — like every school year — or is it
> the same group?
>
> thank you po!

**Why the form, and not a question about the order.** Chandana named it herself
on 2026-08-14 — _"We have specific AEB approval form"_ — so it exists and is
controlled. **Signature blocks numbered down the page mean sequential; a grid of
five names means parallel.** It should also show whether each member's approval
is recorded separately, and whether the form is versioned like the incident
report (`C4.6.1-F02`). Asking for the artefact beats asking anyone to describe
their own process — the same move that worked for the incident report, and it
settles the one real cost of Mr Ace's 2026-08-21 sequential ruling without
reopening it as a discussion.

**Why the membership question was re-aimed before sending.** The draft asked
whether members _"can be changed/updated in the system"_ — but that is **ours to
decide, not hers**, and we would build the roster editable either way since staff
come and go. The version sent asks whether the membership **actually changes**,
which only she knows and which has a real consequence: if people rotate on and
off, an approval from a past year must keep **who was on the board then**, not
re-render with today's roster (the historical-vs-current-truth rule, KD #147). If
it is a fixed group it is just a list. Same trim the other blocks in this file
have had — cut the storage mechanics that are ours, keep the fact that is theirs.

"Blank or with the student's details removed" is deliberate: it is what unblocked
the incident report sample, removing the privacy hesitation before she has it.

**Not asked, and why not:** who the AEB members are — already resolved
2026-08-12 (Chandana + Christina + Norma + Gary + Nina). Do not re-ask.

### Not asked, and why

**Melissa** — she asked two things. Teacher access to medical alerts and
learning difficulties (21:53) is the same feature as Christina's first message,
folded in rather than asked twice, since two answers to one question is worse
than none. Her second (32:44) was the excused-absence comment, which has
shipped.

**Hermilita** — her ask (59:13) was per-component descriptions on the grading
sheet: what the assessment was, when it was administered, its scope. All three
already exist in Activity Labels. Nothing to ask.

**Marrie** — she raised relief teachers (33:18) and Christina answered it in the
room. It is a policy question the school owns, not a design question for her.

**Joel** — no open items.

**Hanafi** — not in the room, and asked anyway. Chandana's reply named him as
the owner of both the house list and the points, so the questions that were
being held for her turned out not to be hers.

**Where the line falls.** Reach is theirs to decide; mechanics are ours until
they ask. So nobody is being asked how long a medical certificate should be
kept, whether house points reset each year, whether points can be taken away, or
whether there should be a leaderboard — none of it was raised, and asking would
turn a request into a specification exercise.

**The Hanafi message stays on the right side of that line**, though it comes
close. It asks him to send the file he already keeps; it does not ask him how
points should work. The distinction matters: house points is a live manual
process with an owner, so the mechanics are observable, and observing them is
cheaper and truer than getting them specified in an email. The one genuine
question in it — whether staff should see the standings — is reach.

The relief-teacher question is also held back, but for a different reason: the
real gap is that **a form class adviser cannot see the attendance audit log at
all**, so a teacher cannot check who altered their own register. That needs
fixing before it is worth asking anyone how covering should be recorded.

## What production actually holds

Not a reply from anyone — read straight out of `ay2026_enrolment_applications`
on 2026-08-09, 498 rows, while building T2. Recorded here because two of the
questions drafted above were written on a wrong picture of the data, and the
next person to read this file should not have to re-derive it.

**The learning-needs field exists and is in use.** 65 applications carry
something in `additionalLearningNeeds`. Running the drawer's junk filter over
them splits the free text cleanly:

- **35 values are nothing-to-declare** — `NA`, `N/A`, `N.A.`, `Na`, `na`,
  `None`, `none`, `No`, `-`. Parents filling a box because it is there.
- **32 are real**, and they are exactly what Christina described: `Attention
Deficit Hyperactivity Disorder (ADHD)` (three students), `Autism Spectrum
Disorder` (two), `Speech and Language Delay`, `Behavioral Concerns
(General)`, `ABA Therapy`, `Shadow Support`, `SPED`, `HAPI Journey Learning
Support`, `EIP because of speech delay`, `may need supplemental classes for
Math`.

**The tick-box medical fields are all but empty.** Allergies 4, food allergies
2, eczema 3, asthma 1, dietary restrictions 8, paracetamol consent 25 — and
**zero** for epilepsy, diabetes, heart conditions and other conditions.

⚠ **One student's focal epilepsy is recorded in the learning-needs box while
the epilepsy tick-box is unticked.** That single row is the argument for
surfacing both fields together rather than trusting the structured one, and it
is why the drawer treats a free-text medical note as reason enough to raise the
safety strip with no condition ticked.

The counts also set expectations honestly: **most students will show "Nothing
recorded" on both tabs.** That is the data being thin, not the feature being
broken, and the drawer does not disguise it.

## Answers received

Replies to _Questions to send_, under the same rule as _The record_: the words
as they arrived, not a summary of them.

### Chandana — house · 2026-08-06

Two messages. The first is her reply to the block above; the picture followed
after her class, as its last line promises.

> Dear Mr Ace,
>
> There is a House point system where the students are given points for all the
> competitions they participate. We have allocated houses to all the students.
> Currently Mr Hanafi is the one handling the list and the points. Towards the
> end of the year, there will be trophy for the overall points. There is no
> particular names given other than the house colours - Blue House, Green House,
> Yellow House, and Orange house, with a house symbol. I will share the details
> after my class today

Then the picture — headed "House Colours, Names & Meanings", with the line "Each
House represents a core set of values":

| House        | Named     | Values                                          |
| ------------ | --------- | ----------------------------------------------- |
| Orange House | The Flame | Courage · Energy · Drive · Leadership           |
| Green House  | The Leaf  | Growth · Balance · Endurance · Renewal          |
| Blue House   | The Ocean | Wisdom · Integrity · Stability · Excellence     |
| Yellow House | The Sun   | Optimism · Creativity · Brilliance · Innovation |

**What it settles.**

- **Four houses, named by colour.** The tokens shipped with migration 110
  already match what she describes — `--av-house-1` is orange, `-2` blue, `-3`
  green, `-4` yellow — so this is a rename and nothing more (T6).
- **The virtue clash flagged in question 4 is a non-issue.** Sections are named
  after virtues, houses after colours and natural symbols, so no word does
  double duty on a screen. "Integrity" is one of Blue House's values _and_ a
  section name, but the house is only ever labelled Blue House, so the two never
  meet.
- **Every student is already allocated**, and the list exists. It is Hanafi's.
- **House points is not a proposal — it is already running.** Points for
  competitions entered, recorded by Hanafi, with an overall trophy at year end.

**What it does not settle.** Questions 1, 2, 3, 6 and 7 came back unanswered:
the report card, parents, and the awards link. The last of those is the one that
matters. At the training she tied points to awards herself — "all the awards,
everything, they will also receive the house points" — and this reply describes
points as coming from competitions instead. Those are two different claims, and
the first is part of why KD #178 built no points ledger.

**Where her two messages disagree.** The written reply says "no particular names
given other than the house colours". The picture gives every house a name and
four values. The picture came second and carries more, but she never restated it
in words, so whether it is settled HFSE branding or someone's draft is exactly
what the follow-up's question 4 asks.

**What changed hands.** Points belongs to Hanafi, not Chandana. Item #9 has been
sitting on the wrong person's list since the training.

### Chandana — house, follow-up · 2026-08-06

> Hi Mr Ace,
>
> House colour need not be there in the report book for now.
>
> Would be good if parents can see their child's house name in the parents
> portal.
>
> House points will not affect any academic awards. It will still be based on
> students score in exams.
>
> For now, the house name would do and we have house logo based on the colours
> designed by Mr Lloyd. But this remains optional to add in the portal. We can
> consider it for next year.

All five answered, and nothing on house is open with her any more.

- **Report card — no.** "For now" is hers; the door is not shut.
- **Parent portal — yes**, the house _name_. That is now T8, and the portal's
  direct-read constraint is the thing to check before designing it.
- **Awards — no.** Academic awards stay on exam scores alone.
- **Display — the name only.** "Orange House", not "Orange House – The Flame".
  A logo exists, designed by Mr Lloyd, and she has explicitly deferred it to next
  year. T6 is unblocked.

### Hanafi — the list and the points · 2026-08-06

> Hi Mr Ace, yes i do. Let me share it here with you
>
> This is the link for Student House Colors [sheet]
>
> This is the link of the tracking of house points [sheet]
>
> If you ask me currently it is not shared with any of the staff yet.. However
> we do put up the confirmed points up in the bulletin board so students/staff
> are able to see.
>
> On how the points are calculated, it is also there on the google sheet. So
> usually teachers would give me the name list of students who had participated
> in internal/external competition, points will then be given based on 1st, 2nd
> and 3rd place

Both sheets were read. What follows is from the files, not from his message.

**The allocation sheet.** `Student House Color Assignment`, owned by
`hanafi.hfhse@gmail.com`, last modified 2026-07-03. **24 tabs**: one superseded
master, an HFSE Staff tab, and 22 cohort rosters. Figures below are from
`house/extract.mjs`, run against the downloaded workbook — the Drive reader
flattens every tab into one stream and silently truncates, which is how an
earlier pass mistook the master for "the first part of the list".

**In scope is the 20 class tabs, P1 Patience → Sec 4 — 410 students**, and the
houses come out near-evenly split, which is itself evidence these are the
maintained tabs:

| Blue | Yellow | Green | Orange | Total |
| ---- | ------ | ----- | ------ | ----- |
| 100  | 102    | 104   | 104    | 410   |

**Out of scope for now** (Mr Ace, 2026-08-06): `YS` (YoungStarters, 15 students)
and `VizSchool` (a separate school entity, 3 students). Both are real and both
wait until P1–Sec 4 is done.

**Two allocations, and the split is not close.** Both are per student — every
row carries its own colour — but they disagree wholesale. Of the master tab's
389 rows: **91 agree with the class tabs, 292 give a different house**, 6 exist
only on the master, and the class tabs carry 27 students the master never got.
The master reads as a roster chunked into four blocks; the class tabs are
balanced within each class.

**Settled 2026-08-06 by Mr Ace: the class tabs are the live list.** They write
the value as `🔵 Blue`, with the emoji; the master writes plain `Green` with
none, which is the fastest way to tell them apart.

⚠ **The master tab is still in the file.** Anything built against this workbook
must name its tabs rather than take what it finds first — loading that one would
mis-assign roughly three students in four.

**Three more things, none of them blocking:**

- **No student numbers**, and no dates of birth. Names only, as
  `SURNAME, First M.`, which at least splits cleanly on the comma — worth
  something given `DELA CRUZ`, `SAN JOSE` and `SANTHOSH KUMAR`. We store
  `firstName` / `middleName` / `lastName` separately and the sheet carries only a
  middle initial, so matching is surname + first name with the class as tiebreak.
- **Five names are incomplete** — `Rabaya` (P3 Courageous), `Shen Bustamante`
  (Sec 2 I2), and `Ariana`, `Richie`, `Matthew` (Sec 3). Verified: no fuller
  version of any of them exists on any tab of either workbook. All five sit at
  the **foot** of their tab, below the alphabetical run, which is where late
  joiners get appended. `Shen Bustamante` is the soft one — a full name in
  First-Last order, so matchable on the surname; `Rabaya` reads like a surname
  with the first name missing. No name appears on two tabs.
- **The per-tab tallies check our extraction, and are not data themselves.** Each
  tab counts itself at the foot, and 19 of the 20 agree with their own rows
  exactly — a verification of the parse written by the data's owner rather than
  by us. P1 Obedience is the exception: rows give Blue 6 / Yellow 5 / Green 3 /
  Orange 4 against a stated Blue 5 / Yellow 5 / Green 4 / Orange 4, both
  totalling 18, and only `LUZANO, G Anne D.` being Green reproduces the stated
  figures.

  **Not a data problem — the tallies are typed by hand, not formulas** (Mr Ace,
  2026-08-06). Somebody moved her and did not retype the count. **The rows are
  the data; a tally is an annotation.** Luzano is Blue, there is nothing to ask,
  and no importer should ever read those numbers as authoritative.

- **Class names do not match ours** — "P2 HUMILTY", "P3 RESONSIBILITY", "SEC
  1D1". A matching hint, never a key.
- **A staff tab**, allocating ~44 staff across the four houses. See T9.

**The points sheet turned out to be the more valuable of the two**, because it
carries a written scoring scheme rather than a description of one:

| Source                         | Gold / Winner | Silver / 1st RU | Bronze / 2nd RU | Participation |
| ------------------------------ | ------------- | --------------- | --------------- | ------------- |
| External competition           | 20            | 15              | 10              | 5             |
| Internal competition           | 5             | 4               | 3               | 1             |
| Sports Fest 2026 (major event) | 20            | 15              | 10              | 5             |

Plus a monthly **Attendance Challenge**: 1 point for 100% attendance, 2 for 100%
without tardiness ("On Time Bonus"), capped at 3.

Points are awarded to an **individual student**, carry that student's house, and
are then summed per house — the running totals at the time of reading were
Orange 124, Green 117, Blue 101, Yellow 76, across five events (Sports Fest,
Visual Spatial Mathlympic, Maths Week, Attendance Challenge, Science Quiz Bee).

**⚠ Gold/Silver/Bronze means two different things at HFSE, and this is the
knot that has been sitting under item #9 since the training.** In this sheet
they are **competition placings** and they _do_ earn house points. In the
system they are **academic award tiers** derived from a numeric average (KD
#95) and, per Chandana, they do **not**. So her training line — "all the
awards, everything, they will also receive the house points" — and her
2026-08-06 line — "house points will not affect any academic awards" — were
never in conflict. She was talking about competition awards both times.

**What that resolves.** The awards that feed house points are Christina's #8,
the awards-beyond-Gold/Silver/Bronze table that does not exist yet. So "#9
overlaps #8" is now established rather than suspected, and the KD #178 caution
against building points first is confirmed by the data: a points ledger is a
column on a competition-award row, not a feature of its own.

**One automation candidate, noted and not built.** The Attendance Challenge is
scored from data the system already owns exactly — 100% attendance in a month,
and lateness. Nothing else on that sheet is derivable from the SIS.

**On visibility**, his answer is narrower than the question: the standings are
not shared with staff today, but confirmed points go up on the bulletin board,
so students and staff do see them. He did not say whether they should be in the
system.

### House points — the live scoring sheet · 2026-08-12

Mr Ace supplied the working Google Sheet (`House Points Tracking AY2026`; the
local `house/House Points Tracking AY2026.xlsx` is a copy of the same thing).
**This is the answer to #9, and it settles that #8 and #9 are ONE feature.**

**Every points row is an award row.** The sheet's columns are literally
`Class | Award | Name | Game Title | House Colour | Points`. So Christina's
awards register (#8) and Chandana's house points (#9) are the same table read
two ways — per student for the moving-up ceremony, summed per house for the
standings. Chandana tied them together herself at 23:51 and this is the proof.

**Four scoring scales, not one:**

| Scale                     | Gold | Silver | Bronze | Participation |
| ------------------------- | ---- | ------ | ------ | ------------- |
| **External** competitions | 20   | 15     | 10     | 5             |
| **Internal** competitions | 5    | 4      | 3      | 1             |

| Sports Fest (major event) | Winner 20 · 1st Runner Up 15 · 2nd Runner Up 10 · Participation 5 |
| **Attendance Challenge**, per month | 100% attendance **1** · 100% without tardiness ("On Time Bonus") **2** · capped at **3** |

So the same word — Gold — is worth 20 points or 5 depending on whether the
competition was external or internal. **`internal | external` is a required
field on the award row**, not a nicety.

⚠ **NAMING COLLISION, and it is a bad one.** These Gold / Silver / Bronze are
**competition placings**. `lib/compute/awards.ts` Gold / Silver / Bronze are
**academic tiers derived from a numeric average** (KD #95), with school-tunable
thresholds in `school_config`. Same three words, unrelated meanings, and both
will appear on the same student's record. Chandana has already confirmed house
points do not touch the academic tiers — but whatever the new table calls its
column, **do not reuse the academic vocabulary without a qualifier**.

**Live AY2026 standings on the sheet:** Blue 101 · Orange 124 · Yellow 76 ·
Green 117, across Sports Fest 2026, Visual Spatial Mathlympic (external), Maths
Week (internal) and a Science Quiz Bee. The Attendance Challenge row is **blank**
— scored by hand elsewhere, or not yet scored.

**The Attendance Challenge is fully derivable from data the SIS already holds.**
100% attendance in a month, and lateness, are `attendance_daily` queries — the
only line on that sheet that is. Noted as an automation candidate at the Hanafi
answers above and still not built; it is the cheapest useful thing here.

**What the real sheet does NOT carry, against what we assumed:** no date, no
issuer, no certificate file. It tracks event title, placing, house and points.
The certificate file is still wanted — Christina asked for it for the moving-up
ceremony — but the fields the school actually maintains are the competition
ones. Wait for her sample certificate before fixing the schema.

### Christina — the four asks · 2026-08-12

Replied to the message sent 2026-08-11. **Three answers are small and usable.
The fourth is not an answer to the question asked, and it is much larger than
anything currently built.**

**Medical certificates — settled.**

- **The FCA uploads it**, as supporting evidence for marking the absence
  excused. Her words: "supporting evidence to be considered as 'excused
  absence'".
- **The reason must NOT appear on the report card** — so the live behaviour
  (`EX` counts into `days_present`, no reason rendered) is confirmed, not
  changed. This is the first time that behaviour has been ratified by the
  school.
- She does want "an internal record of those absences as well as its supporting
  documents" — an internal view, separate from the card.
- **Viewing: FCA and above** — Mr Ace, 2026-08-12. She stated only who uploads.
  In role terms: the student's form class adviser, plus academic_coordinator /
  school_admin / superadmin. (Supersedes the narrower 2026-08-11 note of
  "FCA + school_admin and above".)

**⚠ Her second idea is a new feature, not an answer.** "In my sons' schools,
parents file a leave of absence online and attach the medical certificate."
That is a parent-portal workflow — parent-initiated absence requests with an
attachment — and it is an order of magnitude larger than an FCA upload button.
**Parked, not folded in.** If it is ever picked up it is its own piece of work,
and note the parent portal can only read `school_config` and
`report_card_publications` today.

**Disciplinary records — samples coming by email.** Viewed by **the Discipline
Committee and the FCAs, including the one who filed it**. "Including the one who
filed it" implies the filer may not be an FCA, so filing is wider than viewing —
worth pinning down when the samples arrive.

**Awards — sample coming by email.** Viewed by **FCAs, academic leaders and the
registrar**. She answered only who views; **who RECORDS an award was decided by
Mr Ace, 2026-08-12: FCA and up** — the student's form class adviser plus
academic_coordinator / school_admin / superadmin. Same shape as the MC decision.
Note "registrar" is the pre-KD-#155 name for academic_coordinator.

### Chandana — mid-year SOW changes · 2026-08-12

**Answered, and it closes the last open SOW question.** Changes do happen
mid-year, they are **rare**, and they **apply to the current year** — so a
mid-year revision reaches in-flight terms rather than only future ones.

**This confirms the KD #176 resolution rather than reopening it.** That entry
accepted a cost — the Totals editor is coordinator+ only, so a real mid-year
change means Joann opening each affected sheet — on the explicit condition that
changes stay rare. Chandana has now said they are. The revisit trigger stands
unchanged: a genuine mid-year revision across a whole level, at which point
build bulk totals editing rather than per-level configs.

**⚠ Grade-change approvals — she did not answer the question, and described
something far bigger.**

> ⚠ **Attribution unverified — "she" here is almost certainly Christina, not
> Chandana, and this block sits under the wrong heading.** Two other places in
> this file put this answer with Christina: the Status table (#11, "Christina
> 46:04") and _Waiting on the school_ ("**Christina** — answered 2026-08-12, and
> the approvals answer reopened everything"). It matters now that a genuine
> Chandana reply exists (2026-08-14) which is **silent on the five-station
> chain**. Left unmoved rather than re-filed on inference — the rule in this file
> is that a correction cites its source, and the source is the message thread,
> which is not in the repo. **Mr Ace to confirm, then move or re-head this
> block.**

Asked whether changes would always go to her and Ms.
Chandana, she neither confirmed nor denied. Instead:

- **After the sheet is locked, before the report book is issued:** subject
  monitor → subject head → OIC → Assistant Principal → Principal. The arrows are
  hers; it reads as a **five-step sequential chain**.
- **After the report book is issued:** the **Academic and Examination Board
  (AEB)** — so AEB is a body, which is why "who is AEB" was the wrong question.
  Five members: **Ms Chandana, Ms Tin, Ms Norma (`norma.hfhse@gmail.com`), Mr
  Gary, Ms Nina.** ⚠ **"Ms Tin" is Christina** — Tin is her nickname (Mr Ace,
  2026-08-18). Kept verbatim above because it is her wording, but read it as
  **Chandana + Christina + Norma + Gary + Nina**: the board includes the
  Principal, she is describing one she sits on, and only three of the five are
  people this file had never otherwise placed. It also removes the apparent
  oddity of her naming a five-member board she was absent from.

**This contradicts what she said in the room** (46:04, "it would require two
approvers, Ms. Chandana and I only") and it is not a widening of the current
design, it is a different one. Today: two approvers, first to act decides, no
concept of ordering. Her answer needs **ordered, sequential approval** through
five stations for one route and a **five-member board** for the other. The
dev-plan entry already calls widening past two structurally hard — six copies of
a two-column predicate, and the primary/secondary ordinal derived from column
emptiness rather than stored.

**✅ SETTLED 2026-08-12 — it belongs in the SIS, and she said so at the training.**
This had been written up as an open question ("is that chain the office's paper
process?"). It is not a paper process and it was never open. **Melissa, 50:24**
asked whether MS Teams Approvals was still needed alongside the system.
**Christina, 50:57:** _"The same approvers who are giving the approval via the MS
approvals will be the same approvers who will be put in this system. So you don't
need to. **That will be superseded by this already.**"_

So the chain already runs as a **digital sequential flow in MS Teams Approvals**,
and she has explicitly said the SIS replaces it. That also explains why five
sequential stations felt so unlike the current design — we are not inventing a
workflow engine, we are replacing one the school already uses.

**It is still the largest thing in this backlog.** Ordered approval needs a
position, a current holder, and a rule for where a rejection returns to — none of
which the schema has. But the question of _whether_ is closed; only _how_ remains.

**Seven groups named that exist nowhere in the system:** subject monitor,
subject head, OIC, Assistant Principal, Principal, Discipline Committee, AEB.
None is a role, a capability or a group the system can route to.

**Third personal-Gmail staff member.** `norma.hfhse@gmail.com` follows the same
pattern as `jasmine.hfhse@gmail.com`. So Ms Jasmine, Ms Li and Ms Norma all need
accounts on personal addresses — and Ms Norma sits on the board that would
approve grade changes.

### Christina — the incident report sample · 2026-08-13

The first of the two files she promised. A **real completed case**, supplied by
Mr Ace, sitting at the repo root and gitignored (`*.pdf`, line 59).

⚠ **The case content is deliberately not reproduced here.** Everywhere else in
this file the rule is "the words as they arrived", but this one is a named
child's behavioural record, and the thing we need from it is the **form**, not
the incident. Fields below; the narrative, the student and the second child named
in it stay in the file. **If this doc's convention ever pulls you toward quoting
it, don't.**

**It is a controlled document**, not a memo: `C4.6.1-F02 INCIDENT REPORT · REV
NO. 04 · 28 July 2025`, printed in the footer of all three pages, HFSE Global
Education Group letterhead with the PEI registration number. That is
EduTrust-style document control — the school revises this form and tracks which
revision it is on.

**Page 1 — the incident.**

| Field                            | Notes                                                       |
| -------------------------------- | ----------------------------------------------------------- |
| Name · **Office**                | The filer. Identified by office ("Academics"), not by class |
| Level / Class                    | Matches our section naming exactly ("Sec 1 Discipline 1")   |
| Date · Time                      | Date and a clock time, both filled                          |
| **Student Name (if applicable)** | `SURNAME, First M.` — and **optional**                      |
| Nature of incident               | Reads as a picklist; one value seen                         |
| Details                          | Free text, the narrative                                    |
| **Supporting Document/s**        | A field on the form. Empty on this case                     |
| Other Comments/Remarks           | Free text; carries the next action in practice              |

**Pages 2 and 3 are a different form bolted on**, and blank on this case:
**Referral for Academic / Pastoral Counselling** (is the student aware · may the
counsellor tell them · area of concern · additional information), the same block
again as **Learning Support Program**, an empty **NOTIFICATION** heading with no
fields under it, and `Prepared By` — which is a typed name, because
**"This is a computer-generated form. No signature is required."** Both referral
blocks footnote a separate **Academic/Pastoral Counselling Form** that holds the
detail. So the real chain is incident → referral → counselling form, and only the
first link and the referral flags are on this paper.

**What it settles, and what it breaks.**

1. ⚠ **These are already computer-generated and already numbered — the filename
   carries `Case No. 702`.** Question 1 of the sent block asked where incident
   reports are written and kept, on the assumption the answer decides "migrate or
   start fresh". The real answer is a third thing: **there is a running digital
   process to replace**, exactly like MS Teams Approvals. 701 cases precede this
   one and nobody has decided what happens to them.
2. ⚠ **The filer is an office, not a class role.** "Name · Office" with no FCA
   anywhere on the form. **Our working assumption that the FCA records an
   incident is wrong**, and it is the assumption that made this look like the
   same shape as the MC and award decisions. It corroborates her "including the
   one who filed it" — filing is wider than viewing because filing is an office
   function.
3. ⚠ **There is no disciplinary outcome field anywhere on the form.** Her ask at
   18:20 was two halves — the incidents, _and_ "whether the student received a
   warning letter or suspension or any disciplinary action". This form carries
   the first half and the counselling referral. The sanction appears only as free
   text in Other Comments/Remarks. **The sample answers the half we could have
   guessed and leaves the half she actually emphasised open.** Question 4 in her
   list above.
4. **The student is optional** (`if applicable`), while #7's whole shape is "open
   the student, see their incidents". Decide whether the SIS holds only the
   student-linked subset; a home for student-less incident reports is not
   something anybody asked for.
5. **One report, one subject student.** The Details name a second child as the
   original complaint, and that child is not the subject — he has his own case.
   Cross-references stay prose, which is a clean model and costs nothing.

**Three smaller build facts.**

- **"Nature of incident" is a picklist and we have seen one value.** Asking for
  the list is small and anchored. Do not invent it.
- **The footer is versioned, and will move to REV 05.** Anything the SIS renders
  must carry the form ID and revision, and **store the revision a record was
  captured under** rather than hardcoding it.
- ⚠ **The evidence in this case was video.** The Supporting Document/s field is
  empty precisely because what existed was footage. This is the T3 storage
  problem again and worse — an explicit decision is needed that the SIS stores
  documents, not media, before that field is built.

### Chandana — the same four asks · 2026-08-14

**The 2026-08-11 message went to Ms Chandana as well as Ms Christina** — the same
four asks, the body unchanged (it still reads "will always go to you and ms.
chandana", a copy-paste artefact, so she was asked to confirm a rule naming
herself). This is her reply. **Samples promised in the same message; not yet
handed over.**

It is the first time two people have answered the same four questions, which is
what makes it useful: **three of the four corroborate Christina independently,
and the fourth answers a question Christina left open.** Her words, verbatim:

**Medical certificates — the whole procedure, and it is paper.**

> "When the student is absent, teacher will mark them absent. When they come back
> they will submit the MC to the FCA. Then the FCA will change the absence to Ex.
> By the end of the month, FCA will hand over all the MCs to Mr Hanafi and he
> will file it. usually Excused absence is marked as present in the report book
> and we do not usually mention the reason."

1. **The FCA receives the MC and the FCA flips the mark** — same person, same
   moment. This corroborates Christina ("the FCA uploads it") and adds where the
   upload belongs: **at the point of marking `EX`, not on a separate documents
   screen.** The current design already puts it there.
2. **Second independent ratification that `EX` counts as present with no reason
   shown.** Christina confirmed it 2026-08-12; Chandana confirms it unprompted.
   Note her hedge — "**usually** ... we do **not usually** mention the reason" —
   twice. It is the standing practice, not an absolute. That is still enough to
   leave the live behaviour alone, which is all we needed.
3. ⚠ **New, and nobody had mentioned it: there is already a custodian and a
   monthly handoff.** The FCA hands every MC to **Mr Hanafi** at month end and he
   files them. So the paper process this replaces has a filing endpoint, and the
   "internal record of those absences as well as its supporting documents"
   Christina asked for is **the thing Hanafi's folder is today**. Whoever holds
   that folder needs to see the uploaded MCs — that is not covered by "FCA and
   above" unless Hanafi is in it. **Not a blocker; a question for when it is
   built.**

**Disciplinary records — who files, and what happens next.**

> "Incident reports are filed by the person in charge who is present at the venue
> of incident. Later depending on the severity, it will be handled by FCA, or
> Discipline committee or Student support services"

1. ✅ **This independently confirms finding #2 from the incident-report sample.**
   The form says "Name · Office" with no FCA on it; she says the filer is whoever
   was in charge at the venue. **Two separate sources now say our
   FCA-records-the-incident assumption was wrong.** Filing is not a role, it is a
   circumstance — any staff member may end up filing one, so filing cannot be
   gated the way the MC and award decisions are.
2. **Severity routes the case to one of three handlers: FCA, Discipline
   Committee, or Student Support Services.** This is the first description of what
   happens _after_ filing, and it explains the sample's blank pages 2 and 3 — the
   **Academic / Pastoral Counselling** and **Learning Support Program** referral
   blocks _are_ the handoff she is describing. The form already carries the
   routing; on case 702 nobody was routed.
3. ⚠ **Student Support Services is an eighth named body that exists nowhere in
   the system**, alongside subject monitor, subject head, OIC, Assistant
   Principal, Principal, Discipline Committee and AEB.
4. ⚠ **Still no answer on the outcome.** She describes who _handles_ a case, not
   what sanction is recorded. Christina's 18:20 ask was explicitly "whether the
   student received a warning letter or suspension or any disciplinary action",
   and after a sample and two replies **nothing has yet said where that is
   written down.** Item 4 in _Waiting on the school_ stands.

**Awards — the certificate pipeline, and it is not a record system.**

> "Usually we distribute the certs during term orientation or assemblies. Later it
> will be displayed in the AV during the moving up. Usually Ms Apple initiates the
> details for the AV, gathers from FCA. Certificates are usually prepared by Mr
> Lloyd or Mr Kier."

1. ✅ **The FCA is the origin of the data** — Ms Apple "gathers from FCA". That
   corroborates Mr Ace's 2026-08-12 decision (FCA and up records an award) from
   the other direction: he decided who records, she describes who already holds
   it.
2. **There is no existing digital record to replace.** Unlike #7 (computer-
   generated, numbered to 702) and #10/#11 (running in MS Teams Approvals),
   awards today are a certificate handed out and a slide in a ceremony deck.
   **#8 is the one item in this backlog that starts clean**, which makes it the
   cheapest of the three.
3. **The one real job the SIS would absorb is Ms Apple's.** She chases every FCA
   to assemble the moving-up AV list. A table plus an export replaces that
   gathering; **it does not produce the certificate and does not build the AV** —
   Mr Lloyd or Mr Kier prepare those, as Mr Lloyd already does the house logos.
   ⚠ Nobody asked for certificate generation. **Do not build it.**
4. **Three names appear who are not in the system:** Ms Apple, Mr Kier, and Mr
   Lloyd. If Apple is to stop chasing FCAs she needs to _see_ the list; Christina
   said awards are viewed by "FCAs, academic leaders and the registrar", which
   may or may not include her. Small, and settle it when the sample arrives.

**Grade-change approvals — she answered the question Christina did not.**

> "Any changes in the grades after issuing the report book must be approved by
> AEB. Teachers cannot choose the approvers. AEB stands for Academic and
> Examination Board. We have specific AEB approval form and all the AEB members
> will review the request and only after the full approval, the changes can be
> made."

1. ✅ **"Teachers cannot choose the approvers" — Wynne's 45:30 ask is answered,
   flatly.** Christina neither confirmed nor denied it; Chandana states it. The
   approver pool is fixed by policy, not picked at request time. **Item #10 is
   settled on intent** (the shape of the pool is the part still moving).
2. ⚠ **New hard requirement, and it is the biggest build fact in this reply:
   approval is _unanimous_.** "**all** the AEB members will review the request and
   only after the **full** approval, the changes can be made." Today the system
   has **two approvers and first-to-act decides** — no ordering, no quorum, no
   all-must-sign. Note this also reverses the 2026-08-11 decision that withdrew
   the must-both-agree question as our own inference: it was our inference then,
   and it is now the school's stated rule for the post-publication route.
3. **AEB confirmed as Academic and Examination Board**, consistent with the
   2026-08-12 answer and its five named members.
4. ⚠ **She says nothing about the five-station pre-issuance chain** (subject
   monitor → subject head → OIC → Assistant Principal → Principal). She addresses
   only the post-issuance route. **Silence is not corroboration** — that chain
   still rests on one message from one person, and it contradicts what that same
   person said in the room at 46:04. It is also the expensive half. **Worth
   confirming with her before anything is built on it.**
5. **New artefact to ask for: the "specific AEB approval form".** Same anchor that
   worked for the incident report — they have a controlled form, so follow it
   rather than inventing fields. Small, anchored, and it will show whether
   approval is recorded per member (which unanimity implies) and whether the form
   itself is versioned like `C4.6.1-F02`.

**Read together with the admin training the day before, ordered approval is no
longer a one-off.** `SIS-Admin-Training-Session-1-Action-Items.md` §C carries a
**second** ordered flow — mid-year section moves, Tin / Chandana / Wynne / Gary /
Jill, "Mr. Gary final approver", explicitly **not** AEB. Two different bodies,
two different orders, one missing mechanism. That changes the calculus: a general
ordered-approval capability now has two callers, not one.

### The attendance warning letter · 2026-08-14

Supplied by Mr Ace, alongside the certificate below. **Nobody asked for this
one** — the ask was a warning letter or whatever records a suspension, and this
is the former, from an angle nobody predicted.

`First _Warning letter_Attendance_shortage_template 1.docx`, repo root.
Stamped **`HFSE_2026_DIS_T2`** on each page — school / AY / DIS / term. ⚠ Note
that is a **category** code, not a per-letter sequence number like the incident
report's `Case No. 702`; nothing on this document uniquely identifies it.

**It is a Word template somebody fills in by hand.** The file's own metadata:
authored by "NASC", created 2026-03-09, last edited by **Chandana Dileep**
2026-05-18, printed 2026-07-30. **There is no system behind it**, which is the
single most useful fact on the page — see the link-vs-upload note under #7.

Title: _Student Disciplinary Notice – First Letter of Warning on Attendance_.
Fields: Date · Student Name · Class · Subject (meaning the letter's own type).
Addressed to "Dear Parent/Guardian of ⟨Name⟩". Signed **Chandana Dileep,
Assistant Principal**; "Noted by" **Christina Bacolod-Labrador, Principal**.

**Five findings.**

1. ⚠ **This is a disciplinary notice whose trigger is ATTENDANCE, not
   behaviour.** So **#7 has two independent entry points** — incident-driven
   (case 702, filed by whoever was at the venue) and register-driven (this,
   issued by the Assistant Principal). The record had treated #7 as one thing.
   And because this letter is not the outcome of any incident, **Christina's
   18:20 "warning letter or suspension" is still not answered**: she was asking
   what follows an incident.
2. ⚠ **It states a rule the SIS does not have and must not acquire.** Verbatim:
   _"As the minimum attendance requirement has not been met, the student is
   **not eligible for academic awards**, in accordance with the Student
   Handbook."_ `AwardEligibility` today is `{ enrolled, hasCompleteData }` —
   no attendance term at all, so the Masterfile can hand Gold to a student the
   Handbook says has forfeited it. **Mr Ace ruled on 2026-08-17 that this stays
   a human judgement:** _"handbooks change let them do that themselves thats
   there role and respobsibility."_ `lib/compute/awards.ts` is untouched.
3. ⚠ **The letter's own arithmetic does not close.** _"a total of four (4) days
   of absence… resulting in an attendance rate below 80%"_ — but 4 absences in
   a 20-day month is **exactly** 80%, so "below" only holds for months with
   fewer than 20 school days. The table has exactly four rows baked in, which
   suggests 4 is the trigger and 80% the rationale. **Which one fires is
   undecided, and we did not ask** — Mr Ace ruled out automation outright
   (_"of course no automation you dummy thats too much"_), so the SIS never
   needs to know.
4. ⚠ **None of our three attendance rates is the school's rate.** All three
   count `EX` as attending (the rollup, `sheet-summary.ts`, `getMonthlyBreakdown`),
   and `sheet-summary.ts:196` explicitly forbids aligning them. A student with
   four excused days sits at 100% by the register formula. There is also no
   month-window rollup and no 80% threshold anywhere — the only rate constant
   is `AT_RISK_ATTENDANCE_THRESHOLD_PCT = 90`, whose own comment calls it "a
   DISPLAY HEURISTIC, not an HFSE-defined policy".
5. **It names a ladder with two more documents on it**, neither of which we have
   seen: a **second warning letter**, and a **Notice of Academic Promotion
   Deferment Due to Attendance Shortfall**. It cites **Student Handbook pp.
   16–18** for the policy behind all of them.

**It also carries a tear-off PARENT'S ACKNOWLEDGEMENT RECEIPT** — three
tick-boxes, parent's name, signature, date, headed _"[Please return this slip by
May 27, 2026]"_, two days after the letter. That is what migration 122 records:
a letter is not finished when it is sent. And it settles the delivery question —
**the letter goes home on paper**, so nothing is being sent to a parent as a
link.

### Christina — the certificate sample · 2026-08-14

`Sample Cert.png`, repo root. The second of the two files promised on
2026-08-12, and ⚠ **it is not the certificate #8 describes.**

**PRINCIPAL'S LIST** — _"is proudly awarded to ⟨SURNAME, First M.⟩… for
achieving a **GPA of 97** during **Term 1 & Term 2**, Academic Year 2026."_
Given at the school address, matching the letterhead config exactly. Three
signatories: **Christina Bacolod-Labrador** (Principal | Head of Academics),
**Gary G. Cacananta** (Co-Founder & Operations Director), **Ninalyn
Sulit-Cacananta** (Founder & CEO). Carries the **student's photograph**.

**Four findings.**

1. ⚠ **This is an academic honour computed from grades, not a competition
   placing.** #8's whole shape came from Christina's 19:08 words — certificates
   of participation, competitions, cite them at the moving-up ceremony — and
   from Chandana's house-points sheet (`Class | Award | Name | Game Title |
House Colour | Points`). A Principal's List is a **third thing**, alongside
   those and `lib/compute/awards.ts`'s Gold/Silver/Bronze tiers.
2. ⚠ **"Term 1 & Term 2" has no implementation.** `computeGeneralAverage` is
   full-year only (weights .2/.2/.2/.4) and returns `null` until T4 is in; the
   per-term mean in `academic-summary-views.ts` is deliberately tier-less
   because "a single term isn't an award period". A half-year honour needs a new
   computation and a decision on how two terms combine.
3. ⚠ **"GPA" appears nowhere in the codebase.** The equivalent is General
   Average, and it is 1 dp, not the integer on this certificate.
4. **It strains the standing note that HFSE uses no honour tiers.** That note
   was about the report card and about Honors / High Honors / Highest Honors,
   and a Principal's List is neither — but _"Bronze/Silver/Gold is the full
   extent"_ is now too broad and should not be quoted as settled.

⚠ **Not scope until Christina says so.** This arrived answering "send me a
sample certificate", not as a request, and **Chandana's 2026-08-14 line still
stands**: certificates are prepared by Mr Lloyd or Mr Kier, and _nobody asked
for certificate generation_.

### Christina — how her child's school files an absence · 2026-08-17

Not a reply to anything we sent. Christina showed Mr Ace her own child's school
SIS, and **he took it as the design for #6** — _"this is the best way since
parents are the ones who initially have the doc."_

⚠ **This block was first written up as "Ms Tin", and as a SECOND source
corroborating Christina. Both were wrong.** Mr Ace, 2026-08-18: _"mis tin is
christina bro what are you on tin is her nickname."_ So this is **one person
saying the same thing twice** — unprompted on 2026-08-12 (_"in my sons' schools,
parents file a leave of absence online and attach the medical certificate"_),
then taking the trouble to show the screen. Her sons being at another school is
the same fact from both angles, and it should have been the tell.

**That is not weaker evidence.** She raised it herself and then went and
demonstrated it, which is the most invested a request gets. But it must not be
written up as corroboration, and this file has now made the
one-person-two-names mistake once — **check nicknames against the roster before
counting sources.**

**It also resolves the AEB roster.** The five members were recorded as "Ms
Chandana, Ms Tin, Ms Norma, Mr Gary, Ms Nina" — so the "Ms Tin" there is
Christina, **the board includes the Principal**, and she was describing a body
she sits on. Only three of the five remain people this file has never placed.

**This supersedes the FCA-uploads spec of 2026-08-12** and un-parks her own
version of the same idea, which this file had set aside as "a new feature, not
an answer".

Parent portal → a **Services** area → one option, **Student Absence and Travel
Declaration**:

- **Absence.** Select student(s) — **multi-select, for siblings** → start and
  end date → radio, **with medical / without medical** → if with medical, an
  upload control **or a link field** (Singapore's `mc.gov.sg`, so the proof can
  be a URL rather than a file) → an optional note to the teacher → submit.
- **Travel.** Select student(s) → duration yes/no → if yes, from and to dates →
  country travelling to → optional city → submit.

**What it is for — settled with Mr Ace the same day.** Not a mailbox for MCs.
Today the reason for an absence exists as four disconnected things: a parent's
WhatsApp message, a paper MC in Hanafi's drawer, the teacher's guess between
`A` and `EX`, and the mark itself. This joins them — **the teacher stops
guessing**, because the declaration lands before they mark, and the proof sits
on the day. The payoff is the warning letter above: it lists absence dates and
treats them as unexcused, so whoever writes it must know which of those days
carried an MC, and today that means asking Hanafi. **The register mark stays the
record; the declaration is the evidence**, and `ex_note` (KD #177) keeps its
place for when a parent files nothing.

⚠ **The travel declaration IS the LOA request the school already has.** The
warning letter states the rule in the school's own words: one vacation leave per
term, with a Leave of Absence request filed **at least five working days in
advance**. We already model the quota (`default_vl_allowance_per_term`, KD #76)
and the mark (`ex_reason='vacation'`, migration 070). So this is a form for an
existing policy against existing columns — but **the five-day rule stays theirs
to enforce, not ours to encode.**

⚠ **Scale check before anyone estimates this.** A parent-facing form, an
approval queue and a write into the attendance register is an order of magnitude
past "an FCA upload button", against a portal that can read only two tables
today — `school_config` and `report_card_publications` (KD #165).

#### Her reply on the approvers · 2026-08-19

Asked:

> "regarding po sa feature for submitting medical certificates (MC) and travel
> declaration for student absences, may i confirm po if meron po syang approval
> process? if yes po, sino po yung mga designated approver/s for these requests?"

Answered:

> "Yes po merong approval process.
>
> Ito po ang list:
>
> Form Class Adviser
> Officer in Charge (Primary or Secondary)"

**Two approvers, and the first of them is the FCA.**

1. ✅ **There IS an approval step** — so the parent's declaration is a request,
   not a fact, and nothing becomes excused because a parent said so.
2. ✅ **The FCA is the first approver, and that largely defuses the design
   question.** The worry was a system writing attendance on a parent's say-so;
   but the FCA is also the person who marks the register, so they are in the
   loop either way. What remains is only whether their approval **writes** the
   mark or whether they mark it afterwards — a convenience question, not a
   safety one.
3. ⚠ **The blocking question was NOT answered, because it was not asked.** The
   message asked _whether_ there is an approval process and _who_ approves. It
   did not ask what approval **does** to the register. Still open; ask it
   plainly next time rather than inferring it from the approver list.
4. ⚠ **"Officer in Charge (Primary or Secondary)" exists nowhere in this
   system**, and it is not new — **OIC is the middle station of the
   pre-issuance grade-change chain** she described on 2026-08-12 (subject
   monitor → subject head → **OIC** → Assistant Principal → Principal). So the
   same unmodelled position now gates two unrelated flows, and it is
   **school-half-scoped**, which none of our roles are.
5. ~~⚠ **The ORDER is not stated.**~~ **Answered by Mr Ace, 2026-08-21 —
   sequential.** She gave a list, not the arrow chain she used for grade
   changes, so the order was open. It is **FCA then OIC**, in that order.

**This is the THIRD flow needing ordered approval** — grade changes, mid-year
section moves (admin session §C), and now absence declarations. Three callers is
past the point where each gets its own bespoke logic: see the #10/#11 note on
configurable approval steps in `docs/sprints/development-plan.md`.

#### Ordering — decided by Mr Ace, 2026-08-21

> "approvers are always sequential its like teams approval every approval here
> is sequential i think besides the grade change request before report card
> publishing" · "i mean except"

**Every approval flow is sequential, with exactly one exception: the
pre-publication grade change, which keeps today's behaviour — a pool of
approvers, first to act decides, no order.** Everything else is an ordered list
of steps: the AEB, absence declarations, mid-year section moves.

Three consequences, and the first is the reason this is worth writing down:

1. ✅ **Unanimity stops being a second mechanism.** The #10/#11 note said the
   system needs **both** shapes — "one named person in sequence, or a group
   where everyone signs". If every step is sequential then a five-member board
   where all five must sign is simply **five steps in a row**. One concept —
   an ordered list of steps — not two. This removes the harder half of that
   design before it is built.
2. ⚠ **Correction to an earlier note.** CLAUDE.md recorded the AEB as
   "unanimous, order irrelevant" and attributed it to Chandana. **She never
   said that.** Her words (2026-08-14) are _"all the AEB members will review
   the request and only after the full approval, the changes can be made"_ —
   which states **unanimity and says nothing about order**. "Order irrelevant"
   was our inference laid on top of her sentence. Sequential-and-unanimous is
   fully compatible with what she actually told us.
3. ⚠ **The one real cost is operational, and the artefact settles it.** A queue
   stalls where a pool does not — if the third member is away, the fourth and
   fifth cannot act. Do **not** open a discussion about it: ask for the
   **"specific AEB approval form"** she named. Signature blocks numbered in
   sequence versus a grid of five names answers it outright, without asking
   anyone to describe their own process. Same anchor that worked for the
   incident report.

⚠ **"Except" means Christina's five-station pre-issuance chain is NOT being
built** (subject monitor → subject head → OIC → Assistant Principal →
Principal). That is the cautious call and it is the right one: that chain rests
on a single message whose attribution this file marks unverified, and it
contradicts what the same person said in the room at 46:04 ("two approvers,
Ms. Chandana and I only"). The live pre-publication route stays as it is until
she confirms the chain herself.

---

### Christina — a teachers' dashboard, and SOW reopened · 2026-08-21

Unprompted, alongside the approvers answer:

> "Oh may question pala ako. Will there be a teacher's dashboard for lesson
> planning, scheme of work and teaching and delivery matters? This SIS is really
> helpful for all of us. Yung teachers' dashboard will also contain the relief
> monitoring when teachers are absent
>
> And if they are absent, we can easily check the lesson topics and lesson plan"

⚠ **She is reopening SOW, and this is the third time it has been asked for.**
Before replying, know what happened to the first two:

- **Built twice, removed both times** — migrations 058–066, nine of them. First
  coordinator-authored (KD #108), then rebuilt teacher-owned when field
  investigation found subject teachers actually own it (KD #110), then deleted
  entirely on 2026-05-28.
- **The removal commit says why, in its own words:** _"The in-system SOW had
  zero real users — HFSE teachers maintain their SOW in external documents;
  coordinators check those directly."_

**But her reason is new, and it is the first good one.** Both previous builds
were about **authoring** the SOW and **spot-checking** it. Neither ever had a
**reader**. Hers does: a substitute who did not write the plan, opening a class
they do not normally teach, needing to know today's topic. That is a different
job, and the old SOW would have served it badly.

⚠ **The adoption trap is the same one that produced zero users.** The work falls
on the subject teacher — keep your SOW in the system, keep it current. The
benefit falls on **someone else**, the substitute, and only on the days somebody
is sick. When the person paying the cost is not the person getting the value the
data goes stale — and a stale lesson plan is **worse than none**, because the
relief teaches the wrong thing and trusts it.

**The cheapest thing that delivers what she described** (our proposal, not her
ask): the thing that died was the **authoring surface**. The documents already
exist and teachers already maintain them. So a **link per class/subject/term to
where the SOW lives** gives the substitute what she asked for, with no
authoring, no sync and no third teardown. Same call made for the discipline
document on 2026-08-18 — the ask was the record, not the file. If a link is not
enough we will learn precisely **why**, which we have never known before.

**Before treating any of this as greenfield: much of it already exists.** The
Classroom module (KD #160) is a teacher's per-class workspace — Overview,
Grades, Students, Attendance, Write-ups, Discipline, Timeline, Settings. What it
lacks is exactly **lesson topics and plans**. Show her that first and ask "is
this the dashboard, plus lesson planning?" rather than scoping a new module.

**It also confirms the relief page independently.** She asked for relief
monitoring without being prompted — that is the academic head corroborating the
2026-08-20 plan (`~/.claude/plans/relief-cover-dates.md`). Two riders:

1. **It gives that page a second job.** The plan frames it administratively —
   who is covering, is anything about to lapse. Hers is operational: _"we can
   easily check the lesson topics and lesson plan."_ That is the substitute's
   own question, not an administrator's.
2. ⚠ **Different home, different gate.** The plan puts the page in SIS Admin
   behind `staff.manage_relief`. She puts it on a **teachers'** dashboard. A
   teacher seeing every cover in the school is not the same feature as a teacher
   seeing the classes they are covering. Unresolved.

**✅ BOTH RIDERS SETTLED 2026-08-24 (Mr Ace), and relief cover shipped — KD #191.**

- **Rider 2 was answered by SPLITTING it, which is what "two different features"
  was pointing at all along.** The school-wide board is **SIS Admin only**
  (`/sis/admin/cover`, `staff.manage_relief`) — no teacher sees every cover in
  the school. The teacher's own half is a **"You're covering"** panel on home,
  the Classroom index and the Markbook and Attendance section lists. So her
  "teachers' dashboard will contain the relief monitoring" is answered without a
  teachers' dashboard existing.
- **Rider 1 — the second job — is NOT built, deliberately.** Lesson topics stay
  out and SOW remains removed. ⚠ **But the reason her ask needed relief first is
  now visible in the code:** cover booked for next week used to be invisible to
  the substitute until the morning it started, so there was nothing for a lesson
  plan to attach to. **That panel is the hook.** If SOW is ever revived as a link
  per class/subject/term, it hangs there.
- ⚠ **What this does NOT settle: whether what shipped is what she meant.** She
  asked for relief monitoring inside a teachers' dashboard; what exists is an
  administrator's page plus a teacher's own list. **Show her both before treating
  her ask as closed** — alongside Classroom, per the note above.

⚠ **Scope note.** "Lesson planning, scheme of work and teaching and delivery
matters" is a **module**, not a feature. Nothing here is scoped, costed or
approved. Do not re-derive a SOW model from this message.

### The P-Files document list · 2026-08-25

**This is the reply to the second half of the Wynne message** (sent 2026-08-21),
which asked for "the additional list of documents to track for student P-Files".
⚠ **Attribution is not recorded.** It reached this file relayed by Mr Ace and the
relay does not name the sender; the only outstanding ask for exactly this list
was Wynne's, which is why it is filed against her row in §B of the admin file.
**Do not cite it as her words until that is confirmed.** Wording unaltered; the
only change is a bullet marker per line, because markdown would otherwise run
the two lists together into a paragraph:

> For the P-files , here are the documents needed:
>
> New Students:
> Additional:
>
> - Last School Recommendation and Good Moral
> - Assessment Result and Interview
> - Form-12
> - Signed Student Contract
> - New Student Checksheet
> - Student P-files Checklist
> - Pre-Counselling Acknowledgement Form
> - Conditional Enrolment (if applicable)
> - Late Enrolment Form (if applicable)
>
> For Current Student:
>
> - Latest Copy of the Student Valid Pass and Parent's or Guardian Valid Pass
>   (if previous copy are expired)
> - Latest Copy of the Student Passport and Parent's or Guardian Passports (if
>   previous copy are expired)
> - Latest Copy of Student's Medical Report if there's new medical condition to
>   declare
> - Form 12
> - Signed Student Contract

**It closes two admin-session items at once.** §A #11 ("add recommendation form
from previous school to required docs") is the first line of her new-student
list, so it is not a separate chase — it arrived inside the answer to #5. And #5
itself ("allow adding document types like the student contract") now has its
list; **Signed Student Contract was the literal example in the ask**, and it is
here.

**Cross-checked against `DOCUMENT_SLOTS` on 2026-08-25** — 13 slots today
(`lib/p-files/document-config.ts:48`), each one a column pair or triple
(`{key}`, `{key}Status`, plus `{key}Expiry` for the eight expiring ones) on
`ay{YY}_enrolment_documents`.

**Five of the fourteen lines are already held, and are not new slots:**

- **Form 12** is `form12`. It appears on **both** her lists, so it is one slot
  she expects to see refreshed, not two documents.
- **The whole "For Current Student" pass/passport half** — "latest copy… if
  previous copy are expired" — is the **existing renewal lifecycle** over the
  eight expiring slots (KD #63/#64), which already models expiry, renewal and
  revisions. It is not four new documents; it is her describing behaviour the
  system has.
- **"Latest medical report if there's new medical condition to declare"** maps to
  `medical` plus the revisions model (KD #34). ⚠ One thing to settle rather than
  assume: `medical` is **non-expiring** today, so "latest" means a new revision
  on the same slot. That is a decision, not a reading of her words.
- **Signed Student Contract** repeats across both lists — same slot, filed once
  for a new student and re-signed as a current one.

**Eight are genuinely new**, all on the new-student list: Last School
Recommendation and Good Moral · Assessment Result and Interview · Signed Student
Contract · New Student Checksheet · Student P-Files Checklist · Pre-Counselling
Acknowledgement Form · Conditional Enrolment (if applicable) · Late Enrolment
Form (if applicable).

⚠ **Two things to put in front of Mr Ace before any migration is written.**

1. **The two "(if applicable)" slots do not fit the conditional mechanism we
   have.** `DocumentSlot.conditional` means "required when this column is
   **non-null** in `enrolment_applications`" — that is how the father and
   guardian slots work, keyed on `fatherEmail` / `guardianEmail`. But
   **Conditional Enrolment** is a _value_ test (`applicationStatus` being
   `Enrolled (Conditional)`) and **Late Enrolment Form** keys off the
   late-enrollee flag. So either the field widens to a predicate, or those two
   ship unconditional and the office ignores them where they do not apply.
2. **Eight slots is roughly 16–24 new columns on every AY-prefixed
   `enrolment_documents` table** — the frozen admissions DDL
   (`docs/context/10a-parent-portal-ddl.md`), which the parent portal also
   writes. ⚠ **This is what makes #5 two different features, not one.** "Add
   these eight" is a migration. "Allow adding document types" — a type the
   office defines later, without us — is a rows-not-columns redesign of the same
   table. Her list is answerable by the first; the wording of the ask is the
   second. **Pick deliberately and say what it forecloses.**

**Still owed from the same message: the Transcript of Records template.** That
half has not arrived.

### The secondary relief part-time teachers · 2026-08-25

⚠ **Attribution is not recorded** — relayed by Mr Ace without a named sender.
The teaching-deployment thread is Mr Hanafi's, which is the likely source, but
this file does not guess. Verbatim:

> Good morning Mr. Ace. For the Secondary Relief Part Time Teachers, please see
> below:
>
> - Mr. Chong Jun Hien (Science and Global Perspectives) - jun.chong@hfse.edu.sg
> - Ms. Fong Mei Yin Elaine (English) - elaine.fong@hfse.edu.sg

**Ms Fong is almost certainly the missing English relief teacher** named in the
deployment gaps below — the one for Sec 1 Discipline 2 / Sec 3 Consistency that
was said to be "with Ms Marrie". Subject and school half both match. ⚠ **The
classes are still not stated**, so which sections she covers is unconfirmed; do
not book an assignment off this inference alone.

**Mr Chong is new information** — Science and Global Perspectives was not one of
the known gaps.

**Neither can hold an assignment yet: neither has an account.** No migration can
create one, and teacher provisioning is parked pending training. Once
provisioned, each gets a teacher assignment carrying the KD #191 cover window.
This would be the **first real relief data** — AY2026 holds three assignments
across two test accounts today — so it doubles as the bulk-booking rehearsal
that has been waiting on the deployment file.

### Chandana — the AEB approval form · arrived 2026-08-27, read 2026-08-28

⚠ **The file had been sitting untracked at the repo root for a day before
anybody opened it** — `CO.1.1-F01-V02 AEB Approval Form.docx`. The Status table
and every note still said "awaiting Chandana's reply". **It answers the
2026-08-21 message.**

**What the form contains, in order:**

1. **REQUEST DETAILS** — Requestor · Date · Department · **Nature of request** ·
   a free-text description box.
2. **ACADEMIC AND EXAMINATION BOARD REVIEW** — Date · Decision · Implementation
   date (if applicable) · Remarks. **One decision line for the whole board.**
3. **BOARD RESOLUTION** — free text.
4. **APPROVED BY (AEB MEMBERS)** — five names with signature spaces.
5. **IMPLEMENTATION AND EFFECTIVITY CHECKLIST (to be done by the requestor)** —
   information cascading, update of records/policy, pull out of old document,
   and an **Effectivity Check Report for months 1 through 6**.

**The sample she sent** (student details left in, not removed): Requestor
**Radhika**, 18/08/2026, Department **Academics**, Nature of request
**"Retest"** — _"Olrick and Luke from P6 Grit did not meet the requirements for
PT1 (Composition). Both students were unable to complete the composition and
therefore received 0 marks."_

**What it settles — the anchor question, answered exactly as designed:**

- ✅ **A GRID OF FIVE NAMES, NOT NUMBERED BLOCKS.** The 2026-08-21 message set
  this test explicitly: _"signature blocks numbered down the page mean
  sequential; a grid of five names means parallel."_ It is a grid. **The board
  signs as a body and the order is not part of the form.**
- ✅ **The roster is confirmed** and matches what was resolved on 2026-08-12:
  Cacananta Ninalyn Sulit, Gary Cacananta, Villamor Norma Bardos, Labrador
  Christina Bacolor, Chandana Letha Dileep. **Do not re-ask who the members
  are.**
- ✅ **It is versioned**, like the incident report (`C4.6.1-F02`) — hence
  `CO.1.1-F01-**V02**`.
- ⚠ **Each member's approval is NOT recorded separately.** There is one Date and
  one Decision for the whole review, and five signatures under it. So the form
  captures _that all five agreed_, not _when each one did_.

⚠ **AND IT REFRAMES #11, WHICH IS THE BIGGER FINDING.** #11 is filed as
_"second approval route keyed on publication"_ — i.e. a post-issuance grade
change. **This is not a grade-change form.** "Nature of request" is open-ended
and the one real sample is a **retest**. With a Board Resolution and a six-month
effectivity report, it is a **policy-and-exception instrument for the academic
board**, of which a post-publication grade change would be one kind of request
among many. **Anything scoped from #11's current wording would be scoped too
narrowly.** Do not build on this until the shape is agreed with Mr Ace.

**Still outstanding from that same message: does the AEB membership change?**
The form cannot answer it. Five names are printed into the template rather than
written in by hand, which is weak evidence the roster is stable and versioned
with the document — but it is inference, not her answer, and it matters because
a rotating board means an old approval must keep who was on it **then**
(KD #147).

⚠ **Compatible with Mr Ace's 2026-08-21 sequential ruling, so do not reopen
that.** Five sequential steps of one person each _is_ unanimity; the form simply
says the order is not something the school tracks. What the form removes is any
need to _discover_ an order — there isn't one.

---

## The record

Quoted from the transcript. Ellipses mark cuts; nothing else is altered.

### Attendance — the excused note and the MC

**Christina Labrador, 31:07**

> "Whenever we mark the attendance daily, there will be an instance when the
> student is marked absent for the day, but when the student returns to school,
> he or she will bring a medical certificate. So after that, we will edit the
> attendance for that day, **and also put a comment that there was a medical
> certificate submitted**. My questions, can we still edit the attendance?
> That's the first one. And **are we able to upload also the medical
> certificate?**"

Ace, 32:00 — confirmed editing works, and that upload "currently there is no
feature for that yet, but that is noted, and we will add that."

**Melissa Balantac, 32:44** — restated the comment as the fallback, once she
heard upload was unavailable:

> "The same thing for attendance, so **if we're not able to upload the MC yet,
> can we at least have, or can we put a comment if ever the student is on MC? We
> can put the reason why the student is not present on that day.** Like a
> description — or is that possible?"

**Two asks in one turn, and two people on the first of them.** Christina raised
the comment inside her MC turn; Melissa asked for it standalone 90 seconds later
as the thing worth having if the upload could not be built. The comment shipped
(KD #177). The upload did not, and needs a security pass first.

### Relief teachers

**Marrie Aines Juni, 33:18**

> "But if, for example, **I'm a relief teacher for other section, can we also
> edit** or how are we going to do that?… Let's say Ms Melissa is on leave today
> and I'm doing a relief class for her class. As a relief teacher for her class,
> **can I do the edit of her attendance?**"

Ace, 34:10 — the only way today is to use Melissa's own account; the system has
no relief concept.

**Christina, 34:46** — answered it as policy in the room: "I think it would be
challenging also to be sharing the access to your co-teacher… **maybe the admin
can enter the attendance for the day on behalf of the teacher who was absent
rather than share your login details.** Or perhaps a designated person like the
OIT can be an admin or the academic assistant can be the admin also."

That answer already works — admins can write any section's register. What does
not exist is any record that it was done _on behalf of_ someone, and an adviser
cannot read the attendance audit log to notice either way.

### The student profile — three people, five asks, one feature

**Christina, 16:08**

> "There are certain special instructions that we have, which we also want to
> share with all the teachers who are teaching that particular student. For
> example, if we have reports or… special instructions on allergies. So **we
> need a common place to view that**, such that when we click the student, the
> student's name, we will know that this student is allergic to this. Or this
> student has the special need declaration. So diagnosed with ADHD, for
> instance… so that **we don't have to look for several folders**."

**Melissa Balantac, 21:53**

> "For us teachers, it's very important for us to know if a kid or if the
> student has the learning difficulties, for example, or allergies, per se…
> **is it possible for you guys to give us an access to it?**"

**Chandana, 22:36**

> "Is it possible to have the **parents' contact details** also added to the
> student in case we need to contact? Usually, we approach the form class
> advisor."

Ace, 17:17 — "Currently, the system only allows the viewing of medical condition
in the records module and **teachers are not allowed yet to view that module**."

**Christina, 18:20**

> "What about **records of disciplinary actions**? Because we file incident
> reports, and then if we click the name of the student, I was hoping we can
> also find those incidents that the student was involved in for the whole year.
> Whether the student received a warning letter or suspension or any
> disciplinary action."

**Christina, 19:08**

> "**Special awards.** We also want a common [folder] whereby we will see that
> the students participated or received the following awards or received the
> following **certificates of participation** to competition so that by the end
> of the year, it's also easier for us to retrieve those information and **we
> can cite them during the moving up ceremony**… We can either list it down or
> **we upload the certificate** also for our soft copy."

### House

**Chandana, 23:35 and 23:51**

> "We need to add the **house colours** also for the students… so that all the
> awards, everything, they will also receive the **house points**. So individual
> house points, and also they will be able to get the **overall house points
> towards the end of the year**. So it is good to have their house colours
> associated with it."

Note the linkage: Chandana ties house points to awards herself. Building points
before the awards table exists risks building it twice.

**Resolved 2026-08-06, and not the way it read.** "The awards" here means
**competition** awards, not the system's academic Gold/Silver/Bronze — Hanafi's
points sheet uses the same three words for placings, and Chandana confirmed
separately that house points do not touch the academic tiers. The linkage she
drew is real, and it points at Christina's #8 rather than at `awards.ts`. The
caution stands, better founded than before: see _Answers received_.

### At-risk students

**Koh Suat Hoon, 55:10**

> "Can this system actually help to **flag out students** who are scoring at
> risk students, meaning that in term one, they score quite high for
> mathematics. Let's say they scored 90. Then term two, then the overall grades
> drop. Then were this system able to help us to say that, okay, this student is
> at risk in term two, and then **the subject teacher or the FCA got to contact
> the parents**."

**Ace, 56:00** — restating and widening Koh's ask, immediately after a garbled
Hermilita turn at 55:59 that Fathom could not transcribe:

> "…**not only for the quizzes, but also for exam, for overall**, things like
> that. Currently, the system is only able to compare the term grades per term,
> not yet for the quiz or the scores… here are the alerts. So I think I can just
> add that here alongside with the term grades comparison."

**Attribution note.** This widening has been credited to Hermilita elsewhere. The
transcript labels it Ace; Hermilita's own audible contribution is at 59:13
(below). The scope it describes is what shipped either way.

**Three things in Koh's ask**, all of which my first summary dropped: it is a
**list** ("flag out students", plural), it names **the FCA** as well as the
subject teacher, and the output is **a phone call to the parents**.

### Whole-year view

**Christina, 57:22 and 57:59**

> "Where do we find that comparison?… **If we are already complete with three
> terms, will the system be able to show us the entire performance from term one
> to term three?**"

The grid already existed on the Records student page; what was missing was
direction, and a report-card caption that said the opposite of what the card
did.

### Approvers

**Wynne Lynn Faustino, 45:30 and 45:46**

> "Currently you showed that there's only two approver… **in terms of approver,
> there's quite a few people**. So I just want to check, is it limiting to two
> people only in the system, or you can add more in case?… Because usually you
> still have the **AEB**, right?"

(Fathom labels the 45:22 lead-in as Ace; the question is Wynne's and continues
through 45:46, where the AEB mention sits.)

**Christina, 46:04**

> "There are **two different scenarios**. One is the change of grade only once
> everything has been finalized but **without generating it yet to the report
> book** or issuing it to the parent. So that one is easy because it would
> require two approvers, Ms. Chandana and I only. But **if the amendment request
> comes after the report book was issued already, then that requires AEB
> approval**."

### Configuration ownership

**Chandana, 53:09**

> "Also, different subjects, is it possible to use different values for the
> grades or is it necessary that it is standardized…? **Can we still change the
> total marks for different subjects in different terms?**"

**Chandana, 54:52** — asked who changes it: "**The school admin or the academic
coordinator**, Ms. Joann." Ace: "Not the subject teacher." Chandana: "Yes,
ma'am."

**Melissa, 50:24** asked whether MS Teams Approvals is still needed alongside
the system. **Christina, 50:57**: "The same approvers who are giving the
approval via the MS approvals will be the same approvers who will be put in this
system. So you don't need to. **That will be superseded by this already.**"

### Activity labels

**Hermilita Mendoza, 59:13**

> "Currently in our grading sheet, we do like a description for each component.
> Like, for example, **for written work one, if that is a spelling test, when it
> was administered, and where is the scope** of that given assessment. Are we
> still can do that in the grading sheet?"

Ace, 59:30 — yes; the Activity Labels dialog already carries details, page
number and date administered (KD #105). Nothing to build. Her "scope" maps to
the page-number field.

### Transcript of Records

**Wynne Lynn Faustino, 1:00:57**

> "I see here that we can actually generate the report cards, right? But because
> for admin side, we do… **generate transcript of records — it means all the
> records of the students from the time that they join us.** So is there a way
> for us to also generate that from the system?"

Ace, 1:01:14 — no feature today. The template was offered in the same exchange:
"**Maybe we can give you the template** and from there you can incorporate."

---

## Corrections to earlier notes

Kept rather than quietly fixed, because all three are the same failure — working
from a summary instead of the source.

1. **The excused-absence comment was Christina's ask (31:07), not Melissa's.**
   It was attributed to Melissa in KD #177, in two source comments, in a test
   header and in the dev plan. Melissa's contribution at 21:53 was a different
   ask — teacher access to medical alerts and learning difficulties, which is
   item #5. Corrected 2026-08-04. **Then over-corrected — see 3.**
2. **Koh's ask was a list, not a column.** The first build put an Alerts column
   on the grading sheet, matching what Ace offered in the room at 56:00 but not
   what Koh asked for at 55:10. Re-reading the transcript replaced it with a
   ranked lookup — and surfaced that the FCA half is still entirely unbuilt. See
   KD #179's amendment.
3. **Correction 1 was itself wrong: Melissa did ask for the excused-absence
   comment, at 32:44.** Correction 1 checked only her 21:53 turn, found a
   different ask there, and concluded the attribution to her was baseless. It
   was not — she asked for the comment explicitly 90 seconds after Christina,
   as the fallback once she heard the MC upload did not exist. **Both asked**;
   the original attribution was incomplete rather than wrong. Her 32:44 turn was
   missing from _The record_ entirely, which is how a correction written from
   this file could reach the opposite conclusion. Corrected 2026-08-05, on a
   full re-read of the transcript against every row of this file.

   **Migration 109's own header had it right the whole time** — both askers,
   with Melissa's line quoted — because it was written while the transcript was
   open. Correction 1 swept KD #177, two source comments, a test header and the
   dev plan, and never checked the one place that disagreed with it. A site
   that contradicts a correction is the first thing to read, not the one to
   miss.

   Same pass, smaller fixes: Marrie Aines Juni was missing from the attendee
   list and was the person who raised relief teachers; the Transcript of Records
   carried a caveat saying it appeared only in Fathom's auto-summary when Wynne
   asked for it directly at 1:00:57 and offered the template herself; "five
   people asked five versions" was three people asking five things; Wynne's
   approver timestamp was 45:30/45:46 rather than 45:22; Koh's exam-total
   question was 47:20 with the wrong answer at 48:00 rather than 47:55; and the
   56:00 widening credited to Hermilita is labelled Ace in the transcript, with
   her real contribution at 59:13.

**The pattern across all three.** Every one came from working off a summary
instead of the transcript — including correction 1, which was written to fix
exactly that. A correction is a claim about the source and has to be checked
against the source, not against the file it is correcting.
