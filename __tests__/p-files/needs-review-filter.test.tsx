import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  DocumentCompletenessTable,
  type PFilesStatusFilter,
} from '@/components/shared/document-completeness-table';
import type { StudentCompleteness } from '@/lib/p-files/queries';

// Radix Tabs need real pointer events, and the table writes its filter to the
// URL — same two shims every other DataTable test uses.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/p-files',
  useSearchParams: () => new URLSearchParams(),
}));

function student(
  over: Partial<StudentCompleteness> & {
    enroleeNumber: string;
    fullName: string;
  }
): StudentCompleteness {
  return {
    studentNumber: null,
    level: 'Primary One',
    section: 'Patience',
    applicationStatus: 'Enrolled',
    total: 2,
    complete: 2,
    expired: 0,
    missing: 0,
    uploaded: 0,
    slots: [],
    ...over,
  };
}

// The three shapes that matter, and the third is the whole point of this file.
const ROWS: StudentCompleteness[] = [
  student({
    enroleeNumber: 'E-100',
    fullName: 'Uploaded Uma',
    uploaded: 1,
    complete: 1,
    slots: [
      {
        key: 'birthCert',
        label: 'Birth Certificate',
        status: 'uploaded',
        expiryDate: null,
      },
    ],
  }),
  student({
    enroleeNumber: 'E-200',
    fullName: 'Expired Eddie',
    expired: 1,
    complete: 1,
    slots: [
      {
        key: 'passport',
        label: 'Passport',
        status: 'expired',
        expiryDate: '2020-01-01',
      },
    ],
  }),
  // Nothing waiting for a decision. The dedicated validation queue emitted one
  // row per UPLOADED document, so this student produced no rows at all and no
  // search could match them — the defect this filter replaces.
  student({
    enroleeNumber: 'E-300',
    fullName: 'Settled Sam',
    slots: [
      {
        key: 'birthCert',
        label: 'Birth Certificate',
        status: 'valid',
        expiryDate: null,
      },
    ],
  }),
  // Not enrolled. The list carries applicants alongside students because both
  // share one documents row and one slot list.
  student({
    enroleeNumber: 'E-400',
    fullName: 'Applicant Ana',
    applicationStatus: 'Processing',
    section: null,
    uploaded: 1,
    complete: 1,
    slots: [
      {
        key: 'assessmentResult',
        label: 'Assessment Result and Interview',
        status: 'uploaded',
        expiryDate: null,
      },
    ],
  }),
];

function renderTable() {
  return render(<DocumentCompletenessTable module="p-files" students={ROWS} />);
}

function bodyText(): string {
  // Scope to the table body so a name appearing in a filter chip or the
  // column menu cannot be mistaken for a visible row.
  const table = screen.getByRole('table');
  return table.textContent ?? '';
}

describe('P-Files completeness table — Needs review filter', () => {
  it('offers a Needs review tab (P-Files used to expose only Lapsed)', () => {
    renderTable();
    expect(
      screen.getByRole('tab', { name: /Awaiting validation/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: /Lapsed \(re-upload needed\)/i })
    ).toBeInTheDocument();
  });

  it('narrows to students holding a document awaiting a decision', async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(screen.getByRole('tab', { name: /Awaiting validation/i }));

    await waitFor(() => {
      expect(bodyText()).toContain('Uploaded Uma');
    });
    expect(bodyText()).not.toContain('Expired Eddie');
    expect(bodyText()).not.toContain('Settled Sam');
  });

  it('still lists a student with nothing awaiting review, so they can be found', async () => {
    // THE REGRESSION GUARD. /p-files/document-validation could not do this:
    // its loader emitted rows per uploaded document, so a student with none
    // was absent from the table's data entirely and unsearchable — which is
    // how someone with an expired passport went missing from the very page
    // meant to surface them.
    renderTable();

    await waitFor(() => {
      expect(bodyText()).toContain('Settled Sam');
    });
    expect(bodyText()).toContain('Expired Eddie');
    expect(bodyText()).toContain('Uploaded Uma');
  });

  it('finds that student by name through the search box', async () => {
    const user = userEvent.setup();
    renderTable();

    await user.type(
      screen.getByPlaceholderText(/Search by name or number/i),
      'Settled'
    );

    await waitFor(() => {
      expect(bodyText()).toContain('Settled Sam');
    });
    expect(bodyText()).not.toContain('Uploaded Uma');
  });

  it('keeps Lapsed scoped to expiry, not to review', async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(
      screen.getByRole('tab', { name: /Lapsed \(re-upload needed\)/i })
    );

    await waitFor(() => {
      expect(bodyText()).toContain('Expired Eddie');
    });
    expect(bodyText()).not.toContain('Uploaded Uma');
  });
});

describe('P-Files completeness table — Enrolled vs Applicant', () => {
  it('renders a Type column with a tag per row', () => {
    renderTable();
    expect(
      screen.getByRole('columnheader', { name: /Type/i })
    ).toBeInTheDocument();

    const table = screen.getByRole('table');
    expect(within(table).getAllByText('Enrolled').length).toBeGreaterThan(0);
    expect(within(table).getByText('Applicant')).toBeInTheDocument();
  });

  it('tags anything outside the two enrolled statuses as Applicant', () => {
    // Withdrawn/Cancelled/Rejected read as Applicant on purpose — they are
    // enrolments that did not complete, and the exact stage lives on the file.
    render(
      <DocumentCompletenessTable
        module="p-files"
        students={[
          student({
            enroleeNumber: 'E-500',
            fullName: 'Withdrawn Wendy',
            applicationStatus: 'Withdrawn',
          }),
        ]}
      />
    );
    const table = screen.getByRole('table');
    expect(within(table).getByText('Applicant')).toBeInTheDocument();
  });

  it('offers a Type facet trigger in the toolbar', () => {
    renderTable();
    // Two buttons legitimately say "Type" — the facet trigger and the Columns
    // menu's entry for the same column. Asserting the trigger exists is the
    // point; driving the Radix popover open adds no coverage of our code.
    const trigger = screen
      .getAllByRole('button', { name: /Type/i })
      .find((b) => b.getAttribute('data-slot') === 'popover-trigger');
    expect(trigger).toBeDefined();
  });
});

// Guards the widened union itself — narrowing it back to 'all' | 'expired'
// is exactly what withheld this filter, and tsc would catch that here.
describe('PFilesStatusFilter', () => {
  it("accepts 'uploaded'", () => {
    const value: PFilesStatusFilter = 'uploaded';
    expect(value).toBe('uploaded');
  });
});
