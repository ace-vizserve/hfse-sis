-- 192_billing_drop_tile_columns.sql
--
-- Billing Phase 5: the Registration / Fees tiles no longer attach invoices
-- themselves (the KD #231 tile routes are gone), so the columns only they
-- wrote go. Every invoice's year and tiles now come from the Billing mapping
-- (ay_code, stage_keys — migration 189). Spec:
-- docs/superpowers/specs/2026-10-15-billing-module-design.md
--
-- qbo_invoices stays SERVER-ONLY (188/189): no policy or grant changes here.

drop index if exists public.qbo_invoices_one_current;
drop index if exists public.qbo_invoices_stage;

alter table public.qbo_invoices
  drop column if exists is_current,
  drop column if exists enrolee_number,
  drop column if exists stage_key;
