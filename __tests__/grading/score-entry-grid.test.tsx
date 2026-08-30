/**
 * First-score label gate — client wiring test (Task 4 of the first-score
 * label gate plan). Proves ScoreEntryGrid intercepts a slot's genuine first
 * score with FirstScoreLabelDialog, sends ONE combined PATCH (score +
 * slot_label) on confirm, and never gates a slot that's already scored
 * anywhere in the roster or already carries satisfying metadata.
 *
 * The commit-time gate reads savedRowsRef (server-confirmed state), NOT the
 * `wwScored`/`ptScored` arrays memoized on `rows` (which update optimistically
 * on every keystroke) — these tests exercise exactly that boundary: type +
 * blur (the real onCommit path), never assert on `wwScored`.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ScoreEntryGrid,
  type GradeRow,
} from '@/components/grading/score-entry-grid';
import { renderWithClient } from '../_utils/render-with-client';
import { jsonResponse, stubFetch } from '../_utils/mock-fetch';

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
// The grid now signals a debounced router.refresh() after each saved cell, so
// the "Graded n/N" stat card catches up without a manual reload. That needs an
// app-router context these tests don't render inside — same mock shape the
// other client-component suites use.
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock, replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/markbook/grading/sheet-1',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('sonner', async () => ({
  toast: {
    ...(await import('../_utils/mock-toast')).createToastMock(),
    success: toastSuccess,
    error: toastError,
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function makeRow(overrides: Partial<GradeRow> = {}): GradeRow {
  return {
    entry_id: 'e1',
    section_student_id: 'ss1',
    index_number: 1,
    student_name: 'Alice',
    student_number: 'S001',
    withdrawn: false,
    late_enrollee: false,
    is_na: false,
    ww_scores: [null],
    pt_scores: [null],
    qa_score: null,
    ww_ps: null,
    pt_ps: null,
    qa_ps: null,
    initial_grade: null,
    quarterly_grade: null,
    letter_grade: null,
    ...overrides,
  };
}

function alice(overrides: Partial<GradeRow> = {}): GradeRow {
  return makeRow({
    entry_id: 'e1',
    index_number: 1,
    student_name: 'Alice',
    student_number: 'S001',
    ...overrides,
  });
}

function bob(overrides: Partial<GradeRow> = {}): GradeRow {
  return makeRow({
    entry_id: 'e2',
    index_number: 2,
    student_name: 'Bob',
    student_number: 'S002',
    ...overrides,
  });
}

function okEntryResponse(
  overrides: Partial<{
    ww_scores: (number | null)[] | null;
    pt_scores: (number | null)[] | null;
    qa_score: number | null;
    ww_ps: number | null;
    pt_ps: number | null;
    qa_ps: number | null;
    initial_grade: number | null;
    quarterly_grade: number | null;
    letter_grade: string | null;
    is_na: boolean;
  }> = {}
) {
  return jsonResponse({
    entry: {
      ww_scores: null,
      pt_scores: null,
      qa_score: null,
      ww_ps: null,
      pt_ps: null,
      qa_ps: null,
      initial_grade: null,
      quarterly_grade: null,
      letter_grade: null,
      is_na: false,
      ...overrides,
    },
    computed: {},
  });
}

// # + Student | WW0 | PT0 | QA per row, in that order (1 WW slot, 1 PT slot).
function scoreInputs(container: HTMLElement): HTMLInputElement[] {
  return Array.from(container.querySelectorAll('input[type="number"]'));
}

function renderGrid(props: {
  rows: GradeRow[];
  slotLabels?: { ww?: unknown[]; pt?: unknown[]; qa?: string | null };
}) {
  return renderWithClient(
    <ScoreEntryGrid
      sheetId="sheet-1"
      wwTotals={[10]}
      ptTotals={[10]}
      qaTotal={30}
      wwWeight={0.4}
      ptWeight={0.4}
      qaWeight={0.2}
      readOnly={false}
      requireApproval={false}
      rows={props.rows}
      slotLabels={props.slotLabels as never}
    />
  );
}

async function typeAndBlur(input: HTMLInputElement, value: string) {
  const { fireEvent } = await import('@testing-library/react');
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

function getFirstScoreDialog() {
  return screen.queryByRole('dialog');
}

async function fillDescriptionAndSave(description: string) {
  const { fireEvent } = await import('@testing-library/react');
  fireEvent.change(screen.getByLabelText(/description/i), {
    target: { value: description },
  });
}

async function markOngoing() {
  const { fireEvent } = await import('@testing-library/react');
  fireEvent.click(screen.getByRole('checkbox', { name: /ongoing/i }));
}

async function clickSave() {
  const { fireEvent } = await import('@testing-library/react');
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: /^save$/i }));
}

async function clickCancel() {
  const { fireEvent } = await import('@testing-library/react');
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
}

describe('ScoreEntryGrid — first-score label gate', () => {
  it('typing the first WW score for a slot opens the label dialog, does not PATCH yet', async () => {
    const fetchSpy = stubFetch(() => Promise.resolve(okEntryResponse()));
    const { container } = renderGrid({ rows: [alice(), bob()] });

    const [aliceWw] = scoreInputs(container);
    await typeAndBlur(aliceWw, '8');

    // The dialog title uses the grid's own "W1"/"PT1"/"QA" shorthand (matches
    // the column header + the ActivityRow code chips) — deliberately distinct
    // from the server's internal "WW1"/"PT1" violation-message vocabulary
    // (entries-label-gate.test.ts asserts `body.slots` === ['WW1']), which is
    // an audit/error-body channel the teacher never sees on the happy path.
    await waitFor(() =>
      expect(
        screen.getByText(/label w1 before its first score/i)
      ).toBeInTheDocument()
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('dialog Save fires exactly one PATCH carrying both the score and slot_label', async () => {
    const fetchSpy = stubFetch(() => Promise.resolve(okEntryResponse()));
    const { container } = renderGrid({ rows: [alice(), bob()] });

    const [aliceWw] = scoreInputs(container);
    await typeAndBlur(aliceWw, '8');
    await screen.findByRole('dialog');

    await fillDescriptionAndSave('Worksheet 1');
    await markOngoing();
    await clickSave();

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/grading-sheets/sheet-1/entries/e1');
    expect(init).toEqual(expect.objectContaining({ method: 'PATCH' }));
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      ww_scores: [8],
      slot_label: {
        kind: 'ww',
        index: 0,
        meta: { label: 'Worksheet 1', date: 'Ongoing', page: '' },
      },
    });
    // Dialog closes after confirm.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('dialog Cancel fires no PATCH and the cell reverts to blank', async () => {
    const fetchSpy = stubFetch(() => Promise.resolve(okEntryResponse()));
    const { container } = renderGrid({ rows: [alice(), bob()] });

    const [aliceWw] = scoreInputs(container);
    await typeAndBlur(aliceWw, '8');
    await screen.findByRole('dialog');

    await clickCancel();

    expect(fetchSpy).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    expect(aliceWw.value).toBe('');
  });

  it('a slot already scored by another student in the roster never opens the dialog', async () => {
    const fetchSpy = stubFetch(() =>
      Promise.resolve(okEntryResponse({ ww_scores: [8] }))
    );
    // Bob already has a WW score for slot 0 — the slot is "grandfathered".
    const { container } = renderGrid({
      rows: [alice(), bob({ ww_scores: [10] })],
    });

    const [aliceWw] = scoreInputs(container);
    await typeAndBlur(aliceWw, '8');

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(getFirstScoreDialog()).not.toBeInTheDocument();
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ ww_scores: [8] });
    expect(body.slot_label).toBeUndefined();
  });

  // The "Graded n/N · % complete" card is computed by the page's server
  // component, so before this it sat at its page-load value while the teacher
  // filled the grid.
  //
  // The refresh used to be debounced, to coalesce a burst of cells into one
  // server render. It is not any more: the grid now goes inert for the
  // duration of a save (useWriteAction awaits the refresh before it reports
  // success), so there is no burst left to coalesce — one save, one refresh,
  // and the success toast lands only once the new numbers are really on
  // screen.
  it('refreshes the server-rendered stat cards as part of the save', async () => {
    refreshMock.mockClear();
    const fetchSpy = stubFetch(() =>
      Promise.resolve(okEntryResponse({ ww_scores: [8] }))
    );
    const { container } = renderGrid({
      rows: [alice(), bob({ ww_scores: [10] })],
    });

    const [aliceWw] = scoreInputs(container);
    await typeAndBlur(aliceWw, '8');
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    // The save reports itself through the standard lifecycle now, rather than
    // through the inline "Saving…" chip this replaced.
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Saved.'));
  });

  // A score grid is typed blind — tab, type, tab — so the failure to prevent
  // is a second cell being committed on top of an unresolved save. The grid
  // refuses it outright while one is in flight, and says so with `aria-busy`
  // for anyone who cannot see the blur.
  it('marks itself busy while a save is in flight, and releases when it lands', async () => {
    let release!: (v: Response) => void;
    stubFetch(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        })
    );
    const { container } = renderGrid({
      rows: [alice({ ww_scores: [5] }), bob({ ww_scores: [10] })],
    });
    const grid = container.querySelector('[aria-busy]') as HTMLElement;
    expect(grid.getAttribute('aria-busy')).toBe('false');

    const [aliceWw] = scoreInputs(container);
    await typeAndBlur(aliceWw, '8');

    await waitFor(() => expect(grid.getAttribute('aria-busy')).toBe('true'));
    expect(grid.className).toContain('pointer-events-none');

    release(okEntryResponse({ ww_scores: [8] }));
    await waitFor(() => expect(grid.getAttribute('aria-busy')).toBe('false'));
    expect(grid.className).not.toContain('pointer-events-none');
  });

  it('editing an existing non-null score on the same cell never opens the dialog', async () => {
    const fetchSpy = stubFetch(() =>
      Promise.resolve(okEntryResponse({ ww_scores: [7] }))
    );
    // Alice's own cell already carries a score — editing it is not a "first" score.
    const { container } = renderGrid({
      rows: [alice({ ww_scores: [5] }), bob()],
    });

    const [aliceWw] = scoreInputs(container);
    await typeAndBlur(aliceWw, '7');

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(getFirstScoreDialog()).not.toBeInTheDocument();
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ ww_scores: [7] });
    expect(body.slot_label).toBeUndefined();
  });

  it('a slot whose metadata already satisfies the rule commits the first score directly, no dialog', async () => {
    const fetchSpy = stubFetch(() =>
      Promise.resolve(okEntryResponse({ ww_scores: [8] }))
    );
    const { container } = renderGrid({
      rows: [alice(), bob()],
      slotLabels: {
        ww: [{ label: 'Worksheet 1', date: '2026-07-01', page: null }],
        pt: [],
        qa: null,
      },
    });

    const [aliceWw] = scoreInputs(container);
    await typeAndBlur(aliceWw, '8');

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(getFirstScoreDialog()).not.toBeInTheDocument();
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ ww_scores: [8] });
    expect(body.slot_label).toBeUndefined();
  });

  it('QA slot: same first-score gate, description-only dialog', async () => {
    const fetchSpy = stubFetch(() =>
      Promise.resolve(okEntryResponse({ qa_score: 25 }))
    );
    const { container } = renderGrid({ rows: [alice(), bob()] });

    // Per row: WW0, PT0, QA — index 2 is Alice's QA input.
    const inputs = scoreInputs(container);
    const aliceQa = inputs[2];
    await typeAndBlur(aliceQa, '25');

    await screen.findByRole('dialog');
    expect(
      screen.queryByLabelText(/date administered/i)
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/page/i)).not.toBeInTheDocument();

    await fillDescriptionAndSave('Quarterly Exam');
    await clickSave();

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/grading-sheets/sheet-1/entries/e1');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      qa_score: 25,
      slot_label: {
        kind: 'qa',
        index: null,
        meta: { label: 'Quarterly Exam' },
      },
    });
  });
});
