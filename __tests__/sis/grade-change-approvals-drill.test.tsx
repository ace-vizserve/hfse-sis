/**
 * The "Grade change approvals" drill on the /sis readiness strip.
 *
 * ⚠ IT USED TO LIST `approver_assignments` — the retired two-approver pool —
 * and selected a `role` column that table never had. Grade changes are approved
 * in ordered steps now (migration 144), and the strip reports on those steps,
 * so the list it opens has to show the same steps and the people on them.
 *
 * Pinned:
 *   1. The rows: both routes in order, each route's steps renumbered 1..n, a
 *      form adviser step named by the post, a person's half of the school,
 *      and a route with no steps still listed rather than silently missing.
 *   2. The route reads the step configuration (not the old pool) and its CSV
 *      says the same thing in words.
 *   3. The sheet renders those rows in plain words.
 */
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FlowConfig, StageApproverView } from '@/lib/approvals/readiness';

vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(async () => ({
    user: { id: 'u-super', email: 'super@hfse.test' },
    role: 'superadmin',
  })),
}));

const { configs, fromCalls } = vi.hoisted(() => ({
  configs: new Map<string, FlowConfig>(),
  fromCalls: [] as string[],
}));
vi.mock('@/lib/approvals/config', () => ({
  loadFlowConfig: vi.fn(async (_s: unknown, flow: string) => configs.get(flow)),
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      fromCalls.push(table);
      throw new Error(`the drill should not query ${table} directly`);
    },
  }),
}));

let drillResponse: unknown = null;
vi.mock('@/lib/query/fetcher', () => ({
  apiFetch: vi.fn(async () => drillResponse),
}));

// The real sheet virtualises its rows, and jsdom has no layout, so it renders
// an empty body. What is under test is the COLUMNS this drill hands it and the
// props it passes, so a plain table stands in: every column's header and cell,
// for every row.
const { sheetProps } = vi.hoisted(() => ({
  sheetProps: [] as Array<Record<string, unknown>>,
}));
vi.mock('@/components/dashboard/drill-down-sheet', async () => {
  const { flexRender, getCoreRowModel, useReactTable } =
    await import('@tanstack/react-table');
  function DrillDownSheet(props: {
    title: string;
    description?: React.ReactNode;
    columns: import('@tanstack/react-table').ColumnDef<unknown, unknown>[];
    rows: unknown[];
  }) {
    sheetProps.push(props as unknown as Record<string, unknown>);
    const table = useReactTable({
      data: props.rows,
      columns: props.columns,
      getCoreRowModel: getCoreRowModel(),
    });
    return (
      <div>
        <h2>{props.title}</h2>
        <p>{props.description}</p>
        <table>
          <thead>
            {table.getHeaderGroups().map((g) => (
              <tr key={g.id}>
                {g.headers.map((h) => (
                  <th key={h.id}>
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((r) => (
              <tr key={r.id}>
                {r.getVisibleCells().map((c) => (
                  <td key={c.id}>
                    {flexRender(c.column.columnDef.cell, c.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return { DrillDownSheet };
});

import {
  buildGradeChangeStepDrillRows,
  describeGradeChangeStepPeople,
} from '@/lib/sis/drill';
import { GET } from '@/app/api/sis-admin/drill/[target]/route';
import { SisAdminDrillSheet } from '@/components/sis/drills/sis-admin-drill-sheet';
import { Sheet } from '@/components/ui/sheet';

function person(
  over: Partial<StageApproverView> & { displayName: string }
): StageApproverView {
  return {
    id: `row-${over.displayName}`,
    userId: `u-${over.displayName}`,
    email: `${over.displayName}@hfse.test`,
    role: 'school_admin',
    disabled: false,
    appliesToLevelType: null,
    ...over,
  };
}

const NORMAL: FlowConfig = {
  flow: 'markbook.grade_change',
  stages: [
    {
      id: 'st-adviser',
      flow: 'markbook.grade_change',
      stageOrder: 1,
      label: 'Form class adviser',
      resolver: 'form_adviser',
      approvalRule: 'any',
      approvers: [],
    },
    {
      // Configuration numbers can have gaps after a step is retired.
      id: 'st-approvers',
      flow: 'markbook.grade_change',
      stageOrder: 4,
      label: 'Grade change approvers',
      resolver: 'named',
      approvalRule: 'any',
      approvers: [
        person({ displayName: 'Ms Lhen', appliesToLevelType: 'primary' }),
        person({ displayName: 'Ms Elaine', appliesToLevelType: 'secondary' }),
        person({ displayName: 'Mr Gary', disabled: true }),
      ],
    },
  ],
};

const BOARD_EMPTY: FlowConfig = {
  flow: 'markbook.grade_change_aeb',
  stages: [],
};

beforeEach(() => {
  configs.clear();
  configs.set('markbook.grade_change', NORMAL);
  configs.set('markbook.grade_change_aeb', BOARD_EMPTY);
  fromCalls.length = 0;
});

describe('buildGradeChangeStepDrillRows', () => {
  it('lists each route’s steps in order, numbered as a teacher sees them', () => {
    const rows = buildGradeChangeStepDrillRows([NORMAL, BOARD_EMPTY]);
    expect(
      rows.map((r) => [r.routeLabel, r.stepOrder, r.label, r.kind])
    ).toEqual([
      [
        'Grade changes before publishing',
        1,
        'Form class adviser',
        'form_adviser',
      ],
      ['Grade changes before publishing', 2, 'Grade change approvers', 'named'],
      ['Grade changes after publishing', null, null, 'not_set_up'],
    ]);
    expect(rows[1].stepCount).toBe(2);
    expect(rows[1].people).toEqual([
      { name: 'Ms Lhen', scope: 'Primary only', disabled: false },
      { name: 'Ms Elaine', scope: 'Secondary only', disabled: false },
      { name: 'Mr Gary', scope: null, disabled: true },
    ]);
    expect(rows[0].people).toEqual([]);
  });

  it('says in words who approves each kind of row', () => {
    const rows = buildGradeChangeStepDrillRows([NORMAL, BOARD_EMPTY]);
    expect(rows.map(describeGradeChangeStepPeople)).toEqual([
      'Form class adviser',
      'Ms Lhen (Primary only); Ms Elaine (Secondary only); Mr Gary (account turned off)',
      'No steps set up yet',
    ]);
    const nobody = buildGradeChangeStepDrillRows([
      {
        flow: 'markbook.grade_change_aeb',
        stages: [
          {
            id: 'st-1',
            flow: 'markbook.grade_change_aeb',
            stageOrder: 1,
            label: 'Academic coordinator',
            resolver: 'named',
            approvalRule: 'any',
            approvers: [],
          },
        ],
      },
    ]);
    expect(describeGradeChangeStepPeople(nobody[0])).toBe('Nobody set up yet');
  });

  // Migration 145: one word says whether either person or both must approve.
  it('reads "or" when any one approves and "and" when everyone must', () => {
    const board = (approvalRule: 'any' | 'all'): FlowConfig => ({
      flow: 'markbook.grade_change_aeb',
      stages: [
        {
          id: `st-${approvalRule}`,
          flow: 'markbook.grade_change_aeb',
          stageOrder: 1,
          label: 'Board',
          resolver: 'named',
          approvalRule,
          approvers: [
            person({ displayName: 'Mr Gary' }),
            person({ displayName: 'Ms Nina' }),
          ],
        },
      ],
    });
    const [anyRow] = buildGradeChangeStepDrillRows([board('any')]);
    const [allRow] = buildGradeChangeStepDrillRows([board('all')]);
    expect(anyRow.approvalRule).toBe('any');
    expect(allRow.approvalRule).toBe('all');
    expect(describeGradeChangeStepPeople(anyRow)).toBe('Mr Gary or Ms Nina');
    expect(describeGradeChangeStepPeople(allRow)).toBe('Mr Gary and Ms Nina');
  });

  it('never joins people split by half of the school with "and"', () => {
    const [row] = buildGradeChangeStepDrillRows([
      {
        flow: 'markbook.grade_change',
        stages: [
          {
            id: 'st-oic',
            flow: 'markbook.grade_change',
            stageOrder: 1,
            label: 'Officer in charge',
            resolver: 'named',
            approvalRule: 'all',
            approvers: [
              person({ displayName: 'Ms Lhen', appliesToLevelType: 'primary' }),
              person({
                displayName: 'Ms Elaine',
                appliesToLevelType: 'secondary',
              }),
            ],
          },
        ],
      },
    ]);
    const words = describeGradeChangeStepPeople(row);
    expect(words).not.toContain(' and ');
    expect(words).toContain(
      'Ms Lhen (Primary only); Ms Elaine (Secondary only)'
    );
    expect(words).toContain('everyone covering the child’s half must approve');
  });
});

describe('GET /api/sis-admin/drill/approver-coverage', () => {
  async function get(query = ''): Promise<Response> {
    const res = await GET(
      new Request(
        `http://localhost/api/sis-admin/drill/approver-coverage${query}`
      ),
      { params: Promise.resolve({ target: 'approver-coverage' }) }
    );
    if (!res) throw new Error('the route returned no response');
    return res;
  }

  it('answers with the configured steps, not the old approver pool', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.title).toBe('Grade change approvals');
    expect(json.rows).toHaveLength(3);
    expect(json.rows[1]).toMatchObject({
      label: 'Grade change approvers',
      stepOrder: 2,
    });
    // Nothing read `approver_assignments` (or any table) behind the loader.
    expect(fromCalls).toEqual([]);
  });

  it('exports the same list in words', async () => {
    const res = await get('?format=csv');
    const csv = await res.text();
    const lines = csv.trim().split(/\r?\n/);
    expect(lines[0]).toContain('Kind of change');
    expect(lines[0]).toContain('Who approves');
    expect(csv).toContain('2 of 2');
    expect(csv).toContain('Ms Lhen (Primary only)');
    expect(csv).toContain('No steps set up yet');
  });
});

describe('SisAdminDrillSheet — approver-coverage', () => {
  it('shows each step with its people in plain words', async () => {
    drillResponse = {
      rows: buildGradeChangeStepDrillRows([NORMAL, BOARD_EMPTY]),
      target: 'approver-coverage',
      title: 'Grade change approvals',
      eyebrow: 'Drill · Approvers',
    };
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    sheetProps.length = 0;
    render(
      <QueryClientProvider client={client}>
        {/* The loading skeleton is a SheetContent, which needs its Sheet. */}
        <Sheet open>
          <SisAdminDrillSheet target="approver-coverage" />
        </Sheet>
      </QueryClientProvider>
    );

    expect(
      await screen.findByRole('heading', { name: 'Grade change approvals' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Who approves each kind of grade change/)
    ).toBeInTheDocument();
    // Level / status / stage grouping means nothing for a list of steps.
    expect(sheetProps.at(-1)?.showGroupBy).toBe(false);

    const table = screen.getByRole('table');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual([
      'Kind of change',
      'Step',
      'Step name',
      'Who approves',
    ]);

    const [adviserRow, namedRow, emptyRouteRow] = within(table)
      .getAllByRole('row')
      .slice(1);
    expect(within(adviserRow).getAllByText('Form class adviser')).toHaveLength(
      2
    );
    expect(adviserRow.textContent).toContain('1of 2');
    expect(within(namedRow).getByText('Ms Lhen')).toBeInTheDocument();
    expect(within(namedRow).getByText('Primary')).toBeInTheDocument();
    expect(within(namedRow).getByText('Secondary')).toBeInTheDocument();
    expect(
      within(namedRow).getByText('Account turned off')
    ).toBeInTheDocument();
    expect(
      within(emptyRouteRow).getByText('No steps set up yet')
    ).toBeInTheDocument();
    expect(emptyRouteRow.textContent).toContain('SIS Admin → Approvers');
    // No leftover pool vocabulary.
    expect(screen.queryByText('Flow')).not.toBeInTheDocument();
    expect(screen.queryByText('Role')).not.toBeInTheDocument();
  });

  it('writes "and" between the people of a step that needs everyone', async () => {
    const everyoneBoard: FlowConfig = {
      flow: 'markbook.grade_change_aeb',
      stages: [
        {
          id: 'st-board',
          flow: 'markbook.grade_change_aeb',
          stageOrder: 1,
          label: 'Board',
          resolver: 'named',
          approvalRule: 'all',
          approvers: [
            person({ displayName: 'Mr Gary' }),
            person({ displayName: 'Ms Nina' }),
          ],
        },
      ],
    };
    drillResponse = {
      rows: buildGradeChangeStepDrillRows([everyoneBoard]),
      target: 'approver-coverage',
      title: 'Grade change approvals',
      eyebrow: 'Drill · Approvers',
    };
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <Sheet open>
          <SisAdminDrillSheet target="approver-coverage" />
        </Sheet>
      </QueryClientProvider>
    );
    const table = await screen.findByRole('table');
    const [row] = within(table).getAllByRole('row').slice(1);
    expect(row.textContent).toContain('Mr Gary and Ms Nina');
  });
});
