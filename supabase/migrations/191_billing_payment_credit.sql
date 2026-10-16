-- 191_billing_payment_credit.sql
--
-- A payment's unapplied amount: what QuickBooks keeps as credit on the
-- customer when a payment is more than the invoices it pays, or pays none.
-- HFSE's QuickBooks has no "automatically apply credits" setting, so credit
-- waits until staff use it (Billing → Use credit). Copied from QuickBooks'
-- UnappliedAmt on every payment read; QuickBooks wins on money.
-- Spec: docs/superpowers/specs/2026-10-15-billing-module-design.md
--
-- qbo_payments stays SERVER-ONLY (189): no policy or grant changes here.

alter table public.qbo_payments
  add column if not exists unapplied numeric(12, 2) not null default 0;
