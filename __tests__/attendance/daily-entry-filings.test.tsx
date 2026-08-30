/**
 * The daily register says what a parent already told the school.
 *
 * Mr Ace, 2026-08-31: *"daily view has no link or whatever pointing that a
 * parent has a filed declaration for it"*. He was right, and the cause was not
 * a missing query — the page had already loaded `filingsByCell` for the term
 * sheet and simply never handed it to the daily view. So an approved filing
 * showed on the slower of the two marking paths and was invisible on the one a
 * form adviser opens every morning.
 *
 * ⚠ THE POINT IS THE UNTOUCHED ROW. This register marks the EXCEPTIONS, so the
 * moment a teacher chooses between Absent and Excused comes BEFORE the first
 * click — which is exactly when the filing has to be on screen. A panel that
 * only appeared after the teacher had already picked Excused would arrive
 * after the decision it exists to inform.
 *
 * ⚠ AND IT HAS TO FOLLOW THE STEPPER. The date is client state; the arrows
 * walk it without a round trip. A filing narrowed on the server would be right
 * on arrival and wrong from the first click — which is why the last test here
 * steps a day forward and expects the line to go.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DailyEntry } from '@/components/attendance/daily-entry';
import type { CellFiling } from '@/components/attendance/cell-mark-dialog';
import type {
  CalendarEventRow,
  SchoolCalendarRow,
} from '@/lib/attendance/calendar';
import type { DailyEntryRow } from '@/lib/attendance/queries';
import type { WideGridEnrolment } from '@/components/attendance/wide-grid';
import { renderWithClient } from '../_utils/render-with-client';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/attendance/section-1',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('sonner', async () => ({
  toast: (await import('../_utils/mock-toast')).createToastMock(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const TERM_ID = 'term-1';
const DAY_ONE = '2026-09-03';
const DAY_TWO = '2026-09-04';

const CALENDAR: SchoolCalendarRow[] = [DAY_ONE, DAY_TWO].map((date, i) => ({
  id: `cal-${i}`,
  termId: TERM_ID,
  date,
  dayType: 'school_day',
  isHoliday: false,
  label: null,
  audience: 'all',
  hblOverlay: false,
}));

const EVENTS: CalendarEventRow[] = [];

function enrolment(
  enrolmentId: string,
  indexNumber: number,
  studentName: string,
  overrides: Partial<WideGridEnrolment> = {}
): WideGridEnrolment {
  return {
    enrolmentId,
    indexNumber,
    studentNumber: `S000${indexNumber}`,
    studentName,
    busNo: null,
    classroomOfficerRole: null,
    academicsNotes: null,
    adminNotes: null,
    withdrawn: false,
    enrollmentDate: null,
    compassionateUsed: 0,
    compassionateAllowance: 5,
    vlUsedThisTerm: 0,
    vlAllowance: 1,
    ...overrides,
  };
}

// Ana has a filing on DAY_ONE; Ben never does. Two students, so every "shows"
// assertion is paired with a "and not on the row beside it".
const ANA = enrolment('enr-1', 12, 'Reyes, Ana');
const BEN = enrolment('enr-2', 13, 'Santos, Ben');

const ABSENCE_FILING: CellFiling = {
  dateRange: '3–4 Sep 2026',
  kind: 'absence',
  hasEvidence: true,
  approvedBy: 'Ms Lhen Mendoza',
  href: '/attendance/declarations?req=abc',
};

const TRAVEL_FILING: CellFiling = {
  dateRange: '3–7 Sep 2026',
  kind: 'travel',
  // Always false for travel — the schema forbids a holiday carrying evidence.
  hasEvidence: false,
  approvedBy: 'Ms Elaine Wee',
  href: '/attendance/declarations?req=xyz',
};

function setup(
  filingsByCell: Record<string, CellFiling>,
  opts: { roster?: WideGridEnrolment[]; initialDaily?: DailyEntryRow[] } = {}
) {
  renderWithClient(
    <DailyEntry
      sectionId="section-1"
      termId={TERM_ID}
      enrolments={opts.roster ?? [ANA, BEN]}
      calendar={CALENDAR}
      events={EVENTS}
      initialDaily={opts.initialDaily ?? []}
      today={DAY_ONE}
      filingsByCell={filingsByCell}
    />
  );
  return { user: userEvent.setup() };
}

const anaFilingLine = () =>
  screen.queryByRole('link', {
    name: "Excused by a parent's filing for Reyes, Ana",
  });

describe('a day a parent filed for, on the daily register', () => {
  it('names the filing on the student it belongs to, and links to it', () => {
    setup({ [`${ANA.enrolmentId}|${DAY_ONE}`]: ABSENCE_FILING });

    const link = anaFilingLine();
    expect(
      link,
      'The row a parent filed for must say so before the teacher marks it.'
    ).toBeTruthy();
    expect(link!.getAttribute('href')).toBe(ABSENCE_FILING.href);
    // The same sentence the term sheet's marking palette shows. One filing,
    // one set of words, wherever a person meets it.
    expect(screen.getByText(/Excused by a parent's filing/)).toBeTruthy();
    expect(screen.getByText(/3–4 Sep 2026/)).toBeTruthy();
    expect(screen.getByText(/· certificate/)).toBeTruthy();
  });

  it('shows on a row nobody has touched yet', () => {
    // ⚠ THE WHOLE POINT. This register marks the exceptions, so an untouched
    // row is how a teacher says Present — and the filing is the reason not to.
    // Nothing has been clicked in this test at all.
    setup({ [`${ANA.enrolmentId}|${DAY_ONE}`]: ABSENCE_FILING });
    expect(anaFilingLine()).toBeTruthy();
  });

  it('stays off the row of a student nobody filed for', () => {
    setup({ [`${ANA.enrolmentId}|${DAY_ONE}`]: ABSENCE_FILING });
    expect(
      screen.queryByRole('link', {
        name: "Excused by a parent's filing for Santos, Ben",
      }),
      'Ben has no filing. A line on his row would be a claim about a document ' +
        'nobody sent.'
    ).toBeNull();
    // Exactly one filing on the page, not one per roster row.
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('stays off every row when nothing was filed at all', () => {
    setup({});
    expect(screen.queryByText(/Excused by a parent's/)).toBeNull();
  });

  it('follows the date stepper', async () => {
    // The date is client state — the arrows walk it with no round trip. A
    // filing narrowed on the server would be right on arrival and wrong from
    // the first click.
    const { user } = setup({
      [`${ANA.enrolmentId}|${DAY_ONE}`]: ABSENCE_FILING,
    });
    expect(anaFilingLine()).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Next school day' }));

    expect(screen.getByText(DAY_TWO)).toBeTruthy();
    expect(
      anaFilingLine(),
      'The filing covers 3 Sep. Carrying it onto 4 Sep would tell the teacher ' +
        'a day was excused when it was not.'
    ).toBeNull();
  });

  it('appears on the day it covers when the stepper reaches it', async () => {
    // The inverse of the test above, and the one that catches a map narrowed
    // once at mount: stepping forward has to bring a NEW day's filing in.
    const { user } = setup({
      [`${ANA.enrolmentId}|${DAY_TWO}`]: ABSENCE_FILING,
    });
    expect(anaFilingLine()).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Next school day' }));
    expect(anaFilingLine()).toBeTruthy();
  });

  it('names a family holiday as one, and never mentions a certificate', () => {
    // ⚠ "no certificate" on a holiday would be a lie of a particular kind: it
    // implies a document is missing, when a holiday has none to give.
    setup({ [`${ANA.enrolmentId}|${DAY_ONE}`]: TRAVEL_FILING });

    expect(
      screen.getByRole('link', {
        name: "Excused by a parent's travel filing for Reyes, Ana",
      })
    ).toBeTruthy();
    expect(screen.getByText(/3–7 Sep 2026/)).toBeTruthy();
    expect(screen.queryByText(/certificate/)).toBeNull();
  });

  it('states the absence of proof rather than leaving it blank', () => {
    // A parent may file without a certificate. A teacher reading only
    // "excused by a filing" would assume one exists.
    setup({
      [`${ANA.enrolmentId}|${DAY_ONE}`]: {
        ...ABSENCE_FILING,
        hasEvidence: false,
      },
    });
    expect(screen.getByText(/no certificate/)).toBeTruthy();
  });

  it('names nobody — not the parent, not the approver', () => {
    // The question a teacher is answering is "why is this day excused", not
    // "who sent it". The only identifier held reliably is an email address,
    // which answers neither. Both are on the filing, behind the link.
    setup({ [`${ANA.enrolmentId}|${DAY_ONE}`]: ABSENCE_FILING });
    expect(screen.queryByText(/Ms Lhen Mendoza/)).toBeNull();
    expect(screen.queryByText(/@/)).toBeNull();
  });

  it('stays off a row that cannot be marked at all', () => {
    // A "Before enrolment date" row carries no marking control and is left out
    // of the submit set outright. A link there would be the only live thing
    // inside a deliberately inert row.
    const late = enrolment('enr-3', 14, 'Tan, Cara', {
      enrollmentDate: '2026-09-10',
    });
    setup(
      { [`${late.enrolmentId}|${DAY_ONE}`]: ABSENCE_FILING },
      { roster: [late] }
    );

    expect(screen.getByText('Before enrolment date')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('sits alongside the excused block rather than replacing it', () => {
    // The term sheet's dialog swaps the note field out for the filing, because
    // there the two compete for one slot in a small panel. Here they are in
    // different places, and the note is where a teacher records what the
    // filing does not cover — a child back early from a holiday, say.
    setup(
      { [`${ANA.enrolmentId}|${DAY_ONE}`]: ABSENCE_FILING },
      {
        initialDaily: [
          {
            id: 'ad-1',
            sectionStudentId: ANA.enrolmentId,
            termId: TERM_ID,
            date: DAY_ONE,
            status: 'EX',
            exReason: 'mc',
            exNote: null,
            periodId: null,
            recordedBy: null,
            recordedAt: '2026-09-03T01:00:00.000Z',
          },
        ],
      }
    );

    expect(anaFilingLine()).toBeTruthy();
    expect(screen.getByLabelText('Note for Reyes, Ana')).toBeTruthy();
  });
});
