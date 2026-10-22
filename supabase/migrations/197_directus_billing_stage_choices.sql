-- 197_directus_billing_stage_choices.sql
--
-- Directus still works the same ay{YYYY}_* tables as the SIS, so its
-- dropdowns must offer what the SIS stores. Migration 195 moved Registration
-- and Fees to the Billing statuses (BILLING_STAGE_STATUSES, lib/schemas/sis.ts);
-- Directus' dropdowns still offered the old words (Pending / Unpaid / Finished,
-- Pending / Invoiced / Re-invoiced / Paid), so a converted row showed no
-- option there and picking one put an old word back.
--
-- This rewrites the choices of `registrationStatus` and `feeStatus` on every
-- ay{YYYY}_enrolment_status collection Directus knows about. Every other
-- option on those fields (placeholder, …) is kept. No data changes.
--
-- Run with 195. Directus caches its field settings: clear its cache (or
-- restart it) once after this runs.
--
-- Does nothing where Directus is not installed (the local stack). Idempotent.

do $$
begin
  if to_regclass('public.directus_fields') is null then
    return;
  end if;

  update public.directus_fields
     set options = (
           coalesce(options::jsonb, '{}'::jsonb)
           || jsonb_build_object('choices', (
                select jsonb_agg(jsonb_build_object('text', s, 'value', s) order by n)
                  from unnest(array[
                    'Ready for invoicing',
                    'Unpaid',
                    'Partially paid',
                    'Overdue',
                    'Paid',
                    'Voided',
                    'Not required',
                    'Cancelled'
                  ]) with ordinality as c(s, n)
              ))
         )::json
   where collection ~ '^ay\d{4}_enrolment_status$'
     and field in ('registrationStatus', 'feeStatus');
end
$$;
