-- HFSE Markbook — seed data
-- Contents: AY2026, 10 levels, 18 subjects, AY2026 sections,
-- AY2026 terms (T1–T4), subject_configs (weights per subject), and
-- subject_level_offerings (which levels each subject is taught at).
-- Idempotent: safe to re-run.

-- ---------- Academic year ----------
insert into public.academic_years (ay_code, label, is_current) values
  ('AY2026', 'Academic Year 2026', true)
on conflict (ay_code) do nothing;

-- ---------- Levels ----------
-- sort_order + is_core are NOT NULL as of migration 078 (Levels & Grade
-- Progression) — sort_order has no column default, so a fresh install that
-- omitted it here would 400 on this insert. is_core marks the permanent
-- P1-P6/S1-S4 band (mirrors migration 078's backfill).
insert into public.levels (code, label, level_type, sort_order, is_core) values
  ('YS-L', 'Youngstarters | Little Stars',     'preschool',   1, false),
  ('YS-J', 'Youngstarters | Junior Stars',     'preschool',   2, false),
  ('YS-S', 'Youngstarters | Senior Stars',     'preschool',   3, false),
  ('P1',   'Primary One',                       'primary',    4, true),
  ('P2',   'Primary Two',                       'primary',    5, true),
  ('P3',   'Primary Three',                     'primary',    6, true),
  ('P4',   'Primary Four',                      'primary',    7, true),
  ('P5',   'Primary Five',                      'primary',    8, true),
  ('P6',   'Primary Six',                       'primary',    9, true),
  ('S1',   'Secondary One',                     'secondary', 10, true),
  ('S2',   'Secondary Two',                     'secondary', 11, true),
  ('S3',   'Secondary Three',                   'secondary', 12, true),
  ('S4',   'Secondary Four',                    'secondary', 13, true),
  ('CS1',  'Cambridge Secondary One (Year 8)',  'secondary', 14, false),
  ('CS2',  'Cambridge Secondary Two (Year 9)',  'secondary', 15, false)
on conflict (code) do nothing;

-- Seed the progression chain (mirrors migration 078's chain seed exactly).
-- On a fresh install this is the only place next_level_id gets populated;
-- on the shared/already-migrated project the insert above is a no-op
-- (on conflict) and every row's next_level_id is already set by 078, so
-- the `next_level_id is null` guard makes this safely idempotent either way.
with chain(code, next_code) as (
  values ('YS-L','YS-J'),('YS-J','YS-S'),('YS-S','P1'),
         ('P1','P2'),('P2','P3'),('P3','P4'),('P4','P5'),('P5','P6'),('P6','S1'),
         ('S1','S2'),('S2','S3'),('S3','S4'),
         ('CS1','CS2')
)
update public.levels l
set next_level_id = n.id
from chain c
join public.levels n on n.code = c.next_code
where l.code = c.code and l.next_level_id is null;

-- ---------- Subjects — Primary ----------
-- Music / Arts / PE / Health / Christian Living are non-examinable per
-- HFSE's canonical grading spec — letter graded only, never numeric.
-- See KD #95 + migration 049.
insert into public.subjects (code, name, is_examinable) values
  ('ENG',   'English',                true),
  ('MATH',  'Mathematics',            true),
  ('MT',    'Mother Tongue',          true),
  ('SCI',   'Science',                true),
  ('SS',    'Social Studies',         true),
  ('MUSIC', 'Music Education',        false),
  ('ARTS',  'Arts Education',         false),
  ('PE',    'Physical Education',     false),
  ('HE',    'Health Education',       false),
  ('CL',    'Christian Living',       false)
on conflict (code) do nothing;

-- ---------- Subjects — Secondary ----------
-- Contemporary Art / PE+Health / Pastoral / CCA are non-examinable.
insert into public.subjects (code, name, is_examinable) values
  ('HIST', 'History',                                  true),
  ('LIT',  'Literature',                               true),
  ('HUM',  'Humanities',                               true),
  ('ECON', 'Economics',                                true),
  ('CA',   'Contemporary Art',                         false),
  ('PEH',  'Physical Education and Health',            false),
  ('PMPD', 'Pastoral Ministry and Personal Development', false),
  ('CCA',  'Co-curricular Activities',                 false)
on conflict (code) do nothing;

-- ---------- Subject report map (self-map) ----------
-- Migration 080 seeds a 1:1 self-map for every subject that exists AT
-- MIGRATION-RUN TIME — on a fresh install, seed.sql runs after migrations,
-- so the 18 subjects inserted just above never got a row. Re-affirm here
-- (idempotent no-op on an already-migrated project, since every subject
-- there already has its self-map from 080).
insert into public.subject_report_map (subject_id, report_subject_id)
select id, id from public.subjects
on conflict (subject_id, report_subject_id) do nothing;

-- ---------- Sections (AY2026) ----------
-- Source: docs/context/03-workflow-and-roles.md
-- Canonical spellings (sync normalizes admissions typos like "Courageos" → "Courageous").
insert into public.sections (academic_year_id, level_id, name)
select ay.id, lv.id, sec.name
from (values
  ('P1', 'Patience'),
  ('P1', 'Obedience'),
  ('P2', 'Honesty'),
  ('P2', 'Humility'),
  ('P3', 'Courtesy'),
  ('P3', 'Courageous'),
  ('P3', 'Responsibility'),
  ('P4', 'Diligence'),
  ('P4', 'Trust'),
  ('P5', 'Commitment'),
  ('P5', 'Perseverance'),
  ('P5', 'Tenacity'),
  ('P6', 'Grit'),
  ('P6', 'Loyalty'),
  ('S1', 'Discipline 1'),
  ('S1', 'Discipline 2'),
  ('S2', 'Integrity 1'),
  ('S2', 'Integrity 2'),
  ('S3', 'Consistency'),
  ('S4', 'Excellence')
) as sec(level_code, name)
join public.levels lv on lv.code = sec.level_code
cross join public.academic_years ay
where ay.ay_code = 'AY2026'
on conflict (academic_year_id, level_id, name) do nothing;

-- ---------- Terms (AY2026) ----------
-- Dates intentionally left null for now — registrar can backfill.
-- Term 1 marked is_current so the grading UI has a default selection.
insert into public.terms (academic_year_id, term_number, label, is_current)
select ay.id, t.n, 'Term ' || t.n || ' — AY2026', (t.n = 1)
from public.academic_years ay
cross join (values (1), (2), (3), (4)) as t(n)
where ay.ay_code = 'AY2026'
on conflict (academic_year_id, term_number) do nothing;

-- ---------- Subject configs (AY2026) ----------
-- Migration 080 collapsed subject_configs off the level dimension — weight
-- is a property of the subject, not the level, since every subject in this
-- seed is taught exclusively at one tier (the primary/secondary code lists
-- below are disjoint), so this is a like-for-like re-expression of the
-- original level_type-keyed case, not a new decision.
-- Primary-taught subjects (all 10): 40 / 40 / 20
-- Secondary-taught subjects (all 8): 30 / 50 / 20
-- Non-examinable subjects (CL, PMPD, CCA) still get a row for schema completeness,
-- but the grade entry UI uses the letter-grade path and skips the weights.
insert into public.subject_configs (
  academic_year_id, subject_id, ww_weight, pt_weight, qa_weight
)
select ay.id, sub.id,
       case when sub.code in ('ENG','MATH','MT','SCI','SS','MUSIC','ARTS','PE','HE','CL')
         then 0.40 else 0.30 end,
       case when sub.code in ('ENG','MATH','MT','SCI','SS','MUSIC','ARTS','PE','HE','CL')
         then 0.40 else 0.50 end,
       0.20
from public.academic_years ay
cross join public.subjects sub
where ay.ay_code = 'AY2026'
  and sub.code in (
    'ENG','MATH','MT','SCI','SS','MUSIC','ARTS','PE','HE','CL',
    'HIST','LIT','HUM','ECON','CA','PEH','PMPD','CCA'
  )
on conflict (academic_year_id, subject_id) do nothing;

-- ---------- Subject level offerings (AY2026) ----------
-- Migration 080's new source of truth for "which levels teach this
-- subject" — the level dimension weight config used to carry before the
-- collapse above. Same primary/secondary partition as the weights.
insert into public.subject_level_offerings (
  subject_id, level_id, academic_year_id
)
select sub.id, lv.id, ay.id
from public.academic_years ay
cross join public.subjects sub
cross join public.levels lv
where ay.ay_code = 'AY2026'
  and (
    (lv.level_type = 'primary'
      and sub.code in ('ENG','MATH','MT','SCI','SS','MUSIC','ARTS','PE','HE','CL'))
    or
    (lv.level_type = 'secondary'
      and sub.code in ('HIST','LIT','HUM','ECON','CA','PEH','PMPD','CCA'))
  )
on conflict (subject_id, level_id, academic_year_id) do nothing;
