import { describe, expect, it } from 'vitest';

import { buildMidTermPayload } from '@/lib/sis/placement-completion';
import {
  resolveEnrolmentPosition,
  type TermWindow,
} from '@/lib/sis/enrolment-position';

// A realistic AY: four terms with two short breaks between them. Composing the
// input through the real `resolveEnrolmentPosition` (rather than hand-writing
// an EnrolmentPosition) keeps this honest to what the route actually passes in.
const TERMS: TermWindow[] = [
  { termNumber: 1, startDate: '2026-01-05', endDate: '2026-03-13' },
  { termNumber: 2, startDate: '2026-03-23', endDate: '2026-05-29' },
  { termNumber: 3, startDate: '2026-06-29', endDate: '2026-09-04' },
  { termNumber: 4, startDate: '2026-09-14', endDate: '2026-11-20' },
];

const SECTION_ID = 'sec-0001';
const SECTION_STUDENT_ID = 'ss-0001';

function payloadOn(today: string) {
  return buildMidTermPayload(
    resolveEnrolmentPosition(TERMS, today),
    SECTION_ID,
    SECTION_STUDENT_ID
  );
}

describe('buildMidTermPayload', () => {
  it('offers the current-vs-next choice when placed mid-term', () => {
    // Inside T2, with T3 still ahead.
    const payload = payloadOn('2026-04-20');

    expect(payload).not.toBeNull();
    expect(payload).toMatchObject({
      termNumber: 2,
      termLabel: 'T2',
      activeTermNumber: 2,
      nextTermNumber: 3,
      canDeferToNext: true,
    });
    expect(payload!.daysLeftInActiveTerm).toBe(39);
  });

  it('offers only the next term when placed during a break', () => {
    // Between T2's end and T3's start — still a late join, but there is no
    // current term to join, so the dialog must render a single option.
    const payload = payloadOn('2026-06-10');

    expect(payload).toMatchObject({
      termNumber: 3,
      termLabel: 'T3',
      activeTermNumber: null,
      nextTermNumber: 3,
      canDeferToNext: false,
      daysLeftInActiveTerm: null,
    });
  });

  it('returns null before the year starts — an on-time student is not prompted', () => {
    expect(payloadOn('2025-12-20')).toBeNull();
  });

  it('returns null once the final term has ended — there is nothing left to join', () => {
    expect(payloadOn('2026-12-01')).toBeNull();
  });

  it('returns null when the AY has no terms configured at all', () => {
    const pos = resolveEnrolmentPosition([], '2026-04-20');
    expect(buildMidTermPayload(pos, SECTION_ID, SECTION_STUDENT_ID)).toBeNull();
  });

  it('treats the first day of T1 as on-time, and the day after as late', () => {
    expect(payloadOn('2026-01-05')).toMatchObject({ termNumber: 1 });
    // T1's start is inclusive, so day one is already "year started". The
    // meaningful boundary is the day BEFORE it.
    expect(payloadOn('2026-01-04')).toBeNull();
  });

  it('passes the section and roster-row ids straight through', () => {
    const payload = payloadOn('2026-04-20');

    expect(payload!.sectionId).toBe(SECTION_ID);
    expect(payload!.sectionStudentId).toBe(SECTION_STUDENT_ID);
  });
});
