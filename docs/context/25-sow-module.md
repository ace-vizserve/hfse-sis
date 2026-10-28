# 25 — Scheme of Work (SOW) module

Built 2026-10-26/27 on local `main`, **not pushed**; migrations 198 and 200 are on the local stack only. The decision record is **KD #234** (`docs/key-decisions/markbook-sow.md`, which also keeps the history of the two earlier builds, KD #108 and #110). The approved design is `docs/superpowers/specs/2026-10-26-sow-design.md`; the plan is `docs/superpowers/plans/2026-10-26-sow-module.md`.

## What it is for

A teacher writes one Scheme of Work for each subject, level and term — the school's own SOW is one workbook per subject per term with one tab per level. (There is no Standard / Global split: the first build had a "track", dropped by Mr Ace on 2026-10-28, migration 200.) It is the lesson plan: week by week the topic, learning outcomes, activities and assessment. It is vetted by the subject head, the OIC and the Assistant Principal, then approved by the AEB. During the term each teacher says how every week went, a relief teacher reads this week's lesson and records what they covered, and the subject head reviews and signs each week.

It is built around three readers, because the two earlier builds had none and were removed: the relief teacher, the approvers, and the supervisor (the subject head). It lives in **Classroom** (staff only; there is no student or parent view).

## Who does what

| Person                                                        | What they do                                                                                                                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subject teacher or co-teacher                                 | Start a SOW for their subject and level; tick which classes the SOW covers; write it; send it; fix and resend when returned; check each week for each class they teach once it is approved. |
| Subject head                                                  | Vets at step 1 (the `subject_head` step), then reviews the weekly checks of their subject and **signs a week** or **asks the teacher**. Only the subject head signs.                        |
| OIC, Assistant Principal, AEB                                 | Vet (OIC, Asst P) or approve (AEB) in turn. The OIC step is per half: the OIC Primary for Primary SOWs, the OIC Secondary for Secondary ones. They can also read SOWs in their scope.       |
| Relief teacher                                                | On the "You're covering" panel: **See today's lesson** (this week's plan, last week's check), and **Save what I covered**. Recording is asked for, never enforced.                          |
| Office (`academic_coordinator`, `school_admin`, `superadmin`) | Read every SOW, see oversight, **reopen** an approved SOW with a note, set subject heads and approval steps in SIS Admin. They do not write a SOW by virtue of the office role.             |

A write is admitted at the route for `teacher`, `academic_coordinator`, `school_admin` and `superadmin`, and then the **substantive-assignment check decides**: an office user who also teaches a subject can write that subject's SOW.

## Pages and routes

| Route                                                     | What it is                                                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `/classroom/sow`                                          | My schemes of work. Term tabs; one row per subject and level the teacher is assigned to, including not started.                |
| `/classroom/sow/[sowId]`                                  | The SOW: module details, week list, edit drawers, the step rail, Send / Return / Vet / Approve, "How did Week N go?".          |
| `/classroom/sow/review`                                   | "Waiting for you": SOWs on the current user's approval step.                                                                   |
| `/classroom/sow/oversight`                                | Supervisor page. SOWs tab and Weekly checks grid; one level at a time; Needs a look; Review and sign drawer.                   |
| `/classroom/sow/covering/[sectionId]/[subjectId]`         | The relief teacher's page for a class.                                                                                         |
| `/sis/admin/subject-heads`                                | Subject heads, per subject, optionally limited to Primary or Secondary.                                                        |
| `/sis/admin/approvers`                                    | The SOW approval steps sit with the other flows here.                                                                          |
| `POST /api/sow`, `POST /api/sow/import`                   | Create a draft (blank, copy from last year) / create one from an Excel file (`?preview=1` only reads and shows what it found). |
| `/api/sow/[sowId]` (GET, PATCH) and `/weeks/[weekNumber]` | Read a SOW; save module details; save one week.                                                                                |
| `/api/sow/[sowId]/submit`, `/reopen`                      | Send for review (also resend); reopen an approved SOW.                                                                         |
| `/api/sow/[sowId]/checks`, `/signoffs`                    | Record a weekly check; the subject head signs or asks.                                                                         |
| `/api/sow/[sowId]/excel`, `/api/sow/relief-notes`         | Download in the school's "Module Syllabus" layout; save a relief note.                                                         |

Vet, Approve and Return go through the shared approvals decide route (`/api/approvals/[id]/decide`).

## Tables (migrations 198, 200)

- `schemes_of_work`: AY, term, subject, level, `state` (`draft | in_review | returned | approved`), module details, `approved_snapshot`, `current_submission_id`, `started_from` (`blank | copy | import`), `copied_from_sow_id`. Unique on (term, subject, level) — migration 200 dropped 198's `track` column and its key.
- `scheme_of_work_classes`: the SOW and the sections that follow it.
- `scheme_of_work_weeks`: week number, dates, and the teacher-written fields. School events are read live from the calendar, not stored.
- `scheme_of_work_submissions`: one row per send; it is the approval request's subject. Holds the outcome and the return note and week.
- `scheme_of_work_checks`: append-only ledger, one row per teacher, class and week; the newest row wins.
- `scheme_of_work_relief_notes`: unique per relief teacher, class, subject and day; the SOW and week are nullable (a class with no approved SOW still takes a note).
- `scheme_of_work_signoffs`: `signed` or `asked`, with remarks.
- `subject_heads`: subject, staff user, optional level type.

Approval: `approval_stages.resolver` also allows `subject_head`; the flow is `markbook.scheme_of_work`; requests use `subject_type = 'scheme_of_work'`. Audit actions use the `sow.` prefix (Markbook).

## The rules

- **Weeks** run Monday to Friday. A week with at least one school day gets the next number; a week with none is a labelled break row with no number and is never "Not checked". Dates and events follow the section's level audience (KD #233).
- **States.** Draft and Returned are editable by the SOW's teachers; In review and Approved are locked. Send needs a topic in every numbered week, and is refused (422) while surplus weeks copied from last year remain. **Return** needs a note of at most 300 characters and may name a week; a resend opens a new submission and starts at step 1. A step with nobody on it stalls and says so; it is never skipped.
- **Approved snapshot.** The relief page, the weekly checks, copy-from-last-year and the grading-sheet warning read the approved snapshot. A reopened SOW is back in draft but its last approved plan stays in force until the revision is approved.
- **Weekly check.** Options `as_planned | adjusted | delayed | extra` ("As planned", "Adjusted", "Delayed", "Extra activities"). A note is required unless the option is `as_planned` (422 otherwise). A week cannot be checked until the SOW is approved. A teacher can change their own check until the subject head signs that class's week; after that the route answers 423.
- **Sign-off.** Only the subject head signs (403 for anyone else). Signing closes the week for that class; checks recorded after the newest `signed` row are ignored on every read. "Ask the teacher" needs remarks, leaves the week unsigned and shows on the teacher's SOW page and Classroom home.
- **Relief notes** are one per teacher, class, subject and day (saving again replaces). A note on a weekend or break attaches to the latest started week.
- **Oversight** shows one level at a time (`?level=`), filtered on the server; the SOWs tab opens on the first non-empty status. Who sees it: subject heads (their subjects), anyone on a named step of the flow (their half, or everything if unscoped), and the office roles (everything). The grid marks: check = as planned, ! = has a note, circle = not checked and the week is over, dot = not yet, underline = signed. Needs a look lists weeks with a note, weeks that ended unchecked, and two adjusted or delayed weeks in a row.
- **Caps.** Hours per week 300; textbook pages 500; weekly-check notes and supervisor remarks 1000 typed characters; Return note 300; an Excel import reads at most 60 weeks. The import and the edit forms share the same caps.
- **Excel.** Import reads the school's template once into a draft (the template's single "activities / assessment" column goes into activities) and shows a preview first; the file is never stored or kept in sync. Download writes the module details and weeks in the same layout with the monitoring block empty. `xlsx` stays on 0.18.5 and the import is bounded (see KD #234).
- **Grading sheets.** Creating grading sheets for a class that has no approved SOW shows a warning and still creates them. The warning names each class with its level ("P1 Courtesy · Math").
- **Import size.** An Excel file over **4 MB** is refused, in the drawer and at the route (Vercel turns away a request body over 4.5 MB before the route runs).
- **Locked weeks, even in a race.** A week update or delete whose SOW is in review or approved is refused by a trigger in migration 198 (`scheme_of_work_weeks_editable`, SQLSTATE 55000) and answered with the usual 423, so a save that lands just after a send cannot change the plan under review.
- **Deletes elsewhere.** Subject Setup refuses (409) to delete a subject that a SOW or a relief note uses; a subject's heads go with a deleted subject (`subject_heads.subject_id` cascades, snapshotted in the `subject.delete` audit row). Deleting a section is refused (409, "This class is on a scheme of work — take it off the scheme first.") while it is on a SOW or has checks, relief notes or sign-offs, before anything is deleted.
- **Subject heads who cannot act.** A head whose account was deleted or switched off stays in the setting but is left out of the readiness count, the pool a SOW is filed with, and the pool a waiting step is re-pointed to.

## Deliberately out

A separate lesson-plan document; any student or parent view; linking SOW assessments to grading-sheet slots; storing the Excel file; a version-history screen (`audit_log` is the trail); any outside planner (Flourish). A "SOW already approved" path for imports does not exist: an imported SOW is a draft and goes round the whole ladder.

## Running the end-to-end gates

They run on the **local stack only**, with `next dev` on `http://localhost:3000` (see `docs/context/24-local-dev.md`), and need a school day (a weekday inside a numbered week of the current term).

- `npm run e2e:sow` runs the whole folder: `phase-1` to `phase-5.local.spec.ts` (one gate per build phase) and `sow.local.spec.ts`, the full walk: a teacher starts a blank SOW and writes Week 1, sends it, the subject head, OIC, Assistant Principal and AEB approve, the teacher checks the week for both classes, the relief teacher records a note, and the subject head signs.
- `npx playwright test e2e/sow/sow.local.spec.ts` runs just the walk.
- Each spec arranges its own setup through the local database (approval steps, subject head, a two-class group with two teachers, cover) and removes it afterwards: in `afterAll` when the run ends, or, if a run was killed before that, in the next run's `beforeAll`. Screenshots land in `e2e/.results`.

## Before go-live

Apply migrations 198 and 200 to production **before** deploying; set the subject heads and the SOW approval steps in production SIS Admin (the readiness check on the approvers page flags an empty step); the `xlsx` advisories are Mr Ace's call; tell teachers which term starts it. KD #234 still needs its row in `.claude/rules/key-decisions.md`.
