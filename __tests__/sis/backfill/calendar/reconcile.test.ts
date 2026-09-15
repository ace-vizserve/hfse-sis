import { describe, expect, it } from 'vitest';

import { reconcile } from '@/lib/sis/backfill/calendar/reconcile';
import type { RegisterEntry } from '@/lib/sis/backfill/calendar/register-legend';
import type { CalendarEntry } from '@/lib/sis/backfill/calendar/types';

const pub = (
  startDate: string,
  endDate: string,
  label: string,
  kind: CalendarEntry['kind'],
  levels: CalendarEntry['levels'] = null
): CalendarEntry => ({ startDate, endDate, label, kind, levels });

const reg = (
  startDate: string,
  endDate: string,
  label: string,
  kind: RegisterEntry['kind'],
  levels: RegisterEntry['levels'] = null
): RegisterEntry => ({
  startDate,
  endDate,
  label,
  kind,
  levels,
  source: 'test',
  sheetLevelCount: levels?.length ?? 0,
});

const run = (
  published: CalendarEntry[],
  entries: RegisterEntry[],
  datesWithMarks: string[] = [],
  taught = true
) =>
  reconcile({
    published,
    registers: [{ termLabel: 'T3', taught, entries }],
    datesWithMarks: new Set(datesWithMarks),
  });

describe('closures', () => {
  it('takes a published closure when no register mentions it', () => {
    const { days } = run(
      [pub('2026-10-02', '2026-10-02', "Children's Day", 'public_holiday')],
      []
    );
    expect(days).toEqual([
      {
        date: '2026-10-02',
        dayType: 'public_holiday',
        hblOverlay: false,
        label: "Children's Day",
        provenance: 'published',
      },
    ]);
  });

  it('expands a multi-day closure into one row per date', () => {
    const { days } = run(
      [
        pub(
          '2026-11-24',
          '2026-11-26',
          'Yearend School Holiday',
          'school_holiday'
        ),
      ],
      []
    );
    expect(days.map((d) => d.date)).toEqual([
      '2026-11-24',
      '2026-11-25',
      '2026-11-26',
    ]);
  });

  it('pairs a school holiday with HBL on the same date as an overlay', () => {
    // 17 Jul is printed under both headings: closed on paper, attendance
    // still taken from home (migration 051).
    const { days } = run(
      [
        pub(
          '2026-07-17',
          '2026-07-17',
          'Staff Development Day',
          'school_holiday'
        ),
        pub('2026-07-17', '2026-07-17', 'Homebased Learning (HBL)', 'hbl'),
      ],
      []
    );
    expect(days).toHaveLength(1);
    expect(days[0].dayType).toBe('school_holiday');
    expect(days[0].hblOverlay).toBe(true);
  });

  it('pairs them regardless of which heading is read first', () => {
    const { days } = run(
      [
        pub('2026-07-17', '2026-07-17', 'Homebased Learning (HBL)', 'hbl'),
        pub(
          '2026-07-17',
          '2026-07-17',
          'Staff Development Day',
          'school_holiday'
        ),
      ],
      []
    );
    expect(days[0].dayType).toBe('school_holiday');
    expect(days[0].hblOverlay).toBe(true);
  });

  it('lets a taught register override the published day type, and says so', () => {
    const { days, conflicts } = run(
      [
        pub(
          '2026-07-06',
          '2026-07-06',
          'In Lieu of Youth Day',
          'public_holiday'
        ),
      ],
      [
        reg(
          '2026-07-06',
          '2026-07-06',
          'In Lieu of Youth Day',
          'school_holiday'
        ),
      ]
    );
    expect(days[0].dayType).toBe('school_holiday');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].resolution).toContain('register wins');
  });

  it('keeps the published day type for a term not yet taught', () => {
    const { days, conflicts } = run(
      [
        pub(
          '2026-11-06',
          '2026-11-06',
          'Awards Deliberation Day',
          'school_holiday'
        ),
      ],
      [reg('2026-11-06', '2026-11-06', 'Something else', 'public_holiday')],
      [],
      false
    );
    expect(days[0].dayType).toBe('school_holiday');
    expect(conflicts[0].resolution).toContain('published wins');
  });
});

describe('attendance marks overrule a register masthead', () => {
  it('refuses to close a day the register itself recorded marks on', () => {
    // The real case: the T3 masthead lists "3-Sep Teacher's Day" as a school
    // holiday, the published calendar puts Teacher's Day on the 4th, and the
    // 3rd carries 338 marks. The grid beats the header.
    const { days, conflicts } = run(
      [],
      [reg('2026-09-03', '2026-09-03', "Teacher's Day", 'school_holiday')],
      ['2026-09-03']
    );
    expect(days).toHaveLength(0);
    expect(conflicts[0].resolution).toContain('REJECTED');
  });

  it('still allows HBL on a day with marks, because HBL is taught', () => {
    const { days } = run(
      [],
      [reg('2026-02-20', '2026-02-20', 'HBL', 'hbl')],
      ['2026-02-20']
    );
    expect(days).toHaveLength(1);
    expect(days[0].dayType).toBe('hbl');
  });

  it('does not let marks block a PUBLISHED closure — only a register claim', () => {
    // The published calendar is the plan; marks on the day are a separate
    // problem the audit reports, not a reason to drop the holiday.
    const { days } = run(
      [pub('2026-10-02', '2026-10-02', "Children's Day", 'public_holiday')],
      [],
      ['2026-10-02']
    );
    expect(days).toHaveLength(1);
  });
});

describe('events', () => {
  it('keeps the published level scope', () => {
    const { events } = run(
      [
        pub(
          '2026-05-08',
          '2026-05-08',
          'Primary Six Fieldtrip',
          'school_event',
          ['P6']
        ),
      ],
      []
    );
    expect(events[0].levels).toEqual(['P6']);
  });

  it('adds a register exam paper the published calendar does not name', () => {
    const { events } = run(
      [
        pub(
          '2026-08-24',
          '2026-08-27',
          'Secondary School Term 3 Exam',
          'term_exam',
          ['S1', 'S2', 'S3', 'S4']
        ),
      ],
      [
        reg(
          '2026-08-24',
          '2026-08-24',
          'Term 3 Exam (Chemistry, Math Paper 1)',
          'term_exam',
          ['S4']
        ),
      ]
    );
    expect(events).toHaveLength(2);
    expect(events.find((e) => e.label.includes('Chemistry'))?.levels).toEqual([
      'S4',
    ]);
  });

  it('borrows the register level scope when the published entry has none', () => {
    const { events } = run(
      [pub('2026-07-14', '2026-07-16', 'Leadership Camp', 'school_event')],
      [
        reg('2026-07-14', '2026-07-16', 'Leadership Camp', 'school_event', [
          'P4',
          'S1',
        ]),
      ]
    );
    expect(events).toHaveLength(1);
    expect(events[0].levels).toEqual(['P4', 'S1']);
    expect(events[0].provenance).toBe('both');
  });

  it('treats same-date same-category as one happening, however it is worded', () => {
    // The database holds the register's wording; the calendar holds the
    // official one. Without this they are filed as two events on one day.
    const { events } = run(
      [pub('2026-07-13', '2026-07-13', 'Moving up photoshoot', 'school_event')],
      [
        reg(
          '2026-07-13',
          '2026-07-13',
          'Moving up and Grad Photoshoot',
          'school_event'
        ),
      ]
    );
    expect(events).toHaveLength(1);
    expect(events[0].label).toBe('Moving up photoshoot');
    expect(events[0].provenance).toBe('both');
  });

  it('keeps several exam papers that share a date', () => {
    // The one category where same-date does NOT mean same happening.
    const { events } = run(
      [],
      [
        reg(
          '2026-08-26',
          '2026-08-26',
          'Term 3 Exam (Biology, Math Paper 2)',
          'term_exam',
          ['S4']
        ),
        reg(
          '2026-08-26',
          '2026-08-26',
          'Term 3 Exam (Math, English)',
          'term_exam',
          ['P1']
        ),
      ]
    );
    expect(events).toHaveLength(2);
  });

  it('does not swallow a different event that merely falls inside a long span', () => {
    // Term Break runs 30 May-28 Jun and subject weeks run five days. Merging
    // on "overlaps" would file a distinct register event inside one of those
    // windows as the same happening, dropping it from the intended state so it
    // is never even reported as missing.
    const { events } = run(
      [pub('2026-07-08', '2026-07-10', 'Leadership Camp', 'school_event')],
      [
        reg(
          '2026-07-09',
          '2026-07-09',
          'Something else entirely',
          'school_event'
        ),
      ]
    );
    expect(events).toHaveLength(2);
    expect(events.some((e) => e.label === 'Something else entirely')).toBe(
      true
    );
  });

  it('reports an event the school moved, and keeps both versions', () => {
    // Leadership Camp was published for 8-10 Jul and ran 14-16 Jul.
    const { events, conflicts } = run(
      [
        pub(
          '2026-07-08',
          '2026-07-10',
          'Leadership Camp (UpperPri - Secondary)',
          'school_event'
        ),
      ],
      [reg('2026-07-14', '2026-07-16', 'Leadership Camp', 'school_event')]
    );
    expect(events).toHaveLength(2);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].what).toContain('different dates');
  });

  it('matches across the two sources spelling the same thing differently', () => {
    const { events } = run(
      [pub('2026-05-01', '2026-05-01', 'Labour Day', 'school_event')],
      [reg('2026-05-01', '2026-05-01', 'Labor Day', 'school_event')]
    );
    expect(events).toHaveLength(1);
    expect(events[0].provenance).toBe('both');
  });
});

describe('uncategorised register entries', () => {
  it('does not report a free-text entry that names a known closure', () => {
    // T1/T2 mastheads list Good Friday, Labour Day, the marking days as free
    // text with no category. Those resolve to DAYS, not events, so looking
    // only at events reported every holiday in T1 and T2 as uncategorised.
    const { uncategorised } = run(
      [pub('2026-04-03', '2026-04-03', 'Good Friday', 'public_holiday')],
      [reg('2026-04-03', '2026-04-03', 'Good Friday', null)]
    );
    expect(uncategorised).toEqual([]);
  });

  it('still surfaces a free-text entry that lands inside a term break', () => {
    // Matching "any overlapping event of any category" meant a 30-day Term
    // Break absorbed every uncategorised masthead entry inside it, so nobody
    // was ever asked to categorise them.
    const { uncategorised } = run(
      [pub('2026-05-30', '2026-06-28', 'Term Break', 'term_break')],
      [reg('2026-06-15', '2026-06-15', 'Some unlabelled thing', null)]
    );
    expect(uncategorised).toHaveLength(1);
  });

  it('reports a free-text entry neither source can place', () => {
    const { uncategorised } = run(
      [],
      [reg('2026-05-12', '2026-05-12', 'Vesak Day', null)]
    );
    expect(uncategorised).toEqual([
      { date: '2026-05-12', label: 'Vesak Day', termLabel: 'T3' },
    ]);
  });

  it('reports a thing once when both register layouts carry it', () => {
    const { uncategorised } = run(
      [],
      [
        reg('2026-05-12', '2026-05-12', 'Vesak Day', null),
        reg('2026-05-12', '2026-05-12', 'vesak day', null),
      ]
    );
    expect(uncategorised).toHaveLength(1);
  });
});
