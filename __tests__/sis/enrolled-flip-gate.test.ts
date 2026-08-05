import { describe, expect, it } from 'vitest';

import {
  ENROLLED_PREREQ_STAGES,
  STAGE_TERMINAL_STATUS,
  evaluateEnrolledFlip,
} from '@/lib/schemas/sis';

// Step 10 of HFSE's admission process. Class Assignment is step 11 and is
// deliberately NOT gated here — see docs/context/admission-process.md.

/** Every prereq stage at its terminal value — a student ready to enrol. */
const ALL_DONE: Record<string, string | null> = Object.fromEntries(
  ENROLLED_PREREQ_STAGES.map((k) => [k, STAGE_TERMINAL_STATUS[k]!])
);

const SECTION = 'b3d0e1f2-0000-4000-8000-000000000001';

function gate(overrides: Partial<Parameters<typeof evaluateEnrolledFlip>[0]>) {
  return evaluateEnrolledFlip({
    canAssignSection: true,
    sectionId: null,
    prereqStatuses: ALL_DONE,
    studentNumber: 'S-0001',
    ...overrides,
  });
}

describe('evaluateEnrolledFlip', () => {
  describe('the prereq gate — unchanged, and must stay that way', () => {
    it('blocks when a prereq stage is unfinished, listing it', () => {
      const result = gate({
        prereqStatuses: { ...ALL_DONE, fees: 'Pending' },
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.status).toBe(422);
      expect(result.code).toBe('prereqs_incomplete');
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers![0]).toMatchObject({ current: 'Pending' });
    });

    it('lists every unfinished stage, not just the first', () => {
      const result = gate({ prereqStatuses: {} });

      if (result.ok) throw new Error('unreachable');
      expect(result.blockers).toHaveLength(ENROLLED_PREREQ_STAGES.length);
      expect(result.blockers!.every((b) => b.current === null)).toBe(true);
    });

    // The whole point of the change is that the SECTION requirement goes away,
    // not the prereqs. If a future edit weakens this, the funnel stops meaning
    // anything.
    it('blocks regardless of whether a section is supplied', () => {
      const incomplete = { ...ALL_DONE, contract: 'Pending' };

      expect(gate({ prereqStatuses: incomplete }).ok).toBe(false);
      expect(gate({ prereqStatuses: incomplete, sectionId: SECTION }).ok).toBe(
        false
      );
    });

    it('reports the blocker with a human stage label, not a column name', () => {
      const result = gate({ prereqStatuses: { ...ALL_DONE, documents: null } });

      if (result.ok) throw new Error('unreachable');
      expect(result.blockers![0].stage).not.toMatch(/Status$/);
      expect(result.blockers![0].stage.length).toBeGreaterThan(0);
    });
  });

  describe('enrolling without a class — the normal path', () => {
    it('passes with no section, and reports that nothing was assigned', () => {
      const result = gate({ sectionId: null });

      expect(result).toEqual({ ok: true, assignsSection: false });
    });

    it('treats an empty-string section as no section', () => {
      expect(gate({ sectionId: '' })).toEqual({
        ok: true,
        assignsSection: false,
      });
    });

    it('passes even for a role that may not assign classes', () => {
      // An admissions user finishes step 10; Student Affairs do step 11.
      expect(gate({ canAssignSection: false, sectionId: null }).ok).toBe(true);
    });

    // The student number guard exists to stop "Enrolled holding a class it
    // never reached the roster with". With no class there is nothing to
    // guarantee, and the missing number is already reported separately by the
    // students-needing-setup queue.
    it('passes with no student number when no class is being assigned', () => {
      expect(gate({ studentNumber: null, sectionId: null }).ok).toBe(true);
    });
  });

  describe('assigning a class at the same time — the convenience path', () => {
    it('passes for a role that may place students', () => {
      expect(gate({ canAssignSection: true, sectionId: SECTION })).toEqual({
        ok: true,
        assignsSection: true,
      });
    });

    it('refuses a role that may enrol but not place', () => {
      const result = gate({ canAssignSection: false, sectionId: SECTION });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.status).toBe(403);
      expect(result.code).toBe('placement_forbidden');
      expect(result.error).toMatch(/Records/);
    });

    it('still refuses when the applicant has no student number', () => {
      const result = gate({ sectionId: SECTION, studentNumber: null });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.status).toBe(422);
      expect(result.code).toBe('no_student_number');
    });

    it('checks prereqs before the placement role — an unready student reports the real blocker', () => {
      const result = gate({
        canAssignSection: false,
        sectionId: SECTION,
        prereqStatuses: { ...ALL_DONE, fees: 'Pending' },
      });

      if (result.ok) throw new Error('unreachable');
      expect(result.code).toBe('prereqs_incomplete');
    });
  });
});
