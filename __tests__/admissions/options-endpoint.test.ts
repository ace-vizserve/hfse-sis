import { describe, it, expect } from 'vitest';

import {
  isServableAy,
  normalizeAyParam,
  toPublicOptions,
  type AdmissionOptionWithLevel,
} from '@/lib/admissions/options';

// The two rules the public /api/parent/v2/admission-options route rests on.
// It answers without a token, so which years it serves and what it lets out
// of a row are the whole of its access control.

describe('normalizeAyParam', () => {
  it('accepts an AY code in any case and returns it uppercased', () => {
    expect(normalizeAyParam('AY2027')).toBe('AY2027');
    expect(normalizeAyParam('ay2027')).toBe('AY2027');
    expect(normalizeAyParam(' Ay2026 ')).toBe('AY2026');
  });

  it('refuses anything that is not exactly AY + four digits', () => {
    for (const bad of [
      '',
      '2027',
      'AY27',
      'AY20271',
      'AY2027;drop',
      'AY 2027',
      'FY2027',
    ]) {
      expect(normalizeAyParam(bad), bad).toBeNull();
    }
  });
});

describe('isServableAy', () => {
  const ay = (
    ay_code: string,
    is_current: boolean,
    accepting_applications: boolean
  ) => ({
    ay_code,
    is_current,
    accepting_applications,
  });

  it('serves the current year', () => {
    expect(isServableAy(ay('AY2026', true, false))).toBe(true);
  });

  it('serves a year accepting applications', () => {
    expect(isServableAy(ay('AY2027', false, true))).toBe(true);
  });

  it('does not serve a year that is neither — a past or unopened year stays private', () => {
    expect(isServableAy(ay('AY2025', false, false))).toBe(false);
    expect(isServableAy(ay('AY2028', false, false))).toBe(false);
  });

  it('never serves a test year, even when flagged current or open', () => {
    expect(isServableAy(ay('AY9999', true, true))).toBe(false);
    expect(isServableAy(ay('AY9999', false, true))).toBe(false);
    expect(isServableAy(ay('ay9001', true, false))).toBe(false);
  });

  it('does not serve a year that does not exist', () => {
    expect(isServableAy(null)).toBe(false);
    expect(isServableAy(undefined)).toBe(false);
  });
});

describe('toPublicOptions', () => {
  const row = (
    level_label: string,
    level_code: string | null,
    class_type_label: string,
    schedule: AdmissionOptionWithLevel['schedule'],
    is_open: boolean,
    sort_order: number
  ): AdmissionOptionWithLevel => ({
    level_label,
    level_code,
    class_type_label,
    schedule,
    is_open,
    sort_order,
  });

  it('drops closed rows entirely rather than sending them flagged', () => {
    const out = toPublicOptions([
      row('Primary Two', 'P2', 'Standard', 'morning', false, 20),
      row('Primary Two', 'P2', 'Standard', 'afternoon', true, 21),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].schedule).toBe('Afternoon');
    expect(out[0]).not.toHaveProperty('is_open');
    expect(out[0]).not.toHaveProperty('isOpen');
  });

  it('sends schedules in the portal words', () => {
    const out = toPublicOptions([
      row('Primary One', 'P1', 'Standard', 'morning', true, 1),
      row('Primary One', 'P1', 'Standard', 'afternoon', true, 2),
      row('Primary One', 'P1', 'Standard', 'whole_day', true, 3),
    ]);
    expect(out.map((o) => o.schedule)).toEqual([
      'Morning',
      'Afternoon',
      'Whole Day',
    ]);
  });

  it('orders by sort_order and shapes each entry exactly', () => {
    const out = toPublicOptions([
      row('Secondary One', 'S1', 'Global Class', 'whole_day', true, 50),
      row(
        'IEP Year 1',
        'YS',
        'International Education Programme',
        'morning',
        true,
        5
      ),
    ]);
    expect(out).toEqual([
      {
        levelLabel: 'IEP Year 1',
        levelCode: 'YS',
        classTypeLabel: 'International Education Programme',
        schedule: 'Morning',
        sortOrder: 5,
      },
      {
        levelLabel: 'Secondary One',
        levelCode: 'S1',
        classTypeLabel: 'Global Class',
        schedule: 'Whole Day',
        sortOrder: 50,
      },
    ]);
  });

  it('returns an empty list when every row is closed', () => {
    expect(
      toPublicOptions([
        row('Primary Six', 'P6', 'Standard', 'morning', false, 1),
      ])
    ).toEqual([]);
  });
});
