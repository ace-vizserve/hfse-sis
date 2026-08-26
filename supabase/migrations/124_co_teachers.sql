-- 124_co_teachers.sql
--
-- Adds `co_adviser` and `co_teacher` to `teacher_assignments.role`.
--
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- HFSE shares a subject between two teachers across different days of the
-- week, and shares a form class between two advisers. Mr Hanafi's AY2026
-- deployment workbook does it in five places:
--
--   Sec 3 Consistency   Humanities   Ms Elaine Tue+Fri · Ms Carl Wed
--   Sec 4 Excellence    Humanities   Ms Elaine Wed+Thu · Ms Carl Thu+Fri
--   P2 Humility         STAR         Ms Jing Mon-Wed+Fri · Mr Hanafi Thu
--   P4 Diligence        STAR         Ms Jing Thu · Mr Hanafi Fri
--   Sec 4 Excellence    ADVISER      "Ms Med & Ms Elaine"
--
-- ⚠ THE WORKBOOK IS NOT WRONG. This is ordinary timetabling, corroborated by
-- all three of its views (class-major, teacher-major and the per-teacher
-- sheets agree). What could not express it was OUR schema.
--
-- Migration 118 allowed exactly one `subject_teacher` per (section, subject),
-- and 003 exactly one `form_adviser` per section. Both rules are RIGHT and
-- both survive untouched here: a grading sheet has one owner and a report card
-- prints one adviser (KD #158). The gap was that the SECOND teacher had
-- nowhere to exist at all, so importing the deployment meant discarding a
-- teacher who really does stand in front of that class.
--
-- ── THE SHAPE ──────────────────────────────────────────────────────────────
--
--   form_adviser     one per section          owns adviser comments, prints
--                                             on the report card
--   co_adviser       any number per section
--   subject_teacher  one per (section,subject) owns the grading sheet
--   co_teacher       any number per (section,subject)
--
-- The two existing unique indexes are NOT modified. The co roles sit outside
-- them by construction, which is why this needs no backfill: every existing
-- row keeps its role and its meaning.
--
-- ── WHY NOT AN ARRAY OF TEACHER IDS ────────────────────────────────────────
--
-- It was considered and rejected (Mr Ace + Claude, 2026-08-26). Three things
-- break. `relief_teacher_user_id` and the cover dates (117/123) are PER ROW,
-- so an array has nowhere to record "Ms Carl is covering Ms Elaine next week"
-- and would need a parallel array that drifts. Every RLS helper matches a row,
-- so arrays mean rewriting the layer where a mistake shows one class another
-- class's marks. And an array does not answer the question 118 was written
-- for — whose name is on the sheet — it only moves it.
--
-- ── ACCESS ─────────────────────────────────────────────────────────────────
--
-- A co role gets the SAME access as its primary: Ms Carl teaches Humanities on
-- Wednesday and has to be able to record it.
--
-- ⚠ Consequence, accepted deliberately: two people can now edit one grading
-- sheet, and `grade_entries` carries no per-teacher attribution. `audit_log`
-- has the actor, so who did what is recoverable, but the sheet itself will not
-- show it.

-- ── 1. The role vocabulary ─────────────────────────────────────────────────
-- 003 declared the check inline, so it carries Postgres's generated name.
alter table public.teacher_assignments
  drop constraint if exists teacher_assignments_role_check;

alter table public.teacher_assignments
  add constraint teacher_assignments_role_check check (
    role in ('form_adviser', 'co_adviser', 'subject_teacher', 'co_teacher')
  );

-- ── 2. Adviser rows carry no subject; teacher rows must ────────────────────
alter table public.teacher_assignments
  drop constraint if exists teacher_assignments_role_subject_shape;

alter table public.teacher_assignments
  add constraint teacher_assignments_role_subject_shape check (
    (role in ('form_adviser', 'co_adviser') and subject_id is null)
    or
    (role in ('subject_teacher', 'co_teacher') and subject_id is not null)
  );

-- ── 3. One person cannot hold a class twice ────────────────────────────────
--
-- Each index spans the primary AND co role on purpose. That makes it do two
-- jobs at once: it stops the same co-teacher being added twice, and it stops
-- somebody being both the teacher of record and a co-teacher of the same
-- sheet — a contradiction that would otherwise be perfectly insertable.
--
-- ⚠ These do NOT constrain how many co rows a class has, only that a given
-- PERSON appears once. The "one primary" rule stays where it already lives,
-- in teacher_assignments_form_adviser_unique and
-- teacher_assignments_one_subject_teacher_per_class, both untouched.
create unique index if not exists teacher_assignments_person_once_per_sheet
  on public.teacher_assignments (teacher_user_id, section_id, subject_id)
  where role in ('subject_teacher', 'co_teacher');

create unique index if not exists teacher_assignments_person_once_as_adviser
  on public.teacher_assignments (teacher_user_id, section_id)
  where role in ('form_adviser', 'co_adviser');

comment on index public.teacher_assignments_person_once_per_sheet is
  'One person holds a given (section, subject) once — whether as the teacher of record or as a co-teacher, never both.';
comment on index public.teacher_assignments_person_once_as_adviser is
  'One person advises a given section once — whether as form adviser or co-adviser, never both.';

-- ── 4. RLS — a co role sees exactly what its primary sees ──────────────────
--
-- `is_teacher_for_section` is unchanged and is not repeated here: it already
-- ignores `role` entirely, so co rows are covered by it as written.
--
-- Both functions below are otherwise byte-for-byte as migration 123 left them,
-- including the relief arm and its window. ⚠ `relief_is_live` stays on every
-- arm — a co-teacher's cover is windowed exactly like a primary's.

-- Form adviser OR co-adviser of the section — held or covered. Gates
-- attendance_records and attendance_daily; a co-adviser takes the register too.
create or replace function public.is_adviser_for_section(p_section_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.teacher_assignments ta
    where ta.section_id = p_section_id
      and ta.role in ('form_adviser', 'co_adviser')
      and (ta.teacher_user_id = auth.uid()
           or (ta.relief_teacher_user_id = auth.uid()
               and public.relief_is_live(ta.relief_started_on, ta.relief_ended_on)))
  );
$$;

-- The sheet's subject teacher or co-teacher, or the section's adviser or
-- co-adviser — held or covered. Gates grading_sheets and grade_entries.
create or replace function public.is_teacher_for_sheet(p_sheet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.grading_sheets gs
    join public.teacher_assignments ta
      on ta.section_id = gs.section_id
     and (
       ta.role in ('form_adviser', 'co_adviser')
       or (ta.role in ('subject_teacher', 'co_teacher')
           and ta.subject_id = gs.subject_id)
     )
     and (ta.teacher_user_id = auth.uid()
          or (ta.relief_teacher_user_id = auth.uid()
              and public.relief_is_live(ta.relief_started_on, ta.relief_ended_on)))
    where gs.id = p_sheet_id
  );
$$;

-- `teacher_assignments_scoped_read` is deliberately NOT re-created: it tests
-- teacher_user_id and relief_teacher_user_id only, never `role`, so it already
-- covers the new rows. Its un-windowed relief arm stays as 123 explains.

comment on column public.teacher_assignments.role is
  'form_adviser (one per section, prints on the report card) · co_adviser · subject_teacher (one per section+subject, owns the grading sheet) · co_teacher. Co roles carry the same access as their primary; see migration 124.';
