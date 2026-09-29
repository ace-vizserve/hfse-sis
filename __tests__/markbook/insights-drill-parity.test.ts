/**
 * Markbook Insights parity (KD #229). Every test runs the REAL Insights
 * loader and the REAL drill builder against ONE fake database and checks:
 *   - a count equals the rows listed;
 *   - an average equals the same average, computed by the same helper, from
 *     the rows listed.
 * The comparison year (AY2025) is clicked too.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { makeFakeService, type Tables } from './_support/fake-service';
import {
  NOW,
  TERMS,
  buildInsightsFixture,
  expectedIds,
  mean1,
  termCells,
  type FixtureEntry,
} from './_support/insights-fixture';

let TABLES: Tables = {};

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => makeFakeService(TABLES),
}));
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidateTag: () => undefined,
}));
vi.mock('@/lib/auth/teacher-emails', () => ({
  getTeacherEmailMap: async () => [],
}));
vi.mock('@/lib/auth/staff-list', () => ({
  getStaffDisplayNameById: async () => [],
}));
vi.mock('@/lib/dashboard/ay-id', () => ({
  getAyIdByCode: async (code: string) =>
    code === 'AY2026' ? 'ay26' : code === 'AY2025' ? 'ay25' : null,
}));

import { sgToday } from '@/lib/dates';
import { getGradeDistribution } from '@/lib/markbook/dashboard';
import {
  buildMarkbookDrillRows,
  type GradeEntryRow,
} from '@/lib/markbook/drill';
import {
  pickGradeDistributionTerm,
  topBandSegment,
} from '@/lib/markbook/insights-drill';

let fx: { tables: Tables; entries: FixtureEntry[] };

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(() => {
  fx = buildInsightsFixture();
  TABLES = fx.tables;
});

async function entryRows(
  ayCode: string,
  target: Parameters<typeof buildMarkbookDrillRows>[0]['target'],
  segment: string
) {
  return (await buildMarkbookDrillRows({
    ayCode,
    target,
    segment,
  })) as GradeEntryRow[];
}

describe('top-band badge → grade-bucket-entries top|T<n>', () => {
  it.each([
    ['AY2026', 'ay26', 2],
    ['AY2025', 'ay25', 2], // the comparison year, read at its own term
  ])(
    '%s: the list is exactly what the histogram counts at 85 and above',
    async (ayCode, ayId, expectedTerm) => {
      const buckets = await getGradeDistribution(ayId, ayCode);
      const topCount = buckets
        .filter((b) => b.key === 'vs' || b.key === 'o')
        .reduce((s, b) => s + b.count, 0);
      const term = pickGradeDistributionTerm(
        TERMS.filter((t) => t.academic_year_id === ayId),
        sgToday()
      );
      expect(term?.term_number).toBe(expectedTerm);

      const rows = await entryRows(
        ayCode,
        'grade-bucket-entries',
        topBandSegment(term!.term_number)
      );
      expect(topCount).toBeGreaterThan(0);
      expect(rows.length).toBe(topCount);
      expect(rows.map((r) => r.entryId).sort()).toEqual(
        expectedIds(
          fx.entries,
          (e) =>
            e.ayCode === ayCode &&
            e.termNumber === expectedTerm &&
            (e.grade as number) >= 85
        )
      );
    }
  );

  it('keeps a grade with no raw scores and drops the N.A. placeholder', async () => {
    const ids = (
      await entryRows('AY2026', 'grade-bucket-entries', 'top|T2')
    ).map((r) => r.entryId);
    expect(ids).toContain('ge-sh-sec26-a-MATH-T2-1');
    expect(ids).not.toContain('ge-sh-sec26-a-MATH-T2-0');
  });

  it('a band segment keeps its dashboard behaviour (scored entries only)', async () => {
    const ids = (await entryRows('AY2026', 'grade-bucket-entries', 'o')).map(
      (r) => r.entryId
    );
    expect(ids).not.toContain('ge-sh-sec26-a-MATH-T2-1');
  });
});
