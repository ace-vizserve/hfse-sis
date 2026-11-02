import { describe, expect, it } from 'vitest';

import {
  eventShortLink,
  eventShortLinkLabel,
  formatClosesAt,
  formatEventDate,
  stripTrailingStop,
} from '@/lib/events/display';

describe('event display helpers', () => {
  it('builds the short link, falling back to the enrolment site', () => {
    expect(eventShortLink('ptc', undefined)).toBe(
      'https://enrol.hfse.edu.sg/events/ptc'
    );
    expect(eventShortLink('ptc', 'https://x.test/')).toBe(
      'https://x.test/events/ptc'
    );
    expect(eventShortLinkLabel('https://x.test/events/ptc')).toBe(
      'x.test/events/ptc'
    );
  });
  it('strips a trailing full stop only', () => {
    expect(stripTrailingStop('Primary.')).toBe('Primary');
    expect(stripTrailingStop('P1 and P2')).toBe('P1 and P2');
  });
  it('formats a single day and a range', () => {
    expect(formatEventDate('2026-11-14', null)).toContain('14 Nov 2026');
    expect(formatEventDate('2026-11-02', '2026-11-06')).toContain('–');
  });
  it('shows a close time in Singapore time', () => {
    expect(formatClosesAt('2026-11-05T09:00:00Z')).toContain('5:00 pm');
  });
});
