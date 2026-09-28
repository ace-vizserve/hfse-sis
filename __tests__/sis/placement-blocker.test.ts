import { describe, it, expect } from 'vitest';

import { describePlacementBlocker } from '@/lib/sis/placement-blocker';
import { buildSyncPlan } from '@/lib/sync/students';

// The blocker is a PREDICTION of the sync's refusal, so these tests pin it to
// the sync twice: once on the wording a registrar sees, and once by running
// the real `buildSyncPlan` on the same inputs and checking the two agree on
// whether the child can be placed.

const LEVELS = [
  { id: 'lvl-s1', label: 'Secondary One' },
  { id: 'lvl-p1', label: 'Primary One' },
  { id: 'lvl-c8', label: 'Cambridge Secondary One (Year 8)' },
];
const SECTIONS = [
  { id: 'sec-d1', level_id: 'lvl-s1', name: 'Discipline 1' },
  { id: 'sec-cou', level_id: 'lvl-p1', name: 'Courageous' },
];
const LOOKUP = { levels: LEVELS, sections: SECTIONS };

function blocker(classLevel: string | null, classSection: string | null) {
  return describePlacementBlocker(
    { ayCode: 'AY2027', classLevel, classSection },
    LOOKUP
  );
}

function syncPlaces(classLevel: string | null, classSection: string | null) {
  const plan = buildSyncPlan(
    [
      {
        student_number: 'H270001',
        class_level: classLevel,
        class_section: classSection,
        last_name: 'Tan',
        first_name: 'Mei',
        // The queue only lists Enrolled children, so compare against the
        // sync as it treats an Enrolled one.
        application_status: 'Enrolled',
      } as unknown as Parameters<typeof buildSyncPlan>[0][number],
    ],
    {
      levels: LEVELS,
      sections: SECTIONS,
      students: [],
      enrollments: [],
    } as unknown as Parameters<typeof buildSyncPlan>[1]
  );
  return plan.errors.length === 0;
}

describe('describePlacementBlocker', () => {
  it('returns null for a class the sync can place', () => {
    expect(blocker('Secondary One', 'Discipline 1')).toBeNull();
  });

  it('accepts the spellings the sync normalises: "Discipline-1", digit levels, known typos', () => {
    expect(blocker('Secondary One', 'Discipline-1')).toBeNull();
    expect(blocker('Secondary 1', 'Discipline_1')).toBeNull();
    expect(blocker('Primary 1', 'Courageos')).toBeNull();
  });

  it('names a level the SIS does not have ("Year 8")', () => {
    const b = blocker('Year 8', 'Discipline 1');
    expect(b).toContain('"Year 8" is not a level the school uses');
    expect(b).toContain('Assign section');
  });

  it('says so when no level was filled in', () => {
    expect(blocker(null, 'Discipline 1')).toContain('No level was filled in');
    expect(blocker('   ', 'Discipline 1')).toContain('No level was filled in');
  });

  it('names a class that does not exist for that level and year, as it was typed', () => {
    const b = blocker('Secondary One', 'Integrity-2');
    expect(b).toBe(
      'There is no class called "Integrity-2" in Secondary One for AY2027. Use Assign section to pick a class that exists.'
    );
  });

  it('treats a class that exists under ANOTHER level as missing, as the sync does', () => {
    expect(blocker('Primary One', 'Discipline 1')).toContain(
      'There is no class called "Discipline 1" in Primary One'
    );
  });

  it('agrees with buildSyncPlan on every case above', () => {
    const cases: Array<[string | null, string | null]> = [
      ['Secondary One', 'Discipline 1'],
      ['Secondary One', 'Discipline-1'],
      ['Secondary 1', 'Discipline_1'],
      ['Primary 1', 'Courageos'],
      ['Year 8', 'Discipline 1'],
      [null, 'Discipline 1'],
      ['Secondary One', 'Integrity-2'],
      ['Primary One', 'Discipline 1'],
      ['secondary one', 'Discipline 1'],
      ['Secondary One', 'discipline 1'],
    ];
    for (const [level, section] of cases) {
      expect(blocker(level, section) === null, `${level} / ${section}`).toBe(
        syncPlaces(level, section)
      );
    }
  });
});
