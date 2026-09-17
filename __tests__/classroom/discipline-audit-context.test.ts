import { describe, expect, it } from 'vitest';

import {
  disciplineFileAuditContext,
  disciplineUpdateAuditContext,
} from '@/lib/discipline/audit';
import type { DisciplineRecordRow } from '@/lib/discipline/queries';
import type { DisciplineRecordInput } from '@/lib/schemas/discipline';

const who = {
  studentNumber: 'H260127',
  studentId: 'stu-1',
  studentName: 'Joaquin Bautista',
  sectionId: 'sec-1',
  sectionName: 'Discipline 1',
  levelLabel: 'Sec 1',
};

function existing(
  over: Partial<DisciplineRecordRow> = {}
): DisciplineRecordRow {
  return {
    id: 'rec-1',
    studentId: 'stu-1',
    studentNumber: 'H260127',
    studentName: 'Joaquin Bautista',
    sectionId: 'sec-1',
    className: 'Sec 1 Discipline 1',
    sectionName: 'Discipline 1',
    levelName: 'Sec 1',
    academicYearId: 'ay-1',
    ayCode: 'AY2026',
    recordType: 'incident',
    occurredOn: '2026-05-12',
    occurredAtTime: '14:05',
    nature: 'Pushing in the canteen queue',
    details: '<p>He pushed another child.</p>',
    remarks: null,
    documentUrl: 'https://example.sharepoint.com/doc?token=SECRET',
    acknowledgedOn: null,
    filedBy: 'staff-1',
    filedByName: 'Ms Tan',
    filedByOffice: 'Academics',
    createdAt: '2026-05-12T06:00:00Z',
    updatedAt: '2026-05-12T06:00:00Z',
    updatedBy: null,
    updatedByName: null,
    ...over,
  };
}

function input(
  over: Partial<DisciplineRecordInput> = {}
): DisciplineRecordInput {
  return {
    record_type: 'incident',
    occurred_on: '2026-05-12',
    occurred_at_time: '14:05',
    nature: 'Pushing in the canteen queue',
    details: '<p>He pushed another child.</p>',
    remarks: null,
    document_url: 'https://example.sharepoint.com/doc?token=SECRET',
    acknowledged_on: null,
    filed_by_office: 'Academics',
    ...over,
  };
}

describe('discipline audit context', () => {
  it('names the student and the class on a filing, with the school wording for the type', () => {
    const ctx = disciplineFileAuditContext(
      who,
      input({ record_type: 'letter' })
    );
    expect(ctx).toMatchObject({
      student_number: 'H260127',
      student_name: 'Joaquin Bautista',
      section_name: 'Discipline 1',
      level_label: 'Sec 1',
      record_type: 'letter',
      record_type_label: 'Letter sent',
      document_url_present: true,
    });
  });

  it('records a change to every editable field, never the narrative or the link', () => {
    const ctx = disciplineUpdateAuditContext(
      who,
      existing(),
      input({
        occurred_at_time: '15:30',
        filed_by_office: 'Student Affairs',
        details: '<p>He pushed another child twice.</p>',
        remarks: '<p>Parent called.</p>',
        document_url: '',
      }),
      true
    );

    expect(ctx.changed_fields).toEqual([
      'occurred_at_time',
      'filed_by_office',
      'document_url',
      'details',
      'remarks',
    ]);
    expect(ctx).toMatchObject({
      student_number: 'H260127',
      student_name: 'Joaquin Bautista',
      section_name: 'Discipline 1',
      before: {
        occurred_at_time: '14:05',
        filed_by_office: 'Academics',
        document_url_present: true,
      },
      after: {
        occurred_at_time: '15:30',
        filed_by_office: 'Student Affairs',
        document_url_present: false,
      },
      document_url_changed: true,
      details_changed: true,
      details_length_before: 'He pushed another child.'.length,
      details_length_after: 'He pushed another child twice.'.length,
      remarks_changed: true,
      remarks_length_before: 0,
      remarks_length_after: 'Parent called.'.length,
      edited_by_filer: true,
    });

    const serialised = JSON.stringify(ctx);
    expect(serialised).not.toContain('pushed');
    expect(serialised).not.toContain('Parent called');
    expect(serialised).not.toContain('SECRET');
  });

  it('says nothing changed on a save that changed nothing', () => {
    const ctx = disciplineUpdateAuditContext(who, existing(), input(), false);
    expect(ctx.changed_fields).toEqual([]);
    expect(ctx.details_changed).toBe(false);
    expect(ctx.remarks_changed).toBe(false);
    expect(ctx.document_url_changed).toBe(false);
  });

  it('drops a letter acknowledgement date when the record becomes an incident', () => {
    const ctx = disciplineUpdateAuditContext(
      who,
      existing({ recordType: 'letter', acknowledgedOn: '2026-05-14' }),
      input({ acknowledged_on: '2026-05-14' }),
      false
    );
    expect(ctx.changed_fields).toEqual(['record_type', 'acknowledged_on']);
    expect(ctx).toMatchObject({
      before: {
        record_type_label: 'Letter sent',
        acknowledged_on: '2026-05-14',
      },
      after: { record_type_label: 'Incident', acknowledged_on: null },
    });
  });
});
