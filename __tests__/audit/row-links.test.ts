import { describe, expect, it } from 'vitest';

import {
  auditRowLink,
  type AuditLinkRow,
  type AuditRowLink,
} from '@/lib/audit/row-links';
import type { Role } from '@/lib/auth/roles';

// Ids and context shapes copied from real local audit_log rows (2026-10-20).
const SHEET = '4b28033a-cb8e-4a93-a629-33bc89ae7ca2';
const SECTION = '389b1098-642f-4388-9e28-5e9a53b668e0';
const TERM = '6daaeefa-f017-4c11-ba5e-22d2fd32fff2';
const USER = '70fe439d-a4ee-40a9-ba97-dc4da44e9707';
const EVENT = 'ac320239-9a73-4e92-940b-aed5bc649035';
const REQ = '7d369dca-f012-476f-9b67-bee5a532777e';
const GCR = 'b8b4dcdc-6266-4545-b2a1-5846b4362460';

function row(
  entity_type: string,
  action: string,
  entity_id: string | null,
  context: Record<string, unknown> = {}
): AuditLinkRow {
  return { entity_type, action, entity_id, context };
}

const cases: Array<[string, AuditLinkRow, AuditRowLink | null]> = [
  [
    'grading sheet',
    row('grading_sheet', 'totals.update', SHEET),
    { href: `/markbook/grading/${SHEET}`, label: 'Open sheet' },
  ],
  [
    'grade entry → its sheet',
    row('grade_entry', 'entry.update', 'f1ac2102-1af2-400b-8cf8-5a63692fbbfb', {
      grading_sheet_id: SHEET,
    }),
    { href: `/markbook/grading/${SHEET}`, label: 'Open sheet' },
  ],
  [
    'change request, with its year',
    row('grade_change_request', 'grade_change_requested', GCR, {
      request_id: REQ,
      term_label: 'Term 2 — AY2026',
    }),
    {
      href: `/markbook/change-requests?req=${GCR}&ay=AY2026`,
      label: 'Open request',
    },
  ],
  [
    'report card publication',
    row('report_card_publication', 'publication.create', 'x', {
      section_id: SECTION,
      term_number: 3,
      term_label: 'Term 3 — AY2026',
    }),
    {
      href: `/markbook/report-cards?ay=AY2026&section_id=${SECTION}&term=3`,
      label: 'Open report cards',
    },
  ],
  [
    'attendance mark → register on that day',
    row('attendance_daily', 'attendance.daily.update', null, {
      date: '2026-10-07',
      section_id: SECTION,
    }),
    { href: `/attendance/${SECTION}?date=2026-10-07`, label: 'Open register' },
  ],
  [
    'declaration decision → its request',
    row(
      'student_declaration',
      'declaration.approve',
      'e10047a9-9d63-4216-a3e2-b148df054136',
      {
        request_id: REQ,
      }
    ),
    { href: `/attendance/declarations?req=${REQ}`, label: 'Open declaration' },
  ],
  [
    'stage update → application in its year',
    row('enrolment_status', 'sis.stage.update', 'E260016', {
      ay_code: 'AY2026',
    }),
    {
      href: '/admissions/applications/E260016?ay=AY2026',
      label: 'Open application',
    },
  ],
  [
    'document → the Documents tab',
    row('enrolment_document', 'pfile.mark.promised', 'E260194:fatherPassport', {
      ay_code: 'AY2026',
      enroleeNumber: 'E260194',
    }),
    {
      href: '/admissions/applications/E260194?ay=AY2026&tab=documents',
      label: 'Open application',
    },
  ],
  [
    'house change (no AY) → the student record',
    row('enrolment_application', 'sis.house.update', 'E260087', {
      studentNumber: 'H220042',
    }),
    { href: '/records/students/H220042', label: 'Open student' },
  ],
  [
    'enrolment metadata → the student record',
    row(
      'section_student',
      'enrolment.metadata.update',
      'd7f31df6-cfa3-425f-84fe-5b29ced4a4ca',
      {
        studentNumber: 'H260090',
      }
    ),
    { href: '/records/students/H260090', label: 'Open student' },
  ],
  [
    'discipline → the Discipline tab',
    row(
      'student_discipline_record',
      'discipline.record.file',
      '733e7a66-33a4-4fc6-b93c-6744b27bbe38',
      {
        student_number: 'H220032',
      }
    ),
    { href: '/records/students/H220032?tab=discipline', label: 'Open student' },
  ],
  [
    'section',
    row('section', 'section.subjects.attach_many', SECTION),
    { href: `/sis/sections/${SECTION}`, label: 'Open section' },
  ],
  [
    'write-up → the class in Evaluation, on that term',
    row('evaluation_writeup', 'evaluation.writeup.save', 'w', {
      section_id: SECTION,
      term_id: TERM,
    }),
    {
      href: `/evaluation/sections/${SECTION}?term_id=${TERM}`,
      label: 'Open write-ups',
    },
  ],
  [
    'class note → the class',
    row('classroom_note', 'classroom.note.save', SECTION, {
      section_id: SECTION,
    }),
    { href: `/classroom/${SECTION}`, label: 'Open class' },
  ],
  [
    'house points entry → the event',
    row('house_point_entry', 'house_points.entry.update', 'e', {
      event_id: EVENT,
    }),
    { href: `/records/house-points/${EVENT}`, label: 'Open event' },
  ],
  [
    'house points event',
    row('house_point_event', 'house_points.event.create', EVENT),
    { href: `/records/house-points/${EVENT}`, label: 'Open event' },
  ],
  [
    'assignment → the teacher',
    row('teacher_assignment', 'assignment.create', 'a', {
      teacher_user_id: USER,
    }),
    { href: `/sis/admin/staff/${USER}`, label: 'Open staff member' },
  ],
  [
    'relief → cover',
    row('teacher_assignment', 'assignment.relief.start', 'a', { bulk: true }),
    { href: '/sis/admin/cover', label: 'Open cover' },
  ],
  [
    'user account → the staff member',
    row('user_account', 'user.create', USER),
    { href: `/sis/admin/staff/${USER}`, label: 'Open staff member' },
  ],
  [
    'academic year',
    row('academic_year', 'ay.create', 'y', { ay_code: 'AY2028' }),
    { href: '/sis/ay-setup?ay=AY2028', label: 'Open year setup' },
  ],
  [
    'term → its year from the label',
    row('term', 'ay.term_dates.update', 't', { label: 'Term 1 — AY2027' }),
    { href: '/sis/ay-setup?ay=AY2027', label: 'Open year setup' },
  ],
  [
    'subject config',
    row('subject_config', 'subject_config.create', 's', { ay_code: 'AY2028' }),
    { href: '/sis/admin/subjects?ay=AY2028', label: 'Open subject setup' },
  ],
  [
    'approvers',
    row('approver_assignment', 'approver.assign', 'p'),
    { href: '/sis/admin/approvers', label: 'Open approvers' },
  ],

  // ── No link: the row does not hold what the page needs ──
  [
    'attendance import with no section',
    row('attendance_daily', 'attendance.daily.update', null, {
      date: '2026-10-07',
    }),
    null,
  ],
  [
    'declaration filed (no request yet)',
    row('student_declaration', 'declaration.file', 'd', {}),
    null,
  ],
  [
    'stage update with no AY',
    row('enrolment_status', 'sis.stage.update', 'E260016', {}),
    null,
  ],
  [
    'bulk document expiry',
    row('enrolment_document', 'sis.documents.auto-expire', null, {}),
    null,
  ],
  [
    'grade entry with no sheet',
    row('grade_entry', 'entry.update', 'x', {}),
    null,
  ],
  [
    'sheet id that is not a uuid',
    row('grading_sheet', 'sheet.lock', 'nope'),
    null,
  ],
  [
    'report card with no AY',
    row('report_card_publication', 'publication.create', 'x', {
      section_id: SECTION,
      term_number: 3,
    }),
    null,
  ],
  [
    'student number that is not one',
    row('section_student', 'enrolment.metadata.update', 'x', {
      studentNumber: '../x',
    }),
    null,
  ],
  [
    'Billing rows are not mapped here',
    row('qbo_invoice', 'qbo.invoice.create', '416', {
      studentNumber: 'H260134',
    }),
    null,
  ],
  ['unknown type', row('something_new', 'x.y', 'z'), null],
];

describe('auditRowLink — mappings (superadmin)', () => {
  it.each(cases)('%s', (_name, input, expected) => {
    expect(auditRowLink(input, 'superadmin')).toEqual(expected);
  });
});

describe('auditRowLink — role gate', () => {
  const approvers = row('approver_assignment', 'approver.assign', 'p');
  const register = row('attendance_daily', 'attendance.daily.update', null, {
    section_id: SECTION,
  });
  const application = row('enrolment_status', 'sis.stage.update', 'E260016', {
    ay_code: 'AY2026',
  });

  const gate: Array<[string, AuditLinkRow, Role | null, boolean]> = [
    ['approvers: superadmin only', approvers, 'school_admin', false],
    ['approvers: superadmin', approvers, 'superadmin', true],
    [
      'register: a teacher may open /attendance but not any class',
      register,
      'teacher',
      false,
    ],
    ['register: academic coordinator', register, 'academic_coordinator', true],
    ['register: admissions has no /attendance', register, 'admissions', false],
    ['application: admissions', application, 'admissions', true],
    ['application: teacher has no /admissions', application, 'teacher', false],
    ['no role at all', application, null, false],
  ];

  it.each(gate)('%s', (_name, input, role, allowed) => {
    expect(auditRowLink(input, role) !== null).toBe(allowed);
  });
});
