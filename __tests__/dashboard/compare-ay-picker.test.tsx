/**
 * Behavior tests for CompareAyPicker.
 *
 * Strategy: Radix Select portals its listbox into the document body and
 * requires pointer-capture APIs. The vitest.setup.ts polyfill covers
 * hasPointerCapture / setPointerCapture / releasePointerCapture so opening
 * the select works. We use userEvent.click on the trigger to open the
 * dropdown, then click the desired option, and verify router.push is called
 * with the right query string.
 *
 * For the trigger-label test (value-mapping) we assert the trigger text
 * directly — no need to open the dropdown.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CompareAyPicker } from '@/components/dashboard/insights/compare-ay-picker';

// ── mocks ────────────────────────────────────────────────────────────────────

const { pushMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
}));

// useSearchParams is seeded with ay=AY2026 to prove param preservation.
const SEARCH_PARAMS = new URLSearchParams('ay=AY2026');

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/markbook/insights',
  useSearchParams: () => SEARCH_PARAMS,
}));

afterEach(() => {
  vi.clearAllMocks();
});

// ── helpers ──────────────────────────────────────────────────────────────────

const AY_CODES = ['AY2026', 'AY2025', 'AY2024'] as const;
const PRIMARY = 'AY2026';

function renderPicker(compareAy: string | null) {
  render(
    <CompareAyPicker
      primaryAy={PRIMARY}
      ayCodes={AY_CODES}
      compareAy={compareAy}
    />
  );
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('CompareAyPicker', () => {
  it('renders trigger label "None" when compareAy is null', () => {
    renderPicker(null);
    // The trigger contains "Compare against: None"
    expect(screen.getByText(/Compare against:/)).toBeInTheDocument();
    expect(screen.getByText('None')).toBeInTheDocument();
  });

  it('renders the selected compareAy in the trigger when one is set', () => {
    renderPicker('AY2025');
    // Radix Select renders the value in two places (trigger + hidden SelectValue
    // portal span). Use getAllByText and assert at least one is in the document.
    const matches = screen.getAllByText('AY2025');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('excludes primaryAy from the option list', async () => {
    const user = userEvent.setup();
    renderPicker(null);

    // Open the dropdown
    await user.click(screen.getByRole('combobox'));

    // AY2026 (primaryAy) should NOT appear as a selectable option
    // AY2025 and AY2024 SHOULD appear
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: 'AY2026' })).toBeNull();
      expect(
        screen.getByRole('option', { name: /AY2025/ })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('option', { name: /AY2024/ })
      ).toBeInTheDocument();
    });
  });

  it('calls router.push with compareAy= and preserves the ay= param when an AY is chosen', async () => {
    const user = userEvent.setup();
    renderPicker(null);

    await user.click(screen.getByRole('combobox'));

    await waitFor(() =>
      expect(screen.getByRole('option', { name: /AY2025/ })).toBeInTheDocument()
    );

    await user.click(screen.getByRole('option', { name: /AY2025/ }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));

    const pushedUrl: string = pushMock.mock.calls[0][0];
    const pushed = new URLSearchParams(pushedUrl.replace(/^\?/, ''));
    expect(pushed.get('compareAy')).toBe('AY2025');
    // The original ay=AY2026 param must be preserved
    expect(pushed.get('ay')).toBe('AY2026');
  });

  it('calls router.push with NO compareAy param when the sentinel "None" option is chosen', async () => {
    const user = userEvent.setup();
    // Start with a compareAy already set
    renderPicker('AY2025');

    await user.click(screen.getByRole('combobox'));

    await waitFor(() =>
      expect(
        screen.getByRole('option', { name: /None \(no comparison\)/i })
      ).toBeInTheDocument()
    );

    await user.click(
      screen.getByRole('option', { name: /None \(no comparison\)/i })
    );

    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));

    const pushedUrl: string = pushMock.mock.calls[0][0];
    const pushed = new URLSearchParams(pushedUrl.replace(/^\?/, ''));
    expect(pushed.has('compareAy')).toBe(false);
    // ay= param is still preserved
    expect(pushed.get('ay')).toBe('AY2026');
  });
});
