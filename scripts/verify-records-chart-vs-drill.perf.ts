/**
 * The Records charts against the drills they open.
 *
 * A drill row is a `section_students` row; these charts count the APPLICANT.
 * A child who transferred mid-year has two enrolment rows (KD #67), so the
 * drills used to list them twice: the level chart read 407 against 408 drill
 * rows, and the document backlog was +1 on all 18 of its non-zero segments.
 * `dedupeByEnrolee` in lib/sis/drill.ts is what keeps these equal.
 *
 * NOT A TEST — live DB via scripts/vitest.perf.config.ts.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
  revalidateTag: () => {},
  revalidatePath: () => {},
  unstable_noStore: () => {},
}));

const AY = 'AY2026';
const FROM = '2000-01-01';
const TO = '2100-01-01';

describe('records charts vs drills', () => {
  it('level distribution', async () => {
    const { getLevelDistribution } = await import('@/lib/sis/dashboard');
    const { buildRecordsDrillRows, applyTargetFilter } =
      await import('@/lib/sis/drill');
    const chart = (await getLevelDistribution(AY)) as unknown as Array<
      Record<string, unknown>
    >;
    const all = await buildRecordsDrillRows(
      { ayCode: AY, from: FROM, to: TO },
      { withDocs: false, withDocSlotBuckets: false }
    );
    const out = chart.map((c) => {
      const level = String(c.level ?? c.name ?? '');
      return {
        level,
        chart: Number(c.count ?? c.value ?? 0),
        drill: applyTargetFilter(all, 'students-by-level', level, {
          from: FROM,
          to: TO,
        }).length,
      };
    });
    const bad = out.filter((r) => r.chart !== r.drill);
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          chartTotal: out.reduce((s, r) => s + r.chart, 0),
          drillTotal: out.reduce((s, r) => s + r.drill, 0),
          mismatchingLevels: bad,
        },
        null,
        2
      )
    );
    expect(bad).toHaveLength(0);
  });

  it('document backlog, every slot x bucket', async () => {
    const { getDocumentValidationBacklog } =
      await import('@/lib/sis/dashboard');
    const { buildRecordsDrillRows, applyTargetFilter } =
      await import('@/lib/sis/drill');
    const backlog = (await getDocumentValidationBacklog(
      AY
    )) as unknown as Array<Record<string, unknown>>;
    const all = await buildRecordsDrillRows(
      { ayCode: AY, from: FROM, to: TO },
      { withDocs: true, withDocSlotBuckets: true }
    );
    const rows: Array<{
      segment: string;
      chart: number;
      drill: number;
    }> = [];
    for (const b of backlog) {
      const label = String(b.label ?? '');
      for (const bucket of ['valid', 'pending', 'rejected', 'missing']) {
        const v = b[bucket];
        if (typeof v !== 'number') continue;
        rows.push({
          segment: `${label}|${bucket}`,
          chart: v,
          drill: applyTargetFilter(
            all,
            'backlog-by-document',
            `${label}|${bucket}`,
            { from: FROM, to: TO }
          ).length,
        });
      }
    }
    const bad = rows.filter((r) => r.chart !== r.drill);
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          segmentsCompared: rows.length,
          nonZeroSegments: rows.filter((r) => r.chart > 0).length,
          mismatches: bad,
        },
        null,
        2
      )
    );
    expect(bad).toHaveLength(0);
  });
});
