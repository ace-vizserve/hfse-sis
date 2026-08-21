/**
 * The adviser's "Look up student" panel.
 *
 * The ranking itself is tested against its real implementation in
 * at-risk.test.ts; what matters here is what an adviser can misread — an empty
 * list that looks like a broken search, or a row that does not lead anywhere,
 * when the whole point of Ms Koh's ask was the phone call at the end of it.
 */

import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AtRiskLookup } from '@/components/classroom/at-risk-lookup';
import type { AtRiskStudent } from '@/lib/classroom/at-risk';
import { renderWithClient } from '../_utils/render-with-client';
import { jsonResponse, stubFetch, stubFetchOnce } from '../_utils/mock-fetch';

const FALLEN: AtRiskStudent = {
  sectionStudentId: 'ss-1',
  studentNumber: 'H260127',
  studentName: 'Bautista, Joaquin P.',
  indexNumber: 2,
  worstDiff: -13,
  drops: [
    {
      subject: 'Mathematics',
      metric: 'quarterly',
      metricLabel: 'Term grade',
      priorTermLabel: 'Term 1',
      prior: 91,
      current: 78,
      diff: -13,
      display: { prior: '91', current: '78', kind: 'points' },
    },
    {
      subject: 'Science',
      metric: 'ww',
      metricLabel: 'Written work',
      priorTermLabel: 'Term 1',
      prior: 88,
      current: 81,
      diff: -7,
      display: { prior: '88', current: '81', kind: 'points' },
    },
  ],
  subjects: [
    {
      subject: 'Mathematics',
      isExaminable: true,
      fell: true,
      terms: [
        {
          label: 'Term 1',
          quarterly: 91,
          ww: 88,
          pt: 90,
          qa: 92,
          marks: {
            ww: { scored: 44, max: 50 },
            pt: { scored: 36, max: 40 },
            qa: { scored: 46, max: 50 },
          },
        },
        {
          label: 'Term 2',
          quarterly: 78,
          ww: 81,
          pt: 76,
          qa: 80,
          marks: {
            ww: { scored: 48.6, max: 60 },
            pt: { scored: 30.4, max: 40 },
            qa: { scored: 40, max: 50 },
          },
        },
      ],
    },
    {
      subject: 'Science',
      isExaminable: true,
      fell: true,
      terms: [
        { label: 'Term 1', quarterly: 88, ww: 88, pt: 87, qa: 89 },
        { label: 'Term 2', quarterly: 85, ww: 81, pt: 86, qa: 87 },
      ],
    },
    {
      subject: 'English',
      isExaminable: true,
      fell: false,
      terms: [
        { label: 'Term 1', quarterly: 84, ww: 85, pt: 83, qa: 84 },
        { label: 'Term 2', quarterly: 86, ww: 86, pt: 85, qa: 87 },
      ],
    },
  ],
};

/** Same class, nobody flagged — the case the panel used to render as empty. */
const STEADY: AtRiskStudent = {
  sectionStudentId: 'ss-2',
  studentNumber: 'H260200',
  studentName: 'Flores, Miguel A.',
  indexNumber: 5,
  worstDiff: null,
  drops: [],
  subjects: [
    {
      subject: 'Mathematics',
      isExaminable: true,
      fell: false,
      terms: [
        { label: 'Term 1', quarterly: 84, ww: 85, pt: 83, qa: 84 },
        { label: 'Term 2', quarterly: 85, ww: 86, pt: 84, qa: 85 },
      ],
    },
  ],
};

function render() {
  return renderWithClient(
    <AtRiskLookup sectionId="sec-1" termId="term-2" termLabel="Term 2" />
  );
}

async function open() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /look up student/i }));
  return user;
}

describe('nothing is fetched until it is opened', () => {
  it('makes no request while closed', () => {
    const fetchSpy = stubFetchOnce(jsonResponse({ students: [] }));
    render();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('asks for the section and the term on screen', async () => {
    const fetchSpy = stubFetchOnce(jsonResponse({ students: [] }));
    render();
    await open();
    await screen.findByText(/no students yet/i);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      '/api/classroom/sec-1/at-risk?term_id=term-2'
    );
  });
});

describe('an empty list is good news', () => {
  it('says nobody needs a look, not "no results"', async () => {
    // An adviser opening this and seeing a failed-search empty state would
    // reasonably conclude the feature is broken rather than that their class
    // is fine.
    stubFetchOnce(jsonResponse({ students: [STEADY] }));
    render();
    await open();
    // The roster is the list, so a healthy class still shows its students —
    // it is the FILTER that comes back empty, and it must say why.
    expect(
      await screen.findByRole('button', { name: /Flores, Miguel A\./ })
    ).toBeInTheDocument();
    expect(screen.getByText('Steady')).toBeInTheDocument();
  });
});

describe('a student who has slipped', () => {
  it('summarises one line per subject, worst fall first', async () => {
    // The row used to print a line per FALL, so a subject with two components
    // down appeared twice. A list is scanned; the detail is read.
    stubFetchOnce(jsonResponse({ students: [FALLEN] }));
    render();
    await open();

    const row = await screen.findByRole('button', {
      name: /Bautista, Joaquin P\./,
    });
    expect(row).toHaveTextContent('Mathematics −13 · Science −7');
    expect(row).not.toHaveTextContent('Term grade');
  });

  it('headlines the steepest single fall', async () => {
    stubFetchOnce(jsonResponse({ students: [FALLEN] }));
    render();
    await open();
    const row = await screen.findByRole('button', {
      name: /Bautista, Joaquin P\./,
    });
    expect(row).toHaveTextContent('−13');
  });

  it('reaches the parents’ number, in the same panel', async () => {
    // Koh's sentence ends at "contact the parents". A list that cannot reach a
    // phone number stops one step short of the thing she asked for — and the
    // second view is IN this panel rather than a sheet on top of it, so the
    // route is exercised here rather than a nested dialog.
    stubFetch((input) =>
      Promise.resolve(
        String(input).includes('/at-risk')
          ? jsonResponse({ students: [FALLEN] })
          : jsonResponse({
              medical: { conditions: [], notes: [], paracetamol: null },
              learning: [],
              contacts: {
                people: [
                  {
                    label: 'Mother',
                    name: 'Maricel Bautista',
                    mobile: '87796901',
                    email: null,
                  },
                ],
                emergency: null,
                livingWith: null,
              },
              hasMedical: false,
              hasLearning: false,
            })
      )
    );
    render();
    const user = await open();
    await user.click(
      await screen.findByRole('button', { name: /Bautista, Joaquin P\./ })
    );
    expect(await screen.findByText('Maricel Bautista')).toBeInTheDocument();
    expect(screen.getByText('87796901')).toBeInTheDocument();
  });

  it('goes back to the list without closing the panel', async () => {
    stubFetchOnce(jsonResponse({ students: [FALLEN] }));
    render();
    const user = await open();
    await user.click(
      await screen.findByRole('button', { name: /Bautista, Joaquin P\./ })
    );
    await user.click(
      await screen.findByRole('button', { name: /all students/i })
    );
    // Back on the list, not closed: the row is there to be tapped again.
    expect(
      await screen.findByRole('button', { name: /Bautista, Joaquin P\./ })
    ).toBeInTheDocument();
  });
});

describe('a letter-graded subject on screen', () => {
  it('reads as bands, with no points figure to misread', async () => {
    stubFetchOnce(
      jsonResponse({
        students: [
          {
            ...FALLEN,
            // Self-consistent on purpose: a band-only student's summary must
            // be derived from the drops, not left over from the fixture.
            worstDiff: -8,
            drops: [
              {
                subject: 'MAPEH',
                metric: 'quarterly',
                metricLabel: 'Term grade',
                priorTermLabel: 'Term 1',
                prior: 90,
                current: 82,
                diff: -8,
                display: { prior: 'A', current: 'C', kind: 'band' },
              },
            ],
          },
        ],
      })
    );
    render();
    await open();
    const bandRow = await screen.findByRole('button', {
      name: /Bautista, Joaquin P\./,
    });
    expect(bandRow).toHaveTextContent('MAPEH A→C');
    // "-8" anywhere on this row invites the reader to treat it as points —
    // including in the summary badge, which is where it survived the first
    // version of this test.
    expect(bandRow).not.toHaveTextContent('−8');
    expect(bandRow).not.toHaveTextContent('-8');
    expect(bandRow).toHaveTextContent('Band down');
  });

  it('still headlines the points figure when a real fall is present', async () => {
    stubFetchOnce(jsonResponse({ students: [FALLEN] }));
    render();
    await open();
    // Twice over: the summary badge and the Maths row it came from.
    const row = await screen.findByRole('button', {
      name: /Bautista, Joaquin P\./,
    });
    expect(row).toHaveTextContent('−13');
    expect(row).not.toHaveTextContent('Band down');
  });
});

/**
 * A subject that falls on two components must appear ONCE. The row used to
 * print `drops[0].priorTermLabel` over a stacked list, which both repeated the
 * subject and named a term the other lines had not been measured from; the
 * per-term comparison now lives in the detail panel, where each term is set
 * against the one immediately before it.
 */
describe('a subject that fell twice', () => {
  const TWICE: AtRiskStudent = {
    ...FALLEN,
    drops: [
      { ...FALLEN.drops[0], subject: 'Mathematics', diff: -13 },
      {
        ...FALLEN.drops[1],
        subject: 'Mathematics',
        metric: 'ww',
        diff: -7,
        priorTermLabel: 'Term 2',
      },
    ],
  };

  it('appears once, at its steepest', async () => {
    stubFetchOnce(jsonResponse({ students: [TWICE] }));
    render();
    await open();
    const row = await screen.findByRole('button', {
      name: /Bautista, Joaquin P\./,
    });
    expect(row).toHaveTextContent('Mathematics −13');
    expect(row).not.toHaveTextContent('Mathematics −13 · Mathematics');
  });
});

/**
 * The panel used to be a triage list: it received the flagged subset and
 * nothing else, so a healthy class rendered as an empty screen and a specific
 * child could not be looked up at all. Mr Ace, 2026-08-21: "list all students
 * sorted by index numbers and a filter dropdown to show only flagged students
 * or all."
 */
describe('the list is the whole class', () => {
  it('shows the students who have not fallen, in index order', async () => {
    stubFetchOnce(jsonResponse({ students: [FALLEN, STEADY] }));
    render();
    await open();

    expect(
      await screen.findByRole('button', { name: /Bautista, Joaquin P\./ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Flores, Miguel A\./ })
    ).toBeInTheDocument();
  });

  it('narrows to the students who fell', async () => {
    stubFetchOnce(jsonResponse({ students: [FALLEN, STEADY] }));
    render();
    const user = await open();
    await screen.findByRole('button', { name: /Bautista, Joaquin P\./ });

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: /only flagged/i }));

    expect(
      screen.getByRole('button', { name: /Bautista, Joaquin P\./ })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Flores, Miguel A\./ })
    ).toBeNull();
  });

  it('names the term on the filter, so an empty result is not read as "never"', async () => {
    stubFetchOnce(jsonResponse({ students: [FALLEN] }));
    render();
    const user = await open();
    await screen.findByRole('button', { name: /Bautista, Joaquin P\./ });
    await user.click(screen.getByRole('combobox'));
    expect(
      screen.getByRole('option', { name: /only flagged/i })
    ).toHaveTextContent('Term 2');
  });
});

describe('opening a student shows their whole year', () => {
  function stubBoth() {
    return stubFetch((input) =>
      Promise.resolve(
        String(input).includes('/at-risk')
          ? jsonResponse({ students: [FALLEN] })
          : jsonResponse({
              contacts: { people: [] },
              attendance: null,
              writeups: [],
            })
      )
    );
  }

  it('offers every subject as a tab, not just the ones that fell', async () => {
    stubBoth();
    render();
    const user = await open();
    await user.click(
      await screen.findByRole('button', { name: /Bautista, Joaquin P\./ })
    );

    // English did not fall, but an adviser can still reach it.
    expect(
      await screen.findByRole('tab', { name: /English/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: /Mathematics/ })
    ).toBeInTheDocument();
  });

  it('opens on the subject that fell, because that is why they are here', async () => {
    stubBoth();
    render();
    const user = await open();
    await user.click(
      await screen.findByRole('button', { name: /Bautista, Joaquin P\./ })
    );

    expect(
      await screen.findByRole('tab', { name: /Mathematics/, selected: true })
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /English/ })).toHaveAttribute(
      'aria-selected',
      'false'
    );
  });

  it('switches subject without leaving the student', async () => {
    stubBoth();
    render();
    const user = await open();
    await user.click(
      await screen.findByRole('button', { name: /Bautista, Joaquin P\./ })
    );
    await user.click(await screen.findByRole('tab', { name: /English/ }));

    expect(
      screen.getByRole('tab', { name: /English/, selected: true })
    ).toBeInTheDocument();
    // Still the same student — the panel did not send them back to the list.
    expect(screen.getByText('Bautista, Joaquin P.')).toBeInTheDocument();
  });
});
