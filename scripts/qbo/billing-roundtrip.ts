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
let passes = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`
  );
  if (ok) passes++;
  else failures++;
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
  const admin = users.users.find((u) => {
    const m = (u.app_metadata ?? {}) as {
      active_role?: string;
      role?: string | string[];
    };
    return (
      m.active_role === 'superadmin' ||
      (Array.isArray(m.role)
        ? m.role.includes('superadmin')
        : m.role === 'superadmin')
    );
  });
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
  type Pick = {
    student_number: string;
    qbo_customer_id: string;
    display_name: string;
  };
  let found: Pick | null = null;
  for (const l of links ?? []) {
    const p = await readCustomerProfile(service, l.qbo_customer_id);
    if (!p.email) continue;
    // Under tsx the tile write can fail for some students (tiptap's browser-only
    // generateJSON); a payment refuses to run on a failed read, so skip them.
    const probe = await loadCustomerHistory(service, l.student_number);
    if (probe.errors.length > 0) {
      console.warn('skipping', l.student_number, probe.errors[0]?.slice(0, 80));
      continue;
    }
    found = l as Pick;
    break;
  }
  if (!found) throw new Error('No linked student whose customer has an email.');
  const pick: Pick = found;
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
  if (a.warnings.length) console.warn('warnings (A):', a.warnings);
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
      requestId: crypto.randomUUID(),
    },
  });
  check(
    'record payment 400',
    p1.ok,
    p1.ok ? `leftover ${p1.plan.leftover}` : p1.error
  );
  if (!p1.ok || !p1.paymentId) return;
  if (p1.warnings.length) console.warn('warnings (payment 1):', p1.warnings);
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
      requestId: crypto.randomUUID(),
    },
  });
  check(
    'use credit on B',
    p2.ok && p2.plan.creditUsed >= 45,
    p2.ok ? `credit used ${p2.plan.creditUsed}` : p2.error
  );
  if (p2.ok && p2.warnings.length)
    console.warn('warnings (payment 2):', p2.warnings);
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
    `\n${passes} passed, ${failures} failed.` +
      (failures ? '' : ' All checks passed.')
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
