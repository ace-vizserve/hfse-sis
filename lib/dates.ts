// Singapore-local calendar-date helpers.
//
// HFSE operates in Asia/Singapore (UTC+8) and stores school-calendar values —
// term windows, attendance dates, enrollment_date — as date-only SGT dates
// (no timezone). `new Date().toISOString().slice(0, 10)` takes the UTC calendar
// date, which is the PREVIOUS day during the early-morning SGT window
// (00:00–07:59 SGT == the prior UTC day). Comparing a UTC "today" against an
// SGT term window therefore mis-resolves the term at a boundary (e.g. a 7am-SGT
// action on the first day of a term reads as the prior break). Any "today" or
// timestamp→date value that is compared against, or stored as, a school-calendar
// date MUST be computed in SGT — these helpers are the canonical way.
//
// Storage/transit timestamps stay full UTC ISO (see hard-rules / KD #32); these
// are only for the calendar-DATE comparisons.

const SGT = 'Asia/Singapore';

/** Today's date in Asia/Singapore as `yyyy-MM-dd` (en-CA formats this way). */
export function sgToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: SGT });
}

/** The Singapore calendar date (`yyyy-MM-dd`) of a UTC timestamp / ISO string. */
export function sgDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: SGT });
}

/** The current hour (0–23) in Asia/Singapore — `hourCycle: 'h23'` avoids the
 * "24" midnight quirk some engines produce with a plain `hour12: false`. */
export function sgHour(): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: SGT,
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(new Date())
  );
}
