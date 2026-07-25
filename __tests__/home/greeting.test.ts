import { describe, it, expect } from 'vitest';
import { greetingForHour } from '@/lib/home/greeting';

describe('greetingForHour', () => {
  it.each([
    [0, 'evening'],
    [4, 'evening'],
    [5, 'morning'],
    [11, 'morning'],
    [12, 'afternoon'],
    [17, 'afternoon'],
    [18, 'evening'],
    [23, 'evening'],
  ] as const)('hour %d → %s bucket', (hour, bucket) => {
    expect(greetingForHour(hour).bucket).toBe(bucket);
  });

  it('returns a human label matching each bucket', () => {
    expect(greetingForHour(9).label).toBe('Good morning');
    expect(greetingForHour(14).label).toBe('Good afternoon');
    expect(greetingForHour(20).label).toBe('Good evening');
  });
});
