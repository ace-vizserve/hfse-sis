import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { YearSetupControlCenter } from '@/components/sis/year-setup/year-setup-control-center';
import { renderWithClient } from '../_utils/render-with-client';
import type { AyReadiness } from '@/lib/sis/readiness';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/sis/ay-setup',
  useSearchParams: () => new URLSearchParams(),
}));

const READINESS: AyReadiness = {
  ayCode: 'AY2026',
  complete: 2,
  total: 4,
  steps: [
    {
      id: 'ay-setup',
      step: 1,
      label: 'AY Setup',
      description: 'Academic year active with dated terms',
      href: '/sis/ay-setup',
      status: 'done',
    },
    {
      id: 'calendar',
      step: 2,
      label: 'School Calendar',
      description: 'All terms have calendar coverage',
      href: '/sis/calendar',
      status: 'done',
    },
    {
      id: 'sections',
      step: 3,
      label: 'Sections',
      description: 'No sections created for this AY',
      href: '/sis/sections',
      status: 'not_started',
    },
    {
      id: 'grading-sheets',
      step: 4,
      label: 'Grading Sheets',
      description: '1 of 3 sections have grading sheets',
      href: '/markbook/sections',
      status: 'partial',
      fraction: { done: 1, total: 3 },
    },
  ],
};

const PICKER_AYS = [
  { ayCode: 'AY2026', label: 'Academic Year 2026', isCurrent: true },
];

function makeAy(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ay-id',
    ay_code: 'AY2026',
    label: 'Academic Year 2026',
    is_current: true,
    accepting_applications: false,
    created_at: '2026-01-01',
    counts: {
      terms: 4,
      sections: 3,
      subject_configs: 10,
      section_students: 50,
    },
    has_children: true,
    ...overrides,
  } as never;
}

describe('YearSetupControlCenter', () => {
  it('shows the empty state when there is no selected AY', () => {
    renderWithClient(
      <YearSetupControlCenter
        ays={[]}
        selectedAy={null}
        selectedTerms={[]}
        readiness={null}
      />
    );
    expect(screen.getByText('No academic year yet')).toBeInTheDocument();
  });

  it('renders all four readiness steps with their status and the grading fraction', () => {
    renderWithClient(
      <YearSetupControlCenter
        ays={PICKER_AYS}
        selectedAy={makeAy()}
        selectedTerms={[]}
        readiness={READINESS}
      />
    );
    expect(screen.getByText('AY Setup')).toBeInTheDocument();
    expect(screen.getByText('School Calendar')).toBeInTheDocument();
    expect(screen.getByText('Sections')).toBeInTheDocument();
    expect(screen.getByText('Grading Sheets')).toBeInTheDocument();
    expect(screen.getAllByText('Ready').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Not started')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getByText('1/3 sections')).toBeInTheDocument();
  });

  it('inline-edits the AY Setup step and deep-links every other surface', () => {
    renderWithClient(
      <YearSetupControlCenter
        ays={PICKER_AYS}
        selectedAy={makeAy()}
        selectedTerms={[]}
        readiness={READINESS}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Edit term dates' })
    ).toBeInTheDocument();
    const hrefs = screen
      .getAllByRole('link', { name: /Open/ })
      .map((l) => l.getAttribute('href'));
    expect(hrefs).toEqual(
      expect.arrayContaining([
        '/sis/calendar',
        '/sis/sections',
        '/markbook/sections',
        '/evaluation/virtue-themes',
        '/sis/admin/template',
        '/sis/admin/school-config',
      ])
    );
  });

  it('renders the application-window toggle for the selected AY', () => {
    renderWithClient(
      <YearSetupControlCenter
        ays={PICKER_AYS}
        selectedAy={makeAy()}
        selectedTerms={[]}
        readiness={READINESS}
      />
    );
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });

  it('emphasizes the class-template link when the AY has no sections or subjects', () => {
    renderWithClient(
      <YearSetupControlCenter
        ays={PICKER_AYS}
        selectedAy={makeAy({
          counts: {
            terms: 4,
            sections: 0,
            subject_configs: 0,
            section_students: 0,
          },
        })}
        selectedTerms={[]}
        readiness={READINESS}
      />
    );
    expect(
      screen.getByText(/no sections or subjects yet/i)
    ).toBeInTheDocument();
  });
});
