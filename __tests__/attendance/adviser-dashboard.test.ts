import { describe, expect, it } from 'vitest';

import {
  headlineFor,
  subheadFor,
  tallyToday,
  unmarkedSchoolDays,
  type AdviserSection,
  type MarkLite,
} from '@/lib/attendance/adviser-dashboard';

const mark = (
  sectionStudentId: string,
  status: MarkLite['status'],
  recordedAt: string | null = '2026-07-31T00:10:00Z'
): MarkLite => ({
  sectionStudentId,
  date: '2026-07-31',
  status,
  recordedAt,
});

const section = (
  name: string,
  today: AdviserSection['today'],
  unmarked: string[] = []
): AdviserSection => ({
  sectionId: `sec-${name}`,
  sectionName: name,
  levelLabel: 'Primary 1',
  rosterCount: 28,
  today,
  unmarked,
});

const tally = (over: Partial<ReturnType<typeof tallyToday>> = {}) => ({
  marked: 1,
  present: 1,
  late: 0,
  absent: 0,
  excused: 0,
  noClass: 0,
  lastMarkedAt: null,
  ...over,
});

describe('tallyToday', () => {
  it('counts each stored status code', () => {
    // The five codes are P / L / EX / A / NC — not words. EX covers all three
    // excuse subtypes; the subtype drives the leave quotas, not this tally.
    const t = tallyToday([
      mark('a', 'P'),
      mark('b', 'L'),
      mark('c', 'A'),
      mark('d', 'EX'),
      mark('e', 'NC'),
    ]);
    expect(t).toMatchObject({
      marked: 5,
      present: 1,
      late: 1,
      absent: 1,
      excused: 1,
      noClass: 1,
    });
  });

  // attendance_daily is append-only for corrections (Hard Rule #6), so a
  // corrected student has more than one row for the same date. Counting rows
  // would inflate `marked` past the roster AND count the superseded status.
  it('keeps only the latest row per student when a mark was corrected', () => {
    const t = tallyToday([
      mark('a', 'A', '2026-07-31T00:05:00Z'),
      mark('a', 'P', '2026-07-31T02:30:00Z'), // corrected later
    ]);
    expect(t.marked).toBe(1);
    expect(t.present).toBe(1);
    expect(t.absent).toBe(0);
  });

  it('picks the latest regardless of input order', () => {
    // The loader happens to return newest-first, but relying on that is how a
    // silent miscount gets introduced when the query changes.
    const rows = [
      mark('a', 'P', '2026-07-31T02:30:00Z'),
      mark('a', 'A', '2026-07-31T00:05:00Z'),
    ];
    expect(tallyToday(rows).present).toBe(1);
    expect(tallyToday([...rows].reverse()).present).toBe(1);
  });

  it('reports the most recent stamp as lastMarkedAt', () => {
    const t = tallyToday([
      mark('a', 'P', '2026-07-31T00:05:00Z'),
      mark('b', 'P', '2026-07-31T01:42:00Z'),
    ]);
    expect(t.lastMarkedAt).toBe('2026-07-31T01:42:00Z');
  });

  it('survives rows with no timestamp', () => {
    const t = tallyToday([mark('a', 'P', null), mark('b', 'L', null)]);
    expect(t.marked).toBe(2);
    expect(t.lastMarkedAt).toBeNull();
  });

  it('is empty for no marks', () => {
    expect(tallyToday([])).toMatchObject({ marked: 0, lastMarkedAt: null });
  });
});

describe('unmarkedSchoolDays', () => {
  const dates = ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-31'];

  it('returns past school days with no marks at all', () => {
    expect(
      unmarkedSchoolDays(dates, new Set(['2026-07-28']), '2026-07-31')
    ).toEqual(['2026-07-27', '2026-07-29']);
  });

  // Today is the job the top of the page is already asking for. Counting it
  // here too would report the same task twice.
  it('never includes today, even when today is unmarked', () => {
    expect(unmarkedSchoolDays(dates, new Set(), '2026-07-31')).not.toContain(
      '2026-07-31'
    );
  });

  // The caller passes the calendar's own encodable list, which is school_day +
  // hbl only — so a public holiday can never reach this function. Pinned
  // because walking the date range instead would silently flag every holiday.
  it('only ever considers the dates it was given', () => {
    expect(unmarkedSchoolDays(['2026-07-27'], new Set(), '2026-07-31')).toEqual(
      ['2026-07-27']
    );
  });

  // A half-marked day looks nothing like a forgotten one; conflating them would
  // make the count untrustworthy.
  it('treats a day with even one mark as done', () => {
    expect(
      unmarkedSchoolDays(
        dates,
        new Set(['2026-07-27', '2026-07-29']),
        '2026-07-31'
      )
    ).toEqual(['2026-07-28']);
  });

  it('sorts oldest first', () => {
    const out = unmarkedSchoolDays(
      ['2026-07-29', '2026-07-27', '2026-07-28'],
      new Set(),
      '2026-07-31'
    );
    expect(out).toEqual(['2026-07-27', '2026-07-28', '2026-07-29']);
  });
});

describe('headlineFor', () => {
  it('names the class when exactly one is outstanding', () => {
    // "1 class needs marking" would make the adviser open the page to find out
    // which — the work the sentence was supposed to save them.
    const out = headlineFor(
      [
        section('P1 Respect', { kind: 'unmarked' }),
        section('P2 Humility', { kind: 'marked', tally: tally() }),
      ],
      true,
      null
    );
    expect(out).toBe("P1 Respect isn't marked yet.");
  });

  it('counts when more than one is outstanding', () => {
    const out = headlineFor(
      [
        section('P1 Respect', { kind: 'unmarked' }),
        section('P2 Humility', { kind: 'unmarked' }),
      ],
      true,
      null
    );
    expect(out).toBe("2 of your classes aren't marked yet.");
  });

  it('confirms when everything is in', () => {
    const out = headlineFor(
      [
        section('P1 Respect', { kind: 'marked', tally: tally() }),
        section('P2 Humility', { kind: 'marked', tally: tally() }),
      ],
      true,
      null
    );
    expect(out).toBe('All your classes are marked for today.');
  });

  it('names the single class when the adviser holds only one', () => {
    const out = headlineFor(
      [section('P1 Respect', { kind: 'marked', tally: tally() })],
      true,
      null
    );
    expect(out).toBe('P1 Respect is marked for today.');
  });

  // Never present a day nobody should mark as outstanding work.
  it('states the holiday rather than reporting unmarked classes', () => {
    const out = headlineFor(
      [section('P1 Respect', { kind: 'not-a-school-day' })],
      false,
      'National Day'
    );
    expect(out).toBe('National Day — no register today.');
  });

  it('falls back when the non-school day has no label', () => {
    expect(
      headlineFor([section('P1', { kind: 'unmarked' })], false, null)
    ).toBe('No register today — not a school day.');
  });

  it('says so when the adviser has no classes', () => {
    expect(headlineFor([], true, null)).toBe(
      'No classes are assigned to you yet.'
    );
  });
});

describe('subheadFor', () => {
  it('reports the last mark time when everything is in', () => {
    const out = subheadFor(
      [
        section('P1 Respect', {
          kind: 'marked',
          tally: tally({ lastMarkedAt: '2026-07-30T23:51:00Z' }),
        }),
      ],
      true,
      null
    );
    expect(out).toContain('Nothing outstanding.');
  });

  it('mentions the class already done when one is outstanding', () => {
    const out = subheadFor(
      [
        section('P1 Respect', { kind: 'unmarked' }),
        section('P2 Humility', { kind: 'marked', tally: tally() }),
      ],
      true,
      null
    );
    expect(out).toBe('P2 Humility is done.');
  });

  it('points at the next school day on a holiday', () => {
    const out = subheadFor(
      [section('P1 Respect', { kind: 'not-a-school-day' })],
      false,
      '2026-08-04'
    );
    expect(out).toBe('Next school day is 2026-08-04.');
  });

  it('is empty when there is nothing useful to add', () => {
    expect(subheadFor([section('P1', { kind: 'unmarked' })], true, null)).toBe(
      ''
    );
  });
});
