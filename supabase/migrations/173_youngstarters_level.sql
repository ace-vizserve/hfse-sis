-- 173_youngstarters_level.sql
--
-- Records the `Youngstarters` level in the migration chain, and fixes the
-- two things wrong with the copy that is already live.
--
-- ⚠ NUMBERED 173, NOT 172. CLAUDE.md reserves 172 for the realtime-publication
-- cleanup (dropping the entries added by 010/129/145), which is written but
-- deliberately not applied until a browser pass confirms a badge moves. This
-- migration is unrelated and must not jump the queue in front of it.
--
-- WHY THIS EXISTS. Migration 029 created three Youngstarters TIERS
-- (YS-L / YS-J / YS-S); migration 086 deleted all three after real grading and
-- attendance data confirmed HFSE never used them. Production nevertheless
-- holds a single `YS` / "Youngstarters" level today — id
-- 8746356e-d3e3-481a-add5-27b933196f46, created outside the migration chain
-- and outside `scripts/backfill/apply-youngstarters-ay2026.ts`, which READS
-- the level by code and fails if it is missing rather than creating it.
--
-- That gap is not cosmetic. `public.level_aliases` now holds six registrar-
-- saved rows pointing at this level_id (the Youngstarters naming variants
-- mapped on 2026-09-22 via /records/level-mismatches), and the AY2026
-- "Youngstarters" section references it too. A database rebuilt from the
-- migrations alone would have neither, so the aliases would point at nothing
-- and the backfill script would abort.
--
-- ⚠ level_type STAYS 'primary', WHICH IS WHAT THE LIVE ROW SAYS. Migration 029
-- widened the CHECK to accept 'preschool', so switching is possible — but
-- `level_type` is joined on directly by the subject registry (081/082) and
-- drives `levelTypeForAudienceLookup`, which decides which
-- `school_calendar.audience` rows an attendance register matches. Nothing in
-- the school's own records says which half Youngstarters should count as, so
-- this migration reproduces production rather than deciding for it.
--
-- Idempotent and safe to re-run.

begin;

-- 1. The level itself. `levels.code` is unique (migration 001), so a database
--    that already has the live row is untouched.
insert into public.levels (code, label, level_type, sort_order, is_core)
values ('YS', 'Youngstarters', 'primary', 3, false)
on conflict (code) do nothing;

-- 2. sort_order 3, not 4.
--
--    ⚠ THE LIVE ROW SAYS 4, WHICH IS PRIMARY ONE'S OWN NUMBER (migration 078
--    assigned P1..S4 = 4..13). `getLevelRows` orders by sort_order then code,
--    so the tie broke alphabetically and "Youngstarters" rendered BETWEEN
--    Primary One and Primary Two in every level list in the app — including
--    the "Maps to…" dropdown on /records/level-mismatches.
--
--    3 is both correct and free: 078 spent 1/2/3 on the three YS tiers that
--    migration 086 then deleted, so the preschool slot immediately ahead of
--    Primary One is empty and is exactly where this belongs.
update public.levels set sort_order = 3 where code = 'YS';

-- 3. Re-join the progression chain. 078 seeded YS-S→P1; when 086 deleted that
--    row the link went with it, and the replacement level was inserted with a
--    null `next_level_id`. Dormant today (KD #153 notes nothing reads it yet),
--    restored so the chain is not silently broken at its first link.
update public.levels l
set next_level_id = p1.id
from public.levels p1
where l.code = 'YS'
  and p1.code = 'P1'
  and l.next_level_id is null;

commit;
