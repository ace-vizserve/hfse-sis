import { describe, expect, it } from 'vitest';

import { classTileState } from '@/lib/sis/class-tile-state';

// The Class Assignment tile's states — the table in Phase 4 of
// docs/superpowers/plans/2026-09-28-class-assignment-any-stage.md.
describe('classTileState', () => {
  const base = { classLevel: null, classSection: null, inClass: false };

  it('offers "Choose a class" before enrolment when no class is chosen', () => {
    expect(classTileState({ ...base, applicationStatus: 'Submitted' })).toEqual(
      {
        kind: 'choose',
        line: 'No class chosen yet',
        action: { mode: 'choose', label: 'Choose a class' },
      }
    );
  });

  it('offers "Change class" before enrolment when a class is chosen', () => {
    expect(
      classTileState({
        applicationStatus: 'Processing',
        classLevel: 'Primary 3',
        classSection: 'Courageous',
        inClass: false,
      })
    ).toEqual({
      kind: 'change_choice',
      line: 'Joins Primary 3 · Courageous when enrolled',
      action: { mode: 'choose', label: 'Change class' },
    });
  });

  it('treats a blank status as not enrolled yet', () => {
    expect(classTileState({ ...base, applicationStatus: null }).kind).toBe(
      'choose'
    );
  });

  it('offers "Assign a class" in place mode for an enrolled child with no class', () => {
    for (const status of ['Enrolled', 'Enrolled (Conditional)']) {
      expect(classTileState({ ...base, applicationStatus: status })).toEqual({
        kind: 'awaiting',
        line: 'Awaiting class assignment',
        action: { mode: 'place', label: 'Assign a class' },
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
      action: { mode: 'place', label: 'Assign a class' },
    });
  });

  it('a level with no section is not a chosen class', () => {
    expect(
      classTileState({
        applicationStatus: 'Submitted',
        classLevel: 'Primary 1',
        classSection: '  ',
        inClass: false,
      }).kind
    ).toBe('choose');
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
    // Including the in-class-but-Submitted children — never offered a choice.
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
