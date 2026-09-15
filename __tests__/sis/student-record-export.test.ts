/**
 * One child's whole record as a file.
 *
 * Miss Joann's consolidated file held, per student per term, the attendance and
 * the grades per subject, and she has agreed it is retired into the SIS. The
 * masterfile export is its cohort-shaped half but is level-scoped, so this is
 * the per-student half.
 *
 * The properties pinned here are the ones that fail quietly: a letter subject
 * must not print its band-representative integer, HTML must not reach a
 * spreadsheet cell, and a leaver's earlier years must still be in the file.
 */

import { describe, it, expect } from 'vitest';

import { buildStudentRecordExport } from '@/lib/sis/student-record-export';

const STUDENT = {
  studentId: 'stu-1',
  studentNumber: 'H250785',
  firstName: 'Audrey',
  middleName: 'Elizabeth',
  lastName: 'Calimbas',
};

const PLACEMENTS = [
  {
    enrolmentId: 'e2',
    ayCode: 'AY2026',
    ayLabel: 'AY 2026',
    sectionId: 'sec-2',
    sectionName: 'Consistency',
    levelCode: 'S3',
    levelLabel: 'Secondary Three',
    enrollmentStatus: 'active' as const,
    indexNumber: 3,
    enrollmentDate: '2026-04-01',
    withdrawalDate: null,
    busNo: null,
    classroomOfficerRole: null,
    withdrawalReason: null,
    withdrawalNotes: null,
    lateEnrolleTermNumber: null,
    academicsNotes: null,
    adminNotes: null,
  },
];

function findSection(
  out: ReturnType<typeof buildStudentRecordExport>,
  startsWith: string
) {
  return out.sections.find((s) => s.title.startsWith(startsWith));
}

describe('buildStudentRecordExport', () => {
  it('names the file by the stable student number, not the child', () => {
    // Hard Rule #4 — studentNumber is the only stable id, and a filename with a
    // name in it collides the moment two children share one.
    const out = buildStudentRecordExport({
      student: STUDENT,
      placements: [],
      academic: [],
      attendance: [],
    });
    expect(out.filename).toBe('student-record-H250785.csv');
    expect(out.scope).toContainEqual(['Student number', 'H250785']);
  });

  it('prints a letter subject as its letter, never its band number', () => {
    // KD #176: a non-examinable subject's quarterly_grade is a
    // band-representative integer standing in for a letter (95/87/82/70), not a
    // mark. Printing 87 in a permanent record invents a grade nobody awarded.
    const out = buildStudentRecordExport({
      student: STUDENT,
      placements: PLACEMENTS,
      academic: [
        {
          ayCode: 'AY2026',
          ayLabel: 'AY 2026',
          terms: [
            {
              termNumber: 1,
              subjects: [
                {
                  subjectCode: 'MAPEH',
                  subjectName: 'STAR',
                  isExaminable: false,
                  initialGrade: null,
                  quarterlyGrade: 87,
                  annualLetterGrade: 'Passed',
                },
                {
                  subjectCode: 'MATH',
                  subjectName: 'Mathematics',
                  isExaminable: true,
                  initialGrade: null,
                  quarterlyGrade: 91,
                  annualLetterGrade: null,
                },
              ],
            },
          ],
        },
      ],
      attendance: [],
    });

    const grades = findSection(out, 'Grades');
    expect(grades).toBeDefined();
    const mapeh = grades!.rows.find((r) => r[0] === 'STAR');
    const math = grades!.rows.find((r) => r[0] === 'Mathematics');
    expect(mapeh?.[1]).toBe('Passed');
    expect(mapeh?.[1]).not.toBe(87);
    expect(math?.[1]).toBe(91);
  });

  it('carries the dates behind the attendance counts', () => {
    const out = buildStudentRecordExport({
      student: STUDENT,
      placements: PLACEMENTS,
      academic: [],
      attendance: [
        {
          ayCode: 'AY2026',
          ayLabel: 'AY 2026',
          terms: [
            {
              termNumber: 3,
              schoolDays: 50,
              daysPresent: 48,
              daysLate: 1,
            },
          ],
        },
      ],
      missedDates: new Map([['AY2026|3', '12 Aug absent · 3 Sep late']]),
    });

    const att = findSection(out, 'Attendance');
    expect(att?.rows[0]).toEqual([
      'Term 3',
      50,
      48,
      1,
      '96%',
      '12 Aug absent · 3 Sep late',
    ]);
  });

  it('strips HTML out of the adviser comment', () => {
    // These columns hold HTML (KD #205). A <ul> in a spreadsheet cell is markup,
    // not a list, and everything leaving the app is stripped.
    const out = buildStudentRecordExport({
      student: STUDENT,
      placements: PLACEMENTS,
      academic: [],
      attendance: [],
      writeups: [
        {
          ayCode: 'AY2026',
          termNumber: 1,
          virtueTheme: 'Respect',
          writeup: '<p>Audrey is <strong>attentive</strong> in class.</p>',
        },
      ],
    });

    const comments = findSection(out, 'Form class adviser');
    expect(comments?.rows[0]?.[3]).toBe('Audrey is attentive in class.');
    expect(String(comments?.rows[0]?.[3])).not.toContain('<');
  });

  it('omits the comments section when every write-up is empty', () => {
    // An editor clicked into and left alone stores `<p></p>` — seven truthy
    // characters. A section of blank rows reads as data that is missing rather
    // than data that was never written.
    const out = buildStudentRecordExport({
      student: STUDENT,
      placements: PLACEMENTS,
      academic: [],
      attendance: [],
      writeups: [
        {
          ayCode: 'AY2026',
          termNumber: 1,
          virtueTheme: null,
          writeup: '<p></p>',
        },
      ],
    });
    expect(findSection(out, 'Form class adviser')).toBeUndefined();
  });

  it('keeps every academic year, so a leaver has a full transcript', () => {
    const out = buildStudentRecordExport({
      student: STUDENT,
      placements: PLACEMENTS,
      academic: [
        {
          ayCode: 'AY2025',
          ayLabel: 'AY 2025',
          terms: [
            {
              termNumber: 1,
              subjects: [
                {
                  subjectCode: 'MATH',
                  subjectName: 'Mathematics',
                  isExaminable: true,
                  initialGrade: null,
                  quarterlyGrade: 80,
                  annualLetterGrade: null,
                },
              ],
            },
          ],
        },
        {
          ayCode: 'AY2026',
          ayLabel: 'AY 2026',
          terms: [
            {
              termNumber: 1,
              subjects: [
                {
                  subjectCode: 'MATH',
                  subjectName: 'Mathematics',
                  isExaminable: true,
                  initialGrade: null,
                  quarterlyGrade: 91,
                  annualLetterGrade: null,
                },
              ],
            },
          ],
        },
      ],
      attendance: [],
    });

    const titles = out.sections.map((s) => s.title);
    expect(titles).toContain('Grades — AY 2025');
    expect(titles).toContain('Grades — AY 2026');
  });
});
