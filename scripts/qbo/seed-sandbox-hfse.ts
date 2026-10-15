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
