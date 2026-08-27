-- 131_approval_request_own_work_read.sql
--
-- The other half of migration 129: a person may read the approval REQUEST
-- behind a step they can act on.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY THIS EXISTS: 129 OPENED ONE TABLE AND THE QUERY NEEDS TWO
--
-- Mr Ace, 2026-08-27: "i noticed declarations is not realtime in SIS."
--
-- 129 gave `approval_request_stages` a scoped SELECT policy so the browser
-- could count the steps waiting for the signed-in person. But the count hook
-- (`lib/sidebar/use-declaration-count.ts`) does not read that table alone — it
-- has to know which FLOW a step belongs to, and the flow lives on the parent:
--
--     .from('approval_request_stages')
--     .select('id, approval_requests!inner(flow, status)', { count: 'exact' })
--     .eq('status', 'pending')
--     .eq('approval_requests.flow', 'attendance.student_declaration')
--     .eq('approval_requests.status', 'pending')
--
-- `approval_requests` was left at 126's blanket `using (false)`, and 127, 128,
-- 129 and 130 never granted it back. Under RLS an INNER JOIN to a relation
-- that returns no rows drops every parent row, so the recount returns ZERO for
-- everybody with declaration work waiting.
--
-- ⚠ AND IT FAILS SILENTLY, WHICH IS WHY NOBODY SAW IT. 126 created a POLICY
-- but never revoked the table GRANT, so PostgREST does not raise `42501` — it
-- filters everything out and returns `{ count: 0, error: null }`. The hook's
-- "log it and freeze the badge" branch is gated on `error`, so it never fires.
-- The badge simply sets itself to 0 on the first realtime event, with nothing
-- in the console and nothing on screen. The server-rendered seed is correct,
-- which is what makes it look like "not realtime" rather than "wrong".
--
-- ⚠ ONLY THE DECLARATION HALF OF THE BELL WAS AFFECTED. An early note claimed
-- this would zero the count "for everybody, in every module" — it does not.
-- The grade-change hook joins `grading_sheets` and `sections`, which are
-- readable (005; `sections` has no RLS at all), so that half kept working. The
-- visible symptom was the badge dropping by exactly the declaration count
-- while the bell's dropdown — which is service-backed — still listed the rows.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY A POLICY RATHER THAN RESHAPING THE QUERY
--
-- The alternative was to denormalise `flow` onto `approval_request_stages` so
-- the browser never joins at all. Cheaper today, and rejected: it leaves the
-- browser unable to read ANYTHING about a request, which is exactly what the
-- notification feed will need next, and it adds a copied column that must be
-- kept in step with its parent forever.
--
-- ⚠ THIS DOES NOT UNDO WHAT 126 WAS PROTECTING. 126's stated concern is that
-- `approver_pool` is a list of who decides what and must not be enumerable.
-- That pool lives on `approval_request_stages`, which 129 already scoped to
-- "rows you are on". This admits a request row only when the reader is on one
-- of ITS OWN stages — so it exposes nothing that 129 did not already, and it
-- exposes it about the same rows.
--
-- ⚠ `approval_stages` and `approval_stage_approvers` STAY DENIED. They are the
-- configuration — who holds which post, for which half of the school — and
-- they remain service-role only. Only the two "as filed" tables are readable,
-- and only where you are involved.
--
-- ⚠ EVERY STATUS, NOT JUST `pending`, for exactly the reason 129 gives: a row
-- that leaves the reader's visibility at the instant it is decided means the
-- UPDATE never arrives and the badge goes stale showing work already done. The
-- COUNT narrows to pending; the POLICY does not.
--
-- Idempotent — safe to re-run.

-- ── 1. Replace the blanket SELECT denial on this ONE table ─────────────────

drop policy if exists approval_requests_no_select
  on public.approval_requests;

drop policy if exists approval_requests_own_work_select
  on public.approval_requests;

create policy approval_requests_own_work_select
  on public.approval_requests
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.approval_request_stages s
      where s.request_id = approval_requests.id
        and (
          -- A named step: the reader is one of the people it was frozen onto.
          auth.uid() = any (s.approver_pool)
          -- A derived step: the reader advises that class right now, which
          -- includes a co-adviser and anyone inside a live relief window. The
          -- same single definition 126 authorises against, so a person can
          -- never see a request they would then be refused on.
          or (
            s.section_id is not null
            and public.is_adviser_for_section(s.section_id)
          )
        )
    )
  );

comment on policy approval_requests_own_work_select on public.approval_requests is
  'A signed-in user may read an approval request only when they are on one of its own stages — named in that stage''s frozen pool, or the live adviser of that stage''s section. Mirrors 129''s policy on approval_request_stages, and exists because the browser count hook inner-joins this table: without it that join returns zero rows for everybody, silently, because 126 denies via policy rather than a revoked grant so PostgREST filters instead of raising 42501. Enumeration is still closed: you cannot list requests you are not part of, and the CONFIGURATION tables (approval_stages, approval_stage_approvers) remain denied outright.';

-- ── 2. The write denials from 126 are untouched ────────────────────────────
--
-- Recreated here only so a re-run of this file leaves the table in a fully
-- known state. `authenticated` writes nothing to this table under any
-- circumstance; every write goes through `approval_advance`, which is
-- service-role only (127).

drop policy if exists approval_requests_no_insert on public.approval_requests;
create policy approval_requests_no_insert
  on public.approval_requests for insert
  to authenticated with check (false);

drop policy if exists approval_requests_no_update on public.approval_requests;
create policy approval_requests_no_update
  on public.approval_requests for update
  to authenticated using (false) with check (false);

drop policy if exists approval_requests_no_delete on public.approval_requests;
create policy approval_requests_no_delete
  on public.approval_requests for delete
  to authenticated using (false);

-- ── 3. Realtime is NOT enabled on this table, deliberately ─────────────────
--
-- 129 added `approval_request_stages` to the `supabase_realtime` publication
-- and set `replica identity full`, because a step changing status IS the
-- moment work becomes somebody's job. Nothing on `approval_requests` changes
-- without a stage changing first, so publishing it too would deliver a second
-- event for every one that already arrives — the hook would recount twice per
-- decision for no new information. This table is joined, not watched.
