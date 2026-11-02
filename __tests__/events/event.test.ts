import { describe, expect, it } from 'vitest';

import {
  canRegister,
  cleanEventSlug,
  EVENT_STATUS_LABELS,
  EventDetailsSchema,
  eventIsFor,
  eventStatus,
  slugifyEventTitle,
} from '@/lib/events/event';

describe('slugifyEventTitle', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyEventTitle('Pandayan Leadership Camp 2026', new Set())).toBe(
      'pandayan-leadership-camp-2026'
    );
  });
  it('adds a numeric suffix when taken', () => {
    const t = new Set(['camp', 'camp-2']);
    expect(slugifyEventTitle('Camp', t)).toBe('camp-3');
  });
  it('cleanEventSlug tidies a typed link and is empty when nothing is left', () => {
    expect(cleanEventSlug('  Camp--Pandayan 2026! ')).toBe(
      'camp-pandayan-2026'
    );
    expect(cleanEventSlug('!!!')).toBe('');
  });
  it('strips accents and caps at 40 chars', () => {
    expect(slugifyEventTitle('Café Día', new Set())).toBe('cafe-dia');
    expect(
      slugifyEventTitle('a'.repeat(80), new Set()).length
    ).toBeLessThanOrEqual(40);
  });
});

const base = {
  publishedAt: '2026-10-01T00:00:00Z',
  opensAt: '2026-10-10T00:00:00Z',
  closesAt: '2026-10-20T00:00:00Z',
  closedEarlyAt: null as string | null,
  startsOn: '2026-11-05',
  endsOn: '2026-11-06' as string | null,
};

describe('eventStatus', () => {
  it('not_published', () => {
    expect(
      eventStatus(
        { ...base, publishedAt: null },
        new Date('2026-10-15T00:00:00Z')
      )
    ).toBe('not_published');
  });
  it('upcoming', () => {
    expect(eventStatus(base, new Date('2026-10-05T00:00:00Z'))).toBe(
      'upcoming'
    );
  });
  it('open', () => {
    expect(eventStatus(base, new Date('2026-10-15T00:00:00Z'))).toBe('open');
  });
  it('closed after closesAt', () => {
    expect(eventStatus(base, new Date('2026-10-25T00:00:00Z'))).toBe('closed');
  });
  it('closed early', () => {
    expect(
      eventStatus(
        { ...base, closedEarlyAt: '2026-10-12T00:00:00Z' },
        new Date('2026-10-15T00:00:00Z')
      )
    ).toBe('closed');
  });
  it('past after endsOn (Singapore date)', () => {
    // 2026-11-06 16:00Z = 2026-11-07 00:00 SGT
    expect(eventStatus(base, new Date('2026-11-06T15:59:00Z'))).toBe('closed');
    expect(eventStatus(base, new Date('2026-11-06T16:00:00Z'))).toBe('past');
  });
  it('past uses startsOn when no endsOn', () => {
    expect(
      eventStatus({ ...base, endsOn: null }, new Date('2026-11-05T16:00:00Z'))
    ).toBe('past');
  });
  it('labels', () => {
    expect(EVENT_STATUS_LABELS).toEqual({
      not_published: 'Not published',
      upcoming: 'Opens soon',
      open: 'Open',
      closed: 'Closed',
      past: 'Past',
    });
  });
});

describe('eventIsFor', () => {
  const child = { levelCode: 'P5', sectionId: 'sec-1' };
  it('whole school', () => {
    expect(
      eventIsFor({ audience: 'all', levels: [], sectionIds: [] }, child)
    ).toBe(true);
  });
  it('band', () => {
    expect(
      eventIsFor({ audience: 'primary', levels: [], sectionIds: [] }, child)
    ).toBe(true);
    expect(
      eventIsFor({ audience: 'secondary', levels: [], sectionIds: [] }, child)
    ).toBe(false);
  });
  it('level', () => {
    expect(
      eventIsFor({ audience: 'all', levels: ['P5'], sectionIds: [] }, child)
    ).toBe(true);
    expect(
      eventIsFor({ audience: 'all', levels: ['P6'], sectionIds: [] }, child)
    ).toBe(false);
  });
  it('class', () => {
    expect(
      eventIsFor({ audience: 'all', levels: [], sectionIds: ['sec-1'] }, child)
    ).toBe(true);
    expect(
      eventIsFor({ audience: 'all', levels: [], sectionIds: ['sec-2'] }, child)
    ).toBe(false);
  });
});

describe('canRegister', () => {
  const now = new Date('2026-10-15T00:00:00Z');
  it('true when published and open', () => {
    expect(canRegister(base, now)).toBe(true);
  });
  it('false when not published', () => {
    expect(canRegister({ ...base, publishedAt: null }, now)).toBe(false);
  });
  it('false when closed early', () => {
    expect(
      canRegister({ ...base, closedEarlyAt: '2026-10-12T00:00:00Z' }, now)
    ).toBe(false);
  });
});

describe('EventDetailsSchema', () => {
  const ok = {
    title: 'Camp',
    description: '',
    startsOn: '2026-11-05',
    endsOn: '2026-11-06',
    timeLabel: '8am',
    venue: 'Hall',
    scope: { audience: 'all', levels: [], sectionIds: [] },
    answerMode: 'register',
    opensAt: '2026-10-10T00:00:00Z',
    closesAt: '2026-10-20T00:00:00Z',
  };
  it('accepts valid', () => {
    expect(EventDetailsSchema.safeParse(ok).success).toBe(true);
  });
  it('rejects endsOn before startsOn', () => {
    expect(
      EventDetailsSchema.safeParse({ ...ok, endsOn: '2026-11-01' }).success
    ).toBe(false);
  });
  it('rejects opensAt not before closesAt', () => {
    expect(
      EventDetailsSchema.safeParse({ ...ok, closesAt: ok.opensAt }).success
    ).toBe(false);
  });
  it('rejects empty title', () => {
    expect(EventDetailsSchema.safeParse({ ...ok, title: '' }).success).toBe(
      false
    );
  });

  const firstMessage = (over: Record<string, unknown>) => {
    const r = EventDetailsSchema.safeParse({ ...ok, ...over });
    return r.success ? null : r.error.issues[0].message;
  };
  it('rejects an impossible date in plain English', () => {
    expect(firstMessage({ startsOn: '2026-02-31' })).toBe('Enter a real date.');
    expect(firstMessage({ endsOn: '2026-13-01' })).toBe('Enter a real date.');
    expect(firstMessage({ startsOn: '2028-02-29', endsOn: null })).toBeNull();
  });
  it('says the length limits in plain English', () => {
    expect(firstMessage({ description: 'x'.repeat(4001) })).toBe(
      'Keep the description to 4,000 characters or fewer.'
    );
    expect(firstMessage({ venue: 'x'.repeat(121) })).toBe(
      'Keep the venue to 120 characters or fewer.'
    );
    expect(firstMessage({ timeLabel: 'x'.repeat(61) })).toBe(
      'Keep the time to 60 characters or fewer.'
    );
    expect(firstMessage({ answerMode: 'maybe' })).toBe(
      'Choose how parents answer: Allowing / Not allowing, or Register / Not joining.'
    );
  });
});
