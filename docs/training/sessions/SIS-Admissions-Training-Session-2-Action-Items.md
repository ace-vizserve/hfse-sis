# SIS Admissions Training Session #2 — Action Items

**Source:** "SIS Training with Admissions Team Session #2" — Fathom recording, 15 Sep 2026 (53m)
**Recording:** 182985935
**Present:** 10 invitees. Named on the recording: Apple Grace Obias, Jill Sulit,
Wynne Lynn Faustino, Maria Luz Pizana. Demo driven by Ace Guevarra.
**Compiled:** 15 Sep 2026 · timestamps are into the recording

⚠ **Relationship to `SIS-Admin-Training-Session-1-Action-Items.md` is unconfirmed.**
That file records "SIS Training with Admin Team", 13 Aug 2026. This one is
titled "Admissions Team Session #2". Whether they are the same series is not
established on either recording, so they are kept as separate files rather than
asserting a link. **Ask before merging them.**

**Same convention as the other session files:** this file holds the words, the
todos and the open questions; `docs/sprints/development-plan.md` holds the
sprint status. Quotes are verbatim.

---

## Status

| #   | Ask                                              | Who                         | Status                                                                                                            | Where                               |
| --- | ------------------------------------------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 13  | Email user guide + credentials to Admissions     | Ace (51:17)                 | ✅ **Done 2026-09-19**                                                                                            | —                                   |
| 14  | Investigate student number automation            | Apple Grace (34:09)         | 🟡 **Half answered 2026-09-19** — the school's numbers are now recorded (206 loaded); minting + format still hers | See _Item 14_                       |
| 15  | Send Admissions the list of reminder emails      | Apple Grace (37:53)         | ✅ **Done 2026-09-19**                                                                                            | Templates already exist             |
| 16  | Show the team the reminder email design          | Ace (37:00)                 | ✅ **Done 2026-09-19**                                                                                            | ⚠ Her concern may already be solved |
| 17  | Check discount codes against HitPay invoicing    | Luz, from Apple (49:10)     | **Unresolved** — Ace's answer was a guess                                                                         | No HitPay integration exists        |
| 18  | Get the updated school calendar / events setup   | Jill + Apple (50:17)        | ✅ **Calendar rebuilt the same day**                                                                              | KD #214/#215, migration 158         |
| 19  | Request the student master list from Apple Grace | Ace (40:55)                 | **Requested, unacknowledged**                                                                                     | ⚠ Scope warning below               |
| 20  | Do not apply Miss Ko's index-number change       | Jill (46:50)                | **Decided** — matches the Registrar session                                                                       | See registrar file, item 7          |
| 21  | Confirm the P-files "not applicable" status      | Wynne (32:49)               | ⚠ **The answer is NO** — and it is a dead value                                                                   | `lib/p-files/document-config.ts`    |
| 22  | Send Ace the student master list                 | Apple Grace                 | Requested, unacknowledged                                                                                         | Same as #19                         |
| 23  | Send Ace the per-course book lists               | Wynne, from Ms. Tim (38:56) | **Do not build** — requirement unclear, Wynne said so                                                             | Supplies is a status, not a list    |
| 24  | Send Ace historical grade records for TOR        | Wynne (51:33)               | **Scope it first** — this is a migration project                                                                  | —                                   |
| 25  | Supply reminder email content                    | Apple Grace                 | 🟡 **Live now** — #15 and #16 are done, so the ball is hers                                                       | ⚠ Only for emails that don't exist  |
| 26  | Clarify the class list source with Miss Ko       | Jill / Wynne (45:40)        | Agreed in principle                                                                                               | Loop in Ms. Chandana                |
| 27  | Raise discount codes with Sir Meng               | Luz (49:55)                 | Self-assigned                                                                                                     | —                                   |

---

## Item 14 — student number automation

Apple Grace explained that Admissions generates student numbers **manually** and
does not use the system-generated number. The ask: can the SIS produce numbers
in their existing format? Ace had not checked; said it is probably possible —
_"possible naman."_

She added a complication: there is both an **enrolment number** and a **student
number**, and the convention used earlier this year differs from the previous
one, so the identifiers are not stable on their side either.

### What the repo actually holds

**Nothing in this repo mints a student number.** There is no generator, no
sequence, no trigger, no format code. `students.student_number` is populated
exclusively by copying the admissions value (`lib/sync/students.ts:471`), and
the sync **refuses** to create a student without one:

```ts
if (!app.studentNumber)
  return { ok: false, change: 'skipped', reason: 'no studentNumber' };
```

The SIS cannot even edit it. `lib/schemas/sis.ts:12-16`:

> Two stable IDs are deliberately NOT in any schema and are 400'd by the API
> routes if the client sends them: `enroleeNumber` and `studentNumber`. They are
> referenced by other tables across years (Hard Rule #4) … Edit those at the
> admissions layer if they're ever wrong.

And the user-facing message when an applicant has none is explicit that the
parent portal issues it:

> This applicant has no Student Number on file, so they cannot be added to a
> class roster yet. Student numbers are issued at parent-portal submission
> alongside the enrolee number — contact admissions support to assign one.

### Why this matters more than it sounds

`studentNumber` is Hard Rule #4 — the only stable student ID, the backbone of
cross-year linking, and what every module's shared identity rests on. The
enrolee number (`E260001`) resets each academic year; the student number
(`H260441`) is supposed to persist. The `YY` in a student number is the year of
**first** enrolment, which is what makes it stable — `H180138` and `H250785` are
both live.

🔴 **The manual minting has already cost real data.** On 2026-09-15 three children
were found holding two student numbers each, and the signature is recorded in
`scripts/backfill/apply-merge-duplicate-students.ts:52-58`:

> each AY2026 number is that child's enrolee number **with the prefix swapped**
> (E260441 → H260441) — the signature of a record created for an applicant
> instead of linked to the child who already existed.

Three roster rows and nine evaluation write-ups had to be repointed. Separately,
`scripts/audit-student-number-hygiene.ts` found leading and trailing whitespace,
inner spaces and lowercase letters in the column — _"one split record is
literally the same number with a trailing space, which means the column is not
normalised anywhere."_ The admissions DDL has it as plain nullable text with no
CHECK and no default.

**Assessment.** This is the most structurally significant item across both
meetings. The identity model rests on a field the school does not populate
through the system, in a format that changed mid-year, with no validation on
either side. _"Possible naman"_ is not a plan.

⚠ **Now connected to the Registrar session:** index numbers are also manually
driven, and "Generate all indexes" does not follow the school's own rule (see
the registrar file, item 7). **Both of the SIS's student-ordering identifiers
are manual, and neither currently matches the school's conventions.**

**Before any code:** agree the format with Apple Grace, agree who owns minting,
and decide whether the SIS validates on read or takes over generation. Nothing
should be built on _"probably possible"_.

### Update 2026-09-18/19 — measured, and half of it is now answered

Her ask was really two: _can the SIS produce numbers in our format_, and _why do
the two of us disagree about a child's number_. The second one is now measured
and partly solved; the first is still open and still needs her.

**The disagreement is structural, not sloppiness.** The school numbers children
**sequentially within a class** (P1 Patience runs H260001–H260008, then P1
Obedience picks up at H260009); the SIS number comes from the order the
application arrived. Measured against the school's own class list, **221 of 430
AY2026 children are numbered differently** and 187 agree. The two lists can
never be reconciled by adopting one — **7 of the school's numbers are already a
DIFFERENT child's system number**, so adopting them would fuse those pairs.
That is exactly the fusing risk that stopped the 2026-09-17 masterlist pass.

✅ **The school's number now has a home** — `students.school_student_number`
(migration 169, applied). It is reference data: nothing joins or syncs on it,
an admin can correct it on the student record, and **206 were loaded on
2026-09-19** (`scripts/backfill/apply-school-student-numbers.ts`). So the SIS
now RECORDS the school's format even though it still does not MINT it.

🔴 **Why the SIS's own number must stay as it is.** `lib/sync/students.ts` looks
a child up by the admissions `studentNumber` and **inserts a new student when it
finds none** — so a number that drifts from admissions does not break a join, it
**splits one child into two**. That is the mechanism behind the duplicates in the
paragraph above, and it is still live: **36 children currently hold two
`students` rows** (one on a roster, one orphaned). Mr Ace has confirmed
duplicate parent submissions are **normal**, so this will keep happening — the
durable fix is to key the sync on `enroleeNumber`, not to keep merging by hand.

⚠ **YoungStarters use a `Y` prefix** (`Y250006`), carried unchanged into
Primary — ten such children were already in the SIS. So the format question has
more than one answer depending on where a child started.

**What still needs Apple Grace:** the format itself, and who owns minting.
Recording her numbers does not answer either — it just means the SIS no longer
loses them.

---

## Items 15 / 16 / 25 — reminder emails

Apple Grace's underlying concern: **parents miss notification emails because
subject lines are not standardised**, making them unsearchable and hard to
reference over the phone. Ace committed to sending the list of reminder emails
the system sends, and loosely to showing the design.

⚠ **Her concern may already be solved for the emails this system sends.** The
P-Files reminder templates are standardised and generated, not hand-typed —
`lib/notifications/email-pfile-reminder.ts` builds three fixed subject shapes:

- `Action needed: {document} not accepted — {student}`
- `Document follow-up needed: {document} for {student}`
- `Document renewal needed: {document} for {student} ({descriptor})`

Send-tracking already exists, via the `claim_pfile_reminder` RPC (migration 096),
which holds the cooldown check and the write in one place so a reminder cannot be
double-sent.

**So the question to put to Apple Grace is narrower than the item as recorded:**
are the emails she means the ones this system sends, or the ones the parent
portal sends? If the former, the answer is that subject lines are already fixed
and she should say what they should read instead. **Do not design anything until
that is settled** — and note that item 25 (her supplying content) only makes
sense for emails that do not exist yet.

✅ **#15 and #16 done 2026-09-19** (Mr Ace) — the list was sent and the design
shown. **The ball is now hers on #25.**

⚠ **The narrow question above is NOT closed by that.** Sending the list is not
the same as establishing whether she means this system's emails or the parent
portal's, and the answer decides whether there is anything to build at all: if
she means this system's, the subject lines are already standardised and
generated, so the work is re-wording three shapes rather than designing
reminders. **Still worth asking her outright before any of #25's content turns
into a build.**

---

## Item 17 — discount codes and HitPay

Luz's actual question: with discount codes now in the SIS, do we reference them
when invoicing in HitPay, or keep a separate file? She does not want to maintain
discounts in two places.

Ace's answer was a guess — he reasoned the codes should be the same across
HitPay and the Portal (_"dapat same lang"_) and said he would check.

**What the repo holds:** discount codes are a SIS Admin feature —
`app/api/sis/discount-codes/route.ts`, `…/[id]/route.ts`,
`components/sis/discount-codes-data-table.tsx`, with a uniqueness constraint
added by migrations 098 and 099, and the AY-setup wizard creating them per year.

**There is no HitPay integration in this repo at all.** No client, no webhook, no
reconciliation. So the codes are the same string in two systems only if a person
keeps them the same.

**This is a one-code end-to-end test, not a build.** Issue one code in the SIS,
invoice it in HitPay, see whether anything reconciles. An hour of work that
closes the question without waiting on Sir Meng (item 27, which Luz self-assigned).

---

## Item 18 — the calendar ✅ REBUILT THE SAME DAY

Jill and Apple asked for something per teacher in events, with numbers that do
not parse from the transcript.

**The calendar was rebuilt on 2026-09-15** (KD #214 + #215, migration 158
applied). Every AY2026 row had previously been inferred from finished attendance
registers; it now comes from the school's published calendar. Term 4 had opened
on 14 Sep with 49 rows, every one a plain school day — 8 published closures were
still markable, 5 were the wrong kind of day, 72 events were missing. Applied:
12 closures corrected, 63 events added, 42 given a real level scope.

**On "per teacher":** `calendar_events` has **no teacher, owner or assignee
column**. Its columns are `id, term_id, start_date, end_date, label, created_at,
created_by, audience, category, tentative, levels, section_ids`. `created_by` is
provenance and nothing scopes on it.

What migration 158 _did_ add is level and section scoping, which is the nearest
thing — an event can now name the levels it is for, so "P6 Fieldtrip" stops
appearing on every P1 teacher's register. Measured after: a P1 register shows 7
July events and none is the Leadership Camp; P6 shows 10, camp 3 of 3. Section
scoping exists but is unused — a section has a form adviser, so scoping an event
to sections is the only indirect route to a named teacher.

**Confirm what they actually meant before building anything.** "Per teacher in
events" could be scoping, or it could be a per-teacher view of the calendar,
and the transcript does not distinguish them.

⚠ **Cross-reference:** Joann said she is _given_ the calendar rather than setting
it, so the upstream owner of calendar data is someone other than either Joann or
the Admissions team. Worth identifying.

🔴 **Still open from the calendar work itself:** 43 closures and 9 events fall
outside every term window with nowhere to store them (New Year, term breaks, the
Nov–Dec block) — both calendar tables are term-scoped.

---

## Items 19 / 22 — the student master list

Ace wants to **import** Apple's master list as the authoritative source for
index numbering. Apple never explicitly agreed — the conversation turned into
debugging the ordering and never came back.

⚠ **Scope warning, recorded because it was not said in the room.** He wants to
import, not eyeball. That makes Admin's list the **permanent upstream** for SIS
index numbers. Define the handoff — which file, which version, what refresh
cadence, and what happens when the two disagree — or the same mismatch recurs
next term.

⚠ Note the tension with Joann's ruling (registrar file, item 7): if the master
list is the upstream and the master list is permanent, then an import must be
able to _place_ students without renumbering the ones already there. The current
"Generate all indexes" cannot do that — it re-sorts the whole non-withdrawn
block. The tool that can is the swap.

---

## Item 20 — the index-number ruling ✅ DECIDED

Jill's reasoning: **Admin's file is authoritative** because Admin does not
release the class list to ACAD until enrolment is finalised.

Wynne separately traced the corruption to the **Term 3 consolidated grading
file** from Ms. Chandana, which has a phantom blank row where Ajmal sat, between
Antonio and Kalimbas. **Term 2's file was correct.**

This is the same answer Joann gave three hours earlier, reached independently.
**Settled.** Full detail, including where the code already agrees and the one
place it does not, is in `SIS-Registrar-Training-Session-1-Action-Items.md`,
item 7.

🔴 **The cross-reference that matters:** the consolidated file Joann calls the
most important artefact in the school is the same file Wynne identified as the
source of the index corruption. Both sessions land on it from opposite
directions.

---

## Item 21 — the P-Files "not applicable" status

Wynne asked directly whether the status dropdown has a **"not applicable"**
option, for documents on the per-category list that do not apply to a given
current student. Ace did not answer yes or no — he said the per-category
applicability logic is not captured in the system, so his approach is to list
every document and let staff apply only what fits. Asked whether that skews
dashboard completion, he said no, non-applicable documents are not counted.

### The answer to what she asked is **no**

`'na'` is in the `DocumentStatus` union with a label, a `CircleSlash` icon, a
fill and a legend row — and **`resolveStatus` can never return it**. There is no
`'na'` branch; an unrecognised stored value falls through to `'missing'`
(`lib/p-files/document-config.ts:453`). The codebase says so in its own words at
`lib/p-files/drill.ts:116-119`:

> `'na'` → `'Missing'` (resolveStatus never actually returns `'na'` today — no
> `DOCUMENT_SLOTS` conditional path emits it — kept for exhaustiveness /
> future-proofing …)

There is also no database enum and no CHECK constraint on any status column —
every slot's status is plain nullable `varchar`. The only values this system
writes are `'Valid'`, `'Rejected'`, `'To follow'`, `'Expired'` and (from the
parent portal) `'Uploaded'`.

### His second answer was right, though

Non-applicable documents genuinely are not counted. What implements it is
**slot-level exclusion, not a status**: `isSlotApplicable(slot, facts)` drops a
slot from the list entirely. Four slots are conditional today — conditional
enrolment, late enrolment form, father's passport/pass (on `fatherEmail` being
filled) and guardian's passport/pass. And every counter honours it: the roster
ratio filters `'na'` out of both halves, `isOutstanding` excludes it, and the
dashboard's completion-by-level skips inapplicable slots.

### So the real gap is the one Wynne implied, not the one she asked

Applicability is **hardcoded per slot**, keyed on facts the application form
already holds. There is no per-category document logic and no way for a staff
member to mark one document N/A for one student. Right now that filter lives in
each staffer's head, so "outstanding documents" counts are only as good as
individual judgement.

⚠ **She accepted the answer, so nothing was assigned.** Two things remain open:
(a) the yes/no she actually asked, and (b) category-based document applicability
as an unbuilt requirement.

⚠ **One divergence found while checking, unrelated to her question:** the
dashboard donut iterates raw `DOCUMENT_SLOTS` with no `isSlotApplicable` filter,
while the completion-by-level chart applies it. The two disagree.

---

## Item 23 — the per-course book lists

Post-payment flow is books and materials collection, then orientation, mapping
to the **Supplies** section. Currently a printed form parents tick or sign.

**Wynne said herself the requirement is unclear.** She does not know whether Ms.
Tim wants the full book list itemised per student, or whether a remarks field
suffices — her own example was noting a book not collected because stock was not
in.

**What exists today:** `supplies` is a pipeline stage with three statuses —
`Pending`, `Claimed`, `Cancelled` (`lib/schemas/sis.ts:704`). There is no
itemisation and no book list anywhere.

**Do not build until clarified.** The gap between "a remarks field" and "an
itemised per-student book list with stock tracking" is the whole project.

---

## Item 24 — historical grade records for TOR

Per Sir Meng, TOR needs grade history. Wynne confirmed Admissions can provide it
across all past years.

⚠ **Scope check: "all records from past years" is a migration project, not an
attachment.** For reference, AY2026 alone needed separate importers for Term 1
primary, Term 1 secondary, Term 2 primary and Term 2 secondary, each with its own
design doc and plan, plus five correction passes afterwards — and Term 3 grading
still is not imported at all.

**Scope which academic years TOR actually needs first**, and in what form the
records exist, before accepting the offer.

---

## Waiting on the school

- **The student master list** from Apple Grace, with the handoff defined —
  which file, which version, refresh cadence (#19 / #22).
- **The student number format and who owns minting** (#14). Nothing gets built on
  "probably possible".
- **Which emails Apple Grace means** — this system's or the parent portal's
  (#15/#16). ⚠ **Still open even though #15 and #16 are done**: the list was
  sent and the design shown, which is not the same as her saying which system's
  emails she meant. That answer decides whether #25 is a build or a re-wording.
- **Her reminder-email content** (#25) — now hers to supply, unblocked by #15/#16.
- **What "per teacher in events" means** — scoping, or a per-teacher view (#18).
- **The book list requirement**, from Ms. Tim via Wynne (#23).
- **Which academic years TOR needs** (#24).
- **The class list source**, with Miss Ko — and Ms. Chandana looped in, since she
  prepares the consolidated file Wynne identified as the likely source (#26).

---

## Ace's own items

- ✅ **#13 — email the user guide and credentials to Admissions.** Done 2026-09-19.
- ✅ **#15 / #16 — the reminder-email list and design.** Done 2026-09-19.
- 🔴 **#17 — test one discount code end to end** before anyone issues a real
  one. **The only item on this session still owned by Ace**, and the only one
  where an untested guess costs money rather than time.
