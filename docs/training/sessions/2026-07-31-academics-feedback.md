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

**Questions before code.** _Questions to send_ below holds the plain-English
questions each item still needs answered, written so the person who asked can
answer them without a developer present. Ask them in the room, not in a design
doc.

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

## Questions to send

Ready to copy, one block per person. Send separately — each person only needs
their own, and short lists get answered.

**Keep them small.** These exist to pin down what was already asked for, not to
design it. A first draft asked Chandana whether house points could be taken
away and whether there should be a leaderboard; she never mentioned either, and
questions like that invite a bigger feature than the one requested. If a
question is not needed to finish the thing they described, it does not go in.

Anything genuinely undecided on our side stays in **Todos** above, where it
belongs, until it turns into something they can actually answer.

Two entries are corrections rather than questions, marked **⚠**. Both were
answered wrongly in the session and someone is working from bad information now.

### To Chandana

> Hi Ms Chandana,
>
> The house field is in the system now — every student can be assigned a house,
> and it stays with them from P1 to S4. To finish it I need:
>
> 1. What are the four houses called, and what colour is each?
> 2. Who decides which house a student goes into? And is there an existing list
>    I can load, or should I set them up one by one?
>
> On house points, which you mentioned alongside the awards:
>
> 3. Could you describe how house points work at HFSE — what earns a point, and
>    who records them?
> 4. Are they connected to the awards? You mentioned the two together, so I want
>    to check whether an award should also give the student's house points.
>
> Thank you.

### To Christina

> Hi Ms Christina,
>
> Four things you raised at the training. Short questions on each so I build
> what you actually need.
>
> **Student details for teachers** — you mentioned allergies and special-needs
> declarations, so teachers do not have to hunt through folders. Ms Melissa
> asked for the same.
>
> 1. Besides allergies and special needs, what else should be on that screen?
> 2. Should every teacher see it, or only the teachers who teach that student?
>
> **Medical certificates**
>
> 3. When a student brings one in, who would upload it — the teacher who marked
>    the absence, or the office?
> 4. Who needs to be able to open it afterwards?
>
> **Disciplinary records**
>
> 5. Where are incident reports written and kept today? I want to know whether
>    the system should replace that, or just show what is already on file.
> 6. Who should be able to see a student's record — every teacher who teaches
>    them, the form class adviser, or only leadership?
>
> **Awards and certificates**
>
> 7. What would you want listed for each one? I am assuming the award name, the
>    date and who gave it, with the certificate file attached — tell me if
>    anything is missing.
> 8. Who would enter it — the teacher who ran the activity, or the office?
>
> **Grade-change approvals**
>
> 9. How many approvers do you need, and who are they?
> 10. ⚠ Worth flagging: at the moment whoever responds first decides the
>     request, and the second person's response is not used — so it is not
>     really two signatures, it is whichever of you gets there first. If you
>     need both to agree before a change goes through, say so and I will change
>     it.
> 11. For a change after the report book has gone out, you mentioned AEB
>     approval — who should that be in the system?
>
> Thank you.

### To Koh

> Hi Ms Koh,
>
> The at-risk flagging you asked for is on the grading sheet now — a **Look up
> student** button lists who needs a look, with what dropped and by how much.
> Two questions:
>
> 1. You mentioned the subject teacher **or the FCA** — should the form class
>    adviser see this as well? At the moment only the subject teacher can, and I
>    would like to get that right.
> 2. How big a drop should raise a flag? It is set to five points at the moment.
>
> ⚠ Also a correction to something you were told in the session. You asked
> whether an exam's total marks could be changed through a change request — the
> answer given was yes, but that is not right. Total marks are part of the
> subject settings and are changed by the academic coordinator (Ms Joann).
> Change requests are for a student's scores only. Sorry for the confusion.
>
> Thank you.

### To Wynne

> Hi Ms Wynne,
>
> Two things from the training:
>
> 1. **Transcript of Records** — the data is all there and goes back across
>    school years; what I need is the school's template so the layout matches
>    what you issue today. Could you send a copy, or a recent one with the
>    student's details removed?
> 2. **Approvers** — you mentioned there are quite a few people who approve
>    grade changes. How many should the system allow? Ms Christina is deciding
>    who they are, so this is just the number.
>
> Thank you.

### Not asked, and why

**Melissa** — her question was teacher access to medical alerts and learning
difficulties, which is the same feature as Christina's first block. Folded in
rather than asked twice, since two answers to one question is worse than none.

**Hermilita** — her addition ("not only the quizzes, but also the exam and
overall") is built. Nothing to ask.

**Joel** — no open items.

**Deliberately not asked of anyone:** how long a medical certificate is kept,
whether disciplinary records reach parents, whether house points reset each
year, whether a relief teacher's marking should be attributed. All are real
questions and none was raised by anyone in the room. They belong to whoever
designs those features, and asking now would turn a request into a
specification exercise.

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
