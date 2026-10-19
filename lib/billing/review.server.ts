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
import {
  readCustomerContacts,
  type CustomerContact,
} from '@/lib/billing/live.server';
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
    /** What QuickBooks holds for this customer, to tell candidates apart;
     *  null when QuickBooks couldn't be read. */
    details: CustomerContact | null;
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
  const [info, contacts] = await Promise.all([
    loadStudentInfo(
      service,
      rows.map((r) => r.student_number)
    ),
    readCustomerContacts(
      service,
      rows.flatMap((r) => (r.candidates ?? []).map((c) => c.customerId))
    ).catch((e: unknown) => {
      console.error('[billing] to review, customer details:', e);
      return new Map<string, CustomerContact>();
    }),
  ]);
  const cur = current?.ay_code ?? null;
  const up = upcoming?.ay_code ?? null;
  const keys = [up, cur].filter((k): k is string => !!k);
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
        candidates: candidates.map((c) => ({
          ...c,
          details: contacts.get(c.customerId) ?? null,
        })),
      });
  }
  const defaultKey =
    groups.find((g) => g.rows.length > 0)?.key ?? groups[0].key;
  return { groups, defaultKey };
}
