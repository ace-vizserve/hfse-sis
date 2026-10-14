# QuickBooks invoicing for Registration and Fees — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff create or link a QuickBooks Online invoice from a student's Registration or Fees stage, and QuickBooks payments and voids move that stage by themselves.

**Architecture:** A small `lib/qbo/` layer (env, token-refreshing fetch client, pure status rules, webhook parsing, name matching) under four server-only tables (migration 188). Routes call QuickBooks first and only then write the SIS. One function, `refreshInvoice`, serves the webhook, the hourly CDC cron and the tile's Refresh button; it writes the stage through one helper that enforces the existing required-field rules and writes the existing `sis.stage.update` audit row.

**Tech Stack:** Next.js 16 route handlers, Supabase (service role), zod 4, vitest (`--pool=threads`), React 19 client components, shadcn primitives, `@tanstack/react-query` + `useWriteAction`.

**Spec:** `docs/superpowers/specs/2026-10-14-quickbooks-registration-fees-invoicing-design.md`

## Global Constraints

- Statuses are only the existing ones: Registration `Pending · Unpaid · Finished · Cancelled`; Fees `Pending · Invoiced · Re-invoiced · Paid · Cancelled`. None added.
- Cancelled is staff-only: the sync never sets it and never changes a Cancelled stage.
- Re-invoiced = a new invoice was sent for a Fees stage that already had one. The old invoice is never voided by the SIS.
- The latest invoice (`is_current`) is the only one that moves the stage.
- QuickBooks wins on money (total, balance, paid, voided).
- `STAGE_STATUS_REQUIRED_FIELDS` stays enforced on every sync write (Fees Paid needs invoice + payment date + start date).
- Invoice buttons: `admissions`, `school_admin`, `superadmin` only. Connect / disconnect: `superadmin` only.
- Tokens live only in `qbo_connection` (RLS on, no policies, `anon`/`authenticated` revoked) — never in `school_config`.
- Every SIS-created invoice carries PrivateNote `Created from SIS by {staff name}`.
- Sync audit actor: `{ id: null, email: 'system:quickbooks-sync', role: null }`; stage updated-by column = `QuickBooks sync`.
- New audit actions: `qbo.invoice.create`, `qbo.invoice.link`, `qbo.connection.connect`, `qbo.connection.disconnect`.
- Migration number 188. Applied to the LOCAL stack only in this plan; production apply is Mr Ace's.
- Hard Rule #7: tokens only from `app/globals.css`; no raw colours, no `slate-*`/`gray-*`.
- KD #227: a sheet with a footer pins it (`SheetContent flex flex-col gap-0`, body `min-h-0 flex-1 overflow-y-auto`, footer outside the body).
- Plain-English UI copy; no "webhook", "CDC", "token", "realm" on any staff screen.
- Tests: `npx vitest run --pool=threads <path>`. Tests import `describe/it/expect` from `vitest` explicitly.
- Edits via Edit/Write tools only — never PowerShell or script file writes. Commit as ONE command: `git add <paths> && git commit -m ...`.

**Deliberate deviation from the spec:** the spec named `intuit-oauth` for the OAuth flow. The sandbox spike already proved the two token calls with plain `fetch` (`scripts/qbo/sandbox-test.ts`), so this plan uses `fetch` and adds no dependency. Nothing user-visible changes.

## Review Focus

1. **QuickBooks accepts the invoice but the SIS save fails** — the person must be told the QB number and to use Link QB invoice; nothing is retried blindly. Test: Task 2.3 `createdButNotSaved` message test.
2. **A payment is deleted in QuickBooks after the stage went Finished/Paid** — balance reopens, so the stage must go back to Unpaid / Invoiced and the payment date clear. Test: Task 1.2 "reopened" cases.
3. **Intuit's webhook arrives in the newer CloudEvents shape instead of `eventNotifications`** — both shapes must yield the same entity list. Test: Task 1.3 CloudEvents case.
4. **Linking an invoice that belongs to a different customer, or one already linked to another stage** — refused with a clear message. Test: Task 2.3 `linkRefusal` tests.
5. **Fees fully paid while the start date is blank, then staff add the start date** — the sync fills the payment date but holds the status; the tile keeps saying "add the start date" until Paid. Test: Task 1.2 `needsStartDate` cases.

---

## Phase 1 — Data and pure rules

Gate: `npx vitest run --pool=threads __tests__/qbo __tests__/audit` passes, `npx tsc --noEmit` clean, migration applies on the local stack, then a code-review pass on the phase diff before Phase 2.

### Task 1.1: Migration 188 — the four QuickBooks tables

**Files:**

- Create: `supabase/migrations/188_quickbooks_invoicing.sql`

**Interfaces:**

- Produces tables `qbo_connection`, `qbo_customers`, `qbo_invoices`, `qbo_sync_runs` with exactly the columns below; later tasks use these names verbatim.

- [ ] **Step 1: Write the migration**

```sql
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
  matched_at timestamptz not null default now()
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
  synced_at timestamptz not null default now()
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
```

- [ ] **Step 2: Apply to the local stack and check**

Run (Git Bash):

```bash
docker exec -i supabase_db_hfse-markbook psql -U postgres -d postgres < supabase/migrations/188_quickbooks_invoicing.sql
docker exec -i supabase_db_hfse-markbook psql -U postgres -d postgres -c "select table_name from information_schema.tables where table_name like 'qbo_%' order by 1;"
```

Expected: 4 rows — `qbo_connection`, `qbo_customers`, `qbo_invoices`, `qbo_sync_runs`.

Run:

```bash
docker exec -i supabase_db_hfse-markbook psql -U postgres -d postgres -c "set role authenticated; select count(*) from public.qbo_connection;"
```

Expected: `ERROR:  permission denied for table qbo_connection`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/188_quickbooks_invoicing.sql && git commit -m "feat(qbo): migration 188 — QuickBooks invoicing tables (server-only)"
```

### Task 1.2: Status rules — `lib/qbo/stage-state.ts`

**Files:**

- Create: `lib/qbo/stage-state.ts`
- Test: `__tests__/qbo/stage-state.test.ts`

**Interfaces:**

- Produces:
  - `type QboStageKey = 'registration' | 'fees'`, `const QBO_STAGE_KEYS: readonly QboStageKey[]`, `isQboStageKey(v: string): v is QboStageKey`
  - `type InvoiceState = 'open' | 'paid' | 'voided'`
  - `type StageSnapshot = { status: string | null; invoice: string | null; paymentDate: string | null; startDate: string | null }`
  - `type InvoiceSnapshot = { docNumber: string; state: InvoiceState; paymentDate: string | null }`
  - `type StagePatch = { status?: string | null; invoice?: string | null; paymentDate?: string | null }`
  - `stageOnNewInvoice(stage, current, invoice): StagePatch | null`
  - `stageOnInvoiceChange(stage, current, invoice): StagePatch | null` (null = nothing to write)
  - `needsStartDate(stage, current, state: InvoiceState | null): boolean`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import {
  needsStartDate,
  stageOnInvoiceChange,
  stageOnNewInvoice,
  type StageSnapshot,
} from '@/lib/qbo/stage-state';

const blank: StageSnapshot = {
  status: 'Pending',
  invoice: null,
  paymentDate: null,
  startDate: null,
};
const open = (docNumber = '1042') =>
  ({ docNumber, state: 'open', paymentDate: null }) as const;
const paid = (docNumber = '1042', paymentDate = '2026-10-20') =>
  ({ docNumber, state: 'paid', paymentDate }) as const;
const voided = (docNumber = '1042') =>
  ({ docNumber, state: 'voided', paymentDate: null }) as const;

describe('a new invoice on the stage', () => {
  it('Registration → Unpaid with the number', () => {
    expect(stageOnNewInvoice('registration', blank, open())).toEqual({
      status: 'Unpaid',
      invoice: '1042',
      paymentDate: null,
    });
  });

  it('a second Registration invoice stays Unpaid with the new number', () => {
    expect(
      stageOnNewInvoice(
        'registration',
        { ...blank, status: 'Unpaid', invoice: '1042' },
        open('1050')
      )
    ).toEqual({ status: 'Unpaid', invoice: '1050', paymentDate: null });
  });

  it('first Fees invoice → Invoiced', () => {
    expect(stageOnNewInvoice('fees', blank, open())).toEqual({
      status: 'Invoiced',
      invoice: '1042',
      paymentDate: null,
    });
  });

  it('Fees that already had an invoice (even one typed by hand) → Re-invoiced', () => {
    expect(
      stageOnNewInvoice(
        'fees',
        { ...blank, status: 'Invoiced', invoice: 'INV-77 ' },
        open('1050')
      )
    ).toEqual({ status: 'Re-invoiced', invoice: '1050', paymentDate: null });
  });

  it('linking an invoice that is already paid goes straight to Finished', () => {
    expect(stageOnNewInvoice('registration', blank, paid())).toEqual({
      status: 'Finished',
      invoice: '1042',
      paymentDate: '2026-10-20',
    });
  });

  it('never touches a Cancelled stage', () => {
    expect(
      stageOnNewInvoice('fees', { ...blank, status: 'Cancelled' }, open())
    ).toBeNull();
  });
});

describe('QuickBooks changed the current invoice', () => {
  const regUnpaid: StageSnapshot = {
    ...blank,
    status: 'Unpaid',
    invoice: '1042',
  };
  const feesInvoiced: StageSnapshot = {
    ...blank,
    status: 'Invoiced',
    invoice: '1042',
  };

  it('part payment changes nothing', () => {
    expect(stageOnInvoiceChange('registration', regUnpaid, open())).toBeNull();
    expect(stageOnInvoiceChange('fees', feesInvoiced, open())).toBeNull();
  });

  it('Registration fully paid → Finished + payment date', () => {
    expect(stageOnInvoiceChange('registration', regUnpaid, paid())).toEqual({
      status: 'Finished',
      paymentDate: '2026-10-20',
    });
  });

  it('Fees fully paid with a start date → Paid + payment date', () => {
    expect(
      stageOnInvoiceChange(
        'fees',
        { ...feesInvoiced, startDate: '2027-01-05' },
        paid()
      )
    ).toEqual({ status: 'Paid', paymentDate: '2026-10-20' });
  });

  it('Fees fully paid with no start date → payment date only, status held', () => {
    expect(stageOnInvoiceChange('fees', feesInvoiced, paid())).toEqual({
      paymentDate: '2026-10-20',
    });
  });

  it('Re-invoiced fully paid with a start date → Paid', () => {
    expect(
      stageOnInvoiceChange(
        'fees',
        { ...feesInvoiced, status: 'Re-invoiced', startDate: '2027-01-05' },
        paid()
      )
    ).toEqual({ status: 'Paid', paymentDate: '2026-10-20' });
  });

  it('voided → Pending, number and payment date cleared', () => {
    expect(stageOnInvoiceChange('fees', feesInvoiced, voided())).toEqual({
      status: 'Pending',
      invoice: null,
    });
    expect(
      stageOnInvoiceChange(
        'registration',
        { ...regUnpaid, status: 'Finished', paymentDate: '2026-10-20' },
        voided()
      )
    ).toEqual({ status: 'Pending', invoice: null, paymentDate: null });
  });

  it('reopened after a payment was deleted: Finished → Unpaid, Paid → Invoiced', () => {
    expect(
      stageOnInvoiceChange(
        'registration',
        { ...regUnpaid, status: 'Finished', paymentDate: '2026-10-20' },
        open()
      )
    ).toEqual({ status: 'Unpaid', paymentDate: null });
    expect(
      stageOnInvoiceChange(
        'fees',
        {
          ...feesInvoiced,
          status: 'Paid',
          paymentDate: '2026-10-20',
          startDate: '2027-01-05',
        },
        open()
      )
    ).toEqual({ status: 'Invoiced', paymentDate: null });
  });

  it('already in step with QuickBooks → nothing to write', () => {
    expect(
      stageOnInvoiceChange(
        'registration',
        { ...regUnpaid, status: 'Finished', paymentDate: '2026-10-20' },
        paid()
      )
    ).toBeNull();
  });

  it('never touches a Cancelled stage', () => {
    expect(
      stageOnInvoiceChange(
        'fees',
        { ...feesInvoiced, status: 'Cancelled' },
        paid()
      )
    ).toBeNull();
  });
});

describe('needsStartDate', () => {
  it('is true only for Fees paid in QuickBooks, not yet Paid, with no start date', () => {
    const s: StageSnapshot = {
      status: 'Invoiced',
      invoice: '1042',
      paymentDate: '2026-10-20',
      startDate: null,
    };
    expect(needsStartDate('fees', s, 'paid')).toBe(true);
    expect(
      needsStartDate('fees', { ...s, startDate: '2027-01-05' }, 'paid')
    ).toBe(false);
    expect(needsStartDate('fees', { ...s, status: 'Paid' }, 'paid')).toBe(
      false
    );
    expect(needsStartDate('fees', { ...s, status: 'Cancelled' }, 'paid')).toBe(
      false
    );
    expect(needsStartDate('fees', s, 'open')).toBe(false);
    expect(needsStartDate('registration', s, 'paid')).toBe(false);
    expect(needsStartDate('fees', s, null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --pool=threads __tests__/qbo/stage-state.test.ts`
Expected: FAIL — cannot resolve `@/lib/qbo/stage-state`.

- [ ] **Step 3: Implement**

```ts
// What a QuickBooks invoice does to the Registration / Fees stage.
// Spec: docs/superpowers/specs/2026-10-14-quickbooks-registration-fees-invoicing-design.md
// ("Status rules"). Pure — no database, no QuickBooks — so every row of the
// spec's two tables is a unit test.

export const QBO_STAGE_KEYS = ['registration', 'fees'] as const;
export type QboStageKey = (typeof QBO_STAGE_KEYS)[number];

export function isQboStageKey(v: string): v is QboStageKey {
  return (QBO_STAGE_KEYS as readonly string[]).includes(v);
}

export type InvoiceState = 'open' | 'paid' | 'voided';

export type StageSnapshot = {
  status: string | null;
  invoice: string | null;
  paymentDate: string | null;
  startDate: string | null;
};

export type InvoiceSnapshot = {
  docNumber: string;
  state: InvoiceState;
  paymentDate: string | null;
};

export type StagePatch = {
  status?: string | null;
  invoice?: string | null;
  paymentDate?: string | null;
};

const blank = (v: string | null | undefined) => !v || !v.trim();
const norm = (v: string | null | undefined) => (blank(v) ? null : v!.trim());
const sameDate = (a: string | null | undefined, b: string | null | undefined) =>
  (norm(a)?.slice(0, 10) ?? null) === (norm(b)?.slice(0, 10) ?? null);

/** Where the stage should end up for this invoice state, starting from `base`. */
function applyState(
  stage: QboStageKey,
  current: StageSnapshot,
  invoice: InvoiceSnapshot,
  base: StagePatch
): StagePatch {
  const status = base.status !== undefined ? base.status : current.status;

  if (invoice.state === 'voided') {
    return { status: 'Pending', invoice: null, paymentDate: null };
  }

  if (invoice.state === 'paid') {
    if (stage === 'registration') {
      return { ...base, status: 'Finished', paymentDate: invoice.paymentDate };
    }
    // Fees Paid needs a start date (STAGE_STATUS_REQUIRED_FIELDS). Without
    // one the payment date is still filled and the status waits.
    if (!blank(current.startDate)) {
      return { ...base, status: 'Paid', paymentDate: invoice.paymentDate };
    }
    return { ...base, paymentDate: invoice.paymentDate };
  }

  // Open. A stage that was finished on this invoice has reopened — a payment
  // was deleted or reduced in QuickBooks, and QuickBooks wins on money.
  if (stage === 'registration' && status === 'Finished') {
    return { ...base, status: 'Unpaid', paymentDate: null };
  }
  if (stage === 'fees' && status === 'Paid') {
    return { ...base, status: 'Invoiced', paymentDate: null };
  }
  return base;
}

/** Drop every key that already matches the stage; null when nothing is left. */
function onlyChanges(
  patch: StagePatch,
  current: StageSnapshot
): StagePatch | null {
  const out: StagePatch = {};
  if (
    patch.status !== undefined &&
    norm(patch.status) !== norm(current.status)
  ) {
    out.status = patch.status;
  }
  if (
    patch.invoice !== undefined &&
    norm(patch.invoice) !== norm(current.invoice)
  ) {
    out.invoice = patch.invoice;
  }
  if (
    patch.paymentDate !== undefined &&
    !sameDate(patch.paymentDate, current.paymentDate)
  ) {
    out.paymentDate = patch.paymentDate;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Staff created or linked an invoice on this stage. */
export function stageOnNewInvoice(
  stage: QboStageKey,
  current: StageSnapshot,
  invoice: InvoiceSnapshot
): StagePatch | null {
  if (current.status === 'Cancelled') return null;
  const hadInvoice = !blank(current.invoice);
  const base: StagePatch = {
    status:
      stage === 'registration'
        ? 'Unpaid'
        : hadInvoice
          ? 'Re-invoiced'
          : 'Invoiced',
    invoice: invoice.docNumber,
    paymentDate: null,
  };
  return applyState(stage, current, invoice, base);
}

/** QuickBooks changed the stage's current invoice. */
export function stageOnInvoiceChange(
  stage: QboStageKey,
  current: StageSnapshot,
  invoice: InvoiceSnapshot
): StagePatch | null {
  if (current.status === 'Cancelled') return null;
  return onlyChanges(applyState(stage, current, invoice, {}), current);
}

/** Fees paid in QuickBooks, held back from Paid only by a missing start date. */
export function needsStartDate(
  stage: QboStageKey,
  current: StageSnapshot,
  state: InvoiceState | null
): boolean {
  return (
    stage === 'fees' &&
    state === 'paid' &&
    current.status !== 'Paid' &&
    current.status !== 'Cancelled' &&
    blank(current.startDate)
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --pool=threads __tests__/qbo/stage-state.test.ts`
Expected: PASS (all cases).

Note on the void case for Fees: `onlyChanges` drops `paymentDate: null` when the stage's payment date is already blank, which is why the Fees void expectation has no `paymentDate` key and the Registration one (which had a date) does.

- [ ] **Step 5: Commit**

```bash
git add lib/qbo/stage-state.ts __tests__/qbo/stage-state.test.ts && git commit -m "feat(qbo): status rules for Registration and Fees invoices"
```

### Task 1.3: Invoice reading, webhook parsing, name matching (pure)

**Files:**

- Create: `lib/qbo/invoice-snapshot.ts`, `lib/qbo/webhook.ts`, `lib/qbo/customer-match.ts`
- Test: `__tests__/qbo/invoice-snapshot.test.ts`, `__tests__/qbo/webhook.test.ts`, `__tests__/qbo/customer-match.test.ts`

**Interfaces:**

- Consumes: `InvoiceState` from Task 1.2.
- Produces:
  - `type QbInvoice` (QuickBooks invoice JSON subset), `invoiceState(inv: QbInvoice | null): InvoiceState`, `linkedPaymentIds(inv: QbInvoice): string[]`, `latestDate(dates: Array<string | null | undefined>): string | null`
  - `verifyIntuitSignature(rawBody: string, signature: string | null, verifier: string): boolean`
  - `type ChangedEntity = { entity: 'Invoice' | 'Payment'; id: string; operation: string }`, `parseWebhookPayload(json: unknown): ChangedEntity[]`
  - `normalizeName(s: string): string`, `studentNameForms(n: { enroleeFullName: string | null; firstName: string | null; middleName: string | null; lastName: string | null }): string[]`, `exactMatches<T extends { DisplayName: string }>(customers: T[], forms: string[]): T[]`

- [ ] **Step 1: Write the failing tests**

`__tests__/qbo/invoice-snapshot.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  invoiceState,
  latestDate,
  linkedPaymentIds,
  type QbInvoice,
} from '@/lib/qbo/invoice-snapshot';

const inv = (over: Partial<QbInvoice>): QbInvoice => ({
  Id: '130',
  DocNumber: '1042',
  TotalAmt: 2800,
  Balance: 2800,
  SyncToken: '0',
  CustomerRef: { value: '58' },
  ...over,
});

describe('invoiceState', () => {
  it('open while a balance remains', () => {
    expect(invoiceState(inv({ Balance: 1800 }))).toBe('open');
  });
  it('paid when the balance reaches 0 on a non-zero invoice', () => {
    expect(invoiceState(inv({ Balance: 0 }))).toBe('paid');
  });
  it('voided: QuickBooks zeroes it and prefixes the note', () => {
    expect(
      invoiceState(
        inv({
          TotalAmt: 0,
          Balance: 0,
          PrivateNote: 'Voided - Created from SIS by X',
        })
      )
    ).toBe('voided');
  });
  it('a deleted invoice (not found) counts as voided', () => {
    expect(invoiceState(null)).toBe('voided');
  });
});

describe('payments on an invoice', () => {
  it('lists only linked Payment ids', () => {
    expect(
      linkedPaymentIds(
        inv({
          LinkedTxn: [
            { TxnId: '201', TxnType: 'Payment' },
            { TxnId: '9', TxnType: 'Estimate' },
            { TxnId: '205', TxnType: 'Payment' },
          ],
        })
      )
    ).toEqual(['201', '205']);
  });
  it('latestDate picks the newest YYYY-MM-DD and ignores blanks', () => {
    expect(
      latestDate(['2026-10-01', null, '2026-10-20', undefined, '2026-09-30'])
    ).toBe('2026-10-20');
    expect(latestDate([null])).toBeNull();
  });
});
```

`__tests__/qbo/webhook.test.ts`:

```ts
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { parseWebhookPayload, verifyIntuitSignature } from '@/lib/qbo/webhook';

describe('verifyIntuitSignature', () => {
  const body = '{"eventNotifications":[]}';
  const verifier = 'test-verifier';
  const good = createHmac('sha256', verifier).update(body).digest('base64');

  it('accepts the right signature', () => {
    expect(verifyIntuitSignature(body, good, verifier)).toBe(true);
  });
  it('refuses a wrong, missing or different-length signature', () => {
    expect(verifyIntuitSignature(body, 'AAAA', verifier)).toBe(false);
    expect(verifyIntuitSignature(body, null, verifier)).toBe(false);
    expect(verifyIntuitSignature(body + ' ', good, verifier)).toBe(false);
  });
});

describe('parseWebhookPayload', () => {
  it('reads the eventNotifications shape, Invoice and Payment only', () => {
    expect(
      parseWebhookPayload({
        eventNotifications: [
          {
            realmId: '9341',
            dataChangeEvent: {
              entities: [
                { name: 'Invoice', id: '130', operation: 'Update' },
                { name: 'Payment', id: '201', operation: 'Create' },
                { name: 'Customer', id: '58', operation: 'Update' },
              ],
            },
          },
        ],
      })
    ).toEqual([
      { entity: 'Invoice', id: '130', operation: 'Update' },
      { entity: 'Payment', id: '201', operation: 'Create' },
    ]);
  });

  it('reads the CloudEvents shape the same way', () => {
    expect(
      parseWebhookPayload([
        { type: 'qbo.invoice.voided.v1', intuitentityid: '130' },
        { type: 'qbo.payment.deleted.v1', intuitentityid: '201' },
        { type: 'qbo.customer.updated.v1', intuitentityid: '58' },
      ])
    ).toEqual([
      { entity: 'Invoice', id: '130', operation: 'voided' },
      { entity: 'Payment', id: '201', operation: 'deleted' },
    ]);
  });

  it('returns nothing for junk', () => {
    expect(parseWebhookPayload(null)).toEqual([]);
    expect(parseWebhookPayload({ foo: 1 })).toEqual([]);
  });
});
```

`__tests__/qbo/customer-match.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  exactMatches,
  normalizeName,
  studentNameForms,
} from '@/lib/qbo/customer-match';

const sofia = {
  enroleeFullName: 'LIM, SOFIA ALCANTARA',
  firstName: 'Sofia',
  middleName: 'Alcantara',
  lastName: 'Lim',
};

describe('customer matching', () => {
  it('normalizes case and spacing only', () => {
    expect(normalizeName('  Lim,   sofia  Alcantara ')).toBe(
      'LIM, SOFIA ALCANTARA'
    );
  });

  it('builds the full-name forms, never dropping the middle name', () => {
    expect(studentNameForms(sofia)).toEqual([
      'LIM, SOFIA ALCANTARA',
      'SOFIA ALCANTARA LIM',
    ]);
  });

  it('matches exactly one customer by any full-name form', () => {
    const customers = [
      { Id: '1', DisplayName: 'Sofia Alcantara Lim' },
      { Id: '2', DisplayName: 'LIM, SOFIA' },
      { Id: '3', DisplayName: 'LIM, SOFIA ALCANTARA (old)' },
    ];
    expect(
      exactMatches(customers, studentNameForms(sofia)).map((c) => c.Id)
    ).toEqual(['1']);
  });

  it('a near miss is not a match', () => {
    expect(
      exactMatches(
        [{ Id: '9', DisplayName: 'LIM, SOFIA ALCANTRA' }],
        studentNameForms(sofia)
      )
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run --pool=threads __tests__/qbo/invoice-snapshot.test.ts __tests__/qbo/webhook.test.ts __tests__/qbo/customer-match.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`lib/qbo/invoice-snapshot.ts`:

```ts
import type { InvoiceState } from '@/lib/qbo/stage-state';

/** The fields of a QuickBooks Invoice the SIS reads. */
export type QbInvoice = {
  Id: string;
  DocNumber?: string;
  TxnDate?: string;
  DueDate?: string;
  TotalAmt: number;
  Balance: number;
  SyncToken: string;
  PrivateNote?: string;
  CustomerRef: { value: string; name?: string };
  LinkedTxn?: Array<{ TxnId: string; TxnType: string }>;
};

/**
 * Open / paid / voided, as QuickBooks shows it. A void zeroes the invoice and
 * prefixes its private note with "Voided" (seen in the sandbox spike, 2026-10-13).
 * `null` means QuickBooks no longer has it (deleted) — treated as voided.
 */
export function invoiceState(inv: QbInvoice | null): InvoiceState {
  if (!inv) return 'voided';
  if (Number(inv.TotalAmt) === 0 && /^voided/i.test(inv.PrivateNote ?? '')) {
    return 'voided';
  }
  if (Number(inv.Balance) === 0 && Number(inv.TotalAmt) > 0) return 'paid';
  return 'open';
}

export function linkedPaymentIds(inv: QbInvoice): string[] {
  return (inv.LinkedTxn ?? [])
    .filter((t) => t.TxnType === 'Payment')
    .map((t) => t.TxnId);
}

export function latestDate(
  dates: Array<string | null | undefined>
): string | null {
  const real = dates
    .filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}/.test(d))
    .map((d) => d.slice(0, 10))
    .sort();
  return real.length ? real[real.length - 1] : null;
}
```

`lib/qbo/webhook.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export type ChangedEntity = {
  entity: 'Invoice' | 'Payment';
  id: string;
  operation: string;
};

/** Intuit signs the raw body: base64(HMAC-SHA256(verifier token, body)). */
export function verifyIntuitSignature(
  rawBody: string,
  signature: string | null,
  verifier: string
): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', verifier).update(rawBody).digest();
  const given = Buffer.from(signature, 'base64');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const ENTITY: Record<string, ChangedEntity['entity']> = {
  invoice: 'Invoice',
  payment: 'Payment',
};

/**
 * Both shapes Intuit sends: the long-standing `eventNotifications` body, and
 * the CloudEvents array (`type: "qbo.invoice.updated.v1"`, `intuitentityid`).
 * Only Invoice and Payment matter here; everything else is dropped.
 */
export function parseWebhookPayload(json: unknown): ChangedEntity[] {
  const out: ChangedEntity[] = [];
  if (Array.isArray(json)) {
    for (const ev of json as Array<Record<string, unknown>>) {
      const parts = String(ev?.type ?? '').split('.');
      const entity = ENTITY[parts[1] ?? ''];
      const id = String(ev?.intuitentityid ?? '');
      if (parts[0] === 'qbo' && entity && id) {
        out.push({ entity, id, operation: parts[2] ?? '' });
      }
    }
    return out;
  }
  const notes = (json as { eventNotifications?: unknown })?.eventNotifications;
  if (!Array.isArray(notes)) return out;
  for (const n of notes as Array<Record<string, any>>) {
    for (const e of n?.dataChangeEvent?.entities ?? []) {
      const entity = ENTITY[String(e?.name ?? '').toLowerCase()];
      if (entity && e?.id) {
        out.push({
          entity,
          id: String(e.id),
          operation: String(e.operation ?? ''),
        });
      }
    }
  }
  return out;
}
```

`lib/qbo/customer-match.ts`:

```ts
// Matching a student to their QuickBooks customer. QuickBooks identifies
// customers by the student's full name only (Mr Ace, 2026-10-09), so the match
// is an exact full-name match — case and spacing aside — and anything else is
// the person's to pick. No fuzzy matching: a near miss is a different child as
// often as it is a typo.

export function normalizeName(s: string): string {
  return s.toUpperCase().replace(/\s+/g, ' ').trim();
}

export function studentNameForms(n: {
  enroleeFullName: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
}): string[] {
  const first = (n.firstName ?? '').trim();
  const middle = (n.middleName ?? '').trim();
  const last = (n.lastName ?? '').trim();
  const forms = [
    n.enroleeFullName ?? '',
    last && first
      ? `${last}, ${[first, middle].filter(Boolean).join(' ')}`
      : '',
    last && first ? [first, middle, last].filter(Boolean).join(' ') : '',
  ]
    .map(normalizeName)
    .filter(Boolean);
  return Array.from(new Set(forms));
}

export function exactMatches<T extends { DisplayName: string }>(
  customers: T[],
  forms: string[]
): T[] {
  const wanted = new Set(forms.map(normalizeName));
  return customers.filter((c) => wanted.has(normalizeName(c.DisplayName)));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads __tests__/qbo`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/qbo/invoice-snapshot.ts lib/qbo/webhook.ts lib/qbo/customer-match.ts __tests__/qbo/invoice-snapshot.test.ts __tests__/qbo/webhook.test.ts __tests__/qbo/customer-match.test.ts && git commit -m "feat(qbo): invoice state, webhook parsing and customer name matching"
```

### Task 1.4: Register the audit actions

**Files:**

- Modify: `lib/audit/log-action.ts` (append to `ALL_AUDIT_ACTIONS` after `'sis.discount_code.expire'`; add entity types)
- Modify: `lib/audit/modules.ts` (admissions module prefixes)
- Modify: `lib/audit/humanize.ts` (`ACTION_LABELS` + a context case)
- Modify: `app/(admissions)/admissions/audit-log/page.tsx` (`ADMISSIONS_AUDIT_ACTIONS`)
- Modify: `app/(sis)/sis/audit-log/page.tsx` (`SIS_AUDIT_ALLOWLIST`)
- Test: `__tests__/audit/humanize-context.test.ts` (add a block)

**Interfaces:**

- Produces audit actions `'qbo.invoice.create' | 'qbo.invoice.link' | 'qbo.connection.connect' | 'qbo.connection.disconnect'` and entity types `'qbo_invoice' | 'qbo_connection'`.
- Context shape written by Tasks 2.3 / 2.2: invoice actions `{ ay_code, enroleeNumber, studentNumber, stage, doc_number, total, customer }`; connection actions `{ company_name, environment }`.

- [ ] **Step 1: Write the failing test** — append to `__tests__/audit/humanize-context.test.ts`:

```ts
describe('QuickBooks actions', () => {
  it('labels them plainly', () => {
    expect(auditActionLabel('qbo.invoice.create')).toBe(
      'QuickBooks invoice created'
    );
    expect(auditActionLabel('qbo.invoice.link')).toBe(
      'QuickBooks invoice linked'
    );
    expect(auditActionLabel('qbo.connection.connect')).toBe(
      'QuickBooks connected'
    );
    expect(auditActionLabel('qbo.connection.disconnect')).toBe(
      'QuickBooks disconnected'
    );
  });

  it('summarises an invoice row', () => {
    expect(
      line('qbo.invoice.create', {
        ay_code: 'AY2027',
        stage: 'fees',
        doc_number: '1042',
        total: 2800,
        customer: 'LIM, SOFIA ALCANTARA',
      })
    ).toBe('Fees · invoice 1042 · S$2,800.00 · LIM, SOFIA ALCANTARA');
  });

  it('summarises a connection row', () => {
    expect(
      line('qbo.connection.connect', {
        company_name: 'HFSE International School',
      })
    ).toBe('HFSE International School');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --pool=threads __tests__/audit/humanize-context.test.ts`
Expected: FAIL (TypeScript-unknown action falls back to prettified label).

- [ ] **Step 3: Implement**

In `lib/audit/log-action.ts`, after `'sis.discount_code.expire',` add:

```ts
  // QuickBooks invoicing (migration 188). Stage moves the sync makes are NOT
  // new actions — they are `sis.stage.update` rows with actor
  // `system:quickbooks-sync` and `context.source = 'quickbooks'`.
  'qbo.invoice.create',
  'qbo.invoice.link',
  'qbo.connection.connect',
  'qbo.connection.disconnect',
```

In `AuditEntityType`, after `| 'discount_code'` add:

```ts
  // QuickBooks (migration 188): entity_id is the QuickBooks invoice id, or
  // the company (realm) id for a connection row.
  | 'qbo_invoice'
  | 'qbo_connection'
```

In `lib/audit/modules.ts`, admissions `prefixes`, after `'admission_option.',` add:

```ts
      // QuickBooks invoicing for the Registration / Fees stages (migration
      // 188) — admissions work, connected once in SIS Admin.
      'qbo.',
```

In `lib/audit/humanize.ts` `ACTION_LABELS`, after the discount-code labels add:

```ts
  'qbo.invoice.create': 'QuickBooks invoice created',
  'qbo.invoice.link': 'QuickBooks invoice linked',
  'qbo.connection.connect': 'QuickBooks connected',
  'qbo.connection.disconnect': 'QuickBooks disconnected',
```

and in `auditContextSummary`'s switch, next to the discount-code case:

```ts
    case 'qbo.invoice.create':
    case 'qbo.invoice.link': {
      const parts: string[] = [];
      const stage = str(ctx.stage);
      if (stage) parts.push(stage === 'fees' ? 'Fees' : 'Registration');
      const doc = str(ctx.doc_number);
      if (doc) parts.push(`invoice ${doc}`);
      const total = Number(ctx.total);
      if (Number.isFinite(total) && ctx.total !== undefined && ctx.total !== null) {
        parts.push(
          `S$${total.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        );
      }
      const customer = str(ctx.customer);
      if (customer) parts.push(customer);
      return joinParts(parts);
    }
    case 'qbo.connection.connect':
    case 'qbo.connection.disconnect':
      return joinParts([str(ctx.company_name)].filter(Boolean));
```

(`str`, `joinParts` are the file's existing helpers. If `joinParts` of an empty array does not return the file's EMPTY marker, follow what the discount-code case does.)

In `app/(admissions)/admissions/audit-log/page.tsx` `ADMISSIONS_AUDIT_ACTIONS`, after `'sis.stage.update',` add `'qbo.invoice.create', 'qbo.invoice.link',`.
In `app/(sis)/sis/audit-log/page.tsx` `SIS_AUDIT_ALLOWLIST`, add `'qbo.connection.connect', 'qbo.connection.disconnect',` next to `'school_config.update'`.

- [ ] **Step 4: Run the audit suite**

Run: `npx vitest run --pool=threads __tests__/audit`
Expected: PASS — including `module-coverage`, `allowlist-coverage` and "never falls back to a prettified code".

- [ ] **Step 5: Commit**

```bash
git add lib/audit/log-action.ts lib/audit/modules.ts lib/audit/humanize.ts "app/(admissions)/admissions/audit-log/page.tsx" "app/(sis)/sis/audit-log/page.tsx" __tests__/audit/humanize-context.test.ts && git commit -m "feat(qbo): register QuickBooks audit actions"
```

**Phase 1 gate:** `npx vitest run --pool=threads __tests__/qbo __tests__/audit` and `npx tsc --noEmit` both clean → reviewer pass on `git diff` of Phase 1 against the spec's Status rules and Data sections.

---

## Phase 2 — Server: client, sync, routes

Gate: `npx vitest run --pool=threads __tests__/qbo`, `npx tsc --noEmit`, `npm run lint` clean → reviewer pass before Phase 3.

### Task 2.1: Env, roles and the QuickBooks client

**Files:**

- Create: `lib/qbo/env.ts`, `lib/qbo/roles.ts`, `lib/qbo/client.ts`
- Modify: `docs/rules/env-vars.md` (add the five `QBO_*` vars)
- Test: `__tests__/qbo/client.test.ts`

**Interfaces:**

- Produces:
  - `qboEnv(): QboEnv | null` with `QboEnv = { clientId: string; clientSecret: string; redirectUri: string; environment: 'sandbox' | 'production'; webhookVerifier: string | null }`
  - `qboApiBase(environment)`, `qboInvoiceUrl(environment, invoiceId): string`
  - `QBO_INVOICE_ROLES = ['admissions', 'school_admin', 'superadmin'] as const`, `QBO_ADMIN_ROLES = ['superadmin'] as const`, `canInvoiceInQbo(role: string | null): boolean`
  - `class QboError extends Error { status: number; code: string | null; detail: string }`, `class QboNotConnectedError extends Error`
  - `exchangeAuthCode(code: string): Promise<TokenSet>`, `revokeToken(refreshToken: string): Promise<void>`
  - `qboRequest<T>(service: SupabaseClient, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T>`
  - `qboQuery<T>(service, entity: string, where?: string, tail?: string): Promise<T[]>`, `qbEscape(s: string): string`
  - `qboErrorMessage(e: unknown): string` — plain sentence for the person

- [ ] **Step 1: Write the failing test** (`__tests__/qbo/client.test.ts`):

```ts
import { describe, expect, it } from 'vitest';

import { QboError, qbEscape, qboErrorMessage } from '@/lib/qbo/client';
import { qboInvoiceUrl } from '@/lib/qbo/env';
import { canInvoiceInQbo } from '@/lib/qbo/roles';

describe('QuickBooks client helpers', () => {
  it('escapes quotes and backslashes for the query language', () => {
    expect(qbEscape("O'Brien \\ Co")).toBe("O\\'Brien \\\\ Co");
  });

  it('turns a QuickBooks fault into the sentence staff see', () => {
    const e = new QboError(400, '6240', 'Duplicate Name Exists Error');
    expect(qboErrorMessage(e)).toBe(
      "QuickBooks didn't accept this: Duplicate Name Exists Error"
    );
    expect(qboErrorMessage(new Error('fetch failed'))).toBe(
      "QuickBooks couldn't be reached. Nothing was saved — try again in a minute."
    );
  });

  it('links to the invoice in the right QuickBooks', () => {
    expect(qboInvoiceUrl('sandbox', '130')).toBe(
      'https://app.sandbox.qbo.intuit.com/app/invoice?txnId=130'
    );
    expect(qboInvoiceUrl('production', '130')).toBe(
      'https://app.qbo.intuit.com/app/invoice?txnId=130'
    );
  });

  it('only admissions, school_admin and superadmin invoice', () => {
    expect(canInvoiceInQbo('admissions')).toBe(true);
    expect(canInvoiceInQbo('school_admin')).toBe(true);
    expect(canInvoiceInQbo('superadmin')).toBe(true);
    expect(canInvoiceInQbo('academic_coordinator')).toBe(false);
    expect(canInvoiceInQbo(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --pool=threads __tests__/qbo/client.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`lib/qbo/env.ts`:

```ts
export type QboEnvironment = 'sandbox' | 'production';

export type QboEnv = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: QboEnvironment;
  webhookVerifier: string | null;
};

/** Null when QuickBooks isn't configured on this deployment. */
export function qboEnv(): QboEnv | null {
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const redirectUri = process.env.QBO_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return {
    clientId,
    clientSecret,
    redirectUri,
    environment:
      process.env.QBO_ENVIRONMENT === 'production' ? 'production' : 'sandbox',
    webhookVerifier: process.env.QBO_WEBHOOK_VERIFIER || null,
  };
}

export function qboApiBase(environment: QboEnvironment): string {
  return environment === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

export function qboInvoiceUrl(
  environment: QboEnvironment,
  invoiceId: string
): string {
  const host =
    environment === 'production'
      ? 'app.qbo.intuit.com'
      : 'app.sandbox.qbo.intuit.com';
  return `https://${host}/app/invoice?txnId=${encodeURIComponent(invoiceId)}`;
}
```

`lib/qbo/roles.ts`:

```ts
import type { Role } from '@/lib/auth/roles';

/**
 * Who may create or link a QuickBooks invoice on a stage (decided 2026-10-14).
 * Narrower than STUDENT_RECORD_WRITERS: academic_coordinator keeps Edit stage
 * but does not invoice.
 */
export const QBO_INVOICE_ROLES = [
  'admissions',
  'school_admin',
  'superadmin',
] as const satisfies readonly Role[];

/** Connecting / disconnecting the school's QuickBooks company. */
export const QBO_ADMIN_ROLES = [
  'superadmin',
] as const satisfies readonly Role[];

export function canInvoiceInQbo(role: string | null | undefined): boolean {
  return !!role && (QBO_INVOICE_ROLES as readonly string[]).includes(role);
}
```

`lib/qbo/client.ts`:

```ts
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { qboApiBase, qboEnv, type QboEnv } from '@/lib/qbo/env';

// The one door to the QuickBooks API. Reads the stored connection, refreshes
// the access token when it is about to expire, saves the refresh token Intuit
// hands back EVERY time (it rotates), and retries a call once on a 401.

const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const MINOR_VERSION = 'minorversion=75';

export class QboError extends Error {
  constructor(
    public status: number,
    public code: string | null,
    public detail: string
  ) {
    super(`QuickBooks ${status}${code ? ` (${code})` : ''}: ${detail}`);
  }
}

export class QboNotConnectedError extends Error {
  constructor() {
    super('QuickBooks is not connected');
  }
}

export type TokenSet = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

function requireEnv(): QboEnv {
  const env = qboEnv();
  if (!env) throw new QboNotConnectedError();
  return env;
}

async function tokenCall(params: Record<string, string>): Promise<TokenSet> {
  const env = requireEnv();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization:
        'Basic ' +
        Buffer.from(`${env.clientId}:${env.clientSecret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(params),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.access_token) {
    throw new QboError(
      res.status,
      body?.error ?? null,
      body?.error_description ?? 'token request refused'
    );
  }
  return body as TokenSet;
}

export function exchangeAuthCode(code: string): Promise<TokenSet> {
  return tokenCall({
    grant_type: 'authorization_code',
    code,
    redirect_uri: requireEnv().redirectUri,
  });
}

export async function revokeToken(refreshToken: string): Promise<void> {
  const env = requireEnv();
  await fetch(REVOKE_URL, {
    method: 'POST',
    headers: {
      Authorization:
        'Basic ' +
        Buffer.from(`${env.clientId}:${env.clientSecret}`).toString('base64'),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ token: refreshToken }),
  });
}

type ConnectionRow = {
  realm_id: string;
  environment: 'sandbox' | 'production';
  refresh_token: string;
  access_token: string | null;
  access_token_expires_at: string | null;
};

async function loadConnection(service: SupabaseClient): Promise<ConnectionRow> {
  const { data, error } = await service
    .from('qbo_connection')
    .select(
      'realm_id, environment, refresh_token, access_token, access_token_expires_at'
    )
    .eq('id', 1)
    .maybeSingle();
  if (error)
    throw new Error(`QuickBooks connection lookup failed: ${error.message}`);
  if (!data) throw new QboNotConnectedError();
  return data as ConnectionRow;
}

async function accessToken(
  service: SupabaseClient,
  conn: ConnectionRow,
  force: boolean
): Promise<string> {
  const expires = conn.access_token_expires_at
    ? Date.parse(conn.access_token_expires_at)
    : 0;
  if (!force && conn.access_token && expires - Date.now() > 60_000) {
    return conn.access_token;
  }
  const t = await tokenCall({
    grant_type: 'refresh_token',
    refresh_token: conn.refresh_token,
  });
  const expiresAt = new Date(Date.now() + t.expires_in * 1000).toISOString();
  const { error } = await service
    .from('qbo_connection')
    .update({
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      access_token_expires_at: expiresAt,
    })
    .eq('id', 1);
  if (error)
    throw new Error(`Saving the QuickBooks key failed: ${error.message}`);
  conn.access_token = t.access_token;
  conn.refresh_token = t.refresh_token;
  conn.access_token_expires_at = expiresAt;
  return t.access_token;
}

export async function qboRequest<T>(
  service: SupabaseClient,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown
): Promise<T> {
  const conn = await loadConnection(service);
  const base = `${qboApiBase(conn.environment)}/v3/company/${conn.realm_id}`;
  const sep = path.includes('?') ? '&' : '?';

  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessToken(service, conn, attempt > 0);
    const res = await fetch(`${base}${path}${sep}${MINOR_VERSION}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    if (res.status === 401 && attempt === 0) continue;
    const json = await res.json().catch(() => null);
    const fault = json?.Fault?.Error?.[0];
    if (!res.ok || fault) {
      throw new QboError(
        res.status,
        fault?.code ? String(fault.code) : null,
        fault?.Detail ?? fault?.Message ?? res.statusText ?? 'request refused'
      );
    }
    return json as T;
  }
  throw new QboError(401, null, 'QuickBooks refused the saved key');
}

export function qbEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export async function qboQuery<T>(
  service: SupabaseClient,
  entity: string,
  where = '',
  tail = 'maxresults 1000'
): Promise<T[]> {
  const sql = `select * from ${entity}${where ? ` where ${where}` : ''} ${tail}`;
  const json = await qboRequest<{ QueryResponse?: Record<string, T[]> }>(
    service,
    'GET',
    `/query?query=${encodeURIComponent(sql)}`
  );
  return json.QueryResponse?.[entity] ?? [];
}

/** The sentence a person sees when a QuickBooks call fails. */
export function qboErrorMessage(e: unknown): string {
  if (e instanceof QboNotConnectedError) {
    return 'QuickBooks is not connected. Ask a superadmin to connect it in SIS Admin.';
  }
  if (e instanceof QboError)
    return `QuickBooks didn't accept this: ${e.detail}`;
  return "QuickBooks couldn't be reached. Nothing was saved — try again in a minute.";
}
```

`client.test.ts` imports `lib/qbo/client.ts`, which imports `server-only`; vitest aliases it to `__mocks__/server-only.ts` (see `vitest.config.ts`), so the import is safe.

In `docs/rules/env-vars.md`, add a "QuickBooks Online" subsection listing `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI` (`https://sis.hfse.edu.sg/api/quickbooks/callback` in production; `http://localhost:3000/api/quickbooks/callback` locally), `QBO_ENVIRONMENT` (`sandbox` | `production`), `QBO_WEBHOOK_VERIFIER` (from the Intuit app's Webhooks page). No forward-slash-free Windows paths in the doc (Tailwind scans `docs/`).

- [ ] **Step 4: Run the test**

Run: `npx vitest run --pool=threads __tests__/qbo/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/qbo/env.ts lib/qbo/roles.ts lib/qbo/client.ts __tests__/qbo/client.test.ts docs/rules/env-vars.md && git commit -m "feat(qbo): QuickBooks client with rotating token refresh"
```

### Task 2.2: Connect, callback, disconnect

**Files:**

- Create: `app/api/quickbooks/connect/route.ts`, `app/api/quickbooks/callback/route.ts`, `app/api/quickbooks/disconnect/route.ts`

**Interfaces:**

- Consumes: `qboEnv`, `exchangeAuthCode`, `revokeToken`, `qboRequest`, `QBO_ADMIN_ROLES`, `logAction`.
- Produces: `qbo_connection` row id 1; redirects back to `/sis/admin/quickbooks?connected=1` or `?error=<message>`.

- [ ] **Step 1: Implement `connect`**

```ts
import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { qboEnv } from '@/lib/qbo/env';
import { QBO_ADMIN_ROLES } from '@/lib/qbo/roles';

// GET /api/quickbooks/connect — superadmin. Sends them to Intuit to approve
// the SIS for the school's QuickBooks company. The `state` cookie is checked
// on the way back (callback) so nobody can hand us someone else's approval.
export async function GET() {
  const auth = await requireRole([...QBO_ADMIN_ROLES]);
  if ('error' in auth) return auth.error;
  const env = qboEnv();
  if (!env) {
    return NextResponse.json(
      { error: 'QuickBooks keys are not set on this server.' },
      { status: 500 }
    );
  }
  const state = randomBytes(24).toString('hex');
  const url = new URL('https://appcenter.intuit.com/connect/oauth2');
  url.searchParams.set('client_id', env.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'com.intuit.quickbooks.accounting');
  url.searchParams.set('redirect_uri', env.redirectUri);
  url.searchParams.set('state', state);
  const res = NextResponse.redirect(url);
  res.cookies.set('qbo_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/quickbooks',
    maxAge: 600,
  });
  return res;
}
```

- [ ] **Step 2: Implement `callback`**

```ts
import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import {
  exchangeAuthCode,
  qboErrorMessage,
  qboRequest,
} from '@/lib/qbo/client';
import { qboEnv } from '@/lib/qbo/env';
import { QBO_ADMIN_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

// GET /api/quickbooks/callback?code&state&realmId — Intuit sends the
// superadmin back here after they approve.
export async function GET(request: NextRequest) {
  const back = (q: string) =>
    NextResponse.redirect(new URL(`/sis/admin/quickbooks?${q}`, request.url));
  const auth = await requireRole([...QBO_ADMIN_ROLES]);
  if ('error' in auth) return auth.error;

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const realmId = url.searchParams.get('realmId');
  const state = url.searchParams.get('state');
  const expected = request.cookies.get('qbo_oauth_state')?.value;
  if (url.searchParams.get('error')) {
    return back(
      `error=${encodeURIComponent('QuickBooks approval was cancelled.')}`
    );
  }
  if (!code || !realmId || !state || state !== expected) {
    return back(
      `error=${encodeURIComponent('That approval link had expired. Click Connect again.')}`
    );
  }

  const env = qboEnv()!;
  const service = createServiceClient();
  try {
    const tokens = await exchangeAuthCode(code);
    const { error } = await service.from('qbo_connection').upsert({
      id: 1,
      realm_id: realmId,
      environment: env.environment,
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      access_token_expires_at: new Date(
        Date.now() + tokens.expires_in * 1000
      ).toISOString(),
      connected_by: auth.user.id,
      connected_by_email: auth.user.email,
      connected_at: new Date().toISOString(),
      last_cdc_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);

    const info = await qboRequest<{ CompanyInfo?: { CompanyName?: string } }>(
      service,
      'GET',
      `/companyinfo/${realmId}`
    );
    const companyName = info.CompanyInfo?.CompanyName ?? null;
    await service
      .from('qbo_connection')
      .update({ company_name: companyName })
      .eq('id', 1);

    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
      action: 'qbo.connection.connect',
      entityType: 'qbo_connection',
      entityId: realmId,
      context: { company_name: companyName, environment: env.environment },
    });
    const res = back('connected=1');
    res.cookies.delete({ name: 'qbo_oauth_state', path: '/api/quickbooks' });
    return res;
  } catch (e) {
    console.error('[qbo callback]', e);
    return back(`error=${encodeURIComponent(qboErrorMessage(e))}`);
  }
}
```

- [ ] **Step 3: Implement `disconnect`**

```ts
import { NextResponse } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { revokeToken } from '@/lib/qbo/client';
import { QBO_ADMIN_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/quickbooks/disconnect — superadmin. Revokes the key at Intuit and
// forgets it. Linked invoices and customer matches are KEPT, so reconnecting
// the same company carries on where it left off.
export async function POST() {
  const auth = await requireRole([...QBO_ADMIN_ROLES]);
  if ('error' in auth) return auth.error;
  const service = createServiceClient();
  const { data } = await service
    .from('qbo_connection')
    .select('realm_id, company_name, environment, refresh_token')
    .eq('id', 1)
    .maybeSingle();
  if (!data) return NextResponse.json({ ok: true });
  await revokeToken(data.refresh_token).catch((e) =>
    console.warn('[qbo disconnect] revoke failed, forgetting anyway:', e)
  );
  const { error } = await service.from('qbo_connection').delete().eq('id', 1);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
    action: 'qbo.connection.disconnect',
    entityType: 'qbo_connection',
    entityId: data.realm_id,
    context: { company_name: data.company_name, environment: data.environment },
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors in `app/api/quickbooks/**`.

- [ ] **Step 5: Commit**

```bash
git add app/api/quickbooks/connect/route.ts app/api/quickbooks/callback/route.ts app/api/quickbooks/disconnect/route.ts && git commit -m "feat(qbo): connect and disconnect QuickBooks (superadmin)"
```

### Task 2.3: Sync core — stage writer, `refreshInvoice`, create / link

**Files:**

- Create: `lib/qbo/stage-write.ts`, `lib/qbo/sync.ts`, `lib/qbo/invoice-actions.ts`
- Test: `__tests__/qbo/invoice-actions.test.ts`

**Interfaces:**

- Consumes: Tasks 1.2, 1.3, 2.1.
- Produces:
  - `QBO_SYSTEM_ACTOR`, `QBO_SYNC_LABEL = 'QuickBooks sync'`
  - `readStageSnapshot(service, ayCode, enroleeNumber, stage): Promise<StageSnapshot | null>`
  - `writeStageFromQbo(service, args: { ayCode: string; enroleeNumber: string; stage: QboStageKey; patch: StagePatch; actor: { id: string | null; email: string | null; role: string | null }; updatedBy: string; docNumber: string | null; trigger: 'create' | 'link' | 'sync' }): Promise<{ ok: true; changed: number } | { ok: false; error: string }>`
  - `refreshInvoice(service, qboInvoiceId: string): Promise<{ known: boolean; stageChanged: boolean; stageError?: string }>`
  - `refreshInvoicesForPayment(service, paymentId: string): Promise<number>` (invoices refreshed)
  - `paymentDateFor(service, inv: QbInvoice): Promise<string | null>`
  - `linkRefusal(args: { invoice: QbInvoice; customerId: string; alreadyLinked: { ayCode: string; enroleeNumber: string; stage: string } | null }): string | null`
  - `createdButNotSaved(docNumber: string | undefined): string`
  - `buildInvoiceLines(lines: Array<{ itemId: string; description?: string; qty: number; unitPrice: number }>, items: Map<string, { Id: string; Name: string; SalesTaxCodeRef?: { value: string } }>): Array<Record<string, unknown>>`

- [ ] **Step 1: Write the failing test** (`__tests__/qbo/invoice-actions.test.ts`):

```ts
import { describe, expect, it } from 'vitest';

import {
  buildInvoiceLines,
  createdButNotSaved,
  linkRefusal,
} from '@/lib/qbo/invoice-actions';
import type { QbInvoice } from '@/lib/qbo/invoice-snapshot';

const inv: QbInvoice = {
  Id: '130',
  DocNumber: '1042',
  TotalAmt: 2800,
  Balance: 2800,
  SyncToken: '0',
  CustomerRef: { value: '58', name: 'LIM, SOFIA ALCANTARA' },
};

describe('linkRefusal', () => {
  it("allows the customer's own unlinked invoice", () => {
    expect(
      linkRefusal({ invoice: inv, customerId: '58', alreadyLinked: null })
    ).toBeNull();
  });
  it("refuses another customer's invoice", () => {
    expect(
      linkRefusal({ invoice: inv, customerId: '77', alreadyLinked: null })
    ).toBe(
      'Invoice 1042 belongs to LIM, SOFIA ALCANTARA in QuickBooks, not this student.'
    );
  });
  it('refuses an invoice already linked elsewhere', () => {
    expect(
      linkRefusal({
        invoice: inv,
        customerId: '58',
        alreadyLinked: {
          ayCode: 'AY2027',
          enroleeNumber: 'E270011',
          stage: 'registration',
        },
      })
    ).toBe(
      'Invoice 1042 is already linked to the Registration stage of E270011 (AY2027).'
    );
  });
});

describe('createdButNotSaved', () => {
  it('names the QuickBooks number and the way out', () => {
    expect(createdButNotSaved('1042')).toBe(
      "QuickBooks created invoice 1042, but the SIS couldn't save it. Use Link QB invoice to attach it — don't create it again."
    );
  });
});

describe('buildInvoiceLines', () => {
  it("uses the item's own tax code and computes the amount", () => {
    const items = new Map([
      ['5', { Id: '5', Name: 'Tuition Fee', SalesTaxCodeRef: { value: '12' } }],
      ['6', { Id: '6', Name: 'Annual Fee' }],
    ]);
    expect(
      buildInvoiceLines(
        [
          { itemId: '5', qty: 2, unitPrice: 1000.5 },
          { itemId: '6', qty: 1, unitPrice: 800, description: 'AY2027' },
        ],
        items
      )
    ).toEqual([
      {
        DetailType: 'SalesItemLineDetail',
        Amount: 2001,
        SalesItemLineDetail: {
          ItemRef: { value: '5', name: 'Tuition Fee' },
          Qty: 2,
          UnitPrice: 1000.5,
          TaxCodeRef: { value: '12' },
        },
      },
      {
        DetailType: 'SalesItemLineDetail',
        Amount: 800,
        Description: 'AY2027',
        SalesItemLineDetail: {
          ItemRef: { value: '6', name: 'Annual Fee' },
          Qty: 1,
          UnitPrice: 800,
        },
      },
    ]);
  });

  it('throws on an item QuickBooks no longer has', () => {
    expect(() =>
      buildInvoiceLines([{ itemId: '99', qty: 1, unitPrice: 1 }], new Map())
    ).toThrow(
      'One of the items is no longer in QuickBooks. Reopen the drawer and pick again.'
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --pool=threads __tests__/qbo/invoice-actions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/qbo/invoice-actions.ts`** (pure)

```ts
import type { QbInvoice } from '@/lib/qbo/invoice-snapshot';

const STAGE_NAME: Record<string, string> = {
  registration: 'Registration',
  fees: 'Fees',
};

export function linkRefusal(args: {
  invoice: QbInvoice;
  customerId: string;
  alreadyLinked: {
    ayCode: string;
    enroleeNumber: string;
    stage: string;
  } | null;
}): string | null {
  const no = args.invoice.DocNumber ?? args.invoice.Id;
  if (args.invoice.CustomerRef.value !== args.customerId) {
    return `Invoice ${no} belongs to ${args.invoice.CustomerRef.name ?? 'another customer'} in QuickBooks, not this student.`;
  }
  if (args.alreadyLinked) {
    const a = args.alreadyLinked;
    return `Invoice ${no} is already linked to the ${STAGE_NAME[a.stage] ?? a.stage} stage of ${a.enroleeNumber} (${a.ayCode}).`;
  }
  return null;
}

export function createdButNotSaved(docNumber: string | undefined): string {
  return `QuickBooks created invoice ${docNumber ?? '(no number)'}, but the SIS couldn't save it. Use Link QB invoice to attach it — don't create it again.`;
}

type ItemLite = {
  Id: string;
  Name: string;
  SalesTaxCodeRef?: { value: string };
};

export function buildInvoiceLines(
  lines: Array<{
    itemId: string;
    description?: string;
    qty: number;
    unitPrice: number;
  }>,
  items: Map<string, ItemLite>
): Array<Record<string, unknown>> {
  return lines.map((l) => {
    const item = items.get(l.itemId);
    if (!item) {
      throw new Error(
        'One of the items is no longer in QuickBooks. Reopen the drawer and pick again.'
      );
    }
    const amount = Math.round(l.qty * l.unitPrice * 100) / 100;
    return {
      DetailType: 'SalesItemLineDetail',
      Amount: amount,
      ...(l.description?.trim() ? { Description: l.description.trim() } : {}),
      SalesItemLineDetail: {
        ItemRef: { value: item.Id, name: item.Name },
        Qty: l.qty,
        UnitPrice: l.unitPrice,
        // The item's own tax code — "what QuickBooks applies by default".
        ...(item.SalesTaxCodeRef
          ? { TaxCodeRef: { value: item.SalesTaxCodeRef.value } }
          : {}),
      },
    };
  });
}
```

- [ ] **Step 4: Implement `lib/qbo/stage-write.ts`**

```ts
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidateTag } from 'next/cache';

import { logAction } from '@/lib/audit/log-action';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import type {
  QboStageKey,
  StagePatch,
  StageSnapshot,
} from '@/lib/qbo/stage-state';
import {
  findStageCompletionBlockers,
  STAGE_COLUMN_MAP,
  STAGE_LABELS,
  stageCompletionMessage,
} from '@/lib/schemas/sis';
import { resolveEffectiveStageValues } from '@/lib/sis/stage-completion';

export const QBO_SYSTEM_ACTOR = {
  id: null,
  email: 'system:quickbooks-sync',
  role: null,
} as const;
export const QBO_SYNC_LABEL = 'QuickBooks sync';

const statusTable = (ayCode: string) =>
  `ay${ayCode.replace(/^AY/i, '').toLowerCase()}_enrolment_status`;

const colFor = (stage: QboStageKey, fieldKey: string) =>
  STAGE_COLUMN_MAP[stage].extras.find((e) => e.fieldKey === fieldKey)
    ?.columnName ?? null;

export async function readStageSnapshot(
  service: SupabaseClient,
  ayCode: string,
  enroleeNumber: string,
  stage: QboStageKey
): Promise<StageSnapshot | null> {
  const cols = STAGE_COLUMN_MAP[stage];
  const invoiceCol = colFor(stage, 'invoice')!;
  const paymentCol = colFor(stage, 'paymentDate')!;
  const startCol = colFor(stage, 'startDate');
  const select = [cols.statusCol, invoiceCol, paymentCol, startCol]
    .filter(Boolean)
    .join(', ');
  const { data, error } = await service
    .from(statusTable(ayCode))
    .select(select)
    .eq('enroleeNumber', enroleeNumber)
    .maybeSingle();
  if (error) throw new Error(`Stage lookup failed: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as Record<string, string | null>;
  return {
    status: row[cols.statusCol] ?? null,
    invoice: row[invoiceCol] ?? null,
    paymentDate: row[paymentCol] ?? null,
    startDate: startCol ? (row[startCol] ?? null) : null,
  };
}

/**
 * Writes what QuickBooks says to the stage — the same columns, the same
 * required-field check and the same `sis.stage.update` audit row as the stage
 * PATCH route, so a sync change reads in the log exactly like a person's.
 */
export async function writeStageFromQbo(
  service: SupabaseClient,
  args: {
    ayCode: string;
    enroleeNumber: string;
    stage: QboStageKey;
    patch: StagePatch;
    actor: { id: string | null; email: string | null; role: string | null };
    updatedBy: string;
    docNumber: string | null;
    trigger: 'create' | 'link' | 'sync';
  }
): Promise<{ ok: true; changed: number } | { ok: false; error: string }> {
  const cols = STAGE_COLUMN_MAP[args.stage];
  const table = statusTable(args.ayCode);
  const beforeSelect = [
    cols.statusCol,
    cols.remarksCol,
    ...cols.extras.map((e) => e.columnName),
  ].join(', ');
  const { data: before, error: beforeErr } = await service
    .from(table)
    .select(beforeSelect)
    .eq('enroleeNumber', args.enroleeNumber)
    .maybeSingle();
  if (beforeErr)
    return { ok: false, error: `Stage lookup failed: ${beforeErr.message}` };
  if (!before)
    return { ok: false, error: 'No status row for this enrolee in this year.' };
  const pre = before as unknown as Record<string, unknown>;

  const extras: Record<string, string | null> = {};
  if (args.patch.invoice !== undefined) extras.invoice = args.patch.invoice;
  if (args.patch.paymentDate !== undefined)
    extras.paymentDate = args.patch.paymentDate;

  const effective = resolveEffectiveStageValues(
    cols,
    pre,
    args.patch.status,
    extras
  );
  const blockers = findStageCompletionBlockers(
    args.stage,
    effective.status,
    effective.extras
  );
  if (blockers.length > 0) {
    return {
      ok: false,
      error: stageCompletionMessage(
        args.stage,
        effective.status ?? '',
        blockers
      ),
    };
  }

  const update: Record<string, unknown> = {
    [cols.updatedDateCol]: new Date().toISOString(),
    [cols.updatedByCol]: args.updatedBy,
  };
  if (args.patch.status !== undefined)
    update[cols.statusCol] = args.patch.status;
  for (const [fieldKey, value] of Object.entries(extras)) {
    update[colFor(args.stage, fieldKey)!] = value;
  }

  const changes: Array<{ field: string; from: unknown; to: unknown }> = [];
  for (const [col, next] of Object.entries(update)) {
    if (col === cols.updatedDateCol || col === cols.updatedByCol) continue;
    const prev = pre[col] ?? null;
    if ((prev ?? null) !== (next ?? null))
      changes.push({ field: col, from: prev, to: next });
  }
  if (changes.length === 0) return { ok: true, changed: 0 };

  const { error: upErr } = await service
    .from(table)
    .update(update)
    .eq('enroleeNumber', args.enroleeNumber);
  if (upErr) return { ok: false, error: upErr.message };

  await logAction({
    service,
    actor: args.actor,
    action: 'sis.stage.update',
    entityType: 'enrolment_status',
    entityId: args.enroleeNumber,
    context: {
      ay_code: args.ayCode,
      stage: args.stage,
      stage_label: STAGE_LABELS[args.stage],
      changes,
      source: 'quickbooks',
      trigger: args.trigger,
      qbo_doc_number: args.docNumber,
    },
  });

  revalidateTag(`sis:${args.ayCode}`, 'max');
  invalidateDrillTags('admissions', args.ayCode);
  invalidateDrillTags('records', args.ayCode);
  return { ok: true, changed: changes.length };
}
```

- [ ] **Step 5: Implement `lib/qbo/sync.ts`**

```ts
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { QboError, qboRequest } from '@/lib/qbo/client';
import {
  invoiceState,
  latestDate,
  linkedPaymentIds,
  type QbInvoice,
} from '@/lib/qbo/invoice-snapshot';
import {
  QBO_SYNC_LABEL,
  QBO_SYSTEM_ACTOR,
  readStageSnapshot,
  writeStageFromQbo,
} from '@/lib/qbo/stage-write';
import { isQboStageKey, stageOnInvoiceChange } from '@/lib/qbo/stage-state';

type InvoiceRow = {
  id: string;
  ay_code: string;
  enrolee_number: string;
  stage_key: string;
  doc_number: string | null;
  state: string;
  payment_date: string | null;
  is_current: boolean;
};

/** Date of the payment that cleared it: the newest linked payment's date. */
export async function paymentDateFor(
  service: SupabaseClient,
  inv: QbInvoice
): Promise<string | null> {
  const dates = await Promise.all(
    linkedPaymentIds(inv).map((id) =>
      qboRequest<{ Payment?: { TxnDate?: string } }>(
        service,
        'GET',
        `/payment/${id}`
      )
        .then((r) => r.Payment?.TxnDate ?? null)
        .catch(() => null)
    )
  );
  return latestDate(dates);
}

async function fetchInvoice(
  service: SupabaseClient,
  id: string
): Promise<QbInvoice | null> {
  try {
    const r = await qboRequest<{ Invoice: QbInvoice }>(
      service,
      'GET',
      `/invoice/${id}`
    );
    return r.Invoice;
  } catch (e) {
    // 610 = Object Not Found: the invoice was deleted in QuickBooks.
    if (e instanceof QboError && e.code === '610') return null;
    throw e;
  }
}

/**
 * Re-reads one invoice from QuickBooks, stores what it says, and — when it is
 * the stage's current invoice and its state or payment date changed — moves
 * the stage. Invoices the SIS doesn't know are ignored.
 */
export async function refreshInvoice(
  service: SupabaseClient,
  qboInvoiceId: string
): Promise<{ known: boolean; stageChanged: boolean; stageError?: string }> {
  const { data } = await service
    .from('qbo_invoices')
    .select(
      'id, ay_code, enrolee_number, stage_key, doc_number, state, payment_date, is_current'
    )
    .eq('qbo_invoice_id', qboInvoiceId)
    .maybeSingle();
  const row = data as InvoiceRow | null;
  if (!row) return { known: false, stageChanged: false };

  const inv = await fetchInvoice(service, qboInvoiceId);
  const state = invoiceState(inv);
  const paymentDate =
    inv && state === 'paid' ? await paymentDateFor(service, inv) : null;
  const docNumber = inv?.DocNumber ?? row.doc_number;

  await service
    .from('qbo_invoices')
    .update({
      doc_number: docNumber,
      total: inv ? Number(inv.TotalAmt) : 0,
      balance: inv ? Number(inv.Balance) : 0,
      state,
      payment_date: paymentDate,
      sync_token: inv?.SyncToken ?? null,
      synced_at: new Date().toISOString(),
    })
    .eq('id', row.id);

  const changed =
    row.state !== state ||
    (row.payment_date ?? null) !== (paymentDate ?? null) ||
    (row.doc_number ?? null) !== (docNumber ?? null);
  if (!changed || !row.is_current || !isQboStageKey(row.stage_key)) {
    return { known: true, stageChanged: false };
  }

  const stage = row.stage_key;
  const current = await readStageSnapshot(
    service,
    row.ay_code,
    row.enrolee_number,
    stage
  );
  if (!current) return { known: true, stageChanged: false };
  const patch = stageOnInvoiceChange(stage, current, {
    docNumber: docNumber ?? '',
    state,
    paymentDate,
  });
  if (!patch) return { known: true, stageChanged: false };

  const res = await writeStageFromQbo(service, {
    ayCode: row.ay_code,
    enroleeNumber: row.enrolee_number,
    stage,
    patch,
    actor: QBO_SYSTEM_ACTOR,
    updatedBy: QBO_SYNC_LABEL,
    docNumber,
    trigger: 'sync',
  });
  return res.ok
    ? { known: true, stageChanged: res.changed > 0 }
    : { known: true, stageChanged: false, stageError: res.error };
}

/** A payment changed: refresh every invoice the SIS knows that it pays. */
export async function refreshInvoicesForPayment(
  service: SupabaseClient,
  paymentId: string
): Promise<number> {
  type QbPayment = {
    Line?: Array<{ LinkedTxn?: Array<{ TxnId: string; TxnType: string }> }>;
  };
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
    // A deleted payment can't be read; its invoices change too and arrive as
    // Invoice events / in the hourly check.
    if (e instanceof QboError && e.code === '610') return 0;
    throw e;
  }
  const ids = new Set<string>();
  for (const l of payment?.Line ?? []) {
    for (const t of l.LinkedTxn ?? [])
      if (t.TxnType === 'Invoice') ids.add(t.TxnId);
  }
  let n = 0;
  for (const id of ids) if ((await refreshInvoice(service, id)).known) n++;
  return n;
}
```

- [ ] **Step 6: Run the tests and type-check**

Run: `npx vitest run --pool=threads __tests__/qbo && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add lib/qbo/invoice-actions.ts lib/qbo/stage-write.ts lib/qbo/sync.ts __tests__/qbo/invoice-actions.test.ts && git commit -m "feat(qbo): sync core — refresh an invoice and move its stage"
```

### Task 2.4: Routes — items, customers, open invoices, stage invoice, refresh

**Files:**

- Create: `app/api/quickbooks/items/route.ts`, `app/api/quickbooks/customers/route.ts`, `app/api/quickbooks/customers/[customerId]/invoices/route.ts`, `app/api/sis/students/[enroleeNumber]/stage/[stageKey]/invoice/route.ts`, `app/api/sis/students/[enroleeNumber]/stage/[stageKey]/invoice/refresh/route.ts`, `lib/qbo/runs.ts`
- Modify: `docs/context/07-api-routes.md` (add the routes below)

**Interfaces:**

- Consumes: everything above.
- Produces (JSON contracts the UI in Phase 3 uses verbatim):
  - `GET /api/quickbooks/items` → `{ items: Array<{ id: string; name: string; description: string | null; unitPrice: number | null }> }`
  - `GET /api/quickbooks/customers?ay=AY2027&enrolee=E270011[&q=text]` → `{ linked: QbCustomer | null; exact: QbCustomer[]; similar: QbCustomer[] }`, `QbCustomer = { id: string; displayName: string }`
  - `GET /api/quickbooks/customers/[customerId]/invoices` → `{ invoices: Array<{ id: string; docNumber: string | null; txnDate: string | null; total: number; balance: number }> }` (open, not already linked)
  - `POST /api/sis/students/[enroleeNumber]/stage/[stageKey]/invoice` body `{ mode: 'create', ayCode, customerId, customerName, matchedBy: 'auto' | 'staff', lines: [{ itemId, description?, qty, unitPrice }], txnDate, dueDate?: string | null, memo?: string }` or `{ mode: 'link', ayCode, customerId, customerName, matchedBy, qboInvoiceId }` → `{ ok: true; docNumber: string | null; stageWarning: string | null }`
  - `POST .../invoice/refresh` body `{ ayCode }` → `{ ok: true; stageChanged: boolean; stageWarning: string | null }`
  - `startRun(service, source)`, `finishRun(service, id, { invoicesUpdated, error })` in `lib/qbo/runs.ts`

- [ ] **Step 1: `lib/qbo/runs.ts`**

```ts
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

export async function startRun(
  service: SupabaseClient,
  source: 'webhook' | 'hourly' | 'manual'
): Promise<string | null> {
  const { data } = await service
    .from('qbo_sync_runs')
    .insert({ source })
    .select('id')
    .single();
  return (data as { id: string } | null)?.id ?? null;
}

export async function finishRun(
  service: SupabaseClient,
  id: string | null,
  result: { invoicesUpdated: number; error: string | null }
): Promise<void> {
  if (!id) return;
  await service
    .from('qbo_sync_runs')
    .update({
      finished_at: new Date().toISOString(),
      invoices_updated: result.invoicesUpdated,
      error: result.error,
    })
    .eq('id', id);
}
```

- [ ] **Step 2: Items route**

```ts
import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { qboErrorMessage, qboQuery } from '@/lib/qbo/client';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

// GET /api/quickbooks/items — the school's active QuickBooks items for the
// Create invoice drawer. The SIS never keeps its own fee list.
export async function GET() {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  try {
    const items = await qboQuery<{
      Id: string;
      Name: string;
      Description?: string;
      UnitPrice?: number;
      Type?: string;
    }>(
      createServiceClient(),
      'Item',
      'Active = true',
      'orderby Name maxresults 1000'
    );
    return NextResponse.json({
      items: items
        .filter((i) => i.Type !== 'Category')
        .map((i) => ({
          id: i.Id,
          name: i.Name,
          description: i.Description ?? null,
          unitPrice: typeof i.UnitPrice === 'number' ? i.UnitPrice : null,
        })),
    });
  } catch (e) {
    return NextResponse.json({ error: qboErrorMessage(e) }, { status: 502 });
  }
}
```

- [ ] **Step 3: Customers route**

```ts
import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { qbEscape, qboErrorMessage, qboQuery } from '@/lib/qbo/client';
import {
  exactMatches,
  normalizeName,
  studentNameForms,
} from '@/lib/qbo/customer-match';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';

type QbCustomer = { Id: string; DisplayName: string };
const view = (c: QbCustomer) => ({ id: c.Id, displayName: c.DisplayName });

// GET /api/quickbooks/customers?ay&enrolee[&q]
// The stored match first; otherwise QuickBooks customers sharing the
// student's last name, split into exact full-name matches and the rest.
// `q` searches by any text the person types instead.
export async function GET(request: NextRequest) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const url = new URL(request.url);
  const ayCode = (url.searchParams.get('ay') ?? '').trim();
  const enrolee = (url.searchParams.get('enrolee') ?? '').trim();
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!/^AY\d{4}$/i.test(ayCode) || !enrolee) {
    return NextResponse.json(
      { error: 'Missing ay or enrolee' },
      { status: 400 }
    );
  }

  const prefix = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
  const { data: app } = await createAdmissionsClient()
    .from(`${prefix}_enrolment_applications`)
    .select('studentNumber, enroleeFullName, firstName, middleName, lastName')
    .eq('enroleeNumber', enrolee)
    .maybeSingle();
  if (!app)
    return NextResponse.json(
      { error: 'Application not found' },
      { status: 404 }
    );
  const a = app as {
    studentNumber: string | null;
    enroleeFullName: string | null;
    firstName: string | null;
    middleName: string | null;
    lastName: string | null;
  };

  const service = createServiceClient();
  if (!q && a.studentNumber) {
    const { data: stored } = await service
      .from('qbo_customers')
      .select('qbo_customer_id, display_name')
      .eq('student_number', a.studentNumber)
      .maybeSingle();
    if (stored) {
      return NextResponse.json({
        linked: {
          id: stored.qbo_customer_id,
          displayName: stored.display_name,
        },
        exact: [],
        similar: [],
      });
    }
  }

  try {
    const term = q || (a.lastName ?? '').trim();
    if (!term)
      return NextResponse.json({ linked: null, exact: [], similar: [] });
    const found = await qboQuery<QbCustomer>(
      service,
      'Customer',
      `Active = true and DisplayName LIKE '%${qbEscape(term)}%'`,
      'maxresults 50'
    );
    const exact = q ? [] : exactMatches(found, studentNameForms(a));
    const exactIds = new Set(exact.map((c) => c.Id));
    const similar = found
      .filter((c) => !exactIds.has(c.Id))
      .sort((x, y) =>
        normalizeName(x.DisplayName).localeCompare(normalizeName(y.DisplayName))
      )
      .slice(0, 20);
    return NextResponse.json({
      linked: null,
      exact: exact.map(view),
      similar: similar.map(view),
    });
  } catch (e) {
    return NextResponse.json({ error: qboErrorMessage(e) }, { status: 502 });
  }
}
```

- [ ] **Step 4: Customer invoices route**

```ts
import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { qbEscape, qboErrorMessage, qboQuery } from '@/lib/qbo/client';
import type { QbInvoice } from '@/lib/qbo/invoice-snapshot';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

// GET /api/quickbooks/customers/[customerId]/invoices — that customer's open
// invoices that no stage has linked yet, newest first.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ customerId: string }> }
) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const { customerId } = await params;
  const service = createServiceClient();
  try {
    const invoices = await qboQuery<QbInvoice>(
      service,
      'Invoice',
      `CustomerRef = '${qbEscape(customerId)}' and Balance > '0'`,
      'orderby TxnDate desc maxresults 50'
    );
    const { data: linked } = await service
      .from('qbo_invoices')
      .select('qbo_invoice_id')
      .in(
        'qbo_invoice_id',
        invoices.map((i) => i.Id).length ? invoices.map((i) => i.Id) : ['-']
      );
    const taken = new Set(
      (linked ?? []).map((r) => r.qbo_invoice_id as string)
    );
    return NextResponse.json({
      invoices: invoices
        .filter((i) => !taken.has(i.Id))
        .map((i) => ({
          id: i.Id,
          docNumber: i.DocNumber ?? null,
          txnDate: i.TxnDate ?? null,
          total: Number(i.TotalAmt),
          balance: Number(i.Balance),
        })),
    });
  } catch (e) {
    return NextResponse.json({ error: qboErrorMessage(e) }, { status: 502 });
  }
}
```

- [ ] **Step 5: Stage invoice route (create / link)**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import {
  QboError,
  QboNotConnectedError,
  qbEscape,
  qboErrorMessage,
  qboQuery,
  qboRequest,
} from '@/lib/qbo/client';
import {
  buildInvoiceLines,
  createdButNotSaved,
  linkRefusal,
} from '@/lib/qbo/invoice-actions';
import { invoiceState, type QbInvoice } from '@/lib/qbo/invoice-snapshot';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { readStageSnapshot, writeStageFromQbo } from '@/lib/qbo/stage-write';
import { isQboStageKey, stageOnNewInvoice } from '@/lib/qbo/stage-state';
import { paymentDateFor } from '@/lib/qbo/sync';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';

const Date10 = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Common = {
  ayCode: z.string().regex(/^AY\d{4}$/i),
  customerId: z.string().min(1),
  customerName: z.string().min(1),
  matchedBy: z.enum(['auto', 'staff']),
};
const Body = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('create'),
    ...Common,
    lines: z
      .array(
        z.object({
          itemId: z.string().min(1),
          description: z.string().max(4000).optional(),
          qty: z.number().positive(),
          unitPrice: z.number().nonnegative(),
        })
      )
      .min(1)
      .max(50),
    txnDate: Date10,
    dueDate: Date10.nullable().optional(),
    memo: z.string().max(1000).optional(),
  }),
  z.object({
    mode: z.literal('link'),
    ...Common,
    qboInvoiceId: z.string().min(1),
  }),
]);

// POST /api/sis/students/[enroleeNumber]/stage/[stageKey]/invoice
// QuickBooks FIRST: only once QuickBooks has the invoice does the SIS record
// it and move the stage. If QuickBooks refuses, nothing is saved.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ enroleeNumber: string; stageKey: string }> }
) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const { enroleeNumber, stageKey } = await params;
  if (!isQboStageKey(stageKey)) {
    return NextResponse.json(
      { error: `Stage "${stageKey}" doesn't take QuickBooks invoices.` },
      { status: 400 }
    );
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
      { status: 400 }
    );
  }
  const body = parsed.data;
  const ayCode = body.ayCode.toUpperCase();
  const prefix = `ay${ayCode.slice(2)}`;
  const service = createServiceClient();

  const { data: app } = await createAdmissionsClient()
    .from(`${prefix}_enrolment_applications`)
    .select('studentNumber')
    .eq('enroleeNumber', enroleeNumber)
    .maybeSingle();
  const studentNumber =
    (app as { studentNumber: string | null } | null)?.studentNumber ?? null;
  if (!studentNumber) {
    return NextResponse.json(
      {
        error:
          "This applicant has no student number yet, so their QuickBooks customer can't be remembered. Give them one first.",
      },
      { status: 422 }
    );
  }
  const current = await readStageSnapshot(
    service,
    ayCode,
    enroleeNumber,
    stageKey
  );
  if (!current) {
    return NextResponse.json(
      { error: 'No status row for this enrolee in this year.' },
      { status: 404 }
    );
  }
  if (current.status === 'Cancelled') {
    return NextResponse.json(
      {
        error:
          'This stage is Cancelled. Change its status first if a new invoice is needed.',
      },
      { status: 422 }
    );
  }

  // 1) QuickBooks.
  let invoice: QbInvoice;
  try {
    if (body.mode === 'link') {
      invoice = (
        await qboRequest<{ Invoice: QbInvoice }>(
          service,
          'GET',
          `/invoice/${encodeURIComponent(body.qboInvoiceId)}`
        )
      ).Invoice;
      const { data: other } = await service
        .from('qbo_invoices')
        .select('ay_code, enrolee_number, stage_key')
        .eq('qbo_invoice_id', invoice.Id)
        .maybeSingle();
      const refusal = linkRefusal({
        invoice,
        customerId: body.customerId,
        alreadyLinked: other
          ? {
              ayCode: other.ay_code,
              enroleeNumber: other.enrolee_number,
              stage: other.stage_key,
            }
          : null,
      });
      if (refusal)
        return NextResponse.json({ error: refusal }, { status: 409 });
    } else {
      const ids = Array.from(new Set(body.lines.map((l) => l.itemId)));
      const items = await qboQuery<{
        Id: string;
        Name: string;
        SalesTaxCodeRef?: { value: string };
      }>(
        service,
        'Item',
        `Id in (${ids.map((i) => `'${qbEscape(i)}'`).join(', ')})`
      );
      const lines = buildInvoiceLines(
        body.lines,
        new Map(items.map((i) => [i.Id, i]))
      );
      const { data: who } = await service.auth.admin.getUserById(auth.user.id);
      const staffName =
        (who?.user?.user_metadata?.full_name as string | undefined) ??
        auth.user.email ??
        'staff';
      invoice = (
        await qboRequest<{ Invoice: QbInvoice }>(service, 'POST', '/invoice', {
          CustomerRef: { value: body.customerId },
          TxnDate: body.txnDate,
          ...(body.dueDate ? { DueDate: body.dueDate } : {}),
          Line: lines,
          ...(body.memo?.trim()
            ? { CustomerMemo: { value: body.memo.trim() } }
            : {}),
          PrivateNote: `Created from SIS by ${staffName}`,
          AutoDocNumber: true,
        })
      ).Invoice;
    }
  } catch (e) {
    // buildInvoiceLines throws a plain Error with a sentence meant for staff.
    const message =
      e instanceof Error &&
      !(e instanceof QboError) &&
      !(e instanceof QboNotConnectedError) &&
      e.message.startsWith('One of the items')
        ? e.message
        : qboErrorMessage(e);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // 2) The SIS remembers the invoice.
  const state = invoiceState(invoice);
  const paymentDate =
    state === 'paid' ? await paymentDateFor(service, invoice) : null;
  const saved = await (async () => {
    const { error: cErr } = await service.from('qbo_customers').upsert({
      student_number: studentNumber,
      qbo_customer_id: body.customerId,
      display_name: body.customerName,
      matched_by:
        body.matchedBy === 'auto' ? 'auto' : (auth.user.email ?? 'staff'),
      matched_at: new Date().toISOString(),
    });
    if (cErr) return cErr.message;
    const { error: oldErr } = await service
      .from('qbo_invoices')
      .update({ is_current: false })
      .eq('ay_code', ayCode)
      .eq('enrolee_number', enroleeNumber)
      .eq('stage_key', stageKey)
      .eq('is_current', true);
    if (oldErr) return oldErr.message;
    const { error: insErr } = await service.from('qbo_invoices').insert({
      ay_code: ayCode,
      enrolee_number: enroleeNumber,
      student_number: studentNumber,
      stage_key: stageKey,
      qbo_invoice_id: invoice.Id,
      doc_number: invoice.DocNumber ?? null,
      total: Number(invoice.TotalAmt),
      balance: Number(invoice.Balance),
      state,
      payment_date: paymentDate,
      sync_token: invoice.SyncToken,
      source: body.mode === 'create' ? 'created' : 'linked',
      created_by: auth.user.id,
      created_by_email: auth.user.email,
      is_current: true,
    });
    return insErr?.message ?? null;
  })();
  if (saved) {
    console.error(
      '[qbo invoice] SIS save failed after QuickBooks accepted:',
      saved
    );
    return NextResponse.json(
      {
        error:
          body.mode === 'create'
            ? createdButNotSaved(invoice.DocNumber)
            : `The SIS couldn't save the link: ${saved}`,
      },
      { status: 500 }
    );
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
    action: body.mode === 'create' ? 'qbo.invoice.create' : 'qbo.invoice.link',
    entityType: 'qbo_invoice',
    entityId: invoice.Id,
    context: {
      ay_code: ayCode,
      enroleeNumber,
      studentNumber,
      stage: stageKey,
      doc_number: invoice.DocNumber ?? null,
      total: Number(invoice.TotalAmt),
      customer: body.customerName,
    },
  });

  // 3) The stage.
  let stageWarning: string | null = null;
  const patch = stageOnNewInvoice(stageKey, current, {
    docNumber: invoice.DocNumber ?? invoice.Id,
    state,
    paymentDate,
  });
  if (patch) {
    const res = await writeStageFromQbo(service, {
      ayCode,
      enroleeNumber,
      stage: stageKey,
      patch,
      actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
      updatedBy: auth.user.email ?? '(unknown)',
      docNumber: invoice.DocNumber ?? null,
      trigger: body.mode,
    });
    if (!res.ok)
      stageWarning = `Saved in QuickBooks, but the stage wasn't updated: ${res.error}`;
  }
  return NextResponse.json({
    ok: true,
    docNumber: invoice.DocNumber ?? null,
    stageWarning,
  });
}
```

- [ ] **Step 6: Refresh route**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireRole } from '@/lib/auth/require-role';
import { qboErrorMessage } from '@/lib/qbo/client';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { finishRun, startRun } from '@/lib/qbo/runs';
import { isQboStageKey } from '@/lib/qbo/stage-state';
import { refreshInvoice } from '@/lib/qbo/sync';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sis/students/[enroleeNumber]/stage/[stageKey]/invoice/refresh
// "Refresh from QuickBooks" on the tile — the same refresh the webhook and the
// hourly check run, for this stage's current invoice.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ enroleeNumber: string; stageKey: string }> }
) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const { enroleeNumber, stageKey } = await params;
  if (!isQboStageKey(stageKey)) {
    return NextResponse.json(
      { error: `Stage "${stageKey}" doesn't take QuickBooks invoices.` },
      { status: 400 }
    );
  }
  const parsed = z
    .object({ ayCode: z.string().regex(/^AY\d{4}$/i) })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: 'Invalid ayCode' }, { status: 400 });
  const ayCode = parsed.data.ayCode.toUpperCase();
  const service = createServiceClient();
  const { data: row } = await service
    .from('qbo_invoices')
    .select('qbo_invoice_id')
    .eq('ay_code', ayCode)
    .eq('enrolee_number', enroleeNumber)
    .eq('stage_key', stageKey)
    .eq('is_current', true)
    .maybeSingle();
  if (!row)
    return NextResponse.json(
      { error: 'This stage has no QuickBooks invoice yet.' },
      { status: 404 }
    );

  const runId = await startRun(service, 'manual');
  try {
    const r = await refreshInvoice(service, row.qbo_invoice_id as string);
    await finishRun(service, runId, {
      invoicesUpdated: 1,
      error: r.stageError ?? null,
    });
    return NextResponse.json({
      ok: true,
      stageChanged: r.stageChanged,
      stageWarning: r.stageError
        ? `QuickBooks was read, but the stage wasn't updated: ${r.stageError}`
        : null,
    });
  } catch (e) {
    const message = qboErrorMessage(e);
    await finishRun(service, runId, { invoicesUpdated: 0, error: message });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
```

- [ ] **Step 7: Type-check, lint, update API doc, commit**

Add the five routes and their bodies/responses (from **Interfaces** above) to `docs/context/07-api-routes.md` under a new "QuickBooks" heading.

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

```bash
git add lib/qbo/runs.ts app/api/quickbooks/items/route.ts app/api/quickbooks/customers/route.ts "app/api/quickbooks/customers/[customerId]/invoices/route.ts" "app/api/sis/students/[enroleeNumber]/stage/[stageKey]/invoice/route.ts" "app/api/sis/students/[enroleeNumber]/stage/[stageKey]/invoice/refresh/route.ts" docs/context/07-api-routes.md && git commit -m "feat(qbo): create and link invoices from a stage, refresh from QuickBooks"
```

### Task 2.5: Webhook and hourly check

**Files:**

- Create: `app/api/quickbooks/webhook/route.ts`, `app/api/quickbooks/cdc/route.ts`, `lib/qbo/cdc.ts`
- Modify: `vercel.json`
- Test: `__tests__/qbo/cdc.test.ts`

**Interfaces:**

- Consumes: `verifyIntuitSignature`, `parseWebhookPayload`, `refreshInvoice`, `refreshInvoicesForPayment`, `startRun`, `finishRun`.
- Produces: `changedIdsFromCdc(json: unknown): { invoiceIds: string[]; paymentIds: string[] }`; `processChanges(service, changes: ChangedEntity[]): Promise<number>`.

- [ ] **Step 1: Write the failing test** (`__tests__/qbo/cdc.test.ts`):

```ts
import { describe, expect, it } from 'vitest';

import { changedIdsFromCdc } from '@/lib/qbo/cdc';

describe('changedIdsFromCdc', () => {
  it('collects invoice and payment ids, deleted ones included', () => {
    expect(
      changedIdsFromCdc({
        CDCResponse: [
          {
            QueryResponse: [
              { Invoice: [{ Id: '130' }, { Id: '131', status: 'Deleted' }] },
              { Payment: [{ Id: '201' }] },
            ],
          },
        ],
      })
    ).toEqual({ invoiceIds: ['130', '131'], paymentIds: ['201'] });
  });

  it('handles an empty response', () => {
    expect(changedIdsFromCdc({})).toEqual({ invoiceIds: [], paymentIds: [] });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --pool=threads __tests__/qbo/cdc.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/qbo/cdc.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

import type { ChangedEntity } from '@/lib/qbo/webhook';

export function changedIdsFromCdc(json: unknown): {
  invoiceIds: string[];
  paymentIds: string[];
} {
  const invoiceIds: string[] = [];
  const paymentIds: string[] = [];
  const responses =
    (
      json as {
        CDCResponse?: Array<{ QueryResponse?: Array<Record<string, unknown>> }>;
      }
    )?.CDCResponse ?? [];
  for (const r of responses) {
    for (const qr of r.QueryResponse ?? []) {
      for (const inv of (qr.Invoice as Array<{ Id: string }> | undefined) ?? [])
        invoiceIds.push(inv.Id);
      for (const p of (qr.Payment as Array<{ Id: string }> | undefined) ?? [])
        paymentIds.push(p.Id);
    }
  }
  return { invoiceIds, paymentIds };
}

/** Refresh every invoice the changes touch. Returns how many known invoices were refreshed. */
export async function processChanges(
  service: SupabaseClient,
  changes: ChangedEntity[]
): Promise<number> {
  // Imported here, not at the top, so the pure `changedIdsFromCdc` test does
  // not pull in server-only modules.
  const { refreshInvoice, refreshInvoicesForPayment } =
    await import('@/lib/qbo/sync');
  const invoiceIds = new Set(
    changes.filter((c) => c.entity === 'Invoice').map((c) => c.id)
  );
  const paymentIds = new Set(
    changes.filter((c) => c.entity === 'Payment').map((c) => c.id)
  );
  let n = 0;
  for (const id of invoiceIds)
    if ((await refreshInvoice(service, id)).known) n++;
  for (const id of paymentIds)
    n += await refreshInvoicesForPayment(service, id);
  return n;
}
```

- [ ] **Step 4: Webhook route**

```ts
import { NextResponse } from 'next/server';

import { qboErrorMessage } from '@/lib/qbo/client';
import { processChanges } from '@/lib/qbo/cdc';
import { qboEnv } from '@/lib/qbo/env';
import { finishRun, startRun } from '@/lib/qbo/runs';
import { parseWebhookPayload, verifyIntuitSignature } from '@/lib/qbo/webhook';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/quickbooks/webhook — QuickBooks tells us an invoice or payment
// changed. Signed by Intuit (verifier token); unsigned calls are refused.
// The hourly check (/api/quickbooks/cdc) catches anything missed here.
export async function POST(request: Request) {
  const verifier = qboEnv()?.webhookVerifier;
  const raw = await request.text();
  if (
    !verifier ||
    !verifyIntuitSignature(
      raw,
      request.headers.get('intuit-signature'),
      verifier
    )
  ) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true });
  }
  const changes = parseWebhookPayload(json);
  if (changes.length === 0) return NextResponse.json({ ok: true });

  const service = createServiceClient();
  const runId = await startRun(service, 'webhook');
  try {
    const n = await processChanges(service, changes);
    await finishRun(service, runId, { invoicesUpdated: n, error: null });
  } catch (e) {
    console.error('[qbo webhook]', e);
    await finishRun(service, runId, {
      invoicesUpdated: 0,
      error: qboErrorMessage(e),
    });
  }
  // Always 200 once verified: a failure is recorded and the hourly check retries.
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Hourly check route**

```ts
import { NextResponse, type NextRequest } from 'next/server';

import {
  QboNotConnectedError,
  qboErrorMessage,
  qboRequest,
} from '@/lib/qbo/client';
import { changedIdsFromCdc, processChanges } from '@/lib/qbo/cdc';
import { finishRun, startRun } from '@/lib/qbo/runs';
import { createServiceClient } from '@/lib/supabase/service';

// GET /api/quickbooks/cdc — Vercel Cron, hourly. Asks QuickBooks what changed
// since the last check (Change Data Capture) and refreshes those invoices.
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const service = createServiceClient();
  const { data: conn } = await service
    .from('qbo_connection')
    .select('last_cdc_at')
    .eq('id', 1)
    .maybeSingle();
  if (!conn) return NextResponse.json({ ok: true, skipped: 'not connected' });

  const startedAt = new Date();
  // QuickBooks only looks back 30 days; overlap the last check by 5 minutes.
  const floor = Date.now() - 29 * 24 * 3600 * 1000;
  const sinceMs = Math.max(
    floor,
    (conn.last_cdc_at
      ? Date.parse(conn.last_cdc_at)
      : Date.now() - 3600 * 1000) -
      5 * 60 * 1000
  );
  const runId = await startRun(service, 'hourly');
  try {
    const json = await qboRequest<unknown>(
      service,
      'GET',
      `/cdc?entities=Invoice,Payment&changedSince=${encodeURIComponent(new Date(sinceMs).toISOString())}`
    );
    const { invoiceIds, paymentIds } = changedIdsFromCdc(json);
    const n = await processChanges(service, [
      ...invoiceIds.map((id) => ({
        entity: 'Invoice' as const,
        id,
        operation: 'cdc',
      })),
      ...paymentIds.map((id) => ({
        entity: 'Payment' as const,
        id,
        operation: 'cdc',
      })),
    ]);
    await service
      .from('qbo_connection')
      .update({ last_cdc_at: startedAt.toISOString() })
      .eq('id', 1);
    await finishRun(service, runId, { invoicesUpdated: n, error: null });
    return NextResponse.json({ ok: true, invoicesUpdated: n });
  } catch (e) {
    const message =
      e instanceof QboNotConnectedError ? 'not connected' : qboErrorMessage(e);
    await finishRun(service, runId, { invoicesUpdated: 0, error: message });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
```

- [ ] **Step 6: Add the cron** — in `vercel.json` `crons`, append:

```json
{
  "path": "/api/quickbooks/cdc",
  "schedule": "0 * * * *"
}
```

- [ ] **Step 7: Run tests, type-check, commit**

Run: `npx vitest run --pool=threads __tests__/qbo && npx tsc --noEmit`
Expected: PASS, clean.

```bash
git add lib/qbo/cdc.ts app/api/quickbooks/webhook/route.ts app/api/quickbooks/cdc/route.ts vercel.json __tests__/qbo/cdc.test.ts && git commit -m "feat(qbo): QuickBooks webhook and hourly change check"
```

**Phase 2 gate:** tests + `tsc` + lint clean → reviewer pass: QuickBooks-first ordering in the stage invoice route, no token ever returned in a response, every route role-checked, Review Focus items 1, 2 and 4 covered.

---

## Phase 3 — Screens

Gate: `tsc` + lint + the full `__tests__/ui` suite clean; dev server restarted; the screens checked by hand on the local stack (Phase 4 covers the walk-through) → reviewer pass against `docs/context/09-design-system.md` §9.3/§9.4 and KD #227.

Design notes (from the frontend-design pass; follow exactly):

- The tile stays as it is. QuickBooks adds ONE quiet block under the extras chips, separated by a hairline: number (link) · total · balance state · synced time. No new card, no gradient.
- Balance state uses the §9.3 badge recipes: mint "Paid in full", amber "Balance S$1,200.00" (`border-brand-amber/40 bg-brand-amber/10 text-ink`), destructive "Voided". Money is `tabular-nums`.
- The start-date note is an inline amber line, not a §9.4 panel — it is advisory, on a small tile.
- Tile buttons are `size="sm"`: one default (the primary for that tile), one `outline`. One primary per tile, never two.
- Sheets copy `components/sis/admission-option-sheet.tsx` exactly: mono eyebrow, serif 22px title, pinned footer.

### Task 3.1: Page data — `loadStageInvoices`

**Files:**

- Create: `lib/qbo/stage-invoices.ts`
- Modify: `app/(admissions)/admissions/applications/[enroleeNumber]/page.tsx` (load + pass props)
- Modify: `components/sis/enrollment-tab.tsx` (accept + forward props)

**Interfaces:**

- Produces:
  - `type StageInvoiceView = { qboInvoiceId: string; docNumber: string | null; total: number; balance: number; state: 'open' | 'paid' | 'voided'; paymentDate: string | null; syncedAt: string; qbUrl: string }`
  - `type QboStageData = { connected: boolean; registration: StageInvoiceView | null; fees: StageInvoiceView | null }`
  - `loadStageInvoices(ayCode: string, enroleeNumber: string): Promise<QboStageData>`
  - `EnrollmentTab` new props: `qbo?: QboStageData | null; canInvoice?: boolean`
  - `StageStatusTile` new props: `qbo?: QboStageData | null; canInvoice?: boolean`

- [ ] **Step 1: Implement the loader**

```ts
import 'server-only';

import { qboEnv, qboInvoiceUrl } from '@/lib/qbo/env';
import { createServiceClient } from '@/lib/supabase/service';

export type StageInvoiceView = {
  qboInvoiceId: string;
  docNumber: string | null;
  total: number;
  balance: number;
  state: 'open' | 'paid' | 'voided';
  paymentDate: string | null;
  syncedAt: string;
  qbUrl: string;
};

export type QboStageData = {
  connected: boolean;
  registration: StageInvoiceView | null;
  fees: StageInvoiceView | null;
};

/** The current QuickBooks invoice on each of this enrolee's two money stages. */
export async function loadStageInvoices(
  ayCode: string,
  enroleeNumber: string
): Promise<QboStageData> {
  const empty: QboStageData = {
    connected: false,
    registration: null,
    fees: null,
  };
  if (!qboEnv()) return empty;
  const service = createServiceClient();
  const [conn, rows] = await Promise.all([
    service
      .from('qbo_connection')
      .select('environment')
      .eq('id', 1)
      .maybeSingle(),
    service
      .from('qbo_invoices')
      .select(
        'stage_key, qbo_invoice_id, doc_number, total, balance, state, payment_date, synced_at'
      )
      .eq('ay_code', ayCode)
      .eq('enrolee_number', enroleeNumber)
      .eq('is_current', true),
  ]);
  const environment =
    (conn.data?.environment as 'sandbox' | 'production' | undefined) ?? null;
  const out: QboStageData = {
    connected: !!environment,
    registration: null,
    fees: null,
  };
  for (const r of rows.data ?? []) {
    const view: StageInvoiceView = {
      qboInvoiceId: r.qbo_invoice_id,
      docNumber: r.doc_number,
      total: Number(r.total),
      balance: Number(r.balance),
      state: r.state,
      paymentDate: r.payment_date,
      syncedAt: r.synced_at,
      qbUrl: qboInvoiceUrl(environment ?? 'sandbox', r.qbo_invoice_id),
    };
    if (r.stage_key === 'registration') out.registration = view;
    if (r.stage_key === 'fees') out.fees = view;
  }
  return out;
}
```

- [ ] **Step 2: Wire the page** — in `app/(admissions)/admissions/applications/[enroleeNumber]/page.tsx`:
  - import `loadStageInvoices` from `@/lib/qbo/stage-invoices` and `canInvoiceInQbo` from `@/lib/qbo/roles`;
  - add `loadStageInvoices(selectedAy, application.enroleeNumber)` to the existing `Promise.all` that runs once `application` is known (the block at ~line 225), binding it as `qboStage`;
  - pass `qbo={qboStage}` and `canInvoice={canInvoiceInQbo(sessionUser.role)}` to `<EnrollmentTab>`.

- [ ] **Step 3: Forward props in `components/sis/enrollment-tab.tsx`**
  - `Props`: add
    ```ts
    /** QuickBooks invoice on the Registration and Fees stages (migration 188). */
    qbo?: QboStageData | null;
    /** admissions / school_admin / superadmin — see lib/qbo/roles.ts. */
    canInvoice?: boolean;
    ```
  - destructure `qbo = null, canInvoice = false` in `EnrollmentTab`, and pass `qbo={qbo}` `canInvoice={canInvoice}` to every `<StageStatusTile>` (line ~1146).
  - `StageStatusTile` props: add the same two. (Task 3.2 renders them.)
  - `import type { QboStageData } from '@/lib/qbo/stage-invoices';` — a type-only import is fine in this server component.

- [ ] **Step 4: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add lib/qbo/stage-invoices.ts "app/(admissions)/admissions/applications/[enroleeNumber]/page.tsx" components/sis/enrollment-tab.tsx && git commit -m "feat(qbo): load each stage's QuickBooks invoice for the Enrollment tab"
```

### Task 3.2: The tile block — `QboInvoiceStrip`

**Files:**

- Create: `components/sis/qbo-invoice-strip.tsx`, `lib/qbo/format.ts`
- Modify: `components/sis/enrollment-tab.tsx` (render the strip in `StageStatusTile`)
- Test: `__tests__/qbo/format.test.ts`

**Interfaces:**

- Consumes: `StageInvoiceView`, `QboStageData`, `needsStartDate`, `StageSnapshot`.
- Produces: `formatSgd(n: number): string`, `formatSyncedAt(iso: string, now?: Date): string`; `<QboInvoiceStrip ayCode enroleeNumber stage stageSnapshot invoice connected canInvoice />`.

- [ ] **Step 1: Failing test** (`__tests__/qbo/format.test.ts`):

```ts
import { describe, expect, it } from 'vitest';

import { formatSgd, formatSyncedAt } from '@/lib/qbo/format';

describe('QuickBooks formatting', () => {
  it('money as S$ with two decimals', () => {
    expect(formatSgd(3200)).toBe('S$3,200.00');
    expect(formatSgd(0)).toBe('S$0.00');
  });
  it('synced time: clock today, date otherwise', () => {
    const now = new Date('2026-10-14T12:00:00+08:00');
    expect(formatSyncedAt('2026-10-14T10:42:00+08:00', now)).toBe(
      'Synced 10:42'
    );
    expect(formatSyncedAt('2026-10-12T10:42:00+08:00', now)).toBe(
      'Synced 12 Oct'
    );
  });
});
```

Run: `npx vitest run --pool=threads __tests__/qbo/format.test.ts` → FAIL (module not found).

- [ ] **Step 2: Implement `lib/qbo/format.ts`**

```ts
export function formatSgd(n: number): string {
  return `S$${n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatSyncedAt(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const sg = (x: Date) =>
    x.toLocaleDateString('en-SG', { timeZone: 'Asia/Singapore' });
  if (sg(d) === sg(now)) {
    return `Synced ${d.toLocaleTimeString('en-SG', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', hour12: false })}`;
  }
  return `Synced ${d.toLocaleDateString('en-SG', { timeZone: 'Asia/Singapore', day: 'numeric', month: 'short' })}`;
}
```

Run the test → PASS.

- [ ] **Step 3: Implement `components/sis/qbo-invoice-strip.tsx`**

```tsx
'use client';

import { useMutation } from '@tanstack/react-query';
import { ExternalLink, FilePlus2, Link2, RefreshCw } from 'lucide-react';
import { useState } from 'react';

import {
  CreateInvoiceSheet,
  LinkInvoiceSheet,
} from '@/components/sis/qbo-invoice-sheets';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { formatSgd, formatSyncedAt } from '@/lib/qbo/format';
import type { StageInvoiceView } from '@/lib/qbo/stage-invoices';
import {
  needsStartDate,
  type QboStageKey,
  type StageSnapshot,
} from '@/lib/qbo/stage-state';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// The QuickBooks block on the Registration and Fees tiles. One quiet line of
// facts, then the tile's two actions. Spec "Screens" — the Edit stage pencil
// above stays exactly as it is.
export function QboInvoiceStrip({
  ayCode,
  enroleeNumber,
  stage,
  stageSnapshot,
  invoice,
  connected,
  canInvoice,
}: {
  ayCode: string;
  enroleeNumber: string;
  stage: QboStageKey;
  stageSnapshot: StageSnapshot;
  invoice: StageInvoiceView | null;
  connected: boolean;
  canInvoice: boolean;
}) {
  const [sheet, setSheet] = useState<'create' | 'link' | null>(null);
  const [sheetKey, setSheetKey] = useState(0);
  const run = useWriteAction();
  const refresh = useMutation({
    mutationFn: () =>
      apiFetch<{ stageWarning: string | null }>(
        `/api/sis/students/${encodeURIComponent(enroleeNumber)}/stage/${stage}/invoice/refresh`,
        jsonInit('POST', { ayCode })
      ),
  });

  if (!connected) {
    return (
      <p className="ml-1 border-t border-hairline pt-2.5 text-[11px] text-muted-foreground">
        QuickBooks not connected
      </p>
    );
  }

  const open = (which: 'create' | 'link') => {
    setSheetKey((k) => k + 1);
    setSheet(which);
  };
  const startDateMissing = needsStartDate(
    stage,
    stageSnapshot,
    invoice?.state ?? null
  );

  return (
    <div className="ml-1 space-y-2.5 border-t border-hairline pt-2.5">
      {invoice && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-foreground">
          <a
            href={invoice.qbUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono font-semibold tabular-nums text-brand-indigo underline-offset-2 hover:underline"
          >
            {invoice.docNumber ?? 'Invoice'}
            <ExternalLink className="size-3" aria-hidden="true" />
            <span className="sr-only">(opens in QuickBooks)</span>
          </a>
          <span className="tabular-nums">{formatSgd(invoice.total)}</span>
          {invoice.state === 'paid' ? (
            <Badge
              variant="outline"
              className="h-5 border-brand-mint bg-brand-mint/30 text-ink"
            >
              Paid in full
            </Badge>
          ) : invoice.state === 'voided' ? (
            <Badge
              variant="outline"
              className="h-5 border-destructive/40 bg-destructive/10 text-destructive"
            >
              Voided
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="h-5 border-brand-amber/40 bg-brand-amber/10 tabular-nums text-ink"
            >
              Balance {formatSgd(invoice.balance)}
            </Badge>
          )}
          <span className="text-muted-foreground">
            {formatSyncedAt(invoice.syncedAt)}
          </span>
        </div>
      )}

      {startDateMissing && (
        <p className="rounded-md border border-brand-amber/40 bg-brand-amber/10 px-2 py-1.5 text-[11px] text-ink">
          Paid in QuickBooks. Add the start date with the pencil above to mark
          Fees as Paid.
        </p>
      )}

      {canInvoice && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => open('create')}>
            <FilePlus2 className="size-3.5" />
            {invoice ? 'New invoice' : 'Create invoice'}
          </Button>
          {invoice ? (
            <Button
              size="sm"
              variant="outline"
              loading={refresh.isPending}
              loadingText="Refreshing…"
              onClick={() =>
                run(() => refresh.mutateAsync(), {
                  pending: false,
                  success: (d) =>
                    d.stageWarning ?? 'Up to date with QuickBooks',
                })
              }
            >
              <RefreshCw className="size-3.5" />
              Refresh from QuickBooks
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => open('link')}>
              <Link2 className="size-3.5" />
              Link QB invoice
            </Button>
          )}
        </div>
      )}

      {sheet === 'create' && (
        <CreateInvoiceSheet
          key={`c${sheetKey}`}
          open
          onOpenChange={(o) => !o && setSheet(null)}
          ayCode={ayCode}
          enroleeNumber={enroleeNumber}
          stage={stage}
        />
      )}
      {sheet === 'link' && (
        <LinkInvoiceSheet
          key={`l${sheetKey}`}
          open
          onOpenChange={(o) => !o && setSheet(null)}
          ayCode={ayCode}
          enroleeNumber={enroleeNumber}
          stage={stage}
        />
      )}
    </div>
  );
}
```

Spec note: the spec put an "add start date" button on the tile. `EditStageDialog` owns its own open state and sits in the tile's header, so the note points at that pencil instead of adding a second way in. If the reviewer wants the button, add optional `open` / `onOpenChange` props to `EditStageDialog` rather than duplicating it.

If `useWriteAction`'s `success` callback must return a `ToastMessage` object rather than a string, follow the shape used in `components/sis/admission-option-sheet.tsx` (strings are accepted there).

- [ ] **Step 4: Render it in `StageStatusTile`** — in `components/sis/enrollment-tab.tsx`, after the `<RichText ... />` remarks block (line ~1272) add:

```tsx
{
  (stage.key === 'registration' || stage.key === 'fees') && qbo && (
    <QboInvoiceStrip
      ayCode={ayCode}
      enroleeNumber={enroleeNumber}
      stage={stage.key}
      stageSnapshot={{
        status: stage.status,
        invoice: stage.extrasInitial.invoice ?? null,
        paymentDate: stage.extrasInitial.paymentDate ?? null,
        startDate: stage.extrasInitial.startDate ?? null,
      }}
      invoice={qbo[stage.key]}
      connected={qbo.connected}
      canInvoice={canInvoice}
    />
  );
}
```

and import `QboInvoiceStrip` from `@/components/sis/qbo-invoice-strip`. (`extrasInitial` values are `string | null`; cast with `as string | null` only if `tsc` asks.)

- [ ] **Step 5: Commit** (after Task 3.3 makes the sheets exist — run `tsc` then):

```bash
git add lib/qbo/format.ts __tests__/qbo/format.test.ts components/sis/qbo-invoice-strip.tsx components/sis/enrollment-tab.tsx && git commit -m "feat(qbo): QuickBooks block on the Registration and Fees tiles"
```

### Task 3.3: The two drawers — `qbo-invoice-sheets.tsx`

**Files:**

- Create: `components/sis/qbo-invoice-sheets.tsx`

**Interfaces:**

- Consumes the Task 2.4 JSON contracts verbatim.
- Produces `CreateInvoiceSheet` and `LinkInvoiceSheet`, both `{ open: boolean; onOpenChange: (o: boolean) => void; ayCode: string; enroleeNumber: string; stage: QboStageKey }`.

- [ ] **Step 1: Implement**

```tsx
'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { formatSgd } from '@/lib/qbo/format';
import type { QboStageKey } from '@/lib/qbo/stage-state';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// The Create invoice and Link QB invoice drawers (spec "Screens"). Both start
// with the same customer step; QuickBooks is asked first and nothing is saved
// in the SIS unless it accepts. Pattern: components/sis/admission-option-sheet.tsx
// (pinned footer, KD #227).

type QbCustomer = { id: string; displayName: string };
type CustomersResponse = {
  linked: QbCustomer | null;
  exact: QbCustomer[];
  similar: QbCustomer[];
};
type Item = {
  id: string;
  name: string;
  description: string | null;
  unitPrice: number | null;
};
type OpenInvoice = {
  id: string;
  docNumber: string | null;
  txnDate: string | null;
  total: number;
  balance: number;
};
type SheetProps = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ayCode: string;
  enroleeNumber: string;
  stage: QboStageKey;
};
type SaveResponse = { docNumber: string | null; stageWarning: string | null };

const STAGE_NAME: Record<QboStageKey, string> = {
  registration: 'Registration',
  fees: 'Fees',
};
const todayIso = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });

/** Which QuickBooks customer — the remembered one, the single exact match, or the person's pick. */
function useCustomerChoice(ayCode: string, enroleeNumber: string) {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<QbCustomer | null>(null);
  const query = useQuery({
    queryKey: ['qbo-customers', ayCode, enroleeNumber, search],
    queryFn: () =>
      apiFetch<CustomersResponse>(
        `/api/quickbooks/customers?ay=${encodeURIComponent(ayCode)}&enrolee=${encodeURIComponent(enroleeNumber)}${search ? `&q=${encodeURIComponent(search)}` : ''}`
      ),
  });
  const data = query.data;
  const auto =
    data?.linked ??
    (data && !search && data.exact.length === 1 ? data.exact[0] : null);
  const customer = picked ?? auto;
  const matchedBy: 'auto' | 'staff' = picked ? 'staff' : 'auto';
  const choices = data ? [...data.exact, ...data.similar] : [];
  return {
    query,
    customer,
    matchedBy,
    choices,
    setPicked,
    search,
    setSearch,
    remembered: !!data?.linked && !picked,
  };
}

function CustomerField({ c }: { c: ReturnType<typeof useCustomerChoice> }) {
  const [typed, setTyped] = useState('');
  if (c.query.isLoading) {
    return (
      <p className="text-sm text-muted-foreground">
        Looking up the QuickBooks customer…
      </p>
    );
  }
  if (c.query.isError) {
    return <FieldError>{(c.query.error as Error).message}</FieldError>;
  }
  return (
    <Field>
      <FieldLabel>QuickBooks customer</FieldLabel>
      {c.customer && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
          <span className="text-sm font-medium text-foreground">
            {c.customer.displayName}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => c.setPicked(null)}
          >
            Change
          </Button>
        </div>
      )}
      {c.customer ? (
        <FieldDescription>
          {c.remembered
            ? 'Remembered from an earlier invoice.'
            : c.matchedBy === 'auto'
              ? 'Matched by the student’s full name.'
              : 'Picked by you. The SIS will remember it for this student.'}
        </FieldDescription>
      ) : (
        <>
          <FieldDescription>
            No customer has exactly this student’s name. Pick the right one, or
            search.
          </FieldDescription>
          <div className="flex gap-2">
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Search QuickBooks customers"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  c.setSearch(typed.trim());
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => c.setSearch(typed.trim())}
            >
              Search
            </Button>
          </div>
          {c.choices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No customers found.</p>
          ) : (
            <RadioGroup
              value=""
              onValueChange={(id) =>
                c.setPicked(c.choices.find((x) => x.id === id) ?? null)
              }
              className="max-h-56 gap-1.5 overflow-y-auto"
            >
              {c.choices.map((x) => (
                <label
                  key={x.id}
                  className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground has-[[data-state=checked]]:border-brand-indigo has-[[data-state=checked]]:bg-brand-indigo/5"
                >
                  <RadioGroupItem value={x.id} />
                  {x.displayName}
                </label>
              ))}
            </RadioGroup>
          )}
        </>
      )}
    </Field>
  );
}

function SheetFrame({
  open,
  onOpenChange,
  stage,
  title,
  description,
  onSubmit,
  saving,
  submitLabel,
  submitDisabled,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  stage: QboStageKey;
  title: string;
  description: string;
  onSubmit: (e: React.FormEvent) => void;
  saving: boolean;
  submitLabel: string;
  submitDisabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
      >
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader className="shrink-0 gap-1.5 border-b border-border p-5">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              QuickBooks · {STAGE_NAME[stage]}
            </p>
            <SheetTitle className="font-serif text-[22px] leading-tight tracking-tight">
              {title}
            </SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <FieldGroup>{children}</FieldGroup>
          </div>
          <SheetFooter className="shrink-0 gap-2 border-t border-border bg-background p-5">
            <SheetClose asChild>
              <Button type="button" variant="outline" disabled={saving}>
                Cancel
              </Button>
            </SheetClose>
            <Button
              type="submit"
              loading={saving}
              loadingText="Saving in QuickBooks…"
              disabled={submitDisabled}
            >
              {submitLabel}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

type Line = {
  key: number;
  itemId: string;
  description: string;
  qty: string;
  unitPrice: string;
};

export function CreateInvoiceSheet({
  open,
  onOpenChange,
  ayCode,
  enroleeNumber,
  stage,
}: SheetProps) {
  const c = useCustomerChoice(ayCode, enroleeNumber);
  const items = useQuery({
    queryKey: ['qbo-items'],
    queryFn: () => apiFetch<{ items: Item[] }>('/api/quickbooks/items'),
    staleTime: 5 * 60 * 1000,
  });
  const [lines, setLines] = useState<Line[]>([
    { key: 1, itemId: '', description: '', qty: '1', unitPrice: '' },
  ]);
  const [txnDate, setTxnDate] = useState(todayIso);
  const [dueDate, setDueDate] = useState('');
  const [memo, setMemo] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const run = useWriteAction();

  const parsed = lines.map((l) => ({
    ...l,
    q: Number(l.qty),
    p: Number(l.unitPrice),
  }));
  const linesValid = parsed.every(
    (l) => l.itemId && l.q > 0 && l.unitPrice !== '' && l.p >= 0
  );
  const total = parsed.reduce(
    (s, l) => s + (l.q > 0 && l.p >= 0 ? Math.round(l.q * l.p * 100) / 100 : 0),
    0
  );
  const valid =
    !!c.customer && linesValid && /^\d{4}-\d{2}-\d{2}$/.test(txnDate);

  const save = useMutation({
    mutationFn: () =>
      apiFetch<SaveResponse>(
        `/api/sis/students/${encodeURIComponent(enroleeNumber)}/stage/${stage}/invoice`,
        jsonInit('POST', {
          mode: 'create',
          ayCode,
          customerId: c.customer!.id,
          customerName: c.customer!.displayName,
          matchedBy: c.matchedBy,
          lines: parsed.map((l) => ({
            itemId: l.itemId,
            ...(l.description.trim()
              ? { description: l.description.trim() }
              : {}),
            qty: l.q,
            unitPrice: l.p,
          })),
          txnDate,
          dueDate: dueDate || null,
          ...(memo.trim() ? { memo: memo.trim() } : {}),
        })
      ),
  });

  const setLine = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    await run(() => save.mutateAsync(), {
      pending: 'Creating the invoice in QuickBooks…',
      success: (d) =>
        d.stageWarning ??
        (d.docNumber
          ? `Invoice ${d.docNumber} created in QuickBooks`
          : 'Invoice created in QuickBooks'),
      onResolved: () => onOpenChange(false),
    });
    setSaving(false);
  }

  return (
    <SheetFrame
      open={open}
      onOpenChange={onOpenChange}
      stage={stage}
      title="Create invoice"
      description="QuickBooks numbers it and the stage updates by itself. Payments recorded in QuickBooks come back here."
      onSubmit={submit}
      saving={saving}
      submitLabel="Create in QuickBooks"
      submitDisabled={saving}
    >
      <CustomerField c={c} />
      {showErrors && !c.customer && (
        <FieldError>Choose the QuickBooks customer.</FieldError>
      )}

      <Field>
        <FieldLabel>Lines</FieldLabel>
        {items.isError && (
          <FieldError>{(items.error as Error).message}</FieldError>
        )}
        <div className="space-y-3">
          {lines.map((l) => (
            <div
              key={l.key}
              className="space-y-2 rounded-md border border-border p-3"
            >
              <div className="flex items-start gap-2">
                <Select
                  value={l.itemId}
                  onValueChange={(id) => {
                    const it = items.data?.items.find((x) => x.id === id);
                    setLine(l.key, {
                      itemId: id,
                      unitPrice:
                        it?.unitPrice != null
                          ? String(it.unitPrice)
                          : l.unitPrice,
                      description: l.description || it?.description || '',
                    });
                  }}
                >
                  <SelectTrigger className="w-full" aria-label="Item">
                    <SelectValue
                      placeholder={
                        items.isLoading ? 'Loading items…' : 'Choose an item'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(items.data?.items ?? []).map((it) => (
                      <SelectItem key={it.id} value={it.id}>
                        {it.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {lines.length > 1 && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Remove line"
                    onClick={() =>
                      setLines((ls) => ls.filter((x) => x.key !== l.key))
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
              <Input
                value={l.description}
                onChange={(e) =>
                  setLine(l.key, { description: e.target.value })
                }
                placeholder="Description (optional)"
                aria-label="Description"
              />
              <div className="grid grid-cols-[5rem_1fr_auto] items-center gap-2">
                <Input
                  inputMode="decimal"
                  value={l.qty}
                  onChange={(e) => setLine(l.key, { qty: e.target.value })}
                  aria-label="Quantity"
                  className="tabular-nums"
                />
                <Input
                  inputMode="decimal"
                  value={l.unitPrice}
                  onChange={(e) =>
                    setLine(l.key, { unitPrice: e.target.value })
                  }
                  placeholder="Price"
                  aria-label="Price"
                  className="tabular-nums"
                />
                <span className="min-w-24 text-right text-sm tabular-nums text-foreground">
                  {Number(l.qty) > 0 &&
                  Number(l.unitPrice) >= 0 &&
                  l.unitPrice !== ''
                    ? formatSgd(
                        Math.round(Number(l.qty) * Number(l.unitPrice) * 100) /
                          100
                      )
                    : '—'}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between pt-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              setLines((ls) => [
                ...ls,
                {
                  key: Math.max(...ls.map((x) => x.key)) + 1,
                  itemId: '',
                  description: '',
                  qty: '1',
                  unitPrice: '',
                },
              ])
            }
          >
            <Plus className="size-3.5" />
            Add line
          </Button>
          <p className="text-sm text-foreground">
            Total{' '}
            <span className="font-semibold tabular-nums">
              {formatSgd(total)}
            </span>
          </p>
        </div>
        {showErrors && !linesValid && (
          <FieldError>
            Each line needs an item, a quantity above 0 and a price.
          </FieldError>
        )}
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="qbo-txn-date">Invoice date</FieldLabel>
          <Input
            id="qbo-txn-date"
            type="date"
            value={txnDate}
            onChange={(e) => setTxnDate(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="qbo-due-date">Due date</FieldLabel>
          <Input
            id="qbo-due-date"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
          <FieldDescription>
            Leave blank to use QuickBooks’ usual terms.
          </FieldDescription>
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="qbo-memo">Message to the parent</FieldLabel>
        <Textarea
          id="qbo-memo"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          rows={3}
        />
        <FieldDescription>Shown on the invoice.</FieldDescription>
      </Field>
    </SheetFrame>
  );
}

export function LinkInvoiceSheet({
  open,
  onOpenChange,
  ayCode,
  enroleeNumber,
  stage,
}: SheetProps) {
  const c = useCustomerChoice(ayCode, enroleeNumber);
  const [invoiceId, setInvoiceId] = useState('');
  const [saving, setSaving] = useState(false);
  const run = useWriteAction();
  const invoices = useQuery({
    queryKey: ['qbo-open-invoices', c.customer?.id],
    enabled: !!c.customer,
    queryFn: () =>
      apiFetch<{ invoices: OpenInvoice[] }>(
        `/api/quickbooks/customers/${encodeURIComponent(c.customer!.id)}/invoices`
      ),
  });
  const save = useMutation({
    mutationFn: () =>
      apiFetch<SaveResponse>(
        `/api/sis/students/${encodeURIComponent(enroleeNumber)}/stage/${stage}/invoice`,
        jsonInit('POST', {
          mode: 'link',
          ayCode,
          customerId: c.customer!.id,
          customerName: c.customer!.displayName,
          matchedBy: c.matchedBy,
          qboInvoiceId: invoiceId,
        })
      ),
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!c.customer || !invoiceId) return;
    setSaving(true);
    await run(() => save.mutateAsync(), {
      pending: 'Linking the invoice…',
      success: (d) =>
        d.stageWarning ??
        (d.docNumber ? `Invoice ${d.docNumber} linked` : 'Invoice linked'),
      onResolved: () => onOpenChange(false),
    });
    setSaving(false);
  }

  const list = invoices.data?.invoices ?? [];
  return (
    <SheetFrame
      open={open}
      onOpenChange={onOpenChange}
      stage={stage}
      title="Link QB invoice"
      description="For an invoice already made in QuickBooks. The stage takes its number and follows its payments from now on."
      onSubmit={submit}
      saving={saving}
      submitLabel="Link invoice"
      submitDisabled={saving || !c.customer || !invoiceId}
    >
      <CustomerField c={c} />
      {c.customer && (
        <Field>
          <FieldLabel>Open invoices</FieldLabel>
          {invoices.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading invoices…</p>
          ) : invoices.isError ? (
            <FieldError>{(invoices.error as Error).message}</FieldError>
          ) : list.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This customer has no open invoices that aren’t already linked. Use
              Create invoice instead.
            </p>
          ) : (
            <RadioGroup
              value={invoiceId}
              onValueChange={setInvoiceId}
              className="gap-1.5"
            >
              {list.map((inv) => (
                <label
                  key={inv.id}
                  className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-md border border-border px-3 py-2.5 text-sm text-foreground has-[[data-state=checked]]:border-brand-indigo has-[[data-state=checked]]:bg-brand-indigo/5"
                >
                  <RadioGroupItem value={inv.id} />
                  <span>
                    <span className="font-mono font-semibold tabular-nums">
                      {inv.docNumber ?? inv.id}
                    </span>
                    {inv.txnDate && (
                      <span className="ml-2 text-muted-foreground">
                        {new Date(inv.txnDate).toLocaleDateString('en-SG', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                    )}
                  </span>
                  <span className="text-right tabular-nums">
                    {formatSgd(inv.total)}
                    <span className="block text-[11px] text-muted-foreground">
                      Balance {formatSgd(inv.balance)}
                    </span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          )}
        </Field>
      )}
    </SheetFrame>
  );
}
```

If `components/ui/textarea.tsx` does not exist, install it (`npx shadcn@latest add textarea`) — do not substitute an `Input`.

- [ ] **Step 2: Type-check, lint, run UI tests**

Run: `npx tsc --noEmit && npm run lint && npx vitest run --pool=threads __tests__/ui __tests__/qbo`
Expected: clean / PASS.

- [ ] **Step 3: Commit** (together with Task 3.2's files if not yet committed)

```bash
git add components/sis/qbo-invoice-sheets.tsx && git commit -m "feat(qbo): Create invoice and Link QB invoice drawers"
```

### Task 3.4: SIS Admin → QuickBooks page

**Files:**

- Create: `app/(sis)/sis/admin/quickbooks/page.tsx`, `components/sis/qbo-connection-actions.tsx`, `lib/qbo/status.ts`
- Modify: `lib/auth/roles.ts` (nav item next to School Config; `ROUTE_ACCESS` row), `lib/sidebar/registry.ts` (icon)

**Interfaces:**

- Produces `getQboStatus(): Promise<{ configured: boolean; connected: boolean; companyName: string | null; environment: string | null; connectedAt: string | null; connectedByEmail: string | null; lastRun: { source: string; startedAt: string; finishedAt: string | null; invoicesUpdated: number; error: string | null } | null; recentErrors: Array<{ source: string; startedAt: string; error: string }> }>`.

- [ ] **Step 1: `lib/qbo/status.ts`**

```ts
import 'server-only';

import { qboEnv } from '@/lib/qbo/env';
import { createServiceClient } from '@/lib/supabase/service';

export async function getQboStatus() {
  const configured = !!qboEnv();
  const service = createServiceClient();
  const [conn, runs, errors] = await Promise.all([
    service
      .from('qbo_connection')
      .select('company_name, environment, connected_at, connected_by_email')
      .eq('id', 1)
      .maybeSingle(),
    service
      .from('qbo_sync_runs')
      .select('source, started_at, finished_at, invoices_updated, error')
      .order('started_at', { ascending: false })
      .limit(1),
    service
      .from('qbo_sync_runs')
      .select('source, started_at, error')
      .not('error', 'is', null)
      .order('started_at', { ascending: false })
      .limit(5),
  ]);
  const last = runs.data?.[0];
  return {
    configured,
    connected: !!conn.data,
    companyName: conn.data?.company_name ?? null,
    environment: conn.data?.environment ?? null,
    connectedAt: conn.data?.connected_at ?? null,
    connectedByEmail: conn.data?.connected_by_email ?? null,
    lastRun: last
      ? {
          source: last.source as string,
          startedAt: last.started_at as string,
          finishedAt: (last.finished_at as string | null) ?? null,
          invoicesUpdated: Number(last.invoices_updated),
          error: (last.error as string | null) ?? null,
        }
      : null,
    recentErrors: (errors.data ?? []).map((r) => ({
      source: r.source as string,
      startedAt: r.started_at as string,
      error: r.error as string,
    })),
  };
}
```

- [ ] **Step 2: `components/sis/qbo-connection-actions.tsx`**

```tsx
'use client';

import { useMutation } from '@tanstack/react-query';
import { Link2, Unplug } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

export function QboConnectionActions({ connected }: { connected: boolean }) {
  const run = useWriteAction();
  const disconnect = useMutation({
    mutationFn: () => apiFetch('/api/quickbooks/disconnect', jsonInit('POST')),
  });
  if (!connected) {
    return (
      <Button asChild>
        {/* A full navigation: Intuit's approval page is outside the app. */}
        <a href="/api/quickbooks/connect">
          <Link2 className="size-4" />
          Connect QuickBooks
        </a>
      </Button>
    );
  }
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline">
          <Unplug className="size-4" />
          Disconnect
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Disconnect QuickBooks?</AlertDialogTitle>
          <AlertDialogDescription>
            Invoices stop syncing and the invoice buttons disappear until
            someone connects again. Invoices already linked stay linked.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() =>
              run(() => disconnect.mutateAsync(), {
                pending: 'Disconnecting…',
                success: 'QuickBooks disconnected',
              })
            }
          >
            Disconnect
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

(If the repo's destructive confirm uses `buttonVariants({ variant: 'destructive' })` on `AlertDialogAction`, copy that instead of the classes above.)

- [ ] **Step 3: The page**

```tsx
import { AlertTriangle, CheckCircle2, ReceiptText } from 'lucide-react';
import { redirect } from 'next/navigation';

import { QboConnectionActions } from '@/components/sis/qbo-connection-actions';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { getQboStatus } from '@/lib/qbo/status';
import { getSessionUser } from '@/lib/supabase/server';

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-SG', {
        timeZone: 'Asia/Singapore',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '—';
const SOURCE: Record<string, string> = {
  webhook: 'Instant update',
  hourly: 'Hourly check',
  manual: 'Refresh button',
};

// SIS Admin → QuickBooks. Superadmin connects the school's QuickBooks once;
// this page then shows whether it is connected and when it last synced.
export default async function QuickBooksAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (sessionUser.role !== 'superadmin') redirect('/sis');
  const [status, params] = await Promise.all([getQboStatus(), searchParams]);

  return (
    <PageShell>
      <SisPageHeader
        group="Access & system"
        title="QuickBooks."
        description="Connect the school's QuickBooks company so admissions can invoice Registration and Fees from the SIS."
      />

      {params.error && (
        <div className="flex items-start gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground shadow-brand-tile">
            <AlertTriangle className="size-4" />
          </div>
          <div className="flex-1 space-y-1.5">
            <p className="font-serif text-base font-semibold text-foreground">
              QuickBooks wasn&apos;t connected
            </p>
            <p className="text-sm text-muted-foreground">{params.error}</p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Connection
          </CardDescription>
          <CardTitle className="flex flex-wrap items-center gap-2 font-serif text-lg font-semibold tracking-tight text-foreground">
            {status.connected
              ? (status.companyName ?? 'Connected')
              : 'Not connected'}
            {status.connected ? (
              <Badge
                variant="outline"
                className="h-6 border-brand-mint bg-brand-mint/30 text-ink"
              >
                <CheckCircle2 className="h-3 w-3" /> Connected
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="h-6 border-destructive/40 bg-destructive/10 text-destructive"
              >
                Not connected
              </Badge>
            )}
            {status.environment === 'sandbox' && (
              <Badge variant="secondary" className="h-6">
                Test company
              </Badge>
            )}
          </CardTitle>
          <CardAction>
            <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <ReceiptText className="size-5" />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-5">
          {!status.configured ? (
            <p className="text-sm text-muted-foreground">
              The QuickBooks app keys aren&apos;t set on this server yet, so it
              can&apos;t be connected.
            </p>
          ) : (
            <>
              {status.connected && (
                <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-muted-foreground">Connected</dt>
                    <dd className="text-foreground">
                      {when(status.connectedAt)}
                      {status.connectedByEmail
                        ? ` by ${status.connectedByEmail}`
                        : ''}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Last sync</dt>
                    <dd className="text-foreground">
                      {status.lastRun
                        ? `${when(status.lastRun.startedAt)} · ${SOURCE[status.lastRun.source] ?? status.lastRun.source}`
                        : 'Not yet'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Invoices updated</dt>
                    <dd className="tabular-nums text-foreground">
                      {status.lastRun?.invoicesUpdated ?? 0}
                    </dd>
                  </div>
                </dl>
              )}
              <QboConnectionActions connected={status.connected} />
            </>
          )}
        </CardContent>
      </Card>

      {status.recentErrors.length > 0 && (
        <Card>
          <CardHeader>
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              Problems
            </CardDescription>
            <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
              Recent sync problems
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {status.recentErrors.map((e) => (
                <li
                  key={e.startedAt + e.source}
                  className="grid grid-cols-1 gap-1 py-2.5 sm:grid-cols-[10rem_1fr]"
                >
                  <span className="text-muted-foreground">
                    {when(e.startedAt)} · {SOURCE[e.source] ?? e.source}
                  </span>
                  <span className="text-foreground">{e.error}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
```

`CardAction` and `SisPageHeader` are used exactly as in `components/sis/enrollment-tab.tsx` and `app/(sis)/sis/admin/school-config/page.tsx`. The "Connection" / "Problems" mono eyebrows follow the existing card convention (09-design-system), not new chrome.

- [ ] **Step 4: Nav, route access, icon**
  - `lib/auth/roles.ts` — in the SIS nav group holding School Config (~line 808), add after it:
    ```ts
      {
        href: '/sis/admin/quickbooks',
        label: 'QuickBooks',
        requiresRoles: ['superadmin'],
      },
    ```
  - `ROUTE_ACCESS` — next to the `/sis/admin/school-config` row:
    ```ts
      // QuickBooks connection (migration 188) — superadmin connects it once.
      { prefix: '/sis/admin/quickbooks', allowed: ['superadmin'] },
    ```
  - `lib/sidebar/registry.ts` — SIS `iconByHref` (~line 455): `'/sis/admin/quickbooks': ReceiptText,` and import `ReceiptText` from `lucide-react` if not already imported.

- [ ] **Step 5: Type-check, lint, tests, commit**

Run: `npx tsc --noEmit && npm run lint && npx vitest run --pool=threads __tests__/auth __tests__/sidebar __tests__/ui`
Expected: clean / PASS (nav-coverage tests in those folders must include the new href; fix the test fixture lists only if they enumerate hrefs by hand).

```bash
git add "app/(sis)/sis/admin/quickbooks/page.tsx" components/sis/qbo-connection-actions.tsx lib/qbo/status.ts lib/auth/roles.ts lib/sidebar/registry.ts && git commit -m "feat(qbo): SIS Admin QuickBooks page (connect, last sync, problems)"
```

**Phase 3 gate:** `tsc`, lint, `__tests__/ui __tests__/auth __tests__/sidebar __tests__/qbo` clean → reviewer pass against 09-design-system §9.3/§9.4, KD #227 and the spec's Screens section.

---

## Phase 4 — Local end-to-end check and docs

Gate: every step below observed on the local stack against the QuickBooks sandbox; final whole-branch review.

### Task 4.1: Walk-through on the local stack

**Files:** none (manual check). Record results in the final report.

- [ ] **Step 1: Set up**
  - Intuit developer portal → the SIS app → Development → Redirect URIs: add `http://localhost:3000/api/quickbooks/callback`.
  - `.env.development.local`: `QBO_REDIRECT_URI=http://localhost:3000/api/quickbooks/callback`, `QBO_ENVIRONMENT=sandbox`, `CRON_SECRET=local-cron`, `QBO_WEBHOOK_VERIFIER=` (blank is fine locally).
  - Restart `next dev` (new route files don't reliably reach a running server).
- [ ] **Step 2: Connect** — sign in as the local superadmin, open `/sis/admin/quickbooks`, click Connect QuickBooks, approve the sandbox company. Expect: "Connected", company name, an `qbo.connection.connect` row in `/sis/audit-log`.
- [ ] **Step 3: Create** — as local admissions, open AY2027 applicant H250095 (LIM, SOFIA ALCANTARA) → Enrollment tab → Fees tile → Create invoice. Expect: customer matched automatically; pick "Tuition Fee" (price fills); create. Tile shows number, total, amber Balance, "Synced HH:MM"; Fees = Invoiced with the number; audit rows `qbo.invoice.create` + `sis.stage.update`.
- [ ] **Step 4: Payment** — record a part payment in the sandbox UI, click Refresh from QuickBooks: balance changes, status stays Invoiced. Pay the rest, refresh: payment date filled, status still Invoiced, amber "Add the start date" note (start date blank). Add the start date with the pencil → save → Paid.
- [ ] **Step 5: Re-invoice and void** — New invoice on the same Fees tile → Re-invoiced with the new number. Void it in the sandbox, then `curl -H "Authorization: Bearer local-cron" http://localhost:3000/api/quickbooks/cdc` → Fees back to Pending, invoice cleared, `sis.stage.update` row by `system:quickbooks-sync`.
- [ ] **Step 6: Registration + link** — create an invoice in the sandbox UI for another seeded customer (e.g. KAPOOR, LANCE ANDREI DOMINGO), then on that student's Registration tile use Link QB invoice. Expect Unpaid + number; paying it in full + refresh → Finished + payment date.
- [ ] **Step 7: Refusals** — try linking the same invoice from another student (expect the "already linked" message); sign in as academic_coordinator (no buttons, pencil still there); set a stage to Cancelled and try Create (refused).
- [ ] **Step 8: Restore** — put H250095's and the other student's stage values back the way they were (the local stack is shared test data), or `npm run local:rebuild` if simpler.

### Task 4.2: Docs and session context

**Files:**

- Modify: `docs/key-decisions/admissions.md` (new KD — next unused number per `.claude/rules/key-decisions.md` instructions), `.claude/rules/key-decisions.md` (quick-lookup row — **ask Mr Ace first**: rules files need his approval), `CLAUDE.md` Session context (new ✅ entry: built, migration 188 NOT YET APPLIED to production), `docs/context/06-admissions-integration.md` (a short "QuickBooks invoices" section pointing at the spec).

- [ ] **Step 1:** Write the KD: what was built, the status table, Re-invoiced meaning (Mr Ace 2026-10-14), roles, QB-first ordering, ⚠ known gaps (Paid → open always returns to Invoiced, not Re-invoiced; webhook needs `QBO_WEBHOOK_VERIFIER` + the Intuit webhook URL `https://sis.hfse.edu.sg/api/quickbooks/webhook` set before go-live; GST untested — needs an AU sandbox; production keys + one-time approval by an HFSE QuickBooks admin).
- [ ] **Step 2:** Commit docs.

```bash
git add docs/key-decisions/admissions.md CLAUDE.md docs/context/06-admissions-integration.md && git commit -m "docs(qbo): QuickBooks Registration/Fees invoicing — KD and session context"
```

- [ ] **Step 3:** Push only when Mr Ace asks: `git pull --rebase` first, every time.

**Final gate:** whole-branch review (spec coverage, Review Focus list, Global Constraints) on the most capable model.
