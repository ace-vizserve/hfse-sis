import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ModuleSidebar } from '@/components/module-sidebar';
import { SidebarProvider } from '@/components/ui/sidebar';

// Task V2 (SIS Admin visual pass) regression tests — the group-label cadence
// hint + per-item count chip are strictly additive: a labeled group WITHOUT
// `hint` must render the exact pre-change markup (bare label text, original
// className, no wrapper span), and an item without `countKey` must render no
// chip markup. The critical this guards against: applying the hint chrome
// (flex/items-baseline/justify-between + span wrapper) unconditionally would
// change every module's sidebar DOM shape and vertical alignment.

vi.mock('next/navigation', () => ({
  usePathname: () => '/records/students',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

// Passthrough — no supabase channels in jsdom.
vi.mock('@/lib/sidebar/use-realtime-badges', () => ({
  useRealtimeBadges: (
    _role: unknown,
    _userId: unknown,
    initial: Record<string, number>
  ) => initial,
}));

// Chrome the test doesn't exercise — header popover, ⌘K trigger, profile
// footer each pull in their own contexts/clients.
vi.mock('@/components/sis/command-palette', () => ({
  CommandPaletteTrigger: () => null,
}));
vi.mock('@/components/module-sidebar/sidebar-header', () => ({
  ModuleSidebarHeader: () => null,
}));
vi.mock('@/components/module-sidebar/sidebar-profile', () => ({
  SidebarProfile: () => null,
}));

// Fixture nav — one labeled group without a hint (the pre-change shape every
// module uses today) and one with a hint + a countKey item. Everything else
// from the real roles module is kept (types, ROUTE_ACCESS, etc.).
vi.mock('@/lib/auth/roles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/roles')>();
  return {
    ...actual,
    NAV_BY_MODULE: {
      ...actual.NAV_BY_MODULE,
      records: [
        {
          label: 'Plain group',
          items: [{ href: '/records/students', label: 'Students' }],
        },
        {
          label: 'Hinted group',
          hint: 'weekly',
          items: [
            {
              href: '/records/movements',
              label: 'Movements',
              countKey: 'sectionsCount',
            },
          ],
        },
      ],
    },
  };
});

function renderSidebar(counts?: Record<string, string>) {
  return render(
    <SidebarProvider>
      <ModuleSidebar
        module="records"
        role="p-file"
        email="test@hfse.test"
        userId="user-1"
        counts={counts}
      />
    </SidebarProvider>
  );
}

function groupLabelEl(text: string): HTMLElement {
  const el = screen.getByText(text).closest('[data-sidebar="group-label"]');
  expect(el).not.toBeNull();
  return el as HTMLElement;
}

describe('ModuleSidebar group-label hint + count chip (Task V2)', () => {
  it('renders a hint-less labeled group with the pre-change markup — no flex spread classes, no span wrapper', () => {
    renderSidebar();
    const label = groupLabelEl('Plain group');
    // Exact pre-change class additions only (git show 997786b7) — none of
    // the hint chrome may leak in.
    expect(label.className).not.toMatch(/items-baseline/);
    expect(label.className).not.toMatch(/justify-between/);
    expect(label.className).toMatch(/font-mono/);
    // Children shape: bare text node, no wrapper span.
    expect(label.querySelector('span')).toBeNull();
    expect(label.textContent).toBe('Plain group');
  });

  it('renders the cadence hint right-aligned inside a hinted group label', () => {
    renderSidebar();
    const label = groupLabelEl('Hinted group');
    expect(label.className).toMatch(/items-baseline/);
    expect(label.className).toMatch(/justify-between/);
    expect(label.textContent).toContain('weekly');
    // Label + hint are each span-wrapped in the hinted branch.
    expect(label.querySelectorAll('span')).toHaveLength(2);
  });

  it('renders the count chip for an item with countKey when counts supplies it', () => {
    renderSidebar({ sectionsCount: '28' });
    const link = screen.getByRole('link', { name: /Movements/ });
    const chip = link.querySelector('.font-mono');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toBe('28');
  });

  it('renders no chip markup for an item without countKey, and none at all when counts is omitted', () => {
    renderSidebar();
    // Item without countKey never chips.
    const students = screen.getByRole('link', { name: 'Students' });
    expect(students.querySelector('.font-mono')).toBeNull();
    // Item WITH countKey but no counts payload also renders no chip.
    const movements = screen.getByRole('link', { name: 'Movements' });
    expect(movements.querySelector('.font-mono')).toBeNull();
  });
});
