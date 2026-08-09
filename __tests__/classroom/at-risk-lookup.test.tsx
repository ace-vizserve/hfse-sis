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
    },
    {
      subject: 'Science',
      metric: 'ww',
      metricLabel: 'Written work',
      priorTermLabel: 'Term 1',
      prior: 88,
      current: 81,
      diff: -7,
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
    await screen.findByText(/nobody needs a look/i);
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
    stubFetchOnce(jsonResponse({ students: [] }));
    render();
    await open();
    expect(await screen.findByText('Nobody needs a look')).toBeInTheDocument();
    expect(
      screen.getByText(/has fallen 5 points or more/i)
    ).toBeInTheDocument();
  });
});

describe('a student who has slipped', () => {
  it('shows every subject that fell, under one name', async () => {
    stubFetchOnce(jsonResponse({ students: [FALLEN] }));
    render();
    await open();

    expect(
      await screen.findByRole('button', { name: 'Bautista, Joaquin P.' })
    ).toBeInTheDocument();
    expect(screen.getByText(/Mathematics/)).toBeInTheDocument();
    expect(screen.getByText(/Science/)).toBeInTheDocument();
    expect(screen.getByText(/91 → 78/)).toBeInTheDocument();
  });

  it('names the term the fall is measured from', async () => {
    stubFetchOnce(jsonResponse({ students: [FALLEN] }));
    render();
    await open();
    expect(await screen.findByText(/since Term 1/i)).toBeInTheDocument();
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
      await screen.findByRole('button', { name: 'Bautista, Joaquin P.' })
    );
    expect(await screen.findByText('Maricel Bautista')).toBeInTheDocument();
    expect(screen.getByText('87796901')).toBeInTheDocument();
  });

  it('goes back to the list without closing the panel', async () => {
    stubFetchOnce(jsonResponse({ students: [FALLEN] }));
    render();
    const user = await open();
    await user.click(
      await screen.findByRole('button', { name: 'Bautista, Joaquin P.' })
    );
    await user.click(
      await screen.findByRole('button', { name: /all students/i })
    );
    expect(await screen.findByText(/91 → 78/)).toBeInTheDocument();
  });
});
