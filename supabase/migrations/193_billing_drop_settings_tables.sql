-- 193_billing_drop_settings_tables.sql
--
-- Billing keeps no setup of its own (KD #232 update, 2026-10-16 — Mr Ace:
-- "The setup still comes from QB, but the day-to-day operations are what we
-- capture in the SIS"). Billing → Settings is now the QuickBooks connection
-- only, and the four settings tables from 189 have nothing left to hold:
--
--   billing_account_map / billing_item_map — which tile an invoice fills is a
--     rule on the QuickBooks income account name (lib/billing/classify.ts
--     stageForAccount): Admissions & Registration → Registration, every
--     Enrolment Fees sub-account → Fees, everything else → nothing.
--   billing_year_ranges — an invoice's school year is the student's newest
--     application made on or before the invoice date + 7 days
--     (yearForInvoice); date ranges can't work, AY2026 and AY2027 invoices
--     overlap May–Jul 2026.
--   billing_deposit_accounts — Record payment offers QuickBooks' Bank
--     accounts, read live.
--
-- Nothing else references them (no view, function or policy; checked on the
-- local stack). After this runs, `scripts/qbo/billing-link.ts --reclassify
-- --apply` re-places stored invoices under the new rules.

drop table if exists public.billing_account_map;
drop table if exists public.billing_item_map;
drop table if exists public.billing_year_ranges;
drop table if exists public.billing_deposit_accounts;
