/**
 * The live "waiting for you" badge does not count the reader's own filings,
 * nor a step the reader has already decided.
 *
 * ⚠ THE BROWSER RECOUNT HAS NO `canDecide` TO LEAN ON. It asks for every
 * pending step and lets RLS decide which it sees — and RLS admits a step whose
 * class the reader advises, which is exactly where a teacher filing a grade
 * change for their own advisory class sits. The server count excludes the
 * filer (`listInboxStagesAcrossFlows`), so without the same filter here the
 * badge would jump back up on the first live update.
 *
 * ⚠ AND RLS ADMITS A STEP THE READER HAS ALREADY APPROVED (migration 145). A
 * step that needs everyone stays pending after one person's yes, and that
 * person is still in its pool. The server count drops it; so must this.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { calls, handlers, counts, subscriptions } = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
  handlers: [] as Array<() => Promise<void>>,
  counts: { stages: 3, decisions: 0 },
  subscriptions: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    const channel: Record<string, unknown> = {};
    channel.on = (
      _e: string,
      filter: Record<string, unknown>,
      cb: () => Promise<void>
    ) => {
      subscriptions.push(filter);
      handlers.push(cb);
      return channel;
    };
    channel.subscribe = () => channel;

    return {
      from: (table: string) => {
        const query: Record<string, unknown> = {};
        for (const method of ['select', 'eq', 'in', 'or']) {
          query[method] = (...args: unknown[]) => {
            calls.push({ table, method, args });
            return query;
          };
        }
        query.then = (resolve: (v: unknown) => unknown) =>
          Promise.resolve({
            count:
              table === 'approval_request_stage_decisions'
                ? counts.decisions
                : counts.stages,
            error: null,
          }).then(resolve);
        return query;
      },
      channel: () => channel,
      removeChannel: () => {},
    };
  },
}));

import { useStagedApprovalCount } from '@/lib/sidebar/use-staged-approval-count';

beforeEach(() => {
  calls.length = 0;
  handlers.length = 0;
  subscriptions.length = 0;
  counts.stages = 3;
  counts.decisions = 0;
});

describe('useStagedApprovalCount', () => {
  it('leaves the reader’s own filings out of the live recount, keeping unknown filers in', async () => {
    const { result } = renderHook(() =>
      useStagedApprovalCount('u-teacher', ['markbook.grade_change'], 0)
    );
    expect(handlers.length).toBeGreaterThan(0);

    await act(async () => {
      await handlers[0]();
    });

    expect(calls).toContainEqual({
      table: 'approval_request_stages',
      method: 'or',
      args: [
        'filed_by.is.null,filed_by.neq.u-teacher',
        { referencedTable: 'approval_requests' },
      ],
    });
    await waitFor(() => expect(result.current).toBe(3));
  });

  it('subtracts the pending steps the reader has already decided', async () => {
    counts.stages = 3;
    counts.decisions = 2;
    const { result } = renderHook(() =>
      useStagedApprovalCount('u-board', ['markbook.grade_change_aeb'], 3)
    );

    await act(async () => {
      await handlers[0]();
    });

    await waitFor(() => expect(result.current).toBe(1));
    // Their OWN decisions, on still-pending steps of still-open requests on
    // the same flows the first count used.
    const decisionCalls = calls.filter(
      (c) => c.table === 'approval_request_stage_decisions'
    );
    expect(decisionCalls).toContainEqual({
      table: 'approval_request_stage_decisions',
      method: 'eq',
      args: ['user_id', 'u-board'],
    });
    expect(decisionCalls).toContainEqual({
      table: 'approval_request_stage_decisions',
      method: 'eq',
      args: ['approval_request_stages.status', 'pending'],
    });
    expect(decisionCalls).toContainEqual({
      table: 'approval_request_stage_decisions',
      method: 'in',
      args: [
        'approval_request_stages.approval_requests.flow',
        ['markbook.grade_change_aeb'],
      ],
    });
  });

  it('never goes below zero', async () => {
    counts.stages = 1;
    counts.decisions = 2;
    const { result } = renderHook(() =>
      useStagedApprovalCount('u-board', ['markbook.grade_change'], 1)
    );
    await act(async () => {
      await handlers[0]();
    });
    await waitFor(() => expect(result.current).toBe(0));
  });

  it('recounts when the reader records a decision of their own', () => {
    renderHook(() =>
      useStagedApprovalCount('u-board', ['markbook.grade_change'], 0)
    );
    // A yes on a step that needs everyone changes no step row, so the stage
    // listeners hear nothing — this one does.
    expect(subscriptions).toContainEqual({
      event: 'INSERT',
      schema: 'public',
      table: 'approval_request_stage_decisions',
      filter: 'user_id=eq.u-board',
    });
  });
});
