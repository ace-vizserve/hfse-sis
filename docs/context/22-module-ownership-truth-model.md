# Module Ownership & the Historical-Truth vs Current-Truth Model

> Canonical architecture rule for how **Admissions**, **Records**, and **P-Files**
> share one student record. Formalized as **KD #147**. Read this before adding or
> changing any write path that touches `ay{YY}_enrolment_{applications,status,documents}`
> or `public.section_students`.

## Why this exists

All three modules read and write the **same underlying student data** — the three
core admissions tables (`ay{YY}_enrolment_applications`, `_status`, `_documents`)
plus `public.section_students`. With no explicit ownership rule the modules drift,
and a value shown in one module disagrees with another (we hit and fixed exactly
this on the Records dashboard: the New-Enrollments and Withdrawals card↔drill
divergences). This document defines **who owns what**, and **the direction data is
allowed to move**, so the modules stay consistent by construction.

This is the same "one record, no reconciliation step" principle that replaced HFSE's
original separate-Google-Sheets/VLOOKUP setup — see the pain-point → solution mapping
in `01-project-overview.md`.

## Two kinds of truth

- **Historical truth** — the immutable record of _what happened_. Append-only;
  **never rewritten**. (Hard Rule #6.) You cannot edit history backward.
- **Current truth** — a student's _present state_. Owned by exactly **one** module
  after enrolment; the others display it as a **read-only mirror**. Current truth
  only ever advances via **new forward events** — never by rewriting a past state.

**Direction rule:** once a student is enrolled, their status moves **forward only**
(you cannot push an Enrolled student back into the application funnel). The owning
module is the **sole writer**; every other module mirrors it read-only.

## The four participants (one shared student record)

### 1. Admissions — owns the Application Record (historical once enrolled)

Owns the pre-enrolment funnel + the historical admissions facts: application
submitted date, referral source, interview/assessment outcome, admissions
decision, admissions officer, and the 9-stage workflow progression on
`ay{YY}_enrolment_status`. Owns **pre-enrolment** document validation.

**Once a student is fully `Enrolled`, all of this is historical and read-only in
Admissions** — the module only _displays_ the post-enrolment state. (`Enrolled
(Conditional)` is the one exemption — still editable until it resolves to
`Enrolled`, so a conditional student is never stuck.)

### 2. Shared Student Profile — editable from Admissions **or** Records

The identity row on `ay{YY}_enrolment_applications`: name, DOB, gender,
nationality, address, passport/pass number, parent details, contact information,
emergency contacts. **It is one record** — an edit from either module is the same
row, so it reflects in both immediately. There is no separate "records profile."

> Caveat: the student **name** is also denormalized into `public.students`
> (the grading schema's copy, for `section_students`/`grade_entries` FKs). A name
> edit must update both. Every other profile field is single-sourced on the apps row.

### 3. Records — owns the Academic Lifecycle (post-enrolment current truth)

Owns, on `public.section_students` + the grading schema: **enrollment status,
enrollment date, section, level, attendance, grades, evaluation, withdrawal,
re-enrolment.** This is the **current truth** of enrolment. Admissions'
`applicationStatus` is a **read-only mirror** of it, kept in sync by the existing
**Records→Admissions cascade** (a Records withdrawal sets `applicationStatus='Withdrawn'`;
re-enrol sets it back to `'Enrolled'`).

### 4. P-Files — owns the Document Lifecycle (post-enrolment current truth)

Owns, for **enrolled** students on `ay{YY}_enrolment_documents`: document
`{slot}Status/Url/Expiry`, renewals, the auto-expire/revive state machine, plus
the append-only `p_file_revisions` (every document version) and `p_file_outreach`
(reminders/promises). P-Files only **reads** enrollment status (to gate via
`isStudentEnrolled`) and profile (to display) — it never writes them (it does
write passport/pass _document metadata_ onto the apps row on upload).

## Two temporal handoffs at enrolment

The single "enrolment" event hands off two different axes to two different owners:

| Axis                                            | Pre-enrolment owner           | Post-enrolment owner                    |
| ----------------------------------------------- | ----------------------------- | --------------------------------------- |
| Academic (status, section, attendance, grades…) | Admissions (funnel)           | **Records**                             |
| Documents (validation → renewals)               | Admissions (validation queue) | **P-Files**                             |
| Identity/profile                                | **Shared** (both)             | **Shared** (both)                       |
| Application history                             | **Admissions**                | Admissions (now historical / read-only) |

## Cascade & mirror map (who writes what, which direction)

- **Records → Admissions (automatic):** withdrawal / re-enrolment cascade the
  enrollment mirror (`applicationStatus` = `Withdrawn` / `Enrolled`). Section
  transfers update `classSection`/`classLevel`/`classStatus='Finished'`.
  _(`app/api/sections/[id]/students/[enrolmentId]/route.ts`, `lib/sis/section-transfer.ts`.)_
- **Admissions → Records (manual only):** an Admissions change does **not** auto-sync
  to Records. Initial enrolment syncs via `syncOneStudent` / bulk sync. The
  `/records/unsynced` queue (KD #90) surfaces gaps.
- **Shared profile:** edit from either side writes the one apps row.
- **Post-enrolment status / documents:** Admissions is **frozen** (see Enforcement).

## Historical-truth stores (append-only — never rewritten)

- `audit_log` — every lifecycle mutation; the `lib/sis/movements.ts` feed
  _reconstructs_ transfer / withdrawal / late-enrol history by demuxing it
  (it reads no movement table). (KD #83.)
- `public.section_students` — append-only: a transfer **withdraws the old row +
  inserts a new one**; withdrawn rows are retained forever. (Hard Rule #6, KD #67.)
- `p_file_revisions` — every document version (RLS-locked, service-role only). (KD #36/#63.)
- `p_file_outreach` — every reminder/promise. (KD #64.)
- `grade_entries` / `grade_audit_log` — append-only grade history. (Hard Rule #6.)

## Enforcement (code)

The rule is enforced at the **write layer**, not just in the UI:

- ⚠ **Status freeze (Lock #1) — REMOVED 2026-09-10. There is no post-enrolment
  stage freeze any more.** It used to sit in
  `app/api/sis/students/[enroleeNumber]/stage/[stageKey]/route.ts` and reject
  every stage-status mutation once a student was fully `Enrolled`, for **every
  role including superadmin** — module ownership expressed as a lock. Mr Ace:
  _"we should just enable that its all audit logged anyways"_. It made an honest
  correction to an enrolled child's record impossible for the people who own
  that record, and what replaces it is the **audit row that route already writes
  on every field change**. `isAdmissionsStageFrozen`,
  `POST_ENROLMENT_EDITABLE_STAGES` and `STAGE_FINALIZED_STATUSES` are deleted
  from `lib/schemas/sis.ts` — deleted rather than left dormant, so no caller can
  quietly reintroduce the rule; `__tests__/sis/enrolled-record-stays-editable.test.ts`
  asserts they stay gone.
  - **What is NOT affected:** the prerequisite gate on the flip **to** `Enrolled`
    (`ENROLLED_PREREQ_STAGES` + `STAGE_TERMINAL_STATUS`) is a different rule and
    still fires; so does the per-status completion gate
    (`findStageCompletionBlockers`). The withdrawal / re-enrol cascades never went
    through this editor.
  - ⚠ **Three stage fields have teeth now that they are editable after
    enrolment:** `fatherEmail` and `guardianEmail` each gate two document slots,
    and `applicationStatus = 'Enrolled (Conditional)'` gates one. Clearing a gate
    **hides** a slot that may already hold an approved file. Nothing is deleted
    and restoring the gate brings it back, but no screen shows it meanwhile.
- **Document handoff (Lock #2) — still in force, and it was never really about
  role names.** `app/api/sis/students/[enroleeNumber]/document/[slotKey]/route.ts`
  picks `documents_pre_enrolment.validate` or `documents_post_enrolment.validate`
  from the **student's** enrolment state, and the caller must hold that side.
  KD #166 made it a capability precisely so one person could hold both. Today
  `admissions`, `school_admin` and `superadmin` each hold both, since
  `p_file_officer` was retired into `admissions` on 2026-09-10 (KD #207).
  `registrar` in older prose here means `academic_coordinator` (KD #155), and she
  holds no document capability at all since migration 106.
- **Shared profile (Open):** profile/family edits are exposed from Records too
  (writing the existing `/profile` + `/family/[parent]` routes, which already
  allow `registrar`). This **amends KD #97** — Records is no longer read-only on
  the shared profile; it remains read-only on the _application history_ axis.

## Out of scope (deliberately)

- Moving the profile onto a single cross-year `public.students` record
  (per-AY profile is the operative current-AY record).
- A `graduated` enrollment status.
- Changing the cascade mechanics, the withdrawal write path, or the movements feed.
