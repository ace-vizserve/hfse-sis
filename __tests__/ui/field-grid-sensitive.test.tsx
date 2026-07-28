import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FieldGrid } from '@/components/sis/field-grid';

describe('FieldGrid — sensitive fields', () => {
  it('masks a sensitive field by default', () => {
    render(
      <FieldGrid
        fields={[{ label: 'Passport', value: 'E1234567', sensitive: true }]}
      />
    );
    expect(screen.queryByText('E1234567')).not.toBeInTheDocument();
    expect(screen.getByText('••••••••')).toBeInTheDocument();
  });

  it('reveals the value when its toggle is clicked, without affecting other rows', async () => {
    const user = userEvent.setup();
    render(
      <FieldGrid
        fields={[
          { label: 'Passport', value: 'E1234567', sensitive: true },
          { label: 'Pass type', value: 'STP', sensitive: true },
        ]}
      />
    );

    const toggles = screen.getAllByRole('button', { name: /show/i });
    await user.click(toggles[0]);

    expect(screen.getByText('E1234567')).toBeInTheDocument();
    expect(screen.queryByText('STP')).not.toBeInTheDocument();
  });

  it('does not mask a non-sensitive field', () => {
    render(<FieldGrid fields={[{ label: 'First name', value: 'Grace' }]} />);
    expect(screen.getByText('Grace')).toBeInTheDocument();
  });

  it('shows the plain empty placeholder for an empty sensitive field, unmasked', () => {
    render(
      <FieldGrid
        fields={[{ label: 'Passport', value: null, sensitive: true }]}
      />
    );
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('••••••••')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /show/i })
    ).not.toBeInTheDocument();
  });
});
