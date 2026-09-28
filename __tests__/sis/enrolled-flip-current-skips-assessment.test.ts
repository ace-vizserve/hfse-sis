import { describe, expect, it } from 'vitest';

import {
  enrolledPrereqStagesFor,
  evaluateEnrolledFlip,
  STAGE_TERMINAL_STATUS,
} from '@/lib/schemas/sis';

// Miss Apple, 2026-09-28: "sa new lang po ang assessment sir, current none po
// we skip over this one".

const DONE_EXCEPT_ASSESSMENT = {
  registration: STAGE_TERMINAL_STATUS.registration!,
  documents: STAGE_TERMINAL_STATUS.documents!,
  assessment: null,
  contract: STAGE_TERMINAL_STATUS.contract!,
  fees: STAGE_TERMINAL_STATUS.fees!,
};

const flip = (category: string | null) =>
  evaluateEnrolledFlip({
    canAssignSection: true,
    sectionId: null,
    prereqStatuses: DONE_EXCEPT_ASSESSMENT,
    studentNumber: 'H1',
    category,
  });

describe('Assessment is for new students only', () => {
  it('drops Assessment for Current and VizSchool Current', () => {
    expect(enrolledPrereqStagesFor('Current')).not.toContain('assessment');
    expect(enrolledPrereqStagesFor(' VizSchool Current ')).not.toContain(
      'assessment'
    );
    expect(enrolledPrereqStagesFor('Current')).toHaveLength(4);
  });

  it('keeps all five for New, VizSchool New and an unknown or blank category', () => {
    for (const c of ['New', 'VizSchool New', '', null, undefined, 'Other']) {
      expect(enrolledPrereqStagesFor(c)).toContain('assessment');
      expect(enrolledPrereqStagesFor(c)).toHaveLength(5);
    }
  });

  it('lets a Current child enrol without Assessment', () => {
    expect(flip('Current')).toEqual({ ok: true, assignsSection: false });
  });

  it('still blocks a New child on Assessment', () => {
    const r = flip('New');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.blockers?.map((b) => b.stage)).toEqual([
      'Assessment',
    ]);
  });

  it('still blocks when the category is missing — fails closed', () => {
    expect(flip(null).ok).toBe(false);
  });
});
