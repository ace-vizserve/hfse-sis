import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { parseReport, type ParsedReport } from '@/lib/billing/report';
import type { ReportDef } from '@/lib/billing/report-catalog';
import { qboRequest } from '@/lib/qbo/client';
import { fetchAllPages } from '@/lib/supabase/paginate';

// Billing → Reports: one QuickBooks report read live, the company name the
// report is printed under, and which QuickBooks customers are SIS students
// (so a row can open that student's Billing page).

export async function readReport(
  service: SupabaseClient,
  def: ReportDef,
  dates: { asOf: string; from: string; to: string },
  extra: { account?: string | null } = {}
): Promise<ParsedReport> {
  const q = new URLSearchParams(def.params ?? {});
  if (def.period === 'asOf') q.set('report_date', dates.asOf);
  else {
    q.set('start_date', dates.from);
    q.set('end_date', dates.to);
  }
  if (extra.account && /^\d+$/.test(extra.account))
    q.set('account', extra.account);
  const json = await qboRequest<unknown>(
    service,
    'GET',
    `/reports/${def.endpoint}?${q.toString()}`
  );
  return parseReport(json);
}

/** The QuickBooks company's name, as saved when it was connected. */
export async function readCompanyName(
  service: SupabaseClient
): Promise<string | null> {
  const { data } = await service
    .from('qbo_connection')
    .select('company_name')
    .eq('id', 1)
    .maybeSingle();
  return (data as { company_name: string | null } | null)?.company_name ?? null;
}

/** QuickBooks customer id → the student it is linked to, for one company. */
export async function readStudentByCustomer(
  service: SupabaseClient,
  realmId: string
): Promise<Record<string, string>> {
  type Link = { student_number: string; qbo_customer_id: string };
  const links = await fetchAllPages<Link>(
    (from, to) =>
      service
        .from('qbo_customers')
        .select('student_number, qbo_customer_id')
        .eq('realm_id', realmId)
        .range(from, to) as unknown as PromiseLike<{
        data: Link[] | null;
        error: { message: string } | null;
      }>,
    1000,
    { tieBreak: 'student_number' }
  );
  const out: Record<string, string> = {};
  for (const l of links)
    if (!(l.qbo_customer_id in out)) out[l.qbo_customer_id] = l.student_number;
  return out;
}
