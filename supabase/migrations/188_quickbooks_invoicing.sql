-- 188_quickbooks_invoicing.sql
--
-- QuickBooks Online invoicing for the Registration and Fees stages.
-- Spec: docs/superpowers/specs/2026-10-14-quickbooks-registration-fees-invoicing-design.md
--
-- SERVER-ONLY TABLES. RLS is on with NO policies and anon/authenticated are
-- revoked, so only the service role (API routes) reads or writes them.
-- `qbo_connection` holds the QuickBooks login keys; it must never be readable
-- by a signed-in staff role. That is also why they are not in school_config,
-- which every signed-in role can read.
--
-- The stage columns on ay{YYYY}_enrolment_status (registrationInvoice,
-- feeInvoice, the payment dates, the statuses) stay the source the rest of the
-- SIS reads. These tables only remember which QuickBooks invoice belongs to
-- which stage, and what QuickBooks last said about it.
--
-- realm_id on qbo_customers / qbo_invoices: the QuickBooks company (realm) the
-- row came from. Customer and invoice ids only mean something inside one
-- company, so rows are read back only against the company connected now, and
-- connecting a different company is refused while invoices from another exist
-- (/api/quickbooks/callback).

create table if not exists public.qbo_connection (
  id smallint primary key default 1 check (id = 1),
  realm_id text not null,
  company_name text,
  environment text not null check (environment in ('sandbox', 'production')),
  refresh_token text not null,
  access_token text,
  access_token_expires_at timestamptz,
  connected_by uuid,
  connected_by_email text,
  connected_at timestamptz not null default now(),
  last_cdc_at timestamptz
);

create table if not exists public.qbo_customers (
  student_number text primary key,
  qbo_customer_id text not null,
  display_name text not null,
  matched_by text not null,
  matched_at timestamptz not null default now(),
  realm_id text not null
);

create table if not exists public.qbo_invoices (
  id uuid primary key default gen_random_uuid(),
  ay_code text not null,
  enrolee_number text not null,
  student_number text not null,
  stage_key text not null check (stage_key in ('registration', 'fees')),
  qbo_invoice_id text not null unique,
  doc_number text,
  total numeric(12, 2) not null default 0,
  balance numeric(12, 2) not null default 0,
  state text not null check (state in ('open', 'paid', 'voided')),
  is_current boolean not null default true,
  payment_date date,
  sync_token text,
  source text not null check (source in ('created', 'linked')),
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  realm_id text not null
);

-- One current invoice per stage per enrolee per year.
create unique index if not exists qbo_invoices_one_current
  on public.qbo_invoices (ay_code, enrolee_number, stage_key)
  where is_current;

create index if not exists qbo_invoices_stage
  on public.qbo_invoices (ay_code, enrolee_number, stage_key);

create table if not exists public.qbo_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('webhook', 'hourly', 'manual')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  invoices_updated integer not null default 0,
  error text
);

create index if not exists qbo_sync_runs_started
  on public.qbo_sync_runs (started_at desc);

alter table public.qbo_connection enable row level security;
alter table public.qbo_customers enable row level security;
alter table public.qbo_invoices enable row level security;
alter table public.qbo_sync_runs enable row level security;

revoke all on public.qbo_connection from anon, authenticated;
revoke all on public.qbo_customers from anon, authenticated;
revoke all on public.qbo_invoices from anon, authenticated;
revoke all on public.qbo_sync_runs from anon, authenticated;
