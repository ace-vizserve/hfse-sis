-- 112_assignment_reliefs.sql
--
-- Relief teachers — a substitute who works a class while its regular teacher
-- is away, until that teacher returns.
--
-- WHY A SEPARATE TABLE RATHER THAN A THIRD `teacher_assignments.role`.
-- A third role value is the obvious approach and it is unsafe on four counts:
--   * it fails BOTH checks on that table — `role in (...)` and
--     `teacher_assignments_role_subject_shape` (003:19, 003:36-40);
--   * both unique indexes there are `where role = '...'` partials (003:24-31),
--     so a third role would carry no uniqueness at all;
--   * lib/classroom/scope.ts branches on the two known values and a third
--     falls through both arms, yielding no capability — the relief would see
--     nothing;
--   * copy_teacher_assignments (017) copies `role` verbatim but hard-codes both
--     of its dedupe clauses to the two known values, so every AY rollover would
--     duplicate relief rows.
--
-- Layering instead of replacing also buys the product decision for free: the
-- REGULAR TEACHER STAYS THE NAME OF RECORD. Every "who owns this" in the app —
-- the report-card adviser (lib/report-card/build-report-card.ts), the sheet
-- teacher (lib/markbook/subject-teacher.ts), the masterfile adviser column,
-- publish readiness — is resolved live from `teacher_assignments` at render
-- time. Nothing is denormalized. So by never writing to that table, none of
-- those surfaces change, and a cover cannot retroactively rewrite an
-- already-published report card the way delete-and-reassign does today.
--
-- ACTIVE MEANS `ended_on is null`. Cover is open-ended by design: leave gets
-- extended, and a required end date would be wrong more often than right. It
-- is ended by a person when the teacher returns. The cost of that choice is a
-- forgotten cover running silently, which is why the UI phase surfaces
-- long-running ones rather than trusting anyone to remember.
--
-- `relief_teacher_user_id`, `created_by` and `ended_by` reference auth.users(id)
-- WITHOUT a declared cross-schema FK. Same convention as this table's own
-- parent, `teacher_assignments.teacher_user_id` (003:9-13), and as
-- `classroom_notes.teacher_user_id` (094:14-18): Supabase's managed auth
-- columns are not meant to be FK-pinned from app tables. Validity is enforced
-- by the service-role write routes, which only ever stamp ids they have just
-- verified. Account deletion is guarded separately by the hand-written registry
-- in lib/sis/user-deletion.ts, which this migration's columns are added to in
-- the same change — without that, deleting a covering teacher would leave a
-- dangling id here.
--
-- Idempotent — safe to re-run. NOT YET APPLIED to any database; the app code
-- that reads or writes this table must not deploy until it has been.

create table if not exists public.assignment_reliefs (
  id                      uuid primary key default gen_random_uuid(),
  assignment_id           uuid not null references public.teacher_assignments(id) on delete cascade,
  relief_teacher_user_id  uuid not null,
  started_on              date not null default current_date,
  ended_on                date,
  reason                  text not null check (reason in ('on_leave', 'medical', 'training', 'other')),
  notes                   text,
  created_by              uuid not null,
  created_at              timestamptz not null default now(),
  ended_by                uuid,
  ended_at                timestamptz,

  -- A cover cannot end before it started.
  constraint assignment_reliefs_end_after_start
    check (ended_on is null or ended_on >= started_on),

  -- The three ending columns move together or not at all. Without this an
  -- `ended_on` could be set while `ended_by` stayed null, leaving a cover that
  -- reads as finished with nobody accountable for finishing it.
  constraint assignment_reliefs_end_columns_agree
    check (
      (ended_on is null     and ended_by is null     and ended_at is null) or
      (ended_on is not null and ended_by is not null and ended_at is not null)
    )
);

comment on table public.assignment_reliefs is
  'A substitute teacher working a class while its regular teacher is away. Layered on top of teacher_assignments, never replacing it — the regular teacher remains the name of record on report cards, grading sheets and the masterfile for the whole cover. Active while ended_on is null.';
comment on column public.assignment_reliefs.assignment_id is
  'The teacher_assignments row being covered — either a form_adviser or a subject_teacher slot. Cascades on delete: if the underlying assignment goes, the cover of it is meaningless.';
comment on column public.assignment_reliefs.relief_teacher_user_id is
  'auth.users(id) of the substitute. No declared FK across schemas (see teacher_assignments, migration 003); lib/sis/user-deletion.ts blocks deleting an account that still appears here.';
comment on column public.assignment_reliefs.ended_on is
  'Null means the cover is still running. Set when the regular teacher returns; the relief loses access at that moment.';
comment on column public.assignment_reliefs.reason is
  'Why cover was needed. A closed list so the audit trail stays filterable rather than turning into prose — the same shape as the removal reasons in lib/schemas/teacher-assignment.ts. ''other'' requires a note, enforced in the Zod schema.';

-- One ACTIVE cover per assignment. Partial, so the same slot can be covered
-- again later — a teacher may be away twice in a year, and the earlier cover
-- stays on the record rather than being overwritten.
create unique index if not exists assignment_reliefs_one_active_per_assignment
  on public.assignment_reliefs (assignment_id)
  where ended_on is null;

-- "What am I covering?" — the relief teacher's own lookup, hit on every request
-- that resolves their effective access.
create index if not exists assignment_reliefs_relief_teacher_idx
  on public.assignment_reliefs (relief_teacher_user_id);

-- "Has this slot ever been covered?" — history, which the partial index above
-- deliberately does not serve.
create index if not exists assignment_reliefs_assignment_idx
  on public.assignment_reliefs (assignment_id);

alter table public.assignment_reliefs enable row level security;

-- Read: oversight roles, the substitute themselves, and the regular teacher
-- being covered. That last arm matters — a teacher coming back from leave
-- should be able to see who held their class and when, without needing an
-- admin to tell them.
drop policy if exists assignment_reliefs_scoped_read on public.assignment_reliefs;
create policy assignment_reliefs_scoped_read
  on public.assignment_reliefs for select
  to authenticated
  using (
    public.is_registrar_or_above()
    or relief_teacher_user_id = auth.uid()
    or exists (
      select 1
      from public.teacher_assignments ta
      where ta.id = assignment_reliefs.assignment_id
        and ta.teacher_user_id = auth.uid()
    )
  );

-- Writes are denied outright to `authenticated`, the same explicit-deny pattern
-- as classroom_notes (094) and section_subjects (079). The only writers are the
-- service-role routes under /api/assignment-reliefs, which gate on the
-- staff.manage_relief capability (school admin and above).
drop policy if exists assignment_reliefs_no_insert on public.assignment_reliefs;
create policy assignment_reliefs_no_insert
  on public.assignment_reliefs for insert to authenticated with check (false);

drop policy if exists assignment_reliefs_no_update on public.assignment_reliefs;
create policy assignment_reliefs_no_update
  on public.assignment_reliefs for update to authenticated
  using (false) with check (false);

drop policy if exists assignment_reliefs_no_delete on public.assignment_reliefs;
create policy assignment_reliefs_no_delete
  on public.assignment_reliefs for delete to authenticated using (false);
