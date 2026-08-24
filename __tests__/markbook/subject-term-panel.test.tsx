/**
 * The shared "Look up student" detail panel — one measure at a time.
 *
 * WHY THIS FILE EXISTS. `TrendChart` is a `next/dynamic` import with
 * `ssr: false`, so in jsdom it renders a skeleton and recharts never runs.
 * Every other test of this panel therefore proves the data arrives and nothing
 * about how it is drawn — which is how it once shipped with a caption promising
 * "all on one 0-100 scale" over charts that each auto-scaled to their own
 * series. Charts cannot be measured here, so the props that decide the scale
 * are asserted instead.
 *
 * The rest of the file guards the bargain the design rests on: the panel hides
 * three measures out of four, and that is only honest because the pills carry
 * the flags.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const charts: Record<string, unknown>[] = [];

vi.mock('@/components/dashboard/charts/trend-chart', () => ({
  TrendChart: (props: Record<string, unknown>) => {
    charts.push(props);
    return <div data-testid="trend-chart" data-label={String(props.label)} />;
  },
}));

import {
  SubjectTermPanel,
  type TermFigures,
} from '@/components/shared/subject-term-panel';

/**
 * Liam Caleb's real Mathematics marks, the case that settled the design: the
 * term grade barely moves while the exam collapses, because written work rose
 * and covered for it. Exactly what Koh Suat Hoon asked the system to surface.
 */
const REAL: TermFigures[] = [
  {
    label: 'Term 1 — AY2026',
    quarterly: 77,
    ww: 43.3,
    pt: 85,
    qa: 65.8,
    marks: {
      ww: { scored: 13, max: 30 },
      pt: { scored: 51, max: 60 },
      qa: { scored: 39.5, max: 60 },
    },
  },
  {
    label: 'Term 2 — AY2026',
    quarterly: 74,
    ww: 66.7,
    pt: 65,
    qa: 25,
    marks: {
      ww: { scored: 20, max: 30 },
      pt: { scored: 39, max: 60 },
      qa: { scored: 15, max: 60 },
    },
  },
];

/** One subject, one term — no trend to draw. */
const ONE_TERM: TermFigures[] = [
  {
    label: 'Term 1 — AY2026',
    quarterly: 87,
    ww: 95,
    pt: 100,
    qa: null,
    marks: { ww: { scored: 38, max: 40 }, pt: { scored: 10, max: 10 } },
  },
];

const WEIGHTS = { ww: 30, pt: 50, qa: 20 };

function renderPanel(terms = REAL, isExaminable = true) {
  return render(
    <SubjectTermPanel
      subject="Mathematics"
      isExaminable={isExaminable}
      terms={terms}
      weights={WEIGHTS}
    />
  );
}

/**
 * The measure selector is the app's segmented `Tabs`, so these are real tabs —
 * `role="tab"` and `aria-selected`, not toggle buttons.
 */
const pill = (name: RegExp) => screen.getByRole('tab', { name });

beforeEach(() => {
  charts.length = 0;
});

describe('the pills carry the flags', () => {
  it('flags a fall and leaves a rise unflagged, both showing their figure', async () => {
    renderPanel();
    // Exam −40.8 and performance tasks −20 are falls; written work rose 23.4.
    expect(
      within(pill(/Exam/)).getByLabelText(/fell this term/i)
    ).toBeInTheDocument();
    expect(
      within(pill(/Performance tasks/)).getByLabelText(/fell this term/i)
    ).toBeInTheDocument();
    expect(
      within(pill(/Written work/)).queryByLabelText(/fell this term/i)
    ).toBeNull();
    expect(pill(/Written work/)).toHaveTextContent('+23.4');
  });

  it('leaves a term grade inside the threshold quiet, which is the whole case', async () => {
    // 77 → 74 is −3. It does not flag, and underneath it the exam lost 40.8.
    renderPanel();
    expect(pill(/Term grade/)).toHaveTextContent('−3');
    expect(within(pill(/Term grade/)).queryByLabelText(/fell/i)).toBeNull();
    expect(pill(/Exam/)).toHaveTextContent('−40.8');
  });

  it('states the weight over the figure, not on the tab', async () => {
    // A tab is for choosing; the weight explains the figure it leads to.
    const user = userEvent.setup();
    renderPanel();
    expect(pill(/Written work/)).not.toHaveTextContent('30%');

    await user.click(pill(/Written work/));
    expect(screen.getByText(/30% of the term grade/)).toBeInTheDocument();
  });

  it('offers no pill for a component nobody has marked', async () => {
    renderPanel([
      { label: 'Term 1 — AY2026', quarterly: 90, ww: 90, pt: null, qa: null },
    ]);
    expect(screen.queryByRole('tab', { name: /Performance tasks/ })).toBeNull();
    expect(screen.queryByRole('tab', { name: /Exam/ })).toBeNull();
  });
});

describe('one measure drives the whole panel', () => {
  it('opens on the term grade', async () => {
    renderPanel();
    expect(pill(/Term grade/)).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('measure-headline')).toHaveTextContent('74');
  });

  it('moves the figure, the chart and the table together', async () => {
    const user = userEvent.setup();
    renderPanel();

    charts.length = 0;
    await user.click(pill(/Exam/));

    // The figure.
    expect(screen.getByTestId('measure-headline')).toHaveTextContent('25%');
    expect(screen.getByText('15 / 60')).toBeInTheDocument();
    expect(screen.getByText(/−40.8 since Term 1/)).toBeInTheDocument();

    // The chart — one, not four, and plotting the exam.
    expect(charts).toHaveLength(1);
    expect(charts[0].label).toBe('Exam');
    expect((charts[0].current as { y: number }[]).map((p) => p.y)).toEqual([
      65.8, 25,
    ]);

    // The table.
    const table = screen.getByRole('table', { name: /Exam, by term/i });
    expect(within(table).getByText('39.5')).toBeInTheDocument();
    expect(within(table).getByText('15')).toBeInTheDocument();
  });

  it('names the term a change is measured from, without the academic year', async () => {
    // The stored label is "Term 1 — AY2026"; the panel only ever shows one
    // year, so repeating it in a chip and on an axis is noise.
    renderPanel();
    expect(screen.getByText('−3 since Term 1')).toBeInTheDocument();
    expect(charts[0].current).toEqual([
      { x: 'Term 1', y: 77 },
      { x: 'Term 2', y: 74 },
    ]);
    // The table keeps it, where a reader may be copying a figure out.
    const table = screen.getByRole('table', { name: /Term grade, by term/i });
    expect(within(table).getByText('Term 1 — AY2026')).toBeInTheDocument();
  });
});

describe('the chart', () => {
  it('is pinned to a fixed 0-100 scale on every measure', async () => {
    const user = userEvent.setup();
    renderPanel();
    for (const name of [/Written work/, /Performance tasks/, /Exam/]) {
      charts.length = 0;
      await user.click(pill(name));
      expect(charts[0].domain, `${String(name)} must not auto-scale`).toEqual([
        0, 100,
      ]);
    }
  });

  it('prints the value on each point, because a fixed scale makes small moves flat', async () => {
    renderPanel();
    expect(charts[0].showValues).toBe(true);
    expect(charts[0].ticks).toEqual([0, 50, 100]);
  });

  it('draws a fall in the destructive tone and a steady measure in the default', async () => {
    const user = userEvent.setup();
    renderPanel();
    expect(charts[0].tone).toBe('default'); // term grade, −3

    charts.length = 0;
    await user.click(pill(/Exam/));
    expect(charts[0].tone).toBe('fall');
  });

  it('draws nothing through a single term', async () => {
    renderPanel(ONE_TERM);
    expect(charts).toHaveLength(0);
    expect(
      screen.getByText(/one term is a point, not a trend/i)
    ).toBeInTheDocument();
  });

  it('draws nothing for a letter-graded term grade, which has no position on the scale', async () => {
    renderPanel(REAL, false);
    expect(charts).toHaveLength(0);
    expect(
      screen.getByText(/this subject is letter-graded, so there is no figure/i)
    ).toBeInTheDocument();
  });
});

describe('the marks table', () => {
  it('drops Score and Out of on the term grade rather than dashing them', async () => {
    renderPanel();
    const table = screen.getByRole('table', { name: /Term grade, by term/i });
    expect(
      within(table).queryByRole('columnheader', { name: /score/i })
    ).toBeNull();
    expect(
      within(table).queryByRole('columnheader', { name: /out of/i })
    ).toBeNull();
  });

  it('gives a component its Score and Out of columns back', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(pill(/Written work/));
    const table = screen.getByRole('table', { name: /Written work, by term/i });
    expect(
      within(table).getByRole('columnheader', { name: /score/i })
    ).toBeInTheDocument();
    expect(within(table).getByText('13')).toBeInTheDocument();
    expect(within(table).getAllByText('30').length).toBeGreaterThan(0);
  });

  it('never puts a points change against a letter band', async () => {
    renderPanel(REAL, false);
    const table = screen.getByRole('table', { name: /Term grade, by term/i });
    // Both rows show a band and an em-dash under Change — a band moving is not
    // a student falling three points.
    expect(within(table).getAllByText('—')).toHaveLength(2);
  });
});
