-- Post-apply sanity check for migration 099 (read-only, safe to re-run).
--
-- 099 re-emitted create_ay_admissions_tables to add one line. The risk it
-- carries is the KD #119 hazard: a re-emit that silently drops clauses added by
-- later migrations. That is exactly how the doc-revision trigger went missing
-- for five migrations (050 -> 076). Check (a) is the real test — it asserts the
-- LIVE definition still contains every marker 087 established, so a dropped
-- clause shows up as a 'MISSING' row rather than as a bug months from now.

-- (a) The live function: new line present, nothing 087 established dropped.
with def as (
  select pg_get_functiondef(p.oid) as src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'create_ay_admissions_tables'
),
marker(what, needle) as (values
  ('099 NEW: discount-code index wired', 'attach_discount_code_unique'),
  ('087: doc-revision trigger',          'attach_doc_revision_trigger'),
  ('087: status-touch trigger',          'attach_enrolment_status_touch_trigger'),
  ('026: stpApplicationType',            'stpApplicationType'),
  ('069: stpApplicationStatus',          'stpApplicationStatus'),
  ('076: preferredPaymentScheme',        'preferredPaymentScheme'),
  ('076: preferredPaymentMethod',        'preferredPaymentMethod'),
  ('076: marketingReferrerName',         'marketingReferrerName'),
  ('067: applicationTerminalReason',     'applicationTerminalReason'),
  ('067: applicationTerminalNotes',      'applicationTerminalNotes'),
  ('075: write-once enrolledAt',         'enrolledAt'),
  ('all 4 tables: discount_codes',       '_discount_codes'),
  ('all 4 tables: documents',            '_enrolment_documents'),
  ('RLS enabled',                        'enable row level security')
)
select
  marker.what,
  case when def.src like '%' || marker.needle || '%'
       then 'ok' else 'MISSING <-- investigate' end as status
from marker cross join def
order by marker.what;
-- Expect 14 rows, all 'ok'. Any MISSING means the re-emit dropped something.

-- (b) Every existing AY's discount_codes table carries the unique index.
-- 098 created these; 099 must not have disturbed them.
select
  ay.ay_code,
  'ay' || substring(ay.ay_code from 3) || '_discount_codes' as tbl,
  case
    when to_regclass('public.ay' || substring(ay.ay_code from 3) || '_discount_codes') is null
      then 'table absent'
    when exists (
      select 1 from pg_indexes i
      where i.schemaname = 'public'
        and i.tablename = 'ay' || substring(ay.ay_code from 3) || '_discount_codes'
        and i.indexname = 'ay' || substring(ay.ay_code from 3) || '_discount_codes_code_unique'
    ) then 'ok'
    else 'INDEX MISSING <-- run attach_discount_code_unique for this AY'
  end as status
from public.academic_years ay
order by ay.ay_code;
-- Expect one 'ok' per AY that has admissions tables.

-- (c) The helper's comment no longer tells the reader to call it by hand.
select obj_description(p.oid, 'pg_proc') as helper_comment
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'attach_discount_code_unique';
-- Expect the text mentioning "Called automatically by create_ay_admissions_tables
-- since migration 099", NOT the old "must be called for each new AY".

-- (d) Execute grants survived the re-emit (a re-emit preserves them, but the
-- migration restates them, so confirm the restatement did not widen access).
select
  p.proname,
  coalesce(array_to_string(p.proacl, ' | '), '(default: PUBLIC)') as acl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('create_ay_admissions_tables', 'attach_discount_code_unique');
-- Expect service_role=X and NO 'authenticated' or bare '=X' (PUBLIC) entry.
