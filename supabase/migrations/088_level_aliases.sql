-- 088_level_aliases.sql
--
-- class-assignment.ts::pickSectionForApplicant resolves an applicant's
-- level by looking up `application.levelApplied` (free text carried on the
-- admissions tables, KD #53) against `public.levels.label`. The only
-- normalization is `canonicalizeLevelLabel` (lib/sis/levels.ts) — a fixed
-- 10-entry digit-form -> word-form map. Anything else fails the lookup
-- outright, and the student's classLevel/classSection never get written —
-- exactly the gap `/records/unsynced` (KD #90) already detects, so these
-- students become one-off manual fixes with no institutional memory of
-- what the raw string meant.
--
-- Real source: HFSE's parent-portal admissions layer carries a parallel
-- "HFSE Global Education Programme" (GEP) naming track alongside the plain
-- Primary/Secondary names, confirmed against the portal's own
-- GRADE_PROGRESSIONS map. This table is the durable, staff-editable memory
-- that makes a portal naming change (which happens periodically) cost one
-- registrar click instead of a code deploy.
--
-- Idempotent + safe to re-run (ON CONFLICT DO NOTHING on the seed inserts).
-- Apply after 087.

create table if not exists public.level_aliases (
  id uuid primary key default gen_random_uuid(),
  raw_label text not null,
  level_id uuid not null references public.levels(id) on delete cascade,
  created_by uuid null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint level_aliases_raw_label_unique unique (raw_label)
);

comment on table public.level_aliases is
  'Staff-editable memory mapping an observed admissions levelApplied string to a canonical public.levels row. Populated via /records/level-mismatches. See docs/superpowers/specs/2026-07-18-admissions-level-alias-reconciliation-design.md.';

-- Seed the known GEP-track variants against the current levels catalog.
-- The 7 preschool/K2-equivalent values ("Youngstarters | ...", "GEP -
-- Year 1 (equivalent to K2)") are deliberately NOT seeded — no SIS level
-- exists for them (migration 086 removed preschool levels entirely; real
-- data confirmed HFSE never operationally used them). They will correctly
-- keep surfacing in the reconciliation queue as unresolved until a future,
-- separate project re-adds preschool-tier levels.
do $$
declare
  v_p1 uuid; v_p2 uuid; v_p3 uuid; v_p4 uuid; v_p5 uuid; v_p6 uuid;
  v_s1 uuid; v_s2 uuid; v_s3 uuid;
begin
  select id into v_p1 from public.levels where label = 'Primary One';
  select id into v_p2 from public.levels where label = 'Primary Two';
  select id into v_p3 from public.levels where label = 'Primary Three';
  select id into v_p4 from public.levels where label = 'Primary Four';
  select id into v_p5 from public.levels where label = 'Primary Five';
  select id into v_p6 from public.levels where label = 'Primary Six';
  select id into v_s1 from public.levels where label = 'Secondary One';
  select id into v_s2 from public.levels where label = 'Secondary Two';
  select id into v_s3 from public.levels where label = 'Secondary Three';

  if v_p1 is null or v_p2 is null or v_p3 is null or v_p4 is null
     or v_p5 is null or v_p6 is null or v_s1 is null or v_s2 is null
     or v_s3 is null then
    raise exception 'level_aliases seed: one or more canonical levels missing from public.levels — check migration 086 landed correctly before re-running this seed.';
  end if;

  insert into public.level_aliases (raw_label, level_id) values
    ('HFSE Global Education Programme – Year 2 (equivalent to Primary One)', v_p1),
    ('HFSE Global Education Programme - Primary 2', v_p2),
    ('HFSE Global Education Programme - Primary 3', v_p3),
    ('HFSE Global Education Programme - Primary 4', v_p4),
    ('HFSE Global Education Programme - Primary 5', v_p5),
    ('HFSE Global Education Programme - Primary 6', v_p6),
    ('HFSE Global Education Programme – Year 8', v_s1),
    ('HFSE Global Education Programme – Year 9', v_s2),
    ('HFSE Global Education Programme – Year 10', v_s3)
  on conflict (raw_label) do nothing;
end $$;
