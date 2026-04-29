-- 034_pfile_outreach.sql
--
-- P-Files renewal lifecycle — append-only outreach log.
--
-- Two event kinds, one table:
--   kind='reminder' — registrar nudged the parent (Resend email). One row
--                     per recipient email actually sent. Powers the
--                     "Reminded N days ago" badge + 24h cooldown enforcement.
--   kind='promise'  — registrar recorded that the parent committed to
--                     re-uploading by `promised_until`. One row per
--                     promise. UI also flips `<slot>Status` to 'To follow'
--                     so it surfaces in the existing chase strip bucket.
--
-- Writers: service-role only (POST /api/p-files/[enroleeNumber]/notify,
--          POST /api/p-files/notify/bulk, PATCH /api/p-files/[enroleeNumber]/promise).
-- Readers: service-role only (the surface routes pull through a service
--          client and gate via requireRole(['p-file', 'superadmin']) at
--          the API layer).
--
-- Hard Rule #6 (append-only audit) applies. No UPDATE / DELETE paths.
--
-- Apply after 033.

create table if not exists public.p_file_outreach (
  id                  uuid primary key default gen_random_uuid(),
  ay_code             text not null,                                  -- e.g. 'AY2026'
  enrolee_number      text not null,                                  -- student key
  slot_key            text not null,                                  -- matches DOCUMENT_SLOTS keys
  kind                text not null check (kind in ('reminder', 'promise')),
  promised_until      date,                                           -- only for kind='promise'
  channel             text check (channel is null or channel in ('email')),
  recipient_email     text,                                           -- the email address actually sent to
  note                text,                                           -- optional registrar note
  created_at          timestamptz not null default now(),
  created_by_user_id  uuid references auth.users(id),
  created_by_email    text
);

-- Lookup used by both the cooldown check and the badge-rendering query.
create index if not exists p_file_outreach_lookup
  on public.p_file_outreach (ay_code, enrolee_number, slot_key, kind, created_at desc);

-- Roster-wide read for the dashboard's expiring view (will scan many
-- (enrolee, slot) tuples per call).
create index if not exists p_file_outreach_ay_lookup
  on public.p_file_outreach (ay_code, kind, created_at desc);

alter table public.p_file_outreach enable row level security;

drop policy if exists p_file_outreach_no_select on public.p_file_outreach;
drop policy if exists p_file_outreach_no_insert on public.p_file_outreach;
drop policy if exists p_file_outreach_no_update on public.p_file_outreach;
drop policy if exists p_file_outreach_no_delete on public.p_file_outreach;

create policy p_file_outreach_no_select
  on public.p_file_outreach for select
  to authenticated
  using (false);

create policy p_file_outreach_no_insert
  on public.p_file_outreach for insert
  to authenticated
  with check (false);

create policy p_file_outreach_no_update
  on public.p_file_outreach for update
  to authenticated
  using (false) with check (false);

create policy p_file_outreach_no_delete
  on public.p_file_outreach for delete
  to authenticated
  using (false);
