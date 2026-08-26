import { describe, expect, it } from 'vitest';

import {
  ASSIGNMENT_ROLE_LABELS,
  AssignmentBulkCreateSchema,
  isAdviserRole,
  isSubjectRole,
} from '@/lib/schemas/teacher-assignment';

// Migration 124 — co_adviser and co_teacher.
//
// The rules these pin come straight from HFSE's AY2026 deployment workbook,
// which shares Sec 3 and Sec 4 Humanities between Ms Elaine and Ms Carl, both
// STAR classes between Ms Jing and Mr Hanafi, and Sec 4's form class between
// Ms Med and Ms Elaine. The schema has to accept all of that while still
// keeping ONE owner per grading sheet and ONE adviser per class.

const SECTION = '11111111-1111-4111-8111-111111111111';
const SECTION_B = '22222222-2222-4222-8222-222222222222';
const SUBJECT = '33333333-3333-4333-8333-333333333333';
const ELAINE = '44444444-4444-4444-8444-444444444444';
const CARL = '55555555-5555-4555-8555-555555555555';

const parse = (assignments: unknown[]) =>
  AssignmentBulkCreateSchema.safeParse({ assignments });

const msg = (r: ReturnType<typeof parse>) =>
  r.success ? '' : r.error.issues.map((i) => i.message).join(' | ');

describe('role vocabulary', () => {
  it('classifies adviser and subject roles', () => {
    expect(isAdviserRole('form_adviser')).toBe(true);
    expect(isAdviserRole('co_adviser')).toBe(true);
    expect(isAdviserRole('subject_teacher')).toBe(false);

    expect(isSubjectRole('subject_teacher')).toBe(true);
    expect(isSubjectRole('co_teacher')).toBe(true);
    expect(isSubjectRole('form_adviser')).toBe(false);
  });

  it('gives every role plain-English wording, with no database words', () => {
    for (const label of Object.values(ASSIGNMENT_ROLE_LABELS)) {
      expect(label).not.toMatch(/_/);
    }
    expect(ASSIGNMENT_ROLE_LABELS.co_teacher).toBe('Co-teacher');
  });
});

describe('AssignmentBulkCreateSchema — shape', () => {
  it('rejects a co-adviser carrying a subject', () => {
    const r = parse([
      {
        teacher_user_id: ELAINE,
        section_id: SECTION,
        subject_id: SUBJECT,
        role: 'co_adviser',
      },
    ]);
    expect(r.success).toBe(false);
    expect(msg(r)).toMatch(/leave the subject blank/i);
  });

  it('rejects a co-teacher with no subject', () => {
    const r = parse([
      {
        teacher_user_id: ELAINE,
        section_id: SECTION,
        subject_id: null,
        role: 'co_teacher',
      },
    ]);
    expect(r.success).toBe(false);
    expect(msg(r)).toMatch(/which subject/i);
  });
});

describe('AssignmentBulkCreateSchema — one owner, many co-holders', () => {
  it('accepts a subject teacher plus a co-teacher on the same sheet', () => {
    // Sec 3 Consistency Humanities: Ms Elaine Tue+Fri, Ms Carl Wed.
    const r = parse([
      {
        teacher_user_id: ELAINE,
        section_id: SECTION,
        subject_id: SUBJECT,
        role: 'subject_teacher',
      },
      {
        teacher_user_id: CARL,
        section_id: SECTION,
        subject_id: SUBJECT,
        role: 'co_teacher',
      },
    ]);
    expect(msg(r)).toBe('');
    expect(r.success).toBe(true);
  });

  it('accepts a form adviser plus a co-adviser on the same class', () => {
    // Sec 4 Excellence: "Ms Med & Ms Elaine".
    const r = parse([
      { teacher_user_id: ELAINE, section_id: SECTION, role: 'form_adviser' },
      { teacher_user_id: CARL, section_id: SECTION, role: 'co_adviser' },
    ]);
    expect(msg(r)).toBe('');
    expect(r.success).toBe(true);
  });

  it('still refuses TWO form advisers on one class', () => {
    const r = parse([
      { teacher_user_id: ELAINE, section_id: SECTION, role: 'form_adviser' },
      { teacher_user_id: CARL, section_id: SECTION, role: 'form_adviser' },
    ]);
    expect(r.success).toBe(false);
    expect(msg(r)).toMatch(/only one/i);
    // The message has to say what to do instead, or the admin is just stuck.
    expect(msg(r)).toMatch(/co-adviser/i);
  });

  it('still refuses TWO subject teachers on one sheet', () => {
    const r = parse([
      {
        teacher_user_id: ELAINE,
        section_id: SECTION,
        subject_id: SUBJECT,
        role: 'subject_teacher',
      },
      {
        teacher_user_id: CARL,
        section_id: SECTION,
        subject_id: SUBJECT,
        role: 'subject_teacher',
      },
    ]);
    expect(r.success).toBe(false);
    expect(msg(r)).toMatch(/co-teacher/i);
  });
});

describe('AssignmentBulkCreateSchema — a person holds a class once', () => {
  // Mirrors migration 124's two person-once partial indexes. Without these the
  // batch would insert happily and the DATABASE would reject the whole save
  // with an index name, losing every other row in the batch.
  it('refuses the same teacher as both owner and co-teacher of one sheet', () => {
    const r = parse([
      {
        teacher_user_id: ELAINE,
        section_id: SECTION,
        subject_id: SUBJECT,
        role: 'subject_teacher',
      },
      {
        teacher_user_id: ELAINE,
        section_id: SECTION,
        subject_id: SUBJECT,
        role: 'co_teacher',
      },
    ]);
    expect(r.success).toBe(false);
    expect(msg(r)).toMatch(/same teacher is listed twice/i);
  });

  it('refuses the same teacher as both adviser and co-adviser of one class', () => {
    const r = parse([
      { teacher_user_id: ELAINE, section_id: SECTION, role: 'form_adviser' },
      { teacher_user_id: ELAINE, section_id: SECTION, role: 'co_adviser' },
    ]);
    expect(r.success).toBe(false);
    expect(msg(r)).toMatch(/same teacher is listed twice/i);
  });

  it('allows the same teacher to co-teach the SAME subject in TWO classes', () => {
    // Ms Jing takes STAR in both P2 Humility and P4 Diligence.
    const r = parse([
      {
        teacher_user_id: ELAINE,
        section_id: SECTION,
        subject_id: SUBJECT,
        role: 'co_teacher',
      },
      {
        teacher_user_id: ELAINE,
        section_id: SECTION_B,
        subject_id: SUBJECT,
        role: 'co_teacher',
      },
    ]);
    expect(msg(r)).toBe('');
    expect(r.success).toBe(true);
  });

  it('allows several different co-teachers on one sheet', () => {
    const r = parse([
      {
        teacher_user_id: ELAINE,
        section_id: SECTION,
        subject_id: SUBJECT,
        role: 'co_teacher',
      },
      {
        teacher_user_id: CARL,
        section_id: SECTION,
        subject_id: SUBJECT,
        role: 'co_teacher',
      },
    ]);
    expect(msg(r)).toBe('');
    expect(r.success).toBe(true);
  });
});
