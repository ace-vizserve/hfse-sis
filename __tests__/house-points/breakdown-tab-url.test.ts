import { describe, expect, it } from 'vitest';

import { breakdownTabFromUrl } from '@/components/house-points/house-breakdown-tables';

// The house page's Members / By event / By student tabs follow the URL, so a
// refresh, Back or shared link opens the table the reader was on.
const p = (s: string) => new URLSearchParams(s);

describe('breakdownTabFromUrl', () => {
  it('reads ?tab=', () => {
    expect(breakdownTabFromUrl(p('tab=events'))).toBe('events');
    expect(breakdownTabFromUrl(p('tab=students'))).toBe('students');
    expect(breakdownTabFromUrl(p('tab=members&house-events.q=x'))).toBe(
      'members'
    );
  });
  it('opens the tab whose table has params when ?tab= is missing', () => {
    expect(breakdownTabFromUrl(p('ay=AY2026&house-events.q=sports'))).toBe(
      'events'
    );
    expect(breakdownTabFromUrl(p('house-students.page=2'))).toBe('students');
  });
  it('falls back to Members', () => {
    expect(breakdownTabFromUrl(p(''))).toBe('members');
    expect(breakdownTabFromUrl(p('tab=bogus'))).toBe('members');
    expect(breakdownTabFromUrl(null)).toBe('members');
  });
});
