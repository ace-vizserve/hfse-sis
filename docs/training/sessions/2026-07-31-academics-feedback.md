# 2026-07-31 · SIS training with the academics team — what was asked

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

| #   | Ask                                                   | Who                                                  | Status                             | Where                              |
| --- | ----------------------------------------------------- | ---------------------------------------------------- | ---------------------------------- | ---------------------------------- |
| 1   | Comment on an excused absence                         | Christina (31:07), Melissa (32:44)                   | **Shipped** 2026-08-03             | KD #177, migration 109             |
| 2   | House colour                                          | Chandana (23:35)                                     | **Done** — named + list loading    | KD #178, migrations 110 / 111      |
| 3   | Whole-year T1→T3 view for one student                 | Christina (57:59)                                    | **Shipped** 2026-08-03             | Records → Academic tab             |
| 4   | Flag at-risk students on scores, not just term grades | Koh (55:10)                                          | **Shipped** 2026-08-09             | KD #179 (subject) + #182 (adviser) |
| 5   | Teacher-visible student profile                       | Christina (16:08), Melissa (21:53), Chandana (22:36) | **Shipped** 2026-08-09             | KD #181 — Classroom drawer         |
| 6   | Upload the medical certificate                        | Christina (31:07)                                    | Open — security pass first         | Bucket appears public-by-URL       |
| 7   | Disciplinary records / incident reports               | Christina (18:20)                                    | Open                               | New table + surface                |
| 8   | Awards beyond Gold/Silver/Bronze                      | Christina (19:08)                                    | Open                               | Needs its own table                |
| 9   | House points                                          | Chandana (23:51)                                     | Open — rules known, needs #8 first | Overlaps #8, now confirmed         |
| 10  | More than two grade-change approvers                  | Wynne (45:30)                                        | Count answered — folds into #11    | Christina said two, 46:04          |
| 11  | Second approval route keyed on publication            | Christina (46:04)                                    | Open — most feasible               | `APPROVER_FLOWS` was built for it  |
| —   | WW/PT max scores have no home in SIS Admin            | (found in triage)                                    | **Closed** — working as intended   | KD #176                            |
| —   | Relief teacher marking another section's register     | Marrie (33:18)                                       | Policy — the school owns it        | See _Waiting on the school_        |

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

- **T3 — MC upload** (#6) needs a security design pass **before any build**. The
  storage bucket appears public-by-URL (`getPublicUrl` everywhere, no signed
  URLs in the codebase) and its policies are not in this repo. Granting teachers
  the existing document capability would hand them replace-rights over every
  enrolled student's passport and birth certificate.
- **T4 — run the students sync against a student who already has a house** and
  confirm it survives. A test guards it, but that test reads source code; only
  the sync running proves it.
- **T5 — disciplinary records** (#7) and **awards** (#8), each needing its own
  table. Do **not** extend `lib/compute/awards.ts`: "award" there means a tier
  derived from a numeric average, with no entity, id, date or issuer.
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

- **Chandana** — **house is fully answered as of 2026-08-06**; see _Answers
  received_. Nothing outstanding on it. Still hers: whether a mid-year SOW change
  reaches in-flight terms or only future ones.

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

- **Mr Hanafi** — **closed 2026-08-11, nothing outstanding.** He answered on
  2026-08-06 and sent both sheets. The follow-up about unmatched names was
  **dropped rather than sent** (Mr Ace's call): ~12 of 410 students go without a
  house and the eleven hand-matched names go in unconfirmed, which is the
  accepted cost. Do not reopen this as an open question — it was decided, not
  forgotten.
- **Christina** — **the AEB rule (#11), and only that.** Revised 2026-08-11: the
  approver count (#10) was recorded here as hers to define, but she had already
  defined it on the recording — 46:04, "two approvers, Ms. Chandana and I only."
  That covers the pre-issue route completely. What is unknown is the second
  route: who AEB is, whether it is one person or several, and therefore how many
  approvers the system needs to allow at all. Wynne's "can we add more" (45:30)
  reduces to the same question.

  Also hers: the relief-teacher policy, **raised by Marrie at 33:18** and
  answered in the room by Christina (designate an admin rather than share a
  login): admins can already write any section's attendance, but the audit log
  has no on-behalf-of concept and advisers cannot read it.

- **Wynne** — the Transcript of Records template. The data layer is complete and
  cross-AY on `studentNumber`; the template is the whole blocker. She asked for
  it directly at 1:00:57 and **offered the template herself** in the same
  exchange, so this is a reminder, not a cold request.

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

### To Wynne

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
