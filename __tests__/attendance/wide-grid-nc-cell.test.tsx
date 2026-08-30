/**
 * Two claims about the term grid, and they are NOT the same claim.
 *
 * "No class" left the marking palette on 2026-08-31 — Mr Ace: *"there is no NC
 * type of attendance mark"*. A day the class did not meet is a property of the
 * school calendar, not a judgement about a student.
 *
 * ⚠ REMOVING A WAY TO PICK A MARK IS NOT REMOVING A WAY TO SHOW ONE, and
 * confusing the two would be data loss on screen. Real NC rows exist on
 * production: paper-register imports wrote them, and so did holidays and
 * not-yet-enrolled rows. A teacher opening last term's sheet must still see
 * them, with their wash and their tooltip, exactly as before. The palette half
 * of this is proved in `cell-mark-dialog.test.tsx`; this file is the display
 * half, against the grid that actually paints the cells.
 *
 * It also pins the third thing the same change introduced: the marking editor
 * is a centred dialog now, so the open cell has to say so itself. That ring is
 * the ONLY indicator of which of ~1,410 days is being edited.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AttendanceWideGrid } from '@/components/attendance/wide-grid';
import type {
  CalendarEventRow,
  SchoolCalendarRow,
} from '@/lib/attendance/calendar';
import type { DailyEntryRow } from '@/lib/attendance/queries';
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

const CALENDAR: SchoolCalendarRow[] = ['2026-08-06', '2026-08-07'].map(
  (date, i) => ({
    id: `cal-${i}`,
    termId: TERM_ID,
    date,
    dayType: 'school_day',
    isHoliday: false,
    label: null,
    audience: 'all',
    hblOverlay: false,
  })
);

const EVENTS: CalendarEventRow[] = [];

const ENROLMENTS = [
  {
    enrolmentId: 'enr-1',
    indexNumber: 12,
    studentNumber: 'S0001',
    studentName: 'Reyes, Ana',
    busNo: null,
    classroomOfficerRole: null,
    academicsNotes: null,
    adminNotes: null,
    withdrawn: false,
    compassionateUsed: 0,
    compassionateAllowance: 5,
    vlUsedThisTerm: 0,
    vlAllowance: 1,
    enrollmentDate: null,
  },
];

/** A stored "no class" row of the kind the paper-register import wrote. */
const DAILY: DailyEntryRow[] = [
  {
    id: 'daily-nc',
    sectionStudentId: 'enr-1',
    termId: TERM_ID,
    date: '2026-08-06',
    status: 'NC',
    exReason: null,
    exNote: null,
    periodId: null,
    recordedBy: null,
    recordedAt: '2026-08-06T01:00:00.000Z',
  },
];

function renderGrid() {
  return renderWithClient(
    <AttendanceWideGrid
      sectionId="section-1"
      termId={TERM_ID}
      enrolments={ENROLMENTS}
      calendar={CALENDAR}
      events={EVENTS}
      initialDaily={DAILY}
      // ⚠ Still passed, and still meaningful: the grid no longer offers NC,
      // but `PATCH /api/attendance/daily` still refuses an NC write from
      // anyone below registrar. The prop is the visible thread between the
      // page that computes the permission and the route that enforces it.
      canWriteNc
      canEditBusCare={false}
      canEditAcademics={false}
      canEditAdmin={false}
    />
  );
}

describe('a stored no-class mark still shows', () => {
  it('paints the letter and keeps its plain-English tooltip', () => {
    renderGrid();
    const cell = screen.getByTitle('No class');
    expect(
      cell.textContent,
      'An NC row that renders blank is a mark erased from the register by a ' +
        'change that was only ever meant to stop new ones being written.'
    ).toBe('NC');
  });

  it('is still a button the teacher can open and correct', async () => {
    // The mark cannot be re-picked, but the day it sits on is an ordinary
    // school day — a teacher must be able to open it and put the right mark
    // there, or an imported NC would be frozen on the sheet forever.
    const user = userEvent.setup();
    renderGrid();
    await user.click(screen.getByTitle('No class'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'No class' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Present' })).toBeTruthy();
  });
});

describe('the open cell says which day is being edited', () => {
  it('rings the cell that opened the dialog, and only that one', async () => {
    // Mr Ace's first complaint about the popover: "there is no indicator which
    // cell is open". A centred dialog cannot answer that by proximity, so the
    // ring is the whole answer.
    const user = userEvent.setup();
    const { container } = renderGrid();
    expect(container.querySelectorAll('[data-active]')).toHaveLength(0);

    await user.click(screen.getByTitle('Mark attendance'));

    const ringed = container.querySelectorAll('[data-active]');
    expect(ringed).toHaveLength(1);
    expect(ringed[0].className).toContain('ring-primary');
  });

  it('names the student and the whole date in the dialog header', async () => {
    const user = userEvent.setup();
    renderGrid();
    await user.click(screen.getByTitle('Mark attendance'));
    expect(screen.getByRole('heading', { name: 'Reyes, Ana' })).toBeTruthy();
    // The roster number is how teachers address a student in class, and the
    // weekday is what catches an off-by-one column BEFORE the mark is saved.
    expect(screen.getByText(/^No\. 12 · .*7 August 2026$/)).toBeTruthy();
  });
});
