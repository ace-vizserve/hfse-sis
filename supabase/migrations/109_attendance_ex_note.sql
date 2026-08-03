-- 109_attendance_ex_note.sql
--
-- Adds `attendance_daily.ex_note` — free text a teacher types when marking a
-- student excused ("Medical certificate submitted", "Mother called, dental
-- appointment").
--
-- WHY. Asked for directly at the 2026-07-31 academics training. Christina
-- wanted to attach the MC document itself; Melissa asked for a comment as the
-- interim ("if we're not able to upload the MC yet, can we at least put a
-- comment on why the student is not present"). The document upload needs its
-- own security design pass — the storage bucket is public-by-URL and its
-- policies are not in this repo — so the note ships first and stands on its
-- own regardless.
--
-- SHAPE. `ex_reason` (migrations 015/048/070) already captures the structured
-- subtype: mc | compassionate | vacation. That stays the thing quotas and
-- dashboards count. This column is the unstructured "why", and is deliberately
-- NOT another enum — the whole request was for something to type.
--
-- EX-ONLY, mirroring `attendance_daily_ex_reason_requires_ex_chk`. A note on a
-- Present mark has no meaning, and without the constraint a stale note could
-- ride along when a teacher switches EX -> P.
--
-- LENGTH CAP at 300. `section_students.academics_notes` (migration 093) caps
-- at 200 for a per-enrolment note; a per-day explanation wants a little more
-- room but must not become an essay field on a table with ~65k rows per year.
--
-- APPEND-ONLY, like every other column here. Editing a note means inserting a
-- new row that supersedes by `recorded_at desc` (the table's contract since
-- migration 014). Nothing is ever updated in place, so a superseded note text
-- survives in history — worth knowing given the content is medical-adjacent.
--
-- PRIVACY. This text is NOT written to `audit_log`. That table is readable by
-- every `is_registrar_or_above()` user — a wider audience than the mark itself
-- (attendance_daily is registrar+ OR the section's form adviser) — and its rows
-- can never be updated or deleted, so a note typed in error would be permanent
-- and unredactable. The audit trail records only that a note was attached or
-- changed. See app/api/attendance/daily/route.ts.
--
-- Safe to re-run.

alter table public.attendance_daily
  add column if not exists ex_note text;

-- Idempotent constraint add, matching the style of migration 015.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'attendance_daily_ex_note_requires_ex_chk'
      and conrelid = 'public.attendance_daily'::regclass
  ) then
    alter table public.attendance_daily drop constraint attendance_daily_ex_note_requires_ex_chk;
  end if;
end $$;

alter table public.attendance_daily
  add constraint attendance_daily_ex_note_requires_ex_chk
  check (ex_note is null or status = 'EX');

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'attendance_daily_ex_note_len_chk'
      and conrelid = 'public.attendance_daily'::regclass
  ) then
    alter table public.attendance_daily drop constraint attendance_daily_ex_note_len_chk;
  end if;
end $$;

alter table public.attendance_daily
  add constraint attendance_daily_ex_note_len_chk
  check (ex_note is null or char_length(ex_note) <= 300);

comment on column public.attendance_daily.ex_note is
  'Optional free-text explanation for an EX mark (e.g. "Medical certificate submitted"). Complements the structured ex_reason, which is what quotas and dashboards count. EX-only, max 300 chars. Never copied into audit_log — see the migration header for why.';
