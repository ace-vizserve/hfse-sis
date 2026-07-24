import { describe, it, expect } from 'vitest';
import {
  buildEventAudienceMap,
  audienceFor,
} from '@/lib/sis/backfill/attendance/event-audience';

describe('buildEventAudienceMap / audienceFor', () => {
  const datesByRaw = { '20-Aug': '2026-08-20', '13-Jul': '2026-07-13' };

  it('resolves to secondary when only secondary sections carry the tag', () => {
    const map = buildEventAudienceMap(
      [
        { levelCode: 'S1', dateTagsByRawDate: { '20-Aug': 'EX' } },
        { levelCode: 'P3', dateTagsByRawDate: {} },
      ],
      datesByRaw
    );
    expect(audienceFor(map, '2026-08-20', 'term_exam')).toBe('secondary');
  });

  it('resolves to primary when only primary sections carry the tag', () => {
    const map = buildEventAudienceMap(
      [{ levelCode: 'P3', dateTagsByRawDate: { '20-Aug': 'EX' } }],
      datesByRaw
    );
    expect(audienceFor(map, '2026-08-20', 'term_exam')).toBe('primary');
  });

  it("resolves to 'all' when both level types carry the same tag", () => {
    const map = buildEventAudienceMap(
      [
        { levelCode: 'P3', dateTagsByRawDate: { '13-Jul': 'SE' } },
        { levelCode: 'S2', dateTagsByRawDate: { '13-Jul': 'SE' } },
      ],
      datesByRaw
    );
    expect(audienceFor(map, '2026-07-13', 'school_event')).toBe('all');
  });

  it("defaults to 'all' for a date/category with no locatable tag owner", () => {
    const map = buildEventAudienceMap([], datesByRaw);
    expect(audienceFor(map, '2026-08-20', 'term_exam')).toBe('all');
  });

  it('keeps two categories on the same date independent', () => {
    const map = buildEventAudienceMap(
      [
        { levelCode: 'P3', dateTagsByRawDate: { '20-Aug': 'SE' } },
        { levelCode: 'S1', dateTagsByRawDate: { '20-Aug': 'EX' } },
      ],
      datesByRaw
    );
    expect(audienceFor(map, '2026-08-20', 'school_event')).toBe('primary');
    expect(audienceFor(map, '2026-08-20', 'term_exam')).toBe('secondary');
  });
});
