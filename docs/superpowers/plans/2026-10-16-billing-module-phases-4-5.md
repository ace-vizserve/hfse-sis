# Billing module — Phases 4–5 (screens, payments, read-only tiles) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Billing module's screens — Customers, the customer page, the invoice page, To review, Settings — with Create invoice, Send, Record payment (including customer credit) done from the SIS through QuickBooks; then the Registration / Fees tiles become a read-only line that opens Billing, and the KD #231 tile invoicing is removed.

**Architecture:** Phases 0–3 (on main, `f339af2b`..`b82c2827`) already keep a copy of every invoice and payment of a linked customer in `qbo_invoices` / `qbo_payments` and fill the tiles from it. This plan adds: pure view helpers (`lib/billing/view.ts`, `aging.ts`, `payment-plan.ts`, `activity.ts`) unit-tested without QuickBooks; live QuickBooks readers (`lib/billing/live.server.ts`) for the figures that must be QuickBooks' own (customer balance, A/R aging, customer profile, invoice detail); action modules (`*.server.ts`) for create / send / pay / link, called by thin routes and by a sandbox round-trip script; and server pages under `app/(billing)/billing/` with small client components in `components/billing/`. **The customer page refreshes that customer from QuickBooks every time it opens** (Mr Ace, 2026-10-16), so what it shows is QuickBooks' data at that moment; the stored copy serves the tiles, dashboards and the Customers list.

**Tech Stack:** Next.js 16 (server components, route handlers), Supabase service role, zod 4, TanStack Query + `useWriteAction`, shadcn primitives (`Card`, `Sheet`, `Tabs`, `Badge`, `Field`, `Select`, `Checkbox`, `AlertDialog`), the app's `DataTable` and `MetricCard`, vitest (`--pool=threads`), the existing `lib/qbo/client.ts`.

**Spec:** `docs/superpowers/specs/2026-10-15-billing-module-design.md` (builds on KD #231). **Approved mockup:** artifact `https://claude.ai/artifact/BSYcnF68BnxxaoLg1XLoLf` (version 6). Where the mockup and the spec differ, **the mockup wins** — Mr Ace approved it after the spec: stat cards on the Customers and customer pages, an invoice **page** (not a side sheet), a Customer details tab, customer credit, Send.

## Decisions made in conversation after the spec (2026-10-16) — binding

- **Invoice page**, not a side sheet: `/billing/[studentNumber]/invoices/[invoiceId]`, laid out like QuickBooks' invoice view: number, status, total, invoice / due date, lines with each line's GST code, subtotal / GST / total / paid / balance due, billing address, **Invoice activity**, message, memo, location.
- **Invoice activity** = Opened (QuickBooks `MetaData.CreateTime`, plus who, from the SIS), Sent (QuickBooks `DeliveryInfo` / `EmailStatus`, plus each SIS send from the audit log), **Viewed — always shown greyed "Shown in QuickBooks only"** (QuickBooks does not give apps a viewed event; checked in the sandbox: no field, `changehistory` refused), each payment (date, account, amount, reference), Paid or "S$X still due", Voided.
- **Sending always goes through the QuickBooks API** (`POST /invoice/{id}/send`). Create invoice can send at once; the invoice page has **Send again**.
- **GST:** no fixed rate. Each line uses its item's default GST code in QuickBooks; the SIS shows the code QuickBooks returns per line and QuickBooks' own GST total. Not testable in the US sandbox — the page simply shows what QuickBooks returns.
- **Open balance** = the customer's `Balance` from QuickBooks (net of unused credit). **Overdue** = QuickBooks' own **A/R Aging report** (`/reports/AgedReceivables`), everything outside "Current". Checked in the sandbox: MARQUEZ, Zara Grace A. — aging Current 890 / 1–30 80 / Total 970 = customer `Balance` 970. The customer page also shows **owed on invoices** (sum of open invoice balances, freshly read) so the net figure isn't mistaken for what's owed.
- **Credit:** a payment can be recorded with **no invoice ticked**; the unapplied part (`UnappliedAmt`) is credit on the customer. HFSE's QuickBooks has **no** "automatically apply credits" setting, so credit is used only when someone applies it: **Use credit** on the customer page and a "Use credit first" line in Record payment. Applying credit = updating the credit payment's `Line` to link the invoice (verified in the sandbox: S$50 credit, S$20 applied → `UnappliedAmt` 30, invoice balance 100 → 80).
- **Customer details tab** — the QuickBooks customer profile, read-only ("edit them in QuickBooks"): display / first / middle / last name, company (parents), active, customer since, email, phone, mobile, other phone, billing and shipping address, terms, payment method, send invoices by, currency, notes. Every field verified readable in the sandbox (`AlternatePhone`, `Notes`, `SalesTermRef`, `PaymentMethodRef` by filling them on VILLANUEVA, Cedric James S.).
- **No chart-of-accounts page.** Settings → Payment accounts picks the three banks.
- **Recording a payment does not require ticking an invoice.**
- **SDF must NOT map to Fees** (production sales report: 116 SDF instalment invoices; mapping them makes ~20 students Re-invoiced). The local `billing_item_map` has SDF → fees and the sandbox Fees invoices carry SDF; Task 4.0 fixes both.

## Global Constraints

- **Local stack + QuickBooks sandbox only.** Migrations applied with `npm run local:migrate`; nothing applied to production; nothing pushed.
- Migration numbers: **191** (`supabase/migrations/191_billing_payment_credit.sql`, Phase 4) and **192** (`supabase/migrations/192_billing_drop_tile_columns.sql`, Phase 5). 190 is taken (`190_billing_history_marker.sql`). Fix the header of `189_billing_module.sql`, which says "migration 190 drops the columns" — it is 192.
- Billing roles: `admissions`, `school_admin`, `superadmin` (`QBO_INVOICE_ROLES`, `lib/qbo/roles.ts`). Settings and the bulk link run: `superadmin` (`QBO_ADMIN_ROLES`). Record payment: the same three roles as invoicing.
- **QuickBooks first:** every write goes to QuickBooks; the SIS saves only after QuickBooks accepts (KD #231). QuickBooks wins on money.
- Sync stage writes go through `writeStageFromQbo` (`lib/qbo/stage-write.ts`). A stage set to **Cancelled** is never changed by the sync.
- `studentNumber` is the only student key (Hard Rule #4). Sub-customers (`Job: true`, a `ParentRef`, or `:` in `FullyQualifiedName`) are never offered or linked.
- New audit actions: `qbo.invoice.send` (Task 4.5), `qbo.payment.apply_credit` (Task 4.6). Each goes in `ALL_AUDIT_ACTIONS` (`lib/audit/log-action.ts`), `ACTION_LABELS` + the context switch in `lib/audit/humanize.ts`, and the admissions list in `app/(admissions)/admissions/audit-log/page.tsx`. `qbo.` and `billing.` are already admissions prefixes in `lib/audit/modules.ts`.
- **Design system is binding (Hard Rule #7):** tokens only from `app/globals.css` (no `#rrggbb`, `slate-*`, `gray-*`, `bg-white`); serif headlines ending in a full stop; mono uppercase eyebrows; `MetricCard` for stat tiles; `DataTable` for tables (every column with a render-function `header` declares `meta: { label }`, KD #161); §9.3 badge recipes; **one primary `Button` per view**; side sheets pin their footer (KD #227). Badge recipes used throughout:
  - healthy (Paid, Connected): `h-6 border-brand-mint bg-brand-mint/30 text-ink`
  - blocked (Overdue, Voided, Not connected): `h-6 border-destructive/40 bg-destructive/10 text-destructive`
  - attention (Part paid, Credit): `h-6 border-brand-amber/40 bg-brand-amber/10 text-ink`
  - informational (Open, tile tags, counts): `variant="secondary"` + `h-6`
- Plain-English copy for anything a person reads (errors included): no "webhook", "CDC", "realm", "token", "sync token", "API".
- Dates shown as `1 Sep 2026` (`formatDay`), money as `S$1,340.00` (`formatSgd`, `lib/qbo/format.ts`). Today is Singapore's date (`todaySg`).
- Tests: `npx vitest run --pool=threads <path>`; tests import `describe, expect, it` from `vitest` explicitly. `npx tsc --noEmit` clean at every task end.
- Scripts that use `lib/qbo/client.ts` run as `npx tsx --conditions=react-server --env-file=.env.development.local scripts/...`.
- Edits via Edit/Write tools only. Commit as ONE command: `git add <paths> && git commit -m "..."`. Never `git add -A` (concurrent sessions share this tree). These files carry another session's uncommitted changes and **no task edits or stages them**: `app/(admissions)/admissions/applications/[enroleeNumber]/page.tsx`, `app/(p-files)/p-files/[enroleeNumber]/page.tsx`, `components/sis/enrollment-history-chips.tsx`, `scripts/qbo/sandbox-test.ts`, `scripts/qbo/sis-roundtrip-test.ts` (Task 5.1 keeps `loadStageInvoices`' name and signature for exactly this reason). End commit messages with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Never put a Windows backslash path in a repo doc (Tailwind scans `docs/`).
- New route files and new `@theme` tokens may not reach a running `next dev` — restart it before believing new code is broken.

## Review Focus

1. **A payment with credit applied to an invoice that already had another payment** — the credit payment's existing `Line` entries must be kept when its new line is added (QuickBooks replaces the whole `Line` array on update), or an earlier application silently disappears. Test: Task 4.1 `mergeCreditLines` keeps existing lines; Task 4.11 round trip applies credit to a second invoice of a payment that already pays one.
2. **Record payment for more than the ticked invoices owe** — the excess must stay as credit (no line for it), never be spread onto an unticked invoice, and the sheet must say how much is left over. Test: Task 4.1 `planPayment` "leftover" case.
3. **QuickBooks unreachable when the customer page opens** — the page must still render from the stored copy, with a plain note saying it shows what was last read and when; never a crash. Test: Task 4.2 `pickBalances` falls back to stored sums with `source: 'stored'`; Task 4.7 loader catches every live read.
4. **An AY2026 Fees invoice for a returning student while creating an AY2027 Fees invoice** — the duplicate warning must only fire for the same tile in the **same** year. Test: Task 4.1 `duplicateTileWarning` "previous year" case.
5. **A paid Fees tile with no start date** on the read-only tile — the line must say "Paid in QuickBooks — add the start date", and saving the start date in the edit dialog must still turn Fees to Paid. Test: Task 5.1 `tileLine` "paid, no start date" case + `tileInvoiceState` is `'paid'` only when every live invoice on the tile is paid (that is what `loadQboStageLock` hands `paidOnStartDate`).

---

## Phase 4 — Billing screens

Gate: every task's tests green, `npx tsc --noEmit` clean, the sandbox round trip (Task 4.11) passes both ways, review pass on the phase diff.

### Task 4.0: Fix the sandbox Fees invoices and the local mapping (SDF is not Fees)

**Files:**

- Modify: `scripts/qbo/seed-sandbox-hfse.ts`
- Create: `scripts/qbo/fix-local-billing-map.ts`

**Interfaces:**

- Consumes: `qboRequest`, `qboQuery`, `qbEscape` (`lib/qbo/client.ts`); `refreshItems`, `sweepAfterSettingsSave` (`lib/billing/settings.server.ts`); `loadCustomerHistory` (`lib/billing/history.server.ts`).
- Produces: sandbox Fees invoices whose lines are on the `Enrolment Fees - *` accounts (Books 300 + Fee Protection Scheme 200 + Online Support 1000 = 1500, so payments already applied still fit); sandbox customers with email, phone, mobile and billing address; local `billing_account_map` with Admissions & Registration → registration, every `Enrolment Fees - *` → fees, Advance customers payment / Sales of Books and Miscellaneous / School Events → none; no `billing_item_map` row for a Student Devt Fees item.

- [ ] **Step 1: Seed — new income account and items**

In `scripts/qbo/seed-sandbox-hfse.ts`, add to `INCOME` (after `'Enrolment Fees - Fee Protection Scheme'`):

```ts
  'Enrolment Fees - Online Support and Lesson Plan',
```

Add to `ITEMS` (after the `AY2027 Fee Protection Scheme` entry):

```ts
  {
    name: 'AY2026 Fee Protection Scheme',
    account: 'Enrolment Fees - Fee Protection Scheme',
    price: 200,
  },
  {
    name: 'AY2026 Online Support, Lesson Plan & Syllabus',
    account: 'Enrolment Fees - Online Support and Lesson Plan',
    price: 1000,
  },
  {
    name: 'AY2027 Online Support, Lesson Plan & Syllabus',
    account: 'Enrolment Fees - Online Support and Lesson Plan',
    price: 1000,
  },
```

- [ ] **Step 2: Seed — `invoice()` takes several lines and repairs an existing invoice's lines**

Replace the whole `invoice` function with:

```ts
type SeedItem = { Id: string; name: string; price: number };

async function invoice(
  customer: Ref,
  lines: SeedItem[],
  txnDate: string,
  memo: string | null
) {
  const doc = `HFSE0${nextDoc++}`;
  type Inv = {
    Id: string;
    DocNumber: string;
    Balance: number;
    TotalAmt: number;
    SyncToken: string;
    CustomerRef?: { value: string };
    Line?: Array<{
      DetailType?: string;
      SalesItemLineDetail?: { ItemRef?: { value: string } };
    }>;
  };
  const Line = lines.map((item) => ({
    DetailType: 'SalesItemLineDetail',
    Amount: item.price,
    SalesItemLineDetail: {
      ItemRef: { value: item.Id },
      Qty: 1,
      UnitPrice: item.price,
    },
  }));
  const found = await qboQuery<Inv>(
    service,
    'Invoice',
    `DocNumber = '${doc}'`,
    'maxresults 1'
  );
  if (found[0]) {
    if (found[0].CustomerRef?.value !== customer.value)
      throw new Error(
        `Invoice ${doc} already exists in the sandbox for another customer (${found[0].CustomerRef?.value}, expected ${customer.value} ${customer.name ?? ''}). Seed numbers are positional; the student list changed.`
      );
    // An earlier run made it with other items (the old Fees invoices carried
    // Student Devt Fees): put the intended items on it. The totals match, so
    // payments already applied still fit.
    const have = (found[0].Line ?? [])
      .filter((l) => l.DetailType === 'SalesItemLineDetail')
      .map((l) => l.SalesItemLineDetail?.ItemRef?.value)
      .sort()
      .join(',');
    const want = lines
      .map((l) => l.Id)
      .sort()
      .join(',');
    if (have !== want) {
      const res = await qboRequest<{ Invoice: Inv }>(
        service,
        'POST',
        '/invoice',
        { Id: found[0].Id, SyncToken: found[0].SyncToken, sparse: true, Line }
      );
      console.log(`  ~ Invoice ${doc} lines replaced`);
      return res.Invoice;
    }
    return found[0];
  }
  const res = await qboRequest<{ Invoice: Inv }>(service, 'POST', '/invoice', {
    CustomerRef: customer,
    DocNumber: doc,
    TxnDate: txnDate,
    Line,
    ...(memo ? { CustomerMemo: { value: memo } } : {}),
  });
  console.log(`  + Invoice ${doc} ${customer.name ?? customer.value}`);
  return res.Invoice;
}
```

Then update every `invoice(` call in `main()` to pass an array:

- `items.get('AY2027 Registration Fee')!` → `[items.get('AY2027 Registration Fee')!]`
- the AY2027 Fees call → `[items.get('AY2027 Books')!, items.get('AY2027 Fee Protection Scheme')!, items.get('AY2027 Online Support, Lesson Plan & Syllabus')!]` (memo unchanged)
- each `items.get('Tuition Fees')!` → `[items.get('Tuition Fees')!]`
- the AY2026 Fees call → `[items.get('AY2026 Books')!, items.get('AY2026 Fee Protection Scheme')!, items.get('AY2026 Online Support, Lesson Plan & Syllabus')!]` (memo unchanged)
- the voided `items.get('AY2027 Books')!` → `[items.get('AY2027 Books')!]`

The `pay(c, fees, 1500, …)` / `pay(c, fees, 700, …)` / `pay(c, old, 1500, …)` calls stay (totals are still 1500).

Also add, inside the AY2027 branch right after the Tuition invoice, one SDF instalment invoice per fourth student so the mapping has a real SDF invoice to leave alone:

```ts
if (i % 4 === 3)
  await invoice(
    c,
    [items.get('AY2027 Student Devt Fees')!],
    '2026-09-15',
    'SDF instalment 1 of 3'
  );
```

- [ ] **Step 3: Seed — customer contact details**

Change the customers loop header from `for (const s of students) {` to `for (const [k, s] of students.entries()) {`, and replace its body after the `company` line (`const c = await findOrCreate…; customers.set(…)`) with:

```ts
const c = await findOrCreate<{
  Id: string;
  SyncToken: string;
  PrimaryEmailAddr?: { Address?: string };
}>('Customer', name, {
  DisplayName: name,
  ...(company ? { CompanyName: company } : {}),
});
if (!c.PrimaryEmailAddr?.Address) {
  // Made-up contact details (never a real address): the customer page's
  // Customer details tab and Send need something to show and send to.
  const slug = `${s.lastName}.${s.firstName}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z.]/g, '');
  const n = String(2_000_000 + k); // 7 digits, unique per student
  await qboRequest(service, 'POST', '/customer', {
    Id: c.Id,
    SyncToken: c.SyncToken,
    sparse: true,
    PrimaryEmailAddr: { Address: `${slug}@example.test` },
    PrimaryPhone: { FreeFormNumber: `6${n}` },
    Mobile: { FreeFormNumber: `9${n}` },
    BillAddr: {
      Line1: `${(k % 90) + 10} Example Road, #0${(k % 9) + 1}-12`,
      City: 'Singapore',
      PostalCode: n.slice(1),
      Country: 'Singapore',
    },
  });
  console.log(`  ~ Customer ${name} contact details`);
}
customers.set(s.studentNumber, { value: c.Id, name });
```

- [ ] **Step 4: Run the seed twice**

Run: `npx tsx --conditions=react-server --env-file=.env.development.local scripts/qbo/seed-sandbox-hfse.ts` — twice.
Expected: the first run prints `~ Invoice HFSE0… lines replaced` for each old Fees invoice and `~ Customer … contact details`; the second run prints no `+` or `~` lines.

- [ ] **Step 5: Write `scripts/qbo/fix-local-billing-map.ts`**

```ts
/**
 * Puts the LOCAL Billing mapping in HFSE's real shape (production sales
 * report, 2026-10-15): Registration = the Admissions & Registration account,
 * Fees = the Enrolment Fees accounts, and nothing else — Student Devt Fees is
 * billed in separate instalments and must NOT fill the Fees tile. Then
 * re-reads every linked student's QuickBooks history so the stored invoices
 * and the tiles follow.
 *
 *   npx tsx --conditions=react-server --env-file=.env.development.local scripts/qbo/fix-local-billing-map.ts
 *
 * Refuses to run unless Supabase is the local stack and QuickBooks is a sandbox.
 */
import { loadCustomerHistory } from '@/lib/billing/history.server';
import {
  refreshItems,
  sweepAfterSettingsSave,
} from '@/lib/billing/settings.server';
import { createServiceClient } from '@/lib/supabase/service';

const service = createServiceClient();

async function main() {
  if (
    !/localhost|127\.0\.0\.1/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
  )
    throw new Error('Refusing: Supabase is not the local stack.');
  const { data: conn } = await service
    .from('qbo_connection')
    .select('environment')
    .eq('id', 1)
    .maybeSingle();
  if (conn?.environment !== 'sandbox')
    throw new Error('Refusing: the SIS is not connected to a sandbox company.');

  console.log('Items:', await refreshItems(service));
  const { data: items, error } = await service
    .from('qbo_items')
    .select('income_account_id, income_account_name')
    .not('income_account_id', 'is', null);
  if (error) throw new Error(error.message);
  const accounts = new Map<string, string>();
  for (const r of items ?? [])
    accounts.set(
      r.income_account_id as string,
      (r.income_account_name as string) ?? ''
    );
  const stageFor = (name: string) =>
    /Admissions & Registration$/.test(name)
      ? 'registration'
      : /Enrolment Fees/.test(name)
        ? 'fees'
        : 'none';
  const rows = [...accounts].map(([id, name]) => ({
    qbo_account_id: id,
    account_name: name,
    stage: stageFor(name),
  }));
  const up = await service
    .from('billing_account_map')
    .upsert(rows, { onConflict: 'qbo_account_id' });
  if (up.error) throw new Error(up.error.message);
  for (const r of rows)
    console.log(`  ${r.stage.padEnd(12)} ${r.account_name}`);

  const del = await service
    .from('billing_item_map')
    .delete()
    .ilike('item_name', '%Student Devt%')
    .select('item_name');
  if (del.error) throw new Error(del.error.message);
  console.log(
    'Item overrides removed:',
    (del.data ?? []).map((r) => r.item_name)
  );

  const sweep = await sweepAfterSettingsSave(service);
  console.log('Sweep:', sweep);

  const { data: linked, error: lErr } = await service
    .from('qbo_customers')
    .select('student_number');
  if (lErr) throw new Error(lErr.message);
  for (const { student_number } of linked ?? []) {
    const r = await loadCustomerHistory(service, student_number as string);
    console.log(
      `  ${student_number}: ${r.invoices} invoices, ${r.payments} payments, ${r.tilesChanged} tiles changed${r.errors.length ? ` — ${r.errors.join('; ')}` : ''}`
    );
  }

  // The check: SDF instalments must sit on no tile; Fees invoices on Fees.
  const { data: inv, error: iErr } = await service
    .from('qbo_invoices')
    .select('doc_number, memo, stage_keys');
  if (iErr) throw new Error(iErr.message);
  const rows2 = (inv ?? []) as Array<{
    doc_number: string | null;
    memo: string | null;
    stage_keys: string[];
  }>;
  const sdfOnTile = rows2.filter(
    (r) =>
      (r.memo ?? '').startsWith('SDF instalment') && r.stage_keys.length > 0
  );
  const fees = rows2.filter((r) => r.stage_keys.includes('fees')).length;
  console.log(
    `Fees invoices: ${fees}. SDF instalments on a tile: ${sdfOnTile.length}.`
  );
  if (sdfOnTile.length)
    throw new Error(
      `SDF still fills a tile: ${sdfOnTile.map((r) => r.doc_number).join(', ')}`
    );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 6: Run it and check the tiles**

Run: `npx tsx --conditions=react-server --env-file=.env.development.local scripts/qbo/fix-local-billing-map.ts`
Expected: `fees` against the three `Enrolment Fees - …` accounts, `none` against Advance customers payment; `Item overrides removed:` lists the Student Devt Fees items (or `[]` if none); every student line with no error; last line `Fees invoices: N. SDF instalments on a tile: 0.` with N > 0. The script throws if any SDF instalment is still on a tile.

- [ ] **Step 7: Commit**

```bash
git add scripts/qbo/seed-sandbox-hfse.ts scripts/qbo/fix-local-billing-map.ts && git commit -m "fix(billing): sandbox Fees invoices on the Enrolment Fees accounts, SDF not mapped to Fees

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 4.1: Pure view helpers — status, dates, payment plan, duplicate warning, aging, activity

**Files:**

- Create: `lib/billing/view.ts`
- Create: `lib/billing/payment-plan.ts`
- Create: `lib/billing/aging.ts`
- Create: `lib/billing/activity.ts`
- Test: `__tests__/billing/view.test.ts`, `__tests__/billing/payment-plan.test.ts`, `__tests__/billing/aging.test.ts`, `__tests__/billing/activity.test.ts`

**Interfaces:**

- Consumes: `classifyInvoice`, `InvoiceLine`, `BillingMaps`, `StageChoice`, `BillingStage` (`lib/billing/classify.ts`); `formatSgd` (`lib/qbo/format.ts`).
- Produces (all pure, client-safe — no `server-only`):
  - `view.ts`: `type InvoiceStatus = 'open' | 'part' | 'overdue' | 'paid' | 'voided'`; `INVOICE_STATUS_LABEL: Record<InvoiceStatus, string>`; `invoiceStatus(r: { state: 'open' | 'paid' | 'voided'; total: number; balance: number; dueDate: string | null }, today: string): InvoiceStatus`; `todaySg(now?: Date): string`; `formatDay(iso: string | null | undefined): string`; `itemsSummary(lines: Array<{ itemName: string | null }>, max?: number): string`; `createdByLabel(r: { source: string | null; createdByEmail: string | null; memo: string | null }): string`; `tileTag(stageKeys: string[], ayCode: string | null): string | null`; `studentDisplayName(a: { lastName: string | null; firstName: string | null; middleName?: string | null; enroleeFullName?: string | null }): string`; `type MapsData = { accounts: Array<[string, StageChoice]>; items: Array<[string, StageChoice]>; ranges: BillingMaps['ranges'] }`; `mapsToData(m: BillingMaps): MapsData`; `mapsFromData(d: MapsData): BillingMaps`; `duplicateTileWarning(args: { lines: InvoiceLine[]; txnDate: string; maps: BillingMaps; existing: Array<{ docNumber: string | null; ayCode: string | null; stageKeys: string[]; state: 'open' | 'paid' | 'voided' }> }): string | null`; `round2(n: number): number`.
  - `payment-plan.ts`: `type OpenInvoice = { id: string; docNumber: string | null; txnDate: string | null; balance: number }`; `type CreditSource = { paymentId: string; txnDate: string | null; unapplied: number }`; `type PaymentPlan = { creditUse: Array<{ paymentId: string; invoiceId: string; amount: number }>; cashApply: Array<{ invoiceId: string; amount: number }>; creditUsed: number; cashApplied: number; leftover: number }`; `oldestFirst<T extends { txnDate: string | null; docNumber?: string | null }>(xs: T[]): T[]`; `planPayment(args: { invoices: OpenInvoice[]; credits: CreditSource[]; useCredit: boolean; amount: number }): PaymentPlan`; `mergeCreditLines(existing: Array<{ Amount?: number; LinkedTxn?: Array<{ TxnId: string; TxnType: string }> }>, add: Array<{ invoiceId: string; amount: number }>): Array<{ Amount: number; LinkedTxn: Array<{ TxnId: string; TxnType: string }> }>`.
  - `aging.ts`: `type AgingRow = { customerId: string | null; name: string; current: number; overdue: number; total: number }`; `parseAgedReceivables(json: unknown): AgingRow[]`.
  - `activity.ts`: `type ActivityEvent = { key: string; label: string; when: string | null; detail: string | null; tone: 'done' | 'paid' | 'off' | 'void'; paymentId?: string }`; `buildInvoiceActivity(args: { createdAt: string | null; createdBy: string | null; sends: Array<{ at: string; to: string | null; by: string | null }>; qbDelivery: { at: string | null; to: string | null } | null; payments: Array<{ id: string; txnDate: string | null; account: string | null; reference: string | null; amount: number }>; state: 'open' | 'paid' | 'voided'; balance: number; voidedAt: string | null }): ActivityEvent[]`; `formatDateTime(iso: string): string`.

- [ ] **Step 1: Write the failing tests**

`__tests__/billing/view.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { BillingMaps, InvoiceLine } from '@/lib/billing/classify';
import {
  createdByLabel,
  duplicateTileWarning,
  formatDay,
  invoiceStatus,
  itemsSummary,
  mapsFromData,
  mapsToData,
  studentDisplayName,
  tileTag,
  todaySg,
} from '@/lib/billing/view';

const maps: BillingMaps = {
  accounts: new Map([
    ['A-REG', 'registration'],
    ['A-FEES', 'fees'],
    ['A-ADV', 'none'],
  ]),
  items: new Map(),
  ranges: [
    { ayCode: 'AY2026', startsOn: '2025-06-01', endsOn: '2026-05-31' },
    { ayCode: 'AY2027', startsOn: '2026-06-01', endsOn: '2027-05-31' },
  ],
};
const line = (accountId: string): InvoiceLine => ({
  itemId: 'I1',
  itemName: 'AY2025 Books',
  accountId,
  description: null,
  qty: 1,
  amount: 300,
});

describe('invoiceStatus', () => {
  const base = { state: 'open' as const, total: 100, dueDate: '2026-10-01' };
  it('voided wins', () =>
    expect(
      invoiceStatus({ ...base, state: 'voided', balance: 0 }, '2026-10-16')
    ).toBe('voided'));
  it('paid when nothing is owed', () =>
    expect(
      invoiceStatus({ ...base, state: 'paid', balance: 0 }, '2026-10-16')
    ).toBe('paid'));
  it('overdue beats part paid', () =>
    expect(invoiceStatus({ ...base, balance: 40 }, '2026-10-16')).toBe(
      'overdue'
    ));
  it('part paid before the due date', () =>
    expect(invoiceStatus({ ...base, balance: 40 }, '2026-09-30')).toBe('part'));
  it('open when untouched and not due', () =>
    expect(invoiceStatus({ ...base, balance: 100 }, '2026-10-01')).toBe(
      'open'
    ));
  it('no due date is never overdue', () =>
    expect(
      invoiceStatus({ ...base, dueDate: null, balance: 100 }, '2030-01-01')
    ).toBe('open'));
});

describe('dates and labels', () => {
  it('todaySg uses Singapore time', () =>
    expect(todaySg(new Date('2026-10-15T17:30:00Z'))).toBe('2026-10-16'));
  it('formatDay', () => {
    expect(formatDay('2026-09-01')).toBe('1 Sep 2026');
    expect(formatDay(null)).toBe('—');
  });
  it('itemsSummary shortens long lists', () => {
    const l = (n: string) => ({ itemName: n });
    expect(itemsSummary([l('A'), l('B')])).toBe('A, B');
    expect(itemsSummary([l('A'), l('B'), l('C'), l('D'), l('E')])).toBe(
      'A, B, C +2'
    );
    expect(itemsSummary([l('A'), l('A')])).toBe('A');
    expect(itemsSummary([])).toBe('No items');
  });
  it('createdByLabel', () => {
    expect(
      createdByLabel({
        source: 'created',
        createdByEmail: 'luz@hfse.edu.sg',
        memo: null,
      })
    ).toBe('luz@hfse.edu.sg');
    expect(
      createdByLabel({
        source: 'synced',
        createdByEmail: null,
        memo: 'Auto-generated via n8n',
      })
    ).toBe('n8n');
    expect(
      createdByLabel({
        source: 'synced',
        createdByEmail: null,
        memo: 'AY2027 Enrolment',
      })
    ).toBe('QuickBooks');
  });
  it('tileTag', () => {
    expect(tileTag(['fees'], 'AY2027')).toBe('Fees · AY2027');
    expect(tileTag(['registration', 'fees'], 'AY2027')).toBe(
      'Registration + Fees · AY2027'
    );
    expect(tileTag([], 'AY2027')).toBeNull();
    expect(tileTag(['fees'], null)).toBeNull();
  });
  it('studentDisplayName is "Surname, Given M."', () => {
    expect(
      studentDisplayName({
        lastName: 'Reyes',
        firstName: 'Marco Andres',
        middleName: 'Lopez',
      })
    ).toBe('Reyes, Marco Andres L.');
    expect(
      studentDisplayName({
        lastName: null,
        firstName: null,
        enroleeFullName: 'Wei Ling Tan',
      })
    ).toBe('Wei Ling Tan');
    expect(studentDisplayName({ lastName: null, firstName: null })).toBe(
      'Unnamed student'
    );
  });
});

describe('maps survive a trip to the client', () => {
  it('round trips', () => {
    const back = mapsFromData(JSON.parse(JSON.stringify(mapsToData(maps))));
    expect(back.accounts.get('A-FEES')).toBe('fees');
    expect(back.ranges).toEqual(maps.ranges);
  });
});

describe('duplicateTileWarning', () => {
  const existing = [
    {
      docNumber: 'HFSE061904',
      ayCode: 'AY2027',
      stageKeys: ['fees'],
      state: 'open' as const,
    },
  ];
  it('warns for the same tile in the same year', () =>
    expect(
      duplicateTileWarning({
        lines: [line('A-FEES')],
        txnDate: '2026-10-15',
        maps,
        existing,
      })
    ).toBe(
      'HFSE061904 already bills Fees for AY2027. A second Fees invoice marks the stage Re-invoiced — carry on only if a new invoice is meant to be sent.'
    ));
  it('previous year: no warning', () =>
    expect(
      duplicateTileWarning({
        lines: [line('A-FEES')],
        txnDate: '2026-10-15',
        maps,
        existing: [{ ...existing[0], ayCode: 'AY2026' }],
      })
    ).toBeNull());
  it('a voided invoice does not count', () =>
    expect(
      duplicateTileWarning({
        lines: [line('A-FEES')],
        txnDate: '2026-10-15',
        maps,
        existing: [{ ...existing[0], state: 'voided' }],
      })
    ).toBeNull());
  it('items on no tile: no warning', () =>
    expect(
      duplicateTileWarning({
        lines: [line('A-ADV')],
        txnDate: '2026-10-15',
        maps,
        existing,
      })
    ).toBeNull());
  it('registration names its own stage', () =>
    expect(
      duplicateTileWarning({
        lines: [line('A-REG')],
        txnDate: '2026-10-15',
        maps,
        existing: [
          {
            docNumber: 'HFSE061210',
            ayCode: 'AY2027',
            stageKeys: ['registration'],
            state: 'paid',
          },
        ],
      })
    ).toBe(
      'HFSE061210 already bills Registration for AY2027. Carry on only if a new invoice is meant to be sent.'
    ));
});
```

`__tests__/billing/payment-plan.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  mergeCreditLines,
  oldestFirst,
  planPayment,
} from '@/lib/billing/payment-plan';

const inv = (id: string, txnDate: string, balance: number, docNumber = id) => ({
  id,
  docNumber,
  txnDate,
  balance,
});

describe('oldestFirst', () => {
  it('sorts by date then number, numerically', () => {
    const xs = [
      inv('b', '2026-09-01', 1, 'HFSE10'),
      inv('a', '2026-09-01', 1, 'HFSE9'),
      inv('c', '2026-08-01', 1),
    ];
    expect(oldestFirst(xs).map((x) => x.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('planPayment', () => {
  const invoices = [
    inv('old', '2026-09-01', 1340),
    inv('new', '2026-10-01', 500),
  ];
  it('pays oldest first up to the amount', () => {
    const p = planPayment({
      invoices,
      credits: [],
      useCredit: false,
      amount: 1500,
    });
    expect(p.cashApply).toEqual([
      { invoiceId: 'old', amount: 1340 },
      { invoiceId: 'new', amount: 160 },
    ]);
    expect(p.leftover).toBe(0);
  });
  it('leftover: more than the ticked invoices owe stays as credit', () => {
    const p = planPayment({
      invoices: [invoices[0]],
      credits: [],
      useCredit: false,
      amount: 1500,
    });
    expect(p.cashApply).toEqual([{ invoiceId: 'old', amount: 1340 }]);
    expect(p.leftover).toBe(160);
  });
  it('no invoice ticked: all of it is credit', () => {
    const p = planPayment({
      invoices: [],
      credits: [],
      useCredit: false,
      amount: 50,
    });
    expect(p.cashApply).toEqual([]);
    expect(p.leftover).toBe(50);
  });
  it('credit is used first, oldest credit first, across invoices', () => {
    const p = planPayment({
      invoices,
      credits: [
        { paymentId: 'p2', txnDate: '2026-10-10', unapplied: 30 },
        { paymentId: 'p1', txnDate: '2026-09-10', unapplied: 1335 },
      ],
      useCredit: true,
      amount: 475,
    });
    expect(p.creditUse).toEqual([
      { paymentId: 'p1', invoiceId: 'old', amount: 1335 },
      { paymentId: 'p2', invoiceId: 'old', amount: 5 },
      { paymentId: 'p2', invoiceId: 'new', amount: 25 },
    ]);
    expect(p.creditUsed).toBe(1365);
    expect(p.cashApply).toEqual([{ invoiceId: 'new', amount: 475 }]);
    expect(p.leftover).toBe(0);
  });
  it('credit off: credit untouched', () => {
    const p = planPayment({
      invoices,
      credits: [{ paymentId: 'p1', txnDate: '2026-09-10', unapplied: 100 }],
      useCredit: false,
      amount: 0,
    });
    expect(p.creditUse).toEqual([]);
    expect(p.cashApply).toEqual([]);
  });
  it('cents stay exact', () => {
    const p = planPayment({
      invoices: [inv('x', '2026-09-01', 0.3)],
      credits: [],
      useCredit: false,
      amount: 0.1 + 0.2,
    });
    expect(p.cashApply).toEqual([{ invoiceId: 'x', amount: 0.3 }]);
    expect(p.leftover).toBe(0);
  });
});

describe('mergeCreditLines', () => {
  it('keeps every existing line and adds the new ones', () => {
    const out = mergeCreditLines(
      [{ Amount: 20, LinkedTxn: [{ TxnId: '257', TxnType: 'Invoice' }] }],
      [{ invoiceId: '300', amount: 10 }]
    );
    expect(out).toEqual([
      { Amount: 20, LinkedTxn: [{ TxnId: '257', TxnType: 'Invoice' }] },
      { Amount: 10, LinkedTxn: [{ TxnId: '300', TxnType: 'Invoice' }] },
    ]);
  });
  it('adds to an existing line for the same invoice instead of a second line', () => {
    const out = mergeCreditLines(
      [{ Amount: 20, LinkedTxn: [{ TxnId: '257', TxnType: 'Invoice' }] }],
      [{ invoiceId: '257', amount: 5 }]
    );
    expect(out).toEqual([
      { Amount: 25, LinkedTxn: [{ TxnId: '257', TxnType: 'Invoice' }] },
    ]);
  });
});
```

`__tests__/billing/aging.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { parseAgedReceivables } from '@/lib/billing/aging';

// Shape returned by the sandbox, 2026-10-16 (MARQUEZ, Zara Grace A.).
const report = {
  Columns: {
    Column: [
      { ColTitle: '' },
      { ColTitle: 'Current' },
      { ColTitle: '1 - 30' },
      { ColTitle: '31 - 60' },
      { ColTitle: '61 - 90' },
      { ColTitle: '91 and over' },
      { ColTitle: 'Total' },
    ],
  },
  Rows: {
    Row: [
      {
        ColData: [
          { value: 'MARQUEZ, Zara Grace A.', id: '58' },
          { value: '890.00' },
          { value: '80.00' },
          { value: '' },
          { value: '' },
          { value: '' },
          { value: '970.00' },
        ],
      },
      {
        ColData: [
          { value: 'TAN, Wei Ling' },
          { value: '' },
          { value: '' },
          { value: '' },
          { value: '' },
          { value: '120.50' },
          { value: '120.50' },
        ],
      },
      {
        type: 'Section',
        Summary: {
          ColData: [
            { value: 'TOTAL' },
            { value: '890.00' },
            { value: '80.00' },
            { value: '0.00' },
            { value: '0.00' },
            { value: '120.50' },
            { value: '1090.50' },
          ],
        },
      },
    ],
  },
};

describe('parseAgedReceivables', () => {
  it('reads each customer, overdue = everything outside Current', () => {
    expect(parseAgedReceivables(report)).toEqual([
      {
        customerId: '58',
        name: 'MARQUEZ, Zara Grace A.',
        current: 890,
        overdue: 80,
        total: 970,
      },
      {
        customerId: null,
        name: 'TAN, Wei Ling',
        current: 0,
        overdue: 120.5,
        total: 120.5,
      },
    ]);
  });
  it('an empty or odd report gives no rows', () => {
    expect(parseAgedReceivables({})).toEqual([]);
    expect(parseAgedReceivables(null)).toEqual([]);
  });
});
```

`__tests__/billing/activity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { buildInvoiceActivity } from '@/lib/billing/activity';

const base = {
  createdAt: '2026-09-01T09:00:00+08:00',
  createdBy: 'Admissions staff',
  sends: [],
  qbDelivery: null,
  payments: [],
  state: 'open' as const,
  balance: 1340,
  voidedAt: null,
};

describe('buildInvoiceActivity', () => {
  it('opened, viewed greyed, still due', () => {
    const a = buildInvoiceActivity(base);
    expect(a.map((e) => [e.label, e.tone])).toEqual([
      ['Opened', 'done'],
      ['Viewed', 'off'],
      ['Paid', 'off'],
    ]);
    expect(a[1].detail).toBe('Shown in QuickBooks only');
    expect(a[2].detail).toBe('S$1,340.00 still due');
  });
  it('SIS sends listed; QuickBooks delivery used when the SIS has none', () => {
    const fromSis = buildInvoiceActivity({
      ...base,
      sends: [
        {
          at: '2026-09-01T09:14:02+08:00',
          to: 'a@example.test',
          by: 'luz@hfse.edu.sg',
        },
      ],
      qbDelivery: { at: '2026-09-01T09:14:05+08:00', to: 'a@example.test' },
    });
    expect(fromSis.filter((e) => e.label === 'Sent')).toHaveLength(1);
    expect(fromSis.find((e) => e.label === 'Sent')?.detail).toBe(
      'a@example.test · by luz@hfse.edu.sg'
    );
    const fromQb = buildInvoiceActivity({
      ...base,
      qbDelivery: { at: '2026-09-01T09:14:05+08:00', to: 'b@example.test' },
    });
    expect(fromQb.find((e) => e.label === 'Sent')?.detail).toBe(
      'b@example.test'
    );
  });
  it('part payments then paid', () => {
    const a = buildInvoiceActivity({
      ...base,
      state: 'paid',
      balance: 0,
      payments: [
        {
          id: 'p2',
          txnDate: '2026-10-01',
          account: 'PayNow',
          reference: null,
          amount: 125,
        },
        {
          id: 'p1',
          txnDate: '2026-09-20',
          account: 'UOB',
          reference: '88312',
          amount: 1215,
        },
      ],
    });
    const labels = a.map((e) => e.label);
    expect(labels).toEqual(['Opened', 'Viewed', 'Partly paid', 'Paid']);
    expect(a[2].detail).toBe('UOB · S$1,215.00 · ref 88312');
    expect(a[3]).toMatchObject({
      tone: 'paid',
      when: '2026-10-01',
      paymentId: 'p2',
    });
  });
  it('voided ends the list', () => {
    const a = buildInvoiceActivity({
      ...base,
      state: 'voided',
      balance: 0,
      voidedAt: '2026-09-03T10:00:00+08:00',
    });
    expect(a.at(-1)).toMatchObject({ label: 'Voided', tone: 'void' });
    expect(a.some((e) => e.label === 'Paid')).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --pool=threads __tests__/billing/view.test.ts __tests__/billing/payment-plan.test.ts __tests__/billing/aging.test.ts __tests__/billing/activity.test.ts`
Expected: FAIL — the four modules don't exist.

- [ ] **Step 3: Write `lib/billing/view.ts`**

```ts
// What the Billing screens show, worked out from the stored QuickBooks copy.
// Pure and client-safe: the pages compute on the server, the sheets reuse the
// same rules in the browser.

import {
  classifyInvoice,
  type BillingMaps,
  type BillingStage,
  type InvoiceLine,
  type StageChoice,
} from '@/lib/billing/classify';

export type InvoiceStatus = 'open' | 'part' | 'overdue' | 'paid' | 'voided';

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  open: 'Open',
  part: 'Part paid',
  overdue: 'Overdue',
  paid: 'Paid',
  voided: 'Voided',
};

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function invoiceStatus(
  r: {
    state: 'open' | 'paid' | 'voided';
    total: number;
    balance: number;
    dueDate: string | null;
  },
  today: string
): InvoiceStatus {
  if (r.state === 'voided') return 'voided';
  if (r.state === 'paid' || r.balance <= 0) return 'paid';
  if (r.dueDate && r.dueDate.slice(0, 10) < today) return 'overdue';
  if (r.balance < r.total) return 'part';
  return 'open';
}

/** Today's date in Singapore, YYYY-MM-DD. */
export function todaySg(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}

/** `2026-09-01` → `1 Sep 2026`; blank → `—`. */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** "AY2025 Books, AY2025 Materials Fee, … +4" — each item once. */
export function itemsSummary(
  lines: Array<{ itemName: string | null }>,
  max = 3
): string {
  const names = [
    ...new Set(
      lines.map((l) => l.itemName?.trim()).filter((n): n is string => !!n)
    ),
  ];
  if (names.length === 0) return 'No items';
  const shown = names.slice(0, max).join(', ');
  return names.length > max ? `${shown} +${names.length - max}` : shown;
}

/** Who made the invoice, in words staff use. */
export function createdByLabel(r: {
  source: string | null;
  createdByEmail: string | null;
  memo: string | null;
}): string {
  if (r.source === 'created' && r.createdByEmail) return r.createdByEmail;
  if ((r.memo ?? '').startsWith('Auto-generated via n8n')) return 'n8n';
  return 'QuickBooks';
}

const STAGE_LABEL: Record<BillingStage, string> = {
  registration: 'Registration',
  fees: 'Fees',
};

/** "Fees · AY2027", or null when the invoice fills no tile. */
export function tileTag(
  stageKeys: string[],
  ayCode: string | null
): string | null {
  const stages = stageKeys.filter(
    (s): s is BillingStage => s === 'registration' || s === 'fees'
  );
  if (!ayCode || stages.length === 0) return null;
  return `${stages.map((s) => STAGE_LABEL[s]).join(' + ')} · ${ayCode}`;
}

/** "Reyes, Marco Andres L." — the QuickBooks naming, in title case. */
export function studentDisplayName(a: {
  lastName: string | null;
  firstName: string | null;
  middleName?: string | null;
  enroleeFullName?: string | null;
}): string {
  const last = a.lastName?.trim();
  const first = a.firstName?.trim();
  if (last && first) {
    const mi = a.middleName?.trim()
      ? ` ${a.middleName.trim()[0].toUpperCase()}.`
      : '';
    return `${last}, ${first}${mi}`;
  }
  return a.enroleeFullName?.trim() || 'Unnamed student';
}

export type MapsData = {
  accounts: Array<[string, StageChoice]>;
  items: Array<[string, StageChoice]>;
  ranges: BillingMaps['ranges'];
};

export function mapsToData(m: BillingMaps): MapsData {
  return {
    accounts: [...m.accounts],
    items: [...m.items],
    ranges: m.ranges,
  };
}

export function mapsFromData(d: MapsData): BillingMaps {
  return {
    accounts: new Map(d.accounts),
    items: new Map(d.items),
    ranges: d.ranges,
  };
}

/**
 * The amber note on Create invoice: the new invoice would sit on a tile that
 * already has a live invoice for the same year. A warning, never a block.
 */
export function duplicateTileWarning(args: {
  lines: InvoiceLine[];
  txnDate: string;
  maps: BillingMaps;
  existing: Array<{
    docNumber: string | null;
    ayCode: string | null;
    stageKeys: string[];
    state: 'open' | 'paid' | 'voided';
  }>;
}): string | null {
  const place = classifyInvoice(args.lines, args.txnDate, args.maps);
  if (!place.ayCode) return null;
  for (const stage of place.stageKeys) {
    const same = args.existing.find(
      (e) =>
        e.state !== 'voided' &&
        e.ayCode === place.ayCode &&
        e.stageKeys.includes(stage)
    );
    if (!same) continue;
    const name = STAGE_LABEL[stage];
    const doc = same.docNumber ?? 'An invoice';
    return stage === 'fees'
      ? `${doc} already bills ${name} for ${place.ayCode}. A second ${name} invoice marks the stage Re-invoiced — carry on only if a new invoice is meant to be sent.`
      : `${doc} already bills ${name} for ${place.ayCode}. Carry on only if a new invoice is meant to be sent.`;
  }
  return null;
}
```

- [ ] **Step 4: Write `lib/billing/payment-plan.ts`**

```ts
// Record payment: which invoices a payment (and any unused credit) pays.
// Pure, so the sheet shows exactly what the route will send to QuickBooks.
//
// Credit is used first when asked, oldest credit first; then the new money,
// oldest invoice first. Anything the ticked invoices don't need stays on the
// payment unapplied — QuickBooks keeps it as credit on the customer.

import { round2 } from '@/lib/billing/view';

export type OpenInvoice = {
  id: string;
  docNumber: string | null;
  txnDate: string | null;
  balance: number;
};
export type CreditSource = {
  paymentId: string;
  txnDate: string | null;
  unapplied: number;
};
export type PaymentPlan = {
  creditUse: Array<{ paymentId: string; invoiceId: string; amount: number }>;
  cashApply: Array<{ invoiceId: string; amount: number }>;
  creditUsed: number;
  cashApplied: number;
  leftover: number;
};

const cents = (n: number) => Math.round(n * 100);

export function oldestFirst<
  T extends { txnDate: string | null; docNumber?: string | null },
>(xs: T[]): T[] {
  return [...xs].sort(
    (a, b) =>
      (a.txnDate ?? '').localeCompare(b.txnDate ?? '') ||
      (a.docNumber ?? '').localeCompare(b.docNumber ?? '', undefined, {
        numeric: true,
      })
  );
}

export function planPayment(args: {
  invoices: OpenInvoice[];
  credits: CreditSource[];
  useCredit: boolean;
  amount: number;
}): PaymentPlan {
  // Work in whole cents so 0.1 + 0.2 pays a 0.30 invoice exactly.
  const owed = new Map(
    oldestFirst(args.invoices)
      .filter((i) => i.balance > 0)
      .map((i) => [i.id, cents(i.balance)] as [string, number])
  );
  const creditUse: PaymentPlan['creditUse'] = [];
  if (args.useCredit) {
    for (const c of oldestFirst(
      args.credits.map((c) => ({ ...c, docNumber: c.paymentId }))
    )) {
      let left = cents(c.unapplied);
      for (const [id, due] of owed) {
        if (left <= 0) break;
        if (due <= 0) continue;
        const take = Math.min(left, due);
        creditUse.push({
          paymentId: c.paymentId,
          invoiceId: id,
          amount: take / 100,
        });
        owed.set(id, due - take);
        left -= take;
      }
    }
  }
  const cashApply: PaymentPlan['cashApply'] = [];
  let cash = cents(Math.max(0, args.amount));
  for (const [id, due] of owed) {
    if (cash <= 0) break;
    if (due <= 0) continue;
    const take = Math.min(cash, due);
    cashApply.push({ invoiceId: id, amount: take / 100 });
    cash -= take;
  }
  const creditUsed = round2(creditUse.reduce((s, x) => s + x.amount, 0));
  const cashApplied = round2(cashApply.reduce((s, x) => s + x.amount, 0));
  return {
    creditUse,
    cashApply,
    creditUsed,
    cashApplied,
    leftover: cash / 100,
  };
}

/**
 * The credit payment's new `Line` list. QuickBooks REPLACES the whole list on
 * an update, so every line it already has is kept; a second application to
 * the same invoice adds to that invoice's line.
 */
export function mergeCreditLines(
  existing: Array<{
    Amount?: number;
    LinkedTxn?: Array<{ TxnId: string; TxnType: string }>;
  }>,
  add: Array<{ invoiceId: string; amount: number }>
): Array<{
  Amount: number;
  LinkedTxn: Array<{ TxnId: string; TxnType: string }>;
}> {
  const out = existing.map((l) => ({
    Amount: Number(l.Amount ?? 0),
    LinkedTxn: [...(l.LinkedTxn ?? [])],
  }));
  for (const a of add) {
    const same = out.find(
      (l) =>
        l.LinkedTxn.length === 1 &&
        l.LinkedTxn[0].TxnType === 'Invoice' &&
        l.LinkedTxn[0].TxnId === a.invoiceId
    );
    if (same) same.Amount = round2(same.Amount + a.amount);
    else
      out.push({
        Amount: a.amount,
        LinkedTxn: [{ TxnId: a.invoiceId, TxnType: 'Invoice' }],
      });
  }
  return out;
}
```

- [ ] **Step 5: Write `lib/billing/aging.ts`**

```ts
// QuickBooks' own A/R Aging Summary report (`/reports/AgedReceivables`),
// read for the Customers list and the customer page so "Overdue" is the
// figure QuickBooks shows, not one the SIS adds up. Pure parser.

export type AgingRow = {
  customerId: string | null;
  name: string;
  current: number;
  overdue: number;
  total: number;
};

type Col = { value?: string; id?: string };
type Row = { ColData?: Col[]; Rows?: { Row?: Row[] } };

const num = (v: string | undefined) => {
  const n = Number((v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

export function parseAgedReceivables(json: unknown): AgingRow[] {
  const j = (json ?? {}) as {
    Columns?: { Column?: Array<{ ColTitle?: string }> };
    Rows?: { Row?: Row[] };
  };
  const titles = (j.Columns?.Column ?? []).map((c) =>
    (c.ColTitle ?? '').trim()
  );
  const iCurrent = titles.indexOf('Current');
  const iTotal = titles.indexOf('Total');
  if (iCurrent < 0 || iTotal < 0) return [];
  const out: AgingRow[] = [];
  const walk = (rows: Row[]) => {
    for (const r of rows) {
      if (r.ColData?.length) {
        const name = (r.ColData[0]?.value ?? '').trim();
        if (!name || name.toUpperCase() === 'TOTAL') continue;
        let overdue = 0;
        for (let i = iCurrent + 1; i < iTotal; i++)
          overdue += num(r.ColData[i]?.value);
        out.push({
          customerId: r.ColData[0]?.id ?? null,
          name,
          current: r2(num(r.ColData[iCurrent]?.value)),
          overdue: r2(overdue),
          total: r2(num(r.ColData[iTotal]?.value)),
        });
      }
      if (r.Rows?.Row) walk(r.Rows.Row);
    }
  };
  walk(j.Rows?.Row ?? []);
  return out;
}
```

- [ ] **Step 6: Write `lib/billing/activity.ts`**

```ts
// The invoice page's "Invoice activity", like QuickBooks' own: Opened, Sent,
// Viewed, each payment, Paid. QuickBooks does not give apps the Viewed event
// (checked in the sandbox, 2026-10-16), so Viewed is always shown greyed.
// Pure.

import { formatSgd } from '@/lib/qbo/format';

export type ActivityEvent = {
  key: string;
  label: string;
  /** ISO date or date-time; null when not happened yet. */
  when: string | null;
  detail: string | null;
  tone: 'done' | 'paid' | 'off' | 'void';
  paymentId?: string;
};

/** `1/9/2026, 9:14:02 am`, as QuickBooks writes it. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (iso.length <= 10)
    return d.toLocaleDateString('en-SG', { timeZone: 'Asia/Singapore' });
  return d.toLocaleString('en-SG', {
    timeZone: 'Asia/Singapore',
    hour12: true,
  });
}

export function buildInvoiceActivity(args: {
  createdAt: string | null;
  createdBy: string | null;
  sends: Array<{ at: string; to: string | null; by: string | null }>;
  qbDelivery: { at: string | null; to: string | null } | null;
  payments: Array<{
    id: string;
    txnDate: string | null;
    account: string | null;
    reference: string | null;
    amount: number;
  }>;
  state: 'open' | 'paid' | 'voided';
  balance: number;
  voidedAt: string | null;
}): ActivityEvent[] {
  const out: ActivityEvent[] = [
    {
      key: 'opened',
      label: 'Opened',
      when: args.createdAt,
      detail: args.createdBy ? `by ${args.createdBy}` : null,
      tone: 'done',
    },
  ];
  if (args.sends.length > 0) {
    for (const [i, s] of args.sends.entries())
      out.push({
        key: `sent-${i}`,
        label: 'Sent',
        when: s.at,
        detail:
          [s.to, s.by ? `by ${s.by}` : null].filter(Boolean).join(' · ') ||
          null,
        tone: 'done',
      });
  } else if (args.qbDelivery?.at) {
    out.push({
      key: 'sent-qb',
      label: 'Sent',
      when: args.qbDelivery.at,
      detail: args.qbDelivery.to,
      tone: 'done',
    });
  }
  out.push({
    key: 'viewed',
    label: 'Viewed',
    when: null,
    detail: 'Shown in QuickBooks only',
    tone: 'off',
  });
  const pays = [...args.payments].sort((a, b) =>
    (a.txnDate ?? '').localeCompare(b.txnDate ?? '')
  );
  const describe = (p: (typeof pays)[number]) =>
    [p.account, formatSgd(p.amount), p.reference ? `ref ${p.reference}` : null]
      .filter(Boolean)
      .join(' · ');
  const last =
    args.state === 'paid' && args.balance <= 0 ? pays.at(-1) : undefined;
  for (const p of pays) {
    if (p === last) continue;
    out.push({
      key: `pay-${p.id}`,
      label: 'Partly paid',
      when: p.txnDate,
      detail: describe(p),
      tone: 'paid',
      paymentId: p.id,
    });
  }
  if (args.state === 'voided') {
    out.push({
      key: 'voided',
      label: 'Voided',
      when: args.voidedAt,
      detail: null,
      tone: 'void',
    });
    return out;
  }
  if (last)
    out.push({
      key: 'paid',
      label: 'Paid',
      when: last.txnDate,
      detail: describe(last),
      tone: 'paid',
      paymentId: last.id,
    });
  else
    out.push({
      key: 'paid',
      label: 'Paid',
      when: null,
      detail: `${formatSgd(args.balance)} still due`,
      tone: 'off',
    });
  return out;
}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run --pool=threads __tests__/billing/`
Expected: PASS (the four new files plus the existing seven).

- [ ] **Step 8: Commit**

```bash
git add lib/billing/view.ts lib/billing/payment-plan.ts lib/billing/aging.ts lib/billing/activity.ts __tests__/billing/view.test.ts __tests__/billing/payment-plan.test.ts __tests__/billing/aging.test.ts __tests__/billing/activity.test.ts && git commit -m "feat(billing): view helpers — invoice status, payment plan with credit, aging report, invoice activity

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 4.2: Credit stored, live QuickBooks readers, student lookup

**Files:**

- Create: `supabase/migrations/191_billing_payment_credit.sql`
- Modify: `supabase/migrations/189_billing_module.sql` (header comment only)
- Modify: `lib/billing/invoice-row.ts` (`QbPayment` fields)
- Modify: `lib/billing/store.server.ts` (`upsertPayment` stores `unapplied`)
- Modify: `lib/qbo/client.ts` (`qboRequest` optional content type)
- Create: `lib/billing/live.server.ts`
- Create: `lib/billing/students.server.ts`
- Create: `lib/billing/balances.ts`
- Test: `__tests__/billing/balances.test.ts`
- Create: `scripts/qbo/billing-live-check.ts`

**Interfaces:**

- Consumes: `qboRequest`, `qboQuery`, `qbEscape` (`lib/qbo/client.ts`); `parseAgedReceivables`, `AgingRow` (Task 4.1); `todaySg`, `round2`, `studentDisplayName` (Task 4.1); `invoiceState` (`lib/qbo/invoice-snapshot.ts`).
- Produces:
  - DB: `qbo_payments.unapplied numeric(12,2) not null default 0`.
  - `QbPayment` gains `UnappliedAmt?: number; PrivateNote?: string; PaymentMethodRef?: { value: string; name?: string }`.
  - `qboRequest<T>(service, method, path, body?, opts?: { contentType?: string })`.
  - `live.server.ts`: `type CustomerProfile`, `readCustomerProfile(service, customerId): Promise<CustomerProfile>`; `readAging(service, opts?: { customerId?: string }): Promise<AgingRow[]>`; `type InvoiceDetail`, `type InvoiceDetailLine`, `readInvoiceDetail(service, qboInvoiceId): Promise<InvoiceDetail>`; `addressLines(a?: QbAddress): string[]`.
  - `students.server.ts`: `type StudentInfo = { studentNumber: string; name: string; level: string | null; ayCode: string; enroleeNumber: string; firstName: string | null; middleName: string | null; lastName: string | null; fatherFullName: string | null; motherFullName: string | null }`; `loadStudentInfo(service, studentNumbers: string[]): Promise<Map<string, StudentInfo>>` (newest academic year wins).
  - `balances.ts`: `type Balances = { owedOnInvoices: number; openBalance: number; overdue: number; credit: number; source: 'quickbooks' | 'stored' }`; `pickBalances(args: { stored: { owed: number; overdue: number; credit: number }; live: { balance: number; agingRow: AgingRow | null } | null }): Balances`.

- [ ] **Step 1: Migration 191**

`supabase/migrations/191_billing_payment_credit.sql`:

```sql
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
```

In `supabase/migrations/189_billing_module.sql`, change the header line `-- until Phase 5 removes them (migration 190 drops the columns).` to `-- until Phase 5 removes them (migration 192 drops the columns).` (189 is applied to the local stack only; a comment change does not alter it.)

Run: `npm run local:migrate`
Expected: 191 applied, no error.

- [ ] **Step 2: Store the credit**

In `lib/billing/invoice-row.ts`, extend `QbPayment`:

```ts
export type QbPayment = {
  Id: string;
  TxnDate?: string;
  TotalAmt: number;
  UnappliedAmt?: number;
  PrivateNote?: string;
  CustomerRef: { value: string };
  DepositToAccountRef?: { value: string; name?: string };
  PaymentMethodRef?: { value: string; name?: string };
  PaymentRefNum?: string;
  Line?: Array<{
    Amount?: number;
    LinkedTxn?: Array<{ TxnId: string; TxnType: string }>;
  }>;
};
```

In `lib/billing/store.server.ts` `upsertPayment`, add after `total: Number(args.p.TotalAmt),`:

```ts
    unapplied: Number(args.p.UnappliedAmt ?? 0),
```

- [ ] **Step 3: `qboRequest` takes a content type (Send needs `application/octet-stream`)**

In `lib/qbo/client.ts`, change the signature and the headers:

```ts
export async function qboRequest<T>(
  service: SupabaseClient,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  opts?: { contentType?: string }
): Promise<T> {
```

and inside the `fetch` call replace

```ts
        ...(body ? { 'Content-Type': 'application/json' } : {}),
```

with

```ts
        ...(body
          ? { 'Content-Type': 'application/json' }
          : opts?.contentType
            ? { 'Content-Type': opts.contentType }
            : {}),
```

- [ ] **Step 4: Write the failing test for `pickBalances`**

`__tests__/billing/balances.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { pickBalances } from '@/lib/billing/balances';

const stored = { owed: 1000, overdue: 80, credit: 30 };

describe('pickBalances', () => {
  it("uses QuickBooks' own balance and aging when they were read", () => {
    expect(
      pickBalances({
        stored,
        live: {
          balance: 970,
          agingRow: {
            customerId: '58',
            name: 'M',
            current: 890,
            overdue: 80,
            total: 970,
          },
        },
      })
    ).toEqual({
      owedOnInvoices: 1000,
      openBalance: 970,
      overdue: 80,
      credit: 30,
      source: 'quickbooks',
    });
  });
  it('a customer missing from the aging report owes nothing overdue', () => {
    expect(
      pickBalances({ stored, live: { balance: 0, agingRow: null } }).overdue
    ).toBe(0);
  });
  it('QuickBooks unreachable: falls back to the stored sums', () => {
    expect(pickBalances({ stored, live: null })).toEqual({
      owedOnInvoices: 1000,
      openBalance: 970,
      overdue: 80,
      credit: 30,
      source: 'stored',
    });
  });
});
```

Run: `npx vitest run --pool=threads __tests__/billing/balances.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 5: Write `lib/billing/balances.ts`**

```ts
// Which balance figures a page shows. QuickBooks' own (customer Balance, A/R
// aging) when they were just read; otherwise the stored copy's sums, marked
// so the page can say so. Pure.

import type { AgingRow } from '@/lib/billing/aging';
import { round2 } from '@/lib/billing/view';

export type Balances = {
  /** Sum of the open invoices' balances (what is owed before credit). */
  owedOnInvoices: number;
  /** QuickBooks' customer balance: owed minus unused credit. */
  openBalance: number;
  overdue: number;
  credit: number;
  source: 'quickbooks' | 'stored';
};

export function pickBalances(args: {
  stored: { owed: number; overdue: number; credit: number };
  live: { balance: number; agingRow: AgingRow | null } | null;
}): Balances {
  const { stored, live } = args;
  if (live)
    return {
      owedOnInvoices: round2(stored.owed),
      openBalance: round2(live.balance),
      overdue: round2(live.agingRow?.overdue ?? 0),
      credit: round2(stored.credit),
      source: 'quickbooks',
    };
  return {
    owedOnInvoices: round2(stored.owed),
    openBalance: round2(stored.owed - stored.credit),
    overdue: round2(stored.overdue),
    credit: round2(stored.credit),
    source: 'stored',
  };
}
```

Run: `npx vitest run --pool=threads __tests__/billing/balances.test.ts`
Expected: PASS.

- [ ] **Step 6: Write `lib/billing/live.server.ts`**

```ts
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { parseAgedReceivables, type AgingRow } from '@/lib/billing/aging';
import { todaySg } from '@/lib/billing/view';
import { qbEscape, qboQuery, qboRequest } from '@/lib/qbo/client';
import { invoiceState, type QbInvoice } from '@/lib/qbo/invoice-snapshot';

// Read straight from QuickBooks, never from the stored copy: the figures and
// details a person expects to match QuickBooks exactly (customer profile and
// balance, A/R aging, one invoice in full). Each call is one or two requests.

export type QbAddress = {
  Line1?: string;
  Line2?: string;
  Line3?: string;
  Line4?: string;
  Line5?: string;
  City?: string;
  CountrySubDivisionCode?: string;
  PostalCode?: string;
  Country?: string;
};

/** An address as the lines QuickBooks prints. */
export function addressLines(a?: QbAddress | null): string[] {
  if (!a) return [];
  const lines = [a.Line1, a.Line2, a.Line3, a.Line4, a.Line5]
    .map((l) => l?.trim())
    .filter((l): l is string => !!l);
  const place = [a.City, a.CountrySubDivisionCode, a.PostalCode]
    .map((x) => x?.trim())
    .filter(Boolean)
    .join(' ');
  if (place) lines.push(place);
  if (a.Country?.trim() && !place.includes(a.Country.trim()))
    lines.push(a.Country.trim());
  return lines;
}

const phone = (p?: { FreeFormNumber?: string }) =>
  p?.FreeFormNumber?.trim() || null;

async function refName(
  service: SupabaseClient,
  entity: 'term' | 'paymentmethod',
  ref?: { value: string; name?: string }
): Promise<string | null> {
  if (!ref) return null;
  if (ref.name) return ref.name;
  try {
    const res = await qboRequest<{
      Term?: { Name: string };
      PaymentMethod?: { Name: string };
    }>(service, 'GET', `/${entity}/${encodeURIComponent(ref.value)}`);
    return res.Term?.Name ?? res.PaymentMethod?.Name ?? null;
  } catch {
    return null;
  }
}

export type CustomerProfile = {
  id: string;
  displayName: string;
  givenName: string | null;
  middleName: string | null;
  familyName: string | null;
  companyName: string | null;
  active: boolean;
  createdAt: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  otherPhone: string | null;
  billAddress: string[];
  /** null when QuickBooks has no separate shipping address. */
  shipAddress: string[] | null;
  terms: string | null;
  paymentMethod: string | null;
  deliveryMethod: string | null;
  currency: string | null;
  notes: string | null;
  /** QuickBooks' open balance: owed minus unused credit. */
  balance: number;
};

export async function readCustomerProfile(
  service: SupabaseClient,
  customerId: string
): Promise<CustomerProfile> {
  const { Customer: c } = await qboRequest<{
    Customer: {
      Id: string;
      DisplayName: string;
      GivenName?: string;
      MiddleName?: string;
      FamilyName?: string;
      CompanyName?: string;
      Active?: boolean;
      MetaData?: { CreateTime?: string };
      PrimaryEmailAddr?: { Address?: string };
      PrimaryPhone?: { FreeFormNumber?: string };
      Mobile?: { FreeFormNumber?: string };
      AlternatePhone?: { FreeFormNumber?: string };
      BillAddr?: QbAddress;
      ShipAddr?: QbAddress;
      SalesTermRef?: { value: string; name?: string };
      PaymentMethodRef?: { value: string; name?: string };
      PreferredDeliveryMethod?: string;
      CurrencyRef?: { value: string; name?: string };
      Notes?: string;
      Balance?: number;
    };
  }>(service, 'GET', `/customer/${encodeURIComponent(customerId)}`);
  const [terms, paymentMethod] = await Promise.all([
    refName(service, 'term', c.SalesTermRef),
    refName(service, 'paymentmethod', c.PaymentMethodRef),
  ]);
  const bill = addressLines(c.BillAddr);
  const ship = addressLines(c.ShipAddr);
  return {
    id: c.Id,
    displayName: c.DisplayName,
    givenName: c.GivenName ?? null,
    middleName: c.MiddleName ?? null,
    familyName: c.FamilyName ?? null,
    companyName: c.CompanyName ?? null,
    active: c.Active !== false,
    createdAt: c.MetaData?.CreateTime ?? null,
    email: c.PrimaryEmailAddr?.Address?.trim() || null,
    phone: phone(c.PrimaryPhone),
    mobile: phone(c.Mobile),
    otherPhone: phone(c.AlternatePhone),
    billAddress: bill,
    shipAddress:
      ship.length === 0 || ship.join('|') === bill.join('|') ? null : ship,
    terms,
    paymentMethod,
    deliveryMethod:
      c.PreferredDeliveryMethod && c.PreferredDeliveryMethod !== 'None'
        ? c.PreferredDeliveryMethod
        : null,
    currency: c.CurrencyRef?.name ?? c.CurrencyRef?.value ?? null,
    notes: c.Notes?.trim() || null,
    balance: Number(c.Balance ?? 0),
  };
}

/** QuickBooks' A/R Aging Summary as of today (Singapore), one customer or all. */
export async function readAging(
  service: SupabaseClient,
  opts: { customerId?: string } = {}
): Promise<AgingRow[]> {
  const q = new URLSearchParams({ report_date: todaySg() });
  if (opts.customerId) q.set('customer', opts.customerId);
  const json = await qboRequest<unknown>(
    service,
    'GET',
    `/reports/AgedReceivables?${q.toString()}`
  );
  return parseAgedReceivables(json);
}

export type InvoiceDetailLine = {
  itemName: string | null;
  description: string | null;
  qty: number | null;
  rate: number | null;
  amount: number;
  /** The GST code QuickBooks put on the line, by name when it can be read. */
  taxCode: string | null;
};

export type InvoiceDetail = {
  id: string;
  docNumber: string | null;
  txnDate: string | null;
  dueDate: string | null;
  total: number;
  balance: number;
  subtotal: number;
  tax: number;
  state: 'open' | 'paid' | 'voided';
  lines: InvoiceDetailLine[];
  billAddress: string[];
  billEmail: string | null;
  billEmailCc: string | null;
  emailStatus: string | null;
  delivery: { at: string | null; to: string | null } | null;
  createdAt: string | null;
  updatedAt: string | null;
  customerMemo: string | null;
  privateNote: string | null;
  terms: string | null;
  location: string | null;
  customerId: string;
};

// The US sandbox uses these two pseudo-codes instead of real tax codes.
const US_PSEUDO_CODES: Record<string, string> = {
  TAX: 'Taxable',
  NON: 'No tax',
};

export async function readInvoiceDetail(
  service: SupabaseClient,
  qboInvoiceId: string
): Promise<InvoiceDetail> {
  const { Invoice: inv } = await qboRequest<{
    Invoice: QbInvoice & {
      Line?: Array<{
        Amount?: number;
        Description?: string;
        DetailType?: string;
        SalesItemLineDetail?: {
          ItemRef?: { value: string; name?: string };
          Qty?: number;
          UnitPrice?: number;
          TaxCodeRef?: { value: string };
        };
      }>;
      TxnTaxDetail?: { TotalTax?: number };
      BillAddr?: QbAddress;
      BillEmail?: { Address?: string };
      BillEmailCc?: { Address?: string };
      EmailStatus?: string;
      DeliveryInfo?: { DeliveryType?: string; DeliveryTime?: string };
      MetaData?: { CreateTime?: string; LastUpdatedTime?: string };
      CustomerMemo?: { value?: string };
      SalesTermRef?: { value: string; name?: string };
      DepartmentRef?: { value: string; name?: string };
    };
  }>(service, 'GET', `/invoice/${encodeURIComponent(qboInvoiceId)}`);
  const sales = (inv.Line ?? []).filter(
    (l) => l.DetailType === 'SalesItemLineDetail'
  );
  const codeIds = [
    ...new Set(
      sales
        .map((l) => l.SalesItemLineDetail?.TaxCodeRef?.value)
        .filter((v): v is string => !!v && !(v in US_PSEUDO_CODES))
    ),
  ];
  const codeNames = new Map<string, string>();
  if (codeIds.length) {
    try {
      const codes = await qboQuery<{ Id: string; Name: string }>(
        service,
        'TaxCode',
        `Id IN (${codeIds.map((i) => `'${qbEscape(i)}'`).join(', ')})`
      );
      for (const c of codes) codeNames.set(c.Id, c.Name);
    } catch {
      // Shown by id below; the invoice itself still reads.
    }
  }
  const subtotalLine = (inv.Line ?? []).find(
    (l) => l.DetailType === 'SubTotalLineDetail'
  );
  const lines: InvoiceDetailLine[] = sales.map((l) => {
    const code = l.SalesItemLineDetail?.TaxCodeRef?.value ?? null;
    return {
      itemName: l.SalesItemLineDetail?.ItemRef?.name ?? null,
      description: l.Description?.trim() || null,
      qty: l.SalesItemLineDetail?.Qty ?? null,
      rate: l.SalesItemLineDetail?.UnitPrice ?? null,
      amount: Number(l.Amount ?? 0),
      taxCode: code
        ? (codeNames.get(code) ?? US_PSEUDO_CODES[code] ?? code)
        : null,
    };
  });
  return {
    id: inv.Id,
    docNumber: inv.DocNumber ?? null,
    txnDate: inv.TxnDate ?? null,
    dueDate: inv.DueDate ?? null,
    total: Number(inv.TotalAmt),
    balance: Number(inv.Balance),
    subtotal: Number(
      subtotalLine?.Amount ?? lines.reduce((s, l) => s + l.amount, 0)
    ),
    tax: Number(inv.TxnTaxDetail?.TotalTax ?? 0),
    state: invoiceState(inv),
    lines,
    billAddress: addressLines(inv.BillAddr),
    billEmail: inv.BillEmail?.Address?.trim() || null,
    billEmailCc: inv.BillEmailCc?.Address?.trim() || null,
    emailStatus: inv.EmailStatus ?? null,
    delivery: inv.DeliveryInfo?.DeliveryTime
      ? {
          at: inv.DeliveryInfo.DeliveryTime,
          to: inv.BillEmail?.Address?.trim() || null,
        }
      : null,
    createdAt: inv.MetaData?.CreateTime ?? null,
    updatedAt: inv.MetaData?.LastUpdatedTime ?? null,
    customerMemo: inv.CustomerMemo?.value?.trim() || null,
    privateNote: inv.PrivateNote?.trim() || null,
    terms:
      inv.SalesTermRef?.name ??
      (await refName(service, 'term', inv.SalesTermRef)),
    location: inv.DepartmentRef?.name ?? null,
    customerId: inv.CustomerRef.value,
  };
}
```

- [ ] **Step 7: Write `lib/billing/students.server.ts`**

```ts
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { studentDisplayName } from '@/lib/billing/view';

export type StudentInfo = {
  studentNumber: string;
  name: string;
  level: string | null;
  ayCode: string;
  enroleeNumber: string;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  fatherFullName: string | null;
  motherFullName: string | null;
};

const COLS =
  '"studentNumber","enroleeNumber","lastName","firstName","middleName","enroleeFullName","levelApplied","fatherFullName","motherFullName"';

/**
 * Name, level and newest application of each student number, from the newest
 * academic year that has them. A year with no admissions tables is skipped.
 */
export async function loadStudentInfo(
  service: SupabaseClient,
  studentNumbers: string[]
): Promise<Map<string, StudentInfo>> {
  const out = new Map<string, StudentInfo>();
  const wanted = new Set(studentNumbers.filter(Boolean));
  if (wanted.size === 0) return out;
  const { data: years, error } = await service
    .from('academic_years')
    .select('ay_code')
    .order('ay_code', { ascending: false });
  if (error) throw new Error(`Academic years lookup failed: ${error.message}`);
  for (const { ay_code } of (years ?? []) as Array<{ ay_code: string }>) {
    const left = [...wanted].filter((sn) => !out.has(sn));
    if (left.length === 0) break;
    for (let i = 0; i < left.length; i += 300) {
      const { data, error: appErr } = await service
        .from(`ay${ay_code.slice(2)}_enrolment_applications`)
        .select(COLS)
        .in('studentNumber', left.slice(i, i + 300))
        .order('enroleeNumber', { ascending: false });
      if (appErr) {
        if (
          /PGRST205|42P01|Could not find the table/i.test(
            `${appErr.code ?? ''} ${appErr.message}`
          )
        )
          break;
        throw new Error(
          `${ay_code} applications lookup failed: ${appErr.message}`
        );
      }
      for (const r of (data ?? []) as Array<Record<string, string | null>>) {
        const sn = r.studentNumber;
        if (!sn || out.has(sn)) continue;
        out.set(sn, {
          studentNumber: sn,
          name: studentDisplayName({
            lastName: r.lastName,
            firstName: r.firstName,
            middleName: r.middleName,
            enroleeFullName: r.enroleeFullName,
          }),
          level: r.levelApplied ?? null,
          ayCode: ay_code,
          enroleeNumber: r.enroleeNumber ?? '',
          firstName: r.firstName ?? null,
          middleName: r.middleName ?? null,
          lastName: r.lastName ?? null,
          fatherFullName: r.fatherFullName ?? null,
          motherFullName: r.motherFullName ?? null,
        });
      }
    }
  }
  return out;
}
```

- [ ] **Step 8: Write `scripts/qbo/billing-live-check.ts` and run it**

```ts
/**
 * Reads, from the SANDBOX, everything the Billing pages read live — one
 * linked student's customer profile, the A/R aging (theirs and everyone's),
 * and their newest invoice in full — and prints it. A check, writes nothing.
 *
 *   npx tsx --conditions=react-server --env-file=.env.development.local scripts/qbo/billing-live-check.ts [studentNumber]
 */
import {
  readAging,
  readCustomerProfile,
  readInvoiceDetail,
} from '@/lib/billing/live.server';
import { createServiceClient } from '@/lib/supabase/service';

const service = createServiceClient();

async function main() {
  if (
    !/localhost|127\.0\.0\.1/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
  )
    throw new Error('Refusing: Supabase is not the local stack.');
  const wanted = process.argv[2];
  const q = service
    .from('qbo_customers')
    .select('student_number, qbo_customer_id, display_name')
    .limit(1);
  const { data: links, error } = wanted
    ? await q.eq('student_number', wanted)
    : await q;
  if (error) throw new Error(error.message);
  const link = links?.[0];
  if (!link) throw new Error('No linked student.');
  console.log('Student', link.student_number, link.display_name);
  const profile = await readCustomerProfile(service, link.qbo_customer_id);
  console.log('Profile', profile);
  const mine = await readAging(service, { customerId: link.qbo_customer_id });
  const all = await readAging(service);
  console.log('Aging (theirs)', mine);
  console.log(
    `Aging (all): ${all.length} rows, ${all.filter((r) => r.customerId).length} carry a customer id`
  );
  const { data: inv } = await service
    .from('qbo_invoices')
    .select('qbo_invoice_id, doc_number')
    .eq('qbo_customer_id', link.qbo_customer_id)
    .order('txn_date', { ascending: false })
    .limit(1);
  if (inv?.[0])
    console.log(
      'Invoice',
      await readInvoiceDetail(service, inv[0].qbo_invoice_id)
    );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Run: `npx tsx --conditions=react-server --env-file=.env.development.local scripts/qbo/billing-live-check.ts`
Expected: a profile with email / phone / mobile / billing address (seeded in Task 4.0); `Aging (theirs)` one row or `[]` (nothing owed); `Aging (all): N rows, M carry a customer id`; an invoice with `lines[].taxCode` (`No tax` / `Taxable` in the US sandbox). **Write down M**: if M is 0, the report gives no ids and Task 4.4 matches aging rows by customer name (it does both).

- [ ] **Step 9: tsc, tests, commit**

Run: `npx tsc --noEmit` and `npx vitest run --pool=threads __tests__/billing/ __tests__/qbo/`
Expected: clean, PASS.

```bash
git add supabase/migrations/191_billing_payment_credit.sql supabase/migrations/189_billing_module.sql lib/billing/invoice-row.ts lib/billing/store.server.ts lib/qbo/client.ts lib/billing/live.server.ts lib/billing/students.server.ts lib/billing/balances.ts __tests__/billing/balances.test.ts scripts/qbo/billing-live-check.ts && git commit -m "feat(billing): payment credit stored, live QuickBooks readers (profile, aging, invoice detail)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 4.3: Register the Billing module (sidebar, switcher, route access, layout)

**Files:**

- Modify: `lib/auth/roles.ts`
- Modify: `lib/sidebar/registry.ts`
- Create: `app/(billing)/layout.tsx`
- Test: existing `__tests__/auth/module-visibility.test.ts`, `__tests__/ui/sidebar-icon-coverage.test.ts` and the nav ↔ ROUTE_ACCESS tests under `__tests__/auth/` and `__tests__/ui/`

**Interfaces:**

- Produces: `Module` includes `'billing'`; `NAV_BY_MODULE.billing`; ROUTE_ACCESS rows `/billing/settings` (superadmin) and `/billing` (admissions, school_admin, superadmin); `SIDEBAR_REGISTRY.billing` with `primaryHref: '/billing'`; layout `app/(billing)/layout.tsx` gating the same three roles.

- [ ] **Step 1: `lib/auth/roles.ts`**

Add `| 'billing'` to the `Module` union (after `'classroom'`).

Add, just above the `// SIS admin hub —` comment block:

```ts
// Billing — every QuickBooks invoice and payment of a student's customer;
// QuickBooks is the record for money and the SIS works through it (spec
// docs/superpowers/specs/2026-10-15-billing-module-design.md). Route group
// (billing)/billing/*. Settings is superadmin only: its nav item and its
// ROUTE_ACCESS row say so together, or the link would bounce the others.
const BILLING_NAV: NavSection[] = [
  {
    items: [
      { href: '/billing', label: 'Customers' },
      { href: '/billing/review', label: 'To review' },
      {
        href: '/billing/settings',
        label: 'Settings',
        requiresRoles: ['superadmin'],
      },
    ],
  },
];
```

In the `NAV_BY_MODULE` type add `billing: NavSection[];` (after `classroom: NavSection[];`) and in its value add `billing: BILLING_NAV,` (after `classroom: CLASSROOM_NAV,`).

In `ROUTE_ACCESS`, directly under the `/sis/admin/quickbooks` row, add:

```ts
  // Billing (spec 2026-10-15). Settings is superadmin only and must stay ABOVE
  // the `/billing` row — first match in declaration order wins.
  { prefix: '/billing/settings', allowed: ['superadmin'] },
  {
    prefix: '/billing',
    allowed: ['admissions', 'school_admin', 'superadmin'],
  },
```

- [ ] **Step 2: `lib/sidebar/registry.ts`**

Add `SlidersHorizontal`, `UserSearch`, `Wallet` to the `lucide-react` import (alphabetical, as the list is).

In `MODULE_ORDER`, insert `'billing'` after `'p-files'` (intake → identity → docs → **billing** → classroom …) and update the comment above it to read `// Order shown in the module-switcher popover. Lifecycle: intake → identity → docs → billing → classroom (teaching entry point) → grading → attendance → evaluation → admin config.`

Add to `SIDEBAR_REGISTRY`, after the `classroom` entry:

```ts
  billing: {
    label: 'Billing',
    icon: ReceiptText,
    primaryHref: '/billing',
    fallbackIcon: ReceiptText,
    iconByHref: {
      // Who owes what — the customer list.
      '/billing': Wallet,
      // Students the SIS couldn't match to a QuickBooks customer.
      '/billing/review': UserSearch,
      // Mapping, years, payment accounts, connection.
      '/billing/settings': SlidersHorizontal,
    },
    // No quick action — Customers is already the first row.
    quickActionByRole: {},
  },
```

- [ ] **Step 3: `app/(billing)/layout.tsx`**

```tsx
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getSessionUser } from '@/lib/supabase/server';
import { ModuleSidebar } from '@/components/module-sidebar';
import {
  SIDEBAR_GROUPS_COOKIE,
  expandedGroupsFor,
} from '@/lib/sidebar/group-state';
import { resolveHiddenModules } from '@/lib/sidebar/resolve-hidden-modules';
import { FeedbackSheet } from '@/components/feedback-sheet';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { AyBanner } from '@/components/sis/ay-banner';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { getSidebarChangeRequestCount } from '@/lib/change-requests/sidebar-counts';
import {
  getDeclarationWaitingCount,
  getStagedWaitingCount,
} from '@/lib/sidebar/notification-counts';
import { GRADE_CHANGE_FLOWS } from '@/lib/change-requests/staged-flows';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

// Cache Components (next.config.ts) requires each segment to prerender into a
// static shell or declare that it blocks. This layout reads cookies() to gate on
// the session (KD #35), so it legitimately blocks.
export const instant = false;

// Billing — the same three roles that invoice (lib/qbo/roles.ts). The
// `/billing` ROUTE_ACCESS row lets the same set through the proxy.
export default async function BillingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const view = await getSessionUser();
  if (!view) redirect('/login');

  const { id, email, role, roles } = view;
  if (!role || !(QBO_INVOICE_ROLES as readonly string[]).includes(role)) {
    if (!role) redirect('/login');
    redirect('/');
  }

  const capabilities = await getCapabilitiesForRole(role);

  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get('sidebar:state')?.value !== 'false';
  const expandedGroups = expandedGroupsFor(
    cookieStore.get(SIDEBAR_GROUPS_COOKIE)?.value,
    'billing'
  );

  const service = createServiceClient();
  const [changeRequestCount, declarationCount, gradeChangeStepCount] =
    await Promise.all([
      getSidebarChangeRequestCount(service, role, id),
      getDeclarationWaitingCount(service, role, id),
      getStagedWaitingCount(service, role, id, GRADE_CHANGE_FLOWS),
    ]);

  const hiddenModules = await resolveHiddenModules(role, id);

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <ModuleSidebar
        module="billing"
        role={role}
        email={email}
        userId={id}
        hiddenModules={hiddenModules}
        capabilities={capabilities}
        expandedGroups={expandedGroups}
        roles={roles}
      />
      <SidebarInset>
        <AyBanner />
        <header className="sticky top-0 z-50 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md">
          <div className="flex items-center w-full mx-auto max-w-[1440px]">
            <SidebarTrigger className="-ml-1" />
            <div className="ml-auto flex items-center gap-2">
              <FeedbackSheet />
              <NotificationBell
                role={role}
                userId={id}
                initialCount={changeRequestCount}
                initialDeclarationCount={declarationCount}
                initialGradeChangeStepCount={gradeChangeStepCount}
              />
            </div>
          </div>
        </header>
        <div className="flex-1 bg-muted px-6 py-8 md:px-10 md:py-10">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
```

- [ ] **Step 4: tsc and the nav tests**

Run: `npx tsc --noEmit`
Expected: clean. If tsc reports a `Record<Module, …>` / exhaustive `switch` missing `'billing'` anywhere (e.g. `lib/account/shortcuts.ts`, `lib/sis/command-palette-nav.ts`, `lib/sidebar/module-visibility.ts`), add a `billing` entry modelled on that file's `classroom` entry (Billing has no quick action and no teacher visibility) and re-run.

Run: `npx vitest run --pool=threads __tests__/auth __tests__/ui __tests__/account`
Expected: PASS. If `module-visibility.test.ts` lists the office modules a teacher is refused and fails only because `billing` is now one, add `'billing'` to that test's list of office modules (a teacher is refused Billing — that is the intent).

- [ ] **Step 5: Commit**

```bash
git add lib/auth/roles.ts lib/sidebar/registry.ts "app/(billing)/layout.tsx" && git commit -m "feat(billing): Billing module in the switcher and sidebar, route access, layout

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(Add any file Step 4 had to touch to the same `git add`.)

### Task 4.4: Customers page (`/billing`)

**Files:**

- Create: `lib/billing/customers.server.ts`
- Create: `components/billing/invoice-status-badge.tsx`
- Create: `components/billing/refresh-button.tsx`
- Create: `components/billing/not-connected-panel.tsx`
- Create: `components/billing/customers-table.tsx`
- Create: `app/(billing)/billing/page.tsx`
- Create: `app/(billing)/billing/loading.tsx`

**Interfaces:**

- Consumes: `readAging` (Task 4.2), `loadStudentInfo` (Task 4.2), `round2`, `todaySg`, `formatDay`, `INVOICE_STATUS_LABEL`, `InvoiceStatus` (Task 4.1), `formatSgd`, `connectedRealmId`, `qboErrorMessage`, `fetchAllPages`, `getCurrentAcademicYear`, `MetricCard`, `DataTable`, `SortableHeader`, `IdentifierLink`, `PageShell`.
- Produces: `type CustomerListRow`, `type CustomersList`, `loadCustomersList(service): Promise<CustomersList>`; `<InvoiceStatusBadge status />` (used by Tasks 4.7, 4.8); `<RefreshButton label? />` (re-reads the page — every Billing page reads QuickBooks on load); `<NotConnectedPanel canConnect />`.

- [ ] **Step 1: Write `lib/billing/customers.server.ts`**

```ts
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { getCurrentAcademicYear } from '@/lib/academic-year';
import { readAging } from '@/lib/billing/live.server';
import { loadStudentInfo } from '@/lib/billing/students.server';
import { round2, todaySg } from '@/lib/billing/view';
import { connectedRealmId, qboErrorMessage } from '@/lib/qbo/client';
import { fetchAllPages } from '@/lib/supabase/paginate';

export type CustomerListRow = {
  studentNumber: string;
  name: string;
  level: string | null;
  customerId: string;
  customerName: string;
  openBalance: number;
  overdue: number;
  lastPayment: string | null;
  lastInvoice: string | null;
};

export type CustomersList = {
  connected: boolean;
  rows: CustomerListRow[];
  /** 'quickbooks' = Open balance and Overdue are QuickBooks' A/R aging, read now. */
  balancesFrom: 'quickbooks' | 'stored';
  balanceError: string | null;
  totals: {
    linked: number;
    openBalance: number;
    owing: number;
    overdue: number;
    overdueCount: number;
    paidThisMonth: number;
    paymentsThisMonth: number;
  };
  reviewCount: number;
  currentAy: string | null;
  /** Students in the current AY, and how many of them are linked. */
  currentAyStudents: number;
  currentAyLinked: number;
};

type Page<T> = PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
}>;

export async function loadCustomersList(
  service: SupabaseClient
): Promise<CustomersList> {
  const empty: CustomersList = {
    connected: false,
    rows: [],
    balancesFrom: 'stored',
    balanceError: null,
    totals: {
      linked: 0,
      openBalance: 0,
      owing: 0,
      overdue: 0,
      overdueCount: 0,
      paidThisMonth: 0,
      paymentsThisMonth: 0,
    },
    reviewCount: 0,
    currentAy: null,
    currentAyStudents: 0,
    currentAyLinked: 0,
  };
  const realmId = await connectedRealmId(service);
  if (!realmId) return empty;

  type Link = {
    student_number: string;
    qbo_customer_id: string;
    display_name: string;
  };
  type Inv = {
    id: string;
    student_number: string;
    qbo_customer_id: string | null;
    state: 'open' | 'paid' | 'voided';
    balance: number;
    due_date: string | null;
    txn_date: string | null;
  };
  type Pay = {
    qbo_payment_id: string;
    student_number: string;
    qbo_customer_id: string;
    txn_date: string | null;
    total: number;
  };
  const [links, invoices, payments, review, currentAy] = await Promise.all([
    fetchAllPages<Link>(
      (from, to) =>
        service
          .from('qbo_customers')
          .select('student_number, qbo_customer_id, display_name')
          .eq('realm_id', realmId)
          .range(from, to) as unknown as Page<Link>,
      1000,
      { tieBreak: 'student_number' }
    ),
    fetchAllPages<Inv>(
      (from, to) =>
        service
          .from('qbo_invoices')
          .select(
            'id, student_number, qbo_customer_id, state, balance, due_date, txn_date'
          )
          .eq('realm_id', realmId)
          .range(from, to) as unknown as Page<Inv>,
      1000,
      { tieBreak: 'id' }
    ),
    fetchAllPages<Pay>(
      (from, to) =>
        service
          .from('qbo_payments')
          .select(
            'qbo_payment_id, student_number, qbo_customer_id, txn_date, total'
          )
          .eq('realm_id', realmId)
          .range(from, to) as unknown as Page<Pay>,
      1000,
      { tieBreak: 'qbo_payment_id' }
    ),
    service
      .from('billing_link_review')
      .select('student_number', { count: 'exact', head: true }),
    getCurrentAcademicYear(),
  ]);

  const today = todaySg();
  const monthStart = `${today.slice(0, 7)}-01`;
  const customerOf = new Map(
    links.map((l) => [l.student_number, l.qbo_customer_id])
  );
  // Only the invoices and payments of the student's CURRENT customer count.
  const mine = <
    T extends { student_number: string; qbo_customer_id: string | null },
  >(
    r: T
  ) => customerOf.get(r.student_number) === r.qbo_customer_id;

  const stored = new Map<
    string,
    {
      owed: number;
      overdue: number;
      lastInvoice: string | null;
      lastPayment: string | null;
    }
  >();
  const at = (sn: string) => {
    let s = stored.get(sn);
    if (!s) {
      s = { owed: 0, overdue: 0, lastInvoice: null, lastPayment: null };
      stored.set(sn, s);
    }
    return s;
  };
  for (const r of invoices) {
    if (!mine(r) || r.state === 'voided') continue;
    const s = at(r.student_number);
    const bal = Number(r.balance);
    if (bal > 0) {
      s.owed += bal;
      if (r.due_date && r.due_date.slice(0, 10) < today) s.overdue += bal;
    }
    const d = r.txn_date?.slice(0, 10) ?? null;
    if (d && (!s.lastInvoice || d > s.lastInvoice)) s.lastInvoice = d;
  }
  let paidThisMonth = 0;
  let paymentsThisMonth = 0;
  for (const p of payments) {
    if (!mine(p)) continue;
    const s = at(p.student_number);
    const d = p.txn_date?.slice(0, 10) ?? null;
    if (d && (!s.lastPayment || d > s.lastPayment)) s.lastPayment = d;
    if (d && d >= monthStart) {
      paidThisMonth += Number(p.total);
      paymentsThisMonth += 1;
    }
  }

  // QuickBooks' own figures when it answers; the stored sums when it doesn't.
  let byId: Map<string, { total: number; overdue: number }> | null = null;
  let byName: Map<string, { total: number; overdue: number }> | null = null;
  let balanceError: string | null = null;
  try {
    const aging = await readAging(service);
    byId = new Map();
    byName = new Map();
    for (const a of aging) {
      if (a.customerId) byId.set(a.customerId, a);
      byName.set(a.name.toUpperCase(), a);
    }
  } catch (e) {
    balanceError = qboErrorMessage(e);
  }

  const info = await loadStudentInfo(
    service,
    links.map((l) => l.student_number)
  );
  const rows: CustomerListRow[] = links.map((l) => {
    const s = stored.get(l.student_number);
    const a = byId
      ? (byId.get(l.qbo_customer_id) ??
        byName!.get(l.display_name.toUpperCase()))
      : undefined;
    const student = info.get(l.student_number);
    return {
      studentNumber: l.student_number,
      name: student?.name ?? l.display_name,
      level: student?.level ?? null,
      customerId: l.qbo_customer_id,
      customerName: l.display_name,
      openBalance: round2(byId ? (a?.total ?? 0) : (s?.owed ?? 0)),
      overdue: round2(byId ? (a?.overdue ?? 0) : (s?.overdue ?? 0)),
      lastPayment: s?.lastPayment ?? null,
      lastInvoice: s?.lastInvoice ?? null,
    };
  });

  let currentAyStudents = 0;
  let currentAyLinked = 0;
  if (currentAy) {
    type App = { studentNumber: string | null; enroleeNumber: string };
    const apps = await fetchAllPages<App>(
      (from, to) =>
        service
          .from(`ay${currentAy.ay_code.slice(2)}_enrolment_applications`)
          .select('"studentNumber","enroleeNumber"')
          .not('studentNumber', 'is', null)
          .range(from, to) as unknown as Page<App>,
      1000,
      { tieBreak: 'enroleeNumber' }
    ).catch(() => [] as App[]);
    const numbers = new Set(apps.map((a) => a.studentNumber!).filter(Boolean));
    currentAyStudents = numbers.size;
    currentAyLinked = links.filter((l) => numbers.has(l.student_number)).length;
  }

  return {
    connected: true,
    rows,
    balancesFrom: byId ? 'quickbooks' : 'stored',
    balanceError,
    totals: {
      linked: links.length,
      openBalance: round2(
        rows.reduce((t, r) => t + Math.max(0, r.openBalance), 0)
      ),
      owing: rows.filter((r) => r.openBalance > 0).length,
      overdue: round2(rows.reduce((t, r) => t + r.overdue, 0)),
      overdueCount: rows.filter((r) => r.overdue > 0).length,
      paidThisMonth: round2(paidThisMonth),
      paymentsThisMonth,
    },
    reviewCount: review.count ?? 0,
    currentAy: currentAy?.ay_code ?? null,
    currentAyStudents,
    currentAyLinked,
  };
}
```

- [ ] **Step 2: Shared small components**

`components/billing/invoice-status-badge.tsx`:

```tsx
import { Badge } from '@/components/ui/badge';
import { INVOICE_STATUS_LABEL, type InvoiceStatus } from '@/lib/billing/view';
import { cn } from '@/lib/utils';

// §9.3 recipes: mint = paid, destructive = overdue / voided, amber = part
// paid, secondary = open (informational).
const TONE: Record<Exclude<InvoiceStatus, 'open'>, string> = {
  paid: 'border-brand-mint bg-brand-mint/30 text-ink',
  overdue: 'border-destructive/40 bg-destructive/10 text-destructive',
  voided:
    'border-destructive/40 bg-destructive/10 text-destructive line-through',
  part: 'border-brand-amber/40 bg-brand-amber/10 text-ink',
};

export function InvoiceStatusBadge({
  status,
  className,
}: {
  status: InvoiceStatus;
  className?: string;
}) {
  if (status === 'open')
    return (
      <Badge variant="secondary" className={cn('h-6', className)}>
        {INVOICE_STATUS_LABEL.open}
      </Badge>
    );
  return (
    <Badge variant="outline" className={cn('h-6', TONE[status], className)}>
      {INVOICE_STATUS_LABEL[status]}
    </Badge>
  );
}
```

`components/billing/refresh-button.tsx`:

```tsx
'use client';

import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';

// Every Billing page reads QuickBooks when it loads, so refreshing is simply
// loading the page again.
export function RefreshButton({
  label = 'Refresh from QuickBooks',
}: {
  label?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      loading={pending}
      loadingText="Reading QuickBooks…"
      onClick={() => start(() => router.refresh())}
    >
      <RefreshCw className="size-4" />
      {label}
    </Button>
  );
}
```

`components/billing/not-connected-panel.tsx`:

```tsx
import { Unplug } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';

// §9.4 status panel. Shown on every Billing page while QuickBooks is not
// connected; only a superadmin can connect it.
export function NotConnectedPanel({ canConnect }: { canConnect: boolean }) {
  return (
    <div className="flex items-start gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground shadow-brand-tile">
        <Unplug className="size-4" />
      </div>
      <div className="flex-1 space-y-1.5">
        <p className="font-serif text-base font-semibold text-foreground">
          QuickBooks is not connected
        </p>
        <p className="text-sm text-muted-foreground">
          Billing shows what QuickBooks holds, so there is nothing to show until
          it is connected.
          {canConnect ? '' : ' Ask a superadmin to connect it.'}
        </p>
        {canConnect && (
          <Button asChild variant="outline" size="sm" className="mt-2">
            <Link href="/billing/settings">Open Billing settings</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `components/billing/customers-table.tsx`**

```tsx
'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Wallet } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { DataTableEmptyState } from '@/components/ui/data-table/empty-state';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { IdentifierLink } from '@/components/ui/identifier-link';
import type { CustomerListRow } from '@/lib/billing/customers.server';
import { formatDay } from '@/lib/billing/view';
import { formatSgd } from '@/lib/qbo/format';
import { cn } from '@/lib/utils';

const yesNo = (b: boolean) => (b ? 'Yes' : 'No');

const columns: ColumnDef<CustomerListRow, unknown>[] = [
  {
    id: 'student',
    accessorFn: (r) => r.name,
    header: ({ column }) => (
      <SortableHeader column={column}>Student</SortableHeader>
    ),
    meta: { label: 'Student' },
    cell: ({ row }) => (
      <div className="space-y-0.5">
        <IdentifierLink
          href={`/billing/${encodeURIComponent(row.original.studentNumber)}`}
        >
          {row.original.name}
        </IdentifierLink>
        <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {row.original.studentNumber}
        </div>
      </div>
    ),
    enableHiding: false,
  },
  {
    id: 'customer',
    accessorFn: (r) => r.customerName,
    header: ({ column }) => (
      <SortableHeader column={column}>QuickBooks customer</SortableHeader>
    ),
    meta: { label: 'QuickBooks customer' },
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {row.original.customerName}
      </span>
    ),
  },
  {
    id: 'level',
    accessorFn: (r) => r.level ?? 'No level',
    header: ({ column }) => (
      <SortableHeader column={column}>Level</SortableHeader>
    ),
    meta: { label: 'Level' },
  },
  {
    id: 'openBalance',
    accessorFn: (r) => r.openBalance,
    header: ({ column }) => (
      <div className="flex justify-end">
        <SortableHeader column={column} align="right">
          Open balance
        </SortableHeader>
      </div>
    ),
    meta: { label: 'Open balance' },
    cell: ({ row }) => (
      <div className="text-right tabular-nums text-foreground">
        {formatSgd(row.original.openBalance)}
      </div>
    ),
  },
  {
    id: 'overdue',
    accessorFn: (r) => r.overdue,
    header: ({ column }) => (
      <div className="flex justify-end">
        <SortableHeader column={column} align="right">
          Overdue
        </SortableHeader>
      </div>
    ),
    meta: { label: 'Overdue' },
    cell: ({ row }) => (
      <div
        className={cn(
          'text-right tabular-nums',
          row.original.overdue > 0
            ? 'font-semibold text-destructive'
            : 'text-muted-foreground'
        )}
      >
        {formatSgd(row.original.overdue)}
      </div>
    ),
  },
  {
    id: 'lastPayment',
    accessorFn: (r) => r.lastPayment ?? '',
    header: ({ column }) => (
      <SortableHeader column={column}>Last payment</SortableHeader>
    ),
    meta: { label: 'Last payment' },
    cell: ({ row }) => (
      <span className="tabular-nums text-sm">
        {formatDay(row.original.lastPayment)}
      </span>
    ),
  },
  {
    id: 'lastInvoice',
    accessorFn: (r) => r.lastInvoice ?? '',
    header: ({ column }) => (
      <SortableHeader column={column}>Last invoice</SortableHeader>
    ),
    meta: { label: 'Last invoice' },
    cell: ({ row }) => (
      <span className="tabular-nums text-sm">
        {formatDay(row.original.lastInvoice)}
      </span>
    ),
  },
  // Filter-only helpers, hidden until switched on from Columns.
  {
    id: 'hasBalance',
    accessorFn: (r) => yesNo(r.openBalance > 0),
    header: 'Has a balance',
    meta: { label: 'Has a balance' },
    enableSorting: false,
  },
  {
    id: 'isOverdue',
    accessorFn: (r) => yesNo(r.overdue > 0),
    header: 'Overdue now',
    meta: { label: 'Overdue now' },
    enableSorting: false,
  },
];

export function CustomersTable({ rows }: { rows: CustomerListRow[] }) {
  const facets = React.useMemo(
    () => [
      {
        columnId: 'level',
        label: 'Level',
        valueOptions: [
          ...new Set(rows.map((r) => r.level ?? 'No level')),
        ].sort(),
      },
      {
        columnId: 'hasBalance',
        label: 'Has a balance',
        valueOptions: ['Yes', 'No'],
      },
      { columnId: 'isOverdue', label: 'Overdue', valueOptions: ['Yes', 'No'] },
    ],
    [rows]
  );
  if (rows.length === 0)
    return (
      <Card className="py-0">
        <DataTableEmptyState
          icon={Wallet}
          title="No students linked yet"
          body="Students appear here once they are linked to their QuickBooks customer. A superadmin runs Link students from Billing settings; anyone the SIS can't match goes to To review."
        />
      </Card>
    );
  return (
    <DataTable<CustomerListRow>
      data={rows}
      columns={columns}
      getRowId={(r) => r.studentNumber}
      searchKeys={[
        (r) => r.name,
        (r) => r.studentNumber,
        (r) => r.customerName,
      ]}
      searchPlaceholder="Search name or student number"
      facets={facets}
      statusTabs={[
        { value: 'all', label: 'All', predicate: () => true, isDefault: true },
        { value: 'owing', label: 'Owing', predicate: (r) => r.openBalance > 0 },
        { value: 'overdue', label: 'Overdue', predicate: (r) => r.overdue > 0 },
      ]}
      initialColumnVisibility={{ hasBalance: false, isOverdue: false }}
      initialSort={[{ id: 'overdue', desc: true }]}
      url={{ enabled: true, namespace: 'billing-customers' }}
      pageSize={25}
      csv={{ filename: 'billing-customers.csv' }}
      emptyFilteredState={{
        title: 'No students match.',
        body: 'Clear the search or a filter to see more students.',
      }}
    />
  );
}
```

- [ ] **Step 4: `app/(billing)/billing/page.tsx`**

```tsx
import { AlertTriangle, CalendarClock, Users, Wallet } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { CustomersTable } from '@/components/billing/customers-table';
import { NotConnectedPanel } from '@/components/billing/not-connected-panel';
import { RefreshButton } from '@/components/billing/refresh-button';
import { MetricCard } from '@/components/dashboard/metric-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageShell } from '@/components/ui/page-shell';
import { loadCustomersList } from '@/lib/billing/customers.server';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { formatSgd } from '@/lib/qbo/format';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Billing → Customers. Every linked student with what they owe. Open balance
// and Overdue are QuickBooks' own A/R aging, read when the page loads.
export default async function BillingCustomersPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!canInvoiceInQbo(sessionUser.role)) redirect('/');

  const list = await loadCustomersList(createServiceClient());

  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Billing · QuickBooks
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Customers.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Every student linked to their QuickBooks customer, with what they
            owe. Open a student to see all their invoices and payments.
          </p>
        </div>
        {list.connected && (
          <div className="flex flex-wrap items-center gap-2">
            <RefreshButton />
            <Button asChild variant="outline">
              <Link href="/billing/review">
                To review
                {list.reviewCount > 0 && (
                  <Badge variant="secondary" className="h-5 tabular-nums">
                    {list.reviewCount}
                  </Badge>
                )}
              </Link>
            </Button>
          </div>
        )}
      </header>

      {!list.connected ? (
        <NotConnectedPanel canConnect={sessionUser.role === 'superadmin'} />
      ) : (
        <>
          {list.balanceError && (
            <div className="flex items-start gap-4 rounded-xl border border-brand-amber/40 bg-brand-amber/10 p-5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-amber to-brand-amber/80 text-ink shadow-brand-tile">
                <AlertTriangle className="size-4" />
              </div>
              <div className="flex-1 space-y-1.5">
                <p className="font-serif text-base font-semibold text-foreground">
                  Balances as last read
                </p>
                <p className="text-sm text-muted-foreground">
                  {list.balanceError} The open balances and overdue amounts
                  below are added up from the invoices the SIS last read.
                </p>
              </div>
            </div>
          )}

          <div className="@container/main">
            <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @3xl/main:grid-cols-4">
              <MetricCard
                label="Linked students"
                value={list.totals.linked.toLocaleString('en-SG')}
                icon={Users}
                subtext={
                  list.currentAy
                    ? `${list.currentAyLinked.toLocaleString('en-SG')} of ${list.currentAyStudents.toLocaleString('en-SG')} in ${list.currentAy}`
                    : undefined
                }
              />
              <MetricCard
                label="Open balance"
                value={formatSgd(list.totals.openBalance)}
                icon={Wallet}
                subtext={`across ${list.totals.owing.toLocaleString('en-SG')} students`}
              />
              <MetricCard
                label="Overdue"
                value={formatSgd(list.totals.overdue)}
                icon={AlertTriangle}
                intent={list.totals.overdue > 0 ? 'bad' : 'default'}
                subtext={`${list.totals.overdueCount.toLocaleString('en-SG')} students past the due date`}
              />
              <MetricCard
                label="Paid this month"
                value={formatSgd(list.totals.paidThisMonth)}
                icon={CalendarClock}
                subtext={`${list.totals.paymentsThisMonth.toLocaleString('en-SG')} payments`}
              />
            </div>
          </div>

          <CustomersTable rows={list.rows} />

          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {list.balancesFrom === 'quickbooks'
              ? 'Balances read from QuickBooks just now'
              : 'Balances added up from the last QuickBooks read'}{' '}
            · Changes in QuickBooks arrive within the hour · Every action is in
            the audit log
          </p>
        </>
      )}
    </PageShell>
  );
}
```

- [ ] **Step 5: `app/(billing)/billing/loading.tsx`**

```tsx
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SkeletonCards,
  SkeletonTable,
  SkeletonText,
} from '@/components/ui/skeleton-layouts';

/** Mirrors `app/(billing)/billing/page.tsx` — header, four stat cards, the table. */
export default function Loading() {
  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-40" />
          <SkeletonText variant="headline" className="w-64 max-w-full" />
          <SkeletonText variant="body" className="w-120 max-w-full" />
        </div>
        <Skeleton className="h-9 w-56" />
      </header>
      <div className="@container/main">
        <SkeletonCards
          count={4}
          grid="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @3xl/main:grid-cols-4"
        />
      </div>
      <SkeletonTable columns={7} rows={10} />
    </PageShell>
  );
}
```

- [ ] **Step 6: tsc, label test, look at it**

Run: `npx tsc --noEmit` and `npx vitest run --pool=threads __tests__/ui/data-table-column-label-coverage.test.ts`
Expected: clean, PASS.

Restart `npm run dev` (new route group), sign in on the local stack as superadmin, open `http://localhost:3000/billing`. Expected: four stat cards; the table lists the seeded linked students with Open balance / Overdue; the trust line says "Balances read from QuickBooks just now". The Billing module is in the module switcher; the sidebar shows Customers, To review, Settings.

- [ ] **Step 7: Commit**

```bash
git add lib/billing/customers.server.ts components/billing/invoice-status-badge.tsx components/billing/refresh-button.tsx components/billing/not-connected-panel.tsx components/billing/customers-table.tsx "app/(billing)/billing/page.tsx" "app/(billing)/billing/loading.tsx" && git commit -m "feat(billing): Customers page — linked students, QuickBooks open balance and overdue

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 4.5: Create invoice and Send, from the customer page

**Files:**

- Create: `lib/billing/invoice-create.server.ts`
- Create: `lib/billing/invoice-send.server.ts`
- Create: `app/api/billing/students/[studentNumber]/invoices/route.ts`
- Create: `app/api/billing/invoices/[invoiceId]/send/route.ts`
- Modify: `app/api/quickbooks/items/route.ts` (return each item's income account)
- Modify: `lib/audit/log-action.ts`, `lib/audit/humanize.ts`, `app/(admissions)/admissions/audit-log/page.tsx` (`qbo.invoice.send`)
- Create: `components/billing/create-invoice-sheet.tsx`
- Create: `components/billing/send-invoice-button.tsx`

**Interfaces:**

- Consumes: `buildInvoiceLines`, `createdButNotSaved` (`lib/qbo/invoice-actions.ts`); `upsertInvoice` (`lib/billing/store.server.ts`); `loadBillingMaps` (`lib/billing/settings.server.ts`); `syncTilesForStudent` (`lib/billing/tiles.server.ts`); `qboRequest(…, opts)` (Task 4.2); `duplicateTileWarning`, `mapsFromData`, `MapsData`, `todaySg` (Task 4.1); `QbInvoiceFull` (`lib/billing/invoice-row.ts`).
- Produces:
  - `createInvoiceForStudent(service, args: { studentNumber: string; actor: { id: string; email: string | null; role: string }; input: CreateInvoiceInput }): Promise<CreateInvoiceResult>` where `CreateInvoiceInput = { lines: Array<{ itemId: string; description?: string; qty: number; unitPrice: number }>; txnDate: string; dueDate: string | null; memo?: string; docNumber?: string; send: boolean }` and `CreateInvoiceResult = { ok: true; qboInvoiceId: string; docNumber: string | null; sentTo: string | null; warnings: string[] } | { ok: false; status: number; error: string }`.
  - `sendInvoice(service, args: { qboInvoiceId: string; sendTo?: string | null; actor }): Promise<{ sentTo: string | null }>` — throws `QboError` / `Error` with a staff sentence.
  - `POST /api/billing/students/[studentNumber]/invoices` (QBO_INVOICE_ROLES), body = `CreateInvoiceInput`, 200 `{ ok, qboInvoiceId, docNumber, sentTo, warnings }`.
  - `POST /api/billing/invoices/[invoiceId]/send` (QBO_INVOICE_ROLES), body `{ sendTo?: string }`, 200 `{ ok, sentTo }`.
  - `GET /api/quickbooks/items` items gain `accountId: string | null`.
  - `<CreateInvoiceSheet open onOpenChange studentNumber studentName customerEmail maps existing />`, `<SendInvoiceButton qboInvoiceId label sendTo />`.

- [ ] **Step 1: Register `qbo.invoice.send`**

In `lib/audit/log-action.ts` `ALL_AUDIT_ACTIONS`, after `'qbo.invoice.link',` add `'qbo.invoice.send',`.

In `lib/audit/humanize.ts` `ACTION_LABELS`, after `'qbo.invoice.link': 'QuickBooks invoice linked',` add `'qbo.invoice.send': 'QuickBooks invoice emailed',`. In the context switch, add before `case 'qbo.customer.create':`

```ts
    case 'qbo.invoice.send':
      return joinParts(
        [str(ctx.doc_number) ? `invoice ${str(ctx.doc_number)}` : '', str(ctx.sent_to)].filter(Boolean)
      );
```

In `app/(admissions)/admissions/audit-log/page.tsx`, add `'qbo.invoice.send',` after `'qbo.invoice.link',`.

Run: `npx vitest run --pool=threads __tests__/audit`
Expected: PASS (the coverage tests require every action to have a label and a context case — fix any they name).

- [ ] **Step 2: Items carry their income account**

In `app/api/quickbooks/items/route.ts`, add `IncomeAccountRef?: { value: string };` to the queried item type and `accountId: i.IncomeAccountRef?.value ?? null,` to each mapped item. Update the route comment: `// …for the Create invoice drawer, with each item's income account so the drawer can warn when the invoice would land on a tile that's already billed.`

- [ ] **Step 3: `lib/billing/invoice-send.server.ts`**

```ts
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { logAction } from '@/lib/audit/log-action';
import { qboRequest } from '@/lib/qbo/client';

/**
 * Email an invoice to the parents through QuickBooks (always the QuickBooks
 * API, Mr Ace 2026-10-16). Without `sendTo`, QuickBooks uses the invoice's
 * billing email. QuickBooks records the delivery on the invoice; the SIS
 * records who sent it.
 */
export async function sendInvoice(
  service: SupabaseClient,
  args: {
    qboInvoiceId: string;
    sendTo?: string | null;
    actor: { id: string; email: string | null; role: string };
  }
): Promise<{ sentTo: string | null }> {
  const to = args.sendTo?.trim() || null;
  const path = `/invoice/${encodeURIComponent(args.qboInvoiceId)}/send${to ? `?sendTo=${encodeURIComponent(to)}` : ''}`;
  const { Invoice } = await qboRequest<{
    Invoice: {
      Id: string;
      DocNumber?: string;
      BillEmail?: { Address?: string };
    };
  }>(service, 'POST', path, undefined, {
    contentType: 'application/octet-stream',
  });
  const sentTo = to ?? Invoice.BillEmail?.Address ?? null;
  await logAction({
    service,
    actor: args.actor,
    action: 'qbo.invoice.send',
    entityType: 'qbo_invoice',
    entityId: Invoice.Id,
    context: { doc_number: Invoice.DocNumber ?? null, sent_to: sentTo },
  });
  return { sentTo };
}
```

- [ ] **Step 4: `lib/billing/invoice-create.server.ts`**

```ts
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { logAction } from '@/lib/audit/log-action';
import type { QbInvoiceFull } from '@/lib/billing/invoice-row';
import { sendInvoice } from '@/lib/billing/invoice-send.server';
import { loadBillingMaps } from '@/lib/billing/settings.server';
import { upsertInvoice } from '@/lib/billing/store.server';
import { syncTilesForStudent } from '@/lib/billing/tiles.server';
import {
  connectedRealmId,
  qbEscape,
  QboError,
  qboErrorMessage,
  qboQuery,
  qboRequest,
  QboNotConnectedError,
} from '@/lib/qbo/client';
import {
  buildInvoiceLines,
  createdButNotSaved,
} from '@/lib/qbo/invoice-actions';

export type CreateInvoiceInput = {
  lines: Array<{
    itemId: string;
    description?: string;
    qty: number;
    unitPrice: number;
  }>;
  txnDate: string;
  dueDate: string | null;
  memo?: string;
  docNumber?: string;
  send: boolean;
};

export type CreateInvoiceResult =
  | {
      ok: true;
      qboInvoiceId: string;
      docNumber: string | null;
      sentTo: string | null;
      warnings: string[];
    }
  | { ok: false; status: number; error: string };

/**
 * Create Invoice from the customer page (spec "Drawers"). QuickBooks FIRST;
 * the SIS stores the invoice and recomputes the student's tiles only once
 * QuickBooks has it. The customer is always the student's linked one.
 */
export async function createInvoiceForStudent(
  service: SupabaseClient,
  args: {
    studentNumber: string;
    actor: { id: string; email: string | null; role: string };
    input: CreateInvoiceInput;
  }
): Promise<CreateInvoiceResult> {
  const { studentNumber, actor, input } = args;
  let realmId: string;
  let customer: { id: string; name: string; email: string | null };
  let invoice: QbInvoiceFull;
  try {
    const r = await connectedRealmId(service);
    if (!r) throw new QboNotConnectedError();
    realmId = r;
    const { data: link, error } = await service
      .from('qbo_customers')
      .select('qbo_customer_id, display_name')
      .eq('student_number', studentNumber)
      .eq('realm_id', realmId)
      .maybeSingle();
    if (error) return { ok: false, status: 500, error: error.message };
    if (!link)
      return {
        ok: false,
        status: 422,
        error:
          'This student is not linked to a QuickBooks customer yet. Link them from To review first.',
      };
    const { Customer } = await qboRequest<{
      Customer: {
        Id: string;
        DisplayName: string;
        PrimaryEmailAddr?: { Address?: string };
      };
    }>(service, 'GET', `/customer/${encodeURIComponent(link.qbo_customer_id)}`);
    customer = {
      id: Customer.Id,
      name: Customer.DisplayName,
      email: Customer.PrimaryEmailAddr?.Address?.trim() || null,
    };
    if (input.send && !customer.email)
      return {
        ok: false,
        status: 422,
        error: `${customer.name} has no email in QuickBooks, so the invoice can't be emailed. Untick "Email it now", or add the email in QuickBooks first.`,
      };

    const docNumber = input.docNumber?.trim() || null;
    if (docNumber) {
      // QuickBooks' API accepts a repeated number, so check first.
      const taken = await qboQuery<{ Id: string }>(
        service,
        'Invoice',
        `DocNumber = '${qbEscape(docNumber)}'`,
        'maxresults 1'
      );
      if (taken.length > 0)
        return {
          ok: false,
          status: 409,
          error: `Invoice ${docNumber} already exists in QuickBooks. Type a different number, or leave it blank.`,
        };
    }
    const ids = [...new Set(input.lines.map((l) => l.itemId))];
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
      input.lines,
      new Map(items.map((i) => [i.Id, i]))
    );
    const { data: who } = await service.auth.admin.getUserById(actor.id);
    const staffName =
      (who?.user?.user_metadata?.full_name as string | undefined) ??
      actor.email ??
      'staff';
    invoice = (
      await qboRequest<{ Invoice: QbInvoiceFull }>(
        service,
        'POST',
        '/invoice',
        {
          CustomerRef: { value: customer.id },
          TxnDate: input.txnDate,
          ...(input.dueDate ? { DueDate: input.dueDate } : {}),
          Line: lines,
          ...(input.memo?.trim()
            ? { CustomerMemo: { value: input.memo.trim() } }
            : {}),
          ...(customer.email ? { BillEmail: { Address: customer.email } } : {}),
          PrivateNote: `Created from SIS by ${staffName}`,
          ...(docNumber ? { DocNumber: docNumber } : { AutoDocNumber: true }),
        }
      )
    ).Invoice;
  } catch (e) {
    // buildInvoiceLines throws a plain Error with a sentence meant for staff.
    const message =
      e instanceof Error &&
      !(e instanceof QboError) &&
      !(e instanceof QboNotConnectedError) &&
      e.message.startsWith('One of the items')
        ? e.message
        : qboErrorMessage(e);
    return { ok: false, status: 502, error: message };
  }

  // QuickBooks has it. Store it and move the tiles; a failure here does not
  // undo the invoice, it is reported.
  const warnings: string[] = [];
  try {
    const maps = await loadBillingMaps(service);
    const placed = await upsertInvoice(service, {
      inv: invoice,
      qboInvoiceId: invoice.Id,
      studentNumber,
      realmId,
      maps,
      source: 'created',
      createdBy: { id: actor.id, email: actor.email },
    });
    if (placed.after.ayCode) {
      const t = await syncTilesForStudent(
        service,
        studentNumber,
        [placed.after.ayCode],
        { realmId }
      );
      warnings.push(...t.errors.map((e) => `The stage wasn't updated: ${e}`));
    }
  } catch (e) {
    console.error('[billing] invoice saved in QuickBooks, SIS save failed:', e);
    warnings.push(createdButNotSaved(invoice.DocNumber));
  }
  await logAction({
    service,
    actor,
    action: 'qbo.invoice.create',
    entityType: 'qbo_invoice',
    entityId: invoice.Id,
    context: {
      studentNumber,
      doc_number: invoice.DocNumber ?? null,
      total: Number(invoice.TotalAmt),
      customer: customer.name,
    },
  });

  let sentTo: string | null = null;
  if (input.send) {
    try {
      sentTo = (await sendInvoice(service, { qboInvoiceId: invoice.Id, actor }))
        .sentTo;
    } catch (e) {
      warnings.push(
        `The invoice was created, but it wasn't emailed: ${qboErrorMessage(e)} Use Send on the invoice page.`
      );
    }
  }
  return {
    ok: true,
    qboInvoiceId: invoice.Id,
    docNumber: invoice.DocNumber ?? null,
    sentTo,
    warnings,
  };
}
```

- [ ] **Step 5: The two routes**

`app/api/billing/students/[studentNumber]/invoices/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireRole } from '@/lib/auth/require-role';
import { createInvoiceForStudent } from '@/lib/billing/invoice-create.server';
import { isRealDate } from '@/lib/billing/settings-helpers';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

const Date10 = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealDate, 'That is not a real date.');
const Body = z.object({
  lines: z
    .array(
      z.object({
        itemId: z.string().min(1),
        description: z.string().max(4000).optional(),
        qty: z.number().positive(),
        unitPrice: z.number().nonnegative(),
      })
    )
    .min(1, 'Add at least one line.')
    .max(50),
  txnDate: Date10,
  dueDate: Date10.nullable(),
  memo: z.string().max(1000).optional(),
  docNumber: z
    .string()
    .trim()
    .max(21, 'An invoice number is at most 21 characters in QuickBooks.')
    .optional(),
  send: z.boolean(),
});

// POST /api/billing/students/[studentNumber]/invoices — Create invoice from
// the customer page. QuickBooks first; nothing is saved unless it accepts.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ studentNumber: string }> }
) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const { studentNumber } = await params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
      { status: 400 }
    );
  const r = await createInvoiceForStudent(createServiceClient(), {
    studentNumber,
    actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
    input: parsed.data,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
}
```

`app/api/billing/invoices/[invoiceId]/send/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireRole } from '@/lib/auth/require-role';
import { sendInvoice } from '@/lib/billing/invoice-send.server';
import { connectedRealmId, qboErrorMessage } from '@/lib/qbo/client';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

const Body = z.object({
  sendTo: z.email('That is not an email address.').optional(),
});

// POST /api/billing/invoices/[invoiceId]/send — email the invoice to the
// parents through QuickBooks. Only an invoice of a linked student's customer.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const { invoiceId } = await params;
  const parsed = Body.safeParse((await request.json().catch(() => ({}))) ?? {});
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
      { status: 400 }
    );
  const service = createServiceClient();
  const realmId = await connectedRealmId(service).catch(() => null);
  const { data: row } = await service
    .from('qbo_invoices')
    .select('qbo_invoice_id, state')
    .eq('qbo_invoice_id', invoiceId)
    .eq('realm_id', realmId ?? '')
    .maybeSingle();
  if (!row)
    return NextResponse.json(
      { error: 'That invoice is not one of a linked student’s.' },
      { status: 404 }
    );
  if (row.state === 'voided')
    return NextResponse.json(
      { error: 'A voided invoice can’t be sent.' },
      { status: 409 }
    );
  try {
    const r = await sendInvoice(service, {
      qboInvoiceId: invoiceId,
      sendTo: parsed.data.sendTo ?? null,
      actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
    });
    return NextResponse.json({ ok: true, sentTo: r.sentTo });
  } catch (e) {
    return NextResponse.json({ error: qboErrorMessage(e) }, { status: 502 });
  }
}
```

- [ ] **Step 6: `components/billing/create-invoice-sheet.tsx`**

Moved from `components/sis/qbo-invoice-sheets.tsx` `CreateInvoiceSheet` (the original stays until Task 5.3 deletes it): the customer step is gone (always the linked customer); the duplicate-tile note and "Email it now" are new.

```tsx
'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
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
import type { InvoiceLine } from '@/lib/billing/classify';
import {
  duplicateTileWarning,
  mapsFromData,
  todaySg,
  type MapsData,
} from '@/lib/billing/view';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { formatSgd } from '@/lib/qbo/format';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

type Item = {
  id: string;
  name: string;
  description: string | null;
  unitPrice: number | null;
  accountId: string | null;
};
type Line = {
  key: number;
  itemId: string;
  description: string;
  qty: string;
  unitPrice: string;
};
type Result = {
  docNumber: string | null;
  sentTo: string | null;
  warnings: string[];
};

export function CreateInvoiceSheet({
  open,
  onOpenChange,
  studentNumber,
  studentName,
  customerEmail,
  maps,
  existing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  studentNumber: string;
  studentName: string;
  /** The QuickBooks customer's email, if it has one. */
  customerEmail: string | null;
  maps: MapsData;
  /** The customer's invoices as stored, for the duplicate-tile note. */
  existing: Array<{
    docNumber: string | null;
    ayCode: string | null;
    stageKeys: string[];
    state: 'open' | 'paid' | 'voided';
  }>;
}) {
  const router = useRouter();
  const run = useWriteAction();
  const items = useQuery({
    queryKey: ['qbo-items'],
    queryFn: () => apiFetch<{ items: Item[] }>('/api/quickbooks/items'),
    staleTime: 5 * 60 * 1000,
  });
  const [lines, setLines] = useState<Line[]>([
    { key: 1, itemId: '', description: '', qty: '1', unitPrice: '' },
  ]);
  const [txnDate, setTxnDate] = useState(() => todaySg());
  const [dueDate, setDueDate] = useState('');
  const [memo, setMemo] = useState('');
  const [docNumber, setDocNumber] = useState('');
  const [send, setSend] = useState(!!customerEmail);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  const parsed = lines.map((l) => ({
    ...l,
    q: Number(l.qty),
    p: Number(l.unitPrice),
  }));
  const linesValid = parsed.every(
    (l) =>
      l.itemId &&
      l.qty.trim() !== '' &&
      l.q > 0 &&
      l.unitPrice.trim() !== '' &&
      l.p >= 0
  );
  const total = parsed.reduce(
    (s, l) =>
      s +
      (l.qty.trim() !== '' && l.unitPrice.trim() !== '' && l.q > 0 && l.p >= 0
        ? Math.round(l.q * l.p * 100) / 100
        : 0),
    0
  );
  const valid = linesValid && /^\d{4}-\d{2}-\d{2}$/.test(txnDate);

  // Which tile (and year) the chosen items would put this invoice on, and
  // whether that tile already has a live invoice for the year.
  const warning = useMemo(() => {
    const byId = new Map((items.data?.items ?? []).map((i) => [i.id, i]));
    const asLines: InvoiceLine[] = lines
      .filter((l) => l.itemId)
      .map((l) => ({
        itemId: l.itemId,
        itemName: byId.get(l.itemId)?.name ?? null,
        accountId: byId.get(l.itemId)?.accountId ?? null,
        description: null,
        qty: Number(l.qty) || null,
        amount: 0,
      }));
    if (asLines.length === 0) return null;
    return duplicateTileWarning({
      lines: asLines,
      txnDate,
      maps: mapsFromData(maps),
      existing,
    });
  }, [items.data, lines, txnDate, maps, existing]);

  const save = useMutation({
    mutationFn: () =>
      apiFetch<Result>(
        `/api/billing/students/${encodeURIComponent(studentNumber)}/invoices`,
        jsonInit('POST', {
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
          ...(docNumber.trim() ? { docNumber: docNumber.trim() } : {}),
          send,
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
      success: (d) => {
        for (const w of d.warnings) toast.warning(w);
        const what = d.docNumber ? `Invoice ${d.docNumber}` : 'The invoice';
        return d.sentTo
          ? `${what} created and emailed to ${d.sentTo}`
          : `${what} created in QuickBooks`;
      },
      onResolved: () => {
        onOpenChange(false);
        router.refresh();
      },
    });
    setSaving(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
      >
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader className="shrink-0 gap-1.5 border-b border-border p-5">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {studentName}
            </p>
            <SheetTitle className="font-serif text-[22px] leading-tight tracking-tight">
              Create invoice
            </SheetTitle>
            <SheetDescription>
              Created in QuickBooks first. Leave the number blank and QuickBooks
              picks the next one.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <FieldGroup>
              {warning && (
                <div className="flex items-start gap-3 rounded-xl border border-brand-amber/40 bg-brand-amber/10 p-4">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-amber to-brand-amber/80 text-ink shadow-brand-tile">
                    <AlertTriangle className="size-4" />
                  </div>
                  <p className="text-sm text-ink">{warning}</p>
                </div>
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
                            const it = items.data?.items.find(
                              (x) => x.id === id
                            );
                            const prev = items.data?.items.find(
                              (x) => x.id === l.itemId
                            );
                            const untouched =
                              !l.description ||
                              l.description === (prev?.description ?? '');
                            setLine(l.key, {
                              itemId: id,
                              unitPrice:
                                it?.unitPrice != null
                                  ? String(it.unitPrice)
                                  : '',
                              description: untouched
                                ? (it?.description ?? '')
                                : l.description,
                            });
                          }}
                        >
                          <SelectTrigger className="w-full" aria-label="Item">
                            <SelectValue
                              placeholder={
                                items.isLoading
                                  ? 'Loading items…'
                                  : 'Choose an item'
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
                              setLines((ls) =>
                                ls.filter((x) => x.key !== l.key)
                              )
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
                          onChange={(e) =>
                            setLine(l.key, { qty: e.target.value })
                          }
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
                          {l.qty.trim() !== '' &&
                          Number(l.qty) > 0 &&
                          Number(l.unitPrice) >= 0 &&
                          l.unitPrice.trim() !== ''
                            ? formatSgd(
                                Math.round(
                                  Number(l.qty) * Number(l.unitPrice) * 100
                                ) / 100
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
                    Total before GST{' '}
                    <span className="font-semibold tabular-nums">
                      {formatSgd(total)}
                    </span>
                  </p>
                </div>
                <FieldDescription>
                  GST follows each item&rsquo;s tax code in QuickBooks; the
                  invoice page shows the GST QuickBooks worked out.
                </FieldDescription>
                {showErrors && !linesValid && (
                  <FieldError>
                    Each line needs an item, a quantity above 0 and a price.
                  </FieldError>
                )}
              </Field>

              <Field>
                <FieldLabel htmlFor="bill-doc-number">Invoice no.</FieldLabel>
                <Input
                  id="bill-doc-number"
                  value={docNumber}
                  maxLength={21}
                  onChange={(e) => setDocNumber(e.target.value)}
                  placeholder="QuickBooks’ next number"
                  className="font-mono tabular-nums"
                />
                <FieldDescription>
                  Type your own, e.g. HFSE062240, or leave blank.
                </FieldDescription>
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="bill-txn-date">Invoice date</FieldLabel>
                  <DatePicker
                    id="bill-txn-date"
                    value={txnDate}
                    onChange={(d) => setTxnDate(d || todaySg())}
                    allowClear={false}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="bill-due-date">Due date</FieldLabel>
                  <DatePicker
                    id="bill-due-date"
                    value={dueDate}
                    onChange={setDueDate}
                    placeholder="Usual terms"
                  />
                  <FieldDescription>
                    Blank uses QuickBooks’ usual terms.
                  </FieldDescription>
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="bill-memo">
                  Message to the parents
                </FieldLabel>
                <Input
                  id="bill-memo"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                />
                <FieldDescription>Shown on the invoice.</FieldDescription>
              </Field>

              <Field orientation="horizontal">
                <Checkbox
                  id="bill-send"
                  checked={send}
                  disabled={!customerEmail}
                  onCheckedChange={(v) => setSend(v === true)}
                />
                <FieldLabel htmlFor="bill-send" className="font-normal">
                  {customerEmail
                    ? `Email it now to ${customerEmail}`
                    : 'Email it now — the QuickBooks customer has no email'}
                </FieldLabel>
              </Field>
            </FieldGroup>
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
              disabled={saving}
            >
              Create in QuickBooks
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 7: `components/billing/send-invoice-button.tsx`**

```tsx
'use client';

import { useMutation } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// Emails the invoice through QuickBooks. "Send" before it was ever sent,
// "Send again" after.
export function SendInvoiceButton({
  qboInvoiceId,
  label,
  disabledReason,
}: {
  qboInvoiceId: string;
  label: 'Send' | 'Send again';
  /** Set when it can't be sent (no email, voided) — the button is disabled and says why. */
  disabledReason?: string | null;
}) {
  const router = useRouter();
  const run = useWriteAction();
  const send = useMutation({
    mutationFn: () =>
      apiFetch<{ sentTo: string | null }>(
        `/api/billing/invoices/${encodeURIComponent(qboInvoiceId)}/send`,
        jsonInit('POST', {})
      ),
  });
  return (
    <Button
      variant="outline"
      disabled={!!disabledReason}
      title={disabledReason ?? undefined}
      loading={send.isPending}
      loadingText="Sending…"
      onClick={() =>
        run(() => send.mutateAsync(), {
          pending: 'Emailing through QuickBooks…',
          success: (d) => (d.sentTo ? `Emailed to ${d.sentTo}` : 'Emailed'),
          onResolved: () => router.refresh(),
        })
      }
    >
      <Send className="size-4" />
      {label}
    </Button>
  );
}
```

- [ ] **Step 8: tsc and commit**

Run: `npx tsc --noEmit` and `npx vitest run --pool=threads __tests__/audit __tests__/billing __tests__/qbo`
Expected: clean, PASS. (The sheet and button are exercised in Task 4.7 and the round trip, Task 4.11.)

```bash
git add lib/billing/invoice-create.server.ts lib/billing/invoice-send.server.ts "app/api/billing/students/[studentNumber]/invoices/route.ts" "app/api/billing/invoices/[invoiceId]/send/route.ts" app/api/quickbooks/items/route.ts lib/audit/log-action.ts lib/audit/humanize.ts "app/(admissions)/admissions/audit-log/page.tsx" components/billing/create-invoice-sheet.tsx components/billing/send-invoice-button.tsx && git commit -m "feat(billing): Create invoice and Send from Billing, through QuickBooks

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 4.6: Record payment, with customer credit

**Files:**

- Create: `lib/billing/payment-record.server.ts`
- Create: `app/api/billing/students/[studentNumber]/payments/route.ts`
- Modify: `lib/audit/log-action.ts`, `lib/audit/humanize.ts`, `app/(admissions)/admissions/audit-log/page.tsx` (`qbo.payment.apply_credit`)
- Create: `components/billing/record-payment-sheet.tsx`

**Interfaces:**

- Consumes: `planPayment`, `mergeCreditLines`, `OpenInvoice`, `CreditSource`, `PaymentPlan` (Task 4.1); `loadCustomerHistory` (`lib/billing/history.server.ts`); `upsertPayment` (`lib/billing/store.server.ts`); `QbPayment` (Task 4.2).
- Produces:
  - `recordPayment(service, args: { studentNumber: string; actor: { id: string; email: string | null; role: string }; input: RecordPaymentInput }): Promise<RecordPaymentResult>` where `RecordPaymentInput = { amount: number; txnDate: string; depositAccountId: string | null; reference?: string; invoiceIds: string[]; useCredit: boolean }` and `RecordPaymentResult = { ok: true; paymentId: string | null; plan: PaymentPlan; warnings: string[] } | { ok: false; status: number; error: string }`.
  - `POST /api/billing/students/[studentNumber]/payments` (QBO_INVOICE_ROLES), body = `RecordPaymentInput`.
  - `<RecordPaymentSheet open onOpenChange studentNumber studentName openInvoices credits depositAccounts mode />` with `mode: 'pay' | 'credit'`, `openInvoices: Array<OpenInvoice & { items: string }>`, `credits: Array<CreditSource & { reference: string | null }>`, `depositAccounts: Array<{ id: string; label: string }>`.

- [ ] **Step 1: Register `qbo.payment.apply_credit`**

`lib/audit/log-action.ts` `ALL_AUDIT_ACTIONS`: after `'qbo.payment.create',` add `'qbo.payment.apply_credit',`.

`lib/audit/humanize.ts` `ACTION_LABELS`: after `'qbo.payment.create': …,` add `'qbo.payment.apply_credit': 'Customer credit used in QuickBooks',`. In the context switch, after the `case 'qbo.payment.create': { … }` block add:

```ts
    case 'qbo.payment.apply_credit': {
      const parts: string[] = [];
      const amount = Number(ctx.amount);
      if (ctx.amount !== undefined && ctx.amount !== null && Number.isFinite(amount))
        parts.push(
          `S$${amount.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        );
      const invoices = Array.isArray(ctx.invoices) ? (ctx.invoices as unknown[]).map(String).filter(Boolean) : [];
      if (invoices.length) parts.push(`to ${invoices.join(', ')}`);
      return joinParts(parts);
    }
```

`app/(admissions)/admissions/audit-log/page.tsx`: add `'qbo.payment.apply_credit',` after `'qbo.payment.create',`.

Run: `npx vitest run --pool=threads __tests__/audit`
Expected: PASS.

- [ ] **Step 2: `lib/billing/payment-record.server.ts`**

```ts
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { logAction } from '@/lib/audit/log-action';
import { loadCustomerHistory } from '@/lib/billing/history.server';
import type { QbPayment } from '@/lib/billing/invoice-row';
import {
  mergeCreditLines,
  planPayment,
  type PaymentPlan,
} from '@/lib/billing/payment-plan';
import { upsertPayment } from '@/lib/billing/store.server';
import {
  connectedRealmId,
  qboErrorMessage,
  qboRequest,
  QboNotConnectedError,
} from '@/lib/qbo/client';

export type RecordPaymentInput = {
  amount: number;
  txnDate: string;
  depositAccountId: string | null;
  reference?: string;
  invoiceIds: string[];
  useCredit: boolean;
};

export type RecordPaymentResult =
  | {
      ok: true;
      paymentId: string | null;
      plan: PaymentPlan;
      warnings: string[];
    }
  | { ok: false; status: number; error: string };

/**
 * Record payment (spec "Drawers") and Use credit. QuickBooks first:
 * 1. the customer's invoices and payments are re-read, so balances and credit
 *    are QuickBooks' own at this moment;
 * 2. credit (when asked) is applied by adding lines to the credit payments;
 * 3. the new money becomes one QuickBooks Payment applied oldest invoice
 *    first; whatever the ticked invoices don't need stays as credit;
 * 4. the customer is re-read again, which stores the payment and moves the
 *    tiles.
 */
export async function recordPayment(
  service: SupabaseClient,
  args: {
    studentNumber: string;
    actor: { id: string; email: string | null; role: string };
    input: RecordPaymentInput;
  }
): Promise<RecordPaymentResult> {
  const { studentNumber, actor, input } = args;
  const realmId = await connectedRealmId(service).catch(() => null);
  if (!realmId)
    return {
      ok: false,
      status: 502,
      error: qboErrorMessage(new QboNotConnectedError()),
    };
  const { data: link, error: linkErr } = await service
    .from('qbo_customers')
    .select('qbo_customer_id, display_name')
    .eq('student_number', studentNumber)
    .eq('realm_id', realmId)
    .maybeSingle();
  if (linkErr) return { ok: false, status: 500, error: linkErr.message };
  if (!link)
    return {
      ok: false,
      status: 422,
      error: 'This student is not linked to a QuickBooks customer yet.',
    };
  const customerId = link.qbo_customer_id as string;

  // 1) QuickBooks' figures now.
  try {
    const fresh = await loadCustomerHistory(service, studentNumber, undefined);
    if (fresh.errors.length)
      console.warn('[billing] pre-payment read:', fresh.errors);
  } catch (e) {
    return { ok: false, status: 502, error: qboErrorMessage(e) };
  }
  const [inv, pay, dep] = await Promise.all([
    service
      .from('qbo_invoices')
      .select('qbo_invoice_id, doc_number, txn_date, balance, state')
      .eq('qbo_customer_id', customerId)
      .eq('realm_id', realmId),
    service
      .from('qbo_payments')
      .select('qbo_payment_id, txn_date, unapplied')
      .eq('qbo_customer_id', customerId)
      .eq('realm_id', realmId)
      .gt('unapplied', 0),
    input.depositAccountId
      ? service
          .from('billing_deposit_accounts')
          .select('qbo_account_id, label')
          .eq('qbo_account_id', input.depositAccountId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (inv.error || pay.error || dep.error)
    return {
      ok: false,
      status: 500,
      error: (inv.error ?? pay.error ?? dep.error)!.message,
    };
  const rows = (inv.data ?? []) as Array<{
    qbo_invoice_id: string;
    doc_number: string | null;
    txn_date: string | null;
    balance: number;
    state: string;
  }>;
  const byId = new Map(rows.map((r) => [r.qbo_invoice_id, r]));
  for (const id of input.invoiceIds) {
    const r = byId.get(id);
    if (!r || r.state !== 'open' || Number(r.balance) <= 0)
      return {
        ok: false,
        status: 409,
        error: `${r?.doc_number ?? 'One of the ticked invoices'} no longer has anything owing in QuickBooks. Reload the page and try again.`,
      };
  }
  if (input.amount > 0 && !dep.data)
    return {
      ok: false,
      status: 422,
      error: 'Choose the account the money was paid into.',
    };
  const plan = planPayment({
    invoices: input.invoiceIds.map((id) => {
      const r = byId.get(id)!;
      return {
        id,
        docNumber: r.doc_number,
        txnDate: r.txn_date,
        balance: Number(r.balance),
      };
    }),
    credits: (
      (pay.data ?? []) as Array<{
        qbo_payment_id: string;
        txn_date: string | null;
        unapplied: number;
      }>
    ).map((p) => ({
      paymentId: p.qbo_payment_id,
      txnDate: p.txn_date,
      unapplied: Number(p.unapplied),
    })),
    useCredit: input.useCredit,
    amount: input.amount,
  });
  if (input.amount <= 0 && plan.creditUsed <= 0)
    return {
      ok: false,
      status: 422,
      error: 'Enter the amount received, or use credit on a ticked invoice.',
    };

  const doc = (id: string) => byId.get(id)?.doc_number ?? id;
  const warnings: string[] = [];

  // 2) Credit first.
  let creditApplied = false;
  const byPayment = new Map<
    string,
    Array<{ invoiceId: string; amount: number }>
  >();
  for (const c of plan.creditUse) {
    const list = byPayment.get(c.paymentId) ?? [];
    list.push({ invoiceId: c.invoiceId, amount: c.amount });
    byPayment.set(c.paymentId, list);
  }
  for (const [paymentId, entries] of byPayment) {
    try {
      const { Payment } = await qboRequest<{
        Payment: QbPayment & { SyncToken: string };
      }>(service, 'GET', `/payment/${encodeURIComponent(paymentId)}`);
      await qboRequest(service, 'POST', '/payment', {
        Id: Payment.Id,
        SyncToken: Payment.SyncToken,
        sparse: true,
        CustomerRef: Payment.CustomerRef,
        TotalAmt: Payment.TotalAmt,
        Line: mergeCreditLines(Payment.Line ?? [], entries),
      });
      creditApplied = true;
      await logAction({
        service,
        actor,
        action: 'qbo.payment.apply_credit',
        entityType: 'qbo_payment',
        entityId: paymentId,
        context: {
          studentNumber,
          amount: entries.reduce((s, e) => s + e.amount, 0),
          invoices: entries.map((e) => doc(e.invoiceId)),
        },
      });
    } catch (e) {
      return {
        ok: false,
        status: 502,
        error: creditApplied
          ? `Some of the credit was used, then QuickBooks stopped: ${qboErrorMessage(e)} Reload the page to see where it got to.`
          : qboErrorMessage(e),
      };
    }
  }

  // 3) The new money.
  let paymentId: string | null = null;
  if (input.amount > 0) {
    const { data: who } = await service.auth.admin.getUserById(actor.id);
    const staffName =
      (who?.user?.user_metadata?.full_name as string | undefined) ??
      actor.email ??
      'staff';
    try {
      const { Payment } = await qboRequest<{ Payment: QbPayment }>(
        service,
        'POST',
        '/payment',
        {
          CustomerRef: { value: customerId },
          TotalAmt: input.amount,
          TxnDate: input.txnDate,
          DepositToAccountRef: { value: input.depositAccountId },
          ...(input.reference?.trim()
            ? { PaymentRefNum: input.reference.trim() }
            : {}),
          PrivateNote: `Recorded from SIS by ${staffName}`,
          Line: plan.cashApply.map((a) => ({
            Amount: a.amount,
            LinkedTxn: [{ TxnId: a.invoiceId, TxnType: 'Invoice' }],
          })),
        }
      );
      paymentId = Payment.Id;
      await upsertPayment(service, {
        p: Payment,
        studentNumber,
        realmId,
        createdBy: { id: actor.id, email: actor.email },
      });
      await logAction({
        service,
        actor,
        action: 'qbo.payment.create',
        entityType: 'qbo_payment',
        entityId: Payment.Id,
        context: {
          studentNumber,
          total: input.amount,
          deposit_account:
            (dep.data as { label: string } | null)?.label ?? null,
          invoices: plan.cashApply.map((a) => doc(a.invoiceId)),
          left_as_credit: plan.leftover,
        },
      });
    } catch (e) {
      return {
        ok: false,
        status: 502,
        error: creditApplied
          ? `The credit was used, but the payment wasn't recorded: ${qboErrorMessage(e)}`
          : qboErrorMessage(e),
      };
    }
  }

  // 4) Store everything and move the tiles.
  try {
    const after = await loadCustomerHistory(service, studentNumber);
    warnings.push(
      ...after.errors.map(
        (e) => `Saved in QuickBooks; the SIS copy will catch up: ${e}`
      )
    );
  } catch (e) {
    warnings.push(
      `Saved in QuickBooks; the SIS copy will catch up within the hour (${qboErrorMessage(e)}).`
    );
  }
  return { ok: true, paymentId, plan, warnings };
}
```

- [ ] **Step 3: The route**

`app/api/billing/students/[studentNumber]/payments/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireRole } from '@/lib/auth/require-role';
import { recordPayment } from '@/lib/billing/payment-record.server';
import { isRealDate } from '@/lib/billing/settings-helpers';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

const Body = z.object({
  amount: z.number().min(0).max(1_000_000),
  txnDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isRealDate, 'That is not a real date.'),
  depositAccountId: z.string().min(1).nullable(),
  reference: z
    .string()
    .trim()
    .max(21, 'A reference is at most 21 characters in QuickBooks.')
    .optional(),
  invoiceIds: z.array(z.string().min(1)).max(100),
  useCredit: z.boolean(),
});

// POST /api/billing/students/[studentNumber]/payments — Record payment and
// Use credit. QuickBooks first; nothing is saved unless it accepts.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ studentNumber: string }> }
) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const { studentNumber } = await params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
      { status: 400 }
    );
  const r = await recordPayment(createServiceClient(), {
    studentNumber,
    actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
    input: parsed.data,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
}
```

- [ ] **Step 4: `components/billing/record-payment-sheet.tsx`**

```tsx
'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
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
import {
  oldestFirst,
  planPayment,
  type CreditSource,
  type OpenInvoice,
} from '@/lib/billing/payment-plan';
import { formatDay, round2, todaySg } from '@/lib/billing/view';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { formatSgd } from '@/lib/qbo/format';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { cn } from '@/lib/utils';

export function RecordPaymentSheet({
  open,
  onOpenChange,
  studentNumber,
  studentName,
  openInvoices,
  credits,
  depositAccounts,
  mode,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  studentNumber: string;
  studentName: string;
  openInvoices: Array<OpenInvoice & { items: string }>;
  credits: Array<CreditSource & { reference: string | null }>;
  depositAccounts: Array<{ id: string; label: string }>;
  /** 'credit' opens it as Use credit: credit ticked, no new money. */
  mode: 'pay' | 'credit';
}) {
  const router = useRouter();
  const run = useWriteAction();
  const invoices = useMemo(() => oldestFirst(openInvoices), [openInvoices]);
  const creditTotal = round2(credits.reduce((s, c) => s + c.unapplied, 0));
  const owed = round2(invoices.reduce((s, i) => s + i.balance, 0));
  const [useCredit, setUseCredit] = useState(
    mode === 'credit' && creditTotal > 0
  );
  // Record payment starts at everything owed; Use credit starts with no new money.
  const [amount, setAmount] = useState(() =>
    mode === 'credit' ? '' : owed.toFixed(2)
  );
  const [txnDate, setTxnDate] = useState(() => todaySg());
  const [account, setAccount] = useState(depositAccounts[0]?.id ?? '');
  const [reference, setReference] = useState('');
  const [ticked, setTicked] = useState<Set<string>>(
    () => new Set(invoices.map((i) => i.id))
  );
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  const cash = amount.trim() === '' ? 0 : Number(amount);
  const amountValid = Number.isFinite(cash) && cash >= 0;
  const plan = useMemo(
    () =>
      planPayment({
        invoices: invoices.filter((i) => ticked.has(i.id)),
        credits,
        useCredit,
        amount: amountValid ? cash : 0,
      }),
    [invoices, ticked, credits, useCredit, cash, amountValid]
  );
  const applied = new Map<string, number>();
  for (const x of [...plan.creditUse, ...plan.cashApply])
    applied.set(
      x.invoiceId,
      round2((applied.get(x.invoiceId) ?? 0) + x.amount)
    );
  const needsAccount = cash > 0;
  const nothingToDo = cash <= 0 && plan.creditUsed <= 0;
  const valid = amountValid && !nothingToDo && (!needsAccount || !!account);

  const save = useMutation({
    mutationFn: () =>
      apiFetch<{ warnings: string[] }>(
        `/api/billing/students/${encodeURIComponent(studentNumber)}/payments`,
        jsonInit('POST', {
          amount: cash,
          txnDate,
          depositAccountId: needsAccount ? account : null,
          ...(reference.trim() ? { reference: reference.trim() } : {}),
          invoiceIds: invoices.filter((i) => ticked.has(i.id)).map((i) => i.id),
          useCredit,
        })
      ),
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    await run(() => save.mutateAsync(), {
      pending: 'Recording in QuickBooks…',
      success: (d) => {
        for (const w of d.warnings) toast.warning(w);
        if (cash <= 0) return `${formatSgd(plan.creditUsed)} of credit used`;
        return plan.leftover > 0
          ? `${formatSgd(cash)} recorded · ${formatSgd(plan.leftover)} kept as credit`
          : `${formatSgd(cash)} recorded in QuickBooks`;
      },
      onResolved: () => {
        onOpenChange(false);
        router.refresh();
      },
    });
    setSaving(false);
  }

  const toggle = (id: string, on: boolean) =>
    setTicked((t) => {
      const n = new Set(t);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
      >
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader className="shrink-0 gap-1.5 border-b border-border p-5">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {studentName}
            </p>
            <SheetTitle className="font-serif text-[22px] leading-tight tracking-tight">
              {mode === 'credit' ? 'Use credit' : 'Record payment'}
            </SheetTitle>
            <SheetDescription>
              Recorded in QuickBooks first. The SIS saves it once QuickBooks
              accepts.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <FieldGroup>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="pay-amount">
                    Amount received (S$)
                  </FieldLabel>
                  <Input
                    id="pay-amount"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={
                      mode === 'credit' ? '0.00 — credit only' : '0.00'
                    }
                    className="tabular-nums"
                  />
                  {showErrors && !amountValid && (
                    <FieldError>Enter an amount of 0 or more.</FieldError>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor="pay-date">Date received</FieldLabel>
                  <DatePicker
                    id="pay-date"
                    value={txnDate}
                    onChange={(d) => setTxnDate(d || todaySg())}
                    allowClear={false}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="pay-account">Paid into</FieldLabel>
                  <Select
                    value={account}
                    onValueChange={setAccount}
                    disabled={!needsAccount}
                  >
                    <SelectTrigger id="pay-account" className="w-full">
                      <SelectValue placeholder="Choose an account" />
                    </SelectTrigger>
                    <SelectContent>
                      {depositAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {depositAccounts.length === 0 && (
                    <FieldDescription>
                      No payment accounts yet — a superadmin sets them in
                      Billing settings.
                    </FieldDescription>
                  )}
                  {showErrors && needsAccount && !account && (
                    <FieldError>Choose the account.</FieldError>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor="pay-ref">Reference no.</FieldLabel>
                  <Input
                    id="pay-ref"
                    value={reference}
                    maxLength={21}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="Bank or card reference"
                    className="font-mono"
                  />
                </Field>
              </div>

              {creditTotal > 0 && (
                <label
                  htmlFor="pay-credit"
                  className="flex items-center gap-3 rounded-md border border-primary/30 bg-accent px-3 py-2.5 text-sm text-accent-foreground"
                >
                  <Checkbox
                    id="pay-credit"
                    checked={useCredit}
                    onCheckedChange={(v) => setUseCredit(v === true)}
                  />
                  <span className="flex-1">
                    Use credit first
                    <span className="block text-[12px] text-muted-foreground">
                      {credits
                        .map(
                          (c) =>
                            `${c.reference ? c.reference : 'Payment'}, ${formatDay(c.txnDate)}`
                        )
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="tabular-nums">{formatSgd(creditTotal)}</span>
                </label>
              )}

              <Field>
                <FieldLabel>Pays these invoices</FieldLabel>
                <FieldDescription>
                  Oldest first, up to the amount. Untick all to keep the money
                  as credit on the customer.
                </FieldDescription>
                {invoices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing is owing. The payment will be kept as credit.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {invoices.map((i) => {
                      const on = ticked.has(i.id);
                      const pays = applied.get(i.id) ?? 0;
                      return (
                        <label
                          key={i.id}
                          className={cn(
                            'grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-md border border-border px-3 py-2.5 text-sm',
                            on && 'border-brand-indigo bg-brand-indigo/5'
                          )}
                        >
                          <Checkbox
                            checked={on}
                            onCheckedChange={(v) => toggle(i.id, v === true)}
                          />
                          <span className="min-w-0">
                            <span className="font-mono font-semibold tabular-nums">
                              {i.docNumber ?? i.id}
                            </span>
                            <span className="ml-2 text-muted-foreground">
                              {i.items}
                            </span>
                            <span className="block text-[12px] text-muted-foreground">
                              {formatDay(i.txnDate)} · owes{' '}
                              {formatSgd(i.balance)}
                            </span>
                          </span>
                          <span className="text-right tabular-nums">
                            {on && pays > 0 ? `pays ${formatSgd(pays)}` : '—'}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </Field>

              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 rounded-md bg-muted/40 p-3 text-sm">
                {plan.creditUsed > 0 && (
                  <>
                    <dt className="text-muted-foreground">Credit used</dt>
                    <dd className="text-right tabular-nums">
                      {formatSgd(plan.creditUsed)}
                    </dd>
                  </>
                )}
                <dt className="text-muted-foreground">From this payment</dt>
                <dd className="text-right tabular-nums">
                  {formatSgd(plan.cashApplied)}
                </dd>
                <dt className="text-muted-foreground">Left over</dt>
                <dd className="text-right tabular-nums">
                  {formatSgd(plan.leftover)}
                  {plan.leftover > 0 && (
                    <span className="block text-[12px] text-muted-foreground">
                      stays as credit on the customer
                    </span>
                  )}
                </dd>
              </dl>
              {showErrors && nothingToDo && (
                <FieldError>
                  Enter the amount received, or use credit on a ticked invoice.
                </FieldError>
              )}
            </FieldGroup>
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
              disabled={saving}
            >
              {cash > 0 ? 'Record in QuickBooks' : 'Use credit in QuickBooks'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 5: tsc and commit**

Run: `npx tsc --noEmit` and `npx vitest run --pool=threads __tests__/audit __tests__/billing`
Expected: clean, PASS.

```bash
git add lib/billing/payment-record.server.ts "app/api/billing/students/[studentNumber]/payments/route.ts" lib/audit/log-action.ts lib/audit/humanize.ts "app/(admissions)/admissions/audit-log/page.tsx" components/billing/record-payment-sheet.tsx && git commit -m "feat(billing): Record payment and Use credit, through QuickBooks

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 4.7: Customer page (`/billing/[studentNumber]`)

**Files:**

- Create: `lib/billing/customer-page.server.ts`
- Create: `components/billing/customer-actions.tsx`
- Create: `components/billing/credit-panel.tsx`
- Create: `components/billing/customer-tabs.tsx`
- Create: `app/(billing)/billing/[studentNumber]/page.tsx`
- Create: `app/(billing)/billing/[studentNumber]/loading.tsx`

**Interfaces:**

- Consumes: `loadCustomerHistory`; `readCustomerProfile`, `readAging`, `CustomerProfile` (Task 4.2); `loadStudentInfo`, `StudentInfo` (Task 4.2); `pickBalances`, `Balances` (Task 4.2); `invoiceStatus`, `itemsSummary`, `tileTag`, `createdByLabel`, `mapsToData`, `MapsData`, `todaySg`, `formatDay`, `round2`, `InvoiceStatus` (Task 4.1); `OpenInvoice`, `CreditSource` (Task 4.1); `loadBillingMaps`; `readStageSnapshot` (`lib/qbo/stage-write.ts`); `CreateInvoiceSheet` (Task 4.5); `RecordPaymentSheet` (Task 4.6); `InvoiceStatusBadge`, `RefreshButton`, `NotConnectedPanel` (Task 4.4).
- Produces: `type InvoiceRowView`, `type PaymentRowView`, `type CustomerPage`, `loadCustomerPage(service, studentNumber): Promise<CustomerPage | null>` (null = no such student and no link → 404); `INVOICE_COLS`, `type InvRow`, `toInvoiceRow(r, today)`, `PAYMENT_COLS`, `type PayRow`, `toPaymentRow(p, docOf, accountLabel)` — reused by Task 4.8.

- [ ] **Step 1: `lib/billing/customer-page.server.ts`**

```ts
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { InvoiceLine } from '@/lib/billing/classify';
import { pickBalances, type Balances } from '@/lib/billing/balances';
import { loadCustomerHistory } from '@/lib/billing/history.server';
import {
  readAging,
  readCustomerProfile,
  type CustomerProfile,
} from '@/lib/billing/live.server';
import type { CreditSource, OpenInvoice } from '@/lib/billing/payment-plan';
import { loadBillingMaps } from '@/lib/billing/settings.server';
import {
  loadStudentInfo,
  type StudentInfo,
} from '@/lib/billing/students.server';
import {
  createdByLabel,
  invoiceStatus,
  itemsSummary,
  mapsToData,
  round2,
  tileTag,
  todaySg,
  type InvoiceStatus,
  type MapsData,
} from '@/lib/billing/view';
import { connectedRealmId, qboErrorMessage } from '@/lib/qbo/client';
import { readStageSnapshot } from '@/lib/qbo/stage-write';

export type InvoiceRowView = {
  id: string;
  docNumber: string | null;
  txnDate: string | null;
  dueDate: string | null;
  total: number;
  balance: number;
  state: 'open' | 'paid' | 'voided';
  status: InvoiceStatus;
  items: string;
  itemNames: string[];
  tile: string | null;
  ayCode: string | null;
  stageKeys: string[];
  memo: string | null;
  createdBy: string;
};

export type PaymentRowView = {
  id: string;
  txnDate: string | null;
  account: string;
  reference: string | null;
  total: number;
  unapplied: number;
  appliedTo: Array<{
    invoiceId: string;
    docNumber: string | null;
    amount: number;
  }>;
  recordedBy: string;
};

export type CustomerPage = {
  studentNumber: string;
  student: StudentInfo | null;
  connected: boolean;
  environment: 'sandbox' | 'production' | null;
  link: { customerId: string; displayName: string } | null;
  /** The read from QuickBooks this page just made. */
  refreshError: string | null;
  profile: CustomerProfile | null;
  balances: Balances;
  invoices: InvoiceRowView[];
  payments: PaymentRowView[];
  openInvoices: Array<OpenInvoice & { items: string }>;
  credits: Array<CreditSource & { reference: string | null }>;
  depositAccounts: Array<{ id: string; label: string }>;
  maps: MapsData;
  stages: {
    ayCode: string;
    registration: string | null;
    fees: string | null;
  } | null;
  overdueOldest: { docNumber: string | null; dueDate: string | null } | null;
};

const zero: Balances = {
  owedOnInvoices: 0,
  openBalance: 0,
  overdue: 0,
  credit: 0,
  source: 'stored',
};

/** The `qbo_invoices` columns the Billing pages read. */
export const INVOICE_COLS =
  'qbo_invoice_id, doc_number, txn_date, due_date, total, balance, state, lines, memo, ay_code, stage_keys, source, created_by_email';
export type InvRow = {
  qbo_invoice_id: string;
  doc_number: string | null;
  txn_date: string | null;
  due_date: string | null;
  total: number;
  balance: number;
  state: 'open' | 'paid' | 'voided';
  lines: InvoiceLine[] | null;
  memo: string | null;
  ay_code: string | null;
  stage_keys: string[] | null;
  source: string | null;
  created_by_email: string | null;
};

export function toInvoiceRow(r: InvRow, today: string): InvoiceRowView {
  const lines = r.lines ?? [];
  const total = Number(r.total);
  const balance = Number(r.balance);
  return {
    id: r.qbo_invoice_id,
    docNumber: r.doc_number,
    txnDate: r.txn_date,
    dueDate: r.due_date,
    total,
    balance,
    state: r.state,
    status: invoiceStatus(
      { state: r.state, total, balance, dueDate: r.due_date },
      today
    ),
    items: itemsSummary(lines),
    itemNames: [
      ...new Set(lines.map((l) => l.itemName).filter((n): n is string => !!n)),
    ],
    tile: tileTag(r.stage_keys ?? [], r.ay_code),
    ayCode: r.ay_code,
    stageKeys: r.stage_keys ?? [],
    memo: r.memo,
    createdBy: createdByLabel({
      source: r.source,
      createdByEmail: r.created_by_email,
      memo: r.memo,
    }),
  };
}

/** The `qbo_payments` columns the Billing pages read. */
export const PAYMENT_COLS =
  'qbo_payment_id, txn_date, total, unapplied, deposit_account_id, deposit_account_name, reference, applied, created_by_email';
export type PayRow = {
  qbo_payment_id: string;
  txn_date: string | null;
  total: number;
  unapplied: number;
  deposit_account_id: string | null;
  deposit_account_name: string | null;
  reference: string | null;
  applied: Array<{ invoiceId: string; amount: number }> | null;
  created_by_email: string | null;
};

export function toPaymentRow(
  p: PayRow,
  docOf: Map<string, string | null>,
  accountLabel: Map<string, string>
): PaymentRowView {
  return {
    id: p.qbo_payment_id,
    txnDate: p.txn_date,
    account:
      (p.deposit_account_id && accountLabel.get(p.deposit_account_id)) ||
      p.deposit_account_name ||
      'Other account',
    reference: p.reference,
    total: Number(p.total),
    unapplied: Number(p.unapplied ?? 0),
    appliedTo: (p.applied ?? []).map((a) => ({
      invoiceId: a.invoiceId,
      docNumber: docOf.get(a.invoiceId) ?? null,
      amount: Number(a.amount),
    })),
    recordedBy: p.created_by_email ?? 'QuickBooks',
  };
}

export async function loadCustomerPage(
  service: SupabaseClient,
  studentNumber: string
): Promise<CustomerPage | null> {
  const student =
    (await loadStudentInfo(service, [studentNumber])).get(studentNumber) ??
    null;
  const realmId = await connectedRealmId(service).catch(() => null);
  const { data: conn } = await service
    .from('qbo_connection')
    .select('environment')
    .eq('id', 1)
    .maybeSingle();
  const base: CustomerPage = {
    studentNumber,
    student,
    connected: !!realmId,
    environment: (conn?.environment as CustomerPage['environment']) ?? null,
    link: null,
    refreshError: null,
    profile: null,
    balances: zero,
    invoices: [],
    payments: [],
    openInvoices: [],
    credits: [],
    depositAccounts: [],
    maps: { accounts: [], items: [], ranges: [] },
    stages: null,
    overdueOldest: null,
  };
  if (!realmId) return student ? base : null;
  const { data: link } = await service
    .from('qbo_customers')
    .select('qbo_customer_id, display_name')
    .eq('student_number', studentNumber)
    .eq('realm_id', realmId)
    .maybeSingle();
  if (!link) return student ? base : null;
  const customerId = link.qbo_customer_id as string;

  // Every open of this page reads the customer from QuickBooks first (Mr Ace,
  // 2026-10-16), so the page is QuickBooks' data at this moment. A failed
  // read never breaks the page: it shows the stored copy and says so.
  const [refresh, live] = await Promise.all([
    loadCustomerHistory(service, studentNumber)
      .then((r) => (r.errors.length ? r.errors[0] : null))
      .catch((e) => qboErrorMessage(e)),
    Promise.all([
      readCustomerProfile(service, customerId),
      readAging(service, { customerId }),
    ])
      .then(([profile, aging]) => ({
        profile,
        agingRow:
          aging.find((a) => a.customerId === customerId) ??
          aging.find(
            (a) => a.name.toUpperCase() === profile.displayName.toUpperCase()
          ) ??
          null,
      }))
      .catch(() => null),
  ]);

  const [inv, pay, dep, maps] = await Promise.all([
    service
      .from('qbo_invoices')
      .select(INVOICE_COLS)
      .eq('student_number', studentNumber)
      .eq('qbo_customer_id', customerId)
      .eq('realm_id', realmId)
      .order('txn_date', { ascending: false }),
    service
      .from('qbo_payments')
      .select(PAYMENT_COLS)
      .eq('student_number', studentNumber)
      .eq('qbo_customer_id', customerId)
      .eq('realm_id', realmId)
      .order('txn_date', { ascending: false }),
    service
      .from('billing_deposit_accounts')
      .select('qbo_account_id, label, sort')
      .order('sort'),
    loadBillingMaps(service),
  ]);
  for (const r of [inv, pay, dep])
    if (r.error) throw new Error(`Billing lookup failed: ${r.error.message}`);

  const today = todaySg();
  const invoices: InvoiceRowView[] = ((inv.data ?? []) as InvRow[]).map((r) =>
    toInvoiceRow(r, today)
  );
  const docOf = new Map(invoices.map((i) => [i.id, i.docNumber]));
  const label = new Map(
    ((dep.data ?? []) as Array<{ qbo_account_id: string; label: string }>).map(
      (d) => [d.qbo_account_id, d.label]
    )
  );
  const payments: PaymentRowView[] = ((pay.data ?? []) as PayRow[]).map((p) =>
    toPaymentRow(p, docOf, label)
  );

  const live_ = invoices.filter((i) => i.state !== 'voided' && i.balance > 0);
  const overdueRows = live_.filter((i) => i.status === 'overdue');
  const stored = {
    owed: live_.reduce((s, i) => s + i.balance, 0),
    overdue: overdueRows.reduce((s, i) => s + i.balance, 0),
    credit: payments.reduce((s, p) => s + p.unapplied, 0),
  };
  const oldest = [...overdueRows].sort((a, b) =>
    (a.dueDate ?? '').localeCompare(b.dueDate ?? '')
  )[0];

  let stages: CustomerPage['stages'] = null;
  if (student?.enroleeNumber) {
    const [reg, fees] = await Promise.all(
      (['registration', 'fees'] as const).map((s) =>
        readStageSnapshot(
          service,
          student.ayCode,
          student.enroleeNumber,
          s
        ).catch(() => null)
      )
    );
    stages = {
      ayCode: student.ayCode,
      registration: reg?.status ?? null,
      fees: fees?.status ?? null,
    };
  }

  return {
    ...base,
    link: { customerId, displayName: link.display_name as string },
    refreshError: refresh,
    profile: live?.profile ?? null,
    balances: pickBalances({
      stored,
      live: live
        ? { balance: live.profile.balance, agingRow: live.agingRow }
        : null,
    }),
    invoices,
    payments,
    openInvoices: live_.map((i) => ({
      id: i.id,
      docNumber: i.docNumber,
      txnDate: i.txnDate,
      balance: round2(i.balance),
      items: i.items,
    })),
    credits: payments
      .filter((p) => p.unapplied > 0)
      .map((p) => ({
        paymentId: p.id,
        txnDate: p.txnDate,
        unapplied: p.unapplied,
        reference: p.reference,
      })),
    depositAccounts: (
      (dep.data ?? []) as Array<{ qbo_account_id: string; label: string }>
    ).map((d) => ({
      id: d.qbo_account_id,
      label: d.label,
    })),
    maps: mapsToData(maps),
    stages,
    overdueOldest: oldest
      ? { docNumber: oldest.docNumber, dueDate: oldest.dueDate }
      : null,
  };
}
```

- [ ] **Step 2: `components/billing/customer-actions.tsx`**

```tsx
'use client';

import { FilePlus2, HandCoins } from 'lucide-react';
import { useState } from 'react';

import { CreateInvoiceSheet } from '@/components/billing/create-invoice-sheet';
import { RecordPaymentSheet } from '@/components/billing/record-payment-sheet';
import { Button } from '@/components/ui/button';
import type { CreditSource, OpenInvoice } from '@/lib/billing/payment-plan';
import type { MapsData } from '@/lib/billing/view';

// The customer page's two actions. Create invoice is the page's one primary
// button; Record payment is outline. Each sheet mounts fresh on every open.
export function CustomerActions(props: {
  studentNumber: string;
  studentName: string;
  customerEmail: string | null;
  maps: MapsData;
  existing: Array<{
    docNumber: string | null;
    ayCode: string | null;
    stageKeys: string[];
    state: 'open' | 'paid' | 'voided';
  }>;
  openInvoices: Array<OpenInvoice & { items: string }>;
  credits: Array<CreditSource & { reference: string | null }>;
  depositAccounts: Array<{ id: string; label: string }>;
}) {
  const [sheet, setSheet] = useState<'invoice' | 'payment' | null>(null);
  const [key, setKey] = useState(0);
  const open = (s: 'invoice' | 'payment') => {
    setKey((k) => k + 1);
    setSheet(s);
  };
  return (
    <>
      <Button variant="outline" onClick={() => open('payment')}>
        <HandCoins className="size-4" />
        Record payment
      </Button>
      <Button onClick={() => open('invoice')}>
        <FilePlus2 className="size-4" />
        Create invoice
      </Button>
      {sheet === 'invoice' && (
        <CreateInvoiceSheet
          key={`i${key}`}
          open
          onOpenChange={(o) => !o && setSheet(null)}
          studentNumber={props.studentNumber}
          studentName={props.studentName}
          customerEmail={props.customerEmail}
          maps={props.maps}
          existing={props.existing}
        />
      )}
      {sheet === 'payment' && (
        <RecordPaymentSheet
          key={`p${key}`}
          open
          onOpenChange={(o) => !o && setSheet(null)}
          studentNumber={props.studentNumber}
          studentName={props.studentName}
          openInvoices={props.openInvoices}
          credits={props.credits}
          depositAccounts={props.depositAccounts}
          mode="pay"
        />
      )}
    </>
  );
}
```

- [ ] **Step 3: `components/billing/credit-panel.tsx`**

```tsx
'use client';

import { Coins } from 'lucide-react';
import { useState } from 'react';

import { RecordPaymentSheet } from '@/components/billing/record-payment-sheet';
import { Button } from '@/components/ui/button';
import type { CreditSource, OpenInvoice } from '@/lib/billing/payment-plan';
import { formatDay } from '@/lib/billing/view';
import { formatSgd } from '@/lib/qbo/format';

// §9.4 attention panel: unused credit on the customer. HFSE's QuickBooks
// never applies credit by itself, so it waits here until someone uses it.
export function CreditPanel(props: {
  studentNumber: string;
  studentName: string;
  credit: number;
  openInvoices: Array<OpenInvoice & { items: string }>;
  credits: Array<CreditSource & { reference: string | null }>;
  depositAccounts: Array<{ id: string; label: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  const from = props.credits
    .map((c) => `${c.reference ?? 'a payment'} on ${formatDay(c.txnDate)}`)
    .join(', ');
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-brand-amber/40 bg-brand-amber/10 p-5 sm:flex-row sm:items-center">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-amber to-brand-amber/80 text-ink shadow-brand-tile">
        <Coins className="size-4" />
      </div>
      <div className="flex-1 space-y-1">
        <p className="font-serif text-base font-semibold text-foreground">
          {formatSgd(props.credit)} unused credit
        </p>
        <p className="text-sm text-muted-foreground">
          From {from}. QuickBooks doesn&rsquo;t use credit by itself — use it on
          an open invoice.
        </p>
      </div>
      <Button
        variant="outline"
        disabled={props.openInvoices.length === 0}
        title={
          props.openInvoices.length === 0
            ? 'Nothing is owing to use it on.'
            : undefined
        }
        onClick={() => {
          setKey((k) => k + 1);
          setOpen(true);
        }}
      >
        Use credit
      </Button>
      {open && (
        <RecordPaymentSheet
          key={key}
          open
          onOpenChange={setOpen}
          studentNumber={props.studentNumber}
          studentName={props.studentName}
          openInvoices={props.openInvoices}
          credits={props.credits}
          depositAccounts={props.depositAccounts}
          mode="credit"
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: `components/billing/customer-tabs.tsx`**

```tsx
'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import {
  CalendarRange,
  FileText,
  HandCoins,
  SlidersHorizontal,
} from 'lucide-react';

import { InvoiceStatusBadge } from '@/components/billing/invoice-status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { DataTableEmptyState } from '@/components/ui/data-table/empty-state';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { DatePicker } from '@/components/ui/date-picker';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type {
  InvoiceRowView,
  PaymentRowView,
} from '@/lib/billing/customer-page.server';
import type { CustomerProfile } from '@/lib/billing/live.server';
import { INVOICE_STATUS_LABEL, formatDay } from '@/lib/billing/view';
import { formatSgd } from '@/lib/qbo/format';

const NO_TILE = 'No tile';

function invoiceColumns(
  studentNumber: string
): ColumnDef<InvoiceRowView, unknown>[] {
  return [
    {
      id: 'date',
      accessorFn: (r) => r.txnDate ?? '',
      header: ({ column }) => (
        <SortableHeader column={column}>Date</SortableHeader>
      ),
      meta: { label: 'Date' },
      cell: ({ row }) => (
        <span className="whitespace-nowrap tabular-nums">
          {formatDay(row.original.txnDate)}
        </span>
      ),
    },
    {
      id: 'number',
      accessorFn: (r) => r.docNumber ?? '',
      header: ({ column }) => (
        <SortableHeader column={column}>Number</SortableHeader>
      ),
      meta: { label: 'Number' },
      cell: ({ row }) => (
        <IdentifierLink
          href={`/billing/${encodeURIComponent(studentNumber)}/invoices/${encodeURIComponent(row.original.id)}`}
          className="font-mono text-[13px] tabular-nums"
        >
          {row.original.docNumber ?? 'No number'}
        </IdentifierLink>
      ),
      enableHiding: false,
    },
    {
      id: 'for',
      accessorFn: (r) => r.items,
      header: "What it's for",
      meta: { label: "What it's for" },
      cell: ({ row }) => (
        <div className="min-w-60 space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-foreground">{row.original.items}</span>
            {row.original.tile && (
              <Badge
                variant="secondary"
                className="h-5 font-mono text-[10px] uppercase tracking-wider"
              >
                {row.original.tile}
              </Badge>
            )}
          </div>
          {row.original.memo && (
            <div className="text-[12px] text-muted-foreground">
              {row.original.memo}
            </div>
          )}
        </div>
      ),
      enableSorting: false,
    },
    {
      id: 'amount',
      accessorFn: (r) => r.total,
      header: ({ column }) => (
        <div className="flex justify-end">
          <SortableHeader column={column} align="right">
            Amount
          </SortableHeader>
        </div>
      ),
      meta: { label: 'Amount' },
      cell: ({ row }) => (
        <div className="text-right tabular-nums">
          {formatSgd(row.original.total)}
        </div>
      ),
    },
    {
      id: 'balance',
      accessorFn: (r) => r.balance,
      header: ({ column }) => (
        <div className="flex justify-end">
          <SortableHeader column={column} align="right">
            Balance
          </SortableHeader>
        </div>
      ),
      meta: { label: 'Balance' },
      cell: ({ row }) => (
        <div className="text-right tabular-nums">
          {formatSgd(row.original.balance)}
        </div>
      ),
    },
    {
      id: 'due',
      accessorFn: (r) => r.dueDate ?? '',
      header: ({ column }) => (
        <SortableHeader column={column}>Due</SortableHeader>
      ),
      meta: { label: 'Due' },
      cell: ({ row }) => (
        <span className="whitespace-nowrap tabular-nums">
          {formatDay(row.original.dueDate)}
        </span>
      ),
    },
    {
      id: 'status',
      accessorFn: (r) => INVOICE_STATUS_LABEL[r.status],
      header: ({ column }) => (
        <SortableHeader column={column}>Status</SortableHeader>
      ),
      meta: { label: 'Status' },
      cell: ({ row }) => <InvoiceStatusBadge status={row.original.status} />,
    },
    // Filter-only helpers, hidden until switched on from Columns.
    {
      id: 'item',
      accessorFn: (r) => r.itemNames.join(', '),
      header: 'Items',
      meta: { label: 'Items' },
      enableSorting: false,
      filterFn: (row, _id, value) =>
        !Array.isArray(value) ||
        value.length === 0 ||
        row.original.itemNames.some((n) => value.includes(n)),
    },
    {
      id: 'tile',
      accessorFn: (r) => r.tile ?? NO_TILE,
      header: 'Tile',
      meta: { label: 'Tile' },
      enableSorting: false,
    },
    {
      id: 'createdBy',
      accessorFn: (r) => r.createdBy,
      header: 'Created by',
      meta: { label: 'Created by' },
      enableSorting: false,
    },
  ];
}

const paymentColumns: ColumnDef<PaymentRowView, unknown>[] = [
  {
    id: 'date',
    accessorFn: (r) => r.txnDate ?? '',
    header: ({ column }) => (
      <SortableHeader column={column}>Date</SortableHeader>
    ),
    meta: { label: 'Date' },
    cell: ({ row }) => (
      <span className="whitespace-nowrap tabular-nums">
        {formatDay(row.original.txnDate)}
      </span>
    ),
  },
  {
    id: 'account',
    accessorFn: (r) => r.account,
    header: ({ column }) => (
      <SortableHeader column={column}>Account</SortableHeader>
    ),
    meta: { label: 'Account' },
  },
  {
    id: 'reference',
    accessorFn: (r) => r.reference ?? '',
    header: 'Reference',
    meta: { label: 'Reference' },
    cell: ({ row }) => (
      <span className="font-mono text-[13px]">
        {row.original.reference ?? '—'}
      </span>
    ),
    enableSorting: false,
  },
  {
    id: 'paidTowards',
    accessorFn: (r) =>
      r.appliedTo.map((a) => a.docNumber ?? a.invoiceId).join(', '),
    header: 'Paid towards',
    meta: { label: 'Paid towards' },
    cell: ({ row }) =>
      row.original.appliedTo.length === 0 ? (
        <Badge
          variant="outline"
          className="h-6 border-brand-amber/40 bg-brand-amber/10 text-ink"
        >
          Credit, no invoice
        </Badge>
      ) : (
        <span className="font-mono text-[13px] tabular-nums">
          {row.original.appliedTo
            .map((a) => a.docNumber ?? a.invoiceId)
            .join(', ')}
        </span>
      ),
    enableSorting: false,
  },
  {
    id: 'amount',
    accessorFn: (r) => r.total,
    header: ({ column }) => (
      <div className="flex justify-end">
        <SortableHeader column={column} align="right">
          Amount
        </SortableHeader>
      </div>
    ),
    meta: { label: 'Amount' },
    cell: ({ row }) => (
      <div className="text-right tabular-nums">
        {formatSgd(row.original.total)}
      </div>
    ),
  },
  {
    id: 'unused',
    accessorFn: (r) => r.unapplied,
    header: ({ column }) => (
      <div className="flex justify-end">
        <SortableHeader column={column} align="right">
          Unused credit
        </SortableHeader>
      </div>
    ),
    meta: { label: 'Unused credit' },
    cell: ({ row }) => (
      <div className="text-right tabular-nums text-muted-foreground">
        {row.original.unapplied > 0 ? formatSgd(row.original.unapplied) : '—'}
      </div>
    ),
  },
  {
    id: 'recordedBy',
    accessorFn: (r) => r.recordedBy,
    header: 'Recorded by',
    meta: { label: 'Recorded by' },
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {row.original.recordedBy}
      </span>
    ),
    enableSorting: false,
  },
];

/** Date and amount ranges — the two filters a value list can't express. */
function RangeFilters({
  value,
  onChange,
}: {
  value: { from: string; to: string; min: string; max: string };
  onChange: (v: { from: string; to: string; min: string; max: string }) => void;
}) {
  const dateOn = !!(value.from || value.to);
  const amountOn = !!(value.min || value.max);
  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 border-dashed">
            <CalendarRange className="size-3.5" />
            Date
            {dateOn
              ? `: ${formatDay(value.from) === '—' ? '…' : formatDay(value.from)} – ${formatDay(value.to) === '—' ? '…' : formatDay(value.to)}`
              : ''}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="inv-from">From</Label>
            <DatePicker
              id="inv-from"
              value={value.from}
              onChange={(from) => onChange({ ...value, from })}
              placeholder="Any date"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-to">To</Label>
            <DatePicker
              id="inv-to"
              value={value.to}
              onChange={(to) => onChange({ ...value, to })}
              placeholder="Any date"
            />
          </div>
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 border-dashed">
            <SlidersHorizontal className="size-3.5" />
            Amount
            {amountOn ? `: ${value.min || '0'} – ${value.max || 'any'}` : ''}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="inv-min">At least</Label>
              <Input
                id="inv-min"
                inputMode="decimal"
                value={value.min}
                onChange={(e) => onChange({ ...value, min: e.target.value })}
                className="tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-max">At most</Label>
              <Input
                id="inv-max"
                inputMode="decimal"
                value={value.max}
                onChange={(e) => onChange({ ...value, max: e.target.value })}
                className="tabular-nums"
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {(dateOn || amountOn) && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8"
          onClick={() => onChange({ from: '', to: '', min: '', max: '' })}
        >
          Clear dates and amounts
        </Button>
      )}
    </>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{children ?? '—'}</dd>
    </>
  );
}

function CustomerDetails({
  profile,
  studentNumber,
  studentName,
  level,
  linkedName,
}: {
  profile: CustomerProfile | null;
  studentNumber: string;
  studentName: string;
  level: string | null;
  linkedName: string;
}) {
  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            From QuickBooks
          </CardDescription>
          <CardTitle className="font-serif text-lg font-semibold tracking-tight">
            Customer details
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!profile ? (
            <p className="text-sm text-muted-foreground">
              QuickBooks couldn&rsquo;t be reached, so the customer&rsquo;s
              details can&rsquo;t be shown. Refresh to try again.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-x-10 gap-y-6 text-sm md:grid-cols-2">
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
                <Detail label="Customer">
                  <span className="font-mono text-[13px]">
                    {profile.displayName}
                  </span>
                </Detail>
                <Detail label="First name">{profile.givenName}</Detail>
                <Detail label="Middle name">{profile.middleName}</Detail>
                <Detail label="Last name">{profile.familyName}</Detail>
                <Detail label="Company">{profile.companyName}</Detail>
                <Detail label="Status">
                  {profile.active ? (
                    <Badge
                      variant="outline"
                      className="h-6 border-brand-mint bg-brand-mint/30 text-ink"
                    >
                      Active
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="h-6 border-destructive/40 bg-destructive/10 text-destructive"
                    >
                      Inactive
                    </Badge>
                  )}
                </Detail>
                <Detail label="Customer since">
                  {profile.createdAt ? formatDay(profile.createdAt) : null}
                </Detail>
              </dl>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
                <Detail label="Email">{profile.email}</Detail>
                <Detail label="Phone">
                  {profile.phone && (
                    <span className="font-mono text-[13px]">
                      {profile.phone}
                    </span>
                  )}
                </Detail>
                <Detail label="Mobile">
                  {profile.mobile && (
                    <span className="font-mono text-[13px]">
                      {profile.mobile}
                    </span>
                  )}
                </Detail>
                <Detail label="Other">
                  {profile.otherPhone && (
                    <span className="font-mono text-[13px]">
                      {profile.otherPhone}
                    </span>
                  )}
                </Detail>
              </dl>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
                <Detail label="Billing address">
                  {profile.billAddress.length
                    ? profile.billAddress.map((l) => <div key={l}>{l}</div>)
                    : null}
                </Detail>
                <Detail label="Shipping address">
                  {profile.shipAddress
                    ? profile.shipAddress.map((l) => <div key={l}>{l}</div>)
                    : 'Same as billing'}
                </Detail>
              </dl>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
                <Detail label="Terms">{profile.terms}</Detail>
                <Detail label="Payment method">{profile.paymentMethod}</Detail>
                <Detail label="Send invoices by">
                  {profile.deliveryMethod}
                </Detail>
                <Detail label="Currency">{profile.currency}</Detail>
                <Detail label="Notes">{profile.notes}</Detail>
              </dl>
            </div>
          )}
          <p className="mt-6 text-[12px] text-muted-foreground">
            Change these in QuickBooks; they show here the next time the page
            opens.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg font-semibold tracking-tight">
            Linked student
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <Detail label="Student">{studentName}</Detail>
            <Detail label="Student no.">
              <span className="font-mono text-[13px]">{studentNumber}</span>
            </Detail>
            <Detail label="Level">{level}</Detail>
            <Detail label="QuickBooks customer">{linkedName}</Detail>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

export function CustomerTabs({
  studentNumber,
  studentName,
  level,
  linkedName,
  invoices,
  payments,
  profile,
  initialTab,
}: {
  studentNumber: string;
  studentName: string;
  level: string | null;
  linkedName: string;
  invoices: InvoiceRowView[];
  payments: PaymentRowView[];
  profile: CustomerProfile | null;
  /** `?tab=payments` / `?tab=details` — the invoice page's "View payment" opens Payments. */
  initialTab: 'invoices' | 'payments' | 'details';
}) {
  const [range, setRange] = React.useState({
    from: '',
    to: '',
    min: '',
    max: '',
  });
  const columns = React.useMemo(
    () => invoiceColumns(studentNumber),
    [studentNumber]
  );
  const shown = React.useMemo(() => {
    const min = range.min.trim() === '' ? null : Number(range.min);
    const max = range.max.trim() === '' ? null : Number(range.max);
    return invoices.filter((i) => {
      const d = i.txnDate?.slice(0, 10) ?? '';
      if (range.from && d < range.from) return false;
      if (range.to && d > range.to) return false;
      if (min !== null && Number.isFinite(min) && i.total < min) return false;
      if (max !== null && Number.isFinite(max) && i.total > max) return false;
      return true;
    });
  }, [invoices, range]);
  const facets = React.useMemo(
    () => [
      {
        columnId: 'status',
        label: 'Status',
        valueOptions: [
          ...new Set(invoices.map((i) => INVOICE_STATUS_LABEL[i.status])),
        ],
      },
      {
        columnId: 'item',
        label: 'Item',
        valueOptions: [...new Set(invoices.flatMap((i) => i.itemNames))].sort(),
      },
      {
        columnId: 'tile',
        label: 'Tile',
        valueOptions: [
          ...new Set(invoices.map((i) => i.tile ?? NO_TILE)),
        ].sort(),
      },
      {
        columnId: 'createdBy',
        label: 'Created by',
        valueOptions: [...new Set(invoices.map((i) => i.createdBy))].sort(),
      },
    ],
    [invoices]
  );

  return (
    <Tabs defaultValue={initialTab} className="gap-4">
      <TabsList>
        <TabsTrigger value="invoices">
          Invoices{' '}
          <span className="ml-1.5 tabular-nums text-muted-foreground">
            {invoices.length}
          </span>
        </TabsTrigger>
        <TabsTrigger value="payments">
          Payments{' '}
          <span className="ml-1.5 tabular-nums text-muted-foreground">
            {payments.length}
          </span>
        </TabsTrigger>
        <TabsTrigger value="details">Customer details</TabsTrigger>
      </TabsList>
      <TabsContent value="invoices">
        {invoices.length === 0 ? (
          <Card className="py-0">
            <DataTableEmptyState
              icon={FileText}
              title="No invoices yet"
              body="Invoices made here or in QuickBooks for this customer appear here, newest first."
            />
          </Card>
        ) : (
          <DataTable<InvoiceRowView>
            data={shown}
            columns={columns}
            getRowId={(r) => r.id}
            searchKeys={[
              (r) => r.docNumber ?? '',
              (r) => r.items,
              (r) => r.memo ?? '',
            ]}
            searchPlaceholder="Search number, item or memo"
            facets={facets}
            toolbarFilters={<RangeFilters value={range} onChange={setRange} />}
            initialColumnVisibility={{
              item: false,
              tile: false,
              createdBy: false,
            }}
            initialSort={[{ id: 'date', desc: true }]}
            url={{ enabled: true, namespace: 'billing-invoices' }}
            pageSize={25}
            csv={{ filename: `billing-${studentNumber}-invoices.csv` }}
            emptyFilteredState={{
              title: 'No invoices match.',
              body: 'Clear the search, a filter, or the date and amount ranges.',
            }}
          />
        )}
      </TabsContent>
      <TabsContent value="payments">
        {payments.length === 0 ? (
          <Card className="py-0">
            <DataTableEmptyState
              icon={HandCoins}
              title="No payments yet"
              body="Payments recorded here or in QuickBooks for this customer appear here, newest first."
            />
          </Card>
        ) : (
          <DataTable<PaymentRowView>
            data={payments}
            columns={paymentColumns}
            getRowId={(r) => r.id}
            searchKeys={[(r) => r.reference ?? '', (r) => r.account]}
            searchPlaceholder="Search reference or account"
            facets={[
              {
                columnId: 'account',
                label: 'Account',
                valueOptions: [...new Set(payments.map((p) => p.account))],
              },
            ]}
            initialSort={[{ id: 'date', desc: true }]}
            url={{ enabled: true, namespace: 'billing-payments' }}
            pageSize={25}
            csv={{ filename: `billing-${studentNumber}-payments.csv` }}
            emptyFilteredState={{
              title: 'No payments match.',
              body: 'Clear the search or a filter.',
            }}
          />
        )}
      </TabsContent>
      <TabsContent value="details">
        <CustomerDetails
          profile={profile}
          studentNumber={studentNumber}
          studentName={studentName}
          level={level}
          linkedName={linkedName}
        />
      </TabsContent>
    </Tabs>
  );
}
```

- [ ] **Step 5: `app/(billing)/billing/[studentNumber]/page.tsx`**

```tsx
import {
  AlertTriangle,
  ArrowLeft,
  Coins,
  Layers,
  UserSearch,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { CreditPanel } from '@/components/billing/credit-panel';
import { CustomerActions } from '@/components/billing/customer-actions';
import { CustomerTabs } from '@/components/billing/customer-tabs';
import { NotConnectedPanel } from '@/components/billing/not-connected-panel';
import { RefreshButton } from '@/components/billing/refresh-button';
import { MetricCard } from '@/components/dashboard/metric-card';
import { Button } from '@/components/ui/button';
import { PageShell } from '@/components/ui/page-shell';
import { loadCustomerPage } from '@/lib/billing/customer-page.server';
import { formatDay } from '@/lib/billing/view';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { formatSgd } from '@/lib/qbo/format';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Billing → one student. Everything billed to their QuickBooks customer,
// newest first, no year filter (Mr Ace: "historical not focused on AY …
// just like an audit log"). Reads the customer from QuickBooks every time it
// opens.
export default async function BillingCustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentNumber: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!canInvoiceInQbo(sessionUser.role)) redirect('/');
  const [{ studentNumber }, { tab }] = await Promise.all([
    params,
    searchParams,
  ]);
  const initialTab = tab === 'payments' || tab === 'details' ? tab : 'invoices';
  const page = await loadCustomerPage(
    createServiceClient(),
    decodeURIComponent(studentNumber)
  );
  if (!page) notFound();

  const name =
    page.student?.name ?? page.link?.displayName ?? page.studentNumber;
  const b = page.balances;
  const openCount = page.openInvoices.length;

  return (
    <PageShell>
      <Link
        href="/billing"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Customers
      </Link>

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Billing · {page.studentNumber}
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            {name}.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            {page.link ? (
              <>
                QuickBooks customer{' '}
                <span className="font-mono text-[13px] text-foreground">
                  {page.link.displayName}
                </span>
                {page.profile?.companyName
                  ? ` · Parents: ${page.profile.companyName}`
                  : ''}
                {page.student?.level
                  ? ` · ${page.student.level}, ${page.student.ayCode}`
                  : ''}
              </>
            ) : (
              'Not linked to a QuickBooks customer yet.'
            )}
          </p>
        </div>
        {page.link && page.connected && (
          <div className="flex flex-wrap items-center gap-2">
            <RefreshButton label="Refresh" />
            <CustomerActions
              studentNumber={page.studentNumber}
              studentName={name}
              customerEmail={page.profile?.email ?? null}
              maps={page.maps}
              existing={page.invoices.map((i) => ({
                docNumber: i.docNumber,
                ayCode: i.ayCode,
                stageKeys: i.stageKeys,
                state: i.state,
              }))}
              openInvoices={page.openInvoices}
              credits={page.credits}
              depositAccounts={page.depositAccounts}
            />
          </div>
        )}
      </header>

      {!page.connected ? (
        <NotConnectedPanel canConnect={sessionUser.role === 'superadmin'} />
      ) : !page.link ? (
        <div className="flex items-start gap-4 rounded-xl border border-primary/30 bg-accent p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <UserSearch className="size-4" />
          </div>
          <div className="flex-1 space-y-1.5">
            <p className="font-serif text-base font-semibold text-foreground">
              Find their QuickBooks customer
            </p>
            <p className="text-sm text-muted-foreground">
              The SIS couldn&rsquo;t match this student to a QuickBooks customer
              by itself. Pick the right one, or add them to QuickBooks.
            </p>
            <Button asChild variant="outline" size="sm" className="mt-2">
              <Link
                href={`/billing/review?student=${encodeURIComponent(page.studentNumber)}`}
              >
                Open in To review
              </Link>
            </Button>
          </div>
        </div>
      ) : (
        <>
          {page.refreshError && (
            <div className="flex items-start gap-4 rounded-xl border border-brand-amber/40 bg-brand-amber/10 p-5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-amber to-brand-amber/80 text-ink shadow-brand-tile">
                <AlertTriangle className="size-4" />
              </div>
              <div className="flex-1 space-y-1.5">
                <p className="font-serif text-base font-semibold text-foreground">
                  Showing what the SIS last read
                </p>
                <p className="text-sm text-muted-foreground">
                  {page.refreshError} Refresh to try QuickBooks again.
                </p>
              </div>
            </div>
          )}

          <div className="@container/main">
            <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @3xl/main:grid-cols-4">
              <MetricCard
                label="Open balance"
                value={formatSgd(b.owedOnInvoices)}
                icon={Wallet}
                subtext={
                  b.credit > 0
                    ? `${openCount} open invoices · ${formatSgd(b.openBalance)} after credit, as QuickBooks shows it`
                    : `${openCount} open invoices`
                }
              />
              <MetricCard
                label="Overdue"
                value={formatSgd(b.overdue)}
                icon={AlertTriangle}
                intent={b.overdue > 0 ? 'bad' : 'default'}
                subtext={
                  page.overdueOldest
                    ? `${page.overdueOldest.docNumber ?? 'An invoice'}, due ${formatDay(page.overdueOldest.dueDate)}`
                    : 'Nothing past its due date'
                }
              />
              <MetricCard
                label="Credit"
                value={formatSgd(b.credit)}
                icon={Coins}
                intent={b.credit > 0 ? 'warning' : 'default'}
                subtext={
                  b.credit > 0 ? 'Unused — see below' : 'No unused credit'
                }
              />
              <MetricCard
                label="Registration · Fees"
                value={
                  page.stages
                    ? `${page.stages.registration ?? '—'} · ${page.stages.fees ?? '—'}`
                    : '—'
                }
                icon={Layers}
                subtext={
                  page.stages
                    ? `${page.stages.ayCode} stages, filled from these invoices`
                    : 'No application on record'
                }
              />
            </div>
          </div>

          {b.credit > 0 && (
            <CreditPanel
              studentNumber={page.studentNumber}
              studentName={name}
              credit={b.credit}
              openInvoices={page.openInvoices}
              credits={page.credits}
              depositAccounts={page.depositAccounts}
            />
          )}

          <CustomerTabs
            studentNumber={page.studentNumber}
            studentName={name}
            level={page.student?.level ?? null}
            linkedName={page.link.displayName}
            invoices={page.invoices}
            payments={page.payments}
            profile={page.profile}
            initialTab={initialTab}
          />

          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {b.source === 'quickbooks'
              ? 'Read from QuickBooks just now'
              : 'Balances added up from the last QuickBooks read'}{' '}
            · QuickBooks is the record for money · Every action is in the audit
            log
          </p>
        </>
      )}
    </PageShell>
  );
}
```

- [ ] **Step 6: `app/(billing)/billing/[studentNumber]/loading.tsx`**

```tsx
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SkeletonCards,
  SkeletonTable,
  SkeletonText,
} from '@/components/ui/skeleton-layouts';

/** Mirrors `[studentNumber]/page.tsx` — back link, header, four stat cards, tabs + table. */
export default function Loading() {
  return (
    <PageShell>
      <Skeleton className="h-5 w-28" />
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-40" />
          <SkeletonText variant="headline" className="w-96 max-w-full" />
          <SkeletonText variant="body" className="w-120 max-w-full" />
        </div>
        <Skeleton className="h-9 w-80" />
      </header>
      <div className="@container/main">
        <SkeletonCards
          count={4}
          grid="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @3xl/main:grid-cols-4"
        />
      </div>
      <Skeleton className="h-9 w-80" />
      <SkeletonTable columns={7} rows={10} />
    </PageShell>
  );
}
```

- [ ] **Step 7: Check it in the browser**

Run: `npx tsc --noEmit` and `npx vitest run --pool=threads __tests__/ui/data-table-column-label-coverage.test.ts __tests__/billing`
Expected: clean, PASS.

Open `/billing`, click a student with a Fees invoice. Expected: header with the QuickBooks customer and parents; four stat cards; Invoices newest first with tile tags and the n8n memo; Payments; Customer details filled from QuickBooks. Click **Record payment**: the open invoices are ticked oldest first and the plan shows what each pays. Open MARQUEZ, Zara Grace A. (the sandbox has S$30 credit there from the 2026-10-16 check): the Credit card shows S$30.00 and the amber credit panel appears with **Use credit**. (The QuickBooks-unreachable path is covered by `pickBalances`'s test and the `.catch` on every live read in the loader; don't fake an outage.)

- [ ] **Step 8: Commit**

```bash
git add lib/billing/customer-page.server.ts components/billing/customer-actions.tsx components/billing/credit-panel.tsx components/billing/customer-tabs.tsx "app/(billing)/billing/[studentNumber]/page.tsx" "app/(billing)/billing/[studentNumber]/loading.tsx" && git commit -m "feat(billing): customer page — every invoice and payment, credit, customer details, read live

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 4.8: Invoice page (`/billing/[studentNumber]/invoices/[invoiceId]`)

**Files:**

- Create: `lib/billing/invoice-page.server.ts`
- Create: `components/billing/invoice-activity.tsx`
- Create: `components/billing/invoice-pay-button.tsx`
- Create: `app/(billing)/billing/[studentNumber]/invoices/[invoiceId]/page.tsx`
- Create: `app/(billing)/billing/[studentNumber]/invoices/[invoiceId]/loading.tsx`

**Interfaces:**

- Consumes: `readInvoiceDetail`, `readCustomerProfile`, `InvoiceDetail` (Task 4.2); `buildInvoiceActivity`, `ActivityEvent`, `formatDateTime` (Task 4.1); `INVOICE_COLS`, `InvRow`, `toInvoiceRow`, `PAYMENT_COLS`, `PayRow`, `toPaymentRow`, `InvoiceRowView`, `PaymentRowView` (Task 4.7); `loadCustomerHistory`; `loadStudentInfo`; `qboInvoiceUrl` (`lib/qbo/env.ts`); `SendInvoiceButton` (Task 4.5); `RecordPaymentSheet` (Task 4.6); `InvoiceStatusBadge`, `RefreshButton` (Task 4.4).
- Produces: `type InvoicePage`, `loadInvoicePage(service, studentNumber, qboInvoiceId): Promise<InvoicePage | null>`.

- [ ] **Step 1: `lib/billing/invoice-page.server.ts`**

```ts
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  buildInvoiceActivity,
  type ActivityEvent,
} from '@/lib/billing/activity';
import {
  INVOICE_COLS,
  PAYMENT_COLS,
  toInvoiceRow,
  toPaymentRow,
  type InvRow,
  type InvoiceRowView,
  type PayRow,
  type PaymentRowView,
} from '@/lib/billing/customer-page.server';
import { loadCustomerHistory } from '@/lib/billing/history.server';
import {
  readCustomerProfile,
  readInvoiceDetail,
  type CustomerProfile,
  type InvoiceDetail,
} from '@/lib/billing/live.server';
import type { CreditSource } from '@/lib/billing/payment-plan';
import { loadStudentInfo } from '@/lib/billing/students.server';
import { round2, todaySg } from '@/lib/billing/view';
import { connectedRealmId, qboErrorMessage } from '@/lib/qbo/client';
import { qboInvoiceUrl } from '@/lib/qbo/env';

export type InvoicePage = {
  studentNumber: string;
  studentName: string;
  customerName: string;
  row: InvoiceRowView;
  detail: InvoiceDetail | null;
  detailError: string | null;
  profile: CustomerProfile | null;
  activity: ActivityEvent[];
  /** Payments applied to THIS invoice, with the amount each put on it. */
  payments: Array<PaymentRowView & { onThisInvoice: number }>;
  qbUrl: string;
  credits: Array<CreditSource & { reference: string | null }>;
  depositAccounts: Array<{ id: string; label: string }>;
};

const SIS_NOTE = /^Created from SIS by (.+)$/;

export async function loadInvoicePage(
  service: SupabaseClient,
  studentNumber: string,
  qboInvoiceId: string
): Promise<InvoicePage | null> {
  const realmId = await connectedRealmId(service).catch(() => null);
  if (!realmId) return null;
  const { data: link } = await service
    .from('qbo_customers')
    .select('qbo_customer_id, display_name')
    .eq('student_number', studentNumber)
    .eq('realm_id', realmId)
    .maybeSingle();
  if (!link) return null;

  // Read live, like the customer page: the invoice in full, the customer's
  // contact details, and a refresh of the stored copy for the payments.
  const [detail, profile] = await Promise.all([
    readInvoiceDetail(service, qboInvoiceId).then(
      (d) => ({ d, e: null as string | null }),
      (e) => ({ d: null, e: qboErrorMessage(e) })
    ),
    readCustomerProfile(service, link.qbo_customer_id as string).catch(
      () => null
    ),
    loadCustomerHistory(service, studentNumber).catch(() => null),
  ]);
  if (detail.d && detail.d.customerId !== link.qbo_customer_id) return null;

  const [inv, pays, sends, dep, conn, info] = await Promise.all([
    service
      .from('qbo_invoices')
      .select(INVOICE_COLS)
      .eq('qbo_invoice_id', qboInvoiceId)
      .eq('student_number', studentNumber)
      .eq('realm_id', realmId)
      .maybeSingle(),
    service
      .from('qbo_payments')
      .select(PAYMENT_COLS)
      .eq('qbo_customer_id', link.qbo_customer_id)
      .eq('realm_id', realmId),
    service
      .from('audit_log')
      .select('created_at, actor_email, context')
      .eq('action', 'qbo.invoice.send')
      .eq('entity_id', qboInvoiceId)
      .order('created_at', { ascending: true }),
    service
      .from('billing_deposit_accounts')
      .select('qbo_account_id, label, sort')
      .order('sort'),
    service
      .from('qbo_connection')
      .select('environment')
      .eq('id', 1)
      .maybeSingle(),
    loadStudentInfo(service, [studentNumber]),
  ]);
  if (!inv.data) return null;
  const row = toInvoiceRow(inv.data as InvRow, todaySg());
  const label = new Map(
    ((dep.data ?? []) as Array<{ qbo_account_id: string; label: string }>).map(
      (d) => [d.qbo_account_id, d.label]
    )
  );
  const allPayments = ((pays.data ?? []) as PayRow[]).map((p) =>
    toPaymentRow(p, new Map([[row.id, row.docNumber]]), label)
  );
  const payments = allPayments
    .map((p) => ({
      ...p,
      onThisInvoice: round2(
        p.appliedTo
          .filter((a) => a.invoiceId === row.id)
          .reduce((s, a) => s + a.amount, 0)
      ),
    }))
    .filter((p) => p.onThisInvoice > 0);

  const note = detail.d?.privateNote?.match(SIS_NOTE)?.[1] ?? null;
  const activity = buildInvoiceActivity({
    createdAt: detail.d?.createdAt ?? row.txnDate,
    createdBy: note ?? row.createdBy,
    sends: (
      (sends.data ?? []) as Array<{
        created_at: string;
        actor_email: string;
        context: { sent_to?: string | null };
      }>
    ).map((s) => ({
      at: s.created_at,
      to: s.context?.sent_to ?? null,
      by: s.actor_email,
    })),
    qbDelivery: detail.d?.delivery ?? null,
    payments: payments.map((p) => ({
      id: p.id,
      txnDate: p.txnDate,
      account: p.account,
      reference: p.reference,
      amount: p.onThisInvoice,
    })),
    state: detail.d?.state ?? row.state,
    balance: detail.d?.balance ?? row.balance,
    voidedAt:
      (detail.d?.state ?? row.state) === 'voided'
        ? (detail.d?.updatedAt ?? null)
        : null,
  });

  return {
    studentNumber,
    studentName: info.get(studentNumber)?.name ?? (link.display_name as string),
    customerName: link.display_name as string,
    row,
    detail: detail.d,
    detailError: detail.e,
    profile,
    activity,
    payments,
    qbUrl: qboInvoiceUrl(
      (conn.data?.environment as 'sandbox' | 'production' | undefined) ??
        'sandbox',
      qboInvoiceId
    ),
    credits: allPayments
      .filter((p) => p.unapplied > 0)
      .map((p) => ({
        paymentId: p.id,
        txnDate: p.txnDate,
        unapplied: p.unapplied,
        reference: p.reference,
      })),
    depositAccounts: (
      (dep.data ?? []) as Array<{ qbo_account_id: string; label: string }>
    ).map((d) => ({
      id: d.qbo_account_id,
      label: d.label,
    })),
  };
}
```

- [ ] **Step 2: `components/billing/invoice-activity.tsx`**

```tsx
import Link from 'next/link';

import { formatDateTime, type ActivityEvent } from '@/lib/billing/activity';
import { cn } from '@/lib/utils';

// QuickBooks-style Invoice activity: a vertical line of events. Done = filled
// indigo, paid = mint, not yet / not available = dashed, voided = destructive.
const DOT: Record<ActivityEvent['tone'], string> = {
  done: 'border-primary bg-primary',
  paid: 'border-brand-mint bg-brand-mint',
  off: 'border-dashed border-border bg-card',
  void: 'border-destructive bg-destructive',
};

export function InvoiceActivity({
  events,
  paymentHref,
}: {
  events: ActivityEvent[];
  /** Where "View payment" goes (the customer page's Payments tab). */
  paymentHref: string;
}) {
  return (
    <ol className="flex flex-col">
      {events.map((e, i) => (
        <li
          key={e.key}
          className="relative grid grid-cols-[18px_1fr] gap-3 pb-5 last:pb-0"
        >
          {i < events.length - 1 && (
            <span
              aria-hidden
              className="absolute bottom-0 left-2 top-5 w-0.5 bg-border"
            />
          )}
          <span
            aria-hidden
            className={cn(
              'mt-0.5 size-[18px] rounded-full border-2',
              DOT[e.tone]
            )}
          />
          <div className="min-w-0">
            <p
              className={cn(
                'text-sm font-semibold text-foreground',
                e.tone === 'off' && 'font-medium text-muted-foreground'
              )}
            >
              {e.label}
            </p>
            {(e.when || e.detail) && (
              <p className="mt-0.5 text-[12px] tabular-nums text-muted-foreground">
                {[e.when ? formatDateTime(e.when) : null, e.detail]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
            {e.paymentId && (
              <Link
                href={paymentHref}
                className="text-[12px] text-primary underline-offset-4 hover:underline"
              >
                View payment
              </Link>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 3: `components/billing/invoice-pay-button.tsx`**

```tsx
'use client';

import { HandCoins } from 'lucide-react';
import { useState } from 'react';

import { RecordPaymentSheet } from '@/components/billing/record-payment-sheet';
import { Button } from '@/components/ui/button';
import type { CreditSource, OpenInvoice } from '@/lib/billing/payment-plan';

// The invoice page's primary action: Record payment with only this invoice
// listed.
export function InvoicePayButton(props: {
  studentNumber: string;
  studentName: string;
  invoice: OpenInvoice & { items: string };
  credits: Array<CreditSource & { reference: string | null }>;
  depositAccounts: Array<{ id: string; label: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      <Button
        onClick={() => {
          setKey((k) => k + 1);
          setOpen(true);
        }}
      >
        <HandCoins className="size-4" />
        Record payment
      </Button>
      {open && (
        <RecordPaymentSheet
          key={key}
          open
          onOpenChange={setOpen}
          studentNumber={props.studentNumber}
          studentName={props.studentName}
          openInvoices={[props.invoice]}
          credits={props.credits}
          depositAccounts={props.depositAccounts}
          mode="pay"
        />
      )}
    </>
  );
}
```

- [ ] **Step 4: The page**

`app/(billing)/billing/[studentNumber]/invoices/[invoiceId]/page.tsx`:

```tsx
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CalendarX2,
  ExternalLink,
  ReceiptText,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { InvoiceActivity } from '@/components/billing/invoice-activity';
import { InvoicePayButton } from '@/components/billing/invoice-pay-button';
import { InvoiceStatusBadge } from '@/components/billing/invoice-status-badge';
import { RefreshButton } from '@/components/billing/refresh-button';
import { SendInvoiceButton } from '@/components/billing/send-invoice-button';
import { MetricCard } from '@/components/dashboard/metric-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { loadInvoicePage } from '@/lib/billing/invoice-page.server';
import { formatDay, todaySg } from '@/lib/billing/view';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { formatSgd } from '@/lib/qbo/format';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

const daysBetween = (a: string, b: string) =>
  Math.round(
    (Date.parse(`${b}T00:00:00`) - Date.parse(`${a}T00:00:00`)) / 86_400_000
  );

// One invoice, laid out like QuickBooks' own view (Mr Ace, 2026-10-16):
// lines with each line's GST code, totals, billing address, Invoice activity.
export default async function BillingInvoicePage({
  params,
}: {
  params: Promise<{ studentNumber: string; invoiceId: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!canInvoiceInQbo(sessionUser.role)) redirect('/');
  const { studentNumber: sn, invoiceId } = await params;
  const studentNumber = decodeURIComponent(sn);
  const page = await loadInvoicePage(
    createServiceClient(),
    studentNumber,
    decodeURIComponent(invoiceId)
  );
  if (!page) notFound();

  const d = page.detail;
  const total = d?.total ?? page.row.total;
  const balance = d?.balance ?? page.row.balance;
  const paid = Math.max(0, Math.round((total - balance) * 100) / 100);
  const today = todaySg();
  const due = d?.dueDate ?? page.row.dueDate;
  const overdueDays =
    due && balance > 0 && due < today ? daysBetween(due, today) : 0;
  const isVoided = (d?.state ?? page.row.state) === 'voided';
  const sent = page.activity.some((e) => e.label === 'Sent');
  const sendBlocked = isVoided
    ? 'A voided invoice can’t be sent.'
    : !(d?.billEmail ?? page.profile?.email)
      ? 'The QuickBooks customer has no email.'
      : null;
  const customerHref = `/billing/${encodeURIComponent(studentNumber)}`;
  const address = d?.billAddress.length
    ? d.billAddress
    : (page.profile?.billAddress ?? []);

  return (
    <PageShell>
      <Link
        href={customerHref}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {page.studentName}
      </Link>

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Billing · {page.customerName} · Invoice
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Invoice {page.row.docNumber ?? 'without a number'}.
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <InvoiceStatusBadge status={page.row.status} />
            {page.row.tile && (
              <Badge
                variant="secondary"
                className="h-6 font-mono text-[10px] uppercase tracking-wider"
              >
                {page.row.tile}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RefreshButton label="Refresh" />
          <Button asChild variant="ghost">
            <a href={page.qbUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4" />
              Open in QuickBooks
            </a>
          </Button>
          <SendInvoiceButton
            qboInvoiceId={page.row.id}
            label={sent ? 'Send again' : 'Send'}
            disabledReason={sendBlocked}
          />
          {!isVoided && balance > 0 && (
            <InvoicePayButton
              studentNumber={studentNumber}
              studentName={page.studentName}
              invoice={{
                id: page.row.id,
                docNumber: page.row.docNumber,
                txnDate: page.row.txnDate,
                balance,
                items: page.row.items,
              }}
              credits={page.credits}
              depositAccounts={page.depositAccounts}
            />
          )}
        </div>
      </header>

      {page.detailError && (
        <div className="flex items-start gap-4 rounded-xl border border-brand-amber/40 bg-brand-amber/10 p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-amber to-brand-amber/80 text-ink shadow-brand-tile">
            <AlertTriangle className="size-4" />
          </div>
          <div className="flex-1 space-y-1.5">
            <p className="font-serif text-base font-semibold text-foreground">
              Showing what the SIS last read
            </p>
            <p className="text-sm text-muted-foreground">
              {page.detailError} GST codes and the billing address need
              QuickBooks; refresh to try again.
            </p>
          </div>
        </div>
      )}

      <div className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @3xl/main:grid-cols-4">
          <MetricCard
            label="Total"
            value={formatSgd(total)}
            icon={ReceiptText}
            subtext={d ? `GST ${formatSgd(d.tax)}` : undefined}
          />
          <MetricCard
            label="Balance"
            value={formatSgd(balance)}
            icon={Wallet}
            intent={overdueDays > 0 ? 'bad' : 'default'}
            subtext={`${formatSgd(paid)} paid`}
          />
          <MetricCard
            label="Invoice date"
            value={formatDay(d?.txnDate ?? page.row.txnDate)}
            icon={CalendarDays}
            subtext={d?.terms ? `Terms: ${d.terms}` : undefined}
          />
          <MetricCard
            label="Due date"
            value={formatDay(due)}
            icon={CalendarX2}
            intent={overdueDays > 0 ? 'bad' : 'default'}
            subtext={
              overdueDays > 0
                ? `${overdueDays} days overdue`
                : balance > 0
                  ? 'Not overdue'
                  : 'Nothing owing'
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="gap-0 py-0">
          <CardHeader className="border-b border-border py-4">
            <CardTitle className="font-serif text-lg font-semibold tracking-tight">
              Lines
            </CardTitle>
            <CardDescription>
              GST follows each item&rsquo;s tax code in QuickBooks.
            </CardDescription>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead>GST</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(d?.lines ?? []).map((l, i) => (
                <TableRow key={i}>
                  <TableCell className="text-foreground">
                    {l.itemName ?? '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {l.description ?? ''}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {l.qty ?? ''}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {l.rate != null ? formatSgd(l.rate) : ''}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {l.taxCode ?? '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatSgd(l.amount)}
                  </TableCell>
                </TableRow>
              ))}
              {!d && (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    {page.row.items}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <dl className="ml-auto grid w-full max-w-sm grid-cols-[1fr_auto] gap-x-8 gap-y-1.5 border-t border-border px-6 py-4 text-sm">
            {d && (
              <>
                <dt className="text-right text-muted-foreground">Subtotal</dt>
                <dd className="text-right tabular-nums">
                  {formatSgd(d.subtotal)}
                </dd>
                <dt className="text-right text-muted-foreground">GST</dt>
                <dd className="text-right tabular-nums">{formatSgd(d.tax)}</dd>
              </>
            )}
            <dt className="text-right font-semibold">Total</dt>
            <dd className="text-right font-semibold tabular-nums">
              {formatSgd(total)}
            </dd>
            <dt className="text-right text-muted-foreground">Paid</dt>
            <dd className="text-right tabular-nums">−{formatSgd(paid)}</dd>
            <dt className="text-right font-serif text-base font-semibold">
              Balance due
            </dt>
            <dd className="text-right font-serif text-base font-semibold tabular-nums">
              {formatSgd(balance)}
            </dd>
          </dl>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-t border-border px-6 py-4 text-sm">
            <dt className="text-muted-foreground">Message on invoice</dt>
            <dd>{d?.customerMemo ?? page.row.memo ?? '—'}</dd>
            <dt className="text-muted-foreground">Memo</dt>
            <dd>{d?.privateNote ?? '—'}</dd>
            <dt className="text-muted-foreground">Location</dt>
            <dd>{d?.location ?? '—'}</dd>
          </dl>
        </Card>

        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="font-serif text-lg font-semibold tracking-tight">
                Invoice activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <InvoiceActivity
                events={page.activity}
                paymentHref={`${customerHref}?tab=payments`}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="font-serif text-lg font-semibold tracking-tight">
                Billing address
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="leading-relaxed">
                {page.customerName}
                {page.profile?.companyName && (
                  <>
                    <br />
                    {page.profile.companyName}
                  </>
                )}
                {address.map((l) => (
                  <span key={l}>
                    <br />
                    {l}
                  </span>
                ))}
              </p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5">
                <dt className="text-muted-foreground">Email</dt>
                <dd>
                  {[d?.billEmail ?? page.profile?.email, d?.billEmailCc]
                    .filter(Boolean)
                    .join(', ') || '—'}
                </dd>
                <dt className="text-muted-foreground">Phone</dt>
                <dd className="font-mono text-[13px]">
                  {page.profile?.phone ?? '—'}
                </dd>
                <dt className="text-muted-foreground">Mobile</dt>
                <dd className="font-mono text-[13px]">
                  {page.profile?.mobile ?? '—'}
                </dd>
                <dt className="text-muted-foreground">Other</dt>
                <dd className="font-mono text-[13px]">
                  {page.profile?.otherPhone ?? '—'}
                </dd>
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>

      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        Read from QuickBooks just now · Viewed is shown in QuickBooks only ·
        Every action is in the audit log
      </p>
    </PageShell>
  );
}
```

`…/[invoiceId]/loading.tsx`:

```tsx
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonCards, SkeletonText } from '@/components/ui/skeleton-layouts';

/** Mirrors the invoice page — back link, header, four stat cards, lines + side cards. */
export default function Loading() {
  return (
    <PageShell>
      <Skeleton className="h-5 w-40" />
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-56" />
          <SkeletonText variant="headline" className="w-96 max-w-full" />
          <Skeleton className="h-6 w-40" />
        </div>
        <Skeleton className="h-9 w-96 max-w-full" />
      </header>
      <div className="@container/main">
        <SkeletonCards
          count={4}
          grid="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @3xl/main:grid-cols-4"
        />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Skeleton className="h-96 rounded-xl" />
        <div className="space-y-6">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      </div>
    </PageShell>
  );
}
```

- [ ] **Step 5: Check it**

Run: `npx tsc --noEmit`
Expected: clean.

From a customer page click an invoice number. Expected: header "Invoice HFSE0….", status and tile tag; four cards; lines with a GST column (`No tax` / `Taxable` in the US sandbox); totals; Invoice activity with Opened, Viewed greyed "Shown in QuickBooks only", any payments, and Paid or "S$… still due"; billing address and phones from the seed. Click **Send** on an invoice of a student whose customer has an email: success toast "Emailed to …@example.test", reload shows a Sent line with your email as sender.

- [ ] **Step 6: Commit**

```bash
git add lib/billing/invoice-page.server.ts components/billing/invoice-activity.tsx components/billing/invoice-pay-button.tsx "app/(billing)/billing/[studentNumber]/invoices/[invoiceId]/page.tsx" "app/(billing)/billing/[studentNumber]/invoices/[invoiceId]/loading.tsx" && git commit -m "feat(billing): invoice page — lines with GST codes, totals, invoice activity, send and pay

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 4.9: To review (`/billing/review`) — link, pick another, add to QuickBooks

**Files:**

- Create: `lib/billing/review.ts`
- Test: `__tests__/billing/review.test.ts`
- Create: `lib/billing/link-student.server.ts`
- Modify: `app/api/billing/students/[studentNumber]/link/route.ts` (thin wrapper over `linkStudentToCustomer`)
- Create: `app/api/billing/customers/route.ts` (search)
- Create: `app/api/billing/students/[studentNumber]/customer/route.ts` (add to QuickBooks + link)
- Create: `lib/billing/review.server.ts`
- Create: `components/billing/pick-customer-sheet.tsx`
- Create: `components/billing/review-board.tsx`
- Create: `app/(billing)/billing/review/page.tsx`
- Create: `app/(billing)/billing/review/loading.tsx`

**Interfaces:**

- Consumes: `ALREADY_LINKED_REASON` (`lib/billing/link-claims.ts`); `loadCustomerHistory`, `syncTilesForStudent`; `loadStudentInfo` (Task 4.2); `getCurrentAcademicYear`, `getUpcomingAcademicYear` (`lib/academic-year.ts`); `qbEscape`, `qboQuery`, `qboRequest`, `QboError`.
- Produces:
  - `review.ts` (pure): `reviewReason(candidates: Array<{ reason: string }>): string`; `hfseCustomerName(s: { lastName: string | null; firstName: string | null; middleName: string | null }): string | null`; `type ReviewGroupKey = string` (an AY code or `'earlier'`); `groupForReview(args: { ayCode: string | null; current: string | null; upcoming: string | null }): string`.
  - `linkStudentToCustomer(service, args: { studentNumber: string; customerId: string; actor: { id: string; email: string | null; role: string } }): Promise<{ ok: true; displayName: string; historyErrors: string[] } | { ok: false; status: number; error: string }>`.
  - `GET /api/billing/customers?q=` (QBO_INVOICE_ROLES) → `{ customers: Array<{ id: string; displayName: string; linkedTo: string | null }> }` — active, never a sub-customer, up to 30.
  - `POST /api/billing/students/[studentNumber]/customer` (QBO_INVOICE_ROLES) → adds the student to QuickBooks as `SURNAME, Given M.` with the parents as Company name, links it, loads its history; 200 `{ ok, displayName }`.
  - `loadReviewList(service): Promise<{ groups: Array<{ key: string; label: string; rows: ReviewRow[] }>; defaultKey: string }>` with `ReviewRow = { studentNumber: string; name: string; level: string | null; reason: string; newName: string | null; candidates: Array<{ customerId: string; displayName: string; reason: string }> }`.

- [ ] **Step 1: Failing tests for the pure helpers**

`__tests__/billing/review.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  groupForReview,
  hfseCustomerName,
  reviewReason,
} from '@/lib/billing/review';

describe('reviewReason', () => {
  it('no candidates', () =>
    expect(reviewReason([])).toBe('No QuickBooks customer has this name'));
  it('two with the same name', () =>
    expect(
      reviewReason([{ reason: 'same name' }, { reason: 'same name' }])
    ).toBe('More than one QuickBooks customer has this name'));
  it('a typed number points elsewhere', () =>
    expect(reviewReason([{ reason: 'typed invoice number' }])).toBe(
      "The typed invoice number belongs to a customer with another name — often a sibling's"
    ));
  it('already taken', () =>
    expect(
      reviewReason([{ reason: 'already linked to another student' }])
    ).toBe('The matching customer is already linked to another student'));
});

describe('hfseCustomerName', () => {
  it('SURNAME, Given M.', () =>
    expect(
      hfseCustomerName({
        lastName: 'dela Cruz',
        firstName: 'Juan Miguel',
        middleName: 'Santos',
      })
    ).toBe('DELA CRUZ, Juan Miguel S.'));
  it('no middle name', () =>
    expect(
      hfseCustomerName({
        lastName: 'Tan',
        firstName: 'Wei Ling',
        middleName: null,
      })
    ).toBe('TAN, Wei Ling'));
  it('no name', () =>
    expect(
      hfseCustomerName({ lastName: null, firstName: 'X', middleName: null })
    ).toBeNull());
});

describe('groupForReview', () => {
  const ys = { current: 'AY2027', upcoming: 'AY2028' };
  it('current and upcoming get their own group', () => {
    expect(groupForReview({ ...ys, ayCode: 'AY2027' })).toBe('AY2027');
    expect(groupForReview({ ...ys, ayCode: 'AY2028' })).toBe('AY2028');
  });
  it('anything older, or unknown, is Earlier', () => {
    expect(groupForReview({ ...ys, ayCode: 'AY2025' })).toBe('earlier');
    expect(groupForReview({ ...ys, ayCode: null })).toBe('earlier');
  });
});
```

Run: `npx vitest run --pool=threads __tests__/billing/review.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 2: `lib/billing/review.ts`**

```ts
// To review: why a student is there, the name a new QuickBooks customer gets,
// and which year group they show under. Pure.

import { ALREADY_LINKED_REASON } from '@/lib/billing/link-claims';

export function reviewReason(candidates: Array<{ reason: string }>): string {
  if (candidates.length === 0) return 'No QuickBooks customer has this name';
  if (candidates.some((c) => c.reason === ALREADY_LINKED_REASON))
    return 'The matching customer is already linked to another student';
  if (candidates.some((c) => c.reason === 'typed invoice number'))
    return "The typed invoice number belongs to a customer with another name — often a sibling's";
  if (candidates.length > 1)
    return 'More than one QuickBooks customer has this name';
  return 'Needs a person to check';
}

/** HFSE's customer naming (production export): "SURNAME, Given M." */
export function hfseCustomerName(s: {
  lastName: string | null;
  firstName: string | null;
  middleName: string | null;
}): string | null {
  const last = s.lastName?.trim();
  const first = s.firstName?.trim();
  if (!last || !first) return null;
  const mi = s.middleName?.trim()
    ? ` ${s.middleName.trim()[0].toUpperCase()}.`
    : '';
  return `${last.toUpperCase()}, ${first}${mi}`;
}

/** The group a student shows under: the current or upcoming AY, else "earlier". */
export function groupForReview(args: {
  ayCode: string | null;
  current: string | null;
  upcoming: string | null;
}): string {
  if (
    args.ayCode &&
    (args.ayCode === args.current || args.ayCode === args.upcoming)
  )
    return args.ayCode;
  return 'earlier';
}
```

Run the test again. Expected: PASS.

- [ ] **Step 3: `lib/billing/link-student.server.ts` — the link route's logic, reusable**

Move the body of `app/api/billing/students/[studentNumber]/link/route.ts` (`studentExists` and everything after the body parse) into:

```ts
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { logAction } from '@/lib/audit/log-action';
import { loadCustomerHistory } from '@/lib/billing/history.server';
import { syncTilesForStudent } from '@/lib/billing/tiles.server';
import {
  connectedRealmId,
  QboError,
  qboErrorMessage,
  qboRequest,
  QboNotConnectedError,
} from '@/lib/qbo/client';

export type LinkResult =
  | { ok: true; displayName: string; historyErrors: string[] }
  | { ok: false; status: number; error: string };

// True when the student number exists in any year's admissions applications.
// Newest year first; a year with no admissions table is skipped.
async function studentExists(
  service: SupabaseClient,
  studentNumber: string
): Promise<boolean> {
  const { data: years, error } = await service
    .from('academic_years')
    .select('ay_code')
    .order('ay_code', { ascending: false });
  if (error) throw new Error(`Academic years lookup failed: ${error.message}`);
  for (const { ay_code } of (years ?? []) as Array<{ ay_code: string }>) {
    const { data, error: appError } = await service
      .from(`ay${ay_code.slice(2)}_enrolment_applications`)
      .select('"studentNumber"')
      .eq('studentNumber', studentNumber)
      .limit(1);
    if (appError) {
      if (
        /PGRST205|42P01|Could not find the table/i.test(
          `${appError.code ?? ''} ${appError.message}`
        )
      )
        continue;
      throw new Error(appError.message);
    }
    if ((data ?? []).length > 0) return true;
  }
  return false;
}

/**
 * Link a student to a QuickBooks customer (To review, Pick another, Add to
 * QuickBooks). One customer belongs to one student; a sub-customer is never a
 * student's. Linking loads the customer's whole history and recomputes the
 * tiles, including the years an old customer's invoices were on.
 */
export async function linkStudentToCustomer(
  service: SupabaseClient,
  args: {
    studentNumber: string;
    customerId: string;
    actor: { id: string; email: string | null; role: string };
  }
): Promise<LinkResult> {
  const { studentNumber, customerId, actor } = args;
  try {
    if (!(await studentExists(service, studentNumber)))
      return {
        ok: false,
        status: 404,
        error: 'There is no student with that student number.',
      };
  } catch (e) {
    return {
      ok: false,
      status: 500,
      error: e instanceof Error ? e.message : 'Student lookup failed.',
    };
  }
  let displayName: string;
  let realmId: string;
  try {
    const r = await connectedRealmId(service);
    if (!r) throw new QboNotConnectedError();
    realmId = r;
    const c = await qboRequest<{
      Customer: {
        DisplayName: string;
        FullyQualifiedName?: string;
        Job?: boolean;
        ParentRef?: unknown;
      };
    }>(service, 'GET', `/customer/${encodeURIComponent(customerId)}`);
    displayName = c.Customer.DisplayName;
    if (
      (c.Customer.FullyQualifiedName ?? '').includes(':') ||
      c.Customer.Job === true ||
      c.Customer.ParentRef != null
    )
      return {
        ok: false,
        status: 409,
        error: "That is not a student's customer.",
      };
  } catch (e) {
    if (e instanceof QboError && e.code === '610')
      return {
        ok: false,
        status: 404,
        error: 'QuickBooks has no customer with that id.',
      };
    return { ok: false, status: 502, error: qboErrorMessage(e) };
  }
  const { data: holders, error: holderError } = await service
    .from('qbo_customers')
    .select('student_number')
    .eq('qbo_customer_id', customerId)
    .eq('realm_id', realmId)
    .neq('student_number', studentNumber)
    .limit(1);
  if (holderError)
    return { ok: false, status: 500, error: holderError.message };
  if (holders && holders.length > 0)
    return {
      ok: false,
      status: 409,
      error: `That QuickBooks customer is already linked to student ${holders[0].student_number}.`,
    };
  const { data: prevLink, error: prevError } = await service
    .from('qbo_customers')
    .select('qbo_customer_id')
    .eq('student_number', studentNumber)
    .eq('realm_id', realmId)
    .maybeSingle();
  if (prevError) return { ok: false, status: 500, error: prevError.message };
  const previousCustomerId =
    (prevLink as { qbo_customer_id: string } | null)?.qbo_customer_id ?? null;
  // history_loaded_at is cleared: the (new) customer's history is loaded below.
  const { error } = await service.from('qbo_customers').upsert({
    student_number: studentNumber,
    qbo_customer_id: customerId,
    display_name: displayName,
    matched_by: actor.email ?? 'staff',
    matched_at: new Date().toISOString(),
    realm_id: realmId,
    history_loaded_at: null,
  });
  if (error) return { ok: false, status: 500, error: error.message };
  // The link is saved either way; a review row that survives is only a stale
  // suggestion, so a failed delete is logged and the link still succeeds.
  const { error: reviewError } = await service
    .from('billing_link_review')
    .delete()
    .eq('student_number', studentNumber);
  if (reviewError)
    console.warn('[billing] could not clear billing_link_review row', {
      student_number: studentNumber,
      error: reviewError.message,
    });
  await logAction({
    service,
    actor,
    action: 'qbo.customer.link',
    entityType: 'qbo_customer',
    entityId: studentNumber,
    context: {
      display_name: displayName,
      customer_id: customerId,
      previous_customer_id: previousCustomerId,
    },
  });
  let oldYears: string[] = [];
  if (previousCustomerId && previousCustomerId !== customerId) {
    const { data: oldRows, error: oldError } = await service
      .from('qbo_invoices')
      .select('ay_code')
      .eq('student_number', studentNumber)
      .eq('qbo_customer_id', previousCustomerId)
      .eq('realm_id', realmId)
      .not('ay_code', 'is', null);
    if (oldError)
      console.warn('[billing] could not read the old customer’s invoices', {
        student_number: studentNumber,
        error: oldError.message,
      });
    oldYears = [
      ...new Set(
        ((oldRows ?? []) as Array<{ ay_code: string }>).map((r) => r.ay_code)
      ),
    ];
  }
  const history = await loadCustomerHistory(service, studentNumber).catch(
    (e) => ({ errors: [qboErrorMessage(e)] })
  );
  const historyErrors = [...history.errors];
  if (oldYears.length) {
    const t = await syncTilesForStudent(service, studentNumber, oldYears, {
      realmId,
    }).catch((e) => ({
      changed: 0,
      errors: [qboErrorMessage(e)],
    }));
    historyErrors.push(...t.errors);
  }
  return { ok: true, displayName, historyErrors };
}
```

Then replace the link route with:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireRole } from '@/lib/auth/require-role';
import { linkStudentToCustomer } from '@/lib/billing/link-student.server';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

const Body = z.object({ customerId: z.string().min(1) });

// POST /api/billing/students/[studentNumber]/link — staff pick the student's
// QuickBooks customer (To review: a suggestion, or Pick another).
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
  const r = await linkStudentToCustomer(createServiceClient(), {
    studentNumber,
    customerId: parsed.data.customerId,
    actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({
    ok: true,
    displayName: r.displayName,
    historyErrors: r.historyErrors,
  });
}
```

- [ ] **Step 4: Customer search and Add to QuickBooks routes**

`app/api/billing/customers/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import {
  connectedRealmId,
  qbEscape,
  qboErrorMessage,
  qboQuery,
} from '@/lib/qbo/client';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

// GET /api/billing/customers?q= — QuickBooks customers whose name contains q,
// for To review → Pick another. Never a sub-customer; each says which student
// already has it.
export async function GET(request: NextRequest) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const q = (new URL(request.url).searchParams.get('q') ?? '').trim();
  if (q.length < 2) return NextResponse.json({ customers: [] });
  const service = createServiceClient();
  try {
    const realmId = await connectedRealmId(service);
    const found = await qboQuery<{
      Id: string;
      DisplayName: string;
      Job?: boolean;
      ParentRef?: unknown;
      FullyQualifiedName?: string;
    }>(
      service,
      'Customer',
      `Active = true and DisplayName LIKE '%${qbEscape(q)}%'`,
      'orderby DisplayName maxresults 50'
    );
    const students = found.filter(
      (c) =>
        !c.Job &&
        c.ParentRef == null &&
        !(c.FullyQualifiedName ?? '').includes(':')
    );
    const { data: held } = await service
      .from('qbo_customers')
      .select('qbo_customer_id, student_number')
      .eq('realm_id', realmId ?? '')
      .in(
        'qbo_customer_id',
        students.map((c) => c.Id)
      );
    const holder = new Map(
      (held ?? []).map((h) => [
        h.qbo_customer_id as string,
        h.student_number as string,
      ])
    );
    return NextResponse.json({
      customers: students.slice(0, 30).map((c) => ({
        id: c.Id,
        displayName: c.DisplayName,
        linkedTo: holder.get(c.Id) ?? null,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: qboErrorMessage(e) }, { status: 502 });
  }
}
```

`app/api/billing/students/[studentNumber]/customer/route.ts`:

```ts
import { NextResponse } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { linkStudentToCustomer } from '@/lib/billing/link-student.server';
import { hfseCustomerName } from '@/lib/billing/review';
import { loadStudentInfo } from '@/lib/billing/students.server';
import {
  qbEscape,
  QboError,
  qboErrorMessage,
  qboQuery,
  qboRequest,
} from '@/lib/qbo/client';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/billing/students/[studentNumber]/customer — To review → Add to
// QuickBooks: the student really has no customer yet. Created the way HFSE
// names customers ("SURNAME, Given M.", parents in Company name), then linked.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ studentNumber: string }> }
) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const { studentNumber } = await params;
  const service = createServiceClient();
  const s = (await loadStudentInfo(service, [studentNumber])).get(
    studentNumber
  );
  if (!s)
    return NextResponse.json(
      { error: 'There is no student with that student number.' },
      { status: 404 }
    );
  const name = hfseCustomerName(s);
  if (!name)
    return NextResponse.json(
      {
        error:
          'This student has no first and last name on record to name the customer.',
      },
      { status: 422 }
    );
  const company = [s.fatherFullName, s.motherFullName]
    .map((n) => n?.trim())
    .filter(Boolean)
    .join(' / ');
  let customerId: string;
  try {
    // QuickBooks refuses a second customer with the same name, active or not.
    const same = await qboQuery<{ Id: string; Active: boolean }>(
      service,
      'Customer',
      `Active IN (true, false) and DisplayName = '${qbEscape(name)}'`,
      'maxresults 1'
    );
    if (same[0])
      return NextResponse.json(
        {
          error: same[0].Active
            ? `QuickBooks already has a customer named “${name}”. Use Pick another and choose it.`
            : `QuickBooks has an inactive customer named “${name}”. Make it active in QuickBooks, then use Pick another.`,
        },
        { status: 409 }
      );
    const created = await qboRequest<{
      Customer: { Id: string; DisplayName: string };
    }>(service, 'POST', '/customer', {
      DisplayName: name,
      ...(s.firstName?.trim() ? { GivenName: s.firstName.trim() } : {}),
      ...(s.middleName?.trim() ? { MiddleName: s.middleName.trim() } : {}),
      ...(s.lastName?.trim() ? { FamilyName: s.lastName.trim() } : {}),
      ...(company ? { CompanyName: company.slice(0, 100) } : {}),
    });
    customerId = created.Customer.Id;
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
      action: 'qbo.customer.create',
      entityType: 'qbo_customer',
      entityId: customerId,
      context: {
        display_name: created.Customer.DisplayName,
        student_number: studentNumber,
        ay_code: s.ayCode,
      },
    });
  } catch (e) {
    if (e instanceof QboError && e.code === '6240')
      return NextResponse.json(
        {
          error: `QuickBooks already uses the name “${name}” for a supplier or employee. Add the customer in QuickBooks under a different name, then use Pick another.`,
        },
        { status: 409 }
      );
    return NextResponse.json({ error: qboErrorMessage(e) }, { status: 502 });
  }
  const r = await linkStudentToCustomer(service, {
    studentNumber,
    customerId,
    actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
  });
  if (!r.ok)
    return NextResponse.json(
      { error: `Added to QuickBooks, but not linked: ${r.error}` },
      { status: r.status }
    );
  return NextResponse.json({ ok: true, displayName: r.displayName });
}
```

- [ ] **Step 5: `lib/billing/review.server.ts`**

```ts
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getCurrentAcademicYear,
  getUpcomingAcademicYear,
} from '@/lib/academic-year';
import {
  groupForReview,
  hfseCustomerName,
  reviewReason,
} from '@/lib/billing/review';
import { loadStudentInfo } from '@/lib/billing/students.server';
import { fetchAllPages } from '@/lib/supabase/paginate';

export type ReviewRow = {
  studentNumber: string;
  name: string;
  level: string | null;
  reason: string;
  newName: string | null;
  candidates: Array<{
    customerId: string;
    displayName: string;
    reason: string;
  }>;
};

/**
 * Students the link run couldn't place, one group per year: the upcoming and
 * current AY first, then everyone older as "Earlier". One group is shown at
 * a time; the default is the first year that has anyone in it.
 */
export async function loadReviewList(service: SupabaseClient): Promise<{
  groups: Array<{ key: string; label: string; rows: ReviewRow[] }>;
  defaultKey: string;
}> {
  type Row = {
    student_number: string;
    student_name: string;
    candidates: Array<{
      customerId: string;
      displayName: string;
      reason: string;
    }> | null;
  };
  const [rows, current, upcoming] = await Promise.all([
    fetchAllPages<Row>(
      (from, to) =>
        service
          .from('billing_link_review')
          .select('student_number, student_name, candidates')
          .order('student_name')
          .range(from, to) as unknown as PromiseLike<{
          data: Row[] | null;
          error: { message: string } | null;
        }>,
      1000,
      { tieBreak: 'student_number' }
    ),
    getCurrentAcademicYear(),
    getUpcomingAcademicYear(),
  ]);
  const info = await loadStudentInfo(
    service,
    rows.map((r) => r.student_number)
  );
  const cur = current?.ay_code ?? null;
  const up = upcoming?.ay_code ?? null;
  const keys = [up, cur].filter((k): k is string => !!k && k !== null);
  const uniqueKeys = [...new Set(keys)];
  const groups = [
    ...uniqueKeys.map((k) => ({ key: k, label: k, rows: [] as ReviewRow[] })),
    { key: 'earlier', label: 'Earlier', rows: [] as ReviewRow[] },
  ];
  for (const r of rows) {
    const s = info.get(r.student_number);
    const candidates = r.candidates ?? [];
    const key = groupForReview({
      ayCode: s?.ayCode ?? null,
      current: cur,
      upcoming: up,
    });
    groups
      .find((g) => g.key === key)!
      .rows.push({
        studentNumber: r.student_number,
        name: s?.name ?? r.student_name,
        level: s?.level ?? null,
        reason: reviewReason(candidates),
        newName: s ? hfseCustomerName(s) : null,
        candidates,
      });
  }
  const defaultKey =
    groups.find((g) => g.rows.length > 0)?.key ?? groups[0].key;
  return { groups, defaultKey };
}
```

- [ ] **Step 6: `components/billing/pick-customer-sheet.tsx`**

```tsx
'use client';

import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

type Found = { id: string; displayName: string; linkedTo: string | null };

// To review → Pick another: search every QuickBooks customer and link one.
export function PickCustomerSheet({
  open,
  onOpenChange,
  studentNumber,
  studentName,
  initialSearch,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  studentNumber: string;
  studentName: string;
  initialSearch: string;
}) {
  const router = useRouter();
  const run = useWriteAction();
  const [typed, setTyped] = useState(initialSearch);
  const [q, setQ] = useState(initialSearch);
  const [picked, setPicked] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(typed.trim()), 300);
    return () => clearTimeout(t);
  }, [typed]);
  const found = useQuery({
    queryKey: ['billing-customers', q],
    enabled: q.length >= 2,
    queryFn: () =>
      apiFetch<{ customers: Found[] }>(
        `/api/billing/customers?q=${encodeURIComponent(q)}`
      ),
    placeholderData: keepPreviousData,
  });
  const link = useMutation({
    mutationFn: () =>
      apiFetch<{ displayName: string; historyErrors: string[] }>(
        `/api/billing/students/${encodeURIComponent(studentNumber)}/link`,
        jsonInit('POST', { customerId: picked })
      ),
  });
  const list = found.data?.customers ?? [];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
      >
        <SheetHeader className="shrink-0 gap-1.5 border-b border-border p-5">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {studentName}
          </p>
          <SheetTitle className="font-serif text-[22px] leading-tight tracking-tight">
            Pick their customer
          </SheetTitle>
          <SheetDescription>
            Search QuickBooks by any part of the name. Linking loads every
            invoice and payment of that customer.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <Field>
            <FieldLabel htmlFor="pick-q">QuickBooks customer</FieldLabel>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="pick-q"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="e.g. OBIAS"
                className="pl-8"
              />
            </div>
            <FieldDescription>At least two letters.</FieldDescription>
          </Field>
          {found.isError ? (
            <p className="text-sm text-destructive">
              {(found.error as Error).message}
            </p>
          ) : q.length < 2 ? null : found.isLoading ||
            found.isPlaceholderData ? (
            <p className="text-sm text-muted-foreground">Searching…</p>
          ) : list.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No QuickBooks customer has “{q}” in their name.
            </p>
          ) : (
            <RadioGroup
              value={picked}
              onValueChange={setPicked}
              className="gap-1.5"
            >
              {list.map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground has-[[data-state=checked]]:border-brand-indigo has-[[data-state=checked]]:bg-brand-indigo/5 has-[[data-disabled]]:opacity-60"
                >
                  <RadioGroupItem
                    value={c.id}
                    disabled={!!c.linkedTo && c.linkedTo !== studentNumber}
                  />
                  <span className="flex-1">{c.displayName}</span>
                  {c.linkedTo && c.linkedTo !== studentNumber && (
                    <Badge variant="secondary" className="h-5">
                      Linked to {c.linkedTo}
                    </Badge>
                  )}
                </label>
              ))}
            </RadioGroup>
          )}
        </div>
        <SheetFooter className="shrink-0 gap-2 border-t border-border bg-background p-5">
          <SheetClose asChild>
            <Button type="button" variant="outline" disabled={link.isPending}>
              Cancel
            </Button>
          </SheetClose>
          <Button
            disabled={!picked || link.isPending}
            loading={link.isPending}
            loadingText="Linking…"
            onClick={() =>
              run(() => link.mutateAsync(), {
                pending: 'Linking and reading their invoices…',
                success: (d) => `${studentName} linked to ${d.displayName}`,
                onResolved: () => {
                  onOpenChange(false);
                  router.refresh();
                },
              })
            }
          >
            Link customer
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 7: `components/billing/review-board.tsx`**

```tsx
'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { PickCustomerSheet } from '@/components/billing/pick-customer-sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { DataTableEmptyState } from '@/components/ui/data-table/empty-state';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ReviewRow } from '@/lib/billing/review.server';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

type Busy = { studentNumber: string; what: string } | null;

export function ReviewBoard({
  groups,
  defaultKey,
  focus,
}: {
  groups: Array<{ key: string; label: string; rows: ReviewRow[] }>;
  defaultKey: string;
  /** `?student=` — open on that student's group, searched for them. */
  focus: string | null;
}) {
  const router = useRouter();
  const run = useWriteAction();
  const [busy, setBusy] = React.useState<Busy>(null);
  const [pick, setPick] = React.useState<ReviewRow | null>(null);
  const [add, setAdd] = React.useState<ReviewRow | null>(null);
  const [pickKey, setPickKey] = React.useState(0);
  const focusGroup = focus
    ? groups.find((g) => g.rows.some((r) => r.studentNumber === focus))?.key
    : undefined;

  const link = useMutation({
    mutationFn: (v: { studentNumber: string; customerId: string }) =>
      apiFetch<{ displayName: string }>(
        `/api/billing/students/${encodeURIComponent(v.studentNumber)}/link`,
        jsonInit('POST', { customerId: v.customerId })
      ),
  });
  const create = useMutation({
    mutationFn: (studentNumber: string) =>
      apiFetch<{ displayName: string }>(
        `/api/billing/students/${encodeURIComponent(studentNumber)}/customer`,
        jsonInit('POST', {})
      ),
  });

  const columns = React.useMemo<ColumnDef<ReviewRow, unknown>[]>(
    () => [
      {
        id: 'student',
        accessorFn: (r) => r.name,
        header: ({ column }) => (
          <SortableHeader column={column}>Student</SortableHeader>
        ),
        meta: { label: 'Student' },
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <div className="font-medium text-foreground">
              {row.original.name}
            </div>
            <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {row.original.studentNumber}
              {row.original.level ? ` · ${row.original.level}` : ''}
            </div>
          </div>
        ),
        enableHiding: false,
      },
      {
        id: 'why',
        accessorFn: (r) => r.reason,
        header: 'Why',
        meta: { label: 'Why' },
        cell: ({ row }) => (
          <span className="block min-w-48 text-sm text-muted-foreground">
            {row.original.reason}
          </span>
        ),
        enableSorting: false,
      },
      {
        id: 'suggested',
        accessorFn: (r) => r.candidates.map((c) => c.displayName).join(', '),
        header: 'Suggested customers',
        meta: { label: 'Suggested customers' },
        cell: ({ row }) =>
          row.original.candidates.length === 0 ? (
            <span className="text-sm text-muted-foreground">None</span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {row.original.candidates.map((c) => (
                <Button
                  key={c.customerId}
                  size="sm"
                  variant="outline"
                  disabled={
                    !!busy || c.reason === 'already linked to another student'
                  }
                  loading={
                    busy?.studentNumber === row.original.studentNumber &&
                    busy.what === c.customerId
                  }
                  loadingText="Linking…"
                  className="h-auto py-1 text-left"
                  onClick={() => {
                    setBusy({
                      studentNumber: row.original.studentNumber,
                      what: c.customerId,
                    });
                    void run(
                      () =>
                        link.mutateAsync({
                          studentNumber: row.original.studentNumber,
                          customerId: c.customerId,
                        }),
                      {
                        pending: 'Linking and reading their invoices…',
                        success: (d) =>
                          `${row.original.name} linked to ${d.displayName}`,
                        onResolved: () => router.refresh(),
                      }
                    ).finally(() => setBusy(null));
                  }}
                >
                  <span>
                    {c.displayName}
                    <span className="ml-1 text-muted-foreground">
                      · {c.reason}
                    </span>
                  </span>
                </Button>
              ))}
            </div>
          ),
        enableSorting: false,
      },
      {
        id: 'actions',
        header: '',
        meta: { label: 'Actions' },
        cell: ({ row }) => (
          <div className="flex justify-end gap-2 whitespace-nowrap">
            <Button
              size="sm"
              variant="ghost"
              disabled={!!busy}
              onClick={() => {
                setPickKey((k) => k + 1);
                setPick(row.original);
              }}
            >
              Pick another
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!!busy || !row.original.newName}
              onClick={() => setAdd(row.original)}
            >
              <UserPlus className="size-3.5" />
              Add to QuickBooks
            </Button>
          </div>
        ),
        enableSorting: false,
        enableHiding: false,
      },
    ],
    [busy, link, run, router]
  );

  return (
    <>
      <Tabs defaultValue={focusGroup ?? defaultKey} className="gap-4">
        <TabsList>
          {groups.map((g) => (
            <TabsTrigger key={g.key} value={g.key}>
              {g.label}{' '}
              <span className="ml-1.5 tabular-nums text-muted-foreground">
                {g.rows.length}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
        {groups.map((g) => (
          <TabsContent key={g.key} value={g.key}>
            {g.rows.length === 0 ? (
              <Card className="py-0">
                <DataTableEmptyState
                  icon={CheckCircle2}
                  title={`Nobody to review in ${g.label}`}
                  body="Every student in this group is linked to their QuickBooks customer."
                />
              </Card>
            ) : (
              <DataTable<ReviewRow>
                data={g.rows}
                columns={columns}
                getRowId={(r) => r.studentNumber}
                searchKeys={[(r) => r.name, (r) => r.studentNumber]}
                searchPlaceholder="Search name or student number"
                initialSearch={
                  focus && g.key === focusGroup ? focus : undefined
                }
                initialSort={[{ id: 'student', desc: false }]}
                pageSize={25}
                emptyFilteredState={{
                  title: 'No students match.',
                  body: 'Clear the search to see everyone in this group.',
                }}
              />
            )}
          </TabsContent>
        ))}
      </Tabs>

      {pick && (
        <PickCustomerSheet
          key={pickKey}
          open
          onOpenChange={(o) => !o && setPick(null)}
          studentNumber={pick.studentNumber}
          studentName={pick.name}
          initialSearch={pick.name.split(',')[0] ?? ''}
        />
      )}

      <AlertDialog open={!!add} onOpenChange={(o) => !o && setAdd(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add {add?.name} to QuickBooks?</AlertDialogTitle>
            <AlertDialogDescription>
              A new QuickBooks customer named “{add?.newName}” is created, with
              the parents as Company name, and linked to this student. Only do
              this when they really have no customer yet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const row = add!;
                setAdd(null);
                setBusy({ studentNumber: row.studentNumber, what: 'add' });
                void run(() => create.mutateAsync(row.studentNumber), {
                  pending: 'Adding to QuickBooks…',
                  success: (d) =>
                    `${d.displayName} added to QuickBooks and linked`,
                  onResolved: () => router.refresh(),
                }).finally(() => setBusy(null));
              }}
            >
              Add to QuickBooks
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

- [ ] **Step 8: The page and its loading state**

`app/(billing)/billing/review/page.tsx`:

```tsx
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { NotConnectedPanel } from '@/components/billing/not-connected-panel';
import { ReviewBoard } from '@/components/billing/review-board';
import { PageShell } from '@/components/ui/page-shell';
import { loadReviewList } from '@/lib/billing/review.server';
import { connectedRealmId } from '@/lib/qbo/client';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Billing → To review. Students the SIS could not match to a QuickBooks
// customer by itself: pick a suggestion, pick another, or add them.
export default async function BillingReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!canInvoiceInQbo(sessionUser.role)) redirect('/');
  const service = createServiceClient();
  const [{ student }, realmId] = await Promise.all([
    searchParams,
    connectedRealmId(service).catch(() => null),
  ]);
  const list = realmId ? await loadReviewList(service) : null;

  return (
    <PageShell>
      <Link
        href="/billing"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Customers
      </Link>
      <header className="space-y-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Billing · QuickBooks
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          To review.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Students the SIS could not match to a QuickBooks customer by itself.
          Pick the right customer, or add the student to QuickBooks.
        </p>
      </header>
      {!list ? (
        <NotConnectedPanel canConnect={sessionUser.role === 'superadmin'} />
      ) : (
        <ReviewBoard
          groups={list.groups}
          defaultKey={list.defaultKey}
          focus={student ?? null}
        />
      )}
    </PageShell>
  );
}
```

`app/(billing)/billing/review/loading.tsx`:

```tsx
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonTable, SkeletonText } from '@/components/ui/skeleton-layouts';

/** Mirrors `review/page.tsx` — back link, header, year tabs, the table. */
export default function Loading() {
  return (
    <PageShell>
      <Skeleton className="h-5 w-28" />
      <header className="space-y-4">
        <SkeletonText variant="eyebrow" className="w-40" />
        <SkeletonText variant="headline" className="w-64 max-w-full" />
        <SkeletonText variant="body" className="w-120 max-w-full" />
      </header>
      <Skeleton className="h-9 w-72" />
      <SkeletonTable columns={4} rows={8} />
    </PageShell>
  );
}
```

- [ ] **Step 9: Check and commit**

Run: `npx tsc --noEmit` and `npx vitest run --pool=threads __tests__/billing __tests__/ui/data-table-column-label-coverage.test.ts`
Expected: clean, PASS.

Open `/billing/review`. Expected: tabs for the current (and upcoming, if one is set) year and Earlier, one shown at a time, opening on the first with students in it; each row says why, with suggestion buttons. Pick another → search "a" (too short: nothing), then a surname → link one → the row leaves the list and the student appears on `/billing`. Open `/billing/review?student=<number of someone listed>`: it opens on that student's group, searched for them.

```bash
git add lib/billing/review.ts __tests__/billing/review.test.ts lib/billing/link-student.server.ts "app/api/billing/students/[studentNumber]/link/route.ts" app/api/billing/customers/route.ts "app/api/billing/students/[studentNumber]/customer/route.ts" lib/billing/review.server.ts components/billing/pick-customer-sheet.tsx components/billing/review-board.tsx "app/(billing)/billing/review/page.tsx" "app/(billing)/billing/review/loading.tsx" && git commit -m "feat(billing): To review — link a suggestion, pick another customer, add to QuickBooks

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 4.10: Settings (`/billing/settings`, superadmin) — with "what would change" before saving

**Files:**

- Modify: `lib/billing/settings-helpers.ts` (`summarizeMoves`, `type Move`, `type MovePreview`)
- Test: `__tests__/billing/settings-helpers.test.ts` (add cases)
- Modify: `lib/billing/settings.server.ts` (`reclassifyMoves` generator shared by `reclassifyAll` and the new `previewReclassify`)
- Create: `app/api/billing/settings/preview/route.ts`
- Modify: `app/api/quickbooks/callback/route.ts` (back to `/billing/settings`)
- Create: `components/billing/qbo-connection-card.tsx`
- Create: `components/billing/settings/change-preview-dialog.tsx`
- Create: `components/billing/settings/mapping-card.tsx`
- Create: `components/billing/settings/years-card.tsx`
- Create: `components/billing/settings/deposit-accounts-card.tsx`
- Create: `components/billing/settings/link-run-card.tsx`
- Create: `app/(billing)/billing/settings/page.tsx`

**Interfaces:**

- Consumes: `loadSettings`, `BillingSettings`, `loadBillingMaps`, `reclassifyAll` (`lib/billing/settings.server.ts`); `tilesSweepBlocker`, `yearAfterReclassify`, `groupChanges` (`lib/billing/settings-helpers.ts`); `overlapMessage`, `classifyInvoice` (`lib/billing/classify.ts`); `getQboStatus` (`lib/qbo/status.ts`); `QboConnectionActions` (`components/sis/qbo-connection-actions.tsx`); existing routes `PUT /api/billing/settings/mapping`, `PUT …/years`, `PUT …/deposit-accounts`, `POST …/items/refresh`, `POST /api/billing/link`.
- Produces: `type Move = { studentNumber: string; fromAy: string | null; fromStages: string[]; toAy: string | null; toStages: string[] }`; `type MovePreview = { invoices: number; students: number; byYear: Array<{ ayCode: string; registration: { gain: number; lose: number }; fees: { gain: number; lose: number } }> }`; `summarizeMoves(moves: Move[]): MovePreview`; `previewReclassify(service, maps: BillingMaps): Promise<MovePreview>`; `POST /api/billing/settings/preview` (superadmin) body `{ accounts?: Row[]; items?: Row[]; ranges?: Range[] }` → `MovePreview & { tilesSkipped: string | null }`.

- [ ] **Step 1: Failing test for `summarizeMoves`**

Append to `__tests__/billing/settings-helpers.test.ts` (add `summarizeMoves` to its import from `@/lib/billing/settings-helpers`):

```ts
describe('summarizeMoves', () => {
  it('counts what each year gains and loses, per tile', () => {
    expect(
      summarizeMoves([
        // SDF invoice leaves AY2027 Fees.
        {
          studentNumber: 'S1',
          fromAy: 'AY2027',
          fromStages: ['fees'],
          toAy: null,
          toStages: [],
        },
        // A Registration invoice moves from AY2026 to AY2027.
        {
          studentNumber: 'S2',
          fromAy: 'AY2026',
          fromStages: ['registration'],
          toAy: 'AY2027',
          toStages: ['registration'],
        },
        // Same student, a new Fees invoice lands on AY2027.
        {
          studentNumber: 'S2',
          fromAy: null,
          fromStages: [],
          toAy: 'AY2027',
          toStages: ['fees'],
        },
      ])
    ).toEqual({
      invoices: 3,
      students: 2,
      byYear: [
        {
          ayCode: 'AY2026',
          registration: { gain: 0, lose: 1 },
          fees: { gain: 0, lose: 0 },
        },
        {
          ayCode: 'AY2027',
          registration: { gain: 1, lose: 0 },
          fees: { gain: 1, lose: 1 },
        },
      ],
    });
  });
  it('nothing moves', () =>
    expect(summarizeMoves([])).toEqual({
      invoices: 0,
      students: 0,
      byYear: [],
    }));
});
```

Run: `npx vitest run --pool=threads __tests__/billing/settings-helpers.test.ts`
Expected: FAIL — `summarizeMoves` not exported.

- [ ] **Step 2: `summarizeMoves` in `lib/billing/settings-helpers.ts`**

Append:

```ts
/** One stored invoice whose year or tiles would change. */
export type Move = {
  studentNumber: string;
  fromAy: string | null;
  fromStages: string[];
  toAy: string | null;
  toStages: string[];
};

export type MovePreview = {
  invoices: number;
  students: number;
  byYear: Array<{
    ayCode: string;
    registration: { gain: number; lose: number };
    fees: { gain: number; lose: number };
  }>;
};

/** "What would change" before a settings save: per year, per tile. Pure. */
export function summarizeMoves(moves: Move[]): MovePreview {
  const years = new Map<string, MovePreview['byYear'][number]>();
  const at = (ay: string) => {
    let y = years.get(ay);
    if (!y) {
      y = {
        ayCode: ay,
        registration: { gain: 0, lose: 0 },
        fees: { gain: 0, lose: 0 },
      };
      years.set(ay, y);
    }
    return y;
  };
  for (const m of moves) {
    for (const s of ['registration', 'fees'] as const) {
      const was = !!m.fromAy && m.fromStages.includes(s);
      const now = !!m.toAy && m.toStages.includes(s);
      if (was && (!now || m.toAy !== m.fromAy)) at(m.fromAy!)[s].lose += 1;
      if (now && (!was || m.toAy !== m.fromAy)) at(m.toAy!)[s].gain += 1;
    }
  }
  return {
    invoices: moves.length,
    students: new Set(moves.map((m) => m.studentNumber)).size,
    byYear: [...years.values()].sort((a, b) =>
      a.ayCode.localeCompare(b.ayCode)
    ),
  };
}
```

Run the test. Expected: PASS.

- [ ] **Step 3: `lib/billing/settings.server.ts` — one scan for apply and preview**

Replace the whole `reclassifyAll` function with:

```ts
type Moved = Move & { id: string };

/**
 * Every stored invoice whose year or tiles change under `maps`, a page at a
 * time. Shared by reclassifyAll (which writes them) and previewReclassify
 * (which only counts them), so the preview is exactly what a save does.
 */
async function* reclassifyMoves(
  service: SupabaseClient,
  realmId: string,
  maps: BillingMaps
): AsyncGenerator<Moved[]> {
  for (let from = 0; ; from += 1000) {
    const { data, error } = await service
      .from('qbo_invoices')
      .select(
        'id, student_number, txn_date, lines, ay_code, stage_keys, enrolee_number'
      )
      .eq('realm_id', realmId)
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(`Invoice lookup failed: ${error.message}`);
    const page: Moved[] = [];
    for (const r of (data ?? []) as Array<{
      id: string;
      student_number: string;
      txn_date: string | null;
      lines: InvoiceLine[];
      ay_code: string | null;
      stage_keys: string[];
      enrolee_number: string | null;
    }>) {
      const c = classifyInvoice(r.lines ?? [], r.txn_date, maps);
      // A KD #231 row keeps its year; its stage keys still follow the mapping.
      const ayCode = yearAfterReclassify(r.enrolee_number, r.ay_code, c.ayCode);
      if (
        ayCode === r.ay_code &&
        c.stageKeys.join(',') === (r.stage_keys ?? []).join(',')
      )
        continue;
      page.push({
        id: r.id,
        studentNumber: r.student_number,
        fromAy: r.ay_code,
        fromStages: r.stage_keys ?? [],
        toAy: ayCode,
        toStages: c.stageKeys,
      });
    }
    yield page;
    if (!data || data.length < 1000) return;
  }
}

/**
 * Re-applies the mapping and year ranges to every stored invoice. Returns the
 * students whose invoices moved and every year they moved from or to.
 */
export async function reclassifyAll(
  service: SupabaseClient,
  preloaded?: { realmId: string; maps: BillingMaps }
): Promise<{ changed: string[]; years: string[] }> {
  const realmId = preloaded?.realmId ?? (await connectedRealmId(service));
  if (!realmId) return { changed: [], years: [] };
  const maps = preloaded?.maps ?? (await loadBillingMaps(service));
  const changed = new Set<string>();
  const years = new Set<string>();
  for await (const page of reclassifyMoves(service, realmId, maps)) {
    const pending: InvoiceChange[] = page.map((m) => ({
      id: m.id,
      ayCode: m.toAy,
      stageKeys: m.toStages,
    }));
    for (const m of page) {
      changed.add(m.studentNumber);
      if (m.fromAy) years.add(m.fromAy);
      if (m.toAy) years.add(m.toAy);
    }
    for (const g of groupChanges(pending)) {
      const up = await service
        .from('qbo_invoices')
        .update({ ay_code: g.ayCode, stage_keys: g.stageKeys })
        .in('id', g.ids);
      if (up.error)
        throw new Error(`Invoice update failed: ${up.error.message}`);
    }
  }
  return { changed: [...changed], years: [...years] };
}

/** What saving `maps` would move, without saving anything. */
export async function previewReclassify(
  service: SupabaseClient,
  maps: BillingMaps
): Promise<MovePreview> {
  const realmId = await connectedRealmId(service);
  if (!realmId) return summarizeMoves([]);
  const all: Move[] = [];
  for await (const page of reclassifyMoves(service, realmId, maps))
    all.push(...page);
  return summarizeMoves(all);
}
```

and extend the `settings-helpers` import at the top to:

```ts
import {
  groupChanges,
  summarizeMoves,
  tilesSweepBlocker,
  yearAfterReclassify,
  type InvoiceChange,
  type Move,
  type MovePreview,
} from '@/lib/billing/settings-helpers';
```

Run: `npx vitest run --pool=threads __tests__/billing` and `npx tsc --noEmit`
Expected: PASS, clean (behaviour of `reclassifyAll` is unchanged).

- [ ] **Step 4: Preview route**

`app/api/billing/settings/preview/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireRole } from '@/lib/auth/require-role';
import { overlapMessage } from '@/lib/billing/classify';
import { isRealDate, tilesSweepBlocker } from '@/lib/billing/settings-helpers';
import {
  loadBillingMaps,
  previewReclassify,
} from '@/lib/billing/settings.server';
import { QBO_ADMIN_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

export const maxDuration = 120;

const Row = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  stage: z.enum(['registration', 'fees', 'none']),
});
const Date10 = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealDate, 'That is not a real date.');
const Body = z.object({
  accounts: z.array(Row).max(500).optional(),
  items: z.array(Row).max(2000).optional(),
  ranges: z
    .array(
      z.object({
        ayCode: z.string().regex(/^AY\d{4}$/),
        startsOn: Date10,
        endsOn: Date10,
      })
    )
    .max(20)
    .optional(),
});

// POST /api/billing/settings/preview — what saving these settings would move
// (Registration / Fees, per year), computed exactly as the save does, without
// saving. Anything not sent keeps its saved value.
export async function POST(request: Request) {
  const auth = await requireRole([...QBO_ADMIN_ROLES]);
  if ('error' in auth) return auth.error;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
      { status: 400 }
    );
  if (parsed.data.ranges) {
    const overlap = overlapMessage(parsed.data.ranges);
    if (overlap) return NextResponse.json({ error: overlap }, { status: 400 });
  }
  const service = createServiceClient();
  try {
    const saved = await loadBillingMaps(service);
    const maps = {
      accounts: parsed.data.accounts
        ? new Map(parsed.data.accounts.map((r) => [r.id, r.stage] as const))
        : saved.accounts,
      items: parsed.data.items
        ? new Map(parsed.data.items.map((r) => [r.id, r.stage] as const))
        : saved.items,
      ranges: parsed.data.ranges ?? saved.ranges,
    };
    const preview = await previewReclassify(service, maps);
    return NextResponse.json({
      ...preview,
      tilesSkipped: tilesSweepBlocker(maps),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'The preview failed.' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 5: Connect returns to Billing settings**

In `app/api/quickbooks/callback/route.ts`, change ``new URL(`/sis/admin/quickbooks?${q}`, request.url)`` to ``new URL(`/billing/settings?${q}`, request.url)``.

- [ ] **Step 6: `components/billing/qbo-connection-card.tsx`** (server component — the SIS Admin QuickBooks card, moved)

```tsx
import { CheckCircle2, ReceiptText } from 'lucide-react';

import { QboConnectionActions } from '@/components/sis/qbo-connection-actions';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { getQboStatus } from '@/lib/qbo/status';

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

export function QboConnectionCard({
  status,
}: {
  status: Awaited<ReturnType<typeof getQboStatus>>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Connection
        </CardDescription>
        <CardTitle className="flex flex-wrap items-center gap-2 font-serif text-lg font-semibold tracking-tight text-foreground">
          {status.connected
            ? (status.companyName ?? 'Connected')
            : status.loadFailed
              ? 'QuickBooks'
              : 'Not connected'}
          {status.loadFailed ? null : status.connected ? (
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
        {status.loadFailed ? (
          <p className="text-sm text-muted-foreground">
            Couldn&apos;t load the QuickBooks status. Refresh the page to try
            again.
          </p>
        ) : !status.configured ? (
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
                  <dt className="text-muted-foreground">Last check</dt>
                  <dd className="text-foreground">
                    {status.lastRun
                      ? `${when(status.lastRun.startedAt)} · ${SOURCE[status.lastRun.source] ?? status.lastRun.source}${status.lastRun.error ? ' · had a problem' : ''}`
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
            {status.recentErrors.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">
                  Recent problems
                </p>
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
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 7: `components/billing/settings/change-preview-dialog.tsx`**

```tsx
'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { MovePreview } from '@/lib/billing/settings-helpers';

export type PreviewResult = MovePreview & { tilesSkipped: string | null };

const part = (n: number, word: string) => (n ? `${n} ${word}` : null);

// "What would change" before a Billing settings save (spec todo, 2026-10-15).
// Shows the moves per year and tile; nothing is saved until Save is pressed.
export function ChangePreviewDialog({
  preview,
  onCancel,
  onConfirm,
}: {
  preview: PreviewResult | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={!!preview} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {preview && preview.invoices > 0
              ? `${preview.invoices} invoices move, for ${preview.students} students`
              : 'No invoice moves'}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              {preview && preview.byYear.length > 0 && (
                <ul className="space-y-1.5">
                  {preview.byYear.map((y) => {
                    const reg = [
                      part(y.registration.gain, 'added'),
                      part(y.registration.lose, 'removed'),
                    ]
                      .filter(Boolean)
                      .join(', ');
                    const fees = [
                      part(y.fees.gain, 'added'),
                      part(y.fees.lose, 'removed'),
                    ]
                      .filter(Boolean)
                      .join(', ');
                    return (
                      <li key={y.ayCode} className="text-foreground">
                        <span className="font-mono text-[12px] font-semibold">
                          {y.ayCode}
                        </span>
                        {reg && <span> · Registration: {reg}</span>}
                        {fees && <span> · Fees: {fees}</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
              <p>
                {preview?.tilesSkipped
                  ? preview.tilesSkipped
                  : 'The Registration and Fees stages of those students are then worked out again. A number staff typed by hand is never cleared.'}
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Save</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 8: `components/billing/settings/mapping-card.tsx`**

```tsx
'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useMutation } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';

import {
  ChangePreviewDialog,
  type PreviewResult,
} from '@/components/billing/settings/change-preview-dialog';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { StageChoice } from '@/lib/billing/classify';
import type { BillingSettings } from '@/lib/billing/settings.server';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

const STAGE_LABEL: Record<StageChoice, string> = {
  registration: 'Registration',
  fees: 'Fees',
  none: 'Nothing',
};
const FOLLOW = 'follow';

type ItemRow = BillingSettings['items'][number];

function StageSelect({
  value,
  onChange,
  allowFollow,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  allowFollow?: boolean;
  label: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-40" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allowFollow && (
          <SelectItem value={FOLLOW}>Follow its account</SelectItem>
        )}
        <SelectItem value="registration">Registration</SelectItem>
        <SelectItem value="fees">Fees</SelectItem>
        <SelectItem value="none">Nothing</SelectItem>
      </SelectContent>
    </Select>
  );
}

// Which QuickBooks income accounts (and, for shared accounts, which items)
// fill the Registration and Fees tiles. Saving shows what would move first.
export function MappingCard({ settings }: { settings: BillingSettings }) {
  const router = useRouter();
  const run = useWriteAction();
  const [accounts, setAccounts] = React.useState<Record<string, StageChoice>>(
    () =>
      Object.fromEntries(
        settings.accounts.map((a) => [a.id, a.stage ?? 'none'])
      )
  );
  const [items, setItems] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(settings.items.map((i) => [i.id, i.stage ?? FOLLOW]))
  );
  const [preview, setPreview] = React.useState<PreviewResult | null>(null);

  const body = () => ({
    accounts: settings.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      stage: accounts[a.id] ?? 'none',
    })),
    items: settings.items
      .filter((i) => (items[i.id] ?? FOLLOW) !== FOLLOW)
      .map((i) => ({
        id: i.id,
        name: i.name,
        stage: items[i.id] as StageChoice,
      })),
  });
  const ask = useMutation({
    mutationFn: () =>
      apiFetch<PreviewResult>(
        '/api/billing/settings/preview',
        jsonInit('POST', body())
      ),
  });
  const save = useMutation({
    mutationFn: () =>
      apiFetch<{ studentsAffected: number; tilesSkipped?: string }>(
        '/api/billing/settings/mapping',
        jsonInit('PUT', body())
      ),
  });
  const refresh = useMutation({
    mutationFn: () =>
      apiFetch<{ items: number }>(
        '/api/billing/settings/items/refresh',
        jsonInit('POST')
      ),
  });

  const itemColumns = React.useMemo<ColumnDef<ItemRow, unknown>[]>(
    () => [
      {
        id: 'item',
        accessorFn: (r) => r.name,
        header: ({ column }) => (
          <SortableHeader column={column}>Item</SortableHeader>
        ),
        meta: { label: 'Item' },
      },
      {
        id: 'account',
        accessorFn: (r) => r.accountName ?? '—',
        header: ({ column }) => (
          <SortableHeader column={column}>Account</SortableHeader>
        ),
        meta: { label: 'Account' },
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.accountName ?? '—'}
          </span>
        ),
      },
      {
        id: 'fills',
        accessorFn: (r) => items[r.id] ?? FOLLOW,
        header: 'Fills',
        meta: { label: 'Fills' },
        cell: ({ row }) => (
          <StageSelect
            label={`Tile for ${row.original.name}`}
            allowFollow
            value={items[row.original.id] ?? FOLLOW}
            onChange={(v) => setItems((s) => ({ ...s, [row.original.id]: v }))}
          />
        ),
        enableSorting: false,
      },
    ],
    [items]
  );

  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Tiles
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight">
          Income accounts
        </CardTitle>
        <CardAction className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            loading={refresh.isPending}
            loadingText="Reading items…"
            onClick={() =>
              run(() => refresh.mutateAsync(), {
                pending: 'Reading the items in QuickBooks…',
                success: (d) => `${d.items} items read from QuickBooks`,
                onResolved: () => router.refresh(),
              })
            }
          >
            <RefreshCw className="size-4" />
            Refresh items
          </Button>
          <Button
            variant="outline"
            loading={ask.isPending || save.isPending}
            loadingText={save.isPending ? 'Saving…' : 'Checking…'}
            onClick={() =>
              run(() => ask.mutateAsync(), {
                success: (p) => (setPreview(p), null),
              })
            }
          >
            Save mapping
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          An invoice fills a tile when one of its items is on an account mapped
          here. HFSE renames its items every year; the accounts stay, so map
          accounts and override an item only on a shared account.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead className="text-right">Items</TableHead>
              <TableHead>Fills</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {settings.accounts.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="text-foreground">{a.name}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {a.itemCount}
                </TableCell>
                <TableCell>
                  <StageSelect
                    label={`Tile for ${a.name}`}
                    value={accounts[a.id] ?? 'none'}
                    onChange={(v) =>
                      setAccounts((s) => ({ ...s, [a.id]: v as StageChoice }))
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
            {settings.accounts.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-muted-foreground">
                  No items read from QuickBooks yet. Press Refresh items.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <div className="space-y-2">
          <p className="font-serif text-base font-semibold text-foreground">
            Item overrides
          </p>
          <p className="text-sm text-muted-foreground">
            Only for an item that should fill a different tile than its account
            — keep Student Devt Fees on Nothing: it is billed in separate
            instalments.
          </p>
          <DataTable<ItemRow>
            data={settings.items}
            columns={itemColumns}
            getRowId={(r) => r.id}
            searchKeys={[(r) => r.name, (r) => r.accountName ?? '']}
            searchPlaceholder="Search items"
            initialSort={[{ id: 'item', desc: false }]}
            pageSize={10}
          />
        </div>
      </CardContent>
      <ChangePreviewDialog
        preview={preview}
        onCancel={() => setPreview(null)}
        onConfirm={() => {
          setPreview(null);
          void run(() => save.mutateAsync(), {
            pending: 'Saving and re-checking every invoice…',
            success: (d) =>
              d.tilesSkipped
                ? `Saved. ${d.tilesSkipped}`
                : `Saved · ${d.studentsAffected} students re-checked`,
            onResolved: () => router.refresh(),
          });
        }}
      />
    </Card>
  );
}
```

(`useWriteAction`'s `success` may return `null` to show no toast — the KD #231 sheets use that; here it opens the preview instead.)

- [ ] **Step 9: `components/billing/settings/years-card.tsx`**

```tsx
'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import {
  ChangePreviewDialog,
  type PreviewResult,
} from '@/components/billing/settings/change-preview-dialog';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { DatePicker } from '@/components/ui/date-picker';
import { FieldError } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { overlapMessage } from '@/lib/billing/classify';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

type Range = { ayCode: string; startsOn: string; endsOn: string };

// The invoice-date range of each school year: an invoice dated inside it fills
// that year's tile. Outside every range it shows on the customer page only.
export function YearsCard({
  ayCodes,
  ranges,
}: {
  ayCodes: string[];
  ranges: Range[];
}) {
  const router = useRouter();
  const run = useWriteAction();
  const [rows, setRows] = React.useState<
    Record<string, { startsOn: string; endsOn: string }>
  >(() =>
    Object.fromEntries(
      ayCodes.map((ay) => {
        const r = ranges.find((x) => x.ayCode === ay);
        return [ay, { startsOn: r?.startsOn ?? '', endsOn: r?.endsOn ?? '' }];
      })
    )
  );
  const [preview, setPreview] = React.useState<PreviewResult | null>(null);
  const filled = Object.entries(rows)
    .filter(([, r]) => r.startsOn && r.endsOn)
    .map(([ayCode, r]) => ({ ayCode, ...r }));
  const half = Object.entries(rows).find(
    ([, r]) => !!r.startsOn !== !!r.endsOn
  )?.[0];
  const problem = half
    ? `${half} needs both dates, or neither.`
    : overlapMessage(filled);
  const ask = useMutation({
    mutationFn: () =>
      apiFetch<PreviewResult>(
        '/api/billing/settings/preview',
        jsonInit('POST', { ranges: filled })
      ),
  });
  const save = useMutation({
    mutationFn: () =>
      apiFetch<{ studentsAffected: number; tilesSkipped?: string }>(
        '/api/billing/settings/years',
        jsonInit('PUT', { ranges: filled })
      ),
  });
  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Tiles
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight">
          School years
        </CardTitle>
        <CardAction>
          <Button
            variant="outline"
            disabled={!!problem}
            loading={ask.isPending || save.isPending}
            loadingText={save.isPending ? 'Saving…' : 'Checking…'}
            onClick={() =>
              run(() => ask.mutateAsync(), {
                success: (p) => (setPreview(p), null),
              })
            }
          >
            Save years
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {ayCodes.map((ay) => (
          <div
            key={ay}
            className="grid grid-cols-1 gap-3 sm:grid-cols-[5rem_1fr_1fr] sm:items-end"
          >
            <p className="font-mono text-[12px] font-semibold text-foreground">
              {ay}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor={`${ay}-from`}>From</Label>
              <DatePicker
                id={`${ay}-from`}
                value={rows[ay].startsOn}
                onChange={(v) =>
                  setRows((s) => ({ ...s, [ay]: { ...s[ay], startsOn: v } }))
                }
                placeholder="No range"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${ay}-to`}>To</Label>
              <DatePicker
                id={`${ay}-to`}
                value={rows[ay].endsOn}
                onChange={(v) =>
                  setRows((s) => ({ ...s, [ay]: { ...s[ay], endsOn: v } }))
                }
                placeholder="No range"
              />
            </div>
          </div>
        ))}
        {problem && <FieldError>{problem}</FieldError>}
        <p className="text-sm text-muted-foreground">
          An invoice dated outside every range fills no stage. It still shows on
          the customer page.
        </p>
      </CardContent>
      <ChangePreviewDialog
        preview={preview}
        onCancel={() => setPreview(null)}
        onConfirm={() => {
          setPreview(null);
          void run(() => save.mutateAsync(), {
            pending: 'Saving and re-checking every invoice…',
            success: (d) =>
              d.tilesSkipped
                ? `Saved. ${d.tilesSkipped}`
                : `Saved · ${d.studentsAffected} students re-checked`,
            onResolved: () => router.refresh(),
          });
        }}
      />
    </Card>
  );
}
```

- [ ] **Step 10: `components/billing/settings/deposit-accounts-card.tsx`**

```tsx
'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { BillingSettings } from '@/lib/billing/settings.server';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// The QuickBooks bank accounts Record payment offers (HFSE: UOB, PayNow,
// Credit/Debit Card), in the order chosen here.
export function DepositAccountsCard({
  settings,
}: {
  settings: BillingSettings;
}) {
  const router = useRouter();
  const run = useWriteAction();
  const [chosen, setChosen] = React.useState<
    Array<{ id: string; label: string }>
  >(() => settings.depositAccounts.map((d) => ({ id: d.id, label: d.label })));
  const names = new Map(settings.depositChoices.map((c) => [c.id, c.name]));
  const save = useMutation({
    mutationFn: () =>
      apiFetch(
        '/api/billing/settings/deposit-accounts',
        jsonInit('PUT', { accounts: chosen.map((c, i) => ({ ...c, sort: i })) })
      ),
  });
  const toggle = (id: string, on: boolean) =>
    setChosen((s) =>
      on
        ? [...s, { id, label: names.get(id) ?? id }]
        : s.filter((c) => c.id !== id)
    );
  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Record payment
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight">
          Payment accounts
        </CardTitle>
        <CardAction>
          <Button
            variant="outline"
            disabled={
              chosen.length === 0 ||
              chosen.length > 10 ||
              chosen.some((c) => !c.label.trim())
            }
            loading={save.isPending}
            loadingText="Saving…"
            onClick={() =>
              run(() => save.mutateAsync(), {
                success: 'Payment accounts saved',
                onResolved: () => router.refresh(),
              })
            }
          >
            Save accounts
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-2">
        {settings.depositChoicesError && (
          <FieldError>{settings.depositChoicesError}</FieldError>
        )}
        {settings.depositChoices.map((c) => {
          const pick = chosen.find((x) => x.id === c.id);
          return (
            <div
              key={c.id}
              className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
            >
              <Checkbox
                id={`dep-${c.id}`}
                checked={!!pick}
                onCheckedChange={(v) => toggle(c.id, v === true)}
                aria-label={c.name}
              />
              <label
                htmlFor={`dep-${c.id}`}
                className="flex-1 text-sm text-foreground"
              >
                {c.name}
              </label>
              {pick && (
                <Input
                  value={pick.label}
                  maxLength={60}
                  onChange={(e) =>
                    setChosen((s) =>
                      s.map((x) =>
                        x.id === c.id ? { ...x, label: e.target.value } : x
                      )
                    )
                  }
                  aria-label={`Label for ${c.name}`}
                  className="h-8 w-44"
                />
              )}
            </div>
          );
        })}
        {settings.depositChoices.length === 0 &&
          !settings.depositChoicesError && (
            <p className="text-sm text-muted-foreground">
              Connect QuickBooks to choose from its bank accounts.
            </p>
          )}
        <p className="text-sm text-muted-foreground">
          Shown in Record payment in the order ticked. Up to 10.
        </p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 11: `components/billing/settings/link-run-card.tsx`**

```tsx
'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { LinkRunResult } from '@/lib/billing/link-run.server';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// Link students: matches every unlinked student to their QuickBooks customer
// (typed invoice number, sibling, name). Counts first; nothing is linked
// until the count is confirmed.
export function LinkRunCard({ reviewCount }: { reviewCount: number }) {
  const router = useRouter();
  const run = useWriteAction();
  const [dry, setDry] = React.useState<LinkRunResult | null>(null);
  const go = useMutation({
    mutationFn: (dryRun: boolean) =>
      apiFetch<LinkRunResult>(
        '/api/billing/link',
        jsonInit('POST', { dryRun })
      ),
  });
  const total = dry
    ? dry.linked.invoice + dry.linked.sibling + dry.linked.name
    : 0;
  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Customers
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight">
          Link students
        </CardTitle>
        <CardAction>
          <Button
            variant="outline"
            loading={go.isPending}
            loadingText="Counting…"
            onClick={() =>
              run(() => go.mutateAsync(true), {
                success: (d) => (setDry(d), null),
              })
            }
          >
            Link students
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Finds each unlinked student&rsquo;s QuickBooks customer by their typed
          invoice numbers, then by name. Anyone it can&rsquo;t place goes to To
          review ({reviewCount} there now). Links staff picked are kept.
        </p>
      </CardContent>
      <AlertDialog open={!!dry} onOpenChange={(o) => !o && setDry(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{total} students can be linked</AlertDialogTitle>
            <AlertDialogDescription>
              {dry
                ? `${dry.linked.invoice} by invoice number, ${dry.linked.sibling} by a sibling's number and name, ${dry.linked.name} by name. ${dry.review} go to To review. ${dry.alreadyLinked} are already linked and stay as they are. Each newly linked student's invoices and payments are read from QuickBooks, which takes a few minutes.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDry(null);
                void run(() => go.mutateAsync(false), {
                  pending: 'Linking and reading invoices…',
                  success: (d) =>
                    `${d.newlyLinked.length} linked · ${d.review} to review${d.historyErrors.length ? ` · ${d.historyErrors.length} still loading — run it again` : ''}`,
                  onResolved: () => router.refresh(),
                });
              }}
            >
              Link {total} students
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
```

- [ ] **Step 12: `app/(billing)/billing/settings/page.tsx`**

```tsx
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { redirect } from 'next/navigation';

import { QboConnectionCard } from '@/components/billing/qbo-connection-card';
import { DepositAccountsCard } from '@/components/billing/settings/deposit-accounts-card';
import { LinkRunCard } from '@/components/billing/settings/link-run-card';
import { MappingCard } from '@/components/billing/settings/mapping-card';
import { YearsCard } from '@/components/billing/settings/years-card';
import { PageShell } from '@/components/ui/page-shell';
import { listAyCodes } from '@/lib/academic-year';
import { loadSettings } from '@/lib/billing/settings.server';
import { getQboStatus } from '@/lib/qbo/status';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Billing → Settings (superadmin). The QuickBooks connection (moved here from
// SIS Admin), which invoices fill the Registration and Fees tiles, each
// year's invoice dates, the payment accounts, and the bulk link run.
export default async function BillingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (sessionUser.role !== 'superadmin') redirect('/billing');
  const service = createServiceClient();
  const [status, params, settings, ayCodes, review] = await Promise.all([
    getQboStatus(),
    searchParams,
    loadSettings(service),
    listAyCodes(service),
    service
      .from('billing_link_review')
      .select('student_number', { count: 'exact', head: true }),
  ]);
  const years = [...ayCodes].sort().reverse().slice(0, 4).sort();

  return (
    <PageShell>
      <header className="space-y-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Billing · superadmin
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          Settings.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Which invoices fill the Registration and Fees stages, the dates each
          school year&rsquo;s invoices fall in, and the accounts Record payment
          offers. Saving the tiles shows what would change first.
        </p>
      </header>

      {params.connected === '1' && status.connected && !status.loadFailed && (
        <div className="flex items-start gap-4 rounded-xl border border-brand-mint/60 bg-brand-mint/20 p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-mint to-brand-mint/80 text-ink shadow-brand-tile">
            <CheckCircle2 className="size-4" />
          </div>
          <div className="flex-1 space-y-1.5">
            <p className="font-serif text-base font-semibold text-foreground">
              QuickBooks connected
            </p>
            <p className="text-sm text-muted-foreground">
              Billing now reads {status.companyName ?? 'QuickBooks'}.
            </p>
          </div>
        </div>
      )}
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

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <MappingCard settings={settings} />
        <div className="flex min-w-0 flex-col gap-6">
          <QboConnectionCard status={status} />
          <YearsCard ayCodes={years} ranges={settings.ranges} />
          <DepositAccountsCard settings={settings} />
          <LinkRunCard reviewCount={review.count ?? 0} />
        </div>
      </div>
    </PageShell>
  );
}
```

- [ ] **Step 13: Check and commit**

Run: `npx tsc --noEmit` and `npx vitest run --pool=threads __tests__/billing __tests__/ui/data-table-column-label-coverage.test.ts`
Expected: clean, PASS.

Open `/billing/settings` as superadmin (and confirm `/billing/settings` sends an admissions user back to `/billing`). Expected: the accounts table shows the mapping Task 4.0 set; set AY2027 Student Devt Fees' override to Fees and press **Save mapping** → the dialog lists "AY2027 · Fees: N added" — press **Cancel** (nothing saved; reload shows it unchanged). Years card shows the saved ranges; Payment accounts lists the sandbox banks with UOB / PayNow / Credit/Debit Card ticked.

```bash
git add lib/billing/settings-helpers.ts __tests__/billing/settings-helpers.test.ts lib/billing/settings.server.ts app/api/billing/settings/preview/route.ts app/api/quickbooks/callback/route.ts components/billing/qbo-connection-card.tsx components/billing/settings/change-preview-dialog.tsx components/billing/settings/mapping-card.tsx components/billing/settings/years-card.tsx components/billing/settings/deposit-accounts-card.tsx components/billing/settings/link-run-card.tsx "app/(billing)/billing/settings/page.tsx" && git commit -m "feat(billing): Settings — tile mapping and years with a preview before saving, payment accounts, connection, link run

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 4.11: Sandbox round trip, both ways (Phase 4 gate)

**Files:**

- Create: `scripts/qbo/billing-roundtrip.ts`

**Interfaces:**

- Consumes: `createInvoiceForStudent` (Task 4.5), `recordPayment` (Task 4.6), `loadCustomerHistory`, `readAging`, `readCustomerProfile` (Task 4.2), `qboRequest`, `qboQuery`.

- [ ] **Step 1: Write the script**

```ts
/**
 * Billing round trip against the SANDBOX — the Phase 4 gate. SIS → QuickBooks:
 * create + email an invoice, record a payment with money left over as credit,
 * use that credit on a second invoice (the credit payment must keep its first
 * line). QuickBooks → SIS: void an invoice and add a payment in QuickBooks,
 * then re-read and check the stored copy follows. Finally QuickBooks' own
 * balance and aging agree.
 *
 *   npx tsx --conditions=react-server --env-file=.env.development.local scripts/qbo/billing-roundtrip.ts
 *
 * Writes to the sandbox and the local stack only; refuses anything else.
 */
import { createInvoiceForStudent } from '@/lib/billing/invoice-create.server';
import { loadCustomerHistory } from '@/lib/billing/history.server';
import { readAging, readCustomerProfile } from '@/lib/billing/live.server';
import { recordPayment } from '@/lib/billing/payment-record.server';
import { todaySg } from '@/lib/billing/view';
import { qboQuery, qboRequest } from '@/lib/qbo/client';
import { createServiceClient } from '@/lib/supabase/service';

const service = createServiceClient();
let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`
  );
  if (!ok) failures++;
};

async function main() {
  if (
    !/localhost|127\.0\.0\.1/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
  )
    throw new Error('Refusing: Supabase is not the local stack.');
  const { data: conn } = await service
    .from('qbo_connection')
    .select('environment')
    .eq('id', 1)
    .maybeSingle();
  if (conn?.environment !== 'sandbox')
    throw new Error('Refusing: not a sandbox company.');

  // A local superadmin as the actor (audit rows and the "Created from SIS by" note).
  const { data: users } = await service.auth.admin.listUsers({ perPage: 200 });
  const admin = users.users.find(
    (u) => (u.app_metadata as { role?: string })?.role === 'superadmin'
  );
  if (!admin) throw new Error('No local superadmin user.');
  const actor = {
    id: admin.id,
    email: admin.email ?? null,
    role: 'superadmin',
  };

  // A linked AY2027 student whose customer has an email (seeded in Task 4.0).
  const { data: links } = await service
    .from('qbo_customers')
    .select('student_number, qbo_customer_id, display_name');
  let pick: {
    student_number: string;
    qbo_customer_id: string;
    display_name: string;
  } | null = null;
  for (const l of links ?? []) {
    const p = await readCustomerProfile(service, l.qbo_customer_id);
    if (p.email) {
      pick = l as typeof pick;
      break;
    }
  }
  if (!pick) throw new Error('No linked student whose customer has an email.');
  console.log('Student', pick.student_number, pick.display_name);
  const items = await qboQuery<{ Id: string; Name: string }>(
    service,
    'Item',
    "Name IN ('AY2027 Books', 'Graduation & Moving Up fee')"
  );
  const books = items.find((i) => i.Name === 'AY2027 Books')!;
  const grad = items.find((i) => i.Name === 'Graduation & Moving Up fee')!;
  const today = todaySg();

  // 1) Create + email.
  const a = await createInvoiceForStudent(service, {
    studentNumber: pick.student_number,
    actor,
    input: {
      lines: [{ itemId: books.Id, qty: 1, unitPrice: 300 }],
      txnDate: today,
      dueDate: null,
      send: true,
    },
  });
  check(
    'create invoice A',
    a.ok,
    a.ok ? `${a.docNumber}, sent to ${a.sentTo}` : a.error
  );
  if (!a.ok) return;
  check('A emailed', !!a.sentTo);
  const { data: storedA } = await service
    .from('qbo_invoices')
    .select('stage_keys, ay_code, source')
    .eq('qbo_invoice_id', a.qboInvoiceId)
    .single();
  check(
    'A stored as created, on the Fees tile',
    storedA?.source === 'created' &&
      (storedA?.stage_keys ?? []).includes('fees'),
    JSON.stringify(storedA)
  );

  // 2) Pay 400 on A (owes 300): 100 left as credit.
  const p1 = await recordPayment(service, {
    studentNumber: pick.student_number,
    actor,
    input: {
      amount: 400,
      txnDate: today,
      depositAccountId: (await firstDepositAccount()) ?? null,
      invoiceIds: [a.qboInvoiceId],
      useCredit: false,
    },
  });
  check(
    'record payment 400',
    p1.ok,
    p1.ok ? `leftover ${p1.plan.leftover}` : p1.error
  );
  if (!p1.ok || !p1.paymentId) return;
  const { data: pay1 } = await service
    .from('qbo_payments')
    .select('unapplied')
    .eq('qbo_payment_id', p1.paymentId)
    .single();
  check(
    'payment stored with 100 credit',
    Number(pay1?.unapplied) === 100,
    String(pay1?.unapplied)
  );
  const { data: aAfter } = await service
    .from('qbo_invoices')
    .select('state, balance')
    .eq('qbo_invoice_id', a.qboInvoiceId)
    .single();
  check(
    'A paid',
    aAfter?.state === 'paid' && Number(aAfter?.balance) === 0,
    JSON.stringify(aAfter)
  );

  // 3) Invoice B 45, paid from the credit only.
  const b = await createInvoiceForStudent(service, {
    studentNumber: pick.student_number,
    actor,
    input: {
      lines: [{ itemId: grad.Id, qty: 1, unitPrice: 45 }],
      txnDate: today,
      dueDate: null,
      send: false,
    },
  });
  check('create invoice B', b.ok, b.ok ? (b.docNumber ?? '') : b.error);
  if (!b.ok) return;
  const p2 = await recordPayment(service, {
    studentNumber: pick.student_number,
    actor,
    input: {
      amount: 0,
      txnDate: today,
      depositAccountId: null,
      invoiceIds: [b.qboInvoiceId],
      useCredit: true,
    },
  });
  check(
    'use credit on B',
    p2.ok && p2.plan.creditUsed >= 45,
    p2.ok ? `credit used ${p2.plan.creditUsed}` : p2.error
  );
  const { Payment } = await qboRequest<{
    Payment: {
      UnappliedAmt?: number;
      Line?: Array<{ LinkedTxn?: Array<{ TxnId: string }> }>;
    };
  }>(service, 'GET', `/payment/${p1.paymentId}`);
  const linked = (Payment.Line ?? []).flatMap((l) =>
    (l.LinkedTxn ?? []).map((t) => t.TxnId)
  );
  check(
    'credit payment kept its line for A and gained B',
    linked.includes(a.qboInvoiceId) && linked.includes(b.qboInvoiceId),
    linked.join(',')
  );
  check(
    'credit left 55',
    Number(Payment.UnappliedAmt) === 55,
    String(Payment.UnappliedAmt)
  );

  // 4) QuickBooks → SIS: an invoice voided in QuickBooks (C, made for it) and
  //    a payment made in QuickBooks directly, then one re-read.
  const c = await createInvoiceForStudent(service, {
    studentNumber: pick.student_number,
    actor,
    input: {
      lines: [{ itemId: grad.Id, qty: 1, unitPrice: 10 }],
      txnDate: today,
      dueDate: null,
      send: false,
    },
  });
  if (c.ok) {
    const full = await qboRequest<{
      Invoice: { Id: string; SyncToken: string };
    }>(service, 'GET', `/invoice/${c.qboInvoiceId}`);
    await qboRequest(service, 'POST', '/invoice?operation=void', {
      Id: full.Invoice.Id,
      SyncToken: full.Invoice.SyncToken,
    });
  }
  const direct = await qboRequest<{ Payment: { Id: string } }>(
    service,
    'POST',
    '/payment',
    {
      CustomerRef: { value: pick.qbo_customer_id },
      TotalAmt: 5,
      TxnDate: today,
      PrivateNote: 'Round trip — made in QuickBooks directly',
    }
  );
  await loadCustomerHistory(service, pick.student_number);
  const { data: cRow } = c.ok
    ? await service
        .from('qbo_invoices')
        .select('state')
        .eq('qbo_invoice_id', c.qboInvoiceId)
        .single()
    : { data: null };
  check(
    'voided in QuickBooks → voided in the SIS',
    cRow?.state === 'voided',
    JSON.stringify(cRow)
  );
  const { data: dRow } = await service
    .from('qbo_payments')
    .select('unapplied')
    .eq('qbo_payment_id', direct.Payment.Id)
    .maybeSingle();
  check(
    'payment made in QuickBooks → stored in the SIS',
    Number(dRow?.unapplied) === 5,
    JSON.stringify(dRow)
  );

  // 5) QuickBooks' own figures agree with each other.
  const profile = await readCustomerProfile(service, pick.qbo_customer_id);
  const aging = await readAging(service, { customerId: pick.qbo_customer_id });
  const row =
    aging.find((r) => r.customerId === pick!.qbo_customer_id) ?? aging[0];
  check(
    'customer balance = aging total',
    Math.abs((row?.total ?? 0) - profile.balance) < 0.005,
    `${profile.balance} vs ${row?.total ?? 0}`
  );

  console.log(
    failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.'
  );
  if (failures) process.exit(1);
}

async function firstDepositAccount(): Promise<string | null> {
  const { data } = await service
    .from('billing_deposit_accounts')
    .select('qbo_account_id')
    .order('sort')
    .limit(1);
  return (data?.[0]?.qbo_account_id as string | undefined) ?? null;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

Run: `npx tsx --conditions=react-server --env-file=.env.development.local scripts/qbo/billing-roundtrip.ts`
Expected: every line `PASS`, last line `All checks passed.` If "No local superadmin user" — the local stack's seed makes one (see `reference_local_supabase_stack`); if `billing_deposit_accounts` is empty, save Payment accounts in Settings first (Task 4.10).

- [ ] **Step 3: Commit and close Phase 4**

```bash
git add scripts/qbo/billing-roundtrip.ts && git commit -m "test(billing): sandbox round trip — create, email, pay, credit, and QuickBooks-side changes

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

Phase 4 gate: `npx vitest run --pool=threads` (whole suite), `npx tsc --noEmit`, the round trip green, then the phase review pass.

---

## Phase 5 — The Registration and Fees tiles become read-only

Gate: tests green, tsc clean, a review pass, then Mr Ace's browser walk-through (Task 5.5).

### Task 5.1: The tile line and the stage lock read the Billing copy

**Files:**

- Create: `lib/billing/tile-line.ts`
- Test: `__tests__/billing/tile-line.test.ts`
- Modify: `lib/qbo/stage-invoices.ts` (rewritten: same exported names `loadStageInvoices`, `loadQboStageLock`, `QboStageData`, new shape)
- Create: `components/sis/billing-tile-line.tsx`
- Modify: `components/sis/enrollment-tab.tsx` (render `BillingTileLine` instead of `QboInvoiceStrip`)
- Modify: `lib/qbo/stage-lock.ts` (refusal copy points to Billing)

**Interfaces:**

- Consumes: `tileNeedsStartDate`, `TileInvoice` (`lib/billing/stage-from-invoices.ts`); `rowsOfCustomer` (`lib/billing/sync-helpers.ts`); `formatSgd`.
- Produces:
  - `tile-line.ts`: `type TileLine = { text: string; tone: 'paid' | 'open' | 'attention' | 'none' }`; `tileLine(stage: 'registration' | 'fees', invoices: Array<TileInvoice & { balance: number }>, current: { status: string | null; startDate: string | null }): TileLine`; `tileInvoiceState(invoices: Array<{ state: 'open' | 'paid' | 'voided' }>): 'open' | 'paid' | null`.
  - `QboStageData = { connected: boolean; studentNumber: string | null; linked: boolean; registration: TileLine | null; fees: TileLine | null }` — `loadStageInvoices(ayCode, enroleeNumber)` keeps its name and signature so `app/(admissions)/admissions/applications/[enroleeNumber]/page.tsx` (which has an unrelated uncommitted change from another session) needs **no edit**.
  - `loadQboStageLock(service, ayCode, enroleeNumber, stage)` → `{ connected: boolean; invoiceState: 'open' | 'paid' | null }` — `'paid'` when every live invoice on that tile is paid (feeds `paidOnStartDate`).
  - `<BillingTileLine line stage studentNumber linked canOpen />`.

- [ ] **Step 1: Failing tests**

`__tests__/billing/tile-line.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { tileInvoiceState, tileLine } from '@/lib/billing/tile-line';

const inv = (
  o: Partial<{
    docNumber: string;
    txnDate: string;
    state: 'open' | 'paid' | 'voided';
    paymentDate: string | null;
    balance: number;
  }>
) => ({
  docNumber: 'HFSE062240',
  txnDate: '2026-09-01',
  state: 'open' as const,
  paymentDate: null,
  balance: 100,
  ...o,
});
const cur = { status: 'Invoiced', startDate: null };

describe('tileLine', () => {
  it('nothing billed', () =>
    expect(tileLine('fees', [], cur)).toEqual({
      text: 'Not billed in QuickBooks yet',
      tone: 'none',
    }));
  it('voided only counts as nothing billed', () =>
    expect(
      tileLine('fees', [inv({ state: 'voided', balance: 0 })], cur).tone
    ).toBe('none'));
  it('registration paid', () =>
    expect(
      tileLine(
        'registration',
        [inv({ state: 'paid', balance: 0, paymentDate: '2026-10-12' })],
        { status: 'Finished', startDate: null }
      )
    ).toEqual({
      text: 'Paid · HFSE062240 · 12 Oct',
      tone: 'paid',
    }));
  it('fees open shows what is owed', () =>
    expect(tileLine('fees', [inv({ balance: 1340 })], cur)).toEqual({
      text: 'Invoiced · HFSE062240 · S$1,340.00 owed',
      tone: 'open',
    }));
  it('fees with two live invoices is Re-invoiced, latest number, total owed', () =>
    expect(
      tileLine(
        'fees',
        [
          inv({ docNumber: 'HFSE061904', txnDate: '2026-08-01', balance: 40 }),
          inv({ docNumber: 'HFSE062240', balance: 100 }),
        ],
        cur
      )
    ).toEqual({
      text: 'Re-invoiced · HFSE062240 · S$140.00 owed',
      tone: 'open',
    }));
  it('registration open says Unpaid', () =>
    expect(
      tileLine('registration', [inv({})], { status: 'Unpaid', startDate: null })
        .text
    ).toBe('Unpaid · HFSE062240 · S$100.00 owed'));
  it('paid, no start date: asks for the start date', () =>
    expect(
      tileLine(
        'fees',
        [inv({ state: 'paid', balance: 0, paymentDate: '2026-10-12' })],
        { status: 'Invoiced', startDate: null }
      )
    ).toEqual({
      text: 'Paid in QuickBooks — add the start date',
      tone: 'attention',
    }));
  it('fees paid with a start date', () =>
    expect(
      tileLine(
        'fees',
        [inv({ state: 'paid', balance: 0, paymentDate: '2026-10-12' })],
        { status: 'Paid', startDate: '2026-08-01' }
      ).text
    ).toBe('Paid · HFSE062240 · 12 Oct'));
});

describe('tileInvoiceState', () => {
  it('paid only when every live invoice is paid', () => {
    expect(tileInvoiceState([{ state: 'paid' }, { state: 'voided' }])).toBe(
      'paid'
    );
    expect(tileInvoiceState([{ state: 'paid' }, { state: 'open' }])).toBe(
      'open'
    );
    expect(tileInvoiceState([{ state: 'voided' }])).toBeNull();
    expect(tileInvoiceState([])).toBeNull();
  });
});
```

Run: `npx vitest run --pool=threads __tests__/billing/tile-line.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 2: `lib/billing/tile-line.ts`**

```ts
// The one read-only line on the Registration and Fees tiles (spec "Screens"):
// "Paid · HFSE062240 · 12 Oct". Worked out from the invoices the mapping puts
// on the tile; the stage itself is filled by the sync. Pure.

import {
  tileNeedsStartDate,
  type TileInvoice,
} from '@/lib/billing/stage-from-invoices';
import { formatSgd } from '@/lib/qbo/format';

export type TileLine = {
  text: string;
  tone: 'paid' | 'open' | 'attention' | 'none';
};

const shortDay = (iso: string | null) =>
  iso
    ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
      })
    : null;

export function tileInvoiceState(
  invoices: Array<{ state: 'open' | 'paid' | 'voided' }>
): 'open' | 'paid' | null {
  const live = invoices.filter((i) => i.state !== 'voided');
  if (live.length === 0) return null;
  return live.every((i) => i.state === 'paid') ? 'paid' : 'open';
}

export function tileLine(
  stage: 'registration' | 'fees',
  invoices: Array<TileInvoice & { balance: number }>,
  current: { status: string | null; startDate: string | null }
): TileLine {
  const live = invoices
    .filter((i) => i.state !== 'voided')
    .sort(
      (a, b) =>
        (b.txnDate ?? '').localeCompare(a.txnDate ?? '') ||
        (b.docNumber ?? '').localeCompare(a.docNumber ?? '', undefined, {
          numeric: true,
        })
    );
  if (live.length === 0)
    return { text: 'Not billed in QuickBooks yet', tone: 'none' };
  const latest = live[0].docNumber ?? 'Invoice';
  if (live.every((i) => i.state === 'paid')) {
    if (
      tileNeedsStartDate(stage, live, {
        status: current.status,
        invoice: latest,
        paymentDate: null,
        startDate: current.startDate,
      })
    )
      return {
        text: 'Paid in QuickBooks — add the start date',
        tone: 'attention',
      };
    const paidOn =
      live
        .map((i) => i.paymentDate)
        .filter((d): d is string => !!d)
        .sort()
        .at(-1) ?? null;
    return {
      text: ['Paid', latest, shortDay(paidOn)].filter(Boolean).join(' · '),
      tone: 'paid',
    };
  }
  const owed = live.reduce((s, i) => s + Math.max(0, i.balance), 0);
  const label =
    stage === 'registration'
      ? 'Unpaid'
      : live.length > 1
        ? 'Re-invoiced'
        : 'Invoiced';
  return {
    text: `${label} · ${latest} · ${formatSgd(owed)} owed`,
    tone: 'open',
  };
}
```

(`tileNeedsStartDate`'s third argument is `StageSnapshot` = `{ status, invoice, paymentDate, startDate }`; the literal above matches it.)

Run the test. Expected: PASS.

- [ ] **Step 3: Rewrite `lib/qbo/stage-invoices.ts`**

```ts
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { rowsOfCustomer } from '@/lib/billing/sync-helpers';
import {
  tileInvoiceState,
  tileLine,
  type TileLine,
} from '@/lib/billing/tile-line';
import { connectedRealmId } from '@/lib/qbo/client';
import { qboEnv } from '@/lib/qbo/env';
import type { QboStageKey } from '@/lib/qbo/stage-state';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';

// What the Registration and Fees tiles show now that Billing owns invoicing
// (Phase 5, spec "Screens"): one read-only line each, read from the Billing
// copy of the student's QuickBooks invoices, and a link to Billing. Before
// go-live (no QuickBooks keys on this server) it returns null and the tiles
// show nothing about QuickBooks.

export type QboStageData = {
  connected: boolean;
  studentNumber: string | null;
  linked: boolean;
  registration: TileLine | null;
  fees: TileLine | null;
};

type Row = {
  doc_number: string | null;
  txn_date: string | null;
  state: 'open' | 'paid' | 'voided';
  payment_date: string | null;
  balance: number;
  stage_keys: string[] | null;
  qbo_customer_id: string | null;
};

async function tileRows(
  service: SupabaseClient,
  ayCode: string,
  enroleeNumber: string
): Promise<{
  realmId: string | null;
  studentNumber: string | null;
  linked: boolean;
  rows: Row[];
  current: Record<
    QboStageKey,
    { status: string | null; startDate: string | null }
  > | null;
}> {
  const realmId = await connectedRealmId(service);
  const { data: app } = await createAdmissionsClient()
    .from(`ay${ayCode.slice(2)}_enrolment_applications`)
    .select('studentNumber')
    .eq('enroleeNumber', enroleeNumber)
    .maybeSingle();
  const studentNumber =
    (app as { studentNumber: string | null } | null)?.studentNumber ?? null;
  if (!realmId || !studentNumber)
    return { realmId, studentNumber, linked: false, rows: [], current: null };
  const { data: link } = await service
    .from('qbo_customers')
    .select('qbo_customer_id')
    .eq('student_number', studentNumber)
    .eq('realm_id', realmId)
    .maybeSingle();
  if (!link)
    return { realmId, studentNumber, linked: false, rows: [], current: null };
  const { data, error } = await service
    .from('qbo_invoices')
    .select(
      'doc_number, txn_date, state, payment_date, balance, stage_keys, qbo_customer_id'
    )
    .eq('student_number', studentNumber)
    .eq('realm_id', realmId)
    .eq('ay_code', ayCode);
  if (error) throw new Error(`Invoice lookup failed: ${error.message}`);
  return {
    realmId,
    studentNumber,
    linked: true,
    rows: rowsOfCustomer(
      (data ?? []) as Row[],
      (link as { qbo_customer_id: string }).qbo_customer_id
    ),
    current: null,
  };
}

const onTile = (rows: Row[], stage: QboStageKey) =>
  rows
    .filter((r) => (r.stage_keys ?? []).includes(stage))
    .map((r) => ({
      docNumber: r.doc_number,
      txnDate: r.txn_date,
      state: r.state,
      paymentDate: r.payment_date,
      balance: Number(r.balance),
    }));

/**
 * The read-only lines for this enrolee's Registration and Fees tiles. A read
 * failure never breaks the application page: the tiles then show no line.
 */
export async function loadStageInvoices(
  ayCode: string,
  enroleeNumber: string,
  current?: Record<
    QboStageKey,
    { status: string | null; startDate: string | null }
  >
): Promise<QboStageData | null> {
  if (!qboEnv()) return null;
  try {
    const t = await tileRows(createServiceClient(), ayCode, enroleeNumber);
    if (!t.realmId)
      return {
        connected: false,
        studentNumber: t.studentNumber,
        linked: false,
        registration: null,
        fees: null,
      };
    // Without the stage's own status and start date (the application page
    // doesn't pass them), report a paid tile as plainly paid;
    // BillingTileLine adds "add the start date" from the tile itself.
    const cur = current ?? {
      registration: { status: 'Paid', startDate: 'known' },
      fees: { status: 'Paid', startDate: 'known' },
    };
    return {
      connected: true,
      studentNumber: t.studentNumber,
      linked: t.linked,
      registration: t.linked
        ? tileLine(
            'registration',
            onTile(t.rows, 'registration'),
            cur.registration
          )
        : null,
      fees: t.linked
        ? tileLine('fees', onTile(t.rows, 'fees'), cur.fees)
        : null,
    };
  } catch (e) {
    console.warn('[billing] tile lines unavailable:', e);
    return {
      connected: false,
      studentNumber: null,
      linked: false,
      registration: null,
      fees: null,
    };
  }
}

/**
 * For the stage save route: does QuickBooks own this stage, and are all the
 * invoices on the tile paid? A failed read counts as not connected —
 * admissions is never locked out of a stage by a lookup error.
 */
export async function loadQboStageLock(
  service: SupabaseClient,
  ayCode: string,
  enroleeNumber: string,
  stage: QboStageKey
): Promise<{ connected: boolean; invoiceState: 'open' | 'paid' | null }> {
  const none = { connected: false, invoiceState: null };
  if (!qboEnv()) return none;
  try {
    const t = await tileRows(service, ayCode, enroleeNumber);
    if (!t.realmId) return none;
    return {
      connected: true,
      invoiceState: tileInvoiceState(onTile(t.rows, stage)),
    };
  } catch (e) {
    console.warn('[billing] stage lock unavailable:', e);
    return none;
  }
}
```

`loadStageInvoices` is called by the application page with two arguments (that file is not edited), so it can't know the stage's start date; `BillingTileLine` (Step 4) decides the "add the start date" case from the tile's own status and start date. The optional `current` parameter is for callers that have them.

- [ ] **Step 4: `components/sis/billing-tile-line.tsx`**

```tsx
import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';

import type { TileLine } from '@/lib/billing/tile-line';
import { cn } from '@/lib/utils';

const TONE: Record<TileLine['tone'], string> = {
  paid: 'text-ink',
  open: 'text-foreground',
  attention:
    'rounded-md border border-brand-amber/40 bg-brand-amber/10 px-2 py-1.5 text-ink',
  none: 'text-muted-foreground',
};

// The Registration / Fees tile's QuickBooks line — read-only. The whole line
// opens the student's Billing page (or their To review entry when they are not
// linked yet). Status, number and payment date are filled by the sync.
export function BillingTileLine({
  line,
  stage,
  stageStatus,
  startDate,
  studentNumber,
  linked,
  canOpen,
}: {
  line: TileLine | null;
  stage: 'registration' | 'fees';
  stageStatus: string | null;
  startDate: string | null;
  studentNumber: string | null;
  linked: boolean;
  /** Only Billing's roles get a link; anyone else sees the line as text. */
  canOpen: boolean;
}) {
  // Fees paid in QuickBooks but no start date yet: the server line can't
  // know the start date, the tile can.
  const shown: TileLine | null =
    line &&
    stage === 'fees' &&
    line.tone === 'paid' &&
    stageStatus !== 'Paid' &&
    stageStatus !== 'Cancelled' &&
    !startDate?.trim()
      ? { text: 'Paid in QuickBooks — add the start date', tone: 'attention' }
      : line;
  const text = !studentNumber
    ? 'No student number yet — Billing needs one'
    : !linked
      ? 'Not linked to QuickBooks yet'
      : (shown?.text ?? 'Not billed in QuickBooks yet');
  const tone = !studentNumber || !linked ? 'none' : (shown?.tone ?? 'none');
  const href = studentNumber
    ? linked
      ? `/billing/${encodeURIComponent(studentNumber)}`
      : `/billing/review?student=${encodeURIComponent(studentNumber)}`
    : null;
  const body = (
    <span
      className={cn(
        'flex items-center justify-between gap-2 text-[11px] font-medium tabular-nums',
        TONE[tone]
      )}
    >
      <span>{text}</span>
      {canOpen && href && (
        <span className="inline-flex shrink-0 items-center gap-0.5 text-brand-indigo">
          {linked ? 'Open in Billing' : 'Find in Billing'}
          <ArrowUpRight className="size-3" aria-hidden />
        </span>
      )}
    </span>
  );
  return (
    <div className="ml-1 border-t border-hairline pt-2.5">
      {canOpen && href ? (
        <Link
          href={href}
          className="block rounded-sm underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary"
        >
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}
```

- [ ] **Step 5: Use it in `components/sis/enrollment-tab.tsx`**

Replace the import `import { QboInvoiceStrip } from '@/components/sis/qbo-invoice-strip';` with `import { BillingTileLine } from '@/components/sis/billing-tile-line';`, and replace the `<QboInvoiceStrip … />` block (the `(stage.key === 'registration' || stage.key === 'fees') && qbo && (...)` expression) with:

```tsx
{
  (stage.key === 'registration' || stage.key === 'fees') && qbo?.connected && (
    <BillingTileLine
      line={qbo[stage.key]}
      stage={stage.key}
      stageStatus={stage.status}
      startDate={stage.extrasInitial.startDate ?? null}
      studentNumber={qbo.studentNumber}
      linked={qbo.linked}
      canOpen={canInvoice}
    />
  );
}
```

Update the JSDoc on the `qbo` / `canInvoice` props in this file (lines ~91–94, ~1117–1119, ~1209–1212) to: `/** The Registration and Fees tiles' read-only QuickBooks line (Billing, Phase 5). */` and `/** admissions / school_admin / superadmin — may open Billing (lib/qbo/roles.ts). */`.

- [ ] **Step 6: Refusal copy in `lib/qbo/stage-lock.ts`**

Change the first refusal to `'The invoice number and payment date come from QuickBooks. Open the student’s Billing page to invoice or record a payment.'` and update the file's header comment: "change only through Billing (the tile's QuickBooks actions were removed in Billing Phase 5) and the sync". Run `npx vitest run --pool=threads __tests__/qbo` and update any test that pins the old sentence to the new one.

- [ ] **Step 7: tsc, tests, look at it, commit**

Run: `npx tsc --noEmit` and `npx vitest run --pool=threads __tests__/billing __tests__/qbo __tests__/sis`
Expected: clean, PASS.

Open an AY2027 application in Admissions (local stack). Expected: Registration and Fees each show one line ("Paid · HFSE0… · 12 Oct", "Invoiced · HFSE0… · S$… owed", or "Not linked to QuickBooks yet"); clicking it opens the student's Billing page (or To review). No Create invoice / Link QB invoice / Refresh buttons remain on the tiles. Edit stage still lets you set Cancelled, remarks and the Fees start date; typing an invoice number is refused with the new sentence.

```bash
git add lib/billing/tile-line.ts __tests__/billing/tile-line.test.ts lib/qbo/stage-invoices.ts components/sis/billing-tile-line.tsx components/sis/enrollment-tab.tsx lib/qbo/stage-lock.ts && git commit -m "feat(billing): Registration and Fees tiles show one read-only line that opens Billing

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(Add any `__tests__/qbo/*.test.ts` Step 6 changed.)

### Task 5.2: Remove the KD #231 tile invoicing; SIS Admin QuickBooks becomes a redirect

**Files:**

- Delete: `app/api/sis/students/[enroleeNumber]/stage/[stageKey]/invoice/route.ts`
- Delete: `app/api/sis/students/[enroleeNumber]/stage/[stageKey]/invoice/refresh/route.ts`
- Delete: `app/api/quickbooks/customers/route.ts`, `app/api/quickbooks/customers/[customerId]/invoices/route.ts`
- Delete: `components/sis/qbo-invoice-sheets.tsx`, `components/sis/qbo-invoice-strip.tsx`
- Modify: `lib/qbo/stage-state.ts` (remove `stageOnNewInvoice`, `stageOnInvoiceChange` and helpers only they use), `__tests__/qbo/stage-state.test.ts`
- Modify: `lib/qbo/invoice-actions.ts` (remove `linkRefusal`), `__tests__/qbo/invoice-actions.test.ts`
- Replace: `app/(sis)/sis/admin/quickbooks/page.tsx` (redirect stub)
- Modify: `lib/auth/roles.ts` (SIS_NAV "QuickBooks" item removed; the `/sis/admin/quickbooks` ROUTE_ACCESS row stays so the stub is still guarded)
- Modify: `lib/sidebar/registry.ts` (drop the `/sis/admin/quickbooks` icon entry)
- Move: `components/sis/qbo-connection-actions.tsx` → `components/billing/qbo-connection-actions.tsx` (update the one import in `components/billing/qbo-connection-card.tsx`)

**Interfaces:**

- Removes: `POST /api/sis/students/[enroleeNumber]/stage/[stageKey]/invoice` (+ `/refresh`), `GET|POST /api/quickbooks/customers`, `GET /api/quickbooks/customers/[customerId]/invoices`, `CreateInvoiceSheet` / `LinkInvoiceSheet` (old), `QboInvoiceStrip`, `stageOnNewInvoice`, `stageOnInvoiceChange`, `linkRefusal`. Keeps: `buildInvoiceLines`, `createdButNotSaved`, `/api/quickbooks/items`, connect / callback / disconnect / webhook / cdc.

- [ ] **Step 1: Find every caller before deleting**

Use Grep across `app components lib __tests__ scripts` for `qbo-invoice-sheets`, `qbo-invoice-strip`, `stage/\${`, `/invoice/refresh`, `api/quickbooks/customers`, `stageOnNewInvoice`, `stageOnInvoiceChange`, `linkRefusal`, `sis/admin/quickbooks`.
Expected: only the files listed above, `scripts/qbo/sis-roundtrip-test.ts` (untracked, another session's — leave it alone and say so in the report if it breaks), `docs/` mentions (Task 5.4) and the callback (already moved in Task 4.10).

- [ ] **Step 2: Delete and trim**

Delete the six files. In `lib/qbo/stage-state.ts` remove `stageOnNewInvoice` and `stageOnInvoiceChange` and any helper used only by them (keep `QBO_STAGE_KEYS`, `isQboStageKey`, `InvoiceState`, `StageSnapshot`, `InvoiceSnapshot` if still imported anywhere, `StagePatch`, `blank`, `onlyChanges`, `needsStartDate` if still imported — Grep each before removing). Remove their tests from `__tests__/qbo/stage-state.test.ts`. Remove `linkRefusal` and its tests.

Move `components/sis/qbo-connection-actions.tsx` to `components/billing/qbo-connection-actions.tsx` (Write the same content at the new path, delete the old) and fix the import in `components/billing/qbo-connection-card.tsx`. In its AlertDialog description change "the invoice buttons disappear" to "Billing shows nothing new".

- [ ] **Step 3: The redirect stub**

`app/(sis)/sis/admin/quickbooks/page.tsx`:

```tsx
import { redirect } from 'next/navigation';

// The QuickBooks connection moved to Billing → Settings (Billing Phase 5).
// Kept as a redirect so old links and bookmarks still land somewhere useful;
// the `/sis/admin/quickbooks` ROUTE_ACCESS row keeps it superadmin-only.
export default async function QuickBooksAdminRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = new URLSearchParams(
    Object.entries(await searchParams).filter(
      (e): e is [string, string] => typeof e[1] === 'string'
    )
  ).toString();
  redirect(`/billing/settings${params ? `?${params}` : ''}`);
}
```

In `lib/auth/roles.ts` delete the SIS_NAV item `{ href: '/sis/admin/quickbooks', label: 'QuickBooks', requiresRoles: ['superadmin'] },`. Leave the ROUTE_ACCESS row and update its comment to `// QuickBooks connection moved to /billing/settings; this guards the redirect stub.` In `lib/sidebar/registry.ts` remove `'/sis/admin/quickbooks': ReceiptText,` (ReceiptText stays imported — Billing uses it).

- [ ] **Step 4: Tests and commit**

Run: `npx tsc --noEmit` and `npx vitest run --pool=threads`
Expected: clean; whole suite PASS (the nav, icon-coverage and audit tests included).

```bash
git rm "app/api/sis/students/[enroleeNumber]/stage/[stageKey]/invoice/route.ts" "app/api/sis/students/[enroleeNumber]/stage/[stageKey]/invoice/refresh/route.ts" app/api/quickbooks/customers/route.ts "app/api/quickbooks/customers/[customerId]/invoices/route.ts" components/sis/qbo-invoice-sheets.tsx components/sis/qbo-invoice-strip.tsx components/sis/qbo-connection-actions.tsx && git add lib/qbo/stage-state.ts __tests__/qbo/stage-state.test.ts lib/qbo/invoice-actions.ts __tests__/qbo/invoice-actions.test.ts "app/(sis)/sis/admin/quickbooks/page.tsx" lib/auth/roles.ts lib/sidebar/registry.ts components/billing/qbo-connection-actions.tsx components/billing/qbo-connection-card.tsx && git commit -m "refactor(billing): remove the tile invoicing (KD #231 sheets and routes); QuickBooks settings live in Billing

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 5.3: Migration 192 — drop the tile columns, every invoice takes its year from the mapping

**Files:**

- Create: `supabase/migrations/192_billing_drop_tile_columns.sql`
- Modify: `lib/billing/store.server.ts` (no `enrolee_number` / `is_current`)
- Modify: `lib/billing/settings.server.ts` (`reclassifyMoves` without `enrolee_number`)
- Modify: `lib/billing/settings-helpers.ts` (remove `yearAfterReclassify`), `__tests__/billing/settings-helpers.test.ts` (remove its cases)

**Interfaces:**

- Produces: `qbo_invoices` without `enrolee_number`, `stage_key`, `is_current` and their indexes; `ay_code` always the mapping's result.

The rows the KD #231 tile routes made (local test rows only — nothing is in production) keep their data; only their year is re-derived from the mapping in Step 3.

- [ ] **Step 1: The migration**

`supabase/migrations/192_billing_drop_tile_columns.sql`:

```sql
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
```

Run: `npm run local:migrate`
Expected: 192 applied.

- [ ] **Step 2: Code**

`lib/billing/store.server.ts` `upsertInvoice`: select `'id, ay_code, stage_keys, student_number'` (no `enrolee_number`); set `ay_code: place.ayCode` (drop the `yearAfterReclassify` call and its comment and import); remove `is_current: false,` from the insert.

`lib/billing/settings.server.ts` `reclassifyMoves`: select without `enrolee_number`, drop it from the row type, and use `const ayCode = c.ayCode;` (delete the KD #231 comment and the `yearAfterReclassify` import).

`lib/billing/settings-helpers.ts`: delete `yearAfterReclassify`; delete its `describe` block in `__tests__/billing/settings-helpers.test.ts`.

Grep `enrolee_number` / `is_current` / `stage_key` in `lib/billing lib/qbo app/api/billing app/api/quickbooks`: expected no hits.

- [ ] **Step 3: Re-derive every year once, then tests**

Run: `npx tsx --conditions=react-server --env-file=.env.development.local scripts/qbo/fix-local-billing-map.ts` (Task 4.0's script: it re-saves the same mapping, sweeps every stored invoice and re-reads every linked student).
Expected: `Sweep: { studentsAffected: N, tileErrors: [] }`, every student line with no error, `SDF instalments on a tile: 0.`

Run: `npx tsc --noEmit` and `npx vitest run --pool=threads`
Expected: clean, PASS. Re-run the round trip (`scripts/qbo/billing-roundtrip.ts`): all PASS.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/192_billing_drop_tile_columns.sql lib/billing/store.server.ts lib/billing/settings.server.ts lib/billing/settings-helpers.ts __tests__/billing/settings-helpers.test.ts && git commit -m "feat(billing): migration 192 drops the tile-only invoice columns; every invoice's year comes from the mapping

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 5.4: Docs

**Files:**

- Modify: `docs/key-decisions/admissions.md` (KD #231 update + new KD #232)
- Modify: `docs/context/07-api-routes.md`
- Modify: `CLAUDE.md` (Session context)
- Modify: `docs/sprints/development-plan.md` (status line)

- [ ] **Step 1: KD #232 — Billing module**

Append to `docs/key-decisions/admissions.md`, after KD #231:

```markdown
### KD #232 — Billing module: the SIS works through QuickBooks (2026-10-16)

Billing (`app/(billing)/billing/*`, admissions / school_admin / superadmin; Settings superadmin) shows every invoice and payment of a student's QuickBooks customer — one customer per student, linked by typed invoice number, sibling, name, or by staff in To review. QuickBooks is the record for money: every write goes to QuickBooks first; Create invoice, Send (always the QuickBooks API), Record payment and Use credit happen on the customer page. The customer page reads that customer from QuickBooks every time it opens; Open balance is the customer's QuickBooks Balance and Overdue is QuickBooks' A/R Aging report, never an SIS sum (the stored copy is the fallback, labelled). Credit (unapplied payment) is never used by itself — HFSE's QuickBooks has no auto-apply setting — staff use it. Which invoices fill the Registration and Fees tiles is a superadmin mapping of income accounts (+ item overrides) and per-year invoice-date ranges, saved only after a "what would change" preview; **Student Devt Fees maps to nothing** (billed in instalments). The tiles show one read-only line and open Billing; status, number and payment date are filled by the sync; remarks, the Fees start date and Cancelled stay editable. Invoice activity shows Opened / Sent / payments / Paid; Viewed is greyed "Shown in QuickBooks only" (QuickBooks gives apps no viewed event). GST: each line's QuickBooks tax code, untested until a Singapore company is connected. Migrations 189–192, local only until go-live. Spec `docs/superpowers/specs/2026-10-15-billing-module-design.md`; plans `…/plans/2026-10-15-billing-module-phases-0-3.md`, `…/plans/2026-10-16-billing-module-phases-4-5.md`.
```

Under KD #231 add one line: `**Superseded in part by KD #232 (2026-10-16):** the tile's Create / Link / Refresh and its two sheets were removed; invoicing moved to Billing. The stage lock, the sync statuses and Re-invoiced stand.`

- [ ] **Step 2: API routes doc**

In `docs/context/07-api-routes.md`, remove the KD #231 rows for `POST /api/sis/students/[enroleeNumber]/stage/[stageKey]/invoice` (+ `/refresh`) and `/api/quickbooks/customers*`, and add a Billing section listing: `POST /api/billing/link`, `POST /api/billing/students/[studentNumber]/link`, `POST …/refresh`, `POST …/invoices`, `POST …/payments`, `POST …/customer`, `POST /api/billing/invoices/[invoiceId]/send`, `GET /api/billing/customers`, `GET /api/billing/settings`, `PUT …/mapping`, `PUT …/years`, `PUT …/deposit-accounts`, `POST …/items/refresh`, `POST …/preview` — one line each: who may call it and what it does, in the file's existing format.

- [ ] **Step 3: CLAUDE.md and the development plan**

Replace the CLAUDE.md "QUICKBOOKS INVOICING FOR REGISTRATION AND FEES" session-context entry's first sentence with a new entry above it:

```markdown
✅ **BILLING MODULE — BUILT, 2026-10-16, on main, NOT pushed. Migrations 189–192 applied to the LOCAL stack only. Full account: KD #232; spec `docs/superpowers/specs/2026-10-15-billing-module-design.md`.** Every invoice and payment of a student's QuickBooks customer in the SIS: Customers, the customer page (read live from QuickBooks on open; Create invoice, Send, Record payment, Use credit; Invoices / Payments / Customer details), the invoice page (GST codes, Invoice activity — Viewed greyed, QuickBooks gives apps none), To review, Settings (mapping + years with a preview, payment accounts, connection — moved from SIS Admin, which redirects). Registration / Fees tiles are one read-only line that opens Billing. SDF maps to nothing. ⏳ Before go-live: migrations 188–192 to production BEFORE deploying, production keys + HFSE QuickBooks admin approval, map HFSE's real accounts, set the year ranges, run Link students, test GST on a Singapore company, Vercel Pro for the hourly check.
```

and shorten the old KD #231 entry to two lines ending `— superseded in part by KD #232 (tile invoicing moved to Billing).` In `docs/sprints/development-plan.md` update the status snapshot line for QuickBooks/Billing the same way.

- [ ] **Step 4: The KD index — needs Mr Ace's approval, do not edit**

`.claude/rules/key-decisions.md` must not be edited without explicit approval (CLAUDE.md). Do NOT touch it. In the task report, list exactly the two changes it needs: add `231, 232` to the `key-decisions/admissions.md` row of the topic table, and `· 231 admissions · 232 admissions` to the end of the quick-lookup list.

- [ ] **Step 5: Commit**

```bash
git add docs/key-decisions/admissions.md docs/context/07-api-routes.md CLAUDE.md docs/sprints/development-plan.md && git commit -m "docs(billing): KD #232 Billing module, API routes, session context

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 5.5: Mr Ace's browser walk-through (not a subagent task)

The controller hands this to Mr Ace with the list below and waits; nothing here is automated.

- `/billing` — the module is in the switcher; stat cards; search and filters; a student opens their page.
- Customer page — Invoices newest first with tile tags and the n8n memo; Date / Amount / Status / Item / Tile / Created by filters; Payments; Customer details; Create invoice (pick an Enrolment Fees item → the amber note if Fees is already billed; Email it now) → the invoice appears; Record payment (untick everything → all credit); Use credit.
- Invoice page — lines with the GST column, totals, Invoice activity (Viewed greyed), Send again, Open in QuickBooks.
- To review — year tabs, a suggestion links, Pick another, Add to QuickBooks.
- Settings — change a mapping, see the preview, Cancel; the connection card; Payment accounts.
- An Admissions application — Registration and Fees show one line each and open Billing; Edit stage still saves remarks, the Fees start date and Cancelled.
