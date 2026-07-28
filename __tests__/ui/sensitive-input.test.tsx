import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SensitiveInput } from '@/components/sis/sensitive-input';

describe('SensitiveInput', () => {
  it('renders masked (type="password") by default', () => {
    render(<SensitiveInput value="E1234567" onChange={() => {}} />);
    const input = screen.getByDisplayValue('E1234567');
    expect(input).toHaveAttribute('type', 'password');
  });

  it('reveals the value as plain text when the toggle is clicked', async () => {
    const user = userEvent.setup();
    render(<SensitiveInput value="E1234567" onChange={() => {}} />);

    await user.click(screen.getByRole('button', { name: /show/i }));

    const input = screen.getByDisplayValue('E1234567');
    expect(input).toHaveAttribute('type', 'text');
  });

  it('toggling twice returns to masked', async () => {
    const user = userEvent.setup();
    render(<SensitiveInput value="E1234567" onChange={() => {}} />);

    await user.click(screen.getByRole('button', { name: /show/i }));
    await user.click(screen.getByRole('button', { name: /hide/i }));

    const input = screen.getByDisplayValue('E1234567');
    expect(input).toHaveAttribute('type', 'password');
  });

  it('calls onChange with the typed value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(
      <SensitiveInput value="" onChange={onChange} />
    );

    const input = container.querySelector('input');
    expect(input).not.toBeNull();
    await user.type(input as HTMLInputElement, 'X');

    expect(onChange).toHaveBeenCalledWith('X');
  });
});
