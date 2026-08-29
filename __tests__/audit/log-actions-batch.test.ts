/**
 * `logActions` writes one array insert, not N single-row inserts — and it
 * still lands every good row when one row in the batch is bad.
 *
 * WHY THIS FILE EXISTS. `logActions` fanned its rows out through `logAction`
 * via `Promise.all`: 30 round trips for a class register submit, ~125 on a
 * year lock, 200 on a teacher-assignment bulk create. Collapsing that to one
 * insert is the easy half. The hard half is that an array insert is
 * ALL-OR-NOTHING — one row PostgREST rejects discards the other 199 — whereas
 * the per-row shape lost only the bad row. A silently incomplete audit trail
 * is worse than a slow one, so the batch writer falls back to per-row on ANY
 * insert error, and that fallback is pinned here rather than left as a branch
 * nothing exercises.
 *
 * Hard Rule #6: audit rows are append-only. Nothing here may turn an append
 * into an overwrite, so both paths assert the verb is `insert`.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  logAction,
  logActions,
  toAuditRow,
  type AuditAction,
  type AuditEntityType,
} from '@/lib/audit/log-action';

type Payload = Record<string, unknown>;

const ACTOR = { id: 'actor-1', email: 'actor@hfse.test' };

function rows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    action: 'attendance.daily.update' as AuditAction,
    entityType: 'attendance_daily' as AuditEntityType,
    entityId: `row-${i}`,
    context: { i, note: `mark ${i}` },
  }));
}

/**
 * The row shape as it stood BEFORE the batch writer existed — copied verbatim
 * from the object literal `logAction` inlined at `lib/audit/log-action.ts:257`
 * (commit 94ab2e00). This is the reference the extraction is judged against:
 * if `toAuditRow` ever shapes a row differently, the equality test below goes
 * red rather than the difference reaching `audit_log` unnoticed.
 */
function legacyShape(
  actor: { id: string | null; email: string | null },
  row: {
    action: AuditAction;
    entityType: AuditEntityType;
    entityId?: string | null;
    context?: Record<string, unknown>;
  }
) {
  return {
    actor_id: actor.id,
    actor_email: actor.email ?? '(unknown)',
    action: row.action,
    entity_type: row.entityType,
    entity_id: row.entityId ?? null,
    context: row.context ?? {},
  };
}

/**
 * Records every `.from(table).insert(payload)` call. `insertError` is returned
 * from the FIRST insert only, which is exactly the shape the fallback has to
 * survive: the batch fails, the retries succeed.
 */
function recordingClient(opts: { failFirstInsert?: string } = {}) {
  const calls: Array<{ table: string; verb: string; payload: unknown }> = [];
  let insertCount = 0;
  const client = {
    from(table: string) {
      return {
        insert(payload: unknown) {
          insertCount += 1;
          calls.push({ table, verb: 'insert', payload });
          const fail = opts.failFirstInsert && insertCount === 1;
          return Promise.resolve(
            fail
              ? { data: null, error: { message: opts.failFirstInsert } }
              : { data: null, error: null }
          );
        },
        update(payload: unknown) {
          calls.push({ table, verb: 'update', payload });
          return Promise.resolve({ data: null, error: null });
        },
        upsert(payload: unknown) {
          calls.push({ table, verb: 'upsert', payload });
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe('logActions — batched audit writes', () => {
  it('shapes 30 rows byte-identically to the pre-batch single-row writer', () => {
    const input = rows(30);
    const legacy = input.map((row) => legacyShape(ACTOR, row));
    const batched = input.map((row) => toAuditRow(ACTOR, row));

    expect(batched).toEqual(legacy);
    expect(batched).toHaveLength(30);
    // toEqual is structural; JSON pins ordering and value types too, which is
    // what "byte-identical" means once PostgREST serialises the body.
    expect(JSON.stringify(batched)).toBe(JSON.stringify(legacy));
  });

  it('writes 30 rows as ONE insert against audit_log', async () => {
    const { client, calls } = recordingClient();

    await logActions(client, ACTOR, rows(30));

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe('audit_log');
    // Hard Rule #6 — append-only. Never an update or an upsert.
    expect(calls[0].verb).toBe('insert');
    const payload = calls[0].payload as Payload[];
    expect(Array.isArray(payload)).toBe(true);
    expect(payload).toHaveLength(30);
    expect(payload).toEqual(rows(30).map((row) => toAuditRow(ACTOR, row)));
  });

  it('emits the same rows the single-row writer would have', async () => {
    const batch = recordingClient();
    await logActions(batch.client, ACTOR, rows(30));

    const single = recordingClient();
    for (const row of rows(30)) {
      await logAction({ service: single.client, actor: ACTOR, ...row });
    }

    expect(batch.calls[0].payload).toEqual(
      single.calls.map((call) => call.payload)
    );
  });

  it('falls back to per-row inserts when the batch is rejected', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const { client, calls } = recordingClient({
      failFirstInsert: 'invalid input value for enum audit_action',
    });

    await logActions(client, ACTOR, rows(30));

    // 1 failed batch + 30 single-row retries. The good rows all land; a batch
    // insert that simply gave up would have lost every one of them.
    expect(calls).toHaveLength(31);
    expect(Array.isArray(calls[0].payload)).toBe(true);
    for (const call of calls.slice(1)) {
      expect(call.table).toBe('audit_log');
      expect(call.verb).toBe('insert');
      expect(Array.isArray(call.payload)).toBe(false);
    }
    expect(calls.slice(1).map((c) => c.payload)).toEqual(
      rows(30).map((row) => toAuditRow(ACTOR, row))
    );
    consoleError.mockRestore();
  });

  it('falls back when the batch insert throws rather than returning an error', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    let insertCount = 0;
    const singles: unknown[] = [];
    const client = {
      from() {
        return {
          insert(payload: unknown) {
            insertCount += 1;
            if (insertCount === 1) throw new Error('socket hang up');
            singles.push(payload);
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    } as unknown as SupabaseClient;

    await logActions(client, ACTOR, rows(5));

    expect(singles).toHaveLength(5);
    consoleError.mockRestore();
  });

  it('never throws, even when every write fails', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const client = {
      from() {
        return {
          insert() {
            return Promise.resolve({
              data: null,
              error: { message: 'audit_log is unreachable' },
            });
          },
        };
      },
    } as unknown as SupabaseClient;

    await expect(logActions(client, ACTOR, rows(3))).resolves.toBeUndefined();
    consoleError.mockRestore();
  });

  it('issues no query at all for an empty batch', async () => {
    const { client, calls } = recordingClient();
    await logActions(client, ACTOR, []);
    expect(calls).toHaveLength(0);
  });
});
