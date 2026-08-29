// ⚠ NO `import 'server-only'` — same reason as its neighbours in this folder:
// the repair script imports across `lib/declarations/` under tsx, where the
// `server-only` package throws outright.
//
//   THIS IS SERVER CODE. It uses the service-role client and bypasses RLS.
//   Never import it from a client component.

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  expandSchoolDays,
  type CalendarLevelType,
} from '@/lib/attendance/school-days';

/**
 * Does a parent's filing actually cover a day the school is open?
 *
 * Mr Ace, 2026-08-27, spotting the gap: _"a parent is able to file a
 * declaration even if the dates selected is not a school day, that should be
 * blocked in the api when parent is filing."_ Nothing checked the calendar at
 * filing time — the schema validates the dates against each other and against
 * today (order, 60-day cap, 30-day backdate, 365-day future), and none of that
 * can know the school is shut.
 *
 * ⚠ THE TEST IS "NO SCHOOL DAY AT ALL", NOT "CONTAINS A NON-SCHOOL DAY", and
 * the difference is the whole design. A parent filing Friday-to-Tuesday is not
 * claiming the weekend, and the register write already skips those days
 * correctly (KD #197). What is meaningless is a filing covering ONLY closed
 * days — a Saturday, a public holiday, the mid-term break. That one marks
 * nothing, approves nothing, and spends two approvers' attention proving it.
 *
 * ⚠ ONE CHILD IS ENOUGH. Siblings can sit in different halves of the school
 * and the calendar's audience precedence means a day can be a school day for
 * primary and a closure for secondary. If ANY selected child has a school day
 * in the range the filing is real, and the sibling whose half is closed simply
 * gets no marks — which the register write already handles. Refusing the whole
 * submission because one child's half is shut would block a filing that is
 * perfectly valid for the other.
 */
export async function filingCoversAnySchoolDay(
  service: SupabaseClient,
  args: {
    startDate: string;
    endDate: string;
    /**
     * ⚠ `levelType` here is the STUDENT's, which carries `'preschool'` — the
     * calendar's audience does not. `school_calendar.audience` is only
     * `('all','primary','secondary')`; KD #76 deferred preschool and settled
     * that preschool sections read the `'all'` rows. So it narrows to `null`
     * below, which is exactly what `expandSchoolDays` treats as "see only
     * 'all'". Widening the parameter rather than casting at the call site
     * keeps that reasoning next to the calendar it is about.
     */
    children: Array<{
      academicYearId: string;
      levelType: CalendarLevelType | 'preschool';
    }>;
  }
): Promise<boolean> {
  const { startDate, endDate, children } = args;
  if (children.length === 0) return false;

  // Siblings overwhelmingly share a year and a half of the school, so this is
  // normally ONE calendar read however many children were named.
  const groups = new Map<
    string,
    { academicYearId: string; levelType: CalendarLevelType }
  >();
  for (const child of children) {
    const levelType: CalendarLevelType =
      child.levelType === 'preschool' ? null : child.levelType;
    groups.set(`${child.academicYearId}|${levelType ?? 'all'}`, {
      academicYearId: child.academicYearId,
      levelType,
    });
  }

  for (const group of groups.values()) {
    const days = await expandSchoolDays(service, {
      startDate,
      endDate,
      academicYearId: group.academicYearId,
      levelType: group.levelType,
    });
    if (days.length > 0) return true;
  }
  return false;
}

/** An existing filing that already covers some of the days being filed for. */
export type OverlappingFiling = {
  studentName: string;
  startDate: string;
  endDate: string;
  declarationType: string;
  /**
   * True when this is the SAME request, not merely an overlapping one — same
   * kind, same first and last day.
   *
   * ⚠ THIS NO LONGER DECIDES SUCCESS-VS-FAILURE, and that changed on
   * 2026-08-29. Migration 125 answered an exact re-send with a SUCCESS so a
   * parent double-tapping submit on a flaky connection could not file twice.
   * Mr Ace: _"its pending for approval already, refiling for the same date and
   * it succeeds is confusing"_ — a success for something you did not file
   * reads as a new filing that then never appears. The genuine double-tap is
   * two requests in flight AT ONCE, and that race is still answered with a
   * success by the unique index's `23505` branch in the route, which is where
   * it belongs. A sequential re-send is a person, and a person gets told.
   */
  isExactMatch: boolean;
  /**
   * Where the existing filing got to.
   *
   * ⚠ Only ever `pending` or `approved` — `findOverlappingFilings` does not
   * count a `rejected` or `cancelled` filing at all, because being turned down
   * is precisely when somebody needs to file again. The two live states are
   * worded differently to the parent: one is still with the school, the other
   * is settled and re-filing it achieves nothing.
   */
  status: string;
};

/**
 * Has one of these children already been filed for on any of these days?
 *
 * Mr Ace, 2026-08-27: _"filing declaration should be idempotent or should tell
 * the parent that they already filed that declaration dates for that student."_
 *
 * ⚠ THE DATABASE ALREADY STOPS ONE SHAPE OF THIS AND ONLY ONE.
 * `student_declarations_no_duplicate_filing` is unique on
 * `(filed_by, declaration_type, student_id, start_date, end_date)`, which
 * catches a parent double-tapping submit — the route turns that 23505 into a
 * success, deliberately. It does NOT catch:
 *
 *   1. **The other parent.** `filed_by` is in the key, and BOTH parents are on
 *      the application and see the same list (KD #195). Mum files, dad files
 *      the same absence, and two approval ladders open on one illness.
 *   2. **An overlapping range**, which is the likelier mistake: 27–31 Aug
 *      filed, then 28–29 Aug filed. Neither row is a duplicate of the other
 *      and both march through approval.
 *
 * So this asks the real question — is any of this child's requested time
 * already spoken for — scoped to filings that still mean something. A
 * `rejected` or `cancelled` filing is deliberately NOT a blocker: the school
 * turning something down is precisely when a parent needs to file again.
 */
export async function findOverlappingFilings(
  service: SupabaseClient,
  args: {
    startDate: string;
    endDate: string;
    declarationType: string;
    children: Array<{ studentId: string; studentName: string }>;
  }
): Promise<OverlappingFiling[]> {
  const { startDate, endDate, declarationType, children } = args;
  if (children.length === 0) return [];

  const { data, error } = await service
    .from('student_declarations')
    .select('student_id, start_date, end_date, declaration_type, status')
    .in(
      'student_id',
      children.map((c) => c.studentId)
    )
    .in('status', ['pending', 'approved'])
    // Overlap, not containment — `yyyy-MM-dd` compares correctly as text, the
    // way every date test in this feature does.
    .lte('start_date', endDate)
    .gte('end_date', startDate);
  if (error) throw new Error(`duplicate check failed: ${error.message}`);

  const nameById = new Map(children.map((c) => [c.studentId, c.studentName]));
  return (
    (data ?? []) as Array<{
      student_id: string;
      start_date: string;
      end_date: string;
      declaration_type: string;
      status: string;
    }>
  ).map((row) => ({
    studentName: nameById.get(row.student_id) ?? 'your child',
    startDate: row.start_date,
    endDate: row.end_date,
    declarationType: row.declaration_type,
    status: row.status,
    isExactMatch:
      row.declaration_type === declarationType &&
      row.start_date === startDate &&
      row.end_date === endDate,
  }));
}

/**
 * What the parent reads when the dates are all closed days.
 *
 * ⚠ It does NOT say "not a school day" — a parent has no reason to know the
 * school's own vocabulary, and the sentence has to work for a Saturday, a
 * public holiday and the middle of the term break alike. It also has to avoid
 * blaming them: the likeliest cause is a mis-tapped date, not a bad filing.
 */
export const NO_SCHOOL_DAY_MESSAGE =
  'The school is closed for all of those dates. Please check the dates and try again.';

/**
 * What the parent reads when those days are already spoken for.
 *
 * ⚠ It names the CHILD and the dates on record, because the commonest cause is
 * the other parent having filed already — so "you have already filed this"
 * would be wrong as well as unhelpful. The wording avoids saying who filed it:
 * the route knows, but reading one parent's action back to the other is not
 * this message's job.
 *
 * ⚠ THE TWO LIVE STATES READ DIFFERENTLY ON PURPOSE. A parent who re-files
 * something still awaiting a decision needs to know it is in and nothing is
 * wrong; a parent who re-files something the school has already approved needs
 * to know the matter is closed and that the way to change it is to ring the
 * office, not to file a third time. Answering both with one sentence is what
 * made the old behaviour confusing.
 */
export function alreadyFiledMessage(existing: OverlappingFiling): string {
  const range =
    existing.startDate === existing.endDate
      ? existing.startDate
      : `${existing.startDate} to ${existing.endDate}`;
  if (existing.status === 'approved') {
    return `${existing.studentName} has already been approved as away on ${range}. If that needs to change, please contact the school office.`;
  }
  return `${existing.studentName} has already been filed for on ${range}, and the school has not decided it yet. If the dates need changing, please contact the school office.`;
}
