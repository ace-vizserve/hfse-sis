import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AyReadinessPill } from '@/components/sis/ay-readiness-pill';
import type { AyReadiness } from '@/lib/sis/readiness';

const { usePathname } = vi.hoisted(() => ({
  usePathname: vi.fn(() => '/sis'),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname,
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => {
  usePathname.mockReturnValue('/sis');
});

const READINESS: AyReadiness = {
  ayCode: 'AY2026',
  complete: 2,
  total: 4,
  steps: [
    {
      id: 'ay-setup',
      step: 1,
      label: 'AY Setup',
      description: 'd',
      href: '/sis/ay-setup',
      status: 'done',
      required: true,
    },
    {
      id: 'calendar',
      step: 2,
      label: 'School Calendar',
      description: 'd',
      href: '/sis/calendar',
      status: 'done',
      required: true,
    },
    {
      id: 'classes',
      step: 3,
      label: 'Classes',
      description: 'd',
      href: '/sis/sections',
      status: 'not_started',
      required: true,
    },
    {
      id: 'grading-sheets',
      step: 4,
      label: 'Grading Sheets',
      description: 'd',
      href: '/markbook/sections',
      status: 'partial',
      fraction: { done: 1, total: 3 },
      required: true,
    },
  ],
};

describe('AyReadinessPill', () => {
  it('renders nothing for non-admin roles', () => {
    const { container } = render(
      <AyReadinessPill readiness={READINESS} role="teacher" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing on the Year Setup tab (the checklist replaces it there)', () => {
    usePathname.mockReturnValue('/sis/ay-setup');
    const { container } = render(
      <AyReadinessPill readiness={READINESS} role="superadmin" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('still renders on other /sis pages', () => {
    usePathname.mockReturnValue('/sis/calendar');
    const { container } = render(
      <AyReadinessPill readiness={READINESS} role="superadmin" />
    );
    expect(container).not.toBeEmptyDOMElement();
  });

  it('points every step Open button at the Year Setup control center', async () => {
    const user = userEvent.setup();
    render(<AyReadinessPill readiness={READINESS} role="superadmin" />);

    // The floating trigger has aria-label="Open year setup readiness"
    // /Year Setup/i matches that string case-insensitively.
    await user.click(screen.getByRole('button', { name: /Year Setup/i }));

    const openLinks = await screen.findAllByRole('link', { name: /Open/ });
    expect(openLinks.length).toBe(4);
    for (const link of openLinks) {
      expect(link.getAttribute('href')).toBe('/sis/ay-setup');
    }
  });
});
