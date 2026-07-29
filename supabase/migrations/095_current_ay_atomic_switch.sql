-- 095_current_ay_atomic_switch.sql
--
-- Makes "which academic year is current" a single atomic operation, and adds a
-- DB-level guarantee that at most one AY can ever hold the flag.
--
-- THE BUG THIS FIXES
--
-- Switching the active AY was two separate, non-transactional updates in the
-- application layer (app/api/sis/ay-setup/route.ts and the duplicate in
-- lib/sis/environment.ts::flipIsCurrent): clear `is_current` on every row, then
-- set it on the target. The code comment claimed "not a single transaction, but
-- idempotent — re-running converges," which is true only for a run that
-- COMPLETES. If the second update failed, the request was interrupted, or the
-- function was frozen between the two statements, every row was left
-- `is_current = false`.
--
-- That state has no owner and no alarm. Nearly every operational query in the
-- app assumes exactly one current AY — app/api/sections/route.ts does
-- `.eq('is_current', true).single()`, which errors on zero rows — so sections,
-- grading, attendance, evaluation and every dashboard break at once, school
-- wide, until someone repairs it by hand in SQL.
--
-- Verified before writing this: there was no unique, partial-unique, or
-- exclusion constraint on `academic_years.is_current` anywhere in migrations
-- 001-094. Nothing prevented two current AYs either.
--
-- WHAT THIS ADDS
--
--   1. A partial unique index, so two current AYs are impossible at the DB.
--   2. `set_current_academic_year(text)` — clear + set + the accepting_
--      applications follow-ups, in ONE function body (= one transaction), so
--      there is no window in which zero AYs are current.
--
-- The index alone would not have fixed the bug (it prevents two, not zero); the
-- function alone would leave a future caller free to reintroduce the two-step
-- flip. Both are needed.
--
-- Pre-flight (run against production before applying): exactly one AY had
-- `is_current = true` (AY2026, with AY2025/AY2027 false), so the index applies
-- cleanly with no de-duplication needed.
--
-- Apply after 094.

-- ─── 1. At most one current AY, enforced by the database ────────────────────
--
-- Partial, so the many `false` rows don't collide — only `true` is constrained.
create unique index if not exists academic_years_single_current
  on public.academic_years (is_current)
  where is_current;

comment on index public.academic_years_single_current is
  'At most one academic_years row may have is_current = true. Does NOT prevent zero — that is what set_current_academic_year() is for.';

-- ─── 2. Atomic switch ───────────────────────────────────────────────────────
--
-- Mirrors exactly what the route did, minus the gaps between statements:
--   • clear is_current everywhere, set it on the target
--   • open the new current AY's application window
--   • close the outgoing AY's window — a correctness requirement, not a nicety
--     (KD #118: a retired year left accepting satisfies
--     `accepting_applications AND NOT is_current`, which is precisely how
--     getUpcomingAcademicYear() identifies the early-bird AY, so leaving it
--     open makes the outgoing year impersonate the upcoming one)
--
-- Ordering note: the clear MUST precede the set, or the partial unique index
-- above would reject the set while the old row still holds the flag. Both
-- statements are in one transaction, so no other session observes the moment
-- between them.
--
-- Returns the previous AY code (or null) so the caller can still audit the
-- transition and invalidate caches — the route needs that and previously
-- obtained it with its own separate SELECT.
create or replace function public.set_current_academic_year(p_ay_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_id  uuid;
  v_prev_code  text;
begin
  select id into v_target_id
  from academic_years
  where ay_code = p_ay_code;

  if v_target_id is null then
    raise exception 'Academic year % not found', p_ay_code
      using errcode = 'no_data_found';
  end if;

  -- Capture the outgoing AY before clearing, for the audit trail + window close.
  select ay_code into v_prev_code
  from academic_years
  where is_current
  limit 1;

  update academic_years set is_current = false where is_current;
  update academic_years set is_current = true  where id = v_target_id;

  -- The application window follows the active flag.
  update academic_years
     set accepting_applications = true
   where id = v_target_id;

  if v_prev_code is not null and v_prev_code <> p_ay_code then
    update academic_years
       set accepting_applications = false
     where ay_code = v_prev_code;
  end if;

  return jsonb_build_object(
    'target_ay',  p_ay_code,
    'target_id',  v_target_id,
    'previous_ay', v_prev_code,
    'accepting_opened', p_ay_code,
    'accepting_closed',
      case when v_prev_code is distinct from p_ay_code then v_prev_code else null end
  );
end;
$$;

comment on function public.set_current_academic_year(text) is
  'Atomically switch the current academic year (clear + set + application-window follow-ups) in one transaction. Replaces the two-step flip that could leave zero AYs current. Returns the previous ay_code for auditing.';

-- Callers are server-side only. Same grant shape as create_academic_year
-- (migration 090:217-218) and create_ay_admissions_tables (087:513-514):
-- revoke from public, then grant explicitly to service_role. The grant is NOT
-- optional — without it the revoke locks out the very client that calls this,
-- and AY switching would fail entirely. `authenticated` deliberately gets
-- nothing: this is a superadmin operation routed through a role-gated API.
revoke all on function public.set_current_academic_year(text) from public;
grant execute on function public.set_current_academic_year(text) to service_role;
