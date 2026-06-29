/**
 * Tests for buildChaseState() — the pure FCA-monitoring aggregator extracted
 * from lib/evaluation/drill.ts. Guards pain-point #5 (Joann's "which advisers
 * haven't submitted" view).
 */

import { describe, it, expect } from 'vitest';
import { buildChaseState, type StudentLite } from '@/lib/evaluation/drill';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function student(
  id: string,
  firstName: string,
  lastName: string,
  studentNumber: string
): StudentLite {
  return {
    id,
    first_name: firstName,
    middle_name: null,
    last_name: lastName,
    student_number: studentNumber,
  };
}

function mkOpts(opts: {
  roster: Array<{ section_id: string; student_id: string }>;
  submitted?: Set<string>;
  sections?: Record<string, string>; // section_id → name
  advisers?: Record<string, string>; // section_id → adviser userId
  students?: StudentLite[];
  adviserNames?: Record<string, string>; // adviser userId → display name
  termId?: string;
  termNumber?: number;
}) {
  return {
    roster: opts.roster,
    submittedStudentIds: opts.submitted ?? new Set<string>(),
    sectionById: new Map(Object.entries(opts.sections ?? {})),
    adviserBySection: new Map(Object.entries(opts.advisers ?? {})),
    studentMap: new Map((opts.students ?? []).map((s) => [s.id, s])),
    adviserNameById: new Map(Object.entries(opts.adviserNames ?? {})),
    termId: opts.termId ?? 't1',
    termNumber: opts.termNumber ?? 1,
  };
}

// ─── Core outstanding logic ───────────────────────────────────────────────────

describe('buildChaseState — outstanding write-ups', () => {
  it('empty roster → no outstanding, no advisers behind', () => {
    const result = buildChaseState(mkOpts({ roster: [] }));
    expect(result.outstanding).toHaveLength(0);
    expect(result.advisersBehind).toHaveLength(0);
    expect(result.hasUnassignedSection).toBe(false);
  });

  it('all submitted → no outstanding', () => {
    const result = buildChaseState(
      mkOpts({
        roster: [{ section_id: 's1', student_id: 'stu1' }],
        submitted: new Set(['stu1']),
        sections: { s1: 'P1 Obedience' },
        students: [student('stu1', 'Ana', 'Cruz', 'SN-001')],
      })
    );
    expect(result.outstanding).toHaveLength(0);
  });

  it('unsubmitted student appears in outstanding with correct fields', () => {
    const result = buildChaseState(
      mkOpts({
        roster: [{ section_id: 's1', student_id: 'stu1' }],
        sections: { s1: 'P1 Obedience' },
        advisers: { s1: 'adv1' },
        students: [student('stu1', 'Ana', 'Cruz', 'SN-001')],
        adviserNames: { adv1: 'Ms. Santos' },
      })
    );
    expect(result.outstanding).toHaveLength(1);
    expect(result.outstanding[0]).toMatchObject({
      studentNumber: 'SN-001',
      studentName: 'Ana Cruz',
      sectionName: 'P1 Obedience',
      adviserName: 'Ms. Santos',
    });
  });

  it('submitted flag gates only submitted + non-empty (empty strings still outstanding)', () => {
    // submitted = true but empty writeup should still appear — the Set is built
    // by the caller who already filters for non-empty content (KD #120/KD #126).
    // Here we test that buildChaseState respects whatever the caller passes.
    const submitted = new Set(['stu-sub']);
    const result = buildChaseState(
      mkOpts({
        roster: [
          { section_id: 's1', student_id: 'stu-sub' },
          { section_id: 's1', student_id: 'stu-pending' },
        ],
        submitted,
        sections: { s1: 'P1' },
        students: [
          student('stu-sub', 'A', 'Submitted', 'SN-001'),
          student('stu-pending', 'B', 'Pending', 'SN-002'),
        ],
      })
    );
    expect(result.outstanding).toHaveLength(1);
    expect(result.outstanding[0].studentNumber).toBe('SN-002');
  });
});

// ─── Transfer-safe (KD #120) ──────────────────────────────────────────────────

describe('buildChaseState — transfer-safe (KD #120)', () => {
  it('student in NEW section after transfer: tally uses current roster section_id', () => {
    // A transferred student has a NEW section_students row in the destination.
    // The roster is built from the live active roster (non-withdrawn), so the
    // student appears once under the new section — buildChaseState works on the
    // already-resolved roster, not the raw writeup section_id.
    const result = buildChaseState(
      mkOpts({
        roster: [{ section_id: 'new-section', student_id: 'stu1' }],
        sections: {
          'new-section': 'P2 Honesty',
          'old-section': 'P1 Obedience',
        },
        advisers: { 'new-section': 'new-adv', 'old-section': 'old-adv' },
        students: [student('stu1', 'Maria', 'Santos', 'SN-100')],
        adviserNames: { 'new-adv': 'New Teacher', 'old-adv': 'Old Teacher' },
      })
    );
    expect(result.outstanding[0].sectionName).toBe('P2 Honesty');
    expect(result.outstanding[0].adviserName).toBe('New Teacher');
  });
});

// ─── Advisers-behind grouping ─────────────────────────────────────────────────

describe('buildChaseState — advisers behind', () => {
  it('one section, one adviser, one outstanding → one advisers-behind row', () => {
    const result = buildChaseState(
      mkOpts({
        roster: [{ section_id: 's1', student_id: 'stu1' }],
        sections: { s1: 'P1 Obedience' },
        advisers: { s1: 'adv1' },
        students: [student('stu1', 'Ana', 'Cruz', 'SN-001')],
        adviserNames: { adv1: 'Ms. Santos' },
      })
    );
    expect(result.advisersBehind).toHaveLength(1);
    expect(result.advisersBehind[0]).toMatchObject({
      adviserName: 'Ms. Santos',
      outstanding: 1,
      sections: 'P1 Obedience',
    });
  });

  it('adviser behind with multiple sections gets comma-joined sorted section names', () => {
    const result = buildChaseState(
      mkOpts({
        roster: [
          { section_id: 's1', student_id: 'stu1' },
          { section_id: 's2', student_id: 'stu2' },
        ],
        sections: { s1: 'P1 Zeal', s2: 'P1 Aim' },
        advisers: { s1: 'adv1', s2: 'adv1' }, // same adviser, two sections
        students: [
          student('stu1', 'A', 'B', 'SN-001'),
          student('stu2', 'C', 'D', 'SN-002'),
        ],
        adviserNames: { adv1: 'Ms. Santos' },
      })
    );
    expect(result.advisersBehind).toHaveLength(1);
    expect(result.advisersBehind[0].outstanding).toBe(2);
    expect(result.advisersBehind[0].sections).toBe('P1 Aim, P1 Zeal'); // sorted
  });

  it('sorted biggest-gap-first (more outstanding → higher rank)', () => {
    const result = buildChaseState(
      mkOpts({
        roster: [
          { section_id: 's1', student_id: 'stu1' },
          { section_id: 's2', student_id: 'stu2' },
          { section_id: 's2', student_id: 'stu3' },
        ],
        sections: { s1: 'P1', s2: 'P2' },
        advisers: { s1: 'adv1', s2: 'adv2' },
        students: [
          student('stu1', 'A', 'B', 'SN-001'),
          student('stu2', 'C', 'D', 'SN-002'),
          student('stu3', 'E', 'F', 'SN-003'),
        ],
        adviserNames: { adv1: 'Teacher A', adv2: 'Teacher B' },
      })
    );
    // adv2 has 2 outstanding, adv1 has 1 → adv2 first
    expect(result.advisersBehind[0].adviserName).toBe('Teacher B');
    expect(result.advisersBehind[0].outstanding).toBe(2);
    expect(result.advisersBehind[1].adviserName).toBe('Teacher A');
  });
});

// ─── Unassigned section bucket ────────────────────────────────────────────────

describe('buildChaseState — unassigned section bucket', () => {
  it('section with no adviser → adviserName null, hasUnassignedSection true', () => {
    const result = buildChaseState(
      mkOpts({
        roster: [{ section_id: 's1', student_id: 'stu1' }],
        sections: { s1: 'P1 Obedience' },
        // No advisers → adviserBySection is empty
        students: [student('stu1', 'Ana', 'Cruz', 'SN-001')],
      })
    );
    expect(result.hasUnassignedSection).toBe(true);
    expect(result.advisersBehind).toHaveLength(1);
    expect(result.advisersBehind[0].adviserName).toBeNull();
  });

  it('all sections have advisers → hasUnassignedSection false', () => {
    const result = buildChaseState(
      mkOpts({
        roster: [{ section_id: 's1', student_id: 'stu1' }],
        sections: { s1: 'P1 Obedience' },
        advisers: { s1: 'adv1' },
        students: [student('stu1', 'Ana', 'Cruz', 'SN-001')],
        adviserNames: { adv1: 'Ms. Santos' },
      })
    );
    expect(result.hasUnassignedSection).toBe(false);
  });

  it('unassigned bucket sorts LAST on ties (null adviser name)', () => {
    const result = buildChaseState(
      mkOpts({
        roster: [
          { section_id: 'no-adv', student_id: 'stu-unassigned' },
          { section_id: 'has-adv', student_id: 'stu-assigned' },
        ],
        sections: { 'no-adv': 'P1', 'has-adv': 'P2' },
        advisers: { 'has-adv': 'adv1' }, // no-adv has none
        students: [
          student('stu-unassigned', 'A', 'B', 'SN-001'),
          student('stu-assigned', 'C', 'D', 'SN-002'),
        ],
        adviserNames: { adv1: 'Teacher A' },
      })
    );
    // Both have 1 outstanding — tie — but Unassigned (null) sorts LAST
    expect(result.advisersBehind[0].adviserName).toBe('Teacher A');
    expect(result.advisersBehind[1].adviserName).toBeNull();
  });
});

// ─── Outstanding sort order ───────────────────────────────────────────────────

describe('buildChaseState — outstanding row sort order', () => {
  it('sorted by sectionName then studentName', () => {
    const result = buildChaseState(
      mkOpts({
        roster: [
          { section_id: 's2', student_id: 'stu-b' }, // P2 section
          { section_id: 's1', student_id: 'stu-z' }, // P1 section, last name Z
          { section_id: 's1', student_id: 'stu-a' }, // P1 section, last name A
        ],
        sections: { s1: 'P1', s2: 'P2' },
        students: [
          student('stu-b', 'Jose', 'Bautista', 'SN-002'),
          student('stu-z', 'Zara', 'Zorro', 'SN-003'),
          student('stu-a', 'Ana', 'Abad', 'SN-001'),
        ],
      })
    );
    // P1 first (alphabetically), then within P1 by student name
    expect(result.outstanding[0].sectionName).toBe('P1');
    expect(result.outstanding[0].studentName).toBe('Ana Abad');
    expect(result.outstanding[1].sectionName).toBe('P1');
    expect(result.outstanding[1].studentName).toBe('Zara Zorro');
    expect(result.outstanding[2].sectionName).toBe('P2');
  });
});

// ─── Term metadata passthrough ────────────────────────────────────────────────

describe('buildChaseState — term metadata', () => {
  it('termId and termNumber pass through to the returned state', () => {
    const result = buildChaseState(
      mkOpts({ roster: [], termId: 'term-t2-id', termNumber: 2 })
    );
    expect(result.termId).toBe('term-t2-id');
    expect(result.termNumber).toBe(2);
  });
});
