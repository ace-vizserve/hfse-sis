import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

import { EditFamilySheet } from '@/components/sis/edit-family-sheet';
import { renderWithClient } from '../_utils/render-with-client';

async function openSheet(parent: 'father' | 'mother' | 'guardian') {
  const user = userEvent.setup();
  renderWithClient(
    <EditFamilySheet
      ayCode="AY2026"
      enroleeNumber="ENR-1"
      parent={parent}
      initial={{
        [`${parent}Nationality`]: 'Philippines',
        [`${parent}Passport`]: 'E1234567',
      }}
    />
  );
  await user.click(screen.getByRole('button', { name: /^edit$/i }));
  return user;
}

describe.each(['father', 'mother', 'guardian'] as const)(
  'EditFamilySheet (%s) — new field kinds',
  (parent) => {
    it('renders Nationality as a combobox showing the current value', async () => {
      await openSheet(parent);
      const comboboxes = screen.getAllByRole('combobox');
      expect(
        comboboxes.some((el) => el.textContent?.includes('Philippines'))
      ).toBe(true);
    });

    it('renders Passport masked by default', async () => {
      await openSheet(parent);
      const input = screen.getByDisplayValue('E1234567');
      expect(input).toHaveAttribute('type', 'password');
    });
  }
);
