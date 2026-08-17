// __tests__/ui/data-table-advanced-export-filtering.test.tsx
//
// Phase 3/4 of the advanced export sheet, end to end through the UI: a rule
// narrows the file, the count says so, and the limit applies last.
//
// The behaviour most worth pinning is the honesty layer. KD #162 recorded
// that the old sheet could silently disagree with the screen; this one is
// allowed to disagree — that is the point of filtering on a field you are
// not displaying — but it must SAY so, and the number it shows must be the
// number of rows that actually land in the file.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';

import { DataTable } from '@/components/ui/data-table';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/test',
  useSearchParams: () => new URLSearchParams(),
}));

type Row = { id: string; name: string; level: string };

const rows: Row[] = [
  { id: '1', name: 'Alpha', level: 'Primary One' },
  { id: '2', name: 'Bravo', level: 'Primary Two' },
  { id: '3', name: 'Charlie', level: 'Secondary One' },
];

const columns: ColumnDef<Row>[] = [
  { id: 'name', accessorKey: 'name', header: 'Student' },
  { id: 'level', accessorKey: 'level', header: 'Level' },
];

function captureCsv() {
  let text = '';
  vi.spyOn(URL, 'createObjectURL').mockImplementation(
    (obj: Blob | MediaSource) => {
      void (obj as Blob).text().then((t) => {
        text = t;
      });
      return 'blob:mock';
    }
  );
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  return () => text;
}

async function openSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /export csv/i }));
  await screen.findByText(/drag to set column order/i);
}

/**
 * Add one rule via the Add filter menu.
 *
 * Queries the menu's option role rather than its text — every field name
 * here is also a column header on the table behind the sheet, so a plain
 * text query matches two elements.
 */
async function addRule(
  user: ReturnType<typeof userEvent.setup>,
  fieldLabel: RegExp
) {
  await user.click(screen.getByRole('button', { name: /add filter/i }));
  await user.click(await screen.findByRole('option', { name: fieldLabel }));
}

const advanced = { filename: 'a.csv', advanced: true } as const;

describe('advanced export — filtering', () => {
  it('exports everything and stays calm before any rule is added', async () => {
    const user = userEvent.setup();
    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        csv={advanced}
      />
    );
    await openSheet(user);

    expect(
      await screen.findByRole('button', { name: /download 3 rows/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/exporting every row on screen/i)
    ).toBeInTheDocument();
  });

  it('does not blank the export while a rule is still unfinished', async () => {
    const user = userEvent.setup();
    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        csv={advanced}
      />
    );
    await openSheet(user);
    await addRule(user, /^Student$/);

    // A rule exists but has no value yet — the count must not collapse to 0.
    expect(screen.getByText(/1 rule/i)).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: /download 3 rows/i })
    ).toBeInTheDocument();
  });

  it('narrows the file once the rule has a value, and says it differs', async () => {
    const user = userEvent.setup();
    const getCsv = captureCsv();
    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        csv={advanced}
      />
    );
    await openSheet(user);
    await addRule(user, /^Student$/);

    await user.type(screen.getByRole('textbox', { name: /value/i }), 'alpha');

    // The button reports the narrowed count…
    expect(
      await screen.findByRole('button', { name: /download 1 row$/i })
    ).toBeInTheDocument();

    // …and the file matches it.
    await user.click(screen.getByRole('button', { name: /^download \d/i }));
    await waitFor(() => expect(getCsv()).not.toBe(''));
    const lines = getCsv().replace(/^﻿/, '').split('\n');
    expect(lines).toHaveLength(2); // header + one row
    expect(lines[1]).toContain('Alpha');
  });

  it('matches without regard to case', async () => {
    const user = userEvent.setup();
    const getCsv = captureCsv();
    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        csv={advanced}
      />
    );
    await openSheet(user);
    await addRule(user, /^Level$/);
    await user.type(screen.getByRole('textbox', { name: /value/i }), 'PRIMARY');

    await user.click(screen.getByRole('button', { name: /^download \d/i }));
    await waitFor(() => expect(getCsv()).not.toBe(''));
    expect(getCsv().replace(/^﻿/, '').split('\n')).toHaveLength(3);
  });

  it('removes the rule and returns to the full set', async () => {
    const user = userEvent.setup();
    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        csv={advanced}
      />
    );
    await openSheet(user);
    await addRule(user, /^Student$/);
    await user.type(screen.getByRole('textbox', { name: /value/i }), 'alpha');
    expect(
      await screen.findByRole('button', { name: /download 1 row$/i })
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: /remove rule on student/i })
    );
    expect(
      await screen.findByRole('button', { name: /download 3 rows/i })
    ).toBeInTheDocument();
  });

  it('seeds the limit to the number of rows on screen', async () => {
    const user = userEvent.setup();
    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        csv={advanced}
      />
    );
    await openSheet(user);

    // Pre-filled with the table's own count, so the default export is the
    // table you are looking at — and a limit equal to the count is not a cut,
    // so the header stays calm and the chain shows no limit step.
    expect(screen.getByRole('spinbutton', { name: /limit/i })).toHaveValue(3);
    expect(
      await screen.findByRole('button', { name: /download 3 rows/i })
    ).toBeInTheDocument();
  });

  it('applies the limit after filtering, and shows both steps', async () => {
    const user = userEvent.setup();
    const getCsv = captureCsv();
    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        csv={advanced}
      />
    );
    await openSheet(user);

    const limitInput = screen.getByRole('spinbutton', { name: /limit/i });
    await user.clear(limitInput);
    await user.type(limitInput, '2');

    expect(
      await screen.findByRole('button', { name: /download 2 rows/i })
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^download \d/i }));
    await waitFor(() => expect(getCsv()).not.toBe(''));
    expect(getCsv().replace(/^﻿/, '').split('\n')).toHaveLength(3); // header + 2
  });

  it('caps rather than conjures — a limit above the match count changes nothing', async () => {
    const user = userEvent.setup();
    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        csv={advanced}
      />
    );
    await openSheet(user);

    const limitInput = screen.getByRole('spinbutton', { name: /limit/i });
    await user.clear(limitInput);
    await user.type(limitInput, '100');

    // Only 3 rows exist, so the button still reports 3 — and the field says
    // "of 3 matching" so that reads as the cap doing nothing, not a bug.
    expect(
      await screen.findByRole('button', { name: /download 3 rows/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/of 3 matching/i)).toBeInTheDocument();
  });

  it('treats a cleared limit as no cap', async () => {
    const user = userEvent.setup();
    const getCsv = captureCsv();
    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        csv={advanced}
      />
    );
    await openSheet(user);
    await user.clear(screen.getByRole('spinbutton', { name: /limit/i }));

    await user.click(screen.getByRole('button', { name: /^download \d/i }));
    await waitFor(() => expect(getCsv()).not.toBe(''));
    expect(getCsv().replace(/^﻿/, '').split('\n')).toHaveLength(4); // header + 3
  });

  it('uses free text for Contains and a picker for Is', async () => {
    const user = userEvent.setup();
    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        csv={advanced}
      />
    );
    await openSheet(user);
    await addRule(user, /^Level$/);

    // "Contains" wants a fragment to search for, so free text — a menu of
    // whole values would have you pick one and ask if it contains itself.
    expect(screen.getByRole('textbox', { name: /value/i })).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: /condition/i }));
    await user.click(await screen.findByRole('option', { name: /^Is$/ }));

    // Equality against three known levels — now a menu is the right control.
    expect(
      await screen.findByRole('combobox', { name: /value/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('textbox', { name: /value/i })
    ).not.toBeInTheDocument();
  });

  it('adds an And/Or group from the filter menu', async () => {
    const user = userEvent.setup();
    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        csv={advanced}
      />
    );
    await openSheet(user);

    await user.click(screen.getByRole('button', { name: /add filter/i }));
    await user.click(
      await screen.findByRole('option', { name: /and \/ or group/i })
    );

    // The group is its own chip, with its own scoped "Add rule" — not a
    // second copy of the top-level "Add filter" link.
    // A new nested group defaults to OR — the useful shape is "all of these
    // AND any of those", so the root stays All and the group starts Any.
    const chip = await screen.findByRole('button', {
      name: /match all or any/i,
    });
    expect(chip).toHaveTextContent(/any of the following/i);
    expect(
      screen.getByRole('button', { name: /remove group/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /add rule/i })
    ).toBeInTheDocument();
  });

  it('toggles a group between All and Any', async () => {
    const user = userEvent.setup();
    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        csv={advanced}
      />
    );
    await openSheet(user);
    await user.click(screen.getByRole('button', { name: /add filter/i }));
    await user.click(
      await screen.findByRole('option', { name: /and \/ or group/i })
    );

    const chip = await screen.findByRole('button', {
      name: /match all or any/i,
    });
    expect(chip).toHaveTextContent(/any of the following/i);

    await user.click(chip);
    expect(
      await screen.findByRole('button', { name: /match all or any/i })
    ).toHaveTextContent(/all of the following/i);
  });

  it('clears the rules with Reset to screen', async () => {
    const user = userEvent.setup();
    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        csv={advanced}
      />
    );
    await openSheet(user);
    await addRule(user, /^Student$/);
    await user.type(screen.getByRole('textbox', { name: /value/i }), 'alpha');
    expect(
      await screen.findByRole('button', { name: /download 1 row$/i })
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /reset to screen/i }));
    expect(
      await screen.findByRole('button', { name: /download 3 rows/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/exporting every row on screen/i)
    ).toBeInTheDocument();
  });
});
