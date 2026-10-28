# Scheme of Work (SOW) — design

**Date:** 2026-10-26 · **Status:** approved by Mr Ace 2026-10-26 (§10 defaults accepted)
**Sources:** Christina's process + sample (`docs/training/sessions/SIS-Academics-Training-Session-1-Action-Items.md`, _Christina — the SOW process, and a sample · 2026-10-05_), the design agreed 2026-10-05/06 (same file, T12 hold note), the 18-board mockup `https://claude.ai/artifact/D9HuZFBVC842AUk5SCYDMH`, the sample workbook `AY2026 Term 2 Science SOW Secondary.xlsx` (repo root, not committed).

Calls marked **(our call)** were made while writing this and are open to change. Everything else is what the school or Mr Ace said.

---

## 1. Why, and why this time is different

Teachers write a Scheme of Work for each subject, level and term. It is the lesson plan: Christina, _"lesson plans are incorporated in the SOW"_. It has the week-by-week topics, learning outcomes, activities and assessment plan, and _"its contents become the basis for the grading"_. Today it is an Excel file. It is vetted by the subject head / monitor, the OIC and the Assistant Principal, then approved by the AEB.

**SOW has been built and removed twice already** (KD #108, KD #110, migrations 058–066). The removal commit says why: _"zero real users — HFSE teachers maintain their SOW in external documents"_. Neither build had a reader.

**This build has three readers. None of them existed before:**

1. **The relief teacher.** Christina: _"If a relief teacher comes, he will check the current week's learning objectives and learning strategies"_ and _"from next year, relief teacher needs to record what was covered"_. Relief cover already exists in the SIS (KD #191, the "You're covering" panel). This gives that panel a lesson to show.
2. **The approvers.** The four-step vetting happens in the SIS instead of by email.
3. **The supervisor.** The school's template already has a "Monitoring Module Delivery" block with weekly ticks and supervisor remarks. That becomes a weekly check per class that the supervisor can see and sign.

**Success:** for a term, every SOW is written, vetted and approved in the SIS, with no Excel copy alongside it. A relief teacher who opens a class sees that week's lesson and the last note on how the class is going.

**Anti-goals.** These would make it a failure even if it works:

- **Teachers keep the Excel too.** Then the SIS copy is double entry and goes stale, which is how the last two builds died. The Excel template is read in once (import) and given back out on request (download). It is never kept in sync.
- **A stale SOW misleads a relief teacher.** A wrong lesson plan is worse than none. The relief view therefore always shows the last weekly check note next to the plan.
- **A third teardown.**

## 2. Scope

**In:** writing SOWs, approving them, the weekly check per class, the relief view and the relief note, supervisor oversight and sign-off, the approval-steps setting, a one-time Excel import, Excel download, and copying a SOW forward to the next year.

**Not in:**

- **A separate lesson-plan document.** The SOW's weeks are the lesson plan.
- **Any student or parent view.** Classroom is staff-only (KD #160).
- **Linking SOW assessments to grading-sheet slots.** The school names assessments loosely ("Worksheet 1", "Quiz 1", "Assessment 1A"), not as WW1 / PT1.
- **Storing the Excel file.** The SIS stores the contents.
- **A version-history screen.** `audit_log` keeps the trail.
- **Flourish, or any outside planner.** The vendor meeting never happened (memory, 2026-10-26).

## 3. The SOW itself

### 3.1 What one SOW covers

**One SOW per academic year × term × subject × level.**

> **2026-10-28 — track dropped (Mr Ace).** This section first made one SOW per subject × level × **track** (track = `sections.class_type`, 'Standard' / 'Global'). The school never split it that way: its scheme of work is one workbook per subject per term, one tab per level. Migration 200 dropped `schemes_of_work.track`; the unique key is now (term, subject, level), and the class picker offers every section of the level whatever its class type. Where this spec still says "track" below, read it as gone.

Each SOW lists the **classes that follow it**: the sections of that level (any class type) ticked when it is created. A teacher teaching Science to Sec 1 Discipline 1 and Discipline 2 writes one SOW for both.

### 3.2 Contents

The contents mirror the school's "Module Syllabus" template.

**Module details** (written once per SOW):

- module title
- syllabus
- teaching hours per week
- teaching methods
- assessment weights, read from the subject's setup (`subject_configs` WW / PT / QA weights) and not typed in
- pass requirement
- textbook
- references
- remarks

**Weeks** (one block per teaching week of the term):

- **Set automatically:** the week number, its dates, and that week's school events.
  - Dates come from `terms.start_date` / `end_date`. Weeks run Monday to Friday; Week 1 is the week the term starts in.
  - **(our call)** A week with at least one school day gets a number and a block, including part-weeks at either end. A week with no school day at all, such as a full mid-term break, gets no number. It shows as a labelled break row between blocks, and it is never "Not checked". Copy-from-last-year and the import line weeks up by number.
  - Events come from the school calendar (`school_calendar` holidays + `calendar_events`), filtered to this level by its audience (KD #233).
  - The template has these typed in by hand. The SIS fills them in.
- **Written by the teacher:**
  - topic / established goals
  - learning outcomes
  - textbook pages
  - teaching and learning activities
  - assessment
  - remarks

**(our call)** Learning outcomes, activities and remarks are rich-text fields (KD #205). The rest are plain text.

### 3.3 Who writes it

- **A subject teacher or co-teacher** of that subject on any of the SOW's classes can create it and edit it while it is a draft or returned. The design reads "teachers prepare their level's section" (T12). **(our call)** All of them edit the same SOW, and the audit log names who changed what.
- **Coordinators and admins** (`academic_coordinator`, `school_admin`, `superadmin`) can read every SOW. They don't write one.

### 3.4 Starting a SOW (mockup board 2)

A drawer on the "My schemes of work" page asks for:

- subject
- level
- term
- the classes that follow it (checkboxes)

It then offers three ways to start:

1. **Copy from last year** (the default when one exists). This starts from the approved SOW for the same subject, level and term in the previous academic year.
   - The module details and the content of every week are copied across.
   - Week dates and events are recalculated from this year's calendar.
   - Weekly checks and notes are **not** copied.
   - If the week counts differ, extra weeks come in blank, and surplus weeks are shown at the end for the teacher to merge or delete.
2. **Start blank.** Empty weeks for the term, already dated.
3. **Import from Excel.** For SOWs already written in the school's template this year. The SIS reads the file once, and after that the SOW is edited in the SIS, not in the file.
   - The importer reads the template's layout: header rows, one block per week, and one tab per level, matching the tab to the chosen level.
   - It shows what it read before anything is saved.
   - A file over 4 MB is refused (Vercel's request body limit is 4.5 MB).

Each way creates a **draft**.

## 4. Approval

### 4.1 The ladder

The ladder is the school's: **teacher prepares → subject head / monitor vets → OIC vets → Assistant Principal vets → AEB approves** (Christina, 2026-10-05).

It runs on the **existing approval engine** (KD #196, migrations 126–146) as a new flow, `markbook.scheme_of_work`. It is added to `STAGED_APPROVAL_FLOWS` and appears on `/sis/admin/approvers` with the other flows (mockup board 12). It works the same way as those flows:

- **Steps are configuration, not code.** Nobody is seeded by a migration.
- Each step has a rule set per step: one person on it is enough ('any') or everyone must approve ('all').
- The OIC step uses the existing per-half scoping (`applies_to_level_type`, migration 128): the OIC Primary for Primary SOWs, the OIC Secondary for Secondary ones.
- A step with nobody on it stalls loudly and is never skipped.
- Changes apply to SOWs sent for review after saving. SOWs already in review keep their steps, as the existing repoint rules allow (migration 146).

### 4.2 The subject head (new)

**The SIS has no record of who heads each subject.** There is no role and no per-subject assignment.

**(our call)** This adds a **"Subject heads" setting in SIS Admin**: per subject, one or more staff accounts, optionally limited to Primary or Secondary.

The approval engine gets a third way to find a step's people, `resolver = 'subject_head'`, alongside 'named' and 'form_adviser'. It resolves from the setting for the SOW's subject and level type.

Like a named step, the pool is fixed when the SOW is sent. It is re-pointed when the setting changes, using the same mechanism as named steps.

The staff picker lists real accounts only, with no free-text entry.

### 4.3 States (mockup boards 3, 5–8, SOW page component)

| State         | Who can edit             | What the teacher sees                                                                                     |
| ------------- | ------------------------ | --------------------------------------------------------------------------------------------------------- |
| **Draft**     | the SOW's teachers       | Edit module details, edit any week, **Send for review**, Download Excel                                   |
| **In review** | nobody (locked)          | The step rail (Teacher · Subject head · OIC · Asst P · AEB) with dates; "Waiting on the OIC since 12 Mar" |
| **Returned**  | the SOW's teachers       | The approver's note, pinned to the week it is about when one is given. **Send for review again**          |
| **Approved**  | nobody (locked, see 4.4) | The weeks, this week highlighted, and the weekly check                                                    |

**What the approver sees:**

- The whole SOW.
- **Approve**, or **Vet** at the earlier steps. The button reads "Vet" or "Approve" depending on the step. **(our call)** The label comes from whether it is the last step.
- **Return to teacher**, with a required note and an optional week it is about.

**Return** is a rejection in the engine's terms: it ends that request. **Send for review again** opens a new request that starts again at step 1. This is the agreed rule ("restarts at step 1", mockup board 0).

`approval_requests` is unique on (flow, subject_type, subject_id), so a second request for the same SOW id would come back as "already open". **(our call)** Each send therefore creates a `scheme_of_work_submissions` row, and that row is the request's subject. This also keeps the full history of rounds.

**Waiting for you.** Each approval flow has its own queue in its module: declarations at `/attendance/declarations`, grade changes at `/markbook/change-requests`. **(our call)** SOWs get theirs as a **"Waiting for you"** tab on the Scheme of work page in Classroom. It also shows in the approver's home to-dos and the sidebar count, as the other flows do. No new email.

### 4.4 Changing an approved SOW

Chandana (2026-08-12): mid-year changes happen, they are rare, and they apply to the current year.

**(our call)** An approved SOW stays locked. A coordinator or admin can **reopen** it with a note. Reopening returns it to draft, and it then goes round the ladder again.

While it is being revised, **the relief view and the weekly check keep showing the last approved content**. The SOW therefore keeps one approved snapshot of its weeks alongside the working copy. The snapshot is replaced when the revision is approved.

## 5. During the term

### 5.1 The weekly check (mockup boards 7, SOW page "How did Week N go?")

For each **class × week** of an approved SOW, **each teacher assigned to that subject on that class** (subject teacher and co-teacher) picks one option:

- **As planned**
- **Adjusted**
- **Delayed**
- **Extra activities**

A note is **required** for anything except As planned. Each option has its own prompt, such as "What was delayed, and why?". This replaces the template's two teacher columns of five ticks. "Others" is dropped, because the note covers it.

Timing:

- The check opens on the week's Monday. **(our call)** It is due by the end of that week. A week that has ended without a check shows as **Not checked**.
- **(our call)** A teacher can change their own check until the supervisor signs that week.
- **(our call)** With two teachers on a class, each gets the to-do. On the oversight grid, a class's week counts as checked once **every** assigned teacher has checked it. The cell shows the most serious mark: a note (!) beats ✓, and anyone missing after the week ends shows ○.

**A week can't be checked until the SOW is approved.** Mockup board 1: "Can't be checked until approved".

### 5.2 The relief teacher (mockup boards 13–14)

**Who counts as covering:** a teacher with live relief cover on the class that day. That is `teacher_assignments.relief_teacher_user_id` inside `relief_started_on` / `relief_ended_on` (KD #191).

**Where they see it:** the existing "You're covering" panel gains **See today's lesson**. It opens a page for that class showing:

- this week's lesson: topic, learning outcomes, activities, assessment, and this week's school events
- **last week in this class**: its check and note, which is the guard against a stale plan
- a link to the whole term's SOW, read-only
- **What did you cover?** A note saved to that class's week, which the subject teacher and the supervisor see

If the class has no approved SOW, the page says so plainly and still takes the relief note (board 14). Christina's rule says the relief teacher records what was covered, and that doesn't depend on the plan existing.

**(our call)** Recording is asked for but not enforced. Nothing blocks the relief teacher from leaving.

### 5.3 The supervisor (mockup boards 10–11)

**The supervisor is the subject head** for that subject. The mockup reads "Signed by subject head".

A **Scheme of work** oversight page in Classroom has two tabs.

**SOWs:** every SOW for the term with its state. It shows counts: approved out of total, and which are not started.

**Weekly checks:** a grid with one row per class × subject and one column per week. Each cell shows one of:

| Mark         | Meaning                                    |
| ------------ | ------------------------------------------ |
| ✓            | As planned                                 |
| !            | Adjusted, delayed or extra, and has a note |
| ○            | Not checked, and the week is over          |
| ·            | Not yet                                    |
| (underlined) | Signed by the supervisor                   |

Above the grid:

- filters for level, subject, and "only needs a look"
- tiles: approved SOWs, classes checked this week, and how many need a look

**Needs a look** lists three things:

- weeks with a note
- weeks that ended unchecked
- two adjusted or delayed weeks in a row

**Review and sign a week** is a drawer per class × week. It shows:

- the planned row
- each teacher's check and note
- any relief note

The supervisor adds remarks, then chooses **Sign Week N** or **Ask the teacher**. Asking sends the teacher a note, and the week stays unsigned.

**Who sees the oversight page (our call):**

| Who                                                                            | What they see                                              |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Subject heads                                                                  | their subjects                                             |
| Anyone on a named step of the SOW approval flow (the OIC, the Asst P, the AEB) | the half their row is scoped to, or everything if unscoped |
| `academic_coordinator`, `school_admin`, `superadmin`                           | everything                                                 |

**Only the subject head signs.**

### 5.4 The teacher's Classroom home (mockup board 15)

The teacher's Classroom index gains two lists above the existing class list.

**This week's lessons:** one row per class they teach, showing the topic and a status:

- check due
- relief that day
- in review
- returned

**To do:**

- fix and resend a returned SOW
- check this week, per SOW
- start a SOW not yet started for this term

The existing class list is unchanged.

### 5.5 "My schemes of work" (mockup board 1)

The page has term tabs. Each row is a subject · level, showing:

- its classes
- its state
- this week's status
- the next action: Open / Fix and resend / Start SOW

A row is listed for every subject × level the teacher is assigned to, **including ones not started**, so nothing is missed.

## 6. Excel

- **Import.** A one-time import from the school's template, described in 3.4.
- **Download Excel.** Any SOW can be downloaded in the school's "Module Syllabus" layout. **(our call)** The download includes the module details and the weeks. It leaves the monitoring block empty, because the checks live in the SIS.

## 7. Grading sheets

The design agreed in T12 says **"no grading sheet config without an approved SOW"**. **Decided 2026-10-26: a warning only, never a block.** When grading sheets are created for a term, any class × subject without an approved SOW is listed in a warning, and the sheets are still created.

## 8. Data (sketch, the builder decides the details)

**New tables:**

- `schemes_of_work`: AY, term, subject, level, state, module details, the approved snapshot, the current approval request id, and who created it. Unique on (term, subject, level) — migration 200 dropped the track column on 2026-10-28 (§3.1).
- `scheme_of_work_classes`: the SOW and its sections.
- `scheme_of_work_weeks`: the SOW, week number, dates, and the teacher-written fields. Events are read live from the calendar and not stored.
- `scheme_of_work_checks`: the SOW week, section, teacher, option, and note. One row per teacher per class per week. This is an append-only ledger, and the newest row wins, like `attendance_daily`.
- `scheme_of_work_relief_notes`: the SOW week (nullable when the class has no SOW), section, date, relief teacher, and note.
- `scheme_of_work_signoffs`: the SOW week, section, subject head, remarks, and either signed or asked.
- `subject_heads`: subject, staff user, and optionally a level type. A head whose account was deleted or switched off is ignored when a SOW is filed or re-pointed and in the readiness count.

As built (2026-10-27): a SOW or a relief note keeps its subject and its classes from being deleted (Subject Setup and section delete answer 409); a subject's heads go with a deleted subject; a week of a SOW in review or approved cannot be changed, enforced in the database.

**Changes to existing pieces:**

- Approval engine: `approval_stages.resolver` gains `'subject_head'`. SOWs are filed as `subject_type = 'scheme_of_work'`.

**Audit:** new `sow.*` actions — create, import, edit, send, vet, approve, return, reopen, check, relief note, sign, ask, and subject-head setting changes. They appear on the Markbook and SIS audit logs.

**Access:**

- **Writes go through service-role routes** that check the caller's assignment, or through RLS, following the module's existing pattern.
- The approval tables keep their deny-all posture.

## 9. Rollout

- **(our call)** The first term to use it is the next term that opens after go-live.
- SOWs already written this year come in through the Excel import.
- Copy-from-last-year becomes useful from the second year on.
- The subject heads and the approval steps must be set in SIS Admin before the first SOW can be approved. The readiness check on `/sis/admin/approvers` flags any step with nobody on it.

## 10. Decided — Mr Ace, 2026-10-26 ("go with your defaults")

1. **Grading sheets:** a warning only, never a block (§7).
2. **Primary:** uses the same layout as Secondary. Revisit if a Primary sample in a different template turns up.
3. **Excel imports:** an imported SOW is a draft and goes round the full approval ladder like any other. There is no "already approved" path.
4. **Which subjects:** every subject × level that has grading sheets in that term (a `subject_configs` row for the AY, and the subject taught to the level's sections) gets a SOW row on "My schemes of work".
