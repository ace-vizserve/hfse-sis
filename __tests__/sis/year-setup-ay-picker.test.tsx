import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AyPicker } from '@/components/sis/year-setup/ay-picker';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/sis/ay-setup',
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => vi.clearAllMocks());

const AYS = [
  { ayCode: 'AY2026', label: 'Academic Year 2026', isCurrent: true },
  { ayCode: 'AY2027', label: 'Academic Year 2027', isCurrent: false },
];

describe('AyPicker', () => {
  it('shows the selected AY in the trigger', () => {
    render(<AyPicker ays={AYS} selected="AY2026" />);
    const matches = screen.getAllByText(/Academic Year 2026/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('navigates to /sis/ay-setup?ay=<code> when another AY is chosen', async () => {
    const user = userEvent.setup();
    render(<AyPicker ays={AYS} selected="AY2026" />);

    await user.click(screen.getByRole('combobox'));
    await waitFor(() =>
      expect(
        screen.getByRole('option', { name: /Academic Year 2027/ })
      ).toBeInTheDocument()
    );
    await user.click(
      screen.getByRole('option', { name: /Academic Year 2027/ })
    );

    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
    expect(pushMock).toHaveBeenCalledWith('/sis/ay-setup?ay=AY2027');
  });
});
