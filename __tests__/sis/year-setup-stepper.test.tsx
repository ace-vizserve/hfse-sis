import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { YearSetupStepper } from '@/components/sis/year-setup/year-setup-stepper';
import { renderWithClient } from '../_utils/render-with-client';
import type { AyReadiness } from '@/lib/sis/readiness';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/sis/ay-setup',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/components/sis/term-dates-editor', () => ({
  TermDatesEditor: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('@/components/evaluation/virtue-themes-editor', () => ({
  VirtueThemesEditor: () => <div data-testid="virtue-editor" />,
}));
vi.mock('@/components/sis/generate-sheets-dialog', () => ({
  GenerateSheetsDialog: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('@/components/sis/ay-accepting-applications-toggle', () => ({
  AyAcceptingApplicationsToggle: () => (
    <button role="switch" aria-checked="false" aria-label="Toggle" />
  ),
}));
vi.mock('@/components/sis/year-setup/ay-picker', () => ({
  AyPicker: ({ selected }: { selected: string }) => (
    <div data-testid="ay-picker">{selected}</div>
  ),
}));

const READINESS: AyReadiness = {
  ayCode: 'AY2026',
  complete: 2,
  total: 7,
  steps: [
    {
      id: 'ay-setup',
      step: 1,
      label: 'Term Dates',
      description: 'All terms have start and end dates set',
      href: '/sis/ay-setup',
      status: 'done',
      required: true,
    },
    {
      id: 'calendar',
      step: 2,
      label: 'School Calendar',
      description: 'All terms have calendar coverage',
      href: '/sis/calendar',
      status: 'done',
      required: true,
    },
    {
      id: 'classes',
      step: 3,
      label: 'Classes',
      description: 'No sections created for this AY',
      href: '/sis/sections',
      status: 'not_started',
      required: true,
    },
    {
      id: 'advisers',
      step: 4,
      label: 'Form Advisers',
      description: '0 of 3 sections have a form adviser',
      href: '/sis/sections',
      status: 'not_started',
      required: true,
    },
    {
      id: 'grading-sheets',
      step: 5,
      label: 'Grading Sheets',
      description: '1 of 3 sections have grading sheets',
      href: '/markbook/sections',
      status: 'partial',
      required: true,
      fraction: { done: 1, total: 3 },
    },
    {
      id: 'virtue-themes',
      step: 6,
      label: 'Virtue Themes',
      description: '0 of 3 terms have a virtue theme set',
      href: '/evaluation/virtue-themes',
      status: 'not_started',
      required: true,
    },
    {
      id: 'letterhead',
      step: 7,
      label: 'Report Card Letterhead',
      description: 'Organization name is set',
      href: '/sis/admin/school-config',
      status: 'not_started',
      required: true,
    },
    {
      id: 'app-window',
      step: 8,
      label: 'Application Window',
      description: 'Applications are not open for this year',
      href: '/sis/ay-setup',
      status: 'not_started',
      required: false,
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
    ...overrides,
  } as never;
}

describe('YearSetupStepper', () => {
  it('shows the empty state when there is no selected AY', () => {
    renderWithClient(
      <YearSetupStepper
        ays={[]}
        selectedAy={null}
        selectedTerms={[]}
        readiness={null}
      />
    );
    expect(screen.getByText('No academic year yet')).toBeInTheDocument();
  });

  it('renders the step rail with all 8 step labels', () => {
    renderWithClient(
      <YearSetupStepper
        ays={PICKER_AYS}
        selectedAy={makeAy()}
        selectedTerms={[]}
        readiness={READINESS}
      />
    );
    expect(screen.getByText('Term Dates')).toBeInTheDocument();
    expect(screen.getByText('School Calendar')).toBeInTheDocument();
    expect(screen.getByText('Classes')).toBeInTheDocument();
    expect(screen.getByText('Form Advisers')).toBeInTheDocument();
    expect(screen.getByText('Grading Sheets')).toBeInTheDocument();
    expect(screen.getByText('Virtue Themes')).toBeInTheDocument();
    expect(screen.getByText('Report Card Letterhead')).toBeInTheDocument();
    expect(screen.getByText('Application Window')).toBeInTheDocument();
  });

  it('opens on the first incomplete required step (classes)', () => {
    renderWithClient(
      <YearSetupStepper
        ays={PICKER_AYS}
        selectedAy={makeAy()}
        selectedTerms={[]}
        readiness={READINESS}
      />
    );
    // The active panel header shows the step label
    expect(
      screen.getByRole('heading', { name: 'Classes' })
    ).toBeInTheDocument();
  });

  it('shows the resume button when not all required steps are done', () => {
    renderWithClient(
      <YearSetupStepper
        ays={PICKER_AYS}
        selectedAy={makeAy()}
        selectedTerms={[]}
        readiness={READINESS}
      />
    );
    expect(screen.getByRole('button', { name: /Resume/i })).toBeInTheDocument();
  });

  it('shows "Edit term dates" button when ay-setup step is active', () => {
    const allDoneReadiness: AyReadiness = {
      ...READINESS,
      steps: READINESS.steps.map((s) =>
        s.id === 'ay-setup' ? { ...s, status: 'not_started' } : s
      ),
      complete: 0,
    };
    renderWithClient(
      <YearSetupStepper
        ays={PICKER_AYS}
        selectedAy={makeAy()}
        selectedTerms={[]}
        readiness={allDoneReadiness}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Edit term dates' })
    ).toBeInTheDocument();
  });

  it('shows "Optional" status badge for the app-window step', () => {
    const appWindowActive: AyReadiness = {
      ...READINESS,
      steps: READINESS.steps.map((s) =>
        s.id !== 'app-window' ? { ...s, status: 'done' } : s
      ),
      complete: 7,
    };
    renderWithClient(
      <YearSetupStepper
        ays={PICKER_AYS}
        selectedAy={makeAy()}
        selectedTerms={[]}
        readiness={appWindowActive}
      />
    );
    // app-window is the only remaining step and it's optional
    expect(screen.getByText('Optional')).toBeInTheDocument();
  });

  it('shows the readiness progress fraction', () => {
    renderWithClient(
      <YearSetupStepper
        ays={PICKER_AYS}
        selectedAy={makeAy()}
        selectedTerms={[]}
        readiness={READINESS}
      />
    );
    expect(screen.getByText('2 / 7 ready')).toBeInTheDocument();
  });
});
