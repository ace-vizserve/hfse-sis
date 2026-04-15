-- 009_change_requests.sql
--
-- Sprint 9 — Locked-sheet Change Request Workflow.
--
-- Replaces the informal email-based approval flow for post-lock grade edits
-- with a structured request/approve/apply state machine. Hard Rule #5 is
-- preserved: every post-lock edit still writes `approval_reference` to
-- `grade_audit_log`, but the server now derives that string from either an
-- approved request (Path A) or a structured data-entry correction reason
-- (Path B) — clients no longer type free-text approval strings.
--
-- State machine:
--   pending → approved → applied   (happy path)
--   pending → rejected             (terminal)
--   pending → cancelled            (teacher withdraws own request)
--
-- Roles:
--   teachers  — INSERT (own only) + SELECT (own only) + UPDATE (cancel own pending)
--   admin+    — SELECT (all) + UPDATE (approve/reject)
--   registrar — SELECT (all) + UPDATE (applied transition only, via API route)
--
-- Mutations are always performed by the service-role client in API routes;
-- these RLS policies are defense-in-depth for the cookie-bound client.

create table if not exists public.grade_change_requests (
  id                  uuid primary key default gen_random_uuid(),

  -- Target of the requested change
  grading_sheet_id    uuid not null references public.grading_sheets(id) on delete cascade,
  grade_entry_id      uuid not null references public.grade_entries(id) on delete cascade,
  field_changed       text not null check (field_changed in (
                        'ww_scores','pt_scores','qa_score','letter_grade','is_na'
                      )),
  -- Only used when field_changed is ww_scores or pt_scores; identifies which
  -- slot in the array. Null otherwise.
  slot_index          int,

  -- Snapshotted values (stringified so one column covers all field shapes)
  current_value       text,
  proposed_value      text not null,

  -- Why
  reason_category     text not null check (reason_category in (
                        'regrading','data_entry_error','late_submission','academic_appeal','other'
                      )),
  justification       text not null check (char_length(justification) >= 20),

  -- Lifecycle
  status              text not null default 'pending' check (status in (
                        'pending','approved','rejected','applied','cancelled'
                      )),

  requested_by        uuid not null,          -- auth.users.id of the teacher
  requested_by_email  text not null,          -- cached at write time for display
  requested_at        timestamptz not null default now(),

  reviewed_by         uuid,                    -- admin's auth.users.id
  reviewed_by_email   text,
  reviewed_at         timestamptz,
  decision_note       text,                    -- optional on approve, required on reject

  applied_by          uuid,                    -- registrar's auth.users.id
  applied_at          timestamptz,

  -- Slot index sanity: only ww_scores/pt_scores carry a slot.
  constraint grade_change_requests_slot_shape check (
    (field_changed in ('ww_scores','pt_scores') and slot_index is not null and slot_index >= 0)
    or
    (field_changed not in ('ww_scores','pt_scores') and slot_index is null)
  )
);

create index if not exists grade_change_requests_sheet_status_idx
  on public.grade_change_requests (grading_sheet_id, status);
create index if not exists grade_change_requests_requested_by_idx
  on public.grade_change_requests (requested_by);
create index if not exists grade_change_requests_reviewed_at_idx
  on public.grade_change_requests (reviewed_at desc);
create index if not exists grade_change_requests_status_idx
  on public.grade_change_requests (status);

alter table public.grade_change_requests enable row level security;

drop policy if exists grade_change_requests_read on public.grade_change_requests;
drop policy if exists grade_change_requests_no_insert on public.grade_change_requests;
drop policy if exists grade_change_requests_no_update on public.grade_change_requests;
drop policy if exists grade_change_requests_no_delete on public.grade_change_requests;

-- SELECT: any authenticated user with a valid role. API-layer filters narrow
-- teachers to their own rows via query params (`?mine=1`).
create policy grade_change_requests_read
  on public.grade_change_requests for select
  to authenticated
  using (public.current_user_role() is not null);

-- Writes: deny-all on the authenticated (cookie-bound) client. Every mutation
-- goes through the service-role client in API routes, which bypasses RLS.
create policy grade_change_requests_no_insert
  on public.grade_change_requests for insert
  to authenticated
  with check (false);

create policy grade_change_requests_no_update
  on public.grade_change_requests for update
  to authenticated
  using (false) with check (false);

create policy grade_change_requests_no_delete
  on public.grade_change_requests for delete
  to authenticated
  using (false);
