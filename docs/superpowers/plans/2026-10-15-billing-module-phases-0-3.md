# Billing module — Phases 0–3 (sandbox, data, linking, mapping, sync) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything under the Billing screens: a sandbox shaped like HFSE's QuickBooks, the data model, linking students to customers, the tile mapping, and a sync that keeps every invoice and payment of a linked customer in step and fills the Registration / Fees stages from them.

**Architecture:** Pure rules in `lib/billing/*` (names, link proposals, invoice classification, stage-from-invoices) carry all the decisions and are unit-tested without QuickBooks or a database. Thin server modules (`lib/billing/*.server.ts`) read QuickBooks through the existing `lib/qbo/client.ts` door and write the new tables. Superadmin and billing-role API routes expose the actions; the screens come in the Phases 4–5 plan.

**Tech Stack:** Next.js 16 route handlers, Supabase (service role), zod 4, vitest (`--pool=threads`), the existing `lib/qbo/client.ts` (`qboRequest`, `qboQuery`, `qbEscape`, `connectedRealmId`).

**Spec:** `docs/superpowers/specs/2026-10-15-billing-module-design.md` (builds on KD #231, `docs/superpowers/specs/2026-10-14-quickbooks-registration-fees-invoicing-design.md`).

**Phases 4–5 (screens, read-only tiles) get their own plan**, written after a frontend-design pass and a mockup, because a plan's JSX is transcribed verbatim by subagents.

## Global Constraints

- **Local stack + QuickBooks sandbox only.** Migrations are applied with `npm run local:migrate`; nothing is applied to production; nothing is pushed.
- Migration number **189** (`supabase/migrations/189_billing_module.sql`). Migration 188 is already applied locally.
- New tables are server-only: `enable row level security`, no policies, `revoke all ... from anon, authenticated` (same as 188).
- Billing roles: `admissions`, `school_admin`, `superadmin` (reuse `QBO_INVOICE_ROLES` from `lib/qbo/roles.ts`). Settings and the bulk link run: `superadmin` (`QBO_ADMIN_ROLES`).
- QuickBooks wins on money. A stage the staff set to **Cancelled** is never changed by the sync.
- Sync stage writes go through `writeStageFromQbo` (`lib/qbo/stage-write.ts`) with actor `QBO_SYSTEM_ACTOR` and updated-by `QBO_SYNC_LABEL`.
- `studentNumber` is the only student key (Hard Rule #4). Customers whose DisplayName contains `:` (sub-customers, e.g. "Related Companies:…") are never matched to a student.
- New audit actions: `qbo.customer.link`, `qbo.payment.create` (Phase 4), `billing.link.run`, `billing.mapping.update`, `billing.years.update`, `billing.deposit_accounts.update`. Each goes in `ALL_AUDIT_ACTIONS` (`lib/audit/log-action.ts`), `ACTION_LABELS` + the context switch in `lib/audit/humanize.ts`, the admissions list in `app/(admissions)/admissions/audit-log/page.tsx`, and `billing.` joins the admissions prefixes in `lib/audit/modules.ts`.
- Plain-English copy for anything a person reads (error messages included); no "webhook", "CDC", "realm", "token".
- Tests: `npx vitest run --pool=threads <path>`; tests import `describe, expect, it` from `vitest` explicitly.
- Scripts that use `lib/qbo/client.ts` run as `npx tsx --conditions=react-server --env-file=.env.development.local scripts/...` (the `server-only` import needs the react-server condition).
- Edits via Edit/Write tools only. Commit as ONE command: `git add <paths> && git commit -m "..."`. Never `git add -A` (concurrent sessions share this tree). End commit messages with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Never put a Windows backslash path in a repo doc (Tailwind scans `docs/`).

## Review Focus

1. **A student's typed invoice numbers point at a sibling's customer** (staff typed the sibling's number) — the student must link to the customer whose name matches, never to the sibling. Test: Task 1.2 "sibling number" case.
2. **Two QuickBooks customers for one child** ("OBIAS, Eon Mach N." and "OBIAS, Eon Mach N. (potsie.obias@gmail.com)") with no typed number — must go to review with both candidates, never auto-link. Test: Task 1.2 "duplicate customer" case.
3. **A returning student's AY2026 Fees invoice must not land on the AY2027 Fees tile** — the year comes from the invoice date and the ranges, and an invoice outside every range sits on no tile. Test: Task 2.1 "outside every range" + "previous year" cases.
4. **A paid Fees invoice is reopened (payment deleted in QuickBooks)** — the stage goes back from Paid to Invoiced / Re-invoiced and the payment date clears, with no stored "current invoice" to go stale. Test: Task 3.1 "reopened" case.
5. **The only Registration invoice is voided** — Registration goes back to Pending with the number and payment date cleared; a voided invoice is never counted as an invoice on the tile. Test: Task 3.1 "voided only" case.

---

## Phase 0 — A sandbox shaped like HFSE

Gate: the seed script runs twice in a row with the second run creating nothing; the listing at the end matches the shapes in the spec ("What HFSE's QuickBooks looks like"); review pass on the diff.

### Task 0.1: Seed the sandbox and the local stages

**Files:**

- Create: `scripts/qbo/seed-sandbox-hfse.ts`

**Interfaces:**

- Consumes: `qboRequest`, `qboQuery`, `qbEscape` from `lib/qbo/client.ts`; `createServiceClient` from `lib/supabase/service.ts`. The SIS must already be connected to the sandbox (SIS Admin → QuickBooks → Connect), so `qbo_connection` holds a sandbox row.
- Produces (in the sandbox): income accounts, deposit accounts `UOB`, `PayNow`, `Credit/Debit Card`, HFSE-shaped items, one customer per local AY2026/AY2027 student, invoices `HFSE0xxxxx` and payments. In the local DB: typed `registrationInvoice` / `feeInvoice` on some AY2027 stages.

- [ ] **Step 1: Write the script**

```ts
/**
 * Makes the QuickBooks SANDBOX look like HFSE's production company (shapes,
 * not data — every name comes from the local stack's fake people).
 * Spec: docs/superpowers/specs/2026-10-15-billing-module-design.md, "Sandbox mirror".
 *
 *   npx tsx --conditions=react-server --env-file=.env.development.local scripts/qbo/seed-sandbox-hfse.ts
 *
 * Idempotent: everything is found by name / DocNumber first. Refuses to run
 * unless the SIS is connected to a SANDBOX company and Supabase is localhost.
 */
import { qbEscape, qboQuery, qboRequest } from '@/lib/qbo/client';
import { createServiceClient } from '@/lib/supabase/service';

const service = createServiceClient();

type Ref = { value: string; name?: string };

async function guard() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  if (!/localhost|127\.0\.0\.1/.test(url))
    throw new Error('Refusing: Supabase is not the local stack.');
  const { data } = await service
    .from('qbo_connection')
    .select('environment')
    .eq('id', 1)
    .maybeSingle();
  if (data?.environment !== 'sandbox')
    throw new Error('Refusing: the SIS is not connected to a sandbox company.');
}

async function findOrCreate<T extends { Id: string }>(
  entity: 'Account' | 'Item' | 'Customer' | 'PaymentMethod',
  name: string,
  body: Record<string, unknown>
): Promise<T> {
  const nameField = entity === 'Customer' ? 'DisplayName' : 'Name';
  const found = await qboQuery<T>(
    service,
    entity,
    `${nameField} = '${qbEscape(name)}'`,
    'maxresults 1'
  );
  if (found[0]) return found[0];
  const path = `/${entity.toLowerCase()}`;
  const res = await qboRequest<Record<string, T>>(service, 'POST', path, body);
  console.log(`  + ${entity} ${name}`);
  return res[entity];
}

// HFSE's income accounts (production Products list, 2026-10-15). QuickBooks
// sub-accounts are written "Parent:Child"; here they are flat names with the
// same leaf, which is enough for the mapping.
const INCOME = [
  'Admissions & Registration',
  'Enrolment Fees - Books and Worksheets',
  'Enrolment Fees - Fee Protection Scheme',
  'Advance customers payment',
  'Sales of Books and Miscellaneous',
  'School Events',
] as const;
const DEPOSIT = ['UOB', 'PayNow', 'Credit/Debit Card'] as const;

const ITEMS: Array<{
  name: string;
  account: (typeof INCOME)[number];
  price: number;
}> = [
  {
    name: 'Application and Entrance Test Fee for Primary (Non-Refundable)',
    account: 'Admissions & Registration',
    price: 400,
  },
  {
    name: 'Application and Entrance Test Fee for Secondary (Non-Refundable)',
    account: 'Admissions & Registration',
    price: 550,
  },
  {
    name: 'AY2026 Registration Fee',
    account: 'Admissions & Registration',
    price: 500,
  },
  {
    name: 'AY2027 Registration Fee',
    account: 'Admissions & Registration',
    price: 500,
  },
  {
    name: 'AY2026 Books',
    account: 'Enrolment Fees - Books and Worksheets',
    price: 300,
  },
  {
    name: 'AY2027 Books',
    account: 'Enrolment Fees - Books and Worksheets',
    price: 300,
  },
  {
    name: 'AY2027 Fee Protection Scheme',
    account: 'Enrolment Fees - Fee Protection Scheme',
    price: 200,
  },
  {
    name: 'AY2026 Student Devt Fees',
    account: 'Advance customers payment',
    price: 1500,
  },
  {
    name: 'AY2027 Student Devt Fees',
    account: 'Advance customers payment',
    price: 1500,
  },
  { name: 'Tuition Fees', account: 'Advance customers payment', price: 920 },
  { name: 'Graduation & Moving Up fee', account: 'School Events', price: 45 },
  {
    name: 'Math Enrichment Class',
    account: 'Sales of Books and Miscellaneous',
    price: 42,
  },
];

type Student = {
  ay: string;
  studentNumber: string;
  enroleeNumber: string;
  lastName: string;
  firstName: string;
  middleName: string | null;
  fatherFullName: string | null;
  motherFullName: string | null;
};

async function localStudents(): Promise<Student[]> {
  const out: Student[] = [];
  for (const ay of ['2027', '2026']) {
    const { data, error } = await service
      .from(`ay${ay}_enrolment_applications`)
      .select(
        '"studentNumber","enroleeNumber","lastName","firstName","middleName","fatherFullName","motherFullName"'
      )
      .not('studentNumber', 'is', null)
      .order('enroleeNumber')
      .limit(ay === '2027' ? 40 : 25);
    if (error) throw new Error(`ay${ay}: ${error.message}`);
    for (const r of data ?? []) {
      const s = r as Record<string, string | null>;
      if (!s.lastName || !s.firstName) continue;
      if (out.some((o) => o.studentNumber === s.studentNumber)) continue;
      out.push({
        ay,
        studentNumber: s.studentNumber!,
        enroleeNumber: s.enroleeNumber!,
        lastName: s.lastName,
        firstName: s.firstName,
        middleName: s.middleName,
        fatherFullName: s.fatherFullName,
        motherFullName: s.motherFullName,
      });
    }
  }
  return out;
}

// HFSE's form: "SURNAME, Given M." — middle name as an initial.
export function hfseCustomerName(
  s: Pick<Student, 'lastName' | 'firstName' | 'middleName'>
): string {
  const mi = s.middleName?.trim()
    ? ` ${s.middleName.trim()[0].toUpperCase()}.`
    : '';
  return `${s.lastName.trim().toUpperCase()}, ${s.firstName.trim()}${mi}`;
}

let nextDoc = 62300; // above production's HFSE062263, so a number is never mistaken for a real one

async function invoice(
  customer: Ref,
  item: { Id: string; name: string; price: number },
  txnDate: string,
  memo: string | null
) {
  const doc = `HFSE0${nextDoc++}`;
  const found = await qboQuery<{
    Id: string;
    DocNumber: string;
    Balance: number;
  }>(service, 'Invoice', `DocNumber = '${doc}'`, 'maxresults 1');
  if (found[0]) return found[0];
  const res = await qboRequest<{
    Invoice: { Id: string; DocNumber: string; Balance: number };
  }>(service, 'POST', '/invoice', {
    CustomerRef: customer,
    DocNumber: doc,
    TxnDate: txnDate,
    Line: [
      {
        DetailType: 'SalesItemLineDetail',
        Amount: item.price,
        SalesItemLineDetail: {
          ItemRef: { value: item.Id },
          Qty: 1,
          UnitPrice: item.price,
        },
      },
    ],
    ...(memo ? { CustomerMemo: { value: memo } } : {}),
  });
  console.log(`  + Invoice ${doc} ${customer.name ?? customer.value}`);
  return res.Invoice;
}

async function pay(
  customer: Ref,
  inv: { Id: string; Balance: number },
  amount: number,
  txnDate: string,
  deposit: Ref
) {
  if (Number(inv.Balance) === 0) return;
  await qboRequest(service, 'POST', '/payment', {
    CustomerRef: customer,
    TotalAmt: amount,
    TxnDate: txnDate,
    DepositToAccountRef: deposit,
    Line: [
      { Amount: amount, LinkedTxn: [{ TxnId: inv.Id, TxnType: 'Invoice' }] },
    ],
  });
}

async function main() {
  await guard();
  console.log('Accounts');
  const income = new Map<string, Ref>();
  for (const name of INCOME) {
    const a = await findOrCreate<{ Id: string }>('Account', name, {
      Name: name,
      AccountType: 'Income',
    });
    income.set(name, { value: a.Id, name });
  }
  const deposit = new Map<string, Ref>();
  for (const name of DEPOSIT) {
    const a = await findOrCreate<{ Id: string }>('Account', name, {
      Name: name,
      AccountType: 'Bank',
    });
    deposit.set(name, { value: a.Id, name });
  }
  console.log('Items');
  const items = new Map<string, { Id: string; name: string; price: number }>();
  for (const it of ITEMS) {
    const i = await findOrCreate<{ Id: string }>('Item', it.name, {
      Name: it.name,
      Type: 'Service',
      UnitPrice: it.price,
      IncomeAccountRef: income.get(it.account),
    });
    items.set(it.name, { Id: i.Id, name: it.name, price: it.price });
  }
  console.log('Customers');
  const students = await localStudents();
  const customers = new Map<string, Ref>();
  for (const s of students) {
    const name = hfseCustomerName(s);
    const company =
      [s.fatherFullName, s.motherFullName].filter(Boolean).join(' / ') ||
      undefined;
    const c = await findOrCreate<{ Id: string }>('Customer', name, {
      DisplayName: name,
      ...(company ? { CompanyName: company } : {}),
    });
    customers.set(s.studentNumber, { value: c.Id, name });
  }
  // Messy cases seen in production: a duplicate customer with an email in the
  // name, a vendor-like customer, an internal sub-customer.
  const dupOf = students[1];
  if (dupOf)
    await findOrCreate(
      'Customer',
      `${hfseCustomerName(dupOf)} (parent.example@local.test)`,
      { DisplayName: `${hfseCustomerName(dupOf)} (parent.example@local.test)` }
    );
  await findOrCreate('Customer', 'Grenke Lease Singapore PL', {
    DisplayName: 'Grenke Lease Singapore PL',
  });
  const parent = await findOrCreate<{ Id: string }>(
    'Customer',
    'Related Companies',
    { DisplayName: 'Related Companies' }
  );
  // A sub-customer's DisplayName is its own name; QuickBooks shows it as
  // "Related Companies:HFSE YoungStarters Pte Ltd" (FullyQualifiedName).
  await findOrCreate('Customer', 'HFSE YoungStarters Pte Ltd', {
    DisplayName: 'HFSE YoungStarters Pte Ltd',
    ParentRef: { value: parent.Id },
    Job: true,
  });

  console.log('Invoices and payments');
  const typed: Array<{
    ay: string;
    enroleeNumber: string;
    col: 'registrationInvoice' | 'feeInvoice';
    doc: string;
  }> = [];
  const uob = deposit.get('UOB')!;
  const paynow = deposit.get('PayNow')!;
  const card = deposit.get('Credit/Debit Card')!;
  for (const [i, s] of students.entries()) {
    const c = customers.get(s.studentNumber)!;
    if (s.ay === '2027') {
      if (i % 5 === 4) continue; // some new children have no invoice yet (the ~14 to review)
      const reg = await invoice(
        c,
        items.get('AY2027 Registration Fee')!,
        '2026-07-10',
        'AY2027 Application and Entrance Test Fee'
      );
      if (i % 3 !== 0)
        await pay(c, reg, 500, '2026-07-15', i % 2 ? uob : paynow);
      const fees = await invoice(
        c,
        items.get('AY2027 Student Devt Fees')!,
        '2026-09-01',
        'AY2027 Enrolment Fee and SDF Option 1'
      );
      if (i % 4 === 1) await pay(c, fees, 1500, '2026-09-20', card);
      if (i % 4 === 2) await pay(c, fees, 700, '2026-09-20', uob); // part paid
      await invoice(
        c,
        items.get('Tuition Fees')!,
        '2026-10-01',
        'Auto-generated via n8n'
      );
      if (i % 2 === 0)
        typed.push({
          ay: '2027',
          enroleeNumber: s.enroleeNumber,
          col: 'registrationInvoice',
          doc: reg.DocNumber,
        });
      if (i % 3 === 1)
        typed.push({
          ay: '2027',
          enroleeNumber: s.enroleeNumber,
          col: 'feeInvoice',
          doc: fees.DocNumber,
        });
    } else {
      // Returning AY2026 student: last year's Fees, paid — must NOT land on AY2027.
      const old = await invoice(
        c,
        items.get('AY2026 Student Devt Fees')!,
        '2025-09-01',
        'AY2026 Enrolment Fees'
      );
      await pay(c, old, 1500, '2025-09-10', uob);
      await invoice(
        c,
        items.get('Tuition Fees')!,
        '2026-01-05',
        'Auto-generated via n8n'
      );
    }
  }
  // A voided invoice, as staff void a mistake.
  const first = students.find((s) => s.ay === '2027');
  if (first) {
    const v = await invoice(
      customers.get(first.studentNumber)!,
      items.get('AY2027 Books')!,
      '2026-08-01',
      null
    );
    const full = await qboRequest<{
      Invoice: { Id: string; SyncToken: string };
    }>(service, 'GET', `/invoice/${v.Id}`);
    await qboRequest(service, 'POST', '/invoice?operation=void', {
      Id: full.Invoice.Id,
      SyncToken: full.Invoice.SyncToken,
    }).catch(() => {});
  }
  // Sibling case: one child's typed Fees number is the next child's invoice.
  const sib = typed.filter(
    (t) => t.ay === '2027' && t.col === 'registrationInvoice'
  );
  if (sib.length >= 2) sib[0] = { ...sib[0], doc: sib[1].doc };

  console.log('Typed numbers on local stages');
  for (const t of typed) {
    const { error } = await service
      .from(`ay${t.ay}_enrolment_status`)
      .update({ [t.col]: t.doc })
      .eq('enroleeNumber', t.enroleeNumber);
    if (error) throw new Error(error.message);
  }
  console.log(
    `Done: ${students.length} students, ${typed.length} typed numbers.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run it twice**

Run: `npx tsx --conditions=react-server --env-file=.env.development.local scripts/qbo/seed-sandbox-hfse.ts` — then the same command again.
Expected: first run prints `+ Account …`, `+ Item …`, `+ Customer …`, `+ Invoice HFSE0623xx …` lines and `Done: N students`; the second run prints no `+` lines for accounts, items or customers. (Invoice numbers restart at 62300 each run and are found by DocNumber, so no duplicates.)

If an `Account` create is refused because the name exists with another type, rename the constant and re-run — do not delete sandbox accounts.

- [ ] **Step 3: Commit**

```bash
git add scripts/qbo/seed-sandbox-hfse.ts && git commit -m "chore(billing): seed the QuickBooks sandbox in HFSE's shape

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Phase 1 — Data and linking

Gate: `npx vitest run --pool=threads __tests__/billing __tests__/qbo __tests__/audit` passes, `npx tsc --noEmit` clean, `npm run local:migrate` applies 189, the link dry run against the sandbox reports links for the seeded students and puts the duplicate-customer and no-invoice children in review; review pass on the phase diff.

### Task 1.1: Migration 189

**Files:**

- Create: `supabase/migrations/189_billing_module.sql`

**Interfaces:**

- Produces the columns and tables below; later tasks use these names verbatim.

- [ ] **Step 1: Write the migration**

```sql
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
-- until Phase 5 removes them (migration 190 drops the columns).
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
```

- [ ] **Step 2: Apply locally**

Run: `npm run local:migrate`
Expected: `189_billing_module.sql` applied with no error. Then check: `docker exec -i supabase_db_hfse-markbook psql -U postgres -d postgres -c "\d public.qbo_invoices"` lists `stage_keys`, `lines`, `txn_date`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/189_billing_module.sql && git commit -m "feat(billing): migration 189 — invoices, payments, items and tile settings

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 1.2: Link rules (pure)

**Files:**

- Create: `lib/billing/names.ts`, `lib/billing/link-rules.ts`
- Test: `__tests__/billing/link-rules.test.ts`

**Interfaces:**

- Produces:
  - `nameKey(last: string | null, first: string | null): string | null` — surname + first given word, letters only, accents removed, lower case, `"<surname>|<first>"`.
  - `customerNameKey(displayName: string): string | null` — same key from a QuickBooks DisplayName `SURNAME, Given …`; `null` when there is no comma or the name contains `:`.
  - `cleanDocNumber(v: string | null): string | null` — whitespace removed, upper case; `null` unless it matches `/^HFSE\d{6}$/` or `/^\d+$/` (sandbox numbers are plain digits).
  - `type LinkCustomer = { id: string; displayName: string }`
  - `type LinkIndex = { customers: Map<string, LinkCustomer>; byDocNumber: Map<string, string>; byNameKey: Map<string, string[]> }` (`byDocNumber`: DocNumber → customer id).
  - `buildLinkIndex(customers: LinkCustomer[], invoices: Array<{ docNumber: string | null; customerId: string }>): LinkIndex` — skips sub-customers (`:` in the name) everywhere.
  - `type LinkStudent = { studentNumber: string; lastName: string | null; firstName: string | null; typedNumbers: string[] }`
  - `type LinkReason = 'invoice' | 'sibling' | 'name'`
  - `type LinkProposal = { kind: 'link'; customerId: string; reason: LinkReason } | { kind: 'review'; candidates: Array<{ customerId: string; displayName: string; reason: string }> }`
  - `proposeLink(student: LinkStudent, index: LinkIndex): LinkProposal`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import {
  buildLinkIndex,
  cleanDocNumber,
  customerNameKey,
  nameKey,
  proposeLink,
} from '@/lib/billing/link-rules';

const customers = [
  { id: '1', displayName: 'PAGCALIWANGAN, Nisa Yelle D.' },
  { id: '2', displayName: 'PAGCALIWANGAN, Nala Yelle D.' },
  { id: '3', displayName: 'OBIAS, Eon Mach N.' },
  { id: '4', displayName: 'OBIAS, Eon Mach N. (potsie.obias@gmail.com)' },
  { id: '5', displayName: 'BAÑA, Hannah Zoey U.' },
  { id: '6', displayName: 'Related Companies:HFSE YoungStarters Pte Ltd' },
  { id: '7', displayName: 'Grenke Lease Singapore PL' },
  { id: '8', displayName: 'REYES, Maximo Aurelio T.' },
];
const invoices = [
  { docNumber: 'HFSE061001', customerId: '1' },
  { docNumber: 'HFSE061002', customerId: '2' },
  { docNumber: 'HFSE061003', customerId: '8' },
  { docNumber: 'HFSE061004', customerId: '6' },
];
const index = buildLinkIndex(customers, invoices);

describe('names', () => {
  it('keys a SIS name and a QuickBooks name the same way', () => {
    expect(nameKey('Baña', 'Hannah Zoey')).toBe('bana|hannah');
    expect(customerNameKey('BAÑA, Hannah Zoey U.')).toBe('bana|hannah');
    expect(customerNameKey('Ganaden , Meril Elleigh  Corpuz')).toBe(
      'ganaden|meril'
    );
  });
  it('gives no key to sub-customers and names without a comma', () => {
    expect(
      customerNameKey('Related Companies:HFSE YoungStarters Pte Ltd')
    ).toBeNull();
    expect(customerNameKey('Grenke Lease Singapore PL')).toBeNull();
  });
  it('cleans typed invoice numbers', () => {
    expect(cleanDocNumber(' hfse061001\t')).toBe('HFSE061001');
    expect(cleanDocNumber('None')).toBeNull();
    expect(cleanDocNumber('INV-0042-20250101')).toBeNull();
    expect(cleanDocNumber('1048')).toBe('1048');
  });
});

describe('proposeLink', () => {
  it('links by the typed invoice number', () => {
    expect(
      proposeLink(
        {
          studentNumber: 'H1',
          lastName: 'Reyes',
          firstName: 'Maximo Aurelio',
          typedNumbers: ['HFSE061003'],
        },
        index
      )
    ).toEqual({ kind: 'link', customerId: '8', reason: 'invoice' });
  });
  it('sibling number: several customers, the one with the same name wins', () => {
    expect(
      proposeLink(
        {
          studentNumber: 'H2',
          lastName: 'Pagcaliwangan',
          firstName: 'Nisa Yelle',
          typedNumbers: ['HFSE061001', 'HFSE061002'],
        },
        index
      )
    ).toEqual({ kind: 'link', customerId: '1', reason: 'sibling' });
  });
  it('a typed number of a sibling only, name differs: the name decides', () => {
    expect(
      proposeLink(
        {
          studentNumber: 'H2',
          lastName: 'Pagcaliwangan',
          firstName: 'Nisa Yelle',
          typedNumbers: ['HFSE061002'],
        },
        index
      )
    ).toEqual({ kind: 'link', customerId: '1', reason: 'sibling' });
  });
  it('links by name when there is no typed number', () => {
    expect(
      proposeLink(
        {
          studentNumber: 'H3',
          lastName: 'Baña',
          firstName: 'Hannah Zoey',
          typedNumbers: [],
        },
        index
      )
    ).toEqual({ kind: 'link', customerId: '5', reason: 'name' });
  });
  it('duplicate customer: review with both, never auto-link', () => {
    const p = proposeLink(
      {
        studentNumber: 'H4',
        lastName: 'Obias',
        firstName: 'Eon Mach',
        typedNumbers: [],
      },
      index
    );
    expect(p.kind).toBe('review');
    expect(
      p.kind === 'review' && p.candidates.map((c) => c.customerId).sort()
    ).toEqual(['3', '4']);
  });
  it('a number that points at a sub-customer is ignored', () => {
    const p = proposeLink(
      {
        studentNumber: 'H5',
        lastName: 'Nobody',
        firstName: 'Here',
        typedNumbers: ['HFSE061004'],
      },
      index
    );
    expect(p).toEqual({ kind: 'review', candidates: [] });
  });
  it('nothing found: review with no candidates', () => {
    expect(
      proposeLink(
        {
          studentNumber: 'H6',
          lastName: 'Wright',
          firstName: 'Dylan Connor',
          typedNumbers: ['HFSE099999'],
        },
        index
      )
    ).toEqual({ kind: 'review', candidates: [] });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --pool=threads __tests__/billing/link-rules.test.ts`
Expected: FAIL — cannot resolve `@/lib/billing/link-rules`.

- [ ] **Step 3: Implement**

`lib/billing/names.ts`:

```ts
// Name keys for matching a SIS student to a QuickBooks customer. HFSE names
// customers "SURNAME, Given M." (production export, 2026-10-15); the SIS has
// lastName / firstName. Both reduce to "surname|first given word", letters
// only, accents dropped — the export showed Ñ mangled, and middle initials and
// emails appended to names vary, so only these two parts are compared.

function letters(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

export function nameKey(
  last: string | null,
  first: string | null
): string | null {
  const sur = letters(last ?? '');
  const given = letters((first ?? '').trim().split(/\s+/)[0] ?? '');
  return sur && given ? `${sur}|${given}` : null;
}

export function customerNameKey(displayName: string): string | null {
  if (displayName.includes(':') || !displayName.includes(',')) return null;
  const [sur, given] = displayName.split(',', 2);
  return nameKey(sur, given);
}

export function cleanDocNumber(v: string | null): string | null {
  const t = (v ?? '').replace(/\s+/g, '').toUpperCase();
  return /^HFSE\d{6}$/.test(t) || /^\d+$/.test(t) ? t : null;
}
```

`lib/billing/link-rules.ts`:

```ts
// Which QuickBooks customer is this student? Spec "Linking customers":
// 1 typed invoice number → its customer; 2 several customers (a sibling's
// number was typed) → the one with the same name; 3 exactly one customer with
// the same name; 4 anything else → a person picks (review). Pure.

import { cleanDocNumber, customerNameKey, nameKey } from '@/lib/billing/names';

export { cleanDocNumber, customerNameKey, nameKey } from '@/lib/billing/names';

export type LinkCustomer = { id: string; displayName: string };
export type LinkIndex = {
  customers: Map<string, LinkCustomer>;
  byDocNumber: Map<string, string>;
  byNameKey: Map<string, string[]>;
};
export type LinkStudent = {
  studentNumber: string;
  lastName: string | null;
  firstName: string | null;
  typedNumbers: string[];
};
export type LinkReason = 'invoice' | 'sibling' | 'name';
export type LinkProposal =
  | { kind: 'link'; customerId: string; reason: LinkReason }
  | {
      kind: 'review';
      candidates: Array<{
        customerId: string;
        displayName: string;
        reason: string;
      }>;
    };

const isSub = (c: LinkCustomer) => c.displayName.includes(':');

export function buildLinkIndex(
  customers: LinkCustomer[],
  invoices: Array<{ docNumber: string | null; customerId: string }>
): LinkIndex {
  const map = new Map<string, LinkCustomer>();
  const byNameKey = new Map<string, string[]>();
  for (const c of customers) {
    if (isSub(c)) continue;
    map.set(c.id, c);
    const k = customerNameKey(c.displayName);
    if (k) byNameKey.set(k, [...(byNameKey.get(k) ?? []), c.id]);
  }
  const byDocNumber = new Map<string, string>();
  for (const inv of invoices) {
    const doc = cleanDocNumber(inv.docNumber);
    if (doc && map.has(inv.customerId)) byDocNumber.set(doc, inv.customerId);
  }
  return { customers: map, byDocNumber, byNameKey };
}

export function proposeLink(
  student: LinkStudent,
  index: LinkIndex
): LinkProposal {
  const key = nameKey(student.lastName, student.firstName);
  const sameName = (id: string) =>
    !!key && customerNameKey(index.customers.get(id)!.displayName) === key;

  const fromNumbers = new Set<string>();
  for (const raw of student.typedNumbers) {
    const doc = cleanDocNumber(raw);
    const id = doc ? index.byDocNumber.get(doc) : undefined;
    if (id) fromNumbers.add(id);
  }
  if (fromNumbers.size === 1) {
    const [id] = fromNumbers;
    // A single number can still be a sibling's: trust it only if the name
    // does not point at a different customer.
    const named = key ? (index.byNameKey.get(key) ?? []) : [];
    if (sameName(id) || named.length === 0)
      return { kind: 'link', customerId: id, reason: 'invoice' };
    if (named.length === 1)
      return { kind: 'link', customerId: named[0], reason: 'sibling' };
  }
  if (fromNumbers.size > 1) {
    const match = [...fromNumbers].filter(sameName);
    if (match.length === 1)
      return { kind: 'link', customerId: match[0], reason: 'sibling' };
  }
  const named = key ? (index.byNameKey.get(key) ?? []) : [];
  if (named.length === 1)
    return { kind: 'link', customerId: named[0], reason: 'name' };

  const candidates = new Map<string, string>();
  for (const id of named) candidates.set(id, 'same name');
  for (const id of fromNumbers)
    if (!candidates.has(id)) candidates.set(id, 'typed invoice number');
  return {
    kind: 'review',
    candidates: [...candidates].map(([customerId, reason]) => ({
      customerId,
      displayName: index.customers.get(customerId)!.displayName,
      reason,
    })),
  };
}
```

Note the second sibling test: one typed number (customer 2, "Nala"), but the name "Nisa" points at customer 1 → `sibling`, customer 1. The duplicate-customer case: `named` has 2 ids → review.

- [ ] **Step 4: Run the test**

Run: `npx vitest run --pool=threads __tests__/billing/link-rules.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/billing/names.ts lib/billing/link-rules.ts __tests__/billing/link-rules.test.ts && git commit -m "feat(billing): rules that link a student to their QuickBooks customer

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 1.3: Paged QuickBooks reads + the link run

**Files:**

- Modify: `lib/qbo/client.ts` (add `qboQueryAll` after `qboQuery`)
- Create: `lib/billing/link-run.server.ts`
- Create: `app/api/billing/link/route.ts`
- Modify: `lib/audit/log-action.ts`, `lib/audit/humanize.ts`, `lib/audit/modules.ts`, `app/(admissions)/admissions/audit-log/page.tsx`
- Test: `__tests__/qbo/client.test.ts` (add a `qboQueryAll` paging case, following the file's existing `fetch` mock)

**Interfaces:**

- Consumes: `buildLinkIndex`, `proposeLink`, `cleanDocNumber` (Task 1.2); `loadCustomerHistory` (Task 3.3 — until then, the run only writes links; Task 3.3 adds the history call, see its Step 4).
- Produces:
  - `qboQueryAll<T>(service, entity: string, where?: string): Promise<T[]>` — pages with `startposition N maxresults 1000` until a page returns fewer than 1000.
  - `runLink(service, opts: { dryRun: boolean; actor: { id: string; email: string | null; role: string } }): Promise<LinkRunResult>`
  - `type LinkRunResult = { students: number; alreadyLinked: number; linked: { invoice: number; sibling: number; name: number }; review: number; newlyLinked: string[] }` (`newlyLinked` = student numbers).
  - `POST /api/billing/link` body `{ dryRun: boolean }` → `LinkRunResult`. Superadmin only.
  - Audit action `billing.link.run` (entity type `qbo_customer`, entity id `bulk`), and `qbo.customer.link` (registered here, used in Task 1.4).

- [ ] **Step 1: `qboQueryAll`** — add to `lib/qbo/client.ts` below `qboQuery`:

```ts
/** Every row, paged 1000 at a time (QuickBooks' query cap). */
export async function qboQueryAll<T>(
  service: SupabaseClient,
  entity: string,
  where = ''
): Promise<T[]> {
  const out: T[] = [];
  for (let start = 1; ; start += 1000) {
    const page = await qboQuery<T>(
      service,
      entity,
      where,
      `startposition ${start} maxresults 1000`
    );
    out.push(...page);
    if (page.length < 1000) return out;
  }
}
```

Add a test to `__tests__/qbo/client.test.ts` in the style of its existing request tests: mock two responses (1000 rows, then 3 rows) and expect 1003 rows and two `fetch` calls whose URLs contain `startposition%201%20` and `startposition%201001%20`. Run `npx vitest run --pool=threads __tests__/qbo/client.test.ts` → PASS.

- [ ] **Step 2: The run** — `lib/billing/link-run.server.ts`:

```ts
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { logAction } from '@/lib/audit/log-action';
import {
  buildLinkIndex,
  proposeLink,
  type LinkStudent,
} from '@/lib/billing/link-rules';
import {
  connectedRealmId,
  qboQueryAll,
  QboNotConnectedError,
} from '@/lib/qbo/client';

export type LinkRunResult = {
  students: number;
  alreadyLinked: number;
  linked: { invoice: number; sibling: number; name: number };
  review: number;
  newlyLinked: string[];
};

/** Every student with a student number, across every AY that has tables. */
export async function loadLinkStudents(
  service: SupabaseClient
): Promise<LinkStudent[]> {
  const { data: years, error } = await service
    .from('academic_years')
    .select('ay_code');
  if (error) throw new Error(`Academic years lookup failed: ${error.message}`);
  const byNumber = new Map<string, LinkStudent>();
  for (const { ay_code } of (years ?? []) as Array<{ ay_code: string }>) {
    const prefix = `ay${ay_code.slice(2)}`;
    const apps = await service
      .from(`${prefix}_enrolment_applications`)
      .select('"enroleeNumber","studentNumber","lastName","firstName"')
      .not('studentNumber', 'is', null);
    if (apps.error) continue; // a year without admissions tables (e.g. a future AY)
    const status = await service
      .from(`${prefix}_enrolment_status`)
      .select('"enroleeNumber","registrationInvoice","feeInvoice"');
    const typed = new Map<string, string[]>();
    for (const s of (status.data ?? []) as Array<
      Record<string, string | null>
    >) {
      typed.set(
        s.enroleeNumber!,
        [s.registrationInvoice, s.feeInvoice].filter((v): v is string => !!v)
      );
    }
    for (const a of (apps.data ?? []) as Array<Record<string, string | null>>) {
      const sn = a.studentNumber!;
      const prev = byNumber.get(sn);
      byNumber.set(sn, {
        studentNumber: sn,
        // The newest year's name wins (years are read oldest → newest is not
        // guaranteed, so keep a non-empty one).
        lastName: a.lastName ?? prev?.lastName ?? null,
        firstName: a.firstName ?? prev?.firstName ?? null,
        typedNumbers: [
          ...(prev?.typedNumbers ?? []),
          ...(typed.get(a.enroleeNumber!) ?? []),
        ],
      });
    }
  }
  return [...byNumber.values()];
}

export async function runLink(
  service: SupabaseClient,
  opts: {
    dryRun: boolean;
    actor: { id: string; email: string | null; role: string };
  }
): Promise<LinkRunResult> {
  const realmId = await connectedRealmId(service);
  if (!realmId) throw new QboNotConnectedError();

  const [customers, invoices, students, stored] = await Promise.all([
    qboQueryAll<{ Id: string; DisplayName: string }>(
      service,
      'Customer',
      'Active IN (true, false)'
    ),
    qboQueryAll<{ DocNumber?: string; CustomerRef: { value: string } }>(
      service,
      'Invoice'
    ),
    loadLinkStudents(service),
    service
      .from('qbo_customers')
      .select('student_number')
      .eq('realm_id', realmId),
  ]);
  if (stored.error)
    throw new Error(`Linked customers lookup failed: ${stored.error.message}`);
  const already = new Set(
    (stored.data ?? []).map((r) => r.student_number as string)
  );
  const index = buildLinkIndex(
    customers.map((c) => ({ id: c.Id, displayName: c.DisplayName })),
    invoices.map((i) => ({
      docNumber: i.DocNumber ?? null,
      customerId: i.CustomerRef.value,
    }))
  );

  const result: LinkRunResult = {
    students: students.length,
    alreadyLinked: 0,
    linked: { invoice: 0, sibling: 0, name: 0 },
    review: 0,
    newlyLinked: [],
  };
  const links: Array<Record<string, unknown>> = [];
  const reviews: Array<Record<string, unknown>> = [];
  for (const s of students) {
    if (already.has(s.studentNumber)) {
      result.alreadyLinked++;
      continue;
    }
    const p = proposeLink(s, index);
    if (p.kind === 'link') {
      result.linked[p.reason]++;
      result.newlyLinked.push(s.studentNumber);
      links.push({
        student_number: s.studentNumber,
        qbo_customer_id: p.customerId,
        display_name: index.customers.get(p.customerId)!.displayName,
        matched_by: 'auto',
        matched_at: new Date().toISOString(),
        realm_id: realmId,
      });
    } else {
      result.review++;
      reviews.push({
        student_number: s.studentNumber,
        student_name: [s.lastName, s.firstName].filter(Boolean).join(', '),
        candidates: p.candidates,
        computed_at: new Date().toISOString(),
      });
    }
  }
  if (opts.dryRun) return result;

  for (let i = 0; i < links.length; i += 500) {
    const { error } = await service
      .from('qbo_customers')
      .upsert(links.slice(i, i + 500));
    if (error) throw new Error(`Saving links failed: ${error.message}`);
  }
  // The review list is rebuilt from scratch: whoever was linked since drops off.
  const del = await service
    .from('billing_link_review')
    .delete()
    .neq('student_number', '');
  if (del.error)
    throw new Error(`Clearing the review list failed: ${del.error.message}`);
  for (let i = 0; i < reviews.length; i += 500) {
    const { error } = await service
      .from('billing_link_review')
      .insert(reviews.slice(i, i + 500));
    if (error)
      throw new Error(`Saving the review list failed: ${error.message}`);
  }
  await logAction({
    service,
    actor: opts.actor,
    action: 'billing.link.run',
    entityType: 'qbo_customer',
    entityId: 'bulk',
    context: {
      ...result.linked,
      review: result.review,
      already_linked: result.alreadyLinked,
    },
  });
  return result;
}
```

Before writing it, open `lib/audit/log-action.ts` and confirm `logAction`'s argument shape (`service`, `actor`, `action`, `entityType`, `entityId`, `context`) — it is the one used in `app/api/sis/students/[enroleeNumber]/stage/[stageKey]/invoice/route.ts`.

- [ ] **Step 3: The route** — `app/api/billing/link/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireRole } from '@/lib/auth/require-role';
import { runLink } from '@/lib/billing/link-run.server';
import { qboErrorMessage } from '@/lib/qbo/client';
import { QBO_ADMIN_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

const Body = z.object({ dryRun: z.boolean() });

// POST /api/billing/link — match every unlinked student to their QuickBooks
// customer. dryRun: true only counts. Superadmin.
export async function POST(request: Request) {
  const auth = await requireRole([...QBO_ADMIN_ROLES]);
  if ('error' in auth) return auth.error;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  try {
    const result = await runLink(createServiceClient(), {
      dryRun: parsed.data.dryRun,
      actor: {
        id: auth.user.id,
        email: auth.user.email ?? null,
        role: auth.role,
      },
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: qboErrorMessage(e) }, { status: 502 });
  }
}
```

- [ ] **Step 4: Register the audit actions**

- `lib/audit/log-action.ts` — in `ALL_AUDIT_ACTIONS`, after `'qbo.connection.disconnect',` add:

```ts
  // Billing module (migration 189).
  'qbo.customer.link',
  'qbo.payment.create',
  'billing.link.run',
  'billing.mapping.update',
  'billing.years.update',
  'billing.deposit_accounts.update',
```

and add `| 'qbo_payment'` and `| 'billing_setting'` to the entity-type union after `| 'qbo_connection'`.

- `lib/audit/humanize.ts` — in the labels map after `'qbo.connection.disconnect': 'QuickBooks disconnected',`:

```ts
  'qbo.customer.link': 'Student linked to QuickBooks customer',
  'qbo.payment.create': 'Payment recorded in QuickBooks',
  'billing.link.run': 'Students linked to QuickBooks',
  'billing.mapping.update': 'Billing tile mapping changed',
  'billing.years.update': 'Billing year ranges changed',
  'billing.deposit_accounts.update': 'Payment accounts changed',
```

and in the context switch, after the `qbo.connection.*` case:

```ts
    case 'qbo.customer.link':
      return joinParts([str(ctx.display_name)].filter(Boolean));
    case 'qbo.payment.create': {
      const parts: string[] = [];
      const total = Number(ctx.total);
      if (ctx.total !== undefined && ctx.total !== null && Number.isFinite(total))
        parts.push(`S$${total.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
      const account = str(ctx.deposit_account);
      if (account) parts.push(account);
      return joinParts(parts);
    }
    case 'billing.link.run': {
      const linked = ['invoice', 'sibling', 'name'].reduce((n, k) => n + (Number(ctx[k]) || 0), 0);
      return joinParts([`${linked} linked`, `${Number(ctx.review) || 0} to review`]);
    }
    case 'billing.mapping.update':
    case 'billing.years.update':
    case 'billing.deposit_accounts.update':
      return joinParts([]);
```

(check `joinParts([])`'s return against its definition in the file; if it does not accept an empty list, return `null` as the surrounding cases do for "nothing to add").

- `lib/audit/modules.ts` — in the admissions prefixes after `'qbo.',` add `'billing.',` with the comment `// Billing module settings (migration 189).`
- `app/(admissions)/admissions/audit-log/page.tsx` — append the six actions to `ADMISSIONS_AUDIT_ACTIONS` after `'qbo.customer.create',`.

- [ ] **Step 5: Run the audit + billing tests and tsc**

Run: `npx vitest run --pool=threads __tests__/audit __tests__/billing __tests__/qbo` then `npx tsc --noEmit`
Expected: PASS and clean. If `__tests__/cache/write-route-invalidation.test.ts` flags `app/api/billing/link/route.ts`, add the route to its `NO_INVALIDATION_NEEDED` list with the reason `// Billing link tables only; no cached page reads them` and re-run `npx vitest run --pool=threads __tests__/cache`.

- [ ] **Step 6: Dry run against the sandbox**

Start `npm run dev` on the local stack, sign in as the local superadmin, then in the browser console on any SIS page:

```js
await (
  await fetch('/api/billing/link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dryRun: true }),
  })
).json();
```

Expected: `linked.invoice + linked.sibling + linked.name` ≈ the number of seeded students minus the duplicate-customer child and the children with no invoice, and `review` ≥ 1. Then run once with `dryRun: false` and check `select count(*) from qbo_customers` / `from billing_link_review` locally.

- [ ] **Step 7: Commit**

```bash
git add lib/qbo/client.ts __tests__/qbo/client.test.ts lib/billing/link-run.server.ts app/api/billing/link/route.ts lib/audit/log-action.ts lib/audit/humanize.ts lib/audit/modules.ts "app/(admissions)/admissions/audit-log/page.tsx" && git commit -m "feat(billing): link every student to their QuickBooks customer in one run

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(Add `__tests__/cache/write-route-invalidation.test.ts` to the `git add` if Step 5 changed it.)

### Task 1.4: Link one student by hand

**Files:**

- Create: `app/api/billing/students/[studentNumber]/link/route.ts`

**Interfaces:**

- Consumes: `qboRequest` (read the customer), `loadCustomerHistory` (Task 3.3; until then omit the call — Task 3.3 Step 4 adds it).
- Produces: `POST /api/billing/students/[studentNumber]/link` body `{ customerId: string }` → `{ ok: true, displayName }`. Billing roles. Upserts `qbo_customers` with `matched_by` = staff email, deletes the student's `billing_link_review` row, audit `qbo.customer.link` (entity `qbo_customer`, id = studentNumber, context `{ display_name, customer_id }`). Refuses a sub-customer (409, "That is not a student's customer.").

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import {
  connectedRealmId,
  qboErrorMessage,
  qboRequest,
  QboNotConnectedError,
} from '@/lib/qbo/client';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

const Body = z.object({ customerId: z.string().min(1) });

// POST /api/billing/students/[studentNumber]/link — staff pick the student's
// QuickBooks customer (from To review, or when Create invoice finds none).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ studentNumber: string }> }
) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const { studentNumber } = await params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  const service = createServiceClient();
  let displayName: string;
  let realmId: string;
  try {
    const r = await connectedRealmId(service);
    if (!r) throw new QboNotConnectedError();
    realmId = r;
    const c = await qboRequest<{
      Customer: { DisplayName: string; FullyQualifiedName?: string };
    }>(
      service,
      'GET',
      `/customer/${encodeURIComponent(parsed.data.customerId)}`
    );
    displayName = c.Customer.DisplayName;
    if ((c.Customer.FullyQualifiedName ?? '').includes(':'))
      return NextResponse.json(
        { error: "That is not a student's customer." },
        { status: 409 }
      );
  } catch (e) {
    return NextResponse.json({ error: qboErrorMessage(e) }, { status: 502 });
  }
  const { error } = await service.from('qbo_customers').upsert({
    student_number: studentNumber,
    qbo_customer_id: parsed.data.customerId,
    display_name: displayName,
    matched_by: auth.user.email ?? 'staff',
    matched_at: new Date().toISOString(),
    realm_id: realmId,
  });
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  await service
    .from('billing_link_review')
    .delete()
    .eq('student_number', studentNumber);
  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
    action: 'qbo.customer.link',
    entityType: 'qbo_customer',
    entityId: studentNumber,
    context: { display_name: displayName, customer_id: parsed.data.customerId },
  });
  return NextResponse.json({ ok: true, displayName });
}
```

- [ ] **Step 2: tsc + cache test**

Run: `npx tsc --noEmit` and `npx vitest run --pool=threads __tests__/cache` (add the route to `NO_INVALIDATION_NEEDED` if flagged, same reason as Task 1.3).
Expected: clean / PASS.

- [ ] **Step 3: Commit**

```bash
git add "app/api/billing/students/[studentNumber]/link/route.ts" && git commit -m "feat(billing): link one student to a QuickBooks customer by hand

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 — Mapping and years

Gate: `npx vitest run --pool=threads __tests__/billing` passes, tsc clean, the settings routes save and read back on the local stack; review pass.

### Task 2.1: Classify an invoice (pure)

**Files:**

- Create: `lib/billing/classify.ts`
- Test: `__tests__/billing/classify.test.ts`

**Interfaces:**

- Produces:
  - `type BillingStage = 'registration' | 'fees'`
  - `type InvoiceLine = { itemId: string | null; itemName: string | null; accountId: string | null; description: string | null; qty: number | null; amount: number }`
  - `type BillingMaps = { accounts: Map<string, BillingStage | 'none'>; items: Map<string, BillingStage | 'none'>; ranges: Array<{ ayCode: string; startsOn: string; endsOn: string }> }`
  - `classifyInvoice(lines: InvoiceLine[], txnDate: string | null, maps: BillingMaps): { ayCode: string | null; stageKeys: BillingStage[] }`

Rules: per line, item override first, then account; a line mapped `none` or unmapped counts for nothing. `stageKeys` sorted `['fees', 'registration']` order-free → return in the fixed order registration, fees. `ayCode` = the range holding `txnDate` (inclusive), first by `startsOn` when ranges overlap; `null` when no stage or no range. No stage → `{ ayCode: null, stageKeys: [] }`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from 'vitest';

import {
  classifyInvoice,
  type BillingMaps,
  type InvoiceLine,
} from '@/lib/billing/classify';

const maps: BillingMaps = {
  accounts: new Map([
    ['A-REG', 'registration'],
    ['A-ENROL', 'fees'],
    ['A-ADV', 'none'],
  ]),
  items: new Map([
    ['I-SDF27', 'fees'], // AY2027 Student Devt Fees, on the shared "Advance customers payment"
  ]),
  ranges: [
    { ayCode: 'AY2026', startsOn: '2025-06-01', endsOn: '2026-03-31' },
    { ayCode: 'AY2027', startsOn: '2026-06-01', endsOn: '2027-03-31' },
  ],
};
const line = (itemId: string, accountId: string): InvoiceLine => ({
  itemId,
  itemName: itemId,
  accountId,
  description: null,
  qty: 1,
  amount: 100,
});

describe('classifyInvoice', () => {
  it('maps by account', () => {
    expect(
      classifyInvoice([line('I-REG27', 'A-REG')], '2026-07-10', maps)
    ).toEqual({ ayCode: 'AY2027', stageKeys: ['registration'] });
  });
  it('an item override beats its account', () => {
    expect(
      classifyInvoice([line('I-SDF27', 'A-ADV')], '2026-09-01', maps)
    ).toEqual({ ayCode: 'AY2027', stageKeys: ['fees'] });
  });
  it('tuition on the shared account is on no tile', () => {
    expect(
      classifyInvoice([line('I-TUI', 'A-ADV')], '2026-10-01', maps)
    ).toEqual({ ayCode: null, stageKeys: [] });
  });
  it('unmapped account: no tile', () => {
    expect(
      classifyInvoice([line('I-BOOK', 'A-BOOKS')], '2026-10-01', maps)
    ).toEqual({ ayCode: null, stageKeys: [] });
  });
  it('lines for both tiles: counts for both', () => {
    expect(
      classifyInvoice(
        [line('I-REG27', 'A-REG'), line('I-SDF27', 'A-ADV')],
        '2026-09-01',
        maps
      )
    ).toEqual({ ayCode: 'AY2027', stageKeys: ['registration', 'fees'] });
  });
  it('previous year: a returning student’s AY2026 Fees stays on AY2026', () => {
    expect(
      classifyInvoice([line('I-SDF26', 'A-ENROL')], '2025-09-01', maps)
    ).toEqual({ ayCode: 'AY2026', stageKeys: ['fees'] });
  });
  it('outside every range: on no tile', () => {
    expect(
      classifyInvoice([line('I-REG27', 'A-REG')], '2026-04-15', maps)
    ).toEqual({ ayCode: null, stageKeys: [] });
  });
  it('range ends are inclusive', () => {
    expect(
      classifyInvoice([line('I-REG27', 'A-REG')], '2027-03-31', maps).ayCode
    ).toBe('AY2027');
  });
  it('no date: on no tile', () => {
    expect(classifyInvoice([line('I-REG27', 'A-REG')], null, maps)).toEqual({
      ayCode: null,
      stageKeys: [],
    });
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run --pool=threads __tests__/billing/classify.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — `lib/billing/classify.ts`:

```ts
// Which Registration / Fees tile an invoice belongs to, and for which year.
// Spec "Tile mapping and years". Item names change every year at HFSE; their
// income accounts don't — so accounts map by default and an item override
// handles the shared "Advance customers payment" account. Pure.

export type BillingStage = 'registration' | 'fees';
export type StageChoice = BillingStage | 'none';
export type InvoiceLine = {
  itemId: string | null;
  itemName: string | null;
  accountId: string | null;
  description: string | null;
  qty: number | null;
  amount: number;
};
export type BillingMaps = {
  accounts: Map<string, StageChoice>;
  items: Map<string, StageChoice>;
  ranges: Array<{ ayCode: string; startsOn: string; endsOn: string }>;
};

const ORDER: BillingStage[] = ['registration', 'fees'];

export function classifyInvoice(
  lines: InvoiceLine[],
  txnDate: string | null,
  maps: BillingMaps
): { ayCode: string | null; stageKeys: BillingStage[] } {
  const found = new Set<BillingStage>();
  for (const l of lines) {
    const choice =
      (l.itemId ? maps.items.get(l.itemId) : undefined) ??
      (l.accountId ? maps.accounts.get(l.accountId) : undefined);
    if (choice && choice !== 'none') found.add(choice);
  }
  const date = txnDate?.slice(0, 10) ?? null;
  const range = date
    ? [...maps.ranges]
        .sort((a, b) => a.startsOn.localeCompare(b.startsOn))
        .find((r) => r.startsOn <= date && date <= r.endsOn)
    : undefined;
  if (found.size === 0 || !range) return { ayCode: null, stageKeys: [] };
  return { ayCode: range.ayCode, stageKeys: ORDER.filter((s) => found.has(s)) };
}
```

- [ ] **Step 4: Run** → PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/billing/classify.ts __tests__/billing/classify.test.ts && git commit -m "feat(billing): put an invoice on the Registration or Fees tile by account, item and date

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 2.2: Settings storage + routes

**Files:**

- Create: `lib/billing/settings.server.ts`
- Create: `app/api/billing/settings/route.ts` (GET everything the settings page needs)
- Create: `app/api/billing/settings/mapping/route.ts` (PUT), `app/api/billing/settings/years/route.ts` (PUT), `app/api/billing/settings/deposit-accounts/route.ts` (PUT), `app/api/billing/settings/items/refresh/route.ts` (POST)

**Interfaces:**

- Consumes: `qboQueryAll` (Task 1.3), `classifyInvoice` + types (Task 2.1).
- Produces:
  - `loadBillingMaps(service): Promise<BillingMaps>`
  - `refreshItems(service): Promise<number>` — every QuickBooks Item (active and inactive) into `qbo_items` with its `IncomeAccountRef` id + name; returns the count.
  - `loadSettings(service): Promise<BillingSettings>` where `type BillingSettings = { accounts: Array<{ id: string; name: string; stage: StageChoice | null; itemCount: number }>; items: Array<{ id: string; name: string; accountId: string | null; accountName: string | null; stage: StageChoice | null }>; ranges: Array<{ ayCode: string; startsOn: string; endsOn: string }>; depositChoices: Array<{ id: string; name: string }>; depositAccounts: Array<{ id: string; label: string; sort: number }> }` — `accounts` is the distinct income accounts found on `qbo_items` (with the saved stage or null); `depositChoices` = QuickBooks accounts of type Bank / Other Current Asset / Credit Card.
  - `reclassifyAll(service): Promise<{ changed: string[] }>` — re-runs `classifyInvoice` on every `qbo_invoices` row of the connected company, updates `ay_code` / `stage_keys` where different, returns the affected student numbers. (Task 3.2 calls `syncTilesForStudent` on them — until then the routes just return the count.)
  - `PUT /api/billing/settings/mapping` body `{ accounts: Array<{ id, name, stage }>, items: Array<{ id, name, stage }> }` — replaces both tables, then `reclassifyAll`, audit `billing.mapping.update` (entity `billing_setting`, id `mapping`, context `{ accounts: n, items: n }`).
  - `PUT /api/billing/settings/years` body `{ ranges: Array<{ ayCode: /^AY\d{4}$/, startsOn: date10, endsOn: date10 }> }` — refuses overlapping ranges (400 "AY2026 and AY2027 overlap. A date can only belong to one year."), replaces the table, `reclassifyAll`, audit `billing.years.update`.
  - `PUT /api/billing/settings/deposit-accounts` body `{ accounts: Array<{ id, label, sort }> }` (1–10) — replaces, audit `billing.deposit_accounts.update`.
  - `POST /api/billing/settings/items/refresh` → `{ items: number }`.
  - All superadmin (`QBO_ADMIN_ROLES`); GET too.

- [ ] **Step 1: `lib/billing/settings.server.ts`**

```ts
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  classifyInvoice,
  type BillingMaps,
  type InvoiceLine,
  type StageChoice,
} from '@/lib/billing/classify';
import {
  connectedRealmId,
  qboQueryAll,
  QboNotConnectedError,
} from '@/lib/qbo/client';

export type BillingSettings = {
  accounts: Array<{
    id: string;
    name: string;
    stage: StageChoice | null;
    itemCount: number;
  }>;
  items: Array<{
    id: string;
    name: string;
    accountId: string | null;
    accountName: string | null;
    stage: StageChoice | null;
  }>;
  ranges: Array<{ ayCode: string; startsOn: string; endsOn: string }>;
  depositChoices: Array<{ id: string; name: string }>;
  depositAccounts: Array<{ id: string; label: string; sort: number }>;
};

function must<T>(
  r: { data: T | null; error: { message: string } | null },
  what: string
): T {
  if (r.error) throw new Error(`${what} failed: ${r.error.message}`);
  return (r.data ?? ([] as unknown)) as T;
}

export async function loadBillingMaps(
  service: SupabaseClient
): Promise<BillingMaps> {
  const [a, i, y] = await Promise.all([
    service.from('billing_account_map').select('qbo_account_id, stage'),
    service.from('billing_item_map').select('qbo_item_id, stage'),
    service.from('billing_year_ranges').select('ay_code, starts_on, ends_on'),
  ]);
  return {
    accounts: new Map(
      must(a, 'Account mapping lookup').map(
        (r: { qbo_account_id: string; stage: StageChoice }) => [
          r.qbo_account_id,
          r.stage,
        ]
      )
    ),
    items: new Map(
      must(i, 'Item mapping lookup').map(
        (r: { qbo_item_id: string; stage: StageChoice }) => [
          r.qbo_item_id,
          r.stage,
        ]
      )
    ),
    ranges: must(y, 'Year ranges lookup').map(
      (r: { ay_code: string; starts_on: string; ends_on: string }) => ({
        ayCode: r.ay_code,
        startsOn: r.starts_on,
        endsOn: r.ends_on,
      })
    ),
  };
}

export async function refreshItems(service: SupabaseClient): Promise<number> {
  const realmId = await connectedRealmId(service);
  if (!realmId) throw new QboNotConnectedError();
  const items = await qboQueryAll<{
    Id: string;
    Name: string;
    Active?: boolean;
    IncomeAccountRef?: { value: string; name?: string };
  }>(service, 'Item', 'Active IN (true, false)');
  const rows = items.map((it) => ({
    qbo_item_id: it.Id,
    name: it.Name,
    income_account_id: it.IncomeAccountRef?.value ?? null,
    income_account_name: it.IncomeAccountRef?.name ?? null,
    active: it.Active !== false,
    synced_at: new Date().toISOString(),
    realm_id: realmId,
  }));
  for (let k = 0; k < rows.length; k += 500) {
    const { error } = await service
      .from('qbo_items')
      .upsert(rows.slice(k, k + 500));
    if (error) throw new Error(`Saving items failed: ${error.message}`);
  }
  return rows.length;
}

export async function loadSettings(
  service: SupabaseClient
): Promise<BillingSettings> {
  const [items, am, im, y, dep] = await Promise.all([
    service
      .from('qbo_items')
      .select('qbo_item_id, name, income_account_id, income_account_name')
      .order('name'),
    service.from('billing_account_map').select('qbo_account_id, stage'),
    service.from('billing_item_map').select('qbo_item_id, stage'),
    service
      .from('billing_year_ranges')
      .select('ay_code, starts_on, ends_on')
      .order('ay_code'),
    service
      .from('billing_deposit_accounts')
      .select('qbo_account_id, label, sort')
      .order('sort'),
  ]);
  const accStage = new Map(
    must(am, 'Account mapping lookup').map(
      (r: { qbo_account_id: string; stage: StageChoice }) => [
        r.qbo_account_id,
        r.stage,
      ]
    )
  );
  const itemStage = new Map(
    must(im, 'Item mapping lookup').map(
      (r: { qbo_item_id: string; stage: StageChoice }) => [
        r.qbo_item_id,
        r.stage,
      ]
    )
  );
  const itemRows = must(items, 'Items lookup') as Array<{
    qbo_item_id: string;
    name: string;
    income_account_id: string | null;
    income_account_name: string | null;
  }>;
  const accounts = new Map<
    string,
    { id: string; name: string; stage: StageChoice | null; itemCount: number }
  >();
  for (const it of itemRows) {
    if (!it.income_account_id) continue;
    const prev = accounts.get(it.income_account_id);
    accounts.set(it.income_account_id, {
      id: it.income_account_id,
      name: it.income_account_name ?? it.income_account_id,
      stage: accStage.get(it.income_account_id) ?? null,
      itemCount: (prev?.itemCount ?? 0) + 1,
    });
  }
  let depositChoices: Array<{ id: string; name: string }> = [];
  try {
    const banks = await qboQueryAll<{ Id: string; Name: string }>(
      service,
      'Account',
      "AccountType IN ('Bank', 'Other Current Asset', 'Credit Card')"
    );
    depositChoices = banks.map((b) => ({ id: b.Id, name: b.Name }));
  } catch {
    // Not connected: the page shows the saved list only.
  }
  return {
    accounts: [...accounts.values()].sort((x, z) =>
      x.name.localeCompare(z.name)
    ),
    items: itemRows.map((it) => ({
      id: it.qbo_item_id,
      name: it.name,
      accountId: it.income_account_id,
      accountName: it.income_account_name,
      stage: itemStage.get(it.qbo_item_id) ?? null,
    })),
    ranges: must(y, 'Year ranges lookup').map(
      (r: { ay_code: string; starts_on: string; ends_on: string }) => ({
        ayCode: r.ay_code,
        startsOn: r.starts_on,
        endsOn: r.ends_on,
      })
    ),
    depositChoices,
    depositAccounts: must(dep, 'Payment accounts lookup').map(
      (r: { qbo_account_id: string; label: string; sort: number }) => ({
        id: r.qbo_account_id,
        label: r.label,
        sort: r.sort,
      })
    ),
  };
}

export async function reclassifyAll(
  service: SupabaseClient
): Promise<{ changed: string[] }> {
  const realmId = await connectedRealmId(service);
  if (!realmId) return { changed: [] };
  const maps = await loadBillingMaps(service);
  const changed = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await service
      .from('qbo_invoices')
      .select('id, student_number, txn_date, lines, ay_code, stage_keys')
      .eq('realm_id', realmId)
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(`Invoice lookup failed: ${error.message}`);
    for (const r of (data ?? []) as Array<{
      id: string;
      student_number: string;
      txn_date: string | null;
      lines: InvoiceLine[];
      ay_code: string | null;
      stage_keys: string[];
    }>) {
      const c = classifyInvoice(r.lines ?? [], r.txn_date, maps);
      if (
        c.ayCode === r.ay_code &&
        c.stageKeys.join(',') === (r.stage_keys ?? []).join(',')
      )
        continue;
      const up = await service
        .from('qbo_invoices')
        .update({ ay_code: c.ayCode, stage_keys: c.stageKeys })
        .eq('id', r.id);
      if (up.error)
        throw new Error(`Invoice update failed: ${up.error.message}`);
      changed.add(r.student_number);
    }
    if (!data || data.length < 1000) break;
  }
  return { changed: [...changed] };
}
```

- [ ] **Step 2: The routes.** Each is `requireRole([...QBO_ADMIN_ROLES])` + zod + the function + audit, following `app/api/billing/link/route.ts` (Task 1.3). Write them out in full:

`app/api/billing/settings/route.ts`:

```ts
import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { loadSettings } from '@/lib/billing/settings.server';
import { QBO_ADMIN_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

// GET /api/billing/settings — everything the Billing settings page shows.
export async function GET() {
  const auth = await requireRole([...QBO_ADMIN_ROLES]);
  if ('error' in auth) return auth.error;
  try {
    return NextResponse.json(await loadSettings(createServiceClient()));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Settings could not be read.' },
      { status: 500 }
    );
  }
}
```

`app/api/billing/settings/mapping/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { reclassifyAll } from '@/lib/billing/settings.server';
import { QBO_ADMIN_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

const Stage = z.enum(['registration', 'fees', 'none']);
const Row = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  stage: Stage,
});
const Body = z.object({
  accounts: z.array(Row).max(500),
  items: z.array(Row).max(2000),
});

// PUT /api/billing/settings/mapping — which income accounts and items put an
// invoice on the Registration / Fees tile. Replaces both lists, then
// re-applies them to every stored invoice.
export async function PUT(request: Request) {
  const auth = await requireRole([...QBO_ADMIN_ROLES]);
  if ('error' in auth) return auth.error;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
      { status: 400 }
    );
  const service = createServiceClient();
  const { accounts, items } = parsed.data;
  for (const [table, key, nameCol, rows] of [
    ['billing_account_map', 'qbo_account_id', 'account_name', accounts],
    ['billing_item_map', 'qbo_item_id', 'item_name', items],
  ] as const) {
    const del = await service.from(table).delete().neq(key, '');
    if (del.error)
      return NextResponse.json({ error: del.error.message }, { status: 500 });
    if (rows.length) {
      const ins = await service
        .from(table)
        .insert(
          rows.map((r) => ({ [key]: r.id, [nameCol]: r.name, stage: r.stage }))
        );
      if (ins.error)
        return NextResponse.json({ error: ins.error.message }, { status: 500 });
    }
  }
  const { changed } = await reclassifyAll(service);
  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
    action: 'billing.mapping.update',
    entityType: 'billing_setting',
    entityId: 'mapping',
    context: {
      accounts: accounts.length,
      items: items.length,
      students_affected: changed.length,
    },
  });
  return NextResponse.json({ ok: true, studentsAffected: changed.length });
}
```

`app/api/billing/settings/years/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { overlapMessage } from '@/lib/billing/classify';
import { reclassifyAll } from '@/lib/billing/settings.server';
import { QBO_ADMIN_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

const Date10 = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Body = z.object({
  ranges: z
    .array(
      z.object({
        ayCode: z.string().regex(/^AY\d{4}$/),
        startsOn: Date10,
        endsOn: Date10,
      })
    )
    .max(20),
});

// PUT /api/billing/settings/years — the invoice-date range of each academic
// year. Replaces the list, then re-applies it to every stored invoice.
export async function PUT(request: Request) {
  const auth = await requireRole([...QBO_ADMIN_ROLES]);
  if ('error' in auth) return auth.error;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
      { status: 400 }
    );
  const { ranges } = parsed.data;
  const overlap = overlapMessage(ranges);
  if (overlap) return NextResponse.json({ error: overlap }, { status: 400 });
  const service = createServiceClient();
  const del = await service
    .from('billing_year_ranges')
    .delete()
    .neq('ay_code', '');
  if (del.error)
    return NextResponse.json({ error: del.error.message }, { status: 500 });
  if (ranges.length) {
    const ins = await service.from('billing_year_ranges').insert(
      ranges.map((r) => ({
        ay_code: r.ayCode,
        starts_on: r.startsOn,
        ends_on: r.endsOn,
      }))
    );
    if (ins.error)
      return NextResponse.json({ error: ins.error.message }, { status: 500 });
  }
  const { changed } = await reclassifyAll(service);
  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
    action: 'billing.years.update',
    entityType: 'billing_setting',
    entityId: 'years',
    context: { ranges, students_affected: changed.length },
  });
  return NextResponse.json({ ok: true, studentsAffected: changed.length });
}
```

Add `overlapMessage` to `lib/billing/classify.ts` (exported, pure — a Next.js route file may only export HTTP handlers):

```ts
/** Why these year ranges can't be saved, or null. */
export function overlapMessage(
  ranges: Array<{ ayCode: string; startsOn: string; endsOn: string }>
): string | null {
  for (const r of ranges)
    if (r.endsOn < r.startsOn) return `${r.ayCode} ends before it starts.`;
  const sorted = [...ranges].sort((a, b) =>
    a.startsOn.localeCompare(b.startsOn)
  );
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startsOn <= sorted[i - 1].endsOn)
      return `${sorted[i - 1].ayCode} and ${sorted[i].ayCode} overlap. A date can only belong to one year.`;
  }
  return null;
}
```

and add to `__tests__/billing/classify.test.ts`:

```ts
import { overlapMessage } from '@/lib/billing/classify';

describe('overlapMessage', () => {
  it('accepts back-to-back years', () => {
    expect(
      overlapMessage([
        { ayCode: 'AY2026', startsOn: '2025-06-01', endsOn: '2026-05-31' },
        { ayCode: 'AY2027', startsOn: '2026-06-01', endsOn: '2027-05-31' },
      ])
    ).toBeNull();
  });
  it('refuses overlap', () => {
    expect(
      overlapMessage([
        { ayCode: 'AY2027', startsOn: '2026-05-01', endsOn: '2027-05-31' },
        { ayCode: 'AY2026', startsOn: '2025-06-01', endsOn: '2026-05-31' },
      ])
    ).toBe('AY2026 and AY2027 overlap. A date can only belong to one year.');
  });
  it('refuses a range that ends before it starts', () => {
    expect(
      overlapMessage([
        { ayCode: 'AY2027', startsOn: '2027-06-01', endsOn: '2026-06-01' },
      ])
    ).toBe('AY2027 ends before it starts.');
  });
});
```

`app/api/billing/settings/deposit-accounts/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { QBO_ADMIN_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

const Body = z.object({
  accounts: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().trim().min(1).max(60),
        sort: z.number().int().min(0).max(99),
      })
    )
    .min(1)
    .max(10),
});

// PUT /api/billing/settings/deposit-accounts — the accounts Record payment
// offers (HFSE: UOB, PayNow, Credit/Debit Card).
export async function PUT(request: Request) {
  const auth = await requireRole([...QBO_ADMIN_ROLES]);
  if ('error' in auth) return auth.error;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
      { status: 400 }
    );
  const service = createServiceClient();
  const del = await service
    .from('billing_deposit_accounts')
    .delete()
    .neq('qbo_account_id', '');
  if (del.error)
    return NextResponse.json({ error: del.error.message }, { status: 500 });
  const ins = await service.from('billing_deposit_accounts').insert(
    parsed.data.accounts.map((a) => ({
      qbo_account_id: a.id,
      label: a.label,
      sort: a.sort,
    }))
  );
  if (ins.error)
    return NextResponse.json({ error: ins.error.message }, { status: 500 });
  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
    action: 'billing.deposit_accounts.update',
    entityType: 'billing_setting',
    entityId: 'deposit_accounts',
    context: { labels: parsed.data.accounts.map((a) => a.label) },
  });
  return NextResponse.json({ ok: true });
}
```

`app/api/billing/settings/items/refresh/route.ts`:

```ts
import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { refreshItems } from '@/lib/billing/settings.server';
import { qboErrorMessage } from '@/lib/qbo/client';
import { QBO_ADMIN_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/billing/settings/items/refresh — re-read QuickBooks' items and
// their income accounts (new items appear in the mapping list).
export async function POST() {
  const auth = await requireRole([...QBO_ADMIN_ROLES]);
  if ('error' in auth) return auth.error;
  try {
    return NextResponse.json({
      items: await refreshItems(createServiceClient()),
    });
  } catch (e) {
    return NextResponse.json({ error: qboErrorMessage(e) }, { status: 502 });
  }
}
```

- [ ] **Step 3: Tests, tsc, cache list** — `npx vitest run --pool=threads __tests__/billing __tests__/cache` and `npx tsc --noEmit`. Add the five new routes to `NO_INVALIDATION_NEEDED` if the cache test flags them (reason: `// Billing settings tables; no cached page reads them`). Expected: PASS / clean.

- [ ] **Step 4: Try it locally** (dev server, superadmin, browser console):

```js
await (
  await fetch('/api/billing/settings/items/refresh', { method: 'POST' })
).json(); // { items: N }
const s = await (await fetch('/api/billing/settings')).json();
s.accounts.map((a) => a.name);
```

Expected: the accounts list includes "Admissions & Registration" and "Advance customers payment". Then PUT a mapping (Admissions & Registration → registration; the two Enrolment Fees accounts → fees; Advance customers payment → none; item override AY2026/AY2027 Student Devt Fees → fees), years `AY2026 2025-06-01..2026-05-31`, `AY2027 2026-06-01..2027-05-31`, and deposit accounts UOB / PayNow / Credit/Debit Card. Each returns `{ ok: true }`. Keep these settings — Phase 3 uses them.

- [ ] **Step 5: Commit**

```bash
git add lib/billing/settings.server.ts lib/billing/classify.ts __tests__/billing/classify.test.ts app/api/billing/settings && git commit -m "feat(billing): settings for the tile mapping, year ranges and payment accounts

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3 — Full sync and tiles from invoices

Gate: `npx vitest run --pool=threads __tests__/billing __tests__/qbo __tests__/cache __tests__/audit` passes, tsc clean; on the local stack after the link run: the seeded AY2027 students' Registration / Fees stages show the statuses the status table predicts; paying and voiding an invoice in the sandbox UI then pressing Refresh (API) moves the stage; review pass.

### Task 3.1: Stage from invoices (pure)

**Files:**

- Create: `lib/billing/stage-from-invoices.ts`
- Modify: `lib/qbo/stage-state.ts` (export `onlyChanges`)
- Test: `__tests__/billing/stage-from-invoices.test.ts`

**Interfaces:**

- Consumes: `StageSnapshot`, `StagePatch`, `QboStageKey`, `onlyChanges` from `lib/qbo/stage-state.ts`.
- Produces:
  - `type TileInvoice = { docNumber: string | null; txnDate: string | null; state: 'open' | 'paid' | 'voided'; paymentDate: string | null }`
  - `stageFromInvoices(stage: QboStageKey, invoices: TileInvoice[], current: StageSnapshot): StagePatch | null` — only the changed fields, `null` when nothing changes or the stage is Cancelled.
  - `tileNeedsStartDate(stage, invoices, current): boolean` — Fees, every non-voided invoice paid, at least one, stage not Paid / Cancelled, start date blank.

Rules (spec "Tile status from invoices"): ignore voided. Latest = max by `txnDate`, then by `docNumber`. None → `{ status: 'Pending', invoice: null, paymentDate: null }`. Any open → Registration `Unpaid`, Fees `Invoiced` (1) / `Re-invoiced` (2+); invoice = latest's number; paymentDate null. All paid → Registration `Finished`; Fees `Paid` if start date set, else status unchanged; paymentDate = latest `paymentDate` among them; invoice = latest's number.

- [ ] **Step 1: In `lib/qbo/stage-state.ts`** change `function onlyChanges(` to `export function onlyChanges(`. No behaviour change.

- [ ] **Step 2: Failing test**

```ts
import { describe, expect, it } from 'vitest';

import {
  stageFromInvoices,
  tileNeedsStartDate,
  type TileInvoice,
} from '@/lib/billing/stage-from-invoices';
import type { StageSnapshot } from '@/lib/qbo/stage-state';

const snap = (s: Partial<StageSnapshot> = {}): StageSnapshot => ({
  status: 'Pending',
  invoice: null,
  paymentDate: null,
  startDate: null,
  ...s,
});
const inv = (
  docNumber: string,
  txnDate: string,
  state: TileInvoice['state'],
  paymentDate: string | null = null
): TileInvoice => ({ docNumber, txnDate, state, paymentDate });

describe('stageFromInvoices — Registration', () => {
  it('no invoice, stage untouched: no change', () => {
    expect(stageFromInvoices('registration', [], snap())).toBeNull();
  });
  it('one open invoice: Unpaid + number', () => {
    expect(
      stageFromInvoices(
        'registration',
        [inv('HFSE062301', '2026-07-10', 'open')],
        snap()
      )
    ).toEqual({ status: 'Unpaid', invoice: 'HFSE062301' });
  });
  it('part paid: no change from Unpaid', () => {
    expect(
      stageFromInvoices(
        'registration',
        [inv('HFSE062301', '2026-07-10', 'open')],
        snap({ status: 'Unpaid', invoice: 'HFSE062301' })
      )
    ).toBeNull();
  });
  it('fully paid: Finished + payment date', () => {
    expect(
      stageFromInvoices(
        'registration',
        [inv('HFSE062301', '2026-07-10', 'paid', '2026-07-15')],
        snap({ status: 'Unpaid', invoice: 'HFSE062301' })
      )
    ).toEqual({ status: 'Finished', paymentDate: '2026-07-15' });
  });
  it('voided only: back to Pending, cleared', () => {
    expect(
      stageFromInvoices(
        'registration',
        [inv('HFSE062301', '2026-07-10', 'voided')],
        snap({ status: 'Unpaid', invoice: 'HFSE062301' })
      )
    ).toEqual({ status: 'Pending', invoice: null });
  });
  it('reopened after Finished: Unpaid, payment date cleared', () => {
    expect(
      stageFromInvoices(
        'registration',
        [inv('HFSE062301', '2026-07-10', 'open')],
        snap({
          status: 'Finished',
          invoice: 'HFSE062301',
          paymentDate: '2026-07-15',
        })
      )
    ).toEqual({ status: 'Unpaid', paymentDate: null });
  });
  it('Cancelled is never touched', () => {
    expect(
      stageFromInvoices(
        'registration',
        [inv('HFSE062301', '2026-07-10', 'paid', '2026-07-15')],
        snap({ status: 'Cancelled' })
      )
    ).toBeNull();
  });
});

describe('stageFromInvoices — Fees', () => {
  it('first invoice: Invoiced', () => {
    expect(
      stageFromInvoices(
        'fees',
        [inv('HFSE062302', '2026-09-01', 'open')],
        snap()
      )
    ).toEqual({ status: 'Invoiced', invoice: 'HFSE062302' });
  });
  it('a further invoice: Re-invoiced, latest number', () => {
    expect(
      stageFromInvoices(
        'fees',
        [
          inv('HFSE062302', '2026-09-01', 'open'),
          inv('HFSE062310', '2026-09-20', 'open'),
        ],
        snap({ status: 'Invoiced', invoice: 'HFSE062302' })
      )
    ).toEqual({ status: 'Re-invoiced', invoice: 'HFSE062310' });
  });
  it('older paid, newer open: Re-invoiced', () => {
    expect(
      stageFromInvoices(
        'fees',
        [
          inv('HFSE062302', '2026-09-01', 'paid', '2026-09-05'),
          inv('HFSE062310', '2026-09-20', 'open'),
        ],
        snap()
      )
    ).toEqual({ status: 'Re-invoiced', invoice: 'HFSE062310' });
  });
  it('all paid with a start date: Paid + latest payment date', () => {
    expect(
      stageFromInvoices(
        'fees',
        [
          inv('HFSE062302', '2026-09-01', 'paid', '2026-09-05'),
          inv('HFSE062310', '2026-09-20', 'paid', '2026-09-25'),
        ],
        snap({
          status: 'Re-invoiced',
          invoice: 'HFSE062310',
          startDate: '2027-01-05',
        })
      )
    ).toEqual({ status: 'Paid', paymentDate: '2026-09-25' });
  });
  it('all paid, no start date: payment date only, status waits', () => {
    const current = snap({ status: 'Invoiced', invoice: 'HFSE062302' });
    const invoices = [inv('HFSE062302', '2026-09-01', 'paid', '2026-09-05')];
    expect(stageFromInvoices('fees', invoices, current)).toEqual({
      paymentDate: '2026-09-05',
    });
    expect(tileNeedsStartDate('fees', invoices, current)).toBe(true);
  });
  it('reopened after Paid: Invoiced, payment date cleared', () => {
    expect(
      stageFromInvoices(
        'fees',
        [inv('HFSE062302', '2026-09-01', 'open')],
        snap({
          status: 'Paid',
          invoice: 'HFSE062302',
          paymentDate: '2026-09-05',
          startDate: '2027-01-05',
        })
      )
    ).toEqual({ status: 'Invoiced', paymentDate: null });
  });
  it('voided invoice is not counted toward Re-invoiced', () => {
    expect(
      stageFromInvoices(
        'fees',
        [
          inv('HFSE062302', '2026-09-01', 'voided'),
          inv('HFSE062310', '2026-09-20', 'open'),
        ],
        snap()
      )
    ).toEqual({ status: 'Invoiced', invoice: 'HFSE062310' });
  });
  it('same date: the higher number is the latest', () => {
    expect(
      stageFromInvoices(
        'fees',
        [
          inv('HFSE062311', '2026-09-20', 'open'),
          inv('HFSE062310', '2026-09-20', 'open'),
        ],
        snap()
      )?.invoice
    ).toBe('HFSE062311');
  });
});
```

- [ ] **Step 3: Run** → FAIL (module missing).

- [ ] **Step 4: Implement** — `lib/billing/stage-from-invoices.ts`:

```ts
// Registration / Fees stage from ALL the invoices the mapping puts on the tile
// (spec "Tile status from invoices"). Stateless: no stored "current invoice",
// so a reopened, voided or late-arriving invoice always lands right. Pure.

import {
  onlyChanges,
  type QboStageKey,
  type StagePatch,
  type StageSnapshot,
} from '@/lib/qbo/stage-state';

export type TileInvoice = {
  docNumber: string | null;
  txnDate: string | null;
  state: 'open' | 'paid' | 'voided';
  paymentDate: string | null;
};

const blank = (v: string | null | undefined) => !v || !v.trim();

function latestFirst(a: TileInvoice, b: TileInvoice): number {
  return (
    (b.txnDate ?? '').localeCompare(a.txnDate ?? '') ||
    (b.docNumber ?? '').localeCompare(a.docNumber ?? '')
  );
}

function target(
  stage: QboStageKey,
  invoices: TileInvoice[],
  current: StageSnapshot
): StagePatch {
  const live = invoices.filter((i) => i.state !== 'voided').sort(latestFirst);
  if (live.length === 0)
    return { status: 'Pending', invoice: null, paymentDate: null };
  const latest = live[0].docNumber;
  if (live.some((i) => i.state === 'open')) {
    const status =
      stage === 'registration'
        ? 'Unpaid'
        : live.length > 1
          ? 'Re-invoiced'
          : 'Invoiced';
    return { status, invoice: latest, paymentDate: null };
  }
  const paid = live
    .map((i) => i.paymentDate)
    .filter((d): d is string => !!d)
    .sort();
  const paymentDate = paid.length ? paid[paid.length - 1] : null;
  if (stage === 'registration')
    return { status: 'Finished', invoice: latest, paymentDate };
  if (!blank(current.startDate))
    return { status: 'Paid', invoice: latest, paymentDate };
  return { invoice: latest, paymentDate };
}

export function stageFromInvoices(
  stage: QboStageKey,
  invoices: TileInvoice[],
  current: StageSnapshot
): StagePatch | null {
  if (current.status === 'Cancelled') return null;
  return onlyChanges(target(stage, invoices, current), current);
}

export function tileNeedsStartDate(
  stage: QboStageKey,
  invoices: TileInvoice[],
  current: StageSnapshot
): boolean {
  const live = invoices.filter((i) => i.state !== 'voided');
  return (
    stage === 'fees' &&
    live.length > 0 &&
    live.every((i) => i.state === 'paid') &&
    current.status !== 'Paid' &&
    current.status !== 'Cancelled' &&
    blank(current.startDate)
  );
}
```

Check against the tests: "no invoice, stage untouched" → target Pending/null/null vs current Pending/null/null → `onlyChanges` null. "voided only" from Unpaid+number → `{ status: 'Pending', invoice: null }` (paymentDate already null, dropped). "fully paid" → invoice unchanged, dropped.

- [ ] **Step 5: Run** → PASS (15 tests). Also `npx vitest run --pool=threads __tests__/qbo/stage-state.test.ts` → still PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/billing/stage-from-invoices.ts lib/qbo/stage-state.ts __tests__/billing/stage-from-invoices.test.ts && git commit -m "feat(billing): Registration and Fees status from every invoice on the tile

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 3.2: Store invoices and payments, and move the tiles

**Files:**

- Create: `lib/billing/store.server.ts`, `lib/billing/tiles.server.ts`
- Create: `lib/billing/invoice-row.ts` (pure: QuickBooks invoice/payment → row)
- Test: `__tests__/billing/invoice-row.test.ts`

**Interfaces:**

- Consumes: `classifyInvoice`, `BillingMaps`, `InvoiceLine` (2.1); `loadBillingMaps` (2.2); `stageFromInvoices` (3.1); `invoiceState`, `QbInvoice` (`lib/qbo/invoice-snapshot.ts`); `paymentDateFor` (`lib/qbo/sync.ts`); `readStageSnapshot`, `writeStageFromQbo`, `QBO_SYSTEM_ACTOR`, `QBO_SYNC_LABEL` (`lib/qbo/stage-write.ts`).
- Produces:
  - `type QbInvoiceFull = QbInvoice & { Line?: Array<{ Amount?: number; Description?: string; DetailType?: string; SalesItemLineDetail?: { ItemRef?: { value: string; name?: string }; Qty?: number } }>; CustomerMemo?: { value?: string } }`
  - `type QbPayment = { Id: string; TxnDate?: string; TotalAmt: number; CustomerRef: { value: string }; DepositToAccountRef?: { value: string; name?: string }; PaymentRefNum?: string; Line?: Array<{ Amount?: number; LinkedTxn?: Array<{ TxnId: string; TxnType: string }> }> }`
  - `invoiceLines(inv: QbInvoiceFull, itemAccounts: Map<string, string | null>): InvoiceLine[]` — only `SalesItemLineDetail` lines.
  - `paymentApplied(p: QbPayment): Array<{ invoiceId: string; amount: number }>`
  - `upsertInvoice(service, args: { inv: QbInvoiceFull | null; qboInvoiceId: string; studentNumber: string; realmId: string; maps: BillingMaps; source?: 'created' | 'synced'; createdBy?: { id: string; email: string | null } }): Promise<{ before: { ayCode: string | null; stageKeys: string[] } | null; after: { ayCode: string | null; stageKeys: string[] } }>` — `inv: null` = deleted in QuickBooks → stored as `state: 'voided'`.
  - `upsertPayment(service, args: { p: QbPayment; studentNumber: string; realmId: string; createdBy?: { id: string; email: string | null } }): Promise<string[]>` (returns invoice ids it applies to).
  - `syncTilesForStudent(service, studentNumber: string, ayCodes?: string[]): Promise<{ changed: number; errors: string[] }>` — for each AY in `ayCodes` (default: every AY of the student's stored invoices that have a stage) and each of registration / fees: read that AY's enrolee row for the student, read the tile's invoices, `stageFromInvoices`, `writeStageFromQbo(... trigger: 'sync')`.

- [ ] **Step 1: Failing test for the pure mappers**

```ts
import { describe, expect, it } from 'vitest';

import { invoiceLines, paymentApplied } from '@/lib/billing/invoice-row';

describe('invoiceLines', () => {
  it('keeps item lines with their account, skips subtotal lines', () => {
    const lines = invoiceLines(
      {
        Id: '1',
        TotalAmt: 500,
        Balance: 500,
        SyncToken: '0',
        CustomerRef: { value: '9' },
        Line: [
          {
            Amount: 500,
            Description: 'Reg',
            DetailType: 'SalesItemLineDetail',
            SalesItemLineDetail: {
              ItemRef: { value: '30', name: 'AY2027 Registration Fee' },
              Qty: 1,
            },
          },
          { Amount: 500, DetailType: 'SubTotalLineDetail' },
        ],
      },
      new Map([['30', 'A-REG']])
    );
    expect(lines).toEqual([
      {
        itemId: '30',
        itemName: 'AY2027 Registration Fee',
        accountId: 'A-REG',
        description: 'Reg',
        qty: 1,
        amount: 500,
      },
    ]);
  });
  it('an item the SIS has not seen gets no account', () => {
    const [l] = invoiceLines(
      {
        Id: '1',
        TotalAmt: 5,
        Balance: 5,
        SyncToken: '0',
        CustomerRef: { value: '9' },
        Line: [
          {
            Amount: 5,
            DetailType: 'SalesItemLineDetail',
            SalesItemLineDetail: { ItemRef: { value: '99' } },
          },
        ],
      },
      new Map()
    );
    expect(l.accountId).toBeNull();
  });
});

describe('paymentApplied', () => {
  it('lists the invoices a payment pays and how much', () => {
    expect(
      paymentApplied({
        Id: 'P1',
        TotalAmt: 700,
        CustomerRef: { value: '9' },
        Line: [
          { Amount: 500, LinkedTxn: [{ TxnId: '1', TxnType: 'Invoice' }] },
          {
            Amount: 200,
            LinkedTxn: [
              { TxnId: '2', TxnType: 'Invoice' },
              { TxnId: 'C1', TxnType: 'CreditMemo' },
            ],
          },
        ],
      })
    ).toEqual([
      { invoiceId: '1', amount: 500 },
      { invoiceId: '2', amount: 200 },
    ]);
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: `lib/billing/invoice-row.ts`**

```ts
import type { InvoiceLine } from '@/lib/billing/classify';
import type { QbInvoice } from '@/lib/qbo/invoice-snapshot';

export type QbInvoiceFull = QbInvoice & {
  Line?: Array<{
    Amount?: number;
    Description?: string;
    DetailType?: string;
    SalesItemLineDetail?: {
      ItemRef?: { value: string; name?: string };
      Qty?: number;
    };
  }>;
  CustomerMemo?: { value?: string };
};

export type QbPayment = {
  Id: string;
  TxnDate?: string;
  TotalAmt: number;
  CustomerRef: { value: string };
  DepositToAccountRef?: { value: string; name?: string };
  PaymentRefNum?: string;
  Line?: Array<{
    Amount?: number;
    LinkedTxn?: Array<{ TxnId: string; TxnType: string }>;
  }>;
};

export function invoiceLines(
  inv: QbInvoiceFull,
  itemAccounts: Map<string, string | null>
): InvoiceLine[] {
  return (inv.Line ?? [])
    .filter((l) => l.DetailType === 'SalesItemLineDetail')
    .map((l) => {
      const itemId = l.SalesItemLineDetail?.ItemRef?.value ?? null;
      return {
        itemId,
        itemName: l.SalesItemLineDetail?.ItemRef?.name ?? null,
        accountId: itemId ? (itemAccounts.get(itemId) ?? null) : null,
        description: l.Description ?? null,
        qty: l.SalesItemLineDetail?.Qty ?? null,
        amount: Number(l.Amount ?? 0),
      };
    });
}

export function paymentApplied(
  p: QbPayment
): Array<{ invoiceId: string; amount: number }> {
  const out: Array<{ invoiceId: string; amount: number }> = [];
  for (const l of p.Line ?? []) {
    for (const t of l.LinkedTxn ?? [])
      if (t.TxnType === 'Invoice')
        out.push({ invoiceId: t.TxnId, amount: Number(l.Amount ?? 0) });
  }
  return out;
}
```

Run the test → PASS (3 tests).

- [ ] **Step 4: `lib/billing/store.server.ts`**

```ts
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { classifyInvoice, type BillingMaps } from '@/lib/billing/classify';
import {
  invoiceLines,
  paymentApplied,
  type QbInvoiceFull,
  type QbPayment,
} from '@/lib/billing/invoice-row';
import { invoiceState } from '@/lib/qbo/invoice-snapshot';
import { qboRequest } from '@/lib/qbo/client';
import { paymentDateFor } from '@/lib/qbo/sync';

type Place = { ayCode: string | null; stageKeys: string[] };

/** Item → income account, reading QuickBooks for any item not cached yet. */
async function itemAccounts(
  service: SupabaseClient,
  inv: QbInvoiceFull,
  realmId: string
): Promise<Map<string, string | null>> {
  const ids = [
    ...new Set(
      (inv.Line ?? [])
        .map((l) => l.SalesItemLineDetail?.ItemRef?.value)
        .filter((v): v is string => !!v)
    ),
  ];
  const map = new Map<string, string | null>();
  if (!ids.length) return map;
  const { data, error } = await service
    .from('qbo_items')
    .select('qbo_item_id, income_account_id')
    .in('qbo_item_id', ids);
  if (error) throw new Error(`Items lookup failed: ${error.message}`);
  for (const r of data ?? []) map.set(r.qbo_item_id, r.income_account_id);
  for (const id of ids.filter((i) => !map.has(i))) {
    const { Item } = await qboRequest<{
      Item: {
        Id: string;
        Name: string;
        Active?: boolean;
        IncomeAccountRef?: { value: string; name?: string };
      };
    }>(service, 'GET', `/item/${id}`);
    map.set(id, Item.IncomeAccountRef?.value ?? null);
    await service.from('qbo_items').upsert({
      qbo_item_id: Item.Id,
      name: Item.Name,
      income_account_id: Item.IncomeAccountRef?.value ?? null,
      income_account_name: Item.IncomeAccountRef?.name ?? null,
      active: Item.Active !== false,
      realm_id: realmId,
    });
  }
  return map;
}

export async function upsertInvoice(
  service: SupabaseClient,
  args: {
    inv: QbInvoiceFull | null;
    qboInvoiceId: string;
    studentNumber: string;
    realmId: string;
    maps: BillingMaps;
    source?: 'created' | 'synced';
    createdBy?: { id: string; email: string | null };
  }
): Promise<{ before: Place | null; after: Place }> {
  const { data: prev, error: prevErr } = await service
    .from('qbo_invoices')
    .select('id, ay_code, stage_keys, lines, txn_date')
    .eq('qbo_invoice_id', args.qboInvoiceId)
    .maybeSingle();
  if (prevErr) throw new Error(`Invoice lookup failed: ${prevErr.message}`);
  const before: Place | null = prev
    ? { ayCode: prev.ay_code, stageKeys: prev.stage_keys ?? [] }
    : null;

  if (!args.inv) {
    // Deleted in QuickBooks: keep the row, mark it voided, keep its place so
    // the tile it was on is recomputed.
    if (prev) {
      const up = await service
        .from('qbo_invoices')
        .update({
          state: 'voided',
          balance: 0,
          synced_at: new Date().toISOString(),
        })
        .eq('id', prev.id);
      if (up.error)
        throw new Error(`Invoice update failed: ${up.error.message}`);
    }
    return { before, after: before ?? { ayCode: null, stageKeys: [] } };
  }

  const inv = args.inv;
  const lines = invoiceLines(
    inv,
    await itemAccounts(service, inv, args.realmId)
  );
  const place = classifyInvoice(lines, inv.TxnDate ?? null, args.maps);
  const state = invoiceState(inv);
  const row = {
    qbo_invoice_id: inv.Id,
    qbo_customer_id: inv.CustomerRef.value,
    student_number: args.studentNumber,
    doc_number: inv.DocNumber ?? null,
    txn_date: inv.TxnDate ?? null,
    due_date: inv.DueDate ?? null,
    total: Number(inv.TotalAmt),
    balance: Number(inv.Balance),
    state,
    payment_date: state === 'paid' ? await paymentDateFor(service, inv) : null,
    lines,
    memo: inv.CustomerMemo?.value ?? null,
    private_note: inv.PrivateNote ?? null,
    ay_code: place.ayCode,
    stage_keys: place.stageKeys,
    sync_token: inv.SyncToken,
    synced_at: new Date().toISOString(),
    realm_id: args.realmId,
  };
  const res = prev
    ? await service.from('qbo_invoices').update(row).eq('id', prev.id)
    : await service.from('qbo_invoices').insert({
        ...row,
        source: args.source ?? 'synced',
        is_current: false,
        created_by: args.createdBy?.id ?? null,
        created_by_email: args.createdBy?.email ?? null,
      });
  if (res.error)
    throw new Error(
      `Saving invoice ${inv.DocNumber ?? inv.Id} failed: ${res.error.message}`
    );
  return { before, after: place };
}

export async function upsertPayment(
  service: SupabaseClient,
  args: {
    p: QbPayment;
    studentNumber: string;
    realmId: string;
    createdBy?: { id: string; email: string | null };
  }
): Promise<string[]> {
  const applied = paymentApplied(args.p);
  const { error } = await service.from('qbo_payments').upsert({
    qbo_payment_id: args.p.Id,
    qbo_customer_id: args.p.CustomerRef.value,
    student_number: args.studentNumber,
    txn_date: args.p.TxnDate ?? null,
    total: Number(args.p.TotalAmt),
    deposit_account_id: args.p.DepositToAccountRef?.value ?? null,
    deposit_account_name: args.p.DepositToAccountRef?.name ?? null,
    reference: args.p.PaymentRefNum ?? null,
    applied,
    ...(args.createdBy
      ? {
          created_by: args.createdBy.id,
          created_by_email: args.createdBy.email,
        }
      : {}),
    synced_at: new Date().toISOString(),
    realm_id: args.realmId,
  });
  if (error) throw new Error(`Saving payment failed: ${error.message}`);
  return applied.map((a) => a.invoiceId);
}
```

Note: `paymentDateFor` lives in `lib/qbo/sync.ts`, which Task 3.3 rewrites — keep `paymentDateFor` exported from there unchanged.

- [ ] **Step 5: `lib/billing/tiles.server.ts`**

```ts
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  stageFromInvoices,
  type TileInvoice,
} from '@/lib/billing/stage-from-invoices';
import { QBO_STAGE_KEYS } from '@/lib/qbo/stage-state';
import {
  QBO_SYNC_LABEL,
  QBO_SYSTEM_ACTOR,
  readStageSnapshot,
  writeStageFromQbo,
} from '@/lib/qbo/stage-write';
import { connectedRealmId } from '@/lib/qbo/client';

/**
 * Recompute the Registration and Fees stages of one student from their stored
 * invoices, for the given years (default: every year one of their invoices is
 * on a tile). A year where the student has no admissions row is skipped.
 */
export async function syncTilesForStudent(
  service: SupabaseClient,
  studentNumber: string,
  ayCodes?: string[]
): Promise<{ changed: number; errors: string[] }> {
  const realmId = await connectedRealmId(service);
  if (!realmId) return { changed: 0, errors: [] };
  const { data, error } = await service
    .from('qbo_invoices')
    .select('doc_number, txn_date, state, payment_date, ay_code, stage_keys')
    .eq('student_number', studentNumber)
    .eq('realm_id', realmId);
  if (error) throw new Error(`Invoice lookup failed: ${error.message}`);
  const rows = (data ?? []) as Array<{
    doc_number: string | null;
    txn_date: string | null;
    state: TileInvoice['state'];
    payment_date: string | null;
    ay_code: string | null;
    stage_keys: string[];
  }>;
  const years = ayCodes ?? [
    ...new Set(
      rows
        .filter((r) => r.ay_code && r.stage_keys?.length)
        .map((r) => r.ay_code!)
    ),
  ];

  let changed = 0;
  const errors: string[] = [];
  for (const ayCode of years) {
    const { data: app } = await service
      .from(`ay${ayCode.slice(2)}_enrolment_applications`)
      .select('"enroleeNumber"')
      .eq('studentNumber', studentNumber)
      .order('enroleeNumber', { ascending: false })
      .limit(1)
      .maybeSingle();
    const enroleeNumber = (app as { enroleeNumber: string } | null)
      ?.enroleeNumber;
    if (!enroleeNumber) continue;
    for (const stage of QBO_STAGE_KEYS) {
      const current = await readStageSnapshot(
        service,
        ayCode,
        enroleeNumber,
        stage
      );
      if (!current) continue;
      const tile: TileInvoice[] = rows
        .filter(
          (r) => r.ay_code === ayCode && (r.stage_keys ?? []).includes(stage)
        )
        .map((r) => ({
          docNumber: r.doc_number,
          txnDate: r.txn_date,
          state: r.state,
          paymentDate: r.payment_date,
        }));
      const patch = stageFromInvoices(stage, tile, current);
      if (!patch) continue;
      const res = await writeStageFromQbo(service, {
        ayCode,
        enroleeNumber,
        stage,
        patch,
        actor: QBO_SYSTEM_ACTOR,
        updatedBy: QBO_SYNC_LABEL,
        docNumber: patch.invoice ?? current.invoice ?? null,
        trigger: 'sync',
      });
      if (res.ok) changed += res.changed > 0 ? 1 : 0;
      else errors.push(`${ayCode} ${stage}: ${res.error}`);
    }
  }
  return { changed, errors };
}
```

A tile whose only invoice moved to another year must still be recomputed: callers pass the union of `before.ayCode` and `after.ayCode` (Task 3.3).

- [ ] **Step 6: tsc** — `npx tsc --noEmit` → clean.

- [ ] **Step 7: Commit**

```bash
git add lib/billing/invoice-row.ts lib/billing/store.server.ts lib/billing/tiles.server.ts __tests__/billing/invoice-row.test.ts && git commit -m "feat(billing): store a customer's invoices and payments and recompute their tiles

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 3.3: First load, widened sync, Refresh

**Files:**

- Create: `lib/billing/history.server.ts`
- Modify: `lib/qbo/sync.ts` (rewrite `refreshInvoice` / `refreshInvoicesForPayment` onto the store; keep `paymentDateFor` and both function names + return shapes so `lib/qbo/cdc.ts`, the webhook and the cron route are unchanged)
- Modify: `lib/billing/link-run.server.ts`, `app/api/billing/students/[studentNumber]/link/route.ts`, `app/api/billing/settings/mapping/route.ts`, `app/api/billing/settings/years/route.ts` (call history / tiles)
- Create: `app/api/billing/students/[studentNumber]/refresh/route.ts`

**Interfaces:**

- Consumes: everything from 3.2; `loadBillingMaps`; `qboQueryAll`.
- Produces:
  - `studentForCustomer(service, customerId: string, realmId: string): Promise<string | null>` — student number linked to the customer.
  - `loadCustomerHistory(service, studentNumber: string): Promise<{ invoices: number; payments: number; tilesChanged: number; errors: string[] }>` — every invoice and payment of the student's linked customer into the store, then `syncTilesForStudent` for every year touched.
  - `refreshInvoice(service, qboInvoiceId)` → `{ known: boolean; stageChanged: boolean; stageError?: string }` — `known` now means "the invoice's customer is linked to a student".
  - `refreshInvoicesForPayment(service, paymentId)` → `{ updated: number; errors: string[] }`.
  - `POST /api/billing/students/[studentNumber]/refresh` → the `loadCustomerHistory` result. Billing roles.

- [ ] **Step 1: `lib/billing/history.server.ts`**

```ts
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { QbInvoiceFull, QbPayment } from '@/lib/billing/invoice-row';
import { loadBillingMaps } from '@/lib/billing/settings.server';
import { upsertInvoice, upsertPayment } from '@/lib/billing/store.server';
import { syncTilesForStudent } from '@/lib/billing/tiles.server';
import {
  connectedRealmId,
  qbEscape,
  qboQueryAll,
  QboNotConnectedError,
} from '@/lib/qbo/client';

export async function studentForCustomer(
  service: SupabaseClient,
  customerId: string,
  realmId: string
): Promise<string | null> {
  const { data, error } = await service
    .from('qbo_customers')
    .select('student_number')
    .eq('qbo_customer_id', customerId)
    .eq('realm_id', realmId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Linked customer lookup failed: ${error.message}`);
  return (data as { student_number: string } | null)?.student_number ?? null;
}

export async function loadCustomerHistory(
  service: SupabaseClient,
  studentNumber: string
) {
  const realmId = await connectedRealmId(service);
  if (!realmId) throw new QboNotConnectedError();
  const { data: link, error } = await service
    .from('qbo_customers')
    .select('qbo_customer_id')
    .eq('student_number', studentNumber)
    .eq('realm_id', realmId)
    .maybeSingle();
  if (error) throw new Error(`Linked customer lookup failed: ${error.message}`);
  if (!link)
    return {
      invoices: 0,
      payments: 0,
      tilesChanged: 0,
      errors: ['This student is not linked to a QuickBooks customer yet.'],
    };
  const cust = `CustomerRef = '${qbEscape(link.qbo_customer_id)}'`;
  const [invoices, payments, maps] = await Promise.all([
    qboQueryAll<QbInvoiceFull>(service, 'Invoice', cust),
    qboQueryAll<QbPayment>(service, 'Payment', cust),
    loadBillingMaps(service),
  ]);
  const years = new Set<string>();
  for (const p of payments)
    await upsertPayment(service, { p, studentNumber, realmId });
  for (const inv of invoices) {
    const r = await upsertInvoice(service, {
      inv,
      qboInvoiceId: inv.Id,
      studentNumber,
      realmId,
      maps,
    });
    if (r.before?.ayCode) years.add(r.before.ayCode);
    if (r.after.ayCode) years.add(r.after.ayCode);
  }
  const tiles = await syncTilesForStudent(service, studentNumber, [...years]);
  return {
    invoices: invoices.length,
    payments: payments.length,
    tilesChanged: tiles.changed,
    errors: tiles.errors,
  };
}
```

- [ ] **Step 2: Rewrite `lib/qbo/sync.ts`.** Keep the imports it still needs, keep `paymentDateFor` and `fetchInvoice` exactly as they are, and replace `refreshInvoice` and `refreshInvoicesForPayment` with:

```ts
type QbInvoiceFull = import('@/lib/billing/invoice-row').QbInvoiceFull;
type QbPayment = import('@/lib/billing/invoice-row').QbPayment;

/**
 * Re-reads one invoice from QuickBooks into the Billing store and recomputes
 * the student's tiles for the year(s) it was and is on. Invoices of customers
 * not linked to a student are ignored (linking loads their history).
 */
export async function refreshInvoice(
  service: SupabaseClient,
  qboInvoiceId: string
): Promise<{ known: boolean; stageChanged: boolean; stageError?: string }> {
  const { loadBillingMaps } = await import('@/lib/billing/settings.server');
  const { studentForCustomer } = await import('@/lib/billing/history.server');
  const { upsertInvoice } = await import('@/lib/billing/store.server');
  const { syncTilesForStudent } = await import('@/lib/billing/tiles.server');

  const realmId = await connectedRealmId(service);
  if (!realmId) return { known: false, stageChanged: false };
  const inv = (await fetchInvoice(
    service,
    qboInvoiceId
  )) as QbInvoiceFull | null;
  let studentNumber: string | null = null;
  if (inv) {
    studentNumber = await studentForCustomer(
      service,
      inv.CustomerRef.value,
      realmId
    );
  } else {
    // Deleted: find the student from the stored row.
    const { data } = await service
      .from('qbo_invoices')
      .select('student_number')
      .eq('qbo_invoice_id', qboInvoiceId)
      .eq('realm_id', realmId)
      .maybeSingle();
    studentNumber =
      (data as { student_number: string } | null)?.student_number ?? null;
  }
  if (!studentNumber) return { known: false, stageChanged: false };
  const r = await upsertInvoice(service, {
    inv,
    qboInvoiceId,
    studentNumber,
    realmId,
    maps: await loadBillingMaps(service),
  });
  const years = [r.before?.ayCode, r.after.ayCode].filter(
    (y): y is string => !!y
  );
  const tiles = await syncTilesForStudent(service, studentNumber, [
    ...new Set(years),
  ]);
  return {
    known: true,
    stageChanged: tiles.changed > 0,
    ...(tiles.errors.length ? { stageError: tiles.errors.join(' · ') } : {}),
  };
}

/** A payment changed: store it, then refresh every invoice it pays. */
export async function refreshInvoicesForPayment(
  service: SupabaseClient,
  paymentId: string
): Promise<{ updated: number; errors: string[] }> {
  const { studentForCustomer } = await import('@/lib/billing/history.server');
  const { upsertPayment } = await import('@/lib/billing/store.server');
  const realmId = await connectedRealmId(service);
  if (!realmId) return { updated: 0, errors: [] };
  let payment: QbPayment | null = null;
  try {
    payment = (
      await qboRequest<{ Payment: QbPayment }>(
        service,
        'GET',
        `/payment/${paymentId}`
      )
    ).Payment;
  } catch (e) {
    if (e instanceof QboError && e.code === '610') {
      // Deleted: drop our copy; its invoices arrive as Invoice changes.
      await service
        .from('qbo_payments')
        .delete()
        .eq('qbo_payment_id', paymentId);
      return { updated: 0, errors: [] };
    }
    throw e;
  }
  const studentNumber = await studentForCustomer(
    service,
    payment.CustomerRef.value,
    realmId
  );
  if (!studentNumber) return { updated: 0, errors: [] };
  const ids = await upsertPayment(service, {
    p: payment,
    studentNumber,
    realmId,
  });
  let updated = 0;
  const errors: string[] = [];
  for (const id of new Set(ids)) {
    try {
      const r = await refreshInvoice(service, id);
      if (r.known) updated++;
      if (r.stageError) errors.push(`Invoice ${id}: ${r.stageError}`);
    } catch (e) {
      errors.push(`Invoice ${id}: ${qboErrorMessage(e)}`);
    }
  }
  return { updated, errors };
}
```

Remove the now-unused imports from the top of `lib/qbo/sync.ts` (`readStageSnapshot`, `writeStageFromQbo`, `QBO_SYNC_LABEL`, `QBO_SYSTEM_ACTOR`, `handledFields`, `isQboStageKey`, `stageOnInvoiceChange`, `invoiceState`, the `InvoiceRow` type) — tsc will name any left. The dynamic imports avoid an import cycle (`store.server.ts` imports `paymentDateFor` from this file). The KD #231 refresh route (`app/api/sis/students/[enroleeNumber]/stage/[stageKey]/invoice/refresh/route.ts`) still calls `refreshInvoice` and keeps working.

- [ ] **Step 3: Refresh route** — `app/api/billing/students/[studentNumber]/refresh/route.ts`:

```ts
import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { loadCustomerHistory } from '@/lib/billing/history.server';
import { qboErrorMessage } from '@/lib/qbo/client';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/billing/students/[studentNumber]/refresh — re-read this student's
// whole QuickBooks history and recompute their tiles.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ studentNumber: string }> }
) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const { studentNumber } = await params;
  try {
    return NextResponse.json(
      await loadCustomerHistory(createServiceClient(), studentNumber)
    );
  } catch (e) {
    return NextResponse.json({ error: qboErrorMessage(e) }, { status: 502 });
  }
}
```

- [ ] **Step 4: Wire history and tiles into the earlier routes**

- `lib/billing/link-run.server.ts` — after the review list is saved, before `logAction`, load the history of each newly linked student, one at a time (QuickBooks allows ~500 calls a minute; two queries per student):

```ts
const { loadCustomerHistory } = await import('@/lib/billing/history.server');
const historyErrors: string[] = [];
for (const sn of result.newlyLinked) {
  try {
    const h = await loadCustomerHistory(service, sn);
    historyErrors.push(...h.errors.map((e) => `${sn}: ${e}`));
  } catch (e) {
    historyErrors.push(`${sn}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
```

and add `historyErrors: string[]` to `LinkRunResult` (empty on a dry run), included in the audit context as `history_errors: historyErrors.length`.

- `app/api/billing/students/[studentNumber]/link/route.ts` — after the audit row: `const history = await loadCustomerHistory(service, studentNumber).catch((e) => ({ errors: [qboErrorMessage(e)] }));` and return `{ ok: true, displayName, historyErrors: history.errors }`.
- `app/api/billing/settings/mapping/route.ts` and `.../years/route.ts` — after `reclassifyAll`, recompute every affected student's tiles across the years in `billing_year_ranges`:

```ts
const { syncTilesForStudent } = await import('@/lib/billing/tiles.server');
const years =
  (await service.from('billing_year_ranges').select('ay_code')).data?.map(
    (r) => r.ay_code as string
  ) ?? [];
for (const sn of changed) await syncTilesForStudent(service, sn, years);
```

- [ ] **Step 5: Tests + tsc**

Run: `npx vitest run --pool=threads __tests__/billing __tests__/qbo __tests__/cache __tests__/audit` and `npx tsc --noEmit`.
Expected: PASS / clean. `__tests__/qbo/stage-state.test.ts` still passes (`stageOnInvoiceChange` is unused now but stays until Phase 5). Add the refresh route to `NO_INVALIDATION_NEEDED` only if the cache test flags it — it writes stages, but through `writeStageFromQbo`, which already expires the cache tags; use the reason `// Stage writes go through writeStageFromQbo, which expires the tags`.

- [ ] **Step 6: End-to-end on the local stack**

1. Run the link (`dryRun: false`, Task 1.3 Step 6). Expected response: `historyErrors: []`.
2. `docker exec -i supabase_db_hfse-markbook psql -U postgres -d postgres -c "select ay_code, stage_keys, state, count(*) from qbo_invoices group by 1,2,3 order by 1,2,3"` — AY2027 rows with `{registration}` and `{fees}`, AY2026 rows with `{fees}`, tuition rows with `{}`.
3. Pick a seeded AY2027 student whose Registration invoice was paid: their `registrationStatus` is `Finished` with a payment date; one with an unpaid Fees invoice shows `Invoiced`; a part-paid one also `Invoiced`; a returning AY2026 student's AY2027 Fees tile is unchanged.
4. In the sandbox UI (app.sandbox.qbo.intuit.com), receive a payment for one open AY2027 Fees invoice, then `POST /api/billing/students/<studentNumber>/refresh`. Expected: `tilesChanged: 1`; with a Fees start date set the stage is `Paid`, without one it keeps its status and gains the payment date.
5. Void that invoice in the sandbox, refresh again. Expected: Fees back to `Pending`, number and payment date cleared.

- [ ] **Step 7: Commit**

```bash
git add lib/billing/history.server.ts lib/qbo/sync.ts lib/billing/link-run.server.ts "app/api/billing/students/[studentNumber]/link/route.ts" "app/api/billing/students/[studentNumber]/refresh/route.ts" app/api/billing/settings/mapping/route.ts app/api/billing/settings/years/route.ts && git commit -m "feat(billing): keep every invoice and payment of a linked customer in step

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(Add `__tests__/cache/write-route-invalidation.test.ts` if Step 5 changed it.)

---

## After Phase 3

Write `docs/superpowers/plans/2026-10-15-billing-module-phases-4-5.md` (Customers, Customer page, To review, Settings page, Create invoice moved + duplicate note, Record payment + `qbo.payment.create`, read-only tiles, migration 190 dropping `enrolee_number` / `stage_key` / `is_current` and the KD #231 tile routes, `/sis/admin/quickbooks` redirect, module registration in `lib/auth/roles.ts` + `lib/sidebar/registry.ts`) — after the frontend-design pass and a mockup Mr Ace approves.
