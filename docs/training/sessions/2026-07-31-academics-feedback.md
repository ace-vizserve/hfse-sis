# 2026-07-31 · SIS training with the academics team — what was asked

**Session 1 of the faculty training** (~1 hour, ran long). Present: Christina
Labrador, Chandana Dileep, Koh Suat Hoon, Melissa Balantac, Wynne Lynn Faustino,
Hermilita Mendoza, Joel Castro. Demo driven by Ace Guevarra.

**Source:** Fathom recording — transcript with speaker attribution and
timestamps, plus an auto-generated summary. The transcript is not stored in this
repo; the quotes below were taken from it verbatim and are the authoritative
record of what was asked.

**Why this file exists.** These items were first tracked only as a section of
`docs/sprints/development-plan.md`, summarised in my own words. Twice that
summary lost something load-bearing — see _Corrections_ at the bottom. What
someone said in a room does not change; status changes weekly. They are split
accordingly: **this file holds the words, the todos and the open questions; the
dev plan holds the sprint status.**

**Questions before code.** Every item below carries a _Questions to settle_
block — the plain-English W/H set that has to have answers before the feature
is finished. House is the cautionary example: it shipped, works, and is on
production, and nobody can yet say what a house is FOR or whether it may touch
a grade. Ask these in the room, not in a design doc.

---

## Status

| #   | Ask                                                   | Who                                                  | Status                           | Where                             |
| --- | ----------------------------------------------------- | ---------------------------------------------------- | -------------------------------- | --------------------------------- |
| 1   | Comment on an excused absence                         | Christina (31:07)                                    | **Shipped** 2026-08-03           | KD #177, migration 109            |
| 2   | House colour                                          | Chandana (23:35)                                     | **Shipped** 2026-08-03           | KD #178, migration 110            |
| 3   | Whole-year T1→T3 view for one student                 | Christina (57:59)                                    | **Shipped** 2026-08-03           | Records → Academic tab            |
| 4   | Flag at-risk students on scores, not just term grades | Koh (55:10)                                          | **Half shipped**                 | KD #179 — see todo T1             |
| 5   | Teacher-visible student profile                       | Christina (16:08), Melissa (21:53), Chandana (22:36) | Open                             | Design question unresolved        |
| 6   | Upload the medical certificate                        | Christina (31:07)                                    | Open — security pass first       | Bucket appears public-by-URL      |
| 7   | Disciplinary records / incident reports               | Christina (18:20)                                    | Open                             | New table + surface               |
| 8   | Awards beyond Gold/Silver/Bronze                      | Christina (19:08)                                    | Open                             | Needs its own table               |
| 9   | House points                                          | Chandana (23:51)                                     | Open — rules undefined           | Overlaps #8                       |
| 10  | More than two grade-change approvers                  | Wynne (45:22)                                        | Open — structurally hard         | Christina owns the number         |
| 11  | Second approval route keyed on publication            | Christina (46:04)                                    | Open — most feasible             | `APPROVER_FLOWS` was built for it |
| —   | WW/PT max scores have no home in SIS Admin            | (found in triage)                                    | **Closed** — working as intended | KD #176                           |

Three pre-existing defects surfaced during triage and were fixed first:
**KD #174** (in-page link reachability), **KD #175** (a missed `SECURITY DEFINER`
revoke), **KD #176** (subject config is a ceiling, not a broadcast).

---

## Todos

### Ours

- **T1 — the FCA half of Koh's ask.** The subject-teacher half shipped as the
  grade lookup. Koh said "the subject teacher **or the FCA**", and a form class
  adviser has no grading sheet, so nothing built so far reaches them. They need
  it per student **across subjects** — Classroom is the obvious candidate, next
  to the FCA attendance dashboard (KD #171). The endpoint she named was
  contacting the parents, so whatever ships must carry enough to make that call.
- **T2 — the student profile** (#5). Five people asked five versions of "when I
  click the name I want to see X". Three of those five things already exist in
  Records; teachers simply cannot reach that module. Unresolved: is Classroom
  the teacher's home for everything, or a section×term workspace with the
  profile as a page reached _from_ it?
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

### Waiting on the school

- **Chandana** — the four house names and their real colours; whether a student
  ever changes house; whether siblings go in the same house. Four rows are
  seeded as placeholders. Then ~400 students need assigning. Also: the house
  points rules (what earns a point, who records it, does it reset each year, is
  there a running leaderboard), and whether a mid-year SOW change reaches
  in-flight terms or only future ones.
- **Christina** — the approver count (#10) and the AEB rule (#11). Also the
  relief-teacher policy: admins can already write any section's attendance, but
  the audit log has no on-behalf-of concept and advisers cannot read it.
- **Wynne** — the Transcript of Records template. The data layer is complete and
  cross-AY on `studentNumber`; the template is the whole blocker. (Note: the TOR
  appears in Fathom's auto-generated next-steps list but not in any quoted turn,
  so its attribution is weaker than everything else on this page.)

### To correct with the team

- **Koh was told (47:55) she could change an exam paper's total via a change
  request.** She cannot. That is coordinator-only subject config, blocked at the
  schema, at a DB `CHECK`, and at the apply RPC.
- **The two approvers are NOT a dual signature.** The first to act sets the
  status and nothing ever reads `secondary_decision`. Christina's 46:04 answer
  assumes both must agree; the system does not work that way today.
- **Chandana's 53:09 question is an unqualified yes**, and always has been —
  production already runs eleven different Maths exam totals across sections.

---

## Questions to settle

Written to be answerable by the person who asked, in a meeting, without a
developer present. **An item is not ready to build until its questions have
answers** — house shipped without them, which is why its four rows are still
called "House 1" and why nobody can yet say what a house is FOR.

Everything here follows the same six: **what is it for · who does it · when ·
what can change it · who can see it · what must it never do.** The last one is
the cheapest question in the list and the one most often skipped.

### 1 · Excused note — SHIPPED, questions still open

- **Who is allowed to read a note?** Today: any teacher who can see the mark,
  plus registrar-and-above. Should a note saying "mother in hospital" really be
  visible to every subject teacher, or only the form adviser?
- **Do parents ever see it?** Today, no. Confirm that is intended.
- **Does it belong on the printed register?** Deliberately left off the xlsx
  export — the layout cannot take a column without shifting every date (KD
  #151). If the school wants it on paper, it needs a different shape.
- **What must it never do:** it is not a medical record and cannot be edited
  away — every version is kept. Is the school comfortable with that?

### 2 · House — SHIPPED on placeholders, questions still open

The feature exists; what it MEANS does not. These are Chandana's to answer.

- **What is a house for at HFSE?** Competition and points? Pastoral grouping?
  Seating and assembly? Sports days only? The answer decides whether this stays
  one field or grows a whole subsystem.
- **Why does it belong in the SIS?** Where is it recorded today, and what
  breaks if it stays there? (Asked plainly: what does putting it here let
  someone do that they cannot do now?)
- **Does a house affect a grade in any way — ever?** The build assumes **no**,
  and nothing in the grading formula reads it. Chandana linked houses to awards
  in the same breath at 23:51, so this needs saying out loud: an award tier
  derived from an average must not become "house 2 gets a bonus". Confirm.
- **Who assigns a student's house, and when?** At enrolment? By the registrar,
  the form adviser, or the office? Today the route is open to
  enrolment-placement writers, which is a guess.
- **Can a student change house?** The build assumes never — that continuity is
  the whole point, and it is why the field lives on the cross-AY record. If
  they CAN change, what happens to points already earned?
- **Do siblings go in the same house?** Common practice, and it changes how the
  first ~400 are assigned.
- **Who can see it?** Teachers, parents, the students themselves? Should it
  appear on the report card? (Today: staff surfaces only, deliberately.)
- **What happens to a withdrawn or transferred student?** And to one who
  leaves and returns in a later year?
- **What must it never do:** it must not be reset by the August rollover, and
  it must not become a way to group students for anything academic.

### 3 · Whole-year view — SHIPPED, one question open

- **Who else needs it?** It is on the Records student page, which subject
  teachers cannot open. Christina is school admin and can. Should a subject
  teacher see one student's whole year, or only their own subject?

### 4 · At-risk — HALF SHIPPED

- **What actually counts as "at risk"?** Five points is our guess, not a school
  rule. Is a drop from 95 to 89 the same concern as 65 to 59?
- **Who is supposed to act — the subject teacher, the form adviser, or both?**
  Koh named both. Today only the subject teacher can see it.
- **What happens after the call?** Koh's endpoint was contacting the parents.
  Should the system record that the call was made, or is that outside it?
- **How often should someone look?** Once a term, weekly, or only when
  entering marks? This decides whether it needs to notify or merely display.
- **What must it never do:** it must not reach parents, and it must not be
  read as a prediction about a child.

### 5 · Student profile — NOT STARTED

- **What exactly should a teacher see?** Allergies and special-needs
  declarations were named. What about passport numbers, parent NRICs, fee
  status, admission notes? The underlying table has ~150 columns and the app
  layer is the only thing protecting them.
- **Which teachers?** Any teacher, or only those currently teaching that
  student? A form adviser only for their own class?
- **Who decides what is shareable** — Christina, the registrar, or a policy
  that already exists on paper?
- **Where does a teacher expect to find it?** Clicking a name in their class
  list, or a search? Christina's words were "a common place to view that".
- **What must it never do:** it must not become a second place where medical
  information is edited, and it must not show a student's file to a teacher who
  does not teach them.

### 6 · MC upload — NOT STARTED, security first

- **Who may upload, replace, and delete?** Teachers, the office, or both?
- **Who may look at an uploaded certificate afterwards?**
- **How long is it kept, and who deletes it?** Is this a medical record with a
  retention rule the school already follows?
- **Is the paper certificate still filed as well?** If yes, this is a
  convenience copy; if no, it becomes the record of truth and needs to be
  treated like one.
- **What must it never do:** it must not put a child's medical document
  somewhere reachable by guessing a web address, and granting teachers upload
  rights must not hand them the ability to overwrite passports and birth
  certificates.

### 7 · Disciplinary records — NOT STARTED

- **Is the SIS the system of record, or a window onto the existing process?**
  Incident reports are filed somewhere today. Does that stop, or continue?
- **Who writes an entry, and who may edit or remove one?**
- **Who reads it?** Every teacher who teaches the student, only the form
  adviser, only leadership?
- **Does it follow the student across years, or reset?**
- **Do parents ever see it? Does it appear on any report?**
- **What must it never do:** it must not be deletable without a trace, and it
  must not affect a grade.

### 8 · Awards beyond the tiers — NOT STARTED

- **What is recorded for one award?** Name, date, issuer, level (school /
  national), the certificate file?
- **Who records it — the teacher who ran the activity, or the office?**
- **Is the soft copy required or optional?**
- **What is the output?** Christina named the moving-up ceremony — is the goal
  a printable per-student list at year end, a per-award list, or both?
- **What must it never do:** it must not be confused with the Gold/Silver/Bronze
  tiers, which are computed from averages and have no issuer or date.

### 9 · House points — NOT STARTED, blocked on #2 and #8

- **What earns a point?** Only awards, or also behaviour, attendance, sport?
- **How many, and who decides the scale?**
- **Who records them, and can they be taken away?**
- **Do they reset each year?** Chandana mentioned an "overall house points
  towards the end of the year", which sounds like a yearly total.
- **Is there a live leaderboard, and who sees it — staff, students, parents?**
- **What must it never do:** it must not sit on the report card, and it must
  not be derived automatically from grades.

### 10 · More than two approvers — NOT STARTED

- **How many, and who are they by name or by role?**
- **Must every approver agree, or is one enough?** This is the important one.
  Today the FIRST to act decides and the second is never read — so if the
  school believes two signatures are required, the system does not currently
  do that.
- **Does the number differ by what is being changed?**
- **What must it never do:** it must not let a change apply with fewer
  approvals than policy requires, silently.

### 11 · Approval route keyed on publication — NOT STARTED

- **Who is the AEB in the system?** A named person, a role, a group?
- **Does "issued" mean the report book was published once, or that it is
  currently visible to parents?** We want the former — a card seen by a parent
  and then unpublished has still been seen.
- **Does the AEB replace the two approvers after issue, or add to them?**
- **What must it never do:** a post-issue change must not be applicable on the
  pre-issue route by anyone, including by accident of timing.

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

**Two asks in one turn.** The comment shipped (KD #177). The upload did not, and
needs a security pass first.

### The student profile — five people, one feature

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

### At-risk students

**Koh Suat Hoon, 55:10**

> "Can this system actually help to **flag out students** who are scoring at
> risk students, meaning that in term one, they score quite high for
> mathematics. Let's say they scored 90. Then term two, then the overall grades
> drop. Then were this system able to help us to say that, okay, this student is
> at risk in term two, and then **the subject teacher or the FCA got to contact
> the parents**."

**Hermilita Mendoza / Ace, 56:00**

> "…**not only for the quizzes, but also for exam, for overall**, things like
> that. Currently, the system is only able to compare the term grades per term,
> not yet for the quiz or the scores… here are the alerts. So I think I can just
> add that here alongside with the term grades comparison."

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

**Wynne Lynn Faustino, 45:22**

> "Currently you showed that there's only two approver… **in terms of approver,
> there's quite a few people**. So I just want to check, is it limiting to two
> people only in the system, or you can add more in case?… Because usually you
> still have the **AEB**, right?"

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

---

## Corrections to earlier notes

Kept rather than quietly fixed, because both are the same failure — working from
my summary instead of the source.

1. **The excused-absence comment was Christina's ask (31:07), not Melissa's.**
   It was attributed to Melissa in KD #177, in two source comments, in a test
   header and in the dev plan. Melissa's contribution at 21:53 was a different
   ask — teacher access to medical alerts and learning difficulties, which is
   item #5. Corrected 2026-08-04.
2. **Koh's ask was a list, not a column.** The first build put an Alerts column
   on the grading sheet, matching what Ace offered in the room at 56:00 but not
   what Koh asked for at 55:10. Re-reading the transcript replaced it with a
   ranked lookup — and surfaced that the FCA half is still entirely unbuilt. See
   KD #179's amendment.
