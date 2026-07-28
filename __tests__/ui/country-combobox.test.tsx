import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CountryCombobox } from '@/components/sis/country-combobox';

describe('CountryCombobox', () => {
  it('shows the placeholder when value is null', () => {
    render(<CountryCombobox value={null} onChange={() => {}} />);
    expect(screen.getByText(/select country/i)).toBeInTheDocument();
  });

  it('shows the current value on the trigger', () => {
    render(<CountryCombobox value="Philippines" onChange={() => {}} />);
    expect(screen.getByText('Philippines')).toBeInTheDocument();
  });

  it('searching and selecting a country calls onChange with its name', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CountryCombobox value={null} onChange={onChange} />);

    await user.click(screen.getByRole('combobox'));
    await user.type(
      screen.getByPlaceholderText(/search country/i),
      'Singapore'
    );
    await user.click(await screen.findByText('Singapore'));

    expect(onChange).toHaveBeenCalledWith('Singapore');
  });

  it('shows an off-list stored value as a selectable "(current)" item', async () => {
    const user = userEvent.setup();
    render(<CountryCombobox value="Not A Real Country" onChange={() => {}} />);

    await user.click(screen.getByRole('combobox'));

    expect(
      await screen.findByText('Not A Real Country (current)')
    ).toBeInTheDocument();
  });

  it('does not show a "(current)" item for an already-known value', async () => {
    const user = userEvent.setup();
    render(<CountryCombobox value="Philippines" onChange={() => {}} />);

    await user.click(screen.getByRole('combobox'));

    expect(screen.queryByText(/\(current\)/)).not.toBeInTheDocument();
  });

  it('shows a Clear option when a value is set, and calling it clears to null', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CountryCombobox value="Philippines" onChange={onChange} />);

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByText('Clear selection'));

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('does not show a Clear option when value is null', async () => {
    const user = userEvent.setup();
    render(<CountryCombobox value={null} onChange={() => {}} />);

    await user.click(screen.getByRole('combobox'));

    expect(screen.queryByText('Clear selection')).not.toBeInTheDocument();
  });
});
