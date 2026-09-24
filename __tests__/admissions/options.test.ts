import { describe, it, expect } from 'vitest';

import {
  deriveOptions,
  trackForClassType,
  type AdmissionOptionRow,
} from '@/lib/admissions/options';

const row = (
  level_label: string,
  class_type_label: string,
  schedule: AdmissionOptionRow['schedule'],
  is_open: boolean,
  sort_order: number
): AdmissionOptionRow => ({
  level_label,
  class_type_label,
  schedule,
  is_open,
  sort_order,
});

describe('deriveOptions', () => {
  it('builds levels, types and schedules from open rows only', () => {
    const rows = [
      row('Primary Three', 'Standard', 'morning', false, 10),
      row('Primary Three', 'Standard', 'afternoon', true, 20),
      row('Primary Three', 'GLOBAL (ENGLISH + FRENCH)', 'morning', true, 30),
      row('Primary Three', 'GLOBAL (ENGLISH + FRENCH)', 'afternoon', false, 40),
      row('Secondary One', 'Standard', 'whole_day', true, 50),
    ];
    expect(deriveOptions(rows)).toEqual([
      {
        levelLabel: 'Primary Three',
        classTypes: [
          { classTypeLabel: 'Standard', schedules: ['Afternoon'] },
          {
            classTypeLabel: 'GLOBAL (ENGLISH + FRENCH)',
            schedules: ['Morning'],
          },
        ],
      },
      {
        levelLabel: 'Secondary One',
        classTypes: [{ classTypeLabel: 'Standard', schedules: ['Whole Day'] }],
      },
    ]);
  });

  it('drops a type, then a level, whose every row is closed', () => {
    const rows = [
      row('Primary One', 'Standard', 'morning', true, 10),
      row('Primary One', 'Closed type', 'morning', false, 20),
      row('Primary Two', 'Standard', 'morning', false, 30),
      row('Primary Two', 'Standard', 'afternoon', false, 40),
    ];
    expect(deriveOptions(rows)).toEqual([
      {
        levelLabel: 'Primary One',
        classTypes: [{ classTypeLabel: 'Standard', schedules: ['Morning'] }],
      },
    ]);
  });

  it('orders by sort_order, and schedules Morning → Afternoon → Whole Day regardless', () => {
    const rows = [
      row('B', 'T', 'afternoon', true, 5),
      row('A', 'T', 'morning', true, 10),
      row('B', 'T', 'morning', true, 20),
    ];
    const out = deriveOptions(rows);
    expect(out.map((l) => l.levelLabel)).toEqual(['B', 'A']);
    expect(out[0].classTypes[0].schedules).toEqual(['Morning', 'Afternoon']);
  });

  it('returns nothing for no rows', () => {
    expect(deriveOptions([])).toEqual([]);
  });
});

describe('trackForClassType', () => {
  it('treats any "global" label, Cambridge included, as Global', () => {
    expect(trackForClassType('GLOBAL (ENGLISH + TAMIL)')).toBe('Global');
    expect(trackForClassType('Global Class-Cambridge')).toBe('Global');
    expect(trackForClassType('Global Class (CAMBRIDGE)')).toBe('Global');
  });

  it('treats everything else as Standard', () => {
    expect(trackForClassType('Standard Class (ENGLISH + FILIPINO)')).toBe(
      'Standard'
    );
    expect(trackForClassType('Enrichment Class')).toBe('Standard');
  });
});
