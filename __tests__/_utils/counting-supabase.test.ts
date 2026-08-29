/**
 * The counting harness is measurement equipment for the rest of the
 * app-wide query/write pass — if IT is wrong, every "before/after" number a
 * later phase claims is wrong too. So this file tests the harness itself
 * against known, hand-verified shapes rather than trusting it by inspection.
 *
 * The three cases the Phase 0 brief calls out explicitly:
 *   1. a known 3-sequential-await function → waves: 3, roundTrips: 3
 *   2. a known Promise.all of 3 → waves: 1, roundTrips: 3
 *   3. the duplicate detector fires on a genuine duplicate and stays silent
 *      on two same-table queries with different filters
 *
 * Plus enough extra coverage (mixed depth, write verbs, rpc, single/
 * maybeSingle, range) that a future change to the harness can't silently
 * break the contract the rest of the suite is about to depend on.
 */

import { describe, expect, it } from 'vitest';
import {
  createCountingClient,
  findDuplicateQueries,
  measureQueries,
  summarize,
  withCountingClock,
  type CountingSupabase,
} from './counting-supabase';

describe('sequential awaits — each one is its own wave', () => {
  it('3 sequential awaits report waves: 3, roundTrips: 3', async () => {
    const { roundTrips, waves } = await measureQueries(async (client) => {
      await client.from('a').select('*');
      await client.from('b').select('*');
      await client.from('c').select('*');
    });
    expect(roundTrips).toBe(3);
    expect(waves).toBe(3);
  });

  it('the recordings resolve in issue order with strictly increasing ticks', async () => {
    const { recordings } = await measureQueries(async (client) => {
      await client.from('a').select('*');
      await client.from('b').select('*');
      await client.from('c').select('*');
    });
    expect(recordings.map((r) => r.table)).toEqual(['a', 'b', 'c']);
    expect(recordings[0].endTick).toBe(recordings[1].startTick);
    expect(recordings[1].endTick).toBe(recordings[2].startTick);
  });
});

describe('Promise.all — parallel queries land on one wave', () => {
  it('Promise.all of 3 reports waves: 1, roundTrips: 3', async () => {
    const { roundTrips, waves } = await measureQueries(async (client) => {
      await Promise.all([
        client.from('a').select('*'),
        client.from('b').select('*'),
        client.from('c').select('*'),
      ]);
    });
    expect(roundTrips).toBe(3);
    expect(waves).toBe(1);
  });

  it('all three share the same startTick and endTick', async () => {
    const { recordings } = await measureQueries(async (client) => {
      await Promise.all([
        client.from('a').select('*'),
        client.from('b').select('*'),
        client.from('c').select('*'),
      ]);
    });
    const starts = new Set(recordings.map((r) => r.startTick));
    const ends = new Set(recordings.map((r) => r.endTick));
    expect(starts.size).toBe(1);
    expect(ends.size).toBe(1);
  });
});

describe('mixed depth — waves counts serial depth, not query count', () => {
  it('2 parallel then 1 dependent read reports waves: 2, roundTrips: 3', async () => {
    // The exact shape §2 of the performance doc calls a "wave": fetch ids in
    // parallel, then a dependent second-wave query. 3 queries, 2 waves.
    const { roundTrips, waves } = await measureQueries(async (client) => {
      await Promise.all([
        client.from('a').select('*'),
        client.from('b').select('*'),
      ]);
      await client.from('c').select('*');
    });
    expect(roundTrips).toBe(3);
    expect(waves).toBe(2);
  });

  it('a genuine N+1 (3 sequential fetches inside a loop) reports waves: 3', async () => {
    const { roundTrips, waves } = await measureQueries(async (client) => {
      for (const table of ['a', 'b', 'c']) {
        await client.from(table).select('*');
      }
    });
    expect(roundTrips).toBe(3);
    expect(waves).toBe(3);
  });

  it('zero queries reports waves: 0, roundTrips: 0 (not NaN)', async () => {
    const { roundTrips, waves } = await measureQueries(async () => {
      return 'no queries issued';
    });
    expect(roundTrips).toBe(0);
    expect(waves).toBe(0);
  });
});

describe('duplicate detector', () => {
  it('finds a genuine duplicate — same table, verb, and filters resolved twice', async () => {
    const { duplicates } = await measureQueries(async (client) => {
      await client.from('students').select('id').eq('academic_year_id', 'ay-1');
      await client.from('students').select('id').eq('academic_year_id', 'ay-1');
    });
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toMatchObject({
      table: 'students',
      verb: 'select',
      count: 2,
    });
    expect(duplicates[0].seqs).toHaveLength(2);
  });

  it('does not fire on two same-table queries with different filters', async () => {
    const { duplicates } = await measureQueries(async (client) => {
      await client.from('students').select('id').eq('academic_year_id', 'ay-1');
      await client.from('students').select('id').eq('academic_year_id', 'ay-2');
    });
    expect(duplicates).toEqual([]);
  });

  it('does not fire on the same filters against a different table', async () => {
    const { duplicates } = await measureQueries(async (client) => {
      await client.from('students').select('id').eq('id', 'x');
      await client.from('sections').select('id').eq('id', 'x');
    });
    expect(duplicates).toEqual([]);
  });

  it('does not fire on identical filters with different verbs (a read beside a write)', async () => {
    const { duplicates } = await measureQueries(async (client) => {
      await client.from('grade_entries').select('id').eq('id', 'x');
      await client
        .from('grade_entries')
        .update({ quarterly_grade: 90 })
        .eq('id', 'x');
    });
    expect(duplicates).toEqual([]);
  });

  it('works directly on a recordings array too, not just through measureQueries', () => {
    const dup = findDuplicateQueries([
      {
        table: 't',
        verb: 'select',
        seq: 1,
        startTick: 0,
        endTick: 10,
        filters: 'f',
      },
      {
        table: 't',
        verb: 'select',
        seq: 2,
        startTick: 10,
        endTick: 20,
        filters: 'f',
      },
      {
        table: 't',
        verb: 'select',
        seq: 3,
        startTick: 20,
        endTick: 30,
        filters: 'g',
      },
    ]);
    expect(dup).toHaveLength(1);
    expect(dup[0].count).toBe(2);
  });
});

describe('write verbs and rpc are recorded with the right verb', () => {
  it('insert/update/upsert/delete each record their own verb', async () => {
    const { recordings } = await measureQueries(async (client) => {
      await client.from('a').insert({ x: 1 });
      await client.from('a').update({ x: 2 }).eq('id', 'a1');
      await client.from('a').upsert({ x: 3 });
      await client.from('a').delete().eq('id', 'a1');
    });
    expect(recordings.map((r) => r.verb)).toEqual([
      'insert',
      'update',
      'upsert',
      'delete',
    ]);
  });

  it('.rpc() is recorded as its own verb, keyed by function name', async () => {
    const { recordings, roundTrips } = await measureQueries(async (client) => {
      await client.rpc('recompute_sheet_entries', { sheet_id: 's1' });
    });
    expect(roundTrips).toBe(1);
    expect(recordings[0]).toMatchObject({
      table: 'recompute_sheet_entries',
      verb: 'rpc',
    });
  });
});

describe('single / maybeSingle unwrap the fixture row', () => {
  it('.single() returns the first row, not an array', async () => {
    const { result } = await measureQueries(
      async (client) => {
        const { data } = await client
          .from('students')
          .select('*')
          .eq('id', 's1')
          .single();
        return data;
      },
      { students: [{ id: 's1', name: 'Ana' }] }
    );
    expect(result).toEqual({ id: 's1', name: 'Ana' });
  });

  it('.maybeSingle() returns null when the fixture has no rows', async () => {
    const { result } = await measureQueries(
      async (client) => {
        const { data } = await client
          .from('students')
          .select('*')
          .eq('id', 'missing')
          .maybeSingle();
        return data;
      },
      { students: [] }
    );
    expect(result).toBeNull();
  });
});

describe('.range() is recorded with {from, to}, mirroring daily-pagination.test.ts', () => {
  it('records the range on the terminal recording', async () => {
    const { recordings } = await measureQueries(async (client) => {
      await client.from('attendance_daily').select('*').range(0, 999);
    });
    expect(recordings[0].range).toEqual({ from: 0, to: 999 });
  });
});

describe('function fixtures can differentiate two queries against the same table', () => {
  it('picks a different fixture based on the select() string, like build-report-card.test.ts', async () => {
    const { result } = await measureQueries(
      async (client) => {
        const presence = await client
          .from('attendance_records')
          .select('term_id, days_present');
        const schoolDays = await client
          .from('attendance_records')
          .select('term_id, school_days');
        return { presence: presence.data, schoolDays: schoolDays.data };
      },
      {
        attendance_records: (state) => {
          const selectCall = state.calls.find((c) => c.method === 'select');
          const sel = (selectCall?.args[0] as string) ?? '';
          return sel.includes('school_days')
            ? { data: [{ term_id: 't1', school_days: 75 }] }
            : { data: [{ term_id: 't1', days_present: 70 }] };
        },
      }
    );
    expect(result).toEqual({
      presence: [{ term_id: 't1', days_present: 70 }],
      schoolDays: [{ term_id: 't1', school_days: 75 }],
    });
  });
});

describe('withCountingClock surfaces a stuck query rather than hanging', () => {
  it('throws when the function under test never settles within maxWaves', async () => {
    await expect(
      withCountingClock(() => new Promise(() => {}), { maxWaves: 2 })
    ).rejects.toThrow(/did not settle within 2 simulated waves/);
  });

  it('propagates a rejection from the function under test', async () => {
    await expect(
      withCountingClock(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
  });
});

describe('createCountingClient can be used directly, without measureQueries', () => {
  it('exposes .recordings live as queries resolve', async () => {
    const client: CountingSupabase = createCountingClient({ a: [{ id: 1 }] });
    await withCountingClock(async () => {
      await client.from('a').select('*');
    });
    expect(client.recordings).toHaveLength(1);
    expect(summarize(client.recordings)).toEqual({ roundTrips: 1, waves: 1 });
  });
});
