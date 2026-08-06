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

| #   | Ask                                                   | Who                                                  | Status                             | Where                             |
| --- | ----------------------------------------------------- | ---------------------------------------------------- | ---------------------------------- | --------------------------------- |
| 1   | Comment on an excused absence                         | Christina (31:07), Melissa (32:44)                   | **Shipped** 2026-08-03             | KD #177, migration 109            |
| 2   | House colour                                          | Chandana (23:35)                                     | **Shipped** — reach settled, T6–T8 | KD #178, migration 110            |
| 3   | Whole-year T1→T3 view for one student                 | Christina (57:59)                                    | **Shipped** 2026-08-03             | Records → Academic tab            |
| 4   | Flag at-risk students on scores, not just term grades | Koh (55:10)                                          | **Half shipped**                   | KD #179 — see todo T1             |
| 5   | Teacher-visible student profile                       | Christina (16:08), Melissa (21:53), Chandana (22:36) | Open                               | Design question unresolved        |
| 6   | Upload the medical certificate                        | Christina (31:07)                                    | Open — security pass first         | Bucket appears public-by-URL      |
| 7   | Disciplinary records / incident reports               | Christina (18:20)                                    | Open                               | New table + surface               |
| 8   | Awards beyond Gold/Silver/Bronze                      | Christina (19:08)                                    | Open                               | Needs its own table               |
| 9   | House points                                          | Chandana (23:51)                                     | Open — rules known, needs #8 first | Overlaps #8, now confirmed        |
| 10  | More than two grade-change approvers                  | Wynne (45:30)                                        | Open — structurally hard           | Christina owns the number         |
| 11  | Second approval route keyed on publication            | Christina (46:04)                                    | Open — most feasible               | `APPROVER_FLOWS` was built for it |
| —   | WW/PT max scores have no home in SIS Admin            | (found in triage)                                    | **Closed** — working as intended   | KD #176                           |
| —   | Relief teacher marking another section's register     | Marrie (33:18)                                       | Policy — the school owns it        | See _Waiting on the school_       |

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
- **T2 — the student profile** (#5). Three people asked five versions of "when I
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
- **T6 — rename the four house rows. Unblocked.** Chandana's 2026-08-06 replies
  settle it: **"Orange House", not "Orange House – The Flame"**, and the logo
  waits for next year. The four colour tokens already in `app/globals.css`
  happen to match her colours — `--av-house-1` is orange, `-2` blue, `-3` green,
  `-4` yellow — so this is a four-row `UPDATE` with no token work and nothing
  outstanding.
- **T7 — there is no way to assign a house in bulk**, and the list that arrived
  needs one. One per-student `PATCH` at
  `app/api/sis/students/[enroleeNumber]/house/route.ts`, driven from the profile
  tab, is the only write path. **No longer blocked** — the live allocation is the
  20 class tabs, the ones written with the `🔵` emoji, **410 students**. Carry
  into the design: the superseded master tab still sits in the same file, the
  sheet has no student numbers so matching is by name, and five rows cannot be
  matched at all. **Next step is a dry-run match, not an import** — count exact /
  ambiguous / no-match against the database before deciding whether this is a
  throwaway script or needs a review screen.
- **T8 — the house belongs in the parent portal**, per Chandana, and nowhere on
  the report card. ⚠ Read the parent-portal constraint before designing it: a
  parent is null-role and reads some tables **directly**, where only
  `school_config` and `report_card_publications` are parent-readable and
  everything else silently returns zero rows. `houses` today is
  `authenticated`-read, so a parent would get a blank name, not an error.
- **T9 — staff are in houses too.** Hanafi's sheet carries a tab allocating ~44
  staff across the four houses. Nothing in the system models this, nobody asked
  for it, and it is recorded here only so it is not discovered late. Do not
  build it.

### Waiting on the school

- **Chandana** — **house is fully answered as of 2026-08-06**; see _Answers
  received_. Nothing outstanding on it. Still hers: whether a mid-year SOW change
  reaches in-flight terms or only future ones.

  Dropped rather than asked: whether a student ever changes house (the audit log
  already records the change by name, KD #178, so nothing turns on the answer)
  and whether siblings share a house (it would only matter if the system
  assigned houses, and Hanafi already has).

- **Mr Hanafi** — **new, and not a training attendee.** Answered 2026-08-06 and
  sent both sheets; see _Answers received_. **Nothing of his blocks the import
  any more.** All that is outstanding is the full names of five students his
  sheet lists by first name alone, and those five can be left unassigned without
  holding up the other ~485.
- **Christina** — the approver count (#10) and the AEB rule (#11). Also the
  relief-teacher policy, **raised by Marrie at 33:18** and answered in the room
  by Christina (designate an admin rather than share a login): admins can
  already write any section's attendance, but the audit log has no
  on-behalf-of concept and advisers cannot read it.
- **Wynne** — the Transcript of Records template. The data layer is complete and
  cross-AY on `studentNumber`; the template is the whole blocker. She asked for
  it directly at 1:00:57 and **offered the template herself** in the same
  exchange, so this is a reminder, not a cold request.

### To correct with the team

- **Koh was told she could change an exam paper's total via a change request**
  (she asked at 47:20, the answer came at 48:00). She cannot. That is
  coordinator-only subject config, blocked at the schema, at a DB `CHECK`, and
  at the apply RPC.
- **The two approvers are NOT a dual signature.** The first to act sets the
  status and nothing ever reads `secondary_decision`. Christina's 46:04 answer
  assumes both must agree; the system does not work that way today.
- **Chandana's 53:09 question is an unqualified yes**, and always has been —
  production already runs eleven different Maths exam totals across sections.

---

## Questions to send

Ready to copy. Send separately — short lists get answered.

**Two kinds of question, and only one of them belongs here.**

- **Reach** — "should this appear on the report card?", "do parents see it?",
  "does it affect the awards?" These have yes/no answers, and getting one wrong
  means the system does not do what the school wanted. **Ask these.**
- **Mechanics** — "can points be taken away?", "how long is it kept?", "is there
  a leaderboard?" These invite a bigger feature than the one requested. **Leave
  these out** until the school raises them.

Each block opens by stating what the feature reaches _today_, so the reply is a
confirmation rather than an invitation to design. House is why: it has been on
production for days, is read in exactly three places, and nobody has ever
confirmed that is what was wanted.

Four entries marked **⚠** are places where the system does not work the way
somebody in the room believed it did. Those are corrections, not questions.

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

### To Hanafi — the names I cannot match

**Was two questions; the first is answered.** Which allocation is live was
settled internally on 2026-08-06 — the per-class tabs — so only the unmatched
names remain. The superseded tab is mentioned last and as a courtesy, not as a
correction.

> Hi Mr Hanafi,
>
> Thank you — both sheets are exactly what I needed, and the points legend
> answered more than I had asked.
>
> Two small things before I load the list.
>
> 1. A few rows have only part of a name — Ariana, Richie and Matthew in Sec 3,
>    Rabaya in Primary 3 Courageous, and Shen Bustamante in Sec 2 I2. Could you
>    give me their full names, so I can match them to their records?
> 2. In Primary 1 Obedience, G Anne Luzano is marked Blue, but the count at the
>    bottom of that sheet reads Blue 5, Yellow 5, Green 4, Orange 4 — which only
>    adds up if she is Green. Every other class matches its own count exactly, so
>    this is the only one I am unsure about. Which is right for her?
>
> Everything else I can work out from the sheets themselves.
>
> One small thing you may want to know: there is still an older sheet in the
> same file listing every class in one long run, without the colour circles. I
> am ignoring it and using the per-class sheets, but it might be worth removing
> so nobody loads the wrong one later.
>
> Thank you po.

### To Christina — 1 of 5 · student details for teachers

> Hi Ms Christina,
>
> On the allergies and special-needs information you wanted teachers to see.
>
> **Right now teachers cannot open the Records module at all**, so they see none
> of this. What the system already holds, from the enrolment form: allergies,
> food allergies, asthma, heart conditions, epilepsy, diabetes, eczema, plus
> written details for allergies, food allergies, other conditions and dietary
> restrictions, and whether you have paracetamol consent.
>
> 1. Should teachers see all of that, or only some of it?
> 2. Every teacher, or only the ones who teach that student?
> 3. You also mentioned special-needs declarations — "diagnosed with ADHD, for
>    instance". **The system has nowhere to record that today**; it is not on
>    the enrolment form and there is no field for it anywhere. Where is that
>    kept at the moment, and should the system start holding it?
> 4. Should teachers only be able to read this, or should they be able to add to
>    it as well?
>
> Thank you.

### To Christina — 2 of 5 · medical certificates

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
> 3. Should it sit with the student's other documents (birth certificate,
>    passport and so on) so everything is in one place, or only against that
>    day's attendance?
> 4. **Worth confirming, because it is easy to miss:** an excused absence
>    already counts as **present** on the report card. The card shows only
>    Number of School Days, Days Present and Days Late — so a student with an MC
>    is not shown as absent at all, and the reason never appears. Is that what
>    you want?
>
> Thank you.

### To Christina — 3 of 5 · disciplinary records

> Hi Ms Christina,
>
> On the incident reports and disciplinary records.
>
> **Right now there is nothing about behaviour in the system at all.** The
> report card shows grades, attendance and the form class adviser's comment, and
> nothing else.
>
> 1. Where are incident reports written and kept today? I want to know whether
>    the system should replace that, or just show what is already on file.
> 2. Who should be able to see a student's record — every teacher who teaches
>    them, only the form class adviser, or only leadership?
> 3. Should anything about it ever appear on the report card?
> 4. Should parents be able to see it?
> 5. Should it affect whether a student can receive an award? At the moment
>    awards are worked out purely from marks, and nothing else is considered.
> 6. The form class adviser's report-card comment is currently the only place
>    anyone writes about a student's character, as free text. Should disciplinary
>    records be kept completely separate from that, or are they related?
>
> Thank you.

### To Christina — 4 of 5 · awards and certificates

> Hi Ms Christina,
>
> On the awards and certificates of participation.
>
> **Right now the system only has Gold, Silver and Bronze**, worked out
> automatically from a student's average marks. They are visible to staff only —
> they are not printed on the report card, and parents cannot see them.
>
> 1. What would you want recorded for each new award? I am assuming the award
>    name, the date, who gave it, and the certificate file — tell me if anything
>    is missing.
> 2. Who would enter it — the teacher who ran the activity, or the office?
> 3. Should these new awards appear on the report card?
> 4. Should parents be able to see them?
> 5. Should they feed the house points Ms Chandana mentioned?
>
> Thank you.

### To Christina — 5 of 5 · grade-change approvals

> Hi Ms Christina,
>
> On approving grade changes. Two things about how it works today may not match
> what you have in mind.
>
> 1. How many approvers do you need, and who are they?
> 2. ⚠ **Whoever responds first decides the request.** The second person's
>    response is never used. So it is not really two signatures — it is
>    whichever of you gets there first. If you need both to agree before a change
>    goes through, tell me and I will change it.
> 3. ⚠ **The teacher raising the request chooses which two approvers it goes
>    to**, from a list of everyone eligible. You said "two approvers, Ms Chandana
>    and I only" — if it should always be the same two people rather than the
>    teacher's choice, that is a change too.
> 4. For a change after the report book has gone out, you mentioned AEB
>    approval. Who should that be in the system?
> 5. Should anything other than a grade change need approval — a correction to
>    attendance, for example? Nothing else in the system has an approval step at
>    the moment.
>
> Thank you.

### To Koh — at-risk students

> Hi Ms Koh,
>
> The at-risk flagging you asked for is on the grading sheet now — a **Look up
> student** button lists who needs a look, with what dropped and by how much.
>
> **Right now only the subject teacher for that subject can see it.** Nobody is
> notified; you have to open the sheet. It does not appear on the report card
> and parents cannot see it.
>
> 1. You mentioned the subject teacher **or the FCA** — should the form class
>    adviser see this as well? They have no grading sheet of their own, so this
>    would need to go somewhere else for them.
> 2. Should anyone be **told** when a student is flagged, or is seeing it on the
>    sheet enough? There is a bell in the system today, but it only carries
>    grade-change requests.
> 3. How big a drop should raise a flag? It is set to five points at the moment.
> 4. Should this ever reach parents? I have assumed it stays staff-only and that
>    contacting the parents is the teacher's own call.
>
> ⚠ Also a correction to something you were told in the session. You asked
> (47:20) whether an exam's total marks could be changed through a change
> request — the answer given was yes, but that is not right. Total marks are part of the
> subject settings and are changed by the academic coordinator (Ms Joann).
> Change requests are for a student's scores only. Sorry for the confusion.
>
> Thank you.

### To Wynne

> Hi Ms Wynne,
>
> Two things from the training:
>
> 1. **Transcript of Records** — you offered to send the template during the
>    session. The data is all there and goes back across school years, so the
>    template is the only thing I am waiting on. Could you send a copy, or a
>    recent one with the student's details removed?
> 2. **Approvers** — you mentioned there are quite a few people who approve
>    grade changes. How many should the system allow? Ms Christina is deciding
>    who they are, so this is just the number.
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
- ⚠ **One student's house is genuinely uncertain: `LUZANO, G Anne D.` (P1
  Obedience).** Each tab tallies itself at the foot, and 19 of the 20 agree with
  their own rows exactly — an independent check on the extraction, written by the
  data's owner. P1 Obedience does not: the rows give Blue 6 / Yellow 5 / Green 3
  / Orange 4, the tally says Blue 5 / Yellow 5 / Green 4 / Orange 4. Both total 18. Marking Luzano Green — she is Blue at row 10, between two Yellows, breaking
  an otherwise tidy run — reproduces the tally exactly, and nothing else on the
  tab can. So either she was moved to Blue and the tally left stale, or the cell
  was changed by accident. **Ask before importing her.**
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
