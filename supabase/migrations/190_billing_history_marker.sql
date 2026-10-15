-- 190_billing_history_marker.sql
--
-- When a linked student's whole QuickBooks history (every invoice and payment
-- of their customer) was last loaded to the end. The bulk link run loads every
-- linked student still without it, so a run that timed out part-way resumes
-- where it stopped; relinking a student clears it so the new customer's
-- history is loaded. Spec: docs/superpowers/specs/2026-10-15-billing-module-design.md
--
-- qbo_customers stays SERVER-ONLY (188): no policy or grant changes here.

alter table public.qbo_customers
  add column if not exists history_loaded_at timestamptz;
