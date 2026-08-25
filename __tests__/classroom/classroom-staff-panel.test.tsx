/**
 * "Who runs this class" — the Classroom Overview staff panel.
 *
 * THE ASSERTION THAT MATTERS is the cover one. Since migration 117 a class can
 * have a substitute, and the rule the whole relief design rests on is that the
 * regular teacher stays the NAME OF RECORD for the duration. A panel that
 * showed the substitute in their place would be the first surface in the app to
 * break that, and nothing in the database would stop it —
 * __tests__/auth/assignment-read-classification.test.ts classifies
 * lib/classroom/staff.ts as `name` and points here for the proof.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ClassroomStaffPanel } from '@/components/classroom/classroom-staff-panel';
import type { SectionStaff } from '@/lib/classroom/staff';

function staff(over: Partial<SectionStaff> = {}): SectionStaff {
  return {
    adviserName: 'Marrie Tan',
    adviserId: 'user-tan',
    adviserCoveringName: null,
    adviserCoveringId: null,
    adviserScheduledCoveringName: null,
    adviserScheduledCoverFrom: null,
    subjects: [
      {
        subjectId: 'sub-1',
        code: 'MATH',
        name: 'Mathematics',
        teacherName: 'R. Fernandez',
        teacherId: 'user-fernandez',
        coveringName: null,
        coveringId: null,
        scheduledCoveringName: null,
        scheduledCoverFrom: null,
      },
    ],
    noSubjectsConfigured: false,
    ...over,
  };
}

function renderPanel(over: Partial<SectionStaff> = {}, canManage = false) {
  return render(
    <ClassroomStaffPanel
      sectionId="sec-1"
      staff={staff(over)}
      canManage={canManage}
    />
  );
}

describe('the name of record survives a cover', () => {
  it('keeps the regular teacher first and marks the substitute as covering', () => {
    renderPanel({
      subjects: [
        {
          subjectId: 'sub-1',
          code: 'MATH',
          name: 'Mathematics',
          teacherName: 'R. Fernandez',
          teacherId: 'user-fernandez',
          coveringName: 'Jenny Wong',
          coveringId: 'user-wong',
          scheduledCoveringName: null,
          scheduledCoverFrom: null,
        },
      ],
    });

    // Both names present, in that order, in one line — not the substitute
    // standing in for the holder.
    expect(screen.getByText(/R\. Fernandez/).textContent).toMatch(
      /R\. Fernandez.*Jenny Wong covering/
    );
  });

  it('does the same for a covered form adviser', () => {
    renderPanel({
      adviserName: 'Marrie Tan',
      adviserCoveringName: 'Jenny Wong',
    });
    expect(screen.getByText(/Marrie Tan/).textContent).toMatch(
      /Marrie Tan.*Jenny Wong covering/
    );
  });
});

describe('a cover that has not started yet', () => {
  // ⚠ The whole point of migration 123's display rule. A booked substitute has
  // NO access until their first day, so the panel must not say "covering" — a
  // coordinator reading it would go to the wrong person today.
  it('says when they start, never that they are covering', () => {
    renderPanel({
      subjects: [
        {
          subjectId: 'sub-1',
          code: 'MATH',
          name: 'Mathematics',
          teacherName: 'R. Fernandez',
          teacherId: 'user-fernandez',
          coveringName: null,
          coveringId: null,
          scheduledCoveringName: 'Jenny Wong',
          scheduledCoverFrom: '2026-09-03',
        },
      ],
    });

    const line = screen.getByText(/R\. Fernandez/).textContent ?? '';
    expect(line).toMatch(/Jenny Wong covers from 3 Sep/);
    expect(line).not.toMatch(/Jenny Wong covering/);
  });

  it('does the same for the form adviser', () => {
    renderPanel({
      adviserName: 'Marrie Tan',
      adviserCoveringName: null,
      adviserScheduledCoveringName: 'Jenny Wong',
      adviserScheduledCoverFrom: '2026-09-03',
    });

    const line = screen.getByText(/Marrie Tan/).textContent ?? '';
    expect(line).toMatch(/Jenny Wong covers from 3 Sep/);
    expect(line).not.toMatch(/covering/);
  });

  it('keeps the holder as the name of record either way', () => {
    renderPanel({
      adviserName: 'Marrie Tan',
      adviserScheduledCoveringName: 'Jenny Wong',
      adviserScheduledCoverFrom: '2026-09-03',
    });
    // Holder first, exactly as with a live cover.
    expect(screen.getByText(/Marrie Tan/).textContent).toMatch(
      /^Marrie Tan.*Jenny Wong/
    );
  });
});

describe('what is missing shows where it is missing', () => {
  it('names the subject nobody teaches, on the subject’s own line', () => {
    renderPanel({
      subjects: [
        {
          subjectId: 'sub-1',
          code: 'MATH',
          name: 'Mathematics',
          teacherName: null,
          teacherId: null,
          coveringName: null,
          coveringId: null,
          scheduledCoveringName: null,
          scheduledCoverFrom: null,
        },
      ],
    });
    expect(screen.getByText('Mathematics')).toBeInTheDocument();
    expect(screen.getByText('No teacher')).toBeInTheDocument();
  });

  it('says so when there is no form adviser', () => {
    renderPanel({ adviserName: null });
    expect(screen.getByText('Not assigned')).toBeInTheDocument();
  });

  it('counts how many subjects are covered', () => {
    renderPanel({
      subjects: [
        {
          subjectId: 'a',
          code: null,
          name: 'Mathematics',
          teacherName: 'R. Fernandez',
          teacherId: 'user-fernandez',
          coveringName: null,
          coveringId: null,
          scheduledCoveringName: null,
          scheduledCoverFrom: null,
        },
        {
          subjectId: 'b',
          code: null,
          name: 'Science',
          teacherName: null,
          teacherId: null,
          coveringName: null,
          coveringId: null,
          scheduledCoveringName: null,
          scheduledCoverFrom: null,
        },
      ],
    });
    expect(screen.getByText('1 of 2 subjects covered')).toBeInTheDocument();
  });

  it('separates "no subjects set up" from "subjects nobody teaches"', () => {
    // Different problem, different fix — a class nobody has given subjects to
    // is not a class whose subjects are unstaffed.
    renderPanel({ subjects: [], noSubjectsConfigured: true });
    expect(screen.getByText('No subjects set up yet')).toBeInTheDocument();
    expect(screen.queryByText('No teacher')).toBeNull();
  });
});

describe('opening a teacher', () => {
  it('links a name to the staff page for someone who can open it', () => {
    renderPanel({}, true);
    expect(screen.getByRole('link', { name: 'R. Fernandez' })).toHaveAttribute(
      'href',
      '/sis/admin/staff/user-fernandez'
    );
    expect(screen.getByRole('link', { name: 'Marrie Tan' })).toHaveAttribute(
      'href',
      '/sis/admin/staff/user-tan'
    );
  });

  it('leaves the name as plain text for a teacher', () => {
    // /sis/admin/staff is coordinator-and-above. A link here would bounce a
    // teacher to `/` — the dead end KD #173 exists to prevent.
    renderPanel({}, false);
    expect(screen.queryByRole('link', { name: 'R. Fernandez' })).toBeNull();
    expect(screen.getByText('R. Fernandez')).toBeInTheDocument();
  });

  it('links the substitute to their own page, still beside the holder', () => {
    renderPanel(
      {
        subjects: [
          {
            subjectId: 'sub-1',
            code: 'MATH',
            name: 'Mathematics',
            teacherName: 'R. Fernandez',
            teacherId: 'user-fernandez',
            coveringName: 'Jenny Wong',
            coveringId: 'user-wong',
            scheduledCoveringName: null,
            scheduledCoverFrom: null,
          },
        ],
      },
      true
    );
    expect(screen.getByRole('link', { name: 'Jenny Wong' })).toHaveAttribute(
      'href',
      '/sis/admin/staff/user-wong'
    );
    expect(
      screen.getByRole('link', { name: 'R. Fernandez' })
    ).toBeInTheDocument();
  });
});

describe('the way out', () => {
  it('offers the link only to someone who can open that page', () => {
    // /sis/sections/[id] is coordinator-and-above. A teacher offered this link
    // would be bounced to `/`, which is the dead end KD #173 exists to stop.
    renderPanel({}, false);
    expect(screen.queryByRole('link', { name: /manage teachers/i })).toBeNull();
  });

  it('points a coordinator at the surface that actually assigns', () => {
    renderPanel({}, true);
    expect(
      screen.getByRole('link', { name: /manage teachers/i })
    ).toHaveAttribute('href', '/sis/sections/sec-1?tab=teachers');
  });
});
