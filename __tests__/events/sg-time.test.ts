import { describe, expect, it } from 'vitest';

import { sgParts, sgToIso } from '@/lib/events/sg-time';

describe('sg-time', () => {
  it('reads an instant as Singapore date and time', () => {
    expect(sgParts('2026-11-05T04:00:00.000Z')).toEqual({
      date: '2026-11-05',
      time: '12:00',
    });
    expect(sgParts('2026-11-04T17:30:00.000Z')).toEqual({
      date: '2026-11-05',
      time: '01:30',
    });
  });
  it('writes Singapore date and time back as the same instant', () => {
    expect(sgToIso('2026-11-05', '12:00')).toBe('2026-11-05T04:00:00.000Z');
    expect(sgParts(sgToIso('2026-11-05', '23:45'))).toEqual({
      date: '2026-11-05',
      time: '23:45',
    });
  });
});
