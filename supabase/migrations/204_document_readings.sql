-- 204_document_readings.sql
--
-- What the parent portal found about a file a parent uploaded, for the admin
-- reviewing it: for a passport what its OCR check read, and for any document how
-- good the scan is.
--
-- Keyed by the file's URL rather than by student and academic year, because a
-- wizard upload happens before its application row exists. The review screens
-- already hold the URL of the file on screen, so a replaced file can never show
-- the old file's reading.
--
-- First write wins, and there are no UPDATE or DELETE paths: a re-upload is a
-- new URL and so a new row. Hard Rule #6's spirit, since a reading is evidence.
--
-- `passports` holds only check-digit-verified values, one entry per passport in
-- the file (some uploads hold both parents'):
--   [{ "expiry": "2030-11-14" | null, "number": "P1234567A" | null }]
--
-- Writers: service-role only (POST /api/parent/v2/document-readings).
-- Readers: service-role only (the review screens' server loaders).
--
-- Apply after 203.

create table if not exists public.document_readings (
  file_url        text primary key,
  -- 'not_read': not a document the check reads, so only `quality` is filled.
  status          text not null check (status in ('read', 'unreadable', 'timed_out', 'failed', 'not_read')),
  passports       jsonb not null default '[]'::jsonb,
  -- Plain measurements, or null if they couldn't be taken. The wording lives in
  -- lib/admissions/document-reading-view.ts.
  quality         jsonb,
  entered_number  text,
  entered_expiry  date,
  submitted_by    uuid not null,
  created_at      timestamptz not null default now()
);

alter table public.document_readings enable row level security;

drop policy if exists document_readings_no_select on public.document_readings;
drop policy if exists document_readings_no_insert on public.document_readings;
drop policy if exists document_readings_no_update on public.document_readings;
drop policy if exists document_readings_no_delete on public.document_readings;

create policy document_readings_no_select
  on public.document_readings for select
  to authenticated
  using (false);

create policy document_readings_no_insert
  on public.document_readings for insert
  to authenticated
  with check (false);

create policy document_readings_no_update
  on public.document_readings for update
  to authenticated
  using (false) with check (false);

create policy document_readings_no_delete
  on public.document_readings for delete
  to authenticated
  using (false);
