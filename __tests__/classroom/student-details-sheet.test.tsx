/**
 * The Classroom student-details drawer.
 *
 * THE ASSERTIONS THAT MATTER are the ones about what a teacher can miss.
 * A medical flag behind a closed tab, or a tab whose dot promises content and
 * then says "NA", are both failures of the feature's whole purpose — a teacher
 * knowing about a child's allergy before the lesson. The rest of the panel is
 * ordinary field rendering.
 */

import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { StudentDetailsSheet } from '@/components/classroom/student-details-sheet';
import type { StudentDetails } from '@/lib/classroom/student-details';
import { renderWithClient } from '../_utils/render-with-client';
import { jsonResponse, stubFetch } from '../_utils/mock-fetch';

function details(over: Partial<StudentDetails> = {}): StudentDetails {
  return {
    medical: { conditions: [], notes: [], paracetamol: null },
    learning: [],
    contacts: { people: [], emergency: null, livingWith: null },
    hasMedical: false,
    hasLearning: false,
    ...over,
  };
}

/**
 * The drawer fires TWO requests on open — the enrolment details, and the
 * student's disciplinary records for the fourth tab's marker. The stub has to
 * answer by URL: a single shared `Response` cannot serve both, because a body
 * can only be read once and whichever query lost the race would parse `null`
 * and render an empty panel.
 */
function stubDrawer(
  detailsBody: unknown,
  status = 200,
  records: unknown[] = []
) {
  return stubFetch((input) =>
    Promise.resolve(
      String(input).endsWith('/discipline')
        ? jsonResponse({ records })
        : jsonResponse(detailsBody, status)
    )
  );
}

function renderSheet() {
  return renderWithClient(
    <StudentDetailsSheet
      sectionId="sec-1"
      sectionName="P4 Trust"
      studentNumber="H260127"
      studentName="Bautista, Joaquin P."
      indexNumber={2}
      houseName="Orange House"
      houseColourToken="house-1"
      viewerUserId="user-1"
      canManageAnyDiscipline={false}
    />
  );
}

async function open() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'View details' }));
  return user;
}

describe('nothing is fetched until the drawer is opened', () => {
  it('makes no request while closed', () => {
    const fetchSpy = stubDrawer(details());
    renderSheet();
    // A roster of forty closed drawers must not be forty requests.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('asks for the student scoped to the section', async () => {
    const fetchSpy = stubDrawer(details());
    renderSheet();
    await open();
    await screen.findByRole('tab', { name: /contacts/i });
    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain('/api/classroom/sec-1/students/H260127');
    expect(urls).toContain('/api/classroom/sec-1/students/H260127/discipline');
  });
});

describe('a medical flag cannot be navigated away from', () => {
  it('shows the flag outside the tabs, so it survives a tab change', async () => {
    stubDrawer(
      details({
        hasMedical: true,
        medical: {
          conditions: ['Allergies', 'Asthma'],
          notes: [
            { label: 'Allergies', value: 'Severe peanut allergy — EpiPen' },
          ],
          paracetamol: true,
        },
      })
    );
    renderSheet();
    const user = await open();

    // Scoped to the strip on purpose: the same sentence also appears inside
    // the Medical tab, and an unscoped query would pass on the tab's copy
    // alone — which is exactly the bug this test exists to catch.
    const strip = await screen.findByTestId('safety-strip');
    expect(
      within(strip).getByText('Severe peanut allergy — EpiPen')
    ).toBeInTheDocument();

    // Move to a different tab; the strip is still there. This is the assertion
    // the whole "strip above the tabs" decision exists for.
    await user.click(screen.getByRole('tab', { name: /contacts/i }));
    expect(
      within(screen.getByTestId('safety-strip')).getByText(
        'Severe peanut allergy — EpiPen'
      )
    ).toBeInTheDocument();
  });

  it('opens on Medical when there is something medical', async () => {
    stubDrawer(
      details({
        hasMedical: true,
        medical: {
          conditions: ['Epilepsy'],
          notes: [],
          paracetamol: null,
        },
      })
    );
    renderSheet();
    await open();
    const tab = await screen.findByRole('tab', { name: /medical/i });
    expect(tab).toHaveAttribute('aria-selected', 'true');
  });
});

describe('which tab opens for a student with nothing recorded', () => {
  it('opens on Contacts rather than an empty Medical tab', async () => {
    stubDrawer(
      details({
        contacts: {
          people: [
            {
              label: 'Mother',
              name: 'Priya Chandran',
              mobile: '+65 8234 1122',
              email: null,
            },
          ],
          emergency: null,
          livingWith: 'Mother',
        },
      })
    );
    renderSheet();
    await open();
    const tab = await screen.findByRole('tab', { name: /contacts/i });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Priya Chandran')).toBeInTheDocument();
  });

  it('says so on the empty tabs rather than leaving them blank', async () => {
    stubDrawer(details());
    renderSheet();
    const user = await open();
    await user.click(await screen.findByRole('tab', { name: /learning/i }));
    // A real empty state, not a bare line: this is what ~95% of students show,
    // so it has to read as a resting state rather than a broken panel — and it
    // must name who fixes it if the blank is wrong.
    expect(await screen.findByText('Nothing recorded')).toBeInTheDocument();
    expect(screen.getByText(/the office can add it/i)).toBeInTheDocument();
  });
});

describe('the tab markers', () => {
  it('marks only the tabs that hold something', async () => {
    stubDrawer(
      details({
        hasLearning: true,
        learning: [
          { label: 'Additional learning needs', value: 'Mild autism' },
        ],
      })
    );
    renderSheet();
    await open();

    const learning = await screen.findByRole('tab', { name: /learning/i });
    const medical = screen.getByRole('tab', { name: /medical/i });
    // The dot is decorative, so it is found by shape rather than by role — the
    // point is that exactly one tab carries one.
    expect(within(learning).getByTestId('content-dot')).toBeInTheDocument();
    expect(within(medical).queryByTestId('content-dot')).toBeNull();
  });

  it('leaves both tabs unmarked when the record is empty', async () => {
    stubDrawer(details());
    renderSheet();
    await open();
    await screen.findByRole('tab', { name: /medical/i });
    expect(screen.queryAllByTestId('content-dot')).toHaveLength(0);
  });
});

describe('when the details cannot be loaded', () => {
  // The two failures need different people to do different things, so the
  // panel must not collapse them into one sentence. The first real failure in
  // the browser came back as a screenshot reading "could not be loaded", which
  // was true and useless.
  it('names the roster as the problem on a 404', async () => {
    stubDrawer({ error: 'not found' }, 404);
    renderSheet();
    await open();
    expect(
      await screen.findByText(/not on this class list/i)
    ).toBeInTheDocument();
    // A 404 is explained in words; there is no number worth repeating.
    expect(screen.queryByText(/^Error /)).toBeNull();
  });

  it('shows the status on any other failure, so it can be reported', async () => {
    stubDrawer({ error: 'lookup failed' }, 500);
    renderSheet();
    await open();
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.getByText(/Error 500/)).toBeInTheDocument();
  });

  it('names the step the server died on, so a screenshot is a bug report', async () => {
    stubDrawer({ error: 'lookup failed', step: 'admissions row' }, 500);
    renderSheet();
    await open();
    expect(
      await screen.findByText('Error 500 · admissions row')
    ).toBeInTheDocument();
  });
});

describe('the name as a trigger', () => {
  it('opens the same drawer from the student name', async () => {
    stubDrawer(details());
    renderWithClient(
      <StudentDetailsSheet
        asName
        sectionId="sec-1"
        sectionName="P4 Trust"
        studentNumber="H260127"
        studentName="Bautista, Joaquin P."
        indexNumber={2}
        houseName={null}
        houseColourToken={null}
        viewerUserId="user-1"
        canManageAnyDiscipline={false}
      />
    );
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: 'Bautista, Joaquin P.' })
    );
    expect(await screen.findByRole('tab', { name: /contacts/i })).toBeVisible();
  });
});
