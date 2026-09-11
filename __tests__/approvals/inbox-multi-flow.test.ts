import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  countInboxActionableAcrossFlows,
  listInboxStages,
} from '@/lib/approvals/inbox';
import type { StagedApprovalFlow } from '@/lib/schemas/approval-flows';

/**
 * The "waiting for me" count over several flows at once.
 *
 * ⚠ ONE QUERY, NOT ONE PER FLOW — the header count runs in every module
 * layout. And the single-flow entry point must keep asking exactly the
 * question it asked before: the declarations queue and its badge read it.
 */

const DECLARATIONS = 'attendance.student_declaration' as StagedApprovalFlow;
const OTHER = 'some.other_flow' as StagedApprovalFlow;
const OIC = 'oic-1';

function makeService(
  captured: {
    stageQueries: number;
    flowFilters: unknown[][];
  },
  filedBy: string | null = null
): SupabaseClient {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.eq = chain;
      builder.or = chain;
      builder.order = chain;
      builder.in = (column: string, values: unknown[]) => {
        if (column === 'approval_requests.flow') {
          captured.flowFilters.push(values);
        }
        return builder;
      };
      if (table === 'approval_request_stages') captured.stageQueries += 1;
      const rows =
        table === 'approval_request_stages'
          ? [
              {
                id: 's-1',
                request_id: 'r-1',
                stage_order: 1,
                label: 'Officer in charge',
                resolver: 'named',
                approver_pool: [OIC],
                section_id: null,
                status: 'pending',
                approval_requests: {
                  subject_type: 'student_declaration',
                  subject_id: 'd-1',
                  status: 'pending',
                  filed_by: filedBy,
                  filed_by_email: 'parent@example.com',
                  created_at: '2026-09-01T00:00:00Z',
                },
              },
            ]
          : [];
      builder.then = (
        resolve: (v: { data: unknown; error: null }) => unknown
      ) => resolve({ data: rows, error: null });
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe('countInboxActionableAcrossFlows', () => {
  it('asks once for every flow named, with duplicates dropped', async () => {
    const captured = { stageQueries: 0, flowFilters: [] as unknown[][] };
    const count = await countInboxActionableAcrossFlows(makeService(captured), {
      flows: [DECLARATIONS, OTHER, DECLARATIONS],
      userId: OIC,
      role: 'teacher',
      today: '2026-09-10',
    });
    expect(count).toBe(1);
    expect(captured.stageQueries).toBe(1);
    expect(captured.flowFilters).toEqual([[DECLARATIONS, OTHER]]);
  });

  it('asks nothing at all when no flow is named', async () => {
    // `in.()` is not valid PostgREST — an empty list must not reach the query.
    const from = vi.fn();
    const service = { from } as unknown as SupabaseClient;
    const count = await countInboxActionableAcrossFlows(service, {
      flows: [],
      userId: OIC,
      role: 'teacher',
    });
    expect(count).toBe(0);
    expect(from).not.toHaveBeenCalled();
  });

  it('the single-flow entry point still scopes to exactly its flow', async () => {
    const captured = { stageQueries: 0, flowFilters: [] as unknown[][] };
    await listInboxStages(makeService(captured), {
      flow: DECLARATIONS,
      userId: OIC,
      role: 'teacher',
      today: '2026-09-10',
    });
    expect(captured.flowFilters).toEqual([[DECLARATIONS]]);
  });
});

describe('a request the reader filed themselves', () => {
  const scope = {
    flows: [DECLARATIONS],
    userId: OIC,
    role: 'teacher' as const,
    today: '2026-09-10',
  };
  const captured = () => ({ stageQueries: 0, flowFilters: [] as unknown[][] });

  it('is not offered to them, and is not counted as waiting for them', async () => {
    const rows = await listInboxStages(makeService(captured(), OIC), {
      flow: DECLARATIONS,
      userId: OIC,
      role: 'teacher',
      today: '2026-09-10',
    });
    // Still visible — an oversight reader keeps seeing their own filing in
    // the school's queue — but never theirs to decide.
    expect(rows).toHaveLength(1);
    expect(rows[0].canDecide).toBe(false);
    expect(
      await countInboxActionableAcrossFlows(makeService(captured(), OIC), scope)
    ).toBe(0);
  });

  it('still counts a step whose filer is somebody else, or unknown', async () => {
    expect(
      await countInboxActionableAcrossFlows(
        makeService(captured(), 'parent-1'),
        scope
      )
    ).toBe(1);
    expect(
      await countInboxActionableAcrossFlows(
        makeService(captured(), null),
        scope
      )
    ).toBe(1);
  });
});
