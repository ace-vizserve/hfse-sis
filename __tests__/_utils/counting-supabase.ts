/**
 * A chainable, PostgREST-shaped fake Supabase client that COUNTS what it does
 * instead of merely returning fixture rows.
 *
 * WHY THIS EXISTS. Phase 0 of the app-wide query/write pass exists because the
 * project owner's standing rule is "measure, don't estimate" — a prior audit
 * raised six HIGH findings and half evaporated against production. Every later
 * phase is only allowed to claim a win if a number from THIS file moved. That
 * makes this file measurement equipment: if it is wrong, every number after it
 * is wrong, which is why it carries its own test file
 * (`counting-supabase.test.ts`) rather than trusting the shape by inspection.
 *
 * This promotes three patterns that already exist ad hoc across the test
 * suite rather than inventing a new shape:
 *   - `__tests__/attendance/daily-pagination.test.ts` — records `{from, to}`
 *     per `.range()` call.
 *   - `__tests__/report-card/build-report-card.test.ts` — the `makeService`
 *     chainable fake with per-table fixtures (including the "differentiate by
 *     the select() string" trick for two queries against the same table).
 *   - `__tests__/attendance/filing-window.test.ts` — a PostgREST-shaped stub
 *     that RECORDS the filters applied, so a query missing one fails the test
 *     that reads the recording rather than just the fixture data.
 *
 * THREE NUMBERS, NOT TWO.
 *   - `roundTrips` — how many terminal resolutions happened, full stop. Cheap,
 *     familiar, and blind to shape: it cannot tell a serial waterfall of 10
 *     awaits from a single `Promise.all([...10])`, both report 10.
 *   - `waves` — the real thing a later phase is allowed to move. Every
 *     recorded query resolves via `setTimeout(fn, 10)` under
 *     `vi.useFakeTimers()`; two queries that are ever `await`ed one after the
 *     other land on different simulated 10ms ticks, and any number issued
 *     inside the same `Promise.all` (or otherwise before anything yields to
 *     the fake clock) land on the SAME tick. `waves` is exactly
 *     `(latest endTick - earliest startTick) / 10` across all recordings —
 *     the maximum SERIAL depth, independent of how many queries fired at each
 *     depth. `withCountingClock` / `measureQueries` below are what actually
 *     drive the fake clock forward so those ticks happen; see their headers.
 *   - `pendingAtEnd` (via `CountingSupabase.startedCount` minus
 *     `recordings.length`, surfaced on `MeasureResult`) — queries that were
 *     STARTED (a chain was actually `await`ed/`.then()`'d, scheduling its
 *     `setTimeout`) but never resolved before the measured function's own
 *     promise settled and `withCountingClock` stopped advancing the clock.
 *     This is the classic fire-and-forget-in-a-`.forEach()`/`.map()` shape:
 *     the outer function returns without ever collecting that inner promise,
 *     so its query is real but invisible to `roundTrips`/`waves`. Reporting
 *     it as `pendingAtEnd` rather than silently dropping it matters because
 *     every other instrument in this pass deliberately OVER-reports — an
 *     under-count here would be the one instrument pointing the wrong way,
 *     and it is exactly the shape `scripts/audit/row-at-a-time-writes.ts`
 *     hunts for statically, so the two disagreeing with no warning would be
 *     worse than either being wrong alone.
 *
 * WHAT THIS IS NOT. It does not validate PostgREST semantics (error shapes on
 * `.single()` with 0/2 rows, RLS, etc.) — that is not its job. Its only job is
 * to answer "how many round trips, and how many of them were unavoidably
 * serial" for a real loader function, using the same call shape callers
 * already use in production code.
 */

import { vi } from 'vitest';

// ── Types ────────────────────────────────────────────────────────────────────

export type Verb = 'select' | 'insert' | 'update' | 'upsert' | 'delete' | 'rpc';

/** One builder-method call recorded on a chain, in the order it was made. */
interface CallRecord {
  method: string;
  args: unknown[];
}

interface ChainState {
  /** The table name for a `.from(table)` chain, or the function name for `.rpc(name)`. */
  table: string;
  calls: CallRecord[];
  verb: Verb;
  writeArgs?: unknown;
  single: 'none' | 'single' | 'maybeSingle';
  range?: { from: number; to: number };
}

/** One terminal resolution — the unit both `roundTrips` and `waves` are built from. */
export interface Recording {
  table: string;
  verb: Verb;
  /** Order of RESOLUTION (not necessarily of initiation), 1-based. */
  seq: number;
  /** Simulated `Date.now()` when the query was issued (i.e. when it was awaited). */
  startTick: number;
  /** Simulated `Date.now()` when the query resolved — always `startTick + 10`. */
  endTick: number;
  /** Deterministic serialization of every builder call (select/eq/in/order/...). */
  filters: string;
  /** Present only for a `.range()` call — mirrors daily-pagination.test.ts's shape. */
  range?: { from: number; to: number };
}

export interface FixtureEntry {
  data?: unknown;
  error?: { message: string } | null;
  count?: number | null;
}

/**
 * Per-table (or per-rpc-name) fixtures. A bare array is sugar for
 * `{ data: thatArray }`. A function receives the chain's accumulated state so
 * a caller can differentiate two queries against the same table by their
 * select string or filters — the same trick build-report-card.test.ts uses
 * for `attendance_records:presence` vs `attendance_records:school_days`.
 */
export type FixtureValue =
  | unknown[]
  | FixtureEntry
  | ((state: {
      calls: readonly CallRecord[];
      single: 'none' | 'single' | 'maybeSingle';
      verb: Verb;
    }) => FixtureEntry);

export type Fixtures = Record<string, FixtureValue>;

/** Minimal PostgREST-shaped chain surface. Loosely typed on purpose — real
 * loader code narrows via its own generics; this fake only needs to be
 * call-compatible, not type-identical to `@supabase/supabase-js`. */
export interface Chain extends PromiseLike<{
  data: unknown;
  error: unknown;
  count: number | null;
}> {
  select(columns?: string): Chain;
  eq(column: string, value: unknown): Chain;
  neq(column: string, value: unknown): Chain;
  in(column: string, values: unknown[]): Chain;
  gt(column: string, value: unknown): Chain;
  gte(column: string, value: unknown): Chain;
  lt(column: string, value: unknown): Chain;
  lte(column: string, value: unknown): Chain;
  not(column: string, operator: string, value: unknown): Chain;
  is(column: string, value: unknown): Chain;
  or(filters: string): Chain;
  contains(column: string, value: unknown): Chain;
  order(column: string, opts?: unknown): Chain;
  range(from: number, to: number): Chain;
  limit(n: number): Chain;
  insert(payload: unknown): Chain;
  update(payload: unknown): Chain;
  upsert(payload: unknown, opts?: unknown): Chain;
  delete(): Chain;
  single(): Chain;
  maybeSingle(): Chain;
  // `PromiseLike`, not `Promise`, matching `then` above — the implementation
  // below builds these from `chain.then(...)`, which only ever hands back a
  // thenable, never a real `Promise` instance.
  catch(onRejected: (e: unknown) => unknown): PromiseLike<unknown>;
  finally(onFinally: () => void): PromiseLike<unknown>;
}

export interface CountingSupabase {
  from(table: string): Chain;
  rpc(name: string, args?: unknown): Chain;
  /** Every terminal resolution so far, in resolution order. */
  recordings: Recording[];
  /**
   * How many chains have actually been started (awaited / `.then()`'d) so
   * far, resolved or not. `startedCount - recordings.length` is the number
   * still pending — a query that fired but never settled before measurement
   * ended, e.g. a fire-and-forget call inside a `.forEach()`/`.map()`. Always
   * `>= recordings.length`.
   */
  readonly startedCount: number;
}

// ── The fake client ──────────────────────────────────────────────────────────

const FILTER_METHODS = [
  'select',
  'eq',
  'neq',
  'in',
  'gt',
  'gte',
  'lt',
  'lte',
  'not',
  'is',
  'or',
  'contains',
  'order',
  'limit',
] as const;

function serializeCalls(calls: CallRecord[]): string {
  try {
    return JSON.stringify(calls);
  } catch {
    // Non-serializable arg (a function, a Map, ...) — fall back to something
    // still comparable rather than throwing out of a query call.
    return calls.map((c) => `${c.method}(${String(c.args)})`).join(';');
  }
}

function resolveFixture(
  fixtures: Fixtures,
  state: ChainState
): { data: unknown; error: unknown; count: number | null } {
  const raw = fixtures[state.table];
  let entry: FixtureEntry;
  if (typeof raw === 'function') {
    entry = raw({ calls: state.calls, single: state.single, verb: state.verb });
  } else if (Array.isArray(raw)) {
    entry = { data: raw };
  } else if (raw && typeof raw === 'object') {
    entry = raw as FixtureEntry;
  } else {
    entry = {};
  }

  const error = entry.error ?? null;
  if (error) return { data: null, error, count: null };

  const rows = entry.data ?? [];
  const count = entry.count ?? (Array.isArray(rows) ? rows.length : null);

  if (state.single === 'single' || state.single === 'maybeSingle') {
    const row = Array.isArray(rows) ? (rows[0] ?? null) : rows;
    return { data: row, error: null, count };
  }
  return { data: rows, error: null, count };
}

/** Build a thenable chain over one piece of mutable state, recording a
 * `Recording` into `recordings` the moment it is actually awaited. */
function makeChain(
  state: ChainState,
  fixtures: Fixtures,
  recordings: Recording[],
  seqRef: { n: number },
  startedRef: { n: number }
): Chain {
  const chain = {} as Chain;

  for (const method of FILTER_METHODS) {
    (chain as unknown as Record<string, (...a: unknown[]) => Chain>)[method] = (
      ...args: unknown[]
    ) => {
      state.calls.push({ method, args });
      return chain;
    };
  }

  chain.range = (from: number, to: number) => {
    state.calls.push({ method: 'range', args: [from, to] });
    state.range = { from, to };
    return chain;
  };
  chain.insert = (payload: unknown) => {
    state.verb = 'insert';
    state.writeArgs = payload;
    state.calls.push({ method: 'insert', args: [payload] });
    return chain;
  };
  chain.update = (payload: unknown) => {
    state.verb = 'update';
    state.writeArgs = payload;
    state.calls.push({ method: 'update', args: [payload] });
    return chain;
  };
  chain.upsert = (payload: unknown, opts?: unknown) => {
    state.verb = 'upsert';
    state.writeArgs = payload;
    state.calls.push({
      method: 'upsert',
      args: opts ? [payload, opts] : [payload],
    });
    return chain;
  };
  chain.delete = () => {
    state.verb = 'delete';
    state.calls.push({ method: 'delete', args: [] });
    return chain;
  };
  chain.single = () => {
    state.single = 'single';
    return chain;
  };
  chain.maybeSingle = () => {
    state.single = 'maybeSingle';
    return chain;
  };

  // The ONE terminal mechanism. Whether the caller reached here via a plain
  // `await supabase.from(x).eq(...)`, `.single()`, `.maybeSingle()`, a
  // directly-awaited `.range()`, or a write verb with no `.select()` after
  // it — every path is "this chain got awaited", which is exactly when JS
  // calls `.then()` on a thenable. One mechanism, no special-casing per verb.
  chain.then = <TResult1 = unknown, TResult2 = never>(
    onFulfilled?:
      | ((value: {
          data: unknown;
          error: unknown;
          count: number | null;
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> => {
    const promise = new Promise<{
      data: unknown;
      error: unknown;
      count: number | null;
    }>((resolve) => {
      // Counted the instant the chain is actually consumed (awaited or
      // `.then()`'d) — this is "started", independent of whether the
      // `setTimeout` below ever gets the chance to fire. A query built but
      // never awaited at all never reaches this line, matching real
      // postgrest-js: a thenable that nobody calls `.then()` on never issues
      // its request either.
      startedRef.n++;
      const startTick = Date.now();
      setTimeout(() => {
        const endTick = Date.now();
        const recording: Recording = {
          table: state.table,
          verb: state.verb,
          seq: ++seqRef.n,
          startTick,
          endTick,
          filters: serializeCalls(state.calls),
          ...(state.range ? { range: state.range } : {}),
        };
        recordings.push(recording);
        resolve(resolveFixture(fixtures, state));
      }, 10);
    });
    return promise.then(onFulfilled ?? undefined, onRejected ?? undefined);
  };
  chain.catch = (onRejected: (e: unknown) => unknown) =>
    chain.then(undefined, onRejected);
  chain.finally = (onFinally: () => void) =>
    chain.then(
      (v) => {
        onFinally();
        return v;
      },
      (e) => {
        onFinally();
        throw e;
      }
    );

  return chain;
}

/**
 * Build the fake client. `fixtures` is keyed by table name for `.from()`
 * chains and by function name for `.rpc()` calls — the two namespaces are
 * independent, so a table and an rpc can share a name with no collision.
 */
export function createCountingClient(
  fixtures: Fixtures = {}
): CountingSupabase {
  const recordings: Recording[] = [];
  const seqRef = { n: 0 };
  const startedRef = { n: 0 };

  return {
    from(table: string): Chain {
      const state: ChainState = {
        table,
        calls: [],
        verb: 'select',
        single: 'none',
      };
      return makeChain(state, fixtures, recordings, seqRef, startedRef);
    },
    rpc(name: string, args?: unknown): Chain {
      const state: ChainState = {
        table: name,
        calls:
          args !== undefined
            ? [{ method: 'rpc', args: [args] }]
            : [{ method: 'rpc', args: [] }],
        verb: 'rpc',
        single: 'none',
      };
      return makeChain(state, fixtures, recordings, seqRef, startedRef);
    },
    recordings,
    get startedCount() {
      return startedRef.n;
    },
  };
}

// ── Derived numbers ──────────────────────────────────────────────────────────

export interface Summary {
  roundTrips: number;
  waves: number;
}

/**
 * `roundTrips` = recordings.length, full stop.
 * `waves` = (latest endTick − earliest startTick) / 10 — the maximum serial
 * depth. Zero recordings is zero waves, not `NaN` or `-Infinity`.
 */
export function summarize(recordings: Recording[]): Summary {
  if (recordings.length === 0) return { roundTrips: 0, waves: 0 };
  const earliestStart = Math.min(...recordings.map((r) => r.startTick));
  const latestEnd = Math.max(...recordings.map((r) => r.endTick));
  return {
    roundTrips: recordings.length,
    waves: (latestEnd - earliestStart) / 10,
  };
}

export interface DuplicateGroup {
  table: string;
  verb: Verb;
  filters: string;
  count: number;
  seqs: number[];
}

/**
 * Same table + same verb + identically-serialized filters, resolved more
 * than once. This is the RUNTIME duplicate check — the authoritative one,
 * per the brief; `scripts/audit/duplicate-queries.ts` is only the cheap
 * static pre-filter over source text.
 */
export function findDuplicateQueries(
  recordings: Recording[]
): DuplicateGroup[] {
  const groups = new Map<string, Recording[]>();
  for (const r of recordings) {
    // Join on a separator that cannot appear in `filters` (JSON never emits
    // NUL), so a filters string containing '|' cannot collide two groups.
    const key = `${r.table} ${r.verb} ${r.filters}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(r);
    else groups.set(key, [r]);
  }
  const duplicates: DuplicateGroup[] = [];
  for (const recs of groups.values()) {
    if (recs.length > 1) {
      duplicates.push({
        table: recs[0].table,
        verb: recs[0].verb,
        filters: recs[0].filters,
        count: recs.length,
        seqs: recs.map((r) => r.seq),
      });
    }
  }
  return duplicates;
}

// ── Driving the fake clock ───────────────────────────────────────────────────

/**
 * Runs `run()` under `vi.useFakeTimers()`, advancing the simulated clock in
 * 10ms steps (one step per possible wave) until `run()`'s promise settles,
 * then restores real timers. This is what actually produces the tick
 * separation `summarize()` reads — without driving the clock forward, every
 * query's `setTimeout(fn, 10)` would simply never fire and the caller's
 * promise would hang forever.
 *
 * `maxWaves` is a safety valve, not a tuning knob: it exists so a genuinely
 * stuck query (a fixture that never resolves, a real infinite loop) fails
 * loudly with a clear message instead of hanging the test runner. 500 waves
 * (5 simulated seconds) is far beyond anything a real loader in this app
 * should ever need.
 */
export async function withCountingClock<T>(
  run: () => Promise<T>,
  opts: { maxWaves?: number } = {}
): Promise<T> {
  const maxWaves = opts.maxWaves ?? 500;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  try {
    let settled = false;
    let result: T | undefined;
    let failure: { error: unknown } | undefined;
    run().then(
      (r) => {
        settled = true;
        result = r;
      },
      (e) => {
        settled = true;
        failure = { error: e };
      }
    );
    for (let i = 0; i < maxWaves && !settled; i++) {
      await vi.advanceTimersByTimeAsync(10);
    }
    if (!settled) {
      throw new Error(
        `withCountingClock: the function under test did not settle within ${maxWaves} ` +
          `simulated waves (${maxWaves * 10}ms). Raise maxWaves, or this is a genuinely ` +
          'stuck query (a fixture with no matching table, an infinite loop).'
      );
    }
    if (failure) throw failure.error;
    return result as T;
  } finally {
    vi.useRealTimers();
  }
}

export interface MeasureResult<T> {
  result: T;
  roundTrips: number;
  waves: number;
  recordings: Recording[];
  duplicates: DuplicateGroup[];
  /**
   * Queries that were started (awaited/`.then()`'d) but had not resolved by
   * the time the measured function's own promise settled — see the
   * "THREE NUMBERS, NOT TWO" section at the top of this file. Zero is the
   * healthy/expected value; a nonzero count means a query fired somewhere
   * that nothing in the measured call graph actually waited on.
   */
  pendingAtEnd: number;
}

/**
 * The one-call convenience most tests want: build a counting client, run a
 * loader against it under the fake clock, and hand back the result plus both
 * derived numbers. This is what `__tests__/perf/query-budget.test.ts` uses to
 * seed today's numbers.
 */
export async function measureQueries<T>(
  run: (client: CountingSupabase) => Promise<T>,
  fixtures: Fixtures = {},
  opts: { maxWaves?: number } = {}
): Promise<MeasureResult<T>> {
  const client = createCountingClient(fixtures);
  const result = await withCountingClock(() => run(client), opts);
  const { roundTrips, waves } = summarize(client.recordings);
  return {
    result,
    roundTrips,
    waves,
    recordings: client.recordings,
    duplicates: findDuplicateQueries(client.recordings),
    pendingAtEnd: client.startedCount - client.recordings.length,
  };
}
