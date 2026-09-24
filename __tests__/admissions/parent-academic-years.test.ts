import { describe, expect, it } from 'vitest';

import {
  toParentAcademicYears,
  type AcademicYearFlagsRow,
} from '@/lib/admissions/parent-academic-years';

// The rule behind the public GET /api/parent/v2/academic-years: it answers
// without a token, so which years it lists and which fields it lets out are
// its whole access control.

const row = (
  ay_code: string,
  is_current: boolean,
  accepting_applications: boolean,
  vizschool_accepting_applications: boolean
): AcademicYearFlagsRow => ({
  ay_code,
  is_current,
  accepting_applications,
  vizschool_accepting_applications,
});

describe('toParentAcademicYears', () => {
  it('lists a year open to either programme, with each flag reported', () => {
    expect(
      toParentAcademicYears([
        row('AY2026', true, true, true),
        row('AY2027', false, true, false),
        row('AY2028', false, false, true),
      ])
    ).toEqual([
      {
        ayCode: 'AY2026',
        isCurrent: true,
        hfseOpen: true,
        vizschoolOpen: true,
      },
      {
        ayCode: 'AY2027',
        isCurrent: false,
        hfseOpen: true,
        vizschoolOpen: false,
      },
      {
        ayCode: 'AY2028',
        isCurrent: false,
        hfseOpen: false,
        vizschoolOpen: true,
      },
    ]);
  });

  it('leaves out a year closed to both', () => {
    expect(
      toParentAcademicYears([
        row('AY2025', false, false, false),
        row('AY2026', true, true, false),
      ]).map((y) => y.ayCode)
    ).toEqual(['AY2026']);
  });

  it('never lists a test year, whatever its flags', () => {
    expect(
      toParentAcademicYears([
        row('AY9999', true, true, true),
        row('ay9001', false, true, true),
      ])
    ).toEqual([]);
  });

  it('orders oldest first regardless of input order', () => {
    expect(
      toParentAcademicYears([
        row('AY2028', false, false, true),
        row('AY2026', true, true, false),
        row('AY2027', false, true, false),
      ]).map((y) => y.ayCode)
    ).toEqual(['AY2026', 'AY2027', 'AY2028']);
  });

  it('lets out only the four named fields', () => {
    const extra = {
      ...row('AY2026', true, true, true),
      id: 'secret-uuid',
      label: 'Academic Year 2026',
    };
    expect(Object.keys(toParentAcademicYears([extra])[0]).sort()).toEqual([
      'ayCode',
      'hfseOpen',
      'isCurrent',
      'vizschoolOpen',
    ]);
  });
});
