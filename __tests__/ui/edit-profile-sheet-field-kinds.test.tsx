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

  it('renders Gender as radio buttons, as the portal does', async () => {
    await openSheet();
    expect(screen.getByRole('radio', { name: 'Male' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Female' })).toBeInTheDocument();
  });

  it('shows an off-list "How did you hear" answer as Other with its words', async () => {
    const user = userEvent.setup();
    renderWithClient(
      <EditProfileSheet
        ayCode="AY2026"
        enroleeNumber="ENR-1"
        initial={{ howDidYouKnowAboutHFSEIS: 'A neighbour told us' }}
      />
    );
    await user.click(screen.getByRole('button', { name: /edit profile/i }));
    expect(
      screen.getByRole('radio', { name: 'Other (Please specify)' })
    ).toHaveAttribute('data-state', 'on');
    expect(screen.getByDisplayValue('A neighbour told us')).toBeInTheDocument();
  });

  it('opens the details box when a checklist condition is on file', async () => {
    const user = userEvent.setup();
    renderWithClient(
      <EditProfileSheet
        ayCode="AY2026"
        enroleeNumber="ENR-1"
        initial={{ allergies: true, allergyDetails: 'Peanuts' }}
      />
    );
    await user.click(screen.getByRole('button', { name: /edit profile/i }));
    expect(screen.getByRole('checkbox', { name: 'Allergies' })).toBeChecked();
    expect(screen.getByDisplayValue('Peanuts')).toBeInTheDocument();
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
