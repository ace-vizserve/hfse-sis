import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { EditProfileSheet } from '@/components/sis/edit-profile-sheet';
import { renderWithClient } from '../_utils/render-with-client';

async function openSheet() {
  const user = userEvent.setup();
  renderWithClient(
    <EditProfileSheet
      ayCode="AY2026"
      enroleeNumber="ENR-1"
      initial={{ nationality: 'Philippines', passportNumber: 'E1234567' }}
    />
  );
  await user.click(screen.getByRole('button', { name: /edit profile/i }));
  return user;
}

describe('EditProfileSheet — new field kinds', () => {
  it('renders Nationality as a combobox showing the current value', async () => {
    await openSheet();
    const comboboxes = screen.getAllByRole('combobox');
    expect(
      comboboxes.some((el) => el.textContent?.includes('Philippines'))
    ).toBe(true);
  });

  it('renders Passport number masked by default', async () => {
    await openSheet();
    const input = screen.getByDisplayValue('E1234567');
    expect(input).toHaveAttribute('type', 'password');
  });

  it('reveals Passport number when its toggle is clicked', async () => {
    const user = await openSheet();
    const toggles = screen.getAllByRole('button', { name: /show value/i });
    await user.click(toggles[0]);
    expect(screen.getByDisplayValue('E1234567')).toHaveAttribute(
      'type',
      'text'
    );
  });
});
