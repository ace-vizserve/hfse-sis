-- 189_billing_module.sql
--
-- The Billing module: every invoice and payment of a linked QuickBooks
-- customer, plus the settings that put invoices on the Registration / Fees
-- tiles. Spec: docs/superpowers/specs/2026-10-15-billing-module-design.md
--
-- SERVER-ONLY, like 188: RLS on, no policies, anon/authenticated revoked.
-- These tables are a copy of what QuickBooks says; QuickBooks wins on money.

-- qbo_invoices widens from "invoices attached to a stage" to "every invoice of
-- a linked customer". ay_code / stage_keys are now the mapping's result.
-- enrolee_number / stage_key / is_current stay for the KD #231 tile routes
-- until Phase 5 removes them (migration 192 drops the columns).
alter table public.qbo_invoices alter column ay_code drop not null;
alter table public.qbo_invoices alter column enrolee_number drop not null;
alter table public.qbo_invoices alter column stage_key drop not null;
alter table public.qbo_invoices alter column is_current set default false;
alter table public.qbo_invoices drop constraint if exists qbo_invoices_source_check;
alter table public.qbo_invoices add constraint qbo_invoices_source_check
  check (source in ('created', 'linked', 'synced'));
alter table public.qbo_invoices
  add column if not exists qbo_customer_id text,
  add column if not exists txn_date date,
  add column if not exists due_date date,
  add column if not exists lines jsonb not null default '[]'::jsonb,
  add column if not exists memo text,
  add column if not exists private_note text,
  add column if not exists stage_keys text[] not null default '{}';

create index if not exists qbo_invoices_student
  on public.qbo_invoices (student_number, txn_date desc);
create index if not exists qbo_invoices_tile
  on public.qbo_invoices (student_number, ay_code);

create table if not exists public.qbo_payments (
  qbo_payment_id text primary key,
  qbo_customer_id text not null,
  student_number text not null,
  txn_date date,
  total numeric(12, 2) not null default 0,
  deposit_account_id text,
  deposit_account_name text,
  reference text,
  -- [{ "invoiceId": "123", "amount": 500 }]
  applied jsonb not null default '[]'::jsonb,
  created_by uuid,
  created_by_email text,
  synced_at timestamptz not null default now(),
  realm_id text not null
);
create index if not exists qbo_payments_student
  on public.qbo_payments (student_number, txn_date desc);

-- QuickBooks items with their income account, so an invoice line (which only
-- names the item) can be mapped by account.
create table if not exists public.qbo_items (
  qbo_item_id text primary key,
  name text not null,
  income_account_id text,
  income_account_name text,
  active boolean not null default true,
  synced_at timestamptz not null default now(),
  realm_id text not null
);

create table if not exists public.billing_account_map (
  qbo_account_id text primary key,
  account_name text not null,
  stage text not null check (stage in ('registration', 'fees', 'none'))
);

create table if not exists public.billing_item_map (
  qbo_item_id text primary key,
  item_name text not null,
  stage text not null check (stage in ('registration', 'fees', 'none'))
);

create table if not exists public.billing_year_ranges (
  ay_code text primary key check (ay_code ~ '^AY[0-9]{4}$'),
  starts_on date not null,
  ends_on date not null,
  check (ends_on >= starts_on)
);

create table if not exists public.billing_deposit_accounts (
  qbo_account_id text primary key,
  label text not null,
  sort smallint not null default 0
);

-- Students the link run could not place on its own, with what it found.
create table if not exists public.billing_link_review (
  student_number text primary key,
  student_name text not null,
  -- [{ "customerId": "58", "displayName": "OBIAS, Eon Mach N.", "reason": "same name" }]
  candidates jsonb not null default '[]'::jsonb,
  computed_at timestamptz not null default now()
);

alter table public.qbo_payments enable row level security;
alter table public.qbo_items enable row level security;
alter table public.billing_account_map enable row level security;
alter table public.billing_item_map enable row level security;
alter table public.billing_year_ranges enable row level security;
alter table public.billing_deposit_accounts enable row level security;
alter table public.billing_link_review enable row level security;

revoke all on public.qbo_payments from anon, authenticated;
revoke all on public.qbo_items from anon, authenticated;
revoke all on public.billing_account_map from anon, authenticated;
revoke all on public.billing_item_map from anon, authenticated;
revoke all on public.billing_year_ranges from anon, authenticated;
revoke all on public.billing_deposit_accounts from anon, authenticated;
revoke all on public.billing_link_review from anon, authenticated;
