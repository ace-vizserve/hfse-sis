/**
 * Behavior test for the level-mismatches reconciliation queue after its
 * migration onto the shared <DataTable> shell (data-table redesign roadmap
 * step 5). Covers what the migration changed (search, empty state) and
 * what it preserved verbatim (the per-row select-a-level + Save mutation).
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LevelMismatchesTable } from '@/components/sis/level-mismatches-table';
import type { UnmatchedLevelLabel } from '@/lib/sis/level-review';
import { renderWithClient } from '../_utils/render-with-client';
import { jsonResponse, stubFetch } from '../_utils/mock-fetch';

const { refreshMock, toastSuccess, toastError } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock, replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/records/level-mismatches',
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

const LEVELS = [
  { id: 'lvl-1', code: 'P1', label: 'Primary 1' },
  { id: 'lvl-2', code: 'P2', label: 'Primary 2' },
];

// Both rows BLOCK someone, so both sit on the default "Blocking a student"
// tab — the assertions below are about search, mapping and error handling,
// and shouldn't have to think about which tab they are on. The tab split
// itself is covered in its own describe block at the bottom.
const ROWS: UnmatchedLevelLabel[] = [
  {
    rawLabel: 'Grade One',
    canonicalLabel: 'grade one',
    ayCodes: ['AY2026'],
    appsCount: 3,
    statusCount: 1,
    sampleEnrolees: ['E-0001', 'E-0002'],
    blockedCount: 2,
  },
  {
    rawLabel: 'Yr 2',
    canonicalLabel: 'yr 2',
    ayCodes: ['AY2027'],
    appsCount: 2,
    statusCount: 0,
    sampleEnrolees: [],
    blockedCount: 1,
  },
];

/** Unrecognized, but every student behind it is unenrolled or already placed. */
const QUIET_ROW: UnmatchedLevelLabel = {
  rawLabel: 'Youngstarters | Senior Stars',
  canonicalLabel: 'youngstarters | senior stars',
  ayCodes: ['AY2026'],
  appsCount: 7,
  statusCount: 7,
  sampleEnrolees: ['E260420'],
  blockedCount: 0,
};

describe('LevelMismatchesTable', () => {
  it('renders every unresolved label with its row count', () => {
    renderWithClient(<LevelMismatchesTable rows={ROWS} levels={LEVELS} />);
    expect(screen.getByText('Grade One')).toBeInTheDocument();
    expect(screen.getByText('Yr 2')).toBeInTheDocument();
    expect(screen.getByText('4 rows')).toBeInTheDocument(); // 3 + 1
    expect(screen.getByText('2 rows')).toBeInTheDocument(); // 2 + 0
  });

  it('search narrows to matching labels', async () => {
    const user = userEvent.setup();
    renderWithClient(<LevelMismatchesTable rows={ROWS} levels={LEVELS} />);

    await user.type(
      screen.getByPlaceholderText(/search label or enrolee/i),
      'Grade'
    );

    expect(screen.getByText('Grade One')).toBeInTheDocument();
    expect(screen.queryByText('Yr 2')).not.toBeInTheDocument();
  });

  it('shows the empty state when there are no unresolved labels', () => {
    renderWithClient(<LevelMismatchesTable rows={[]} levels={LEVELS} />);
    expect(screen.getByText('No unresolved level names.')).toBeInTheDocument();
  });

  it('saves the chosen mapping and refreshes on success', async () => {
    const user = userEvent.setup();
    const fetchSpy = stubFetch(() =>
      Promise.resolve(jsonResponse({ ok: true }))
    );

    renderWithClient(<LevelMismatchesTable rows={ROWS} levels={LEVELS} />);

    // Open the "Maps to…" select for the "Grade One" row and pick Primary 1.
    const triggers = screen.getAllByRole('combobox');
    await user.click(triggers[0]);
    await user.click(await screen.findByText('Primary 1'));

    const saveButtons = screen.getAllByRole('button', { name: /save/i });
    await user.click(saveButtons[0]);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain('/api/sis/level-aliases');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      fromLabel: 'Grade One',
      toLevelId: 'lvl-1',
    });

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalledWith(
      'Mapped "Grade One" — this label now resolves automatically.'
    );
  });

  it('surfaces the route-specific error and does not refresh', async () => {
    const user = userEvent.setup();
    stubFetch(() =>
      Promise.resolve(jsonResponse({ error: 'level_not_found' }, 422))
    );

    renderWithClient(<LevelMismatchesTable rows={ROWS} levels={LEVELS} />);

    const triggers = screen.getAllByRole('combobox');
    await user.click(triggers[0]);
    await user.click(await screen.findByText('Primary 1'));
    await user.click(screen.getAllByRole('button', { name: /save/i })[0]);

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('level_not_found')
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

// The regression these exist for: on 2026-09-22 six Youngstarters variants
// were mapped, saved correctly, and moved nobody — all 23 children behind
// them were still `Submitted`. The queue had shown them at the same weight as
// a name genuinely holding up an enrolled student, so a working save looked
// broken.
describe('LevelMismatchesTable — blocking vs housekeeping', () => {
  it('opens on the names that are blocking someone and hides the rest', () => {
    renderWithClient(
      <LevelMismatchesTable rows={[...ROWS, QUIET_ROW]} levels={LEVELS} />
    );

    expect(screen.getByText('Grade One')).toBeInTheDocument();
    expect(
      screen.queryByText('Youngstarters | Senior Stars')
    ).not.toBeInTheDocument();
  });

  it('shows a name nobody is waiting on under its own tab', async () => {
    const user = userEvent.setup();
    renderWithClient(
      <LevelMismatchesTable rows={[...ROWS, QUIET_ROW]} levels={LEVELS} />
    );

    await user.click(screen.getByRole('tab', { name: /nobody waiting/i }));

    expect(
      await screen.findByText('Youngstarters | Senior Stars')
    ).toBeInTheDocument();
    expect(screen.queryByText('Grade One')).not.toBeInTheDocument();
  });

  it('says how many students each name is holding up', () => {
    renderWithClient(<LevelMismatchesTable rows={ROWS} levels={LEVELS} />);

    // Read the number out of the badge itself. A bare getByText('2') matches
    // the tab count chip and the "rows" column too — the point here is the
    // count of PEOPLE, which is a different number sitting right beside them.
    const waitingLabels = screen.getAllByText('waiting');
    expect(waitingLabels).toHaveLength(2);
    expect(
      waitingLabels.map(
        (el) => el.parentElement?.querySelector('.tabular-nums')?.textContent
      )
    ).toEqual(['2', '1']);
  });

  it('renders a dash, not a zero, when nobody is waiting', async () => {
    const user = userEvent.setup();
    renderWithClient(
      <LevelMismatchesTable rows={[...ROWS, QUIET_ROW]} levels={LEVELS} />
    );

    await user.click(screen.getByRole('tab', { name: /nobody waiting/i }));

    await screen.findByText('Youngstarters | Senior Stars');
    expect(screen.queryByText('waiting')).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('still offers Save on a name nobody is waiting on', async () => {
    const user = userEvent.setup();
    renderWithClient(
      <LevelMismatchesTable rows={[QUIET_ROW]} levels={LEVELS} />
    );

    await user.click(screen.getByRole('tab', { name: /nobody waiting/i }));
    await screen.findByText('Youngstarters | Senior Stars');

    // Mapping it is correct housekeeping — the split changes which tab it
    // sits on, never whether it can be resolved.
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
  });
});
