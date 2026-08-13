/**
 * The `Button` primitive — first tests it has had.
 *
 * It grew a `loading` prop so the four in-flight idioms that had accumulated
 * across 83 files could collapse onto one (09a-design-patterns.md:210 —
 * reusable treatment belongs in the variant, not at the call site). These
 * tests pin the contract that ~107 call sites are about to depend on, and the
 * base variant classes, which are easy to break by editing the cva string.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from '@/components/ui/button';

describe('Button', () => {
  it('renders a plain button with no spinner by default', () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeEnabled();
    expect(button.querySelector('svg')).toBeNull();
    expect(button).not.toHaveAttribute('aria-busy');
  });

  describe('loading', () => {
    it('shows a spinner, marks the button busy and disables it', () => {
      render(<Button loading>Save</Button>);
      const button = screen.getByRole('button');
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-busy', 'true');
      // The spinner is decorative — aria-busy is what a screen reader hears.
      const spinner = button.querySelector('svg');
      expect(spinner).not.toBeNull();
      expect(spinner).toHaveAttribute('aria-hidden', 'true');
      expect(spinner?.getAttribute('class')).toContain('animate-spin');
    });

    it('keeps the label when no loadingText is given', () => {
      render(<Button loading>Save</Button>);
      expect(screen.getByRole('button')).toHaveTextContent('Save');
    });

    it('swaps the label for loadingText while loading', () => {
      render(
        <Button loading loadingText="Saving…">
          Save
        </Button>
      );
      const button = screen.getByRole('button');
      expect(button).toHaveTextContent('Saving…');
      expect(button).not.toHaveTextContent('Save');
    });

    it('restores the label once loading ends', () => {
      const { rerender } = render(
        <Button loading loadingText="Saving…">
          Save
        </Button>
      );
      rerender(<Button loadingText="Saving…">Save</Button>);
      const button = screen.getByRole('button');
      expect(button).toHaveTextContent('Save');
      expect(button).toBeEnabled();
      expect(button.querySelector('svg')).toBeNull();
    });

    it('does not fire onClick while loading', async () => {
      const onClick = vi.fn();
      render(
        <Button loading onClick={onClick}>
          Save
        </Button>
      );
      // Deliberately dispatched rather than user-event: a disabled button
      // rejects the click, which is the behaviour being asserted.
      screen.getByRole('button').click();
      expect(onClick).not.toHaveBeenCalled();
    });

    it('stays disabled when disabled and loading disagree', () => {
      render(
        <Button disabled loading={false}>
          Save
        </Button>
      );
      expect(screen.getByRole('button')).toBeDisabled();
    });
  });

  describe('the parts other call sites depend on', () => {
    it('still renders through asChild', () => {
      render(
        <Button asChild>
          <a href="/somewhere">Go</a>
        </Button>
      );
      const link = screen.getByRole('link', { name: 'Go' });
      expect(link).toHaveAttribute('href', '/somewhere');
    });

    it('keeps the default variant gradient and shadow', () => {
      // Guards the cva string — 09a §7.2 forbids call sites overriding these,
      // so if they vanish from the base class nothing else restores them.
      render(<Button>Save</Button>);
      const cls = screen.getByRole('button').getAttribute('class') ?? '';
      expect(cls).toContain('shadow-button');
      expect(cls).toContain('bg-gradient-to-b');
    });

    it('merges a caller className without dropping variant classes', () => {
      render(<Button className="w-full">Save</Button>);
      const cls = screen.getByRole('button').getAttribute('class') ?? '';
      expect(cls).toContain('w-full');
      expect(cls).toContain('shadow-button');
    });
  });
});
