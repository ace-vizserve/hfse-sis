import { describe, expect, it } from 'vitest';

import { classTileState } from '@/lib/sis/class-tile-state';

// The Class Assignment tile's states. Class assignment is Enrolled-only:
// before Enrolled the tile shows a status line and no button.
describe('classTileState', () => {
  const base = { classLevel: null, classSection: null, inClass: false };

  it('offers no button before enrolment when no class is set', () => {
    const state = classTileState({ ...base, applicationStatus: 'Submitted' });
    expect(state).toEqual({
      kind: 'before_enrolled',
      line: 'Assigned after enrolment',
    });
    expect('action' in state).toBe(false);
  });

  it('names a class set in Directus before enrolment, with no button', () => {
    const state = classTileState({
      applicationStatus: 'Processing',
      classLevel: 'Primary 3',
      classSection: 'Courageous',
      inClass: false,
    });
    expect(state).toEqual({
      kind: 'before_enrolled',
      line: 'Primary 3 · Courageous — joins when enrolled',
    });
    expect('action' in state).toBe(false);
  });

  it('treats a blank status as not enrolled yet', () => {
    expect(classTileState({ ...base, applicationStatus: null })).toEqual({
      kind: 'before_enrolled',
      line: 'Assigned after enrolment',
    });
  });

  it('offers "Assign a class" for an enrolled child with no class', () => {
    for (const status of ['Enrolled', 'Enrolled (Conditional)']) {
      expect(classTileState({ ...base, applicationStatus: status })).toEqual({
        kind: 'awaiting',
        line: 'Awaiting class assignment',
        action: { label: 'Assign a class' },
      });
    }
  });

  it('says an enrolled child with a class set is not in the class yet', () => {
    expect(
      classTileState({
        applicationStatus: 'Enrolled',
        classLevel: 'Secondary 1',
        classSection: 'Discipline 1',
        inClass: false,
      })
    ).toEqual({
      kind: 'not_in_class_yet',
      line: 'Secondary 1 · Discipline 1 — not in the class yet',
      action: { label: 'Assign a class' },
    });
  });

  it('a level with no section is not a named class', () => {
    expect(
      classTileState({
        applicationStatus: 'Submitted',
        classLevel: 'Primary 1',
        classSection: '  ',
        inClass: false,
      })
    ).toEqual({ kind: 'before_enrolled', line: 'Assigned after enrolment' });
  });

  it('leaves a child on a class list to the existing Change section control', () => {
    expect(
      classTileState({
        applicationStatus: 'Enrolled',
        classLevel: 'Primary 3',
        classSection: 'Courageous',
        inClass: true,
      })
    ).toEqual({ kind: 'in_class' });
    // Including the in-class-but-Submitted children.
    expect(
      classTileState({
        applicationStatus: 'Submitted',
        classLevel: 'Primary 3',
        classSection: 'Courageous',
        inClass: true,
      })
    ).toEqual({ kind: 'in_class' });
  });

  it('offers nothing for a cancelled or withdrawn application', () => {
    for (const status of ['Cancelled', 'Withdrawn']) {
      expect(
        classTileState({ ...base, applicationStatus: status, inClass: true })
      ).toEqual({ kind: 'closed' });
      expect(classTileState({ ...base, applicationStatus: status })).toEqual({
        kind: 'closed',
      });
    }
  });
});
