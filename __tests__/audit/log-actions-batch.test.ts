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
 * is worse than a slow one, so a REJECTED batch is retried row by row, and that
 * fallback is pinned here rather than left as a branch nothing exercises.
 *
 * ⚠ The fallback is NARROW on purpose, and the narrowing is the second thing
 * this file pins. It runs on a returned `error` — the statement ran, failed,
 * and committed nothing — and NOT on a throw, which is a transport failure that
 * may have arrived after the commit. See the pair of tests near the bottom.
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

const ACTOR = {
  id: 'actor-1',
  email: 'actor@hfse.test',
  role: 'academic_coordinator',
};

function rows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    action: 'attendance.daily.update' as AuditAction,
    entityType: 'attendance_daily' as AuditEntityType,
    entityId: `row-${i}`,
    context: { i, note: `mark ${i}` },
  }));
}

/**
 * The row shape `toAuditRow` is judged against — an independent restatement of
 * it, so a change to the real function shows up here as a difference rather
 * than reaching `audit_log` unnoticed.
 *
 * It began as the object literal `logAction` inlined at
 * `lib/audit/log-action.ts:257` before the batch writer existed (commit
 * 94ab2e00), which is why it was called `legacyShape`.
 *
 * ⚠ UPDATED DELIBERATELY, 2026-09-03, for `actor_role` (migration 141) — the
 * role that authorised the write, which every one of the 111 call sites used
 * to discard. This assertion is the whole reason the file exists, so the
 * reference was WIDENED rather than the equality check weakened or dropped.
 * Anyone adding a further column must do the same: restate the new field here
 * by hand, including the `'' → null` coercion, which is a real rule and not a
 * formatting detail (see `toAuditRow`).
 */
function referenceShape(
  actor: { id: string | null; email: string | null; role: string | null },
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
    actor_role: actor.role === '' ? null : actor.role,
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
  it('shapes 30 rows byte-identically to the reference row', () => {
    const input = rows(30);
    const reference = input.map((row) => referenceShape(ACTOR, row));
    const batched = input.map((row) => toAuditRow(ACTOR, row));

    expect(batched).toEqual(reference);
    expect(batched).toHaveLength(30);
    // toEqual is structural; JSON pins ordering and value types too, which is
    // what "byte-identical" means once PostgREST serialises the body.
    expect(JSON.stringify(batched)).toBe(JSON.stringify(reference));
  });

  // ── actor_role (migration 141) ────────────────────────────────────────────

  it('carries the role that authorised the write', () => {
    const [row] = rows(1);
    expect(toAuditRow(ACTOR, row).actor_role).toBe('academic_coordinator');
  });

  it('stores a system write as null, not as a blank', () => {
    const [row] = rows(1);
    const system = { id: null, email: 'system:auto-sync', role: null };
    expect(toAuditRow(system, row).actor_role).toBeNull();
  });

  it("collapses an empty-string role to null — '' is never stored", () => {
    // The signed-token approval path (lib/change-requests/decide.ts) reaches
    // for `app_metadata.role` with a `?? ''` fallback, so "" means "no role
    // found". Left as-is it would be a third state nobody queries for:
    // `actor_role is null` would miss it, and the actor filter would offer a
    // blank option.
    const [row] = rows(1);
    const scraped = { id: 'u1', email: 'approver@hfse.test', role: '' };
    expect(toAuditRow(scraped, row).actor_role).toBeNull();
    expect(toAuditRow(scraped, row).actor_role).not.toBe('');
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

  // ── The two failure paths are NOT the same failure ────────────────────────
  //
  // A returned `error` is the server's own answer: the statement ran and
  // failed, so nothing committed and a per-row retry can only repair.
  //
  // A THROW is a transport failure — a dead socket, an aborted fetch, a gateway
  // timeout — and any of those can arrive AFTER the insert committed. Retrying
  // then writes every row a second time into a table that is append-only by
  // Hard Rule #6 and has no unique constraint to stop it: a class register
  // submit's ~30 marks twice in the log and twice in the Activity panel.
  //
  // These two tests exist to keep that distinction from being "tidied" back
  // into one branch.

  it('retries per-row on a RETURNED error — nothing committed, so nothing can duplicate', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const { client, calls } = recordingClient({
      failFirstInsert: 'invalid input value for enum audit_action',
    });

    await logActions(client, ACTOR, rows(30));

    // 1 rejected batch + 30 single-row retries.
    expect(calls).toHaveLength(31);
    consoleError.mockRestore();
  });

  it('does NOT retry when the batch insert THROWS — the rows may already have landed', async () => {
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
            // A socket that dies after the server committed looks exactly like
            // one that died before it. The caller cannot tell, so it must not
            // guess.
            if (insertCount === 1) throw new Error('socket hang up');
            singles.push(payload);
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    } as unknown as SupabaseClient;

    await logActions(client, ACTOR, rows(30));

    // The batch was attempted once and NOT re-sent. Were this to fall back,
    // insertCount would be 31 and 30 duplicate rows would be in flight.
    expect(insertCount).toBe(1);
    expect(singles).toHaveLength(0);

    // The ambiguity is stated out loud, not swallowed — this is the only
    // record that the rows might be missing.
    const logged = consoleError.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toMatch(/THREW/);
    expect(logged).toMatch(/may or may not have landed/);
    expect(logged).toMatch(/NOT retrying/);

    consoleError.mockRestore();
  });

  it('still never throws on the ambiguous path', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const client = {
      from() {
        return {
          insert() {
            throw new Error('ECONNRESET');
          },
        };
      },
    } as unknown as SupabaseClient;

    await expect(logActions(client, ACTOR, rows(3))).resolves.toBeUndefined();
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
