import { proseLength } from '@/lib/rich-text';
import {
  DISCIPLINE_RECORD_TYPE_LABELS,
  type DisciplineRecordInput,
  type DisciplineRecordType,
} from '@/lib/schemas/discipline';

import type { DisciplineRecordRow } from './queries';

// What the audit log says about a disciplinary record — kept apart from the
// routes so the shape can be tested without a request, and so filing and
// editing name the student, the class and the record type the same way.
//
// ⚠ TWO THINGS NEVER REACH audit_log, on either side of an edit:
//
//   - The narrative (`details`, `remarks`). audit_log is append-only and
//     readable by every coordinator and above, so a child's behavioural story
//     typed in error would be permanent and widely visible (migration 120, the
//     same line as attendance `ex_note` and classroom notes). An edit records
//     THAT it changed and how long it is, measured on the words, not the markup.
//   - The document link itself. A SharePoint or Drive link routinely carries a
//     sharing token in its query string; logging it would put a credential
//     somewhere it can never be taken back out of. Present/absent before and
//     after, plus whether it changed, answers "who swapped the paperwork".

/** "Letter sent" rather than "letter" — the school's own word for the chip. */
export function disciplineRecordTypeLabel(
  type: DisciplineRecordType | string | null | undefined
): string | null {
  if (!type) return null;
  return DISCIPLINE_RECORD_TYPE_LABELS[type as DisciplineRecordType] ?? type;
}

/** The class a record sits in, for a log row that has to name it. */
export type DisciplineAuditWho = {
  studentNumber: string;
  studentId: string;
  studentName: string | null;
  sectionId: string;
  sectionName: string | null;
  levelLabel: string | null;
};

function whoContext(who: DisciplineAuditWho) {
  return {
    // `studentNumber` is the key these rows have always carried; the
    // snake_case twin sits beside it so the row reads like the rest of the log.
    studentNumber: who.studentNumber,
    student_number: who.studentNumber,
    student_id: who.studentId,
    student_name: who.studentName,
    section_id: who.sectionId,
    section_name: who.sectionName,
    level_label: who.levelLabel,
  };
}

/** Context for `discipline.record.file`. */
export function disciplineFileAuditContext(
  who: DisciplineAuditWho,
  input: DisciplineRecordInput
): Record<string, unknown> {
  return {
    ...whoContext(who),
    record_type: input.record_type,
    record_type_label: disciplineRecordTypeLabel(input.record_type),
    occurred_on: input.occurred_on,
    occurred_at_time: input.occurred_at_time ?? null,
    nature: input.nature,
    filed_by_office: input.filed_by_office ?? null,
    acknowledged_on:
      input.record_type === 'letter' ? (input.acknowledged_on ?? null) : null,
    document_url_present: Boolean(input.document_url),
    details_length: proseLength(input.details ?? ''),
    remarks_length: proseLength(input.remarks ?? ''),
  };
}

type Snapshot = {
  record_type: string;
  record_type_label: string | null;
  occurred_on: string;
  occurred_at_time: string | null;
  nature: string;
  acknowledged_on: string | null;
  filed_by_office: string | null;
  document_url_present: boolean;
};

/**
 * Context for `discipline.record.update`.
 *
 * Every editable field is accounted for: the short, classifying ones as a full
 * before/after, the link as presence, the narrative as changed + length.
 * `changed_fields` lists what actually moved, so a save that changed nothing
 * visible still says so plainly instead of leaving a reader to diff two objects.
 */
export function disciplineUpdateAuditContext(
  who: DisciplineAuditWho,
  existing: DisciplineRecordRow,
  input: DisciplineRecordInput,
  editedByFiler: boolean
): Record<string, unknown> {
  // Normalised exactly as lib/discipline/mutations.ts `toColumns` writes them,
  // so "changed" compares what is stored with what will be stored.
  const nextDetails = input.details ?? '';
  const nextRemarks = input.remarks ?? null;
  const nextUrl = input.document_url || null;
  const nextOffice = input.filed_by_office ?? null;
  const nextTime = input.occurred_at_time ?? null;
  const nextAck =
    input.record_type === 'letter' ? (input.acknowledged_on ?? null) : null;

  const before: Snapshot = {
    record_type: existing.recordType,
    record_type_label: disciplineRecordTypeLabel(existing.recordType),
    occurred_on: existing.occurredOn,
    occurred_at_time: existing.occurredAtTime,
    nature: existing.nature,
    acknowledged_on: existing.acknowledgedOn,
    filed_by_office: existing.filedByOffice,
    document_url_present: Boolean(existing.documentUrl),
  };
  const after: Snapshot = {
    record_type: input.record_type,
    record_type_label: disciplineRecordTypeLabel(input.record_type),
    occurred_on: input.occurred_on,
    occurred_at_time: nextTime,
    nature: input.nature,
    acknowledged_on: nextAck,
    filed_by_office: nextOffice,
    document_url_present: Boolean(nextUrl),
  };

  const detailsChanged = (existing.details ?? '') !== nextDetails;
  // A stored '' and a stored null are the same "no remark".
  const remarksChanged = (existing.remarks || null) !== (nextRemarks || null);
  const documentUrlChanged = (existing.documentUrl || null) !== nextUrl;

  const changedFields: string[] = [];
  for (const key of [
    'record_type',
    'occurred_on',
    'occurred_at_time',
    'nature',
    'acknowledged_on',
    'filed_by_office',
  ] as const) {
    if ((before[key] ?? null) !== (after[key] ?? null)) changedFields.push(key);
  }
  if (documentUrlChanged) changedFields.push('document_url');
  if (detailsChanged) changedFields.push('details');
  if (remarksChanged) changedFields.push('remarks');

  return {
    ...whoContext(who),
    before,
    after,
    changed_fields: changedFields,
    document_url_changed: documentUrlChanged,
    details_changed: detailsChanged,
    details_length_before: proseLength(existing.details ?? ''),
    details_length_after: proseLength(nextDetails),
    remarks_changed: remarksChanged,
    remarks_length_before: proseLength(existing.remarks ?? ''),
    remarks_length_after: proseLength(nextRemarks ?? ''),
    edited_by_filer: editedByFiler,
  };
}
