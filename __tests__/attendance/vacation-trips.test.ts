import { describe, expect, it } from 'vitest';

import { countVacationTrips } from '@/lib/attendance/vacation-trips';

// Vacation leave is one TRIP, not one day (Mr Ace, 2026-08-27: "who does
// vacation 1 day bruh its one trip"). This corrects KD #94, which counted
// register rows — so a five-day holiday read as 5 used against an allowance
// of 1 on every screen that showed the quota.

// A fortnight of school days. Weekends are simply absent from the list, which
// is what lets a trip span one without becoming two.
const WEEK_1 = [
  '2026-02-02', // Mon
  '2026-02-03',
  '2026-02-04',
  '2026-02-05',
  '2026-02-06', // Fri
];
const WEEK_2 = [
  '2026-02-09', // Mon
  '2026-02-10',
  '2026-02-11',
  '2026-02-12',
  '2026-02-13', // Fri
];
const TERM = [...WEEK_1, ...WEEK_2];

const trips = (dates: string[], startedBefore = false) =>
  countVacationTrips(TERM, new Set(dates), startedBefore);

describe('countVacationTrips', () => {
  it('counts no trip when nothing is marked', () => {
    expect(trips([])).toBe(0);
  });

  it('counts a single day as one trip', () => {
    expect(trips(['2026-02-04'])).toBe(1);
  });

  it('counts five consecutive days as ONE trip, not five', () => {
    // The whole point. This is the number that was wrong on six screens.
    expect(trips(WEEK_1)).toBe(1);
  });

  it('spans a weekend without splitting', () => {
    // Friday to Tuesday. The weekend is not a school day, so the family never
    // came back to school in between.
    expect(trips(['2026-02-06', '2026-02-09', '2026-02-10'])).toBe(1);
  });

  it('splits when the child returned to school in between', () => {
    // Wednesday is a school day and is not marked as vacation, so these are
    // two separate holidays.
    expect(trips(['2026-02-03', '2026-02-05'])).toBe(2);
  });

  it('counts back-to-back trips separated by one day at school', () => {
    expect(
      trips(['2026-02-02', '2026-02-03', '2026-02-05', '2026-02-06'])
    ).toBe(2);
  });

  it('counts a trip that runs to the end of the term', () => {
    expect(trips(['2026-02-12', '2026-02-13'])).toBe(1);
  });

  it('ignores marks on days that are not school days', () => {
    // A Saturday can hold a row from a backfill. It is not in the term's
    // school days, so it neither counts nor bridges anything.
    expect(trips(['2026-02-07'])).toBe(0);
  });
});

describe('a trip that crosses a term boundary', () => {
  it('does not count in the term it finished in', () => {
    // Mr Ace's rule: count it where it STARTED. The previous term's last
    // school day was already a vacation day, so this term's opening days are
    // the tail of that trip and spend nothing here.
    expect(trips(['2026-02-02', '2026-02-03'], true)).toBe(0);
  });

  it('still counts a LATER trip in the same term', () => {
    // The carried-in trip is free; a genuinely new one is not.
    expect(trips(['2026-02-02', '2026-02-05'], true)).toBe(1);
  });

  it('counts normally when the previous term ended at school', () => {
    expect(trips(['2026-02-02', '2026-02-03'], false)).toBe(1);
  });

  it('spends nothing when the whole term is one carried-in trip', () => {
    expect(trips(TERM, true)).toBe(0);
  });
});
