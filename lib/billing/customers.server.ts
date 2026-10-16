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
