-- 195_registration_fees_statuses.sql
--
-- Registration and Fees follow only the invoices TIED to them (spec
-- docs/superpowers/specs/2026-10-21-registration-fees-from-billing-design.md).
-- DATA ONLY — no columns, policies or grants change. Two parts:
--
-- A. Every ay{YYYY}_enrolment_status table that exists, both stages:
--    1. "No fee" invoice text (Current student, None, NIL, N/A, No enrolment
--       fee, …) → status Not required, invoice cleared. A Cancelled stage
--       keeps Cancelled; only its invoice is cleared.
--    2. Status Finished / Paid → Paid; Unpaid / Invoiced / Re-invoiced →
--       Unpaid (corrected from QuickBooks once the invoice is tied);
--       Pending → Ready for invoicing. Cancelled and blank are unchanged.
--    3. An invoice holding ONE HFSE number plus other text (a name pasted
--       after it) → just the number. Two or more numbers: left as typed.
--    4. An invoice with no digits at all ("Done Invoicing", "Test"), a date
--       ("12-Mar-25") or TEST… → cleared; the status is kept.
--       YS…, INV-… and every other number stay as they are.
--    Remarks and payment dates are untouched; nothing is deleted. The 087
--    touch trigger is disabled for these updates (a data correction is not
--    staff working the stage) and re-enabled after, in the same transaction.
--    scripts/probe-195-preview.ts prints what each rule changes, per AY.
--
-- B. qbo_invoices: every stored invoice's stage placement came from the
--    retired income-account + year guess (KD #232 update 2026-10-16), not a
--    tie. All are cleared here; scripts/qbo/billing-link.ts --reclassify
--    --apply then ties each invoice whose number was typed on a stage.
--    Until then no invoice moves any stage.

do $$
declare
  t text;
  has_trigger boolean;
  st text;
  inv text;
  no_fee text[] := array[
    'current student', 'none', 'nil', 'n/a',
    'no enrolment fee', 'no enrollment fee', 'no registration fee',
    'not required'
  ];
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and tablename ~ '^ay\d{4}_enrolment_status$'
    order by tablename
  loop
    select exists (
      select 1 from pg_trigger
      where tgrelid = format('public.%I', t)::regclass
        and tgname = 'stamp_enrolment_status_touch_trigger'
        and not tgisinternal
    ) into has_trigger;
    if has_trigger then
      execute format(
        'alter table public.%I disable trigger stamp_enrolment_status_touch_trigger', t);
    end if;

    foreach st in array array['registrationStatus', 'feeStatus'] loop
      inv := case st when 'registrationStatus' then 'registrationInvoice'
                     else 'feeInvoice' end;

      -- 1. No fee.
      execute format($q$
        update public.%1$I
           set %3$I = null,
               %2$I = case when lower(btrim(coalesce(%2$I, ''))) = 'cancelled'
                           then %2$I else 'Not required' end
         where lower(btrim(%3$I)) = any($1)
      $q$, t, st, inv) using no_fee;

      -- 2. Status vocabulary.
      execute format($q$
        update public.%1$I
           set %2$I = m.new_status
          from (values ('finished', 'Paid'), ('paid', 'Paid'),
                       ('unpaid', 'Unpaid'), ('invoiced', 'Unpaid'),
                       ('re-invoiced', 'Unpaid'),
                       ('pending', 'Ready for invoicing')) as m(old_key, new_status)
         where lower(btrim(%1$I.%2$I)) = m.old_key
           and %1$I.%2$I is distinct from m.new_status
      $q$, t, st);

      -- 3. One HFSE number plus other text → the number.
      execute format($q$
        update public.%1$I
           set %2$I = substring(%2$I from '(?i)HFSE\d+')
         where %2$I ~* 'HFSE\d+'
           and %2$I !~* 'HFSE\d+.*HFSE\d+'
           and btrim(%2$I) !~* '^HFSE\d+$'
      $q$, t, inv);

      -- 4. No digits, a date, or TEST… → cleared.
      execute format($q$
        update public.%1$I
           set %2$I = null
         where btrim(coalesce(%2$I, '')) <> ''
           and (btrim(%2$I) !~ '\d'
                or btrim(%2$I) ~* '^TEST\d*$'
                or btrim(%2$I) ~ '^\d{1,2}-[A-Za-z]{3}-\d{2}(\d{2})?$')
      $q$, t, inv);
    end loop;

    if has_trigger then
      execute format(
        'alter table public.%I enable trigger stamp_enrolment_status_touch_trigger', t);
    end if;
  end loop;

  -- B. Clear the guessed placements (see header).
  if to_regclass('public.qbo_invoices') is not null then
    update public.qbo_invoices
       set ay_code = null, stage_keys = '{}'
     where ay_code is not null or stage_keys <> '{}';
  end if;
end
$$;
