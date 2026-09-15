/**
 * Every KPI card on every module dashboard, against the drill sheet it opens.
 *
 * A card's number comes from `lib/<module>/dashboard.ts`; its sheet's rows come
 * from `lib/<module>/drill.ts`. Two separate reads of the same data, so the two
 * can disagree even when the predicate is written identically — which is
 * exactly what attendance did (Absences 880 on the card, 983 rows in the
 * sheet, because the drill read the append-only ledger without deduping).
 * Reading the predicates is not enough. This measures them.
 *
 * Rate cards (a %, an average) are reported but not asserted: the rows behind
 * a rate are legitimately the whole population.
 *
 * NOT A TEST — hits the live database, reachable only via
 * `scripts/vitest.perf.config.ts`.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
  revalidateTag: () => {},
  revalidatePath: () => {},
  unstable_noStore: () => {},
}));

const AY = 'AY2026';
// A realistic in-term window (the pages default to a term preset) and the
// whole year, because a range bug and a read bug hide in different windows.
const WINDOWS: Array<{ label: string; from: string; to: string }> = [
  { label: 'in-term', from: '2026-09-01', to: '2026-09-15' },
  { label: 'full-ay', from: '2000-01-01', to: '2100-01-01' },
];

type Finding = {
  module: string;
  card: string;
  target: string;
  window: string;
  cardValue: number;
  sheetRows: number;
};

const mismatches: Finding[] = [];
const checked: Finding[] = [];

function record(f: Finding, assertEqual: boolean) {
  checked.push(f);
  if (assertEqual && f.cardValue !== f.sheetRows) mismatches.push(f);
}

describe('card number vs drill rows — all modules', () => {
  it('admissions', async () => {
    const { getAdmissionsKpisRange } =
      await import('@/lib/admissions/dashboard');
    const { buildDrillRows, applyTargetFilter } =
      await import('@/lib/admissions/drill');

    for (const w of WINDOWS) {
      const kpis = await getAdmissionsKpisRange({
        ayCode: AY,
        from: w.from,
        to: w.to,
        cmpFrom: null,
        cmpTo: null,
      });
      const rowsFor = async (target: string) => {
        const all = await buildDrillRows(
          { ayCode: AY, from: w.from, to: w.to },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { withDocs: false, target: target as any }
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return applyTargetFilter(all, target as any, null);
      };

      record(
        {
          module: 'admissions',
          card: 'Applications (range)',
          target: 'applications',
          window: w.label,
          cardValue: kpis.current.applicationsInRange,
          sheetRows: (await rowsFor('applications')).length,
        },
        true
      );
      record(
        {
          module: 'admissions',
          card: 'Enrolled (range)',
          target: 'enrolled',
          window: w.label,
          cardValue: kpis.current.enrolledInRange,
          sheetRows: (await rowsFor('enrolled')).length,
        },
        true
      );
      record(
        {
          module: 'admissions',
          card: 'Conversion rate (%)',
          target: 'conversion',
          window: w.label,
          cardValue: kpis.current.conversionPct,
          sheetRows: (await rowsFor('conversion')).length,
        },
        false
      );
      record(
        {
          module: 'admissions',
          card: 'Avg time to enrol (days)',
          target: 'avg-time',
          window: w.label,
          cardValue: kpis.current.sampleSize,
          sheetRows: (await rowsFor('avg-time')).length,
        },
        true // sampleSize IS the row count the average is taken over
      );
    }
    expect(checked.length).toBeGreaterThan(0);
  });

  it('records', async () => {
    const { getRecordsKpisRange } = await import('@/lib/sis/dashboard');
    const { buildRecordsDrillRows, applyTargetFilter } =
      await import('@/lib/sis/drill');

    for (const w of WINDOWS) {
      const kpis = await getRecordsKpisRange({
        ayCode: AY,
        from: w.from,
        to: w.to,
        cmpFrom: null,
        cmpTo: null,
      });
      const rowsFor = async (target: string, withDocs = false) => {
        const all = await buildRecordsDrillRows(
          { ayCode: AY, from: w.from, to: w.to },
          { withDocs, withDocSlotBuckets: false }
        );
        return applyTargetFilter(
          all,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          target as any,
          null,
          { from: w.from, to: w.to }
        );
      };

      record(
        {
          module: 'records',
          card: 'New enrollments',
          target: 'enrollments-range',
          window: w.label,
          cardValue: kpis.current.enrollmentsInRange,
          sheetRows: (await rowsFor('enrollments-range')).length,
        },
        true
      );
      record(
        {
          module: 'records',
          card: 'Withdrawals',
          target: 'withdrawals-range',
          window: w.label,
          cardValue: kpis.current.withdrawalsInRange,
          sheetRows: (await rowsFor('withdrawals-range')).length,
        },
        true
      );
      record(
        {
          module: 'records',
          card: 'Active enrolled',
          target: 'active-enrolled',
          window: w.label,
          cardValue: kpis.current.activeEnrolled,
          sheetRows: (await rowsFor('active-enrolled')).length,
        },
        true
      );
      record(
        {
          module: 'records',
          card: 'Docs expiring <=60d',
          target: 'expiring-docs',
          window: w.label,
          cardValue: kpis.current.expiringSoon,
          sheetRows: (await rowsFor('expiring-docs', true)).length,
        },
        true
      );
    }
    expect(checked.length).toBeGreaterThan(0);
  });

  it('markbook', async () => {
    const { getMarkbookKpisRange } = await import('@/lib/markbook/dashboard');
    const { buildMarkbookDrillRows } = await import('@/lib/markbook/drill');

    for (const w of WINDOWS) {
      const kpis = await getMarkbookKpisRange({
        ayCode: AY,
        from: w.from,
        to: w.to,
        cmpFrom: null,
        cmpTo: null,
      });
      const rowsFor = async (target: string, segment?: string) =>
        await buildMarkbookDrillRows({
          ayCode: AY,
          from: w.from,
          to: w.to,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          target: target as any,
          segment: segment ?? null,
          allowedSectionIds: null,
        });

      record(
        {
          module: 'markbook',
          card: 'Grades entered',
          target: 'grade-entries',
          window: w.label,
          cardValue: kpis.current.gradesEntered,
          sheetRows: (await rowsFor('grade-entries')).length,
        },
        true
      );
      record(
        {
          module: 'markbook',
          card: 'Sheets locked (range)',
          target: 'sheets-locked',
          window: w.label,
          cardValue: kpis.current.sheetsLocked,
          sheetRows: (await rowsFor('sheets-locked')).length,
        },
        true
      );
      record(
        {
          module: 'markbook',
          card: 'Change requests pending',
          target: 'change-requests',
          window: w.label,
          cardValue: kpis.current.changeRequestsPending,
          sheetRows: (await rowsFor('change-requests', 'pending')).length,
        },
        true
      );
    }
    expect(checked.length).toBeGreaterThan(0);
  });

  it('evaluation', async () => {
    const { getEvaluationKpisRange, getEvaluationChaseKpis } =
      await import('@/lib/evaluation/dashboard');
    const { buildEvaluationDrillRows } = await import('@/lib/evaluation/drill');

    const chase = await getEvaluationChaseKpis(AY);
    for (const w of WINDOWS) {
      const kpis = await getEvaluationKpisRange({
        ayCode: AY,
        from: w.from,
        to: w.to,
        cmpFrom: null,
        cmpTo: null,
      });
      const rowsFor = async (target: string) =>
        await buildEvaluationDrillRows({
          ayCode: AY,
          from: w.from,
          to: w.to,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          target: target as any,
          segment: null,
          allowedSectionIds: null,
        });

      record(
        {
          module: 'evaluation',
          card: 'Submission % (rate)',
          target: 'submission-status',
          window: w.label,
          cardValue: kpis.current.submissionPct,
          sheetRows: (await rowsFor('submission-status')).length,
        },
        false
      );
      record(
        {
          module: 'evaluation',
          card: 'Submitted',
          target: 'submitted',
          window: w.label,
          cardValue: kpis.current.submitted,
          sheetRows: (await rowsFor('submitted')).length,
        },
        true
      );
    }

    if (chase.available) {
      record(
        {
          module: 'evaluation',
          card: 'Outstanding write-ups',
          target: 'outstanding-writeups',
          window: 'live-state',
          cardValue: chase.outstandingWriteups,
          sheetRows: (
            await buildEvaluationDrillRows({
              ayCode: AY,
              target: 'outstanding-writeups',
              segment: null,
              allowedSectionIds: null,
            })
          ).length,
        },
        true
      );
      record(
        {
          module: 'evaluation',
          card: 'Advisers behind',
          target: 'advisers-behind',
          window: 'live-state',
          cardValue: chase.advisersBehind,
          sheetRows: (
            await buildEvaluationDrillRows({
              ayCode: AY,
              target: 'advisers-behind',
              segment: null,
              allowedSectionIds: null,
            })
          ).length,
        },
        true
      );
    }
    expect(checked.length).toBeGreaterThan(0);
  });

  it('p-files', async () => {
    const { getPFilesKpisRange } = await import('@/lib/p-files/dashboard');
    const { buildPFilesDrillRows, applyTargetFilter } =
      await import('@/lib/p-files/drill');

    for (const w of WINDOWS) {
      const kpis = await getPFilesKpisRange({
        ayCode: AY,
        from: w.from,
        to: w.to,
        cmpFrom: null,
        cmpTo: null,
      });
      const all = await buildPFilesDrillRows({
        ayCode: AY,
        from: w.from,
        to: w.to,
      });
      const rowsFor = (target: string, segment: string | null) =>
        applyTargetFilter(
          all,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          target as any,
          segment,
          { from: w.from, to: w.to }
        );

      record(
        {
          module: 'p-files',
          card: 'Expiring <=30d',
          target: 'expiring-soon(30)',
          window: w.label,
          cardValue: kpis.current.expiringSoon30,
          sheetRows: rowsFor('expiring-soon', '30').length,
        },
        true
      );
      record(
        {
          module: 'p-files',
          card: 'Expiring <=60d',
          target: 'expiring-soon(60)',
          window: w.label,
          cardValue: kpis.current.expiringSoon,
          sheetRows: rowsFor('expiring-soon', '60').length,
        },
        true
      );
      record(
        {
          module: 'p-files',
          card: 'Total docs tracked',
          target: 'all-docs',
          window: w.label,
          cardValue: kpis.current.totalDocuments,
          sheetRows: rowsFor('all-docs', null).length,
        },
        true
      );
      record(
        {
          module: 'p-files',
          card: 'Revisions (range)',
          target: 'revisions-on-day',
          window: w.label,
          cardValue: kpis.current.revisionsInRange,
          sheetRows: rowsFor('revisions-on-day', null).length,
        },
        true
      );
    }
    expect(checked.length).toBeGreaterThan(0);
  });

  it('reports every pair', () => {
    const fmt = (f: Finding) =>
      `${f.cardValue === f.sheetRows ? 'OK  ' : 'DIFF'} ${f.module.padEnd(11)} ${f.card.padEnd(26)} ${f.target.padEnd(20)} ${f.window.padEnd(10)} card=${f.cardValue} sheet=${f.sheetRows}`;
    // eslint-disable-next-line no-console
    console.log(
      [
        '',
        `checked ${checked.length} card/drill pairs`,
        ...checked.map(fmt),
        '',
        `MISMATCHES (count cards only): ${mismatches.length}`,
        ...mismatches.map(fmt),
        '',
      ].join('\n')
    );
  });
});
