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
vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const LEVELS = [
  { id: 'lvl-1', code: 'P1', label: 'Primary 1' },
  { id: 'lvl-2', code: 'P2', label: 'Primary 2' },
];

const ROWS: UnmatchedLevelLabel[] = [
  {
    rawLabel: 'Grade One',
    canonicalLabel: 'grade one',
    ayCodes: ['AY2026'],
    appsCount: 3,
    statusCount: 1,
    sampleEnrolees: ['E-0001', 'E-0002'],
  },
  {
    rawLabel: 'Yr 2',
    canonicalLabel: 'yr 2',
    ayCodes: ['AY2027'],
    appsCount: 2,
    statusCount: 0,
    sampleEnrolees: [],
  },
];

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
