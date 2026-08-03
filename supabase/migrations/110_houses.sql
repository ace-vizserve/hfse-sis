-- 110_houses.sql
--
-- Adds the house system: a small `houses` reference table + `students.house_id`.
--
-- WHY. Asked for by Chandana at the 2026-07-31 academics training: "every
-- student is allocated with a particular house colour... so that all the
-- awards, everything, they will also receive the house points."
--
-- A house is the Commonwealth grouping that cuts ACROSS year groups — P1
-- through S4 in the same house — which is the whole point of it: it gives a
-- student a community that is not their class, and older students a reason to
-- care about younger ones. HFSE's sections are already named after virtues
-- (Respect, Grit, Integrity), so a house is a genuinely second axis: a student
-- is "P1 Respect" AND a house.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY IT LIVES ON `public.students`
--
-- A student keeps the same house for their whole time at the school. That
-- continuity is the feature, not an implementation detail.
--
-- `public.students` is the ONLY cross-AY per-student row, and it already
-- carries two attributes added the same way (`urgent_compassionate_allowance`,
-- migration 015; `vacation_leave_allowance_per_term`, migration 048). Verified
-- against the AY machinery: `create_academic_year` and `delete_academic_year`
-- never touch this table, and the admissions->SIS sync updates named columns
-- only, so a house survives rollover for exactly the same structural reason
-- those two allowances already do.
--
-- The alternative — storing it on `ay{YYYY}_enrolment_applications` — would be
-- actively wrong: those tables are recreated per academic year (KD #53), so
-- every student's house would silently reset each August, which is the precise
-- opposite of what a house system is for.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY A TABLE AND NOT AN ENUM
--
-- The colour and the display name are data HFSE owns, not vocabulary the code
-- needs to branch on. A table lets the four rows be renamed without a
-- migration. `colour_token` stores a DESIGN TOKEN NAME (not a hex value) so
-- Hard Rule #7 holds — the tokens themselves live in app/globals.css.
--
-- NO CRUD PAGE, deliberately. KD #153 built exactly that for grade levels and
-- migration 086 deleted the whole thing because HFSE never used it. Four rows
-- are seeded here; a management page can follow if it is ever actually asked
-- for.
--
-- ⚠ THE SEEDED NAMES ARE PLACEHOLDERS. Chandana has not yet confirmed how many
-- houses HFSE runs, what they are called, or their colours. Renaming a row is
-- a one-line UPDATE; nothing in the code keys off the names.
--
-- Nullable on purpose: null = "not assigned yet", matching the posture of
-- `vacation_leave_allowance_per_term` rather than a NOT NULL default that
-- would silently claim every student is in House 1.
--
-- Safe to re-run.

create table if not exists public.houses (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  name         text not null,
  -- A design-token NAME (e.g. 'house-1'), resolved by the UI against
  -- app/globals.css. Never a hex value — Hard Rule #7.
  colour_token text not null,
  sort_order   smallint not null default 0,
  created_at   timestamptz not null default now()
);

insert into public.houses (code, name, colour_token, sort_order)
values
  ('H1', 'House 1', 'house-1', 1),
  ('H2', 'House 2', 'house-2', 2),
  ('H3', 'House 3', 'house-3', 3),
  ('H4', 'House 4', 'house-4', 4)
on conflict (code) do nothing;

alter table public.students
  add column if not exists house_id uuid references public.houses(id) on delete set null;

create index if not exists students_house_idx on public.students (house_id);

comment on column public.students.house_id is
  'The student''s house for their whole time at the school (Commonwealth house system). Lives here, on the cross-AY row, so it survives academic-year rollover — see the migration header. Null = not assigned yet.';

-- RLS. `houses` is reference data with no PII — same posture as `levels` and
-- `subjects`: readable by any signed-in user, writable only via service-role
-- routes (migration 004 denies writes to `authenticated` on every table).
--
-- `students.house_id` needs no policy of its own: it inherits
-- `students_scoped_read` (migration 005), which already admits registrar-and-
-- above OR a teacher of a section the student is in. So a form adviser can
-- read their own students' houses with no new permission work.
alter table public.houses enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'houses' and policyname = 'houses_read_all'
  ) then
    create policy houses_read_all on public.houses
      for select to authenticated using (true);
  end if;
end $$;
