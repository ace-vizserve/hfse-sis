-- 194_billing_payment_memo.sql
--
-- A payment's Memo (QuickBooks PrivateNote), copied on every payment read so
-- the Billing lists show it in the Memo column exactly as QuickBooks does.
-- qbo_payments stays SERVER-ONLY (189): no policy or grant changes here.

alter table public.qbo_payments
  add column if not exists private_note text;
