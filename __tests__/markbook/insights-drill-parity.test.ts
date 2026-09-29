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
  getSubjectLevelTrend,
  getSubjectPerformanceTrend,
} from '@/lib/markbook/compare';
import {
  buildMarkbookDrillRows,
  type GradeEntryRow,
} from '@/lib/markbook/drill';
import {
  levelAverageFromEntryRows,
  levelAveragesForPeriod,
  levelTermSegment,
  pickGradeDistributionTerm,
  subjectLevelSegment,
  subjectTermSegment,
  topBandSegment,
} from '@/lib/markbook/insights-drill';
import {
  buildSubjectLevelPoints,
  computeTermDelta,
} from '@/lib/markbook/insights-level';

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

describe('subject-term-entries — trend bars and subjects to watch', () => {
  it.each([
    ['AY2026', 'Mathematics', 2],
    ['AY2026', 'English', 3],
    ['AY2025', 'Mathematics', 1], // a comparison-year bar opens AY2025
  ])(
    '%s %s T%s: the plotted average is the mean of the listed grades',
    async (ayCode, subject, term) => {
      const points = await getSubjectPerformanceTrend(
        termCells(['AY2026', 'AY2025'])
      );
      const point = points.find(
        (p) =>
          p.ayCode === ayCode &&
          p.subjectName === subject &&
          p.periodLabel === `T${term}`
      );
      const rows = await entryRows(
        ayCode,
        'subject-term-entries',
        subjectTermSegment(subject, term)
      );

      expect(rows.map((r) => r.entryId).sort()).toEqual(
        expectedIds(
          fx.entries,
          (e) =>
            e.ayCode === ayCode &&
            e.subjectName === subject &&
            e.termNumber === term
        )
      );
      expect(mean1(rows.map((r) => r.computedGrade as number))).toBe(
        point?.avgGrade
      );
    }
  );

  it('counts the unlevelled section and the withdrawn student, as the chart does', async () => {
    const ids = (
      await entryRows('AY2026', 'subject-term-entries', 'Mathematics|T3')
    ).map((r) => r.entryId);
    expect(ids).toContain('ge-sh-sec26-x-MATH-T3-0');
    expect(ids).toContain('ge-sh-sec26-a-MATH-T3-2');
  });

  it('a subject the chart does not plot (not examinable) opens an empty list', async () => {
    expect(
      await entryRows('AY2026', 'subject-term-entries', 'Music|T2')
    ).toEqual([]);
  });

  it('a malformed segment opens an empty list, not every row', async () => {
    expect(
      await entryRows('AY2026', 'subject-term-entries', 'Mathematics')
    ).toEqual([]);
  });
});

describe('level-term-entries — "Which levels are struggling?" point', () => {
  it('each point equals the mean of its subject averages over the listed grades', async () => {
    const plotted = levelAveragesForPeriod(
      buildSubjectLevelPoints(
        await getSubjectLevelTrend(termCells(['AY2026']))
      ),
      'T3'
    );
    expect(plotted.map((p) => p.levelCode).sort()).toEqual(['P1', 'P2']);
    for (const { levelCode, avg } of plotted) {
      const rows = await entryRows(
        'AY2026',
        'level-term-entries',
        levelTermSegment(levelCode, 3)
      );
      expect(rows.map((r) => r.entryId).sort()).toEqual(
        expectedIds(
          fx.entries,
          (e) =>
            e.ayCode === 'AY2026' &&
            e.levelCode === levelCode &&
            e.termNumber === 3
        )
      );
      expect(levelAverageFromEntryRows(rows, levelCode, 3)).toBe(avg);
    }
  });

  it('the unlevelled section is in no level, as on the chart', async () => {
    const all = [
      ...(await entryRows('AY2026', 'level-term-entries', 'P1|T3')),
      ...(await entryRows('AY2026', 'level-term-entries', 'P2|T3')),
    ];
    expect(all.some((r) => r.sectionName === 'Unlevelled')).toBe(false);
  });

  it('a level with nothing that term opens an empty list', async () => {
    expect(await entryRows('AY2026', 'level-term-entries', 'S4|T3')).toEqual(
      []
    );
  });
});

describe('subject-level-entries — term-over-term movement bars', () => {
  it('lists the first and latest term, each matching its plotted average', async () => {
    const deltas = computeTermDelta(
      buildSubjectLevelPoints(await getSubjectLevelTrend(termCells(['AY2026'])))
    );
    expect(deltas.length).toBeGreaterThan(0);
    for (const d of deltas) {
      const rows = await entryRows(
        'AY2026',
        'subject-level-entries',
        subjectLevelSegment(d.subjectName, d.levelCode)
      );
      const first = rows.filter((r) => `T${r.termNumber}` === d.fromPeriod);
      const last = rows.filter((r) => `T${r.termNumber}` === d.toPeriod);
      expect(new Set(rows.map((r) => `T${r.termNumber}`))).toEqual(
        new Set([d.fromPeriod, d.toPeriod])
      );
      expect(first.length + last.length).toBe(rows.length);
      expect(mean1(first.map((r) => r.computedGrade as number))).toBe(
        d.firstAvg
      );
      expect(mean1(last.map((r) => r.computedGrade as number))).toBe(d.lastAvg);
    }
  });

  it('leaves out the terms between first and latest', async () => {
    const rows = await entryRows(
      'AY2026',
      'subject-level-entries',
      'Mathematics|P1'
    );
    expect(rows.some((r) => r.termNumber === 2)).toBe(false);
  });
});
