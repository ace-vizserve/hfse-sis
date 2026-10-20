import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HomeHeaderActions } from '@/components/home/home-header-actions';

describe('HomeHeaderActions', () => {
  it('shows Account and a More menu holding every quick action as a link', async () => {
    const user = userEvent.setup();
    render(
      <HomeHeaderActions
        actions={[
          { label: 'Enter grades', href: '/markbook/grading' },
          { label: 'Mark attendance', href: '/attendance/sections' },
        ]}
      />
    );
    expect(screen.getByRole('link', { name: /Account/ })).toHaveAttribute(
      'href',
      '/account'
    );
    // No primary on the home header — both buttons are outline.
    expect(
      screen.getByRole('link', { name: /Account/ }).className
    ).not.toContain('shadow-button');
    await user.click(screen.getByRole('button', { name: /More/ }));
    expect(
      await screen.findByRole('menuitem', { name: 'Enter grades' })
    ).toHaveAttribute('href', '/markbook/grading');
    expect(
      screen.getByRole('menuitem', { name: 'Mark attendance' })
    ).toHaveAttribute('href', '/attendance/sections');
  });

  it('shows Account only when the role has no quick actions', () => {
    render(<HomeHeaderActions actions={[]} />);
    expect(screen.getByRole('link', { name: /Account/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /More/ })).toBeNull();
  });
});
