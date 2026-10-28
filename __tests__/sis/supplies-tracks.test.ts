import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import {
  resolveStudentTracks,
  trackOfApplication,
  type TrackOption,
} from '@/lib/sis/supplies/tracks';

const options: TrackOption[] = [
  {
    level_label: 'Primary Three',
    class_type_label: 'Global Class',
    track: 'Global',
  },
  {
    level_label: 'Primary Three',
    class_type_label: 'Standard Class',
    track: 'Standard',
  },
  // A second schedule of the same combination — same track, still resolves.
  {
    level_label: 'Primary Three',
    class_type_label: 'Standard Class',
    track: 'Standard',
  },
  // Two rows of one combination that disagree on the track.
  {
    level_label: 'Primary Four',
    class_type_label: 'Mixed Class',
    track: 'Global',
  },
  {
    level_label: 'Primary Four',
    class_type_label: 'Mixed Class',
    track: 'Standard',
  },
];

describe('trackOfApplication', () => {
  it('takes the track of the row with the same level and class type', () => {
    expect(
      trackOfApplication(
        { levelApplied: 'Primary Three', classType: ' Global Class ' },
        options
      )
    ).toBe('Global');
    expect(
      trackOfApplication(
        { levelApplied: 'Primary Three', classType: 'Standard Class' },
        options
      )
    ).toBe('Standard');
  });

  it('rows that disagree on the track leave it unresolved', () => {
    expect(
      trackOfApplication(
        { levelApplied: 'Primary Four', classType: 'Mixed Class' },
        options
      )
    ).toBeNull();
  });

  it('a blank, retired or other-level label is unresolved — never guessed from its words', () => {
    for (const app of [
      { levelApplied: 'Primary Three', classType: null },
      { levelApplied: null, classType: 'Global Class' },
      { levelApplied: 'Primary Three', classType: 'Global Class (old)' },
      { levelApplied: 'Primary Five', classType: 'Global Class' },
    ]) {
      expect(trackOfApplication(app, options)).toBeNull();
    }
  });
});

/** A service client that serves fixed rows per table, honouring `.in()`. */
function fakeService(tables: Record<string, Record<string, unknown>[]>) {
  const calls: Array<{ table: string; in?: string[] }> = [];
  const client = {
    from(table: string) {
      const call: { table: string; in?: string[] } = { table };
      calls.push(call);
      let inFilter: { col: string; values: string[] } | null = null;
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order']) q[m] = () => q;
      q.in = (col: string, values: string[]) => {
        inFilter = { col, values };
        call.in = values;
        return q;
      };
      q.range = () => q;
      q.then = (resolve: (r: unknown) => unknown) => {
        const rows = (tables[table] ?? []).filter(
          (r) =>
            !inFilter || inFilter.values.includes(r[inFilter.col] as string)
        );
        return Promise.resolve(resolve({ data: rows, error: null }));
      };
      return q;
    },
  };
  return { service: client as unknown as SupabaseClient, calls };
}

describe('resolveStudentTracks', () => {
  it('maps every number asked about, in one read per table', async () => {
    const { service, calls } = fakeService({
      admission_options: options,
      ay2027_enrolment_applications: [
        {
          studentNumber: 'G1',
          levelApplied: 'Primary Three',
          classType: 'Global Class',
        },
        {
          studentNumber: 'S1',
          levelApplied: 'Primary Three',
          classType: 'Standard Class',
        },
        // Blank class type → unresolved.
        { studentNumber: 'N1', levelApplied: 'Primary Three', classType: null },
        // Two applications naming different tracks → unresolved.
        {
          studentNumber: 'X1',
          levelApplied: 'Primary Three',
          classType: 'Global Class',
        },
        {
          studentNumber: 'X1',
          levelApplied: 'Primary Three',
          classType: 'Standard Class',
        },
        // Not asked about — never in the map.
        {
          studentNumber: 'OTHER',
          levelApplied: 'Primary Three',
          classType: 'Global Class',
        },
      ],
    });
    const map = await resolveStudentTracks(service, 'AY2027', [
      'G1',
      'S1',
      'N1',
      'X1',
      'NOAPP',
      'G1',
    ]);
    expect(Object.fromEntries(map)).toEqual({
      G1: 'Global',
      S1: 'Standard',
      N1: null,
      X1: null,
      NOAPP: null,
    });
    expect(calls.map((c) => c.table)).toEqual([
      'admission_options',
      'ay2027_enrolment_applications',
    ]);
    expect(calls[1].in).toEqual(['G1', 'S1', 'N1', 'X1', 'NOAPP']);
  });

  it('a year with no options resolves no one and never reads its applications', async () => {
    const { service, calls } = fakeService({
      ay2025_enrolment_applications: [
        {
          studentNumber: 'G1',
          levelApplied: 'Primary Three',
          classType: 'Global Class',
        },
      ],
    });
    const map = await resolveStudentTracks(service, 'AY2025', ['G1']);
    expect(map.get('G1')).toBeNull();
    expect(calls.map((c) => c.table)).toEqual(['admission_options']);
  });

  it('no numbers → no reads', async () => {
    const { service, calls } = fakeService({});
    expect((await resolveStudentTracks(service, 'AY2027', [])).size).toBe(0);
    expect(calls).toEqual([]);
  });
});
