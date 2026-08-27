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
  registerWrittenAt: string | null;

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
};

const DECLARATION_COLUMNS =
  'id, filing_group_id, declaration_type, student_id, section_id, start_date, end_date, with_medical, evidence_path, evidence_url, destination_country, destination_city, parent_note, status, filed_by_email, created_at, register_written_at';

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

  const [studentsRes, sectionsRes, ladders] = await Promise.all([
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
      siblings,
      ladder: ladders.get(row.id) ?? null,
    };
  });
}
