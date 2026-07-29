-- 098_discount_code_unique.sql
--
-- Stops duplicate discount codes. `POST /api/sis/discount-codes` was a bare
-- `.insert()` with no unique constraint, no upsert, and no pre-check, so a
-- double-click on "Add discount code" created two identical rows with
-- different ids.
--
-- Verified before writing: `ay{YY}_discount_codes` (defined in
-- 012_ay_setup_helpers.sql and carried verbatim through 076/087) has only a
-- bigint identity primary key — no unique constraint on "discountCode" in any
-- migration. Pre-flight against production also confirmed zero existing
-- duplicates across AY2025 (0 codes), AY2026 (20) and AY2027 (10), so the index
-- applies cleanly with no de-duplication.
--
-- SCOPE — READ THIS BEFORE ASSUMING IT IS DONE
--
-- This heals every EXISTING AY table and ships the helper, but it does NOT add
-- the call to `create_ay_admissions_tables`, so an AY created AFTER this
-- migration will not get the index until that is wired up. That is deliberate,
-- not an oversight:
--
--   Adding it means re-emitting a ~280-line DDL-emitting function, and this
--   repo has documented proof that exact edit is dangerous. Migration 087's own
--   comment records that the doc-revision trigger was "silently dropped by
--   migration 050's re-emit and stayed dropped through 067/069/075/076" — a
--   five-migration regression caused by re-emitting this same function from a
--   stale body (KD #119).
--
--   Duplicate discount codes are the least severe problem in this whole
--   idempotency pass: admin-visible, trivially deleted, no data corruption, no
--   emails. Trading a five-migration-class regression risk for it is a bad
--   deal, so the risky half is left as its own focused change.
--
-- To finish it later, copy `create_ay_admissions_tables` VERBATIM from its
-- newest definition (migration 087, NOT 076) and add one line beside the other
-- attach helpers at the end:
--
--     perform public.attach_discount_code_unique(v_slug);
--
-- Apply after 097.

-- ─── The helper: idempotent, safe to call repeatedly ────────────────────────
create or replace function public.attach_discount_code_unique(p_ay_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table text := p_ay_slug || '_discount_codes';
begin
  if to_regclass(format('public.%I', v_table)) is null then
    return;  -- no such AY table; nothing to attach
  end if;

  -- Partial: NULL "discountCode" rows are left alone. The column is nullable
  -- and several existing rows could legitimately hold NULL; constraining them
  -- would be a behaviour change beyond this fix's remit.
  execute format(
    'create unique index if not exists %I on public.%I ("discountCode") where "discountCode" is not null',
    v_table || '_code_unique',
    v_table
  );
end;
$$;

comment on function public.attach_discount_code_unique(text) is
  'Add the unique index on ay{YY}_discount_codes("discountCode"). Idempotent. Must be called for each new AY until it is wired into create_ay_admissions_tables — see migration 098''s header for why that was deferred.';

-- ─── Heal every AY table that already exists ────────────────────────────────
do $$
declare
  v_ay record;
begin
  for v_ay in
    select 'ay' || substring(ay_code from 3) as slug
    from academic_years
  loop
    perform public.attach_discount_code_unique(v_ay.slug);
  end loop;
end;
$$;

revoke all on function public.attach_discount_code_unique(text) from public;
grant execute on function public.attach_discount_code_unique(text) to service_role;
