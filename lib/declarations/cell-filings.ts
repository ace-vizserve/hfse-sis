import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { getStaffDisplayNameById } from '@/lib/auth/staff-list';

// "Why is this day excused?" — answered on the attendance sheet itself.
//
// Phase 3 (KD #197) made an approved absence write `EX` / `mc` onto the
// register. That closed the loop but left the mark mute: a day excused by an
// approved certificate looks exactly like one a teacher typed from memory,
// which is the guessing the whole declaration feature was built to stop.
//
// ⚠ THERE IS NO COLUMN JOINING A MARK TO ITS FILING, and adding one was
// considered and rejected. `attendance_daily` is an append-only ledger of what
// the register says; a filing is a request that happened to produce some of
// those rows. A foreign key would have to be carried by every superseding row
// a teacher writes afterwards — including the ones that OVERRULE the filing,
// where it would then be actively wrong. The filing is found the way a person
// would find it: this child, this date, inside an approved absence's range.
//
// ⚠ That means the answer is "a parent filed for this day", NOT "this mark
// came from that filing". They are usually the same thing and occasionally are
// not — a teacher may have marked the day themselves before or after. The copy
// on the panel says the former and never the latter.

export type CellFilingRow = {
  sectionStudentId: string;
  /** Every day of the filed range that falls in the requested window. */
  dates: string[];
  filedBy: string;
  startDate: string;
  endDate: string;
  hasEvidence: boolean;
  approvedBy: string | null;
  declarationId: string;
  /**
   * The approval request, which is what the queue deep-links on.
   *
   * ⚠ NOT the declaration id. `/attendance/declarations?req=` is the link the
   * notification bell already builds, and it selects from rows the reader is
   * allowed to see — so an id they have no business with simply matches
   * nothing. Linking on the declaration id instead opens the page and then
   * silently fails to open anything.
   */
  requestId: string | null;
};

/**
 * Approved absence filings overlapping [from, to] for one section.
 *
 * One query for the filings, one for the ladders that decided them, one to put
 * names on the deciders — whatever the row count. Sections have a handful of
 * these per term, so this is cheap; it is written as a bulk read anyway
 * because the caller is a page that renders a whole term at once.
 *
 * ⚠ Travel is excluded, matching the register write. A travel filing marks
 * nothing until Phase 4, so surfacing it against a day would claim a mark that
 * is not there.
 */
export async function loadCellFilingsForSection(
  service: SupabaseClient,
  args: { sectionId: string; from: string; to: string }
): Promise<CellFilingRow[]> {
  const { sectionId, from, to } = args;

  const { data, error } = await service
    .from('student_declarations')
    .select(
      'id, section_student_id, start_date, end_date, evidence_path, evidence_url, filed_by_email'
    )
    .eq('section_id', sectionId)
    .eq('declaration_type', 'absence')
    .eq('status', 'approved')
    // Overlap, not containment — a filing that starts before the window or
    // ends after it still covers days inside it.
    .lte('start_date', to)
    .gte('end_date', from);
  if (error) {
    throw new Error(`declaration lookup failed: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{
    id: string;
    section_student_id: string;
    start_date: string;
    end_date: string;
    evidence_path: string | null;
    evidence_url: string | null;
    filed_by_email: string;
  }>;
  if (rows.length === 0) return [];

  // Who gave the FINAL approval — the last decided step on the ladder, not the
  // first. The adviser approving is not the filing being approved.
  const { approverByDeclaration, requestByDeclaration } =
    await loadFinalApprovers(
      service,
      rows.map((r) => r.id)
    );

  return rows.map((row) => ({
    declarationId: row.id,
    requestId: requestByDeclaration.get(row.id) ?? null,
    sectionStudentId: row.section_student_id,
    dates: datesInWindow(row.start_date, row.end_date, from, to),
    filedBy: row.filed_by_email,
    startDate: row.start_date,
    endDate: row.end_date,
    hasEvidence: row.evidence_path != null || row.evidence_url != null,
    approvedBy: approverByDeclaration.get(row.id) ?? null,
  }));
}

/**
 * Declaration id → who approved it last, and which request carried it.
 *
 * Both come from the same two queries, so they are returned together rather
 * than asked for twice.
 */
async function loadFinalApprovers(
  service: SupabaseClient,
  declarationIds: string[]
): Promise<{
  approverByDeclaration: Map<string, string>;
  requestByDeclaration: Map<string, string>;
}> {
  const out = new Map<string, string>();
  const requestByDeclaration = new Map<string, string>();

  const { data: requests } = await service
    .from('approval_requests')
    .select('id, subject_id')
    .eq('subject_type', 'student_declaration')
    .in('subject_id', declarationIds);
  const requestRows = (requests ?? []) as Array<{
    id: string;
    subject_id: string;
  }>;
  for (const r of requestRows) requestByDeclaration.set(r.subject_id, r.id);
  if (requestRows.length === 0) {
    return { approverByDeclaration: out, requestByDeclaration };
  }

  const { data: stages } = await service
    .from('approval_request_stages')
    .select('request_id, stage_order, status, decided_by, decided_at')
    .in(
      'request_id',
      requestRows.map((r) => r.id)
    )
    .eq('status', 'approved')
    .order('stage_order', { ascending: false });
  const stageRows = (stages ?? []) as Array<{
    request_id: string;
    decided_by: string | null;
  }>;

  // Ordered descending, so the first row seen for a request is its last
  // approved step.
  const deciderByRequest = new Map<string, string>();
  for (const stage of stageRows) {
    if (!stage.decided_by) continue;
    if (!deciderByRequest.has(stage.request_id)) {
      deciderByRequest.set(stage.request_id, stage.decided_by);
    }
  }
  if (deciderByRequest.size === 0) {
    return { approverByDeclaration: out, requestByDeclaration };
  }

  // The same cached staff list the declarations queue reads for its own
  // "decided by" column, so the two screens can never name different people
  // for one decision.
  const names = new Map(await getStaffDisplayNameById());

  for (const request of requestRows) {
    const decider = deciderByRequest.get(request.id);
    if (!decider) continue;
    const name = names.get(decider);
    if (name) out.set(request.subject_id, name);
  }
  return { approverByDeclaration: out, requestByDeclaration };
}

/** Every date of [start, end] that also falls inside [from, to]. */
function datesInWindow(
  start: string,
  end: string,
  from: string,
  to: string
): string[] {
  // yyyy-MM-dd compares correctly as strings, which is how the rest of this
  // feature does date maths — no Date object, no zero-indexed-month trap.
  const lo = start > from ? start : from;
  const hi = end < to ? end : to;
  if (lo > hi) return [];

  const out: string[] = [];
  const d = new Date(`${lo}T00:00:00Z`);
  const last = new Date(`${hi}T00:00:00Z`);
  while (d.getTime() <= last.getTime()) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
