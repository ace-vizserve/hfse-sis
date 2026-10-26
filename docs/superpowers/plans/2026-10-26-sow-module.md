# Scheme of Work (SOW) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teachers write each term's Scheme of Work in the SIS. It is approved through the school's four-step ladder, then checked week by week per class. Relief teachers read it and record what they covered, and the subject head oversees and signs off.

**Architecture:**

- **Data.** Seven new tables (migration 198), written only through service-role API routes, following the approval tables' deny-all posture.
- **Approval.** Runs on the existing engine (KD #196) as a new flow, `markbook.scheme_of_work`. The engine gains one new kind of step, `subject_head`, which is frozen into a named pool when a SOW is sent.
- **Screens.** They live in Classroom under `/classroom/sow`, built from the 18-board mockup.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + RLS), Zod, TipTap rich text (KD #205), `xlsx` 0.18 for Excel, Vitest, and Playwright for the final walk-through.

**Spec:** `docs/superpowers/specs/2026-10-26-sow-design.md`. Read it in full before any task. The mockup is `https://claude.ai/artifact/D9HuZFBVC842AUk5SCYDMH`, with boards referred to below as "board N".

## Global Constraints

**Code, data and checks:**

- Hard Rule #7: tokens come from `app/globals.css` only. No hex, `oklch`, `slate-*`, `zinc-*` or `gray-*` in `app/` or `components/`. Read `docs/context/09-design-system.md` and `09a-design-patterns.md` before any UI task, and invoke `frontend-design:frontend-design` first.
- Buttons: secondary buttons are `outline`, never `ghost`, and there is one primary per view. Multi-field forms go in a `Sheet` drawer, and dialogs are never nested.
- Every `<DataTable>` column with a render-function header declares `meta: { label }` (KD #161).
- On-screen copy is plain English for school staff, with no developer words. Use the screen text from the mockup boards.
- Rich text "empty" is `isEmptyRichText` (`lib/rich-text`).
- `studentNumber` is not involved here, so no student identifiers are stored.
- Audit actions use the `sow.` prefix, which is already mapped to Markbook in `lib/audit/modules.ts`. Each one is added to `ALL_AUDIT_ACTIONS` (`lib/audit/log-action.ts`) and to `lib/audit/humanize.ts`.
- Migration 198 goes to the **local** stack only (`npm run local:migrate`). Production is a separate, later step that Mr Ace approves.
- Tests run with `npx vitest run <path> --pool=threads`. Every test file imports its vitest globals explicitly.
- Git: commit with `git add <paths> && git commit -m …` as ONE command. Run `git pull --rebase` before any push. Never use `--no-verify`. Never touch other sessions' uncommitted files: `CLAUDE.md`, the admissions application page, the P-Files page, `enrollment-history-chips.tsx`, `document-config.ts`.

**Behaviour from the spec:**

- **Return note:** required, at most 300 characters (the `approval_request_stages.decision_note` cap).
- **Weekly-check options:** exactly `as_planned | adjusted | delayed | extra`, labelled "As planned", "Adjusted", "Delayed", "Extra activities". A note is required unless the option is `as_planned`.
- **Week rule:** Monday to Friday. A week with at least one school day gets the next number. A week with none is a break row with no number.

## Phase gates — Playwright (Mr Ace, 2026-10-26)

**Every phase ends with its own Playwright spec on the local stack.** It must pass before the next phase starts:

- Each spec lives at `e2e/sow/phase-<N>.local.spec.ts`. They are written in the style of `e2e/parent-portal/parent-portal.local.spec.ts`, using `localDb()` from `e2e/parent-portal/local-db.ts` for setup only, and each one undoes its own setup.
- Each spec drives that phase's screens as the real user would. Phase 1: an admin sets a subject head, and the approvers screen offers "Subject head for that subject" on the SOW flow.
- Run each with `npx playwright test e2e/sow/phase-<N>.local.spec.ts`, against `next dev` on the local stack.
- Task 18's full walk-through is the Phase 6 spec.

## Review Focus

Five ways real use could break this that no task's main tests cover. Each one's test is added to the task named:

1. **A teacher drops off a class mid-term.** A teacher whose assignment ends mid-term opens a SOW they edited: it is read-only for them, and their past checks still show. (Task 5)
2. **A term's dates change after the SOWs are written.** Weeks are re-dated by number on the next load, and content is never lost. (Task 2: `reconcileWeeks` keeps content by number and flags surplus weeks)
3. **An approver is also the SOW's own teacher.** The filer is kept off every pool (`excludeUserIds`), as grade changes already do. (Task 9)
4. **Two teachers save the same week at once.** The second save gets a 409 with "Someone else changed this week a moment ago — reload to see it", never a silent overwrite. (Task 7: `updated_at` check)
5. **A relief teacher whose cover window has ended opens the lesson link.** They are refused with a plain sentence, using the same `isReliefLive` window as everywhere else. (Task 14)

---

## Phase 1 — Data and approval plumbing

**Gate:** all Phase 1 tests pass, `npx tsc --noEmit` is clean, migration 198 applies on the local stack with 0 errors, and a reviewer approves before Phase 2.

### Task 1: Migration 198 — the SOW tables

**Files:**

- Create: `supabase/migrations/198_scheme_of_work.sql`
- Test: `__tests__/sow/migration-198.test.ts` (a text test, the pattern of the existing migration text tests)

**Interfaces — Produces these tables.** All of them deny `authenticated` everything; service role only.

**Tables:**

- `schemes_of_work`
  - Columns:
    - `id`
    - `academic_year_id`
    - `term_id`
    - `subject_id`
    - `level_id`
    - `track` (text, check `('Standard','Global')`)
    - `state` (text, check `('draft','in_review','returned','approved')`, default `'draft'`)
    - `module` jsonb, default `'{}'`. Keys: `title`, `syllabus`, `hoursPerWeek`, `teachingMethods`, `passRequirement`, `textbook`, `references`, `remarks`.
    - `approved_snapshot` (jsonb null)
    - `approved_at`
    - `current_submission_id` (uuid null)
    - `started_from` (text, check `('copy','blank','import')`)
    - `copied_from_sow_id` (uuid null)
    - `created_by`
    - `created_at`
    - `updated_at`
  - Unique on `(term_id, subject_id, level_id, track)`.
- `scheme_of_work_classes` — `(sow_id, section_id)` primary key. Task 6 enforces that one class is on only one SOW per subject and term, since the subject lives on the parent row.
- `scheme_of_work_weeks`
  - Columns:
    - `id`
    - `sow_id`
    - `week_number`
    - `starts_on`
    - `ends_on`
    - `topic`
    - `learning_outcomes` (rich text)
    - `textbook_pages`
    - `activities` (rich text)
    - `assessment`
    - `remarks` (rich text)
    - `updated_at`
  - Unique on `(sow_id, week_number)`.
- `scheme_of_work_submissions` — `id`, `sow_id`, `submitted_by`, `submitted_at`, `outcome` (check `('pending','approved','returned','cancelled')`), `return_note`, `return_week_number`. **The approval request's `subject_id` is this row's id.**
- `scheme_of_work_checks`
  - Columns: `id`, `sow_id`, `week_number`, `section_id`, `teacher_user_id`, `option`, `note`, `recorded_at`.
  - Append-only: the newest row per `(sow_id, week_number, section_id, teacher_user_id)` wins.
- `scheme_of_work_relief_notes` — `id`, `sow_id` (null when the class has no SOW), `week_number` (null in the same case), `section_id`, `subject_id`, `taught_on`, `relief_teacher_user_id`, `note`, `created_at`.
- `scheme_of_work_signoffs`
  - Columns: `id`, `sow_id`, `week_number`, `section_id`, `signed_by`, `remarks`, `kind` (check `('signed','asked')`), `created_at`.
  - Append-only; the newest row wins.
- `subject_heads` — `id`, `subject_id`, `user_id`, `applies_to_level_type` (null, or `'primary' | 'secondary'`), `created_at`, `created_by`.
  - Unique index on `(subject_id, user_id, coalesce(applies_to_level_type,'*'))`.

**Change to an existing table:** alter `approval_stages`, dropping and re-adding the resolver check so it allows `('named','form_adviser','subject_head')`. Leave `approval_request_stages.resolver` unchanged: a subject-head step is materialised as `'named'` (Task 3).

- [ ] **Step 1: Write the failing text test.** Assert the file:
  - creates all eight tables;
  - contains `check (resolver in ('named', 'form_adviser', 'subject_head'))`;
  - contains `revoke all on` for each new table from `authenticated`;
  - does NOT alter `approval_request_stages`.
- [ ] **Step 2:** Run `npx vitest run __tests__/sow/migration-198.test.ts --pool=threads`. Expect it to FAIL (file missing).
- [ ] **Step 3: Write the migration.** Make it idempotent (`if not exists`, `drop constraint if exists`). Comment each table with its job in one sentence.
- [ ] **Step 4:** Run the test (PASS), then `npm run local:migrate`. Expect 0 errors.
- [ ] **Step 5: Commit.** `feat(sow): migration 198 — scheme of work tables`

### Task 2: Term weeks

**Files:**

- Create: `lib/sow/weeks.ts`
- Test: `__tests__/sow/weeks.test.ts`

**Interfaces — Produces:**

```ts
export type TermWeek =
  | {
      kind: 'week';
      weekNumber: number;
      startsOn: string;
      endsOn: string;
      schoolDays: string[];
    }
  | { kind: 'break'; startsOn: string; endsOn: string; label: string | null };
export function buildTermWeeks(input: {
  termStart: string;
  termEnd: string; // ISO dates
  closedDays: ReadonlySet<string>; // holidays and no-school days for this level
  closedLabels?: ReadonlyMap<string, string>; // date → calendar label, for break rows
}): TermWeek[];
export function weekForDate(
  weeks: TermWeek[],
  isoDate: string
): Extract<TermWeek, { kind: 'week' }> | null;
export function reconcileWeeks<T extends { weekNumber: number }>(
  stored: T[],
  weeks: TermWeek[]
): {
  kept: (T & { startsOn: string; endsOn: string })[];
  missing: number[];
  surplus: T[];
};
export async function loadTermWeeks(
  service: SupabaseClient,
  termId: string,
  levelId: string
): Promise<{ weeks: TermWeek[]; eventsByWeek: Map<number, string[]> }>;
```

`loadTermWeeks` reads closed days and event labels for the level with the KD #233 audience rule. That is `school_calendar`, plus `calendar_events` filtered by level → band → whole school. Reuse the readers in `lib/attendance/school-days.ts` rather than re-querying.

- [ ] **Step 1: Write the failing tests:**
  - `numbers a full term Monday to Friday`: term 2026-03-23 → 2026-05-29 with no closed days gives 10 weeks, Week 1 = 23–27 Mar.
  - `a part-week at the start counts`: term starting on a Wednesday gives Week 1 = Wed–Fri.
  - `a week with no school day is a break, not a number`: closing 13–17 Apr gives a `break` there, and the next week is Week 4, not Week 5.
  - `a week with one school day still counts`: Good Friday plus three other closed days, with one day open, gives a numbered week.
  - `weekForDate` returns null on a weekend and on a break.
  - `reconcileWeeks` (Review Focus #2): 10 stored weeks against 9 term weeks gives `surplus` = [week 10] and keeps content by number. Against 11 term weeks it gives `missing` = [11].
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3: Implement.** The functions are pure, apart from `loadTermWeeks`.
- [ ] **Step 4:** Run the tests. Expect PASS.
- [ ] **Step 5: Commit.** `feat(sow): term weeks from the school calendar`

### Task 3: The engine learns "subject head" steps, and the SOW flow is registered

**Files:**

- Modify:
  - `lib/schemas/approval-flows.ts`: add `'markbook.scheme_of_work'` to `STAGED_APPROVAL_FLOWS`, plus its entries in `STAGED_FLOW_LABELS`, `STAGED_FLOW_DESCRIPTIONS` and `STAGE_NAME_EXAMPLES`; export `SOW_APPROVAL_FLOW`; widen `ApprovalResolver` to include `'subject_head'`.
  - `lib/approvals/materialise.ts`: `OpenApprovalRequestInput` gains `subjectHeadPool?: readonly string[]`. A configured `subject_head` stage is written as a request stage with `resolver: 'named'` and `approver_pool` = that pool (filer excluded). `ConfiguredStage.resolver` is widened.
  - `lib/approvals/readiness.ts`: a `subject_head` step is "ready" when at least one `subject_heads` row exists. It is flagged "No subject heads set yet — set them in Subject heads" when none do.
  - `lib/approvals/config.ts`: the config writer accepts `resolver: 'subject_head'` **only** for `markbook.scheme_of_work`. It refuses `approval_rule: 'all'` on it, since the check from migration 145 already blocks that. `repointWaitingStages` skips `subject_head` steps; Task 4 repoints those.
  - The approvers screen at `app/(sis)/sis/admin/approvers/page.tsx` and its client component: for the SOW flow, the "who" picker offers **"Subject head for that subject"** next to named people.
- Test:
  - `__tests__/approvals/subject-head-step.test.ts`
  - extend `__tests__/approvals/readiness.test.ts`

**Interfaces — Produces:**

- `SOW_APPROVAL_FLOW = 'markbook.scheme_of_work'`
- `openApprovalRequest({ …, subjectHeadPool })`
- The flow label "Classroom · Scheme of work approval"
- The description, from board 12: "Each SOW goes through these steps in order. If someone returns it, it goes back to the teacher and starts again from step 1."

- [ ] **Step 1: Write the failing tests:**
  - `a subject-head step is filed as a named step with the given pool`: the inserted request stage has `resolver: 'named'` and `approver_pool: ['u-head']`.
  - `the filer is never in a subject-head pool`: `subjectHeadPool: ['u-t','u-head']`, `filedBy: 'u-t'` gives the pool `['u-head']`.
  - `an empty subject-head pool still files and stalls` (KD #196, a stall is never a skip): the pool is `[]` and the stage exists.
  - `subject_head is refused on any other flow`: config write for `attendance.student_declaration` gives an error.
  - `readiness flags a subject-head step with no heads at all`.
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run `__tests__/approvals/` in full. Expect PASS, with no regressions in `decide-pipeline`, `state-machine-parity` or `step-rule-filing`.
- [ ] **Step 5: Commit.** `feat(approvals): subject-head steps, and the scheme of work flow`

### Task 4: Subject heads setting

**Files:**

- Create:
  - `lib/sow/subject-heads.ts`
  - `app/api/sis-admin/subject-heads/route.ts` (GET, PUT)
  - `app/(sis)/sis/admin/subject-heads/page.tsx`
  - `components/sis/subject-heads-client.tsx`
- Modify:
  - `lib/auth/roles.ts`: a ROUTE_ACCESS row and an SIS Admin nav item "Subject heads", for the same roles as `/sis/admin/approvers`.
  - `lib/audit/log-action.ts` and `lib/audit/humanize.ts`: add `sow.subject_head.set`.
- Test: `__tests__/sow/subject-heads.test.ts`

**Interfaces — Produces:**

```ts
export type SubjectHeadRow = {
  subjectId: string;
  userId: string;
  appliesToLevelType: 'primary' | 'secondary' | null;
};
export async function listSubjectHeads(
  service: SupabaseClient
): Promise<SubjectHeadRow[]>;
export function subjectHeadPool(
  rows: SubjectHeadRow[],
  subjectId: string,
  levelType: 'primary' | 'secondary' | null
): string[];
export async function replaceSubjectHeads(
  service: SupabaseClient,
  actor: { id: string; email: string },
  subjectId: string,
  rows: Omit<SubjectHeadRow, 'subjectId'>[]
): Promise<{ repointed: number }>;
```

`replaceSubjectHeads` writes the rows, then re-points every **waiting or pending** request stage of `markbook.scheme_of_work` whose config stage is `subject_head` and whose SOW has this subject. It calls `approval_repoint_request_stage(stage_id, newPool, 'any')`, the RPC from migration 146, through the service client. Then it writes the audit row.

**Screen:** one row per subject that is offered in the current AY. Each row has a staff picker that lists real accounts only, with no free text, and an optional "Primary only / Secondary only" scope.

- [ ] **Step 1: Write the failing tests:**
  - `subjectHeadPool picks untagged plus matching half, deduped`.
  - `replacing heads re-points a waiting SOW step to the new pool`: the mock RPC is called once with the new pool.
  - `replacing heads leaves other subjects' requests alone`.
  - `PUT refuses a teacher`: 403.
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3: Implement.** Do the UI after reading the design docs and invoking frontend-design. The pattern is an SIS Admin settings page (§6 matrix) with a `DataTable`, and an inline picker per row, since it is 1–2 fields.
- [ ] **Step 4:** Run the tests. Expect PASS.
- [ ] **Step 5: Commit.** `feat(sow): subject heads setting in SIS Admin`

---

## Phase 2 — Writing a SOW

**Gate:** tests pass, tsc is clean, and on the local stack (sign in as `teacher18@local.test` / `localdev123`) you can create, copy, edit and see a draft. Screenshot boards 1, 2, 3 and 4 against the mockup. Reviewer approves.

### Task 5: Who can do what

**Files:**

- Create: `lib/sow/access.ts`
- Test: `__tests__/sow/access.test.ts`

**Interfaces:**

- Consumes: `loadEffectiveAssignmentsForUser` (`lib/auth/teacher-assignments.ts`).
- Produces:

```ts
export type SowKey = {
  termId: string;
  subjectId: string;
  levelId: string;
  track: 'Standard' | 'Global';
};
export type SowCapability = 'edit' | 'read' | 'none';
export function sowCapability(input: {
  role: Role;
  userId: string;
  assignments: EffectiveAssignmentRow[]; // the caller's
  sow: { subjectId: string; state: SowState; classSectionIds: string[] };
}): SowCapability;
export async function listMySowRows(
  service: SupabaseClient,
  userId: string,
  termId: string
): Promise<MySowRow[]>;
export type MySowRow = SowKey & {
  subjectName: string;
  levelLabel: string;
  classes: { sectionId: string; name: string }[];
  sow: { id: string; state: SowState } | null;
};
export type SowState = 'draft' | 'in_review' | 'returned' | 'approved';
```

**Rules:**

- **`edit`** applies to a **substantive** `subject_teacher` or `co_teacher` assignment on the SOW's subject, on any of its classes, while the SOW is `draft` or `returned`. Relief assignments never give `edit`.
- **`read`** covers:
  - the same teachers in any other state;
  - relief cover on one of its classes;
  - `academic_coordinator`, `school_admin`, `superadmin`;
  - anyone on a step of the SOW's current request.
- `listMySowRows` gives one row per subject × level × track in which the teacher has a substantive subject or co-teacher assignment, **limited to subjects that have a `subject_configs` row for the AY** (spec §10.4). It includes rows with no SOW yet (`sow: null`).

- [ ] **Step 1: Write the failing tests:**
  - `a subject teacher on one class can edit a draft`.
  - `nobody edits while in review`.
  - `a relief teacher can read but not edit`.
  - `a coordinator reads every SOW`.
  - Review Focus #1: `a teacher whose assignment is gone can no longer edit` gives `'none'` when there are no assignments and the role is teacher.
  - `listMySowRows groups two sections of one level and track into one row`.
  - `listMySowRows skips a subject with no subject_configs row`.
- [ ] **Step 2:** Run the tests (FAIL), then **Step 3:** implement, then **Step 4:** run them (PASS).
- [ ] **Step 5: Commit.** `feat(sow): who can edit and read a scheme of work`

### Task 6: Creating a SOW (blank or copied)

**Files:**

- Create:
  - `lib/sow/create.ts`
  - `lib/schemas/sow.ts` (the Zod schemas for every SOW route)
  - `app/api/sow/route.ts` (POST)
- Modify: `lib/audit/log-action.ts` and `humanize.ts` — add `sow.create`.
- Test: `__tests__/sow/create.test.ts`

**Interfaces:**

- Consumes: `loadTermWeeks` and `reconcileWeeks` (Task 2), and `sowCapability` / `listMySowRows` (Task 5).
- Produces:

```ts
export const CreateSowSchema: z.ZodType<{
  key: SowKey;
  sectionIds: string[];
  start: 'blank' | 'copy';
}>;
export async function createSow(
  service,
  actor,
  input
): Promise<
  | { ok: true; sowId: string }
  | { ok: false; status: 400 | 403 | 409; error: string }
>;
export async function findLastYearSow(
  service,
  key: SowKey
): Promise<{ id: string; label: string } | null>; // approved only
```

**Rules:**

- **409** "A scheme of work already exists for this subject, level and track this term." on a duplicate key.
- **409** naming the class when a ticked section already belongs to another SOW for the same subject and term.
- **`copy`:**
  - copies `module` and each week's fields by `week_number` from last year's **approved snapshot**;
  - adds `missing` weeks blank;
  - keeps `surplus` weeks as extra rows numbered after the last term week, flagged in the UI for the teacher to merge or delete;
  - stamps `copied_from_sow_id`;
  - never copies checks.
- **`blank`:** one empty row per term week.
- Week dates always come from `loadTermWeeks`.

- [ ] **Step 1: Write the failing tests:**
  - `blank creates one row per term week with this year's dates`.
  - `copy brings content by week number and re-dates it`.
  - `copy never brings checks`.
  - `a duplicate key is a 409 with the plain sentence`.
  - `a class already on another SOW for the subject is a 409 naming it`.
  - `a teacher without an assignment on the classes is refused`: 403.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: Commit.** `feat(sow): create a scheme of work, blank or copied from last year`

### Task 7: Editing module details and weeks

**Files:**

- Create:
  - `lib/sow/edit.ts`
  - `app/api/sow/[sowId]/route.ts` (GET, PATCH module)
  - `app/api/sow/[sowId]/weeks/[weekNumber]/route.ts` (PATCH; DELETE only for a surplus week)
- Modify: the audit files — add `sow.edit`.
- Test: `__tests__/sow/edit.test.ts`

**Interfaces — Produces:**

```ts
export async function updateModule(
  service,
  actor,
  sowId,
  module: SowModule,
  expectedUpdatedAt: string
): Promise<EditResult>;
export async function updateWeek(
  service,
  actor,
  sowId,
  weekNumber: number,
  fields: SowWeekFields,
  expectedUpdatedAt: string
): Promise<EditResult>;
export type EditResult =
  | { ok: true; updatedAt: string }
  | { ok: false; status: 403 | 409 | 423; error: string };
```

**Status codes:**

- **423** "It's in review, so it can't be edited. Ask to have it returned if something needs changing." when the state is `in_review` or `approved`.
- **409** for a stale save (Review Focus #4).

**Rich text** goes through the existing sanitiser in `lib/rich-text`.

**Audit context** carries field names only, never the content.

- [ ] **Step 1: Write the failing tests:**
  - `a teacher edits a draft week`.
  - `editing in review is a 423 with the plain sentence`.
  - Review Focus #4: `a stale save is a 409`.
  - `a surplus week can be deleted, a term week cannot`.
  - `audit context names the fields, not the text`.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: Commit.** `feat(sow): edit module details and weeks`

### Task 8: Screens — My SOWs, New SOW drawer, SOW page (draft), Edit week drawer

**Files:**

- Create:
  - `app/(classroom)/classroom/sow/page.tsx` (board 1)
  - `app/(classroom)/classroom/sow/[sowId]/page.tsx`
  - `components/sow/my-sows-table.tsx`
  - `components/sow/new-sow-sheet.tsx` (board 2, without the import option yet — Task 11 adds it)
  - `components/sow/sow-page.tsx` (the SOW page component, all states; draft and returned now, other states in Task 10)
  - `components/sow/edit-week-sheet.tsx` (board 4)
  - `components/sow/week-list.tsx`
- Modify: `lib/auth/roles.ts` — add the CLASSROOM_NAV item "Schemes of work" → `/classroom/sow` for teachers and office roles, plus a matching ROUTE_ACCESS row (the same list, per the comment on that nav).
- Test: `__tests__/sow/screens-copy.test.ts`. A light render test checks that the status badges read "Draft", "In review · {step}", "Returned", "Approved", "Not started", and that the row actions read "Open", "Fix and resend", "Start SOW".

**Behaviour** comes from boards 1–4:

- term tabs;
- the "This week" column;
- the copy-from line ("Copied from AY2025 Term 2 · Secondary 1 Science. Week dates and school events are from the AY2026 calendar.");
- each week shows its calendar events read-only in the edit drawer;
- surplus weeks are flagged "Extra week from last year — merge it into another week or delete it".

- [ ] **Step 1:** Invoke `frontend-design:frontend-design`, and read `09-design-system.md` §6 and `09a` §7–9.
- [ ] **Step 2:** Write the copy test. Expect FAIL.
- [ ] **Step 3:** Build the screens, using the Task 5–7 interfaces.
- [ ] **Step 4:** Run the test (PASS). On the local stack, screenshot boards 1–4 with Playwright and compare them against the mockup yourself, then fix any differences.
- [ ] **Step 5: Commit.** `feat(sow): my schemes of work, new SOW, SOW page and week editing`

---

## Phase 3 — Approval

**Gate:** tests pass, and on the local stack one SOW goes teacher → subject head → OIC → Asst P → AEB → approved, while a second is returned and resent and restarts at step 1. Set up the steps in `/sis/admin/approvers` with seeded accounts. Reviewer approves.

### Task 9: Send, decide, return, reopen

**Files:**

- Create:
  - `lib/sow/approval.ts`
  - `lib/sow/approval-handler.ts`
  - `app/api/sow/[sowId]/submit/route.ts`
  - `app/api/sow/[sowId]/reopen/route.ts`
- Modify:
  - `lib/approvals/decide.ts`: register `[SOW_SUBJECT_TYPE]: sowApprovalHandler` in `SUBJECT_HANDLERS`, and add a `SUBJECT_PRECHECKS` entry refusing the filer.
  - `lib/schemas/approval-flows.ts` (`DecideApprovalSchema`): allow an optional `weekNumber` on a reject, for the SOW subject only.
  - The audit files: add `sow.submit`, `sow.vet`, `sow.approve`, `sow.return`, `sow.reopen`.
- Test: `__tests__/sow/approval.test.ts`

**Interfaces — Produces:**

```ts
export const SOW_SUBJECT_TYPE = 'scheme_of_work_submission';
export async function submitSow(service, actor, sowId: string): Promise<{ ok: true; submissionId: string; requestId: string; stalled: boolean } | { ok: false; status: 403 | 409 | 422; error: string }>;
export const sowApprovalHandler: SubjectHandler;
export async function reopenSow(service, actor, sowId: string, note: string): Promise<…>;
```

**`submitSow`:**

- **422** "Every week needs a topic before it can be sent." when any term week's topic is empty.
- Inserts a submission row.
- Calls `openApprovalRequest` with:
  - `flow: SOW_APPROVAL_FLOW`
  - `subjectType: SOW_SUBJECT_TYPE`
  - `subjectId: submission.id`
  - `sectionId: null`
  - `levelType` from the level
  - `subjectHeadPool: subjectHeadPool(...)`
  - `excludeUserIds: [actor.id]` (Review Focus #3)
- Sets the state to `in_review` and `current_submission_id`.
- `no_stages_configured` → **422** "Approval steps for schemes of work haven't been set up yet. Ask an SIS administrator." The submission is cancelled and the SOW stays a draft.

**Handler:**

- **On an approve that leaves a next step:** audit `sow.vet` and nothing else.
- **On the final approve:**
  - `state = 'approved'`, `approved_at`;
  - `approved_snapshot` = `{ module, weeks }`, copied from the working rows;
  - submission `outcome = 'approved'`;
  - audit `sow.approve`.
- **On a reject:** `state = 'returned'`, submission `outcome = 'returned'`, `return_note`, `return_week_number`, audit `sow.return`.
- The approver's message is "Vetted — it's gone to {next step label}." / "Approved." / "Returned to the teacher."

**`reopenSow`** (coordinator, school_admin, superadmin only):

- Sets the state to `draft` and keeps `approved_snapshot`.
- Requires a note.
- Audits `sow.reopen`.

- [ ] **Step 1: Write the failing tests:**
  - `sending opens a request whose subject is the submission`.
  - `a resend after a return opens a NEW request at step 1`: two submissions give two requests, and the second has `current_stage_order` 1.
  - Review Focus #3: `the teacher who sent it is never on a pool`.
  - `the last approve freezes the snapshot and marks it approved`.
  - `a return records the note and the week`.
  - `sending with an empty topic is a 422`.
  - `no steps configured leaves it a draft with the plain sentence`.
  - `reopen keeps the approved snapshot`.
  - `a teacher cannot reopen`: 403.
- [ ] **Step 2–4:** FAIL, implement, PASS. Then run `__tests__/approvals/` again (PASS).
- [ ] **Step 5: Commit.** `feat(sow): send for review, vet, approve, return and reopen`

### Task 10: Screens — review states, approver view, "Waiting for you"

**Files:**

- Modify:
  - `components/sow/sow-page.tsx`: the in-review, approver, returned and approved states (boards 5–8). Reuse `ApprovalStepRail` (`components/approvals/approval-step-rail.tsx`) with the labels Teacher · Subject head · OIC · Asst Principal · AEB as configured.
  - `lib/home/todos.ts`: add a SOW row, "Review {n} schemes of work" → `/classroom/sow/review`.
  - `lib/sidebar/notification-counts.ts`: count the SOW flow.
- Create:
  - `app/(classroom)/classroom/sow/review/page.tsx`: the "Waiting for you" list, one row per SOW waiting on the viewer, using `listInboxStagesAcrossFlows` with `flows: [SOW_APPROVAL_FLOW]`.
  - `components/sow/return-sow-dialog.tsx`: the note (required, ≤300) and an optional week select. It is a dialog because it has 1–2 fields.
- Test: `__tests__/sow/review-queue.test.ts`. It checks that the queue lists only steps the viewer is on, and that a step drops off once decided.

Approving goes through the existing `POST /api/approvals/[requestId]/decide`. The returned state shows the note pinned to its week (board 6). The approver's primary button reads "Vet" on non-final steps and "Approve" on the last.

- [ ] **Step 1:** Invoke frontend-design. **Step 2:** write the test (FAIL). **Step 3:** build. **Step 4:** test (PASS), then screenshot boards 5–8 locally and compare.
- [ ] **Step 5: Commit.** `feat(sow): review screens and the waiting-for-you queue`

---

## Phase 4 — Excel

**Gate:** importing a template workbook into a draft, and downloading it, round-trips the module details and every week's text. Reviewer approves.

### Task 11: One-time import

**Files:**

- Create:
  - `lib/sow/excel-import.ts`
  - `app/api/sow/import/route.ts` (POST multipart: preview, or create with `start: 'import'`)
  - `__tests__/sow/fixtures/build-template.ts`, which builds a synthetic workbook in the template's layout with `xlsx`. Christina's file is NOT committed.
- Modify:
  - `components/sow/new-sow-sheet.tsx`: add the third option "Import from Excel", with "Choose Excel file", a preview, and "Create draft".
  - The audit files: add `sow.import`.
- Test: `__tests__/sow/excel-import.test.ts`

**Interfaces — Produces:**

```ts
export type ParsedSow = {
  module: SowModule;
  weeks: {
    weekNumber: number;
    topic: string;
    learningOutcomes: string;
    textbookPages: string;
    activities: string;
    assessment: string;
    remarks: string;
  }[];
  warnings: string[];
};
export function parseSowWorkbook(
  buf: ArrayBuffer,
  levelLabel: string
): { ok: true; sow: ParsedSow } | { ok: false; error: string };
```

**Layout:**

- Before writing the parser, open `AY2026 Term 2 Science SOW Secondary.xlsx` at the repo root with `xlsx` in a scratch script, and record its header-cell labels and week-block columns in a comment at the top of the parser.
- The parser finds cells **by label text** ("Module Title", "Syllabus", "Week", "Topic", …), never by fixed coordinates.
- It picks the tab whose name matches the level ("Secondary 1" or "Sec 1").
- The "Monitoring Module Delivery" block is ignored.
- Imported text goes into rich-text fields as paragraphs.

- [ ] **Step 1: Write the failing tests** (against the built fixture):
  - `reads the header fields by label`.
  - `reads ten week blocks in order`.
  - `picks the tab for the chosen level`.
  - `a workbook with no matching tab is refused in a plain sentence`: "This file has no tab for Secondary 1."
  - `ignores the monitoring block`.
  - `extra weeks beyond the term come back as warnings`.
- [ ] **Step 2–4:** FAIL, implement, PASS. Then run the parser once against the real sample, and record in the commit body that it read all four tabs.
- [ ] **Step 5: Commit.** `feat(sow): one-time import from the school's Excel template`

### Task 12: Download Excel

**Files:**

- Create:
  - `lib/sow/excel-export.ts`
  - `app/api/sow/[sowId]/excel/route.ts` (GET; returns `.xlsx`)
- Test: `__tests__/sow/excel-export.test.ts`

**Interface:** `export function buildSowWorkbook(sow: SowForExport): ArrayBuffer`

The workbook has one tab named after the level, and uses the same labels the importer reads. The monitoring block is laid out but left empty. Rich text is flattened to plain lines.

- [ ] **Step 1: Write the failing test:** `export then import gives back the same module and weeks`, a round trip through `parseSowWorkbook`.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: Commit.** `feat(sow): download a scheme of work in the school's template`

---

## Phase 5 — During the term

**Gate:** on the local stack, with an approved SOW:

- two teachers check Week N;
- the seeded relief teacher records a note;
- the subject head signs.

The grid, the needs-a-look list and the teacher's Classroom home all show the right state. Screenshot boards 7, 10, 11, 13, 14 and 15 and compare them yourself. Reviewer approves.

### Task 13: Weekly check

**Files:**

- Create:
  - `lib/sow/checks.ts`
  - `app/api/sow/[sowId]/checks/route.ts` (POST)
- Modify:
  - `components/sow/sow-page.tsx`: the "How did Week N go?" block (approved state, board 7).
  - The audit files: add `sow.check`.
- Test: `__tests__/sow/checks.test.ts`

**Interfaces — Produces:**

```ts
export const CHECK_OPTIONS = ['as_planned', 'adjusted', 'delayed', 'extra'] as const;
export const CHECK_LABELS: Record<CheckOption, string>; // 'As planned' | 'Adjusted' | 'Delayed' | 'Extra activities'
export const CHECK_NOTE_PROMPTS: Record<Exclude<CheckOption,'as_planned'>, string>; // 'What did you adjust?' | 'What was delayed, and why?' | 'What did you add?'
export async function recordCheck(service, actor, input: { sowId: string; weekNumber: number; sectionId: string; option: CheckOption; note: string | null }): Promise<…>;
export type CellMark = 'ok' | 'note' | 'missed' | 'todo';
export function cellMark(input: { teacherIds: string[]; latestChecks: { teacherUserId: string; option: CheckOption }[]; weekEnded: boolean }): CellMark;
```

**`recordCheck` refuses** with these statuses:

- **422** when there is no note on a non-`as_planned` option;
- **423** when the SOW is not approved ("This scheme of work isn't approved yet, so weeks can't be checked.");
- **423** when that week is already signed for that class;
- **403** when the caller is not a substantive subject or co-teacher on that class;
- **422** when the week has not started yet.

**`cellMark`:**

- `note` if any teacher's latest check is not `as_planned`;
- else `ok` if every teacher checked;
- else `missed` if the week has ended;
- else `todo`.

- [ ] **Step 1: Write the failing tests:**
  - `a note is required unless as planned`.
  - `cannot check before approval`.
  - `cannot change a check once the week is signed`.
  - `a later check replaces an earlier one`.
  - `cellMark: one of two teachers checked mid-week is todo`.
  - `cellMark: both as planned is ok`.
  - `cellMark: one delayed is note`.
  - `cellMark: week over and one missing is missed`.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: Commit.** `feat(sow): weekly check per class`

### Task 14: Relief teacher's lesson page and note

**Files:**

- Create:
  - `lib/sow/relief.ts`
  - `app/(classroom)/classroom/sow/covering/[sectionId]/[subjectId]/page.tsx` (boards 13–14)
  - `app/api/sow/relief-notes/route.ts` (POST)
- Modify:
  - `components/relief/upcoming-cover.tsx`: add a "See today's lesson" link per live subject cover.
  - The audit files: add `sow.relief_note`.
- Test: `__tests__/sow/relief.test.ts`

**Interfaces — Produces:**

```ts
export async function loadCoveringLesson(service, userId: string, sectionId: string, subjectId: string, today?: string):
  Promise<{ ok: true; lesson: { sow: { id: string; label: string } | null; week: SowWeekView | null; events: string[]; lastWeek: { weekNumber: number; mark: CellMark; notes: string[] } | null; myNoteToday: string | null } } | { ok: false; status: 403; error: string }>;
export async function saveReliefNote(service, actor, input: { sectionId: string; subjectId: string; note: string; today?: string }): Promise<…>;
```

**Which content it reads:** always the **approved snapshot**, never the working copy. A SOW being revised therefore still shows the last approved plan (spec §4.4).

**When there is no approved SOW:** the page says "There's no approved scheme of work for this class yet." and the note box still works (board 14).

**Saving the note:**

- Saving again the same day replaces that day's note.
- After saving, the page says "Saved to Week {n}." (board 13).

- [ ] **Step 1: Write the failing tests:**
  - `a live relief teacher sees this week's lesson from the approved snapshot`.
  - `a SOW being revised still shows the approved plan`.
  - `last week's notes are shown`.
  - `with no approved SOW the note still saves`.
  - Review Focus #5: `a cover window that ended yesterday is refused` with a 403 and "Your cover for this class has ended.".
  - `a second note the same day replaces the first`.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: Commit.** `feat(sow): relief teacher sees this week's lesson and records what was covered`

### Task 15: Oversight and sign-off

**Files:**

- Create:
  - `lib/sow/oversight.ts`
  - `app/(classroom)/classroom/sow/oversight/page.tsx`, with tabs "SOWs" and "Weekly checks" (boards 9–10)
  - `components/sow/checks-grid.tsx`
  - `components/sow/sign-week-sheet.tsx` (board 11)
  - `app/api/sow/[sowId]/signoffs/route.ts` (POST)
- Modify:
  - `lib/auth/roles.ts`: a nav item "Scheme of work oversight", shown to office roles. For teachers it shows when they are a subject head or on a SOW step; resolve this the same way the Discipline nav does with `requiresRoles`, plus a server check on the page.
  - The audit files: add `sow.sign`, `sow.ask`.
- Test: `__tests__/sow/oversight.test.ts`

**Interfaces — Produces:**

```ts
export type OversightScope = { all: true } | { all: false; subjectIds: string[]; levelTypes: ('primary'|'secondary')[] };
export async function resolveOversightScope(service, userId: string, role: Role): Promise<OversightScope | null>; // null = no access
export function needsALook(rows: GridRow[], currentWeek: number): NeedsALookItem[];
export async function recordSignoff(service, actor, input: { sowId: string; weekNumber: number; sectionId: string; kind: 'signed' | 'asked'; remarks: string }): Promise<…>;
```

**Scope:**

- **Office roles:** `all`.
- **Subject heads:** their subjects, both halves unless scoped to one.
- **Anyone on a named step of the SOW flow:** every subject, limited to their `applies_to_level_type`, or everything when that is null.
- **Anyone else:** null, which means a 403 page.

**Only subject heads of that SOW's subject may sign or ask.** Everyone else gets 403 "Only the subject head signs off weeks." `asked` requires remarks.

**`needsALook`** returns:

- weeks whose cell is `note`;
- weeks whose cell is `missed`;
- a class with `note` on two weeks in a row.

Each item uses the copy from board 10.

- [ ] **Step 1: Write the failing tests:**
  - `an office role sees everything`.
  - `a subject head sees only their subject`.
  - `an OIC scoped to secondary sees secondary only`.
  - `a teacher with no role in it gets no access`.
  - `needsALook lists a note, a missed week, and two adjusted weeks in a row`.
  - `only the subject head can sign`.
  - `asking needs remarks`.
  - `a signed week shows underlined` (the grid row carries `signed: true`).
- [ ] **Step 2–4:** FAIL. Invoke frontend-design before the UI. Implement, then PASS.
- [ ] **Step 5: Commit.** `feat(sow): oversight grid, needs-a-look, and supervisor sign-off`

### Task 16: Teacher's Classroom home

**Files:**

- Create:
  - `lib/sow/home.ts`
  - `components/sow/this-week-lessons.tsx`
  - `components/sow/sow-todos.tsx`
- Modify: `app/(classroom)/classroom/page.tsx` — render both above `ClassroomListTable` for teachers only (board 15). The existing class list is unchanged.
- Test: `__tests__/sow/home.test.ts`

**Interface:** `export async function loadSowHome(service, userId: string, today?: string): Promise<{ lessons: LessonRow[]; todos: TodoRow[] }>`

**What the two lists show:**

- **Lessons:** one per class × subject the teacher teaches. Each shows its topic from the approved snapshot, or "SOW in review, no lessons to show yet" / "SOW returned by the subject head". Each also shows a status: "Check due Fri", "Relief {weekday}", "In review" or "Returned".
- **To-dos:** "Fix and resend {subject level} SOW", "Check Week {n} for {subject level} ({k} classes)", and "Start the {subject level track} SOW", ordered in that sequence.

- [ ] **Step 1: Write the failing tests:**
  - `lists a lesson per class with this week's topic`.
  - `a returned SOW is the first to-do`.
  - `an unchecked week is a to-do until every class is checked`.
  - `a not-started SOW is a to-do`.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: Commit.** `feat(sow): this week's lessons and SOW to-dos on Classroom home`

---

## Phase 6 — Grading warning, documentation, walk-through

**Gate:**

- the full `npx vitest run --pool=threads` passes, re-running any failures in isolation before calling them regressions;
- `npx tsc --noEmit` and `npm run lint` are clean;
- the Playwright walk-through passes on the local stack;
- the whole-branch review is done.

### Task 17: Grading-sheet warning

**Files:**

- Modify:
  - `app/api/grading-sheets/bulk-create/route.ts`: after creating sheets, add `sowMissing: { sectionName, subjectName }[]` to the response.
  - The bulk-create client component that calls it: show a non-blocking warning, "These classes have no approved scheme of work for this term: …".
- Create: `lib/sow/missing.ts`, with `listClassesWithoutApprovedSow(service, termId, pairs: { sectionId: string; subjectId: string }[])`.
- Test: `__tests__/sow/missing.test.ts`. It checks that sheets are still created when a SOW is missing, and that the list names only the classes missing one.

- [ ] **Steps 1–5:** failing test, FAIL, implement, PASS, commit `feat(sow): warn when grading sheets are made for a class with no approved SOW`.

### Task 18: Documentation, and the end-to-end walk-through

**Files:**

- Create:
  - `e2e/sow/sow.local.spec.ts`: one serial walk on the local stack. Teacher creates (blank) → edits Week 1 → sends → subject head vets → OIC → Asst P → AEB approves → teacher checks Week 1 for both classes → relief teacher records a note → subject head signs. It uses `localDb()` from `e2e/parent-portal/local-db.ts` for setup only: approval steps, subject head, and the current-term dates. It undoes its own setup afterwards.
  - `docs/context/25-sow-module.md`: the module, its tables, routes, rules, and what's deliberately out.
- Modify:
  - `docs/key-decisions/markbook-sow.md`: add **KD #234**, the SOW module rebuilt with a reader. Point the banner at it, and keep the history.
  - `.claude/rules/key-decisions.md`: add KD #234 to the topic table and the quick lookup. ⚠ **This needs Mr Ace's explicit approval** — ask when reporting the phase done, and don't edit it before then.
  - `package.json`: add the script `"e2e:sow": "playwright test e2e/sow/sow.local.spec.ts"`.
  - `docs/sprints/development-plan.md`: one status line.
- [ ] **Step 1:** Write the e2e spec.
- [ ] **Step 2:** Run `npm run e2e:sow` with `next dev` on the local stack. Expect PASS, with screenshots in `e2e/.results`.
- [ ] **Step 3:** Write the docs.
- [ ] **Step 4: Commit.** `test(e2e): scheme of work end to end` + `docs(sow): module context and KD #234`.

---

## After the plan (not tasks — Mr Ace decides)

- Apply migration 198 to production before deploying, and push.
- Set the subject heads and the SOW approval steps in production SIS Admin.
- Tell teachers which term starts it.
