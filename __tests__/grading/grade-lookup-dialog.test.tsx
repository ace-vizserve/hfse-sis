/**
 * The subject teacher's "Look up student" panel.
 *
 * This component had no test at all until 2026-08-21, which is how a term
 * picker and a caption naming one term survived alongside a request to see the
 * whole year. It takes plain props and fetches nothing, so nothing here needs
 * a stubbed request — only the shape of what a teacher can read off the screen.
 */

import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  GradeLookupDialog,
  type StudentAlertRow,
} from '@/components/grading/grade-lookup-dialog';

/** A fall across two earlier terms, so the all-terms view has something to show. */
const FALLEN: StudentAlertRow = {
  entryId: 'e-2',
  indexNumber: 2,
  studentName: 'Bautista, Joaquin P.',
  withdrawn: false,
  currentGrade: 78,
  comparisons: [
    {
      term_label: 'Term 1',
      term_number: 1,
      prior_grade: 91,
      diff: -13,
      flagged: true,
      metric: 'quarterly',
      metric_label: 'Term grade',
    },
    {
      term_label: 'Term 2',
      term_number: 2,
      prior_grade: 86,
      diff: -8,
      flagged: true,
      metric: 'quarterly',
      metric_label: 'Term grade',
    },
    {
      term_label: 'Term 1',
      term_number: 1,
      prior_grade: 88,
      diff: -7,
      flagged: true,
      metric: 'ww',
      metric_label: 'Written work',
      prior_scored: 44,
      prior_max: 50,
    },
    {
      term_label: 'Term 2',
      term_number: 2,
      prior_grade: 84,
      diff: -3,
      flagged: false,
      metric: 'ww',
      metric_label: 'Written work',
      prior_scored: 42,
      prior_max: 50,
    },
  ],
  currentMarks: { ww: { scored: 48.6, max: 60 } },
  outliers: [
    {
      label: 'Performance task 1',
      score: 11,
      max: 20,
      pct: 55,
      othersMeanPct: 68,
    },
  ],
};

const STEADY: StudentAlertRow = {
  entryId: 'e-5',
  indexNumber: 5,
  studentName: 'Flores, Miguel A.',
  withdrawn: false,
  currentGrade: 85,
  comparisons: [
    {
      term_label: 'Term 2',
      term_number: 2,
      prior_grade: 84,
      diff: 1,
      flagged: false,
      metric: 'quarterly',
      metric_label: 'Term grade',
    },
  ],
  outliers: [],
};

const GONE: StudentAlertRow = {
  entryId: 'e-9',
  indexNumber: 9,
  studentName: 'Reyes, Carmela D.',
  withdrawn: true,
  currentGrade: null,
  comparisons: [],
  outliers: [],
};

function renderDialog(rows: StudentAlertRow[] = [FALLEN, STEADY, GONE]) {
  return render(
    <GradeLookupDialog
      rows={rows}
      currentTermLabel="Term 3"
      weights={{ ww: 30, pt: 50, qa: 20 }}
    />
  );
}

async function open() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /look up student/i }));
  return user;
}

describe('the trigger reports without being opened', () => {
  it('carries the count of students who need a look', async () => {
    renderDialog();
    expect(
      screen.getByRole('button', { name: /look up student/i })
    ).toHaveTextContent('1');
  });

  it('carries no count when the sheet is clean', () => {
    renderDialog([STEADY]);
    expect(
      screen.getByRole('button', { name: /look up student/i })
    ).not.toHaveTextContent(/\d/);
  });
});

describe('the list is the whole class', () => {
  it('lists every student in index order, flagged or not', async () => {
    renderDialog();
    await open();

    const names = screen
      .getAllByRole('button')
      .map((b) => b.textContent ?? '')
      .filter((t) => t.includes(', '));

    expect(names[0]).toContain('Bautista');
    expect(names[1]).toContain('Flores');
    expect(names[2]).toContain('Reyes');
  });

  it('does not split the class into headed groups', async () => {
    // Superseded by the filter: a teacher chooses what to see rather than
    // reading past a heading to find a specific student.
    renderDialog();
    await open();
    expect(screen.queryByText(/needs a look/i)).toBeNull();
    expect(screen.queryByText(/everyone else/i)).toBeNull();
  });

  it('narrows to the flagged students on request', async () => {
    renderDialog();
    const user = await open();

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: /only flagged/i }));

    expect(screen.getByText(/Bautista/)).toBeInTheDocument();
    expect(screen.queryByText(/Flores/)).toBeNull();
    expect(screen.queryByText(/Reyes/)).toBeNull();
  });

  it('says which term the filter is about, so an empty list is not read as "never"', async () => {
    renderDialog();
    const user = await open();
    await user.click(screen.getByRole('combobox'));
    expect(
      screen.getByRole('option', { name: /only flagged/i })
    ).toHaveTextContent('Term 3');
  });

  it('still searches by name', async () => {
    renderDialog();
    const user = await open();
    await user.type(screen.getByPlaceholderText(/student name/i), 'flores');
    expect(screen.getByText(/Flores/)).toBeInTheDocument();
    expect(screen.queryByText(/Bautista/)).toBeNull();
  });
});

/** The marks table sits behind a fold — the charts answer first. */
async function openStudentAndMarks(
  user: ReturnType<typeof userEvent.setup>,
  name: RegExp
) {
  await user.click(screen.getByText(name));
  await user.click(screen.getByText(/the marks behind it/i));
  return screen.getByRole('table', { name: /marks, by term and component/i });
}

describe('a student shows their whole year', () => {
  it('shows every term, not one chosen comparison', async () => {
    renderDialog();
    const user = await open();
    const table = await openStudentAndMarks(user, /Bautista/);

    expect(within(table).getAllByText('Term 1').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('Term 2').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('Term 3').length).toBeGreaterThan(0);

    // 91 → 86 → 78 all present at once, not one chosen pair.
    expect(within(table).getByText('91')).toBeInTheDocument();
    expect(within(table).getByText('86')).toBeInTheDocument();
    expect(within(table).getByText('78')).toBeInTheDocument();
  });

  it('shows each term the change from the term before it', async () => {
    renderDialog();
    const user = await open();
    const table = await openStudentAndMarks(user, /Bautista/);

    // 91 → 86 is −5, 86 → 78 is −8. Neither is the stored diff-vs-current.
    expect(within(table).getByText('−5')).toBeInTheDocument();
    expect(within(table).getByText('−8')).toBeInTheDocument();
  });

  it('leaves the term grade without a score or a total', async () => {
    // A term grade is weighted out of 100. Giving it a denominator would be
    // inventing one, so those two cells stay empty on purpose.
    renderDialog();
    const user = await open();
    const table = await openStudentAndMarks(user, /Bautista/);
    // Term 2's row, not Term 1's — Term 1 has a third dash under Change,
    // because there is no earlier term to measure it from.
    const gradeRow = within(table).getByText('86').closest('tr');
    expect(gradeRow).not.toBeNull();
    expect(within(gradeRow as HTMLElement).getAllByText('—')).toHaveLength(2);
  });

  it('says what a percentage is a percentage of, in its own columns', async () => {
    // "84%" on its own is unreadable next to a sheet full of raw marks, and
    // the paper's total can change between terms — so Score and Out of get
    // their own columns beside it.
    renderDialog();
    const user = await open();
    const table = await openStudentAndMarks(user, /Bautista/);

    expect(within(table).getByText('44')).toBeInTheDocument();
    expect(within(table).getByText('42')).toBeInTheDocument();
    // This term's marks come off the sheet being marked, not the prior-term map.
    expect(within(table).getByText('48.6')).toBeInTheDocument();
    expect(within(table).getAllByText('50').length).toBeGreaterThan(0);
  });

  it('marks a total that changed, because the score stops being comparable', async () => {
    renderDialog();
    const user = await open();
    const table = await openStudentAndMarks(user, /Bautista/);
    // Written work went from 50 marks to 60 in Term 3.
    expect(
      within(table).getByLabelText(/total changed this term/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/the paper changed size that term/i)
    ).toBeInTheDocument();
  });

  it('has no compare-against picker any more', async () => {
    renderDialog();
    const user = await open();
    await user.click(screen.getByText(/Bautista/));
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByText(/^vs Term/)).toBeNull();
    expect(screen.queryByText(/compared with term/i)).toBeNull();
  });

  it('keeps the single assessment that stands out on this sheet', async () => {
    renderDialog();
    const user = await open();
    await user.click(screen.getByText(/Bautista/));
    expect(screen.getByText(/Performance task 1/)).toBeInTheDocument();
    expect(screen.getByText(/11 out of 20/)).toBeInTheDocument();
  });

  it('names the term a change is measured from', async () => {
    renderDialog();
    const user = await open();
    await user.click(screen.getByText(/Flores/));
    // Flores rose a point since Term 2 — the headline says which term, so the
    // figure is never a change from nowhere in particular.
    expect(screen.getByText(/since Term 2/i)).toBeInTheDocument();
  });

  it('goes back to the list without closing the panel', async () => {
    renderDialog();
    const user = await open();
    await user.click(screen.getByText(/Bautista/));
    await user.click(screen.getByRole('button', { name: /all students/i }));
    expect(screen.getByText(/Flores/)).toBeInTheDocument();
  });
});
