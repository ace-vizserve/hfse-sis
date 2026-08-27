import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  DECLARATION_STATUS_LABELS,
  inclusiveDayCount,
  type DeclarationStatus,
  type DeclarationType,
} from '@/lib/schemas/declarations';
import {
  loadLaddersBySubject,
  type RequestLadder,
} from '@/lib/approvals/inbox';
import {
  DECLARATION_APPROVAL_FLOW,
  DECLARATION_SUBJECT_TYPE,
} from '@/lib/declarations/approval';
import { getVacationLeaveUsage } from '@/lib/attendance/queries';

/**
 * The school's side of a parent's declaration.
 *
 * ⚠ THIS RETURNS EVERYTHING THE PARENT SUBMITTED, and that is the point.
 * Nobody can approve what they cannot read. The adviser and the officer in
 * charge see the same thing: which child and which class, which days, whether a
 * certificate was claimed, the certificate itself, the parent's message in
 * full, who filed it, any siblings on the same submission, and how far the
 * request has got.
 *
 * ⚠ WHAT IS WITHHELD IS WITHHELD FROM THE AUDIT LOG, NOT FROM THE APPROVER.
 * The parent's note never reaches `audit_log` (migration 109's rule, restated
 * by 125) because that is read by every registrar-and-above user, is
 * append-only and can never be corrected. The person deciding is a different
 * audience and reads it in full. `register_write_error` is the one field kept
 * back from BOTH — it is our internal failure text and means nothing to anyone
 * who has to make a decision.
 *
 * ⚠ THE UPLOAD IS A PATH, NOT A URL. Migration 125 stores `evidence_path`
 * precisely so the two cannot disagree; the URL is derived here, once, from the
 * existing public `parent-portal` bucket.
 */

const BUCKET = 'parent-portal';

export type DeclarationSibling = {
  studentNumber: string;
  studentName: string;
  className: string | null;
  status: DeclarationStatus;
};

export type StaffDeclarationView = {
  id: string;
  filingGroupId: string;
  declarationType: DeclarationType;

  studentId: string;
  studentNumber: string;
  studentName: string;
  sectionId: string;
  className: string | null;
  levelCode: string | null;

  startDate: string;
  endDate: string;
  /** Calendar days the range covers, both ends counted. Not school days. */
  dayCount: number;

  withMedical: boolean | null;
  /** The uploaded certificate, ready to open. Null when nothing was attached. */
  evidenceUrl: string | null;
  /** The parent's own external link (Singapore issues digital MCs as a URL). */
  evidenceLinkUrl: string | null;

  destinationCountry: string | null;
  destinationCity: string | null;

  parentNote: string | null;
  filedByEmail: string;
  filedAt: string;

  status: DeclarationStatus;
  statusLabel: string;

  /**
   * What the final approval did to the attendance sheet (Phase 3).
   *
   * `registerWrittenAt` null with an `approved` status means the marks have
   * not landed — either the write failed (see `registerWriteError`) or this is
   * a travel filing, which does not mark anything until Phase 4.
   */
  registerWrittenAt: string | null;
  registerDaysWritten: number | null;
  registerWriteError: string | null;

  /**
   * Travel only — the child's vacation allowance for the term this trip
   * starts in, and how much of it they have already spent.
   *
   * Null for an absence, and for a trip filed outside every term. `used`
   * excludes this filing, so `used + 1` is what approving it would make it.
   */
  vacationUsage: { used: number; allowance: number } | null;

  /** The other children on the same submission. Each is decided separately. */
  siblings: DeclarationSibling[];

  /** Where the approval has got to. Null if no ladder was ever opened. */
  ladder: RequestLadder | null;
};

type DeclarationRow = {
  id: string;
  filing_group_id: string;
  declaration_type: DeclarationType;
  student_id: string;
  section_id: string;
  academic_year_id: string;
  start_date: string;
  end_date: string;
  with_medical: boolean | null;
  evidence_path: string | null;
  evidence_url: string | null;
  destination_country: string | null;
  destination_city: string | null;
  parent_note: string | null;
  status: DeclarationStatus;
  filed_by_email: string;
  created_at: string;
  register_written_at: string | null;
  register_days_written: number | null;
  register_write_error: string | null;
};

const DECLARATION_COLUMNS =
  'id, filing_group_id, declaration_type, student_id, section_id, academic_year_id, start_date, end_date, with_medical, evidence_path, evidence_url, destination_country, destination_city, parent_note, status, filed_by_email, created_at, register_written_at, register_days_written, register_write_error';

/**
 * How much of the child's vacation allowance a TRAVEL filing would spend.
 *
 * ⚠ Loaded only for travel rows, and only where the filing's dates land in a
 * real term. A trip is one vacation leave however long (KD #94 as corrected
 * 2026-08-27), and the school allows one per term — so the approver needs to
 * know whether saying yes takes the child past it.
 *
 * ⚠ `used` deliberately EXCLUDES this filing. An unapproved trip has written
 * no marks yet, and the counter reads the register — so "used + 1" is what
 * this decision would make it, which is exactly the sentence the approver
 * needs. Approving it writes the marks and the number catches up on its own.
 */
async function loadVacationUsageForTravel(
  service: SupabaseClient,
  rows: Array<{
    id: string;
    declaration_type: DeclarationType;
    student_id: string;
    academic_year_id: string;
    start_date: string;
  }>
): Promise<Map<string, { used: number; allowance: number }>> {
  const out = new Map<string, { used: number; allowance: number }>();
  const travel = rows.filter((r) => r.declaration_type === 'travel');
  if (travel.length === 0) return out;

  // The term the trip STARTS in — the same attribution rule the counter uses
  // for a trip that crosses a boundary (Mr Ace, 2026-08-27).
  const ayIds = [...new Set(travel.map((r) => r.academic_year_id))];
  const { data: termRows } = await service
    .from('terms')
    .select('id, academic_year_id, start_date, end_date')
    .in('academic_year_id', ayIds);
  const terms = (termRows ?? []) as Array<{
    id: string;
    academic_year_id: string;
    start_date: string | null;
    end_date: string | null;
  }>;

  // One lookup per (student, term) however many filings share it.
  const cache = new Map<string, { used: number; allowance: number }>();
  for (const row of travel) {
    const term = terms.find(
      (t) =>
        t.academic_year_id === row.academic_year_id &&
        t.start_date &&
        t.end_date &&
        t.start_date <= row.start_date &&
        t.end_date >= row.start_date
    );
    if (!term) continue; // Filed for dates outside every term — nothing to say.

    const key = `${row.student_id}|${term.id}`;
    let usage = cache.get(key);
    if (!usage) {
      const resolved = await getVacationLeaveUsage(
        row.student_id,
        row.academic_year_id,
        term.id
      );
      usage = { used: resolved.usedThisTerm, allowance: resolved.allowance };
      cache.set(key, usage);
    }
    out.set(row.id, usage);
  }
  return out;
}

/**
 * Full detail for a set of declaration ids, in the order they were filed.
 *
 * Five queries whatever the row count: the declarations, their siblings, the
 * students, the sections, the ladders.
 */
export async function loadStaffDeclarations(
  service: SupabaseClient,
  declarationIds: string[]
): Promise<StaffDeclarationView[]> {
  const ids = [...new Set(declarationIds.filter(Boolean))];
  if (ids.length === 0) return [];

  const { data, error } = await service
    .from('student_declarations')
    .select(DECLARATION_COLUMNS)
    .in('id', ids)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as DeclarationRow[];
  if (rows.length === 0) return [];

  // Siblings: every row sharing a filing group, including the ones this viewer
  // may not be the approver for. Naming them is not a leak — the parent filed
  // one form and knows exactly who is on it — and omitting them makes a
  // three-child submission look like three unrelated absences.
  const groupIds = [...new Set(rows.map((r) => r.filing_group_id))];
  const { data: groupData, error: groupErr } = await service
    .from('student_declarations')
    .select('id, filing_group_id, student_id, section_id, status')
    .in('filing_group_id', groupIds);
  if (groupErr) throw new Error(groupErr.message);
  const groupRows = (groupData ?? []) as unknown as Array<{
    id: string;
    filing_group_id: string;
    student_id: string;
    section_id: string;
    status: DeclarationStatus;
  }>;

  const studentIds = [...new Set(groupRows.map((r) => r.student_id))];
  const sectionIds = [...new Set(groupRows.map((r) => r.section_id))];

  const [studentsRes, sectionsRes, ladders, vacationUsage] = await Promise.all([
    service
      .from('students')
      .select('id, student_number, first_name, last_name')
      .in('id', studentIds),
    service
      .from('sections')
      .select('id, name, levels(code)')
      .in('id', sectionIds),
    loadLaddersBySubject(service, {
      flow: DECLARATION_APPROVAL_FLOW,
      subjectType: DECLARATION_SUBJECT_TYPE,
      subjectIds: ids,
    }),
    loadVacationUsageForTravel(service, rows),
  ]);

  if (studentsRes.error) throw new Error(studentsRes.error.message);
  if (sectionsRes.error) throw new Error(sectionsRes.error.message);

  const studentById = new Map(
    (
      (studentsRes.data ?? []) as unknown as Array<{
        id: string;
        student_number: string;
        first_name: string;
        last_name: string;
      }>
    ).map((s) => [
      s.id,
      {
        number: s.student_number,
        name: `${s.first_name} ${s.last_name}`.trim(),
      },
    ])
  );

  type SectionRow = {
    id: string;
    name: string | null;
    levels: { code: string } | { code: string }[] | null;
  };
  const sectionById = new Map(
    ((sectionsRes.data ?? []) as unknown as SectionRow[]).map((s) => {
      // PostgREST returns an embedded to-one as an object or a single-element
      // array depending on how it infers the relationship; both shapes appear
      // in this codebase, so normalise rather than assume.
      const level = Array.isArray(s.levels) ? s.levels[0] : s.levels;
      const levelCode = level?.code ?? null;
      return [
        s.id,
        {
          name: s.name,
          levelCode,
          className: [levelCode, s.name].filter(Boolean).join(' ') || null,
        },
      ];
    })
  );

  const siblingsByGroup = new Map<string, DeclarationSibling[]>();
  for (const row of groupRows) {
    const list = siblingsByGroup.get(row.filing_group_id) ?? [];
    const student = studentById.get(row.student_id);
    list.push({
      studentNumber: student?.number ?? '',
      studentName: student?.name ?? '',
      className: sectionById.get(row.section_id)?.className ?? null,
      status: row.status,
    });
    siblingsByGroup.set(row.filing_group_id, list);
  }
  // Keyed by the row it belongs to, so a filing can name the OTHERS.
  const siblingOwner = new Map(groupRows.map((r) => [r.id, r.student_id]));

  return rows.map((row) => {
    const student = studentById.get(row.student_id);
    const section = sectionById.get(row.section_id);
    const ownerStudentId = siblingOwner.get(row.id);
    const siblings = (siblingsByGroup.get(row.filing_group_id) ?? []).filter(
      (s) => s.studentNumber !== studentById.get(ownerStudentId ?? '')?.number
    );

    let evidenceUrl: string | null = null;
    if (row.evidence_path) {
      const { data: url } = service.storage
        .from(BUCKET)
        .getPublicUrl(row.evidence_path);
      evidenceUrl = url?.publicUrl ?? null;
    }

    return {
      id: row.id,
      filingGroupId: row.filing_group_id,
      declarationType: row.declaration_type,
      studentId: row.student_id,
      studentNumber: student?.number ?? '',
      studentName: student?.name ?? '',
      sectionId: row.section_id,
      className: section?.className ?? null,
      levelCode: section?.levelCode ?? null,
      startDate: row.start_date,
      endDate: row.end_date,
      dayCount: inclusiveDayCount(row.start_date, row.end_date),
      withMedical: row.with_medical,
      evidenceUrl,
      evidenceLinkUrl: row.evidence_url,
      destinationCountry: row.destination_country,
      destinationCity: row.destination_city,
      parentNote: row.parent_note,
      filedByEmail: row.filed_by_email,
      filedAt: row.created_at,
      status: row.status,
      statusLabel: DECLARATION_STATUS_LABELS[row.status],
      registerWrittenAt: row.register_written_at,
      registerDaysWritten: row.register_days_written,
      // ⚠ Staff see this; parents deliberately do not (`lib/declarations/
      // parent.ts` withholds it). A parent reading "term lookup failed" learns
      // nothing they can act on and everything about our internals.
      registerWriteError: row.register_write_error,
      vacationUsage: vacationUsage.get(row.id) ?? null,
      siblings,
      ladder: ladders.get(row.id) ?? null,
    };
  });
}
