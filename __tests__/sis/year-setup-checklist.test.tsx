import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { YearSetupChecklist } from '@/components/sis/year-setup/year-setup-checklist';
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
  complete: 5,
  total: 9,
  steps: [
    {
      id: 'ay-setup',
      step: 1,
      label: 'Term dates',
      description: 'All terms have start and end dates set',
      href: '/sis/ay-setup',
      status: 'done',
      required: true,
    },
    {
      id: 'calendar',
      step: 2,
      label: 'School calendar',
      description: 'All terms have calendar coverage',
      href: '/sis/calendar',
      status: 'done',
      required: true,
    },
    {
      id: 'sections',
      step: 3,
      label: 'Sections',
      description: 'Every grade level in use has at least one class section',
      href: '/sis/sections',
      status: 'done',
      required: true,
    },
    {
      id: 'subject-weights',
      step: 4,
      label: 'Subject weights',
      description: 'No classes created yet',
      href: '/sis/admin/subjects',
      status: 'not_started',
      required: true,
    },
    {
      id: 'advisers',
      step: 5,
      label: 'Form advisers',
      description: '0 of 3 sections have a form adviser',
      href: '/sis/sections',
      status: 'not_started',
      required: true,
    },
    {
      id: 'section-subjects',
      step: 6,
      label: 'Section subjects',
      description: '3 of 3 sections have subjects assigned',
      href: '/sis/sections',
      status: 'done',
      required: true,
    },
    {
      id: 'grading-sheets',
      step: 7,
      label: 'Grading sheets',
      description: '1 of 3 sections have grading sheets',
      href: '/markbook/sections',
      status: 'partial',
      required: true,
      fraction: { done: 1, total: 3 },
    },
    {
      id: 'virtue-themes',
      step: 8,
      label: 'Virtue themes',
      description: '0 of 3 terms have a virtue theme set',
      href: '/evaluation/virtue-themes',
      status: 'not_started',
      required: true,
    },
    {
      id: 'letterhead',
      step: 9,
      label: 'Report-card letterhead',
      description: 'Organization name is set',
      href: '/sis/admin/school-config',
      status: 'not_started',
      required: true,
    },
    {
      id: 'app-window',
      step: 10,
      label: 'Application window',
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
    counts: { terms: 4, sections: 0, subject_configs: 0, section_students: 0 },
    has_children: false,
    ...overrides,
  } as never;
}

const STEP_IDS = [
  'ay-setup',
  'calendar',
  'sections',
  'subject-weights',
  'advisers',
  'section-subjects',
  'grading-sheets',
  'virtue-themes',
  'letterhead',
  'app-window',
];

// Elements carrying the default-variant's unique `shadow-button` class
// (destructive/warning/success use `shadow-md`, outline `shadow-input`,
// ghost/link carry no shadow class at all) — queried directly against the DOM
// rather than via `getByRole('button')` because a few rows render their
// primary action as `<Button asChild><Link>…</Link></Button>`, which paints
// the button's classes onto an `<a>` (implicit role "link", not "button").
function defaultVariantElements(): Element[] {
  return Array.from(document.querySelectorAll('.shadow-button'));
}

describe('YearSetupChecklist', () => {
  it('shows the empty state when there is no selected AY', () => {
    renderWithClient(
      <YearSetupChecklist
        ays={[]}
        selectedAy={null}
        selectedTerms={[]}
        readiness={null}
      />
    );
    expect(screen.getByText('No academic year yet')).toBeInTheDocument();
  });

  it('renders all 10 checklist rows', () => {
    renderWithClient(
      <YearSetupChecklist
        ays={PICKER_AYS}
        selectedAy={makeAy()}
        selectedTerms={[]}
        readiness={READINESS}
      />
    );
    for (const id of STEP_IDS) {
      expect(screen.getByTestId(`checklist-row-${id}`)).toBeInTheDocument();
    }
  });

  it('does not duplicate the readiness fraction (that lives in the page header now)', () => {
    renderWithClient(
      <YearSetupChecklist
        ays={PICKER_AYS}
        selectedAy={makeAy()}
        selectedTerms={[]}
        readiness={READINESS}
      />
    );
    // The checklist previously rendered its own "N of M ready" progress bar,
    // duplicating the page header's badge with the same number (Von Restorff
    // — signal dilution). Layout redesign pass: removed, header is now the
    // one place this number renders.
    expect(screen.queryByText('2 of 7 ready')).not.toBeInTheDocument();
  });

  it('shows the Optional divider before the app-window row', () => {
    renderWithClient(
      <YearSetupChecklist
        ays={PICKER_AYS}
        selectedAy={makeAy()}
        selectedTerms={[]}
        readiness={READINESS}
      />
    );
    expect(screen.getByTestId('optional-divider')).toBeInTheDocument();
  });

  it('groups the 10 rows into 3 labeled clusters', () => {
    renderWithClient(
      <YearSetupChecklist
        ays={PICKER_AYS}
        selectedAy={makeAy()}
        selectedTerms={[]}
        readiness={READINESS}
      />
    );
    expect(screen.getByText('Core setup')).toBeInTheDocument();
    expect(screen.getByText('Grading & staffing')).toBeInTheDocument();
    expect(screen.getByText('Branding & admissions')).toBeInTheDocument();
  });

  it('renders exactly one default-variant (primary CTA) button — on the next-up row', () => {
    renderWithClient(
      <YearSetupChecklist
        ays={PICKER_AYS}
        selectedAy={makeAy()}
        selectedTerms={[]}
        readiness={READINESS}
      />
    );
    // First incomplete required step in READINESS is 'subject-weights'.
    const defaults = defaultVariantElements();
    expect(defaults).toHaveLength(1);
    const subjectWeightsRow = screen.getByTestId(
      'checklist-row-subject-weights'
    );
    expect(within(subjectWeightsRow).getByRole('button')).toBe(defaults[0]);
  });

  it('accents no row and shows the "All set" badge when every required item is done', () => {
    const allDone: AyReadiness = {
      ...READINESS,
      steps: READINESS.steps.map((s) =>
        s.required
          ? {
              ...s,
              status: 'done',
              fraction: s.fraction && {
                done: s.fraction.total,
                total: s.fraction.total,
              },
            }
          : s
      ),
      complete: 9,
    };
    renderWithClient(
      <YearSetupChecklist
        ays={PICKER_AYS}
        selectedAy={makeAy()}
        selectedTerms={[]}
        readiness={allDone}
      />
    );
    expect(defaultVariantElements()).toHaveLength(0);
    expect(
      screen.getByText(/All set for Academic Year 2026/)
    ).toBeInTheDocument();
  });

  it('expands the virtue-themes collapsible to show the editor', async () => {
    const user = userEvent.setup();
    const terms = [
      {
        id: 't1',
        academic_year_id: 'ay-id',
        term_number: 1,
        label: 'Term 1',
        start_date: '2026-01-06',
        end_date: '2026-03-21',
        is_current: true,
        virtue_theme: null,
        grading_lock_date: null,
      },
    ] as never;
    renderWithClient(
      <YearSetupChecklist
        ays={PICKER_AYS}
        selectedAy={makeAy()}
        selectedTerms={terms}
        readiness={READINESS}
      />
    );
    expect(screen.queryByTestId('virtue-editor')).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: /Set virtue themes/i })
    );
    expect(screen.getByTestId('virtue-editor')).toBeInTheDocument();
  });

  it('shows the "set term dates first" note when there are no Terms 1–3', async () => {
    const user = userEvent.setup();
    renderWithClient(
      <YearSetupChecklist
        ays={PICKER_AYS}
        selectedAy={makeAy()}
        selectedTerms={[]}
        readiness={READINESS}
      />
    );
    await user.click(
      screen.getByRole('button', { name: /Set virtue themes/i })
    );
    // The calendar row's own summary line reads the same "Set term dates
    // first." sentence with no dated terms — scope to the virtue-themes row
    // so this only asserts the dashed in-place note, not that coincidence.
    const virtueRow = screen.getByTestId('checklist-row-virtue-themes');
    expect(
      within(virtueRow).getByText('Set term dates first.')
    ).toBeInTheDocument();
  });
});
