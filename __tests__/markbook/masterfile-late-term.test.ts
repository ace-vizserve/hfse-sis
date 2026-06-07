import { describe, expect, it } from 'vitest';
import { resolveLateEnrolleeTerm } from '@/lib/markbook/masterfile';

const TERMS = [
  { termNumber: 1, startDate: '2026-01-06', endDate: '2026-03-13' },
  { termNumber: 2, startDate: '2026-03-30', endDate: '2026-05-29' },
  { termNumber: 3, startDate: '2026-06-29', endDate: '2026-09-04' },
  { termNumber: 4, startDate: '2026-09-21', endDate: '2026-11-20' },
];

describe('resolveLateEnrolleeTerm', () => {
  it('prefers the explicit override', () => {
    expect(resolveLateEnrolleeTerm(2, '2026-06-29', TERMS)).toBe(2);
  });
  it('derives from enrollment_date when no override (date inside T2)', () => {
    expect(resolveLateEnrolleeTerm(null, '2026-04-15', TERMS)).toBe(2);
  });
  it('derives the next term when date sits in a break', () => {
    // between T2 end and T3 start -> joins T3
    expect(resolveLateEnrolleeTerm(null, '2026-06-10', TERMS)).toBe(3);
  });
  it('returns null when no override and no date', () => {
    expect(resolveLateEnrolleeTerm(null, null, TERMS)).toBeNull();
  });
});
