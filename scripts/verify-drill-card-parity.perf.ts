/**
 * Card number vs drill-sheet row count, on live data, for the four attendance
 * cards whose drills used to hand back the whole roster.
 *
 * Before the fix (AY2026, 2026-09-15): compassionate card "0 over / 0 near" →
 * 398 rows; vacation leave "0 over / 2 at limit" → 398 rows; top-absent /
 * top-active previewed 10 rows of a ranking whose drill returned 398,
 * zero-absence students included, and top-active came back in the top-absent
 * order.
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
const FROM = '2026-09-01';
const TO = '2026-09-15';

describe('attendance quota + ranking cards vs their drills', () => {
  it('the drill returns the set the card counted', async () => {
    const {
      buildAllRowSets,
      buildAttendanceDrillRows,
      selectAtRiskCompassionate,
      selectAtRiskVacationLeave,
      sortTopActive,
      TOP_ATTENDANCE_LIST_LIMIT,
    } = await import('@/lib/attendance/drill');
    const { createServiceClient } = await import('@/lib/supabase/service');
    const svc = createServiceClient();

    const { data: ay } = await svc
      .from('academic_years')
      .select('id')
      .eq('ay_code', AY)
      .single();
    const { data: terms } = await svc
      .from('terms')
      .select('id, term_number')
      .eq('academic_year_id', (ay as { id: string }).id)
      .order('term_number');
    const termList = (terms ?? []) as Array<{
      id: string;
      term_number: number;
    }>;
    const term = termList[termList.length - 1]!;

    // What the CARDS are handed (the raw rollups) and what they display.
    const rowSets = await buildAllRowSets({
      ayCode: AY,
      from: FROM,
      to: TO,
      vacationTermId: term.id,
      defaultVlAllowance: 1,
    });
    const compCard = selectAtRiskCompassionate(rowSets.compassionate);
    const vlCard = selectAtRiskVacationLeave(rowSets.vacationLeave);
    const absentCard = rowSets.topAbsent
      .filter((r) => r.absences > 0)
      .slice(0, TOP_ATTENDANCE_LIST_LIMIT);
    const activeCard = sortTopActive(
      rowSets.topAbsent.filter((r) => r.encodedDays > 0)
    ).slice(0, TOP_ATTENDANCE_LIST_LIMIT);

    // What the SHEETS now fetch.
    const sheet = async (target: string, termId?: string) =>
      (await buildAttendanceDrillRows({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        target: target as any,
        ayCode: AY,
        from: FROM,
        to: TO,
        termId: termId ?? null,
        defaultVlAllowance: 1,
      })) as Array<Record<string, unknown>>;

    const comp = await sheet('compassionate-quota');
    const vl = await sheet('vacation-leave-quota', term.id);
    const absent = await sheet('top-absent');
    const active = await sheet('top-active');

    // Two independent reads of the same ledger — the card's and the sheet's.
    // `loadEntryRows` used to read attendance_daily unordered while paginating
    // with .range(), so two calls in one process could disagree: one dropped 9
    // students and 1,844 marks the other kept. It is ordered and deduped now,
    // and this is what says so.
    const rankingReadIsStable =
      JSON.stringify(
        rowSets.topAbsent
          .filter((r) => r.absences > 0)
          .map((r) => `${r.studentNumber}:${r.absences}:${r.encodedDays}`)
      ) ===
      JSON.stringify(
        absent.map((r) => `${r.studentNumber}:${r.absences}:${r.encodedDays}`)
      );

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          rosterTracked: rowSets.compassionate.length,
          rankingReadIsStable,
          compassionate: {
            cardAtRisk: compCard.length,
            sheetRows: comp.length,
            zeroUsageRowsInSheet: comp.filter((r) => r.used === 0).length,
          },
          vacationLeave: {
            term: term.term_number,
            cardAtRisk: vlCard.length,
            sheetRows: vl.length,
            zeroUsageRowsInSheet: vl.filter((r) => r.usedThisTerm === 0).length,
          },
          topAbsent: {
            cardPreviewRows: absentCard.length,
            sheetRows: absent.length,
            neverAbsentRowsInSheet: absent.filter((r) => r.absences === 0)
              .length,
            cardIsPrefixOfSheet:
              JSON.stringify(absent.slice(0, absentCard.length)) ===
              JSON.stringify(absentCard),
          },
          topActive: {
            cardPreviewRows: activeCard.length,
            sheetRows: active.length,
            unencodedRowsInSheet: active.filter((r) => r.encodedDays === 0)
              .length,
            sheetLeadsWithBestAttender:
              (active[0]?.studentName ?? null) ===
              (activeCard[0]?.studentName ?? null),
          },
        },
        null,
        2
      )
    );

    // Parity, asserted.
    expect(comp.length).toBe(compCard.length);
    expect(vl.length).toBe(vlCard.length);
    expect(comp.filter((r) => r.used === 0)).toHaveLength(0);
    expect(vl.filter((r) => r.usedThisTerm === 0)).toHaveLength(0);
    expect(absent.filter((r) => r.absences === 0)).toHaveLength(0);
    expect(active.filter((r) => r.encodedDays === 0)).toHaveLength(0);
    // Ordering is a property of the returned set on its own.
    const absentRanked = absent as unknown as Array<{
      absences: number;
      lates: number;
    }>;
    for (let i = 1; i < absentRanked.length; i++) {
      const prev = absentRanked[i - 1]!;
      const cur = absentRanked[i]!;
      expect(
        prev.absences > cur.absences ||
          (prev.absences === cur.absences && prev.lates >= cur.lates)
      ).toBe(true);
    }
    const activeRanked = active as unknown as Array<{
      absences: number;
      attendancePct: number;
    }>;
    for (let i = 1; i < activeRanked.length; i++) {
      const prev = activeRanked[i - 1]!;
      const cur = activeRanked[i]!;
      expect(
        prev.absences < cur.absences ||
          (prev.absences === cur.absences &&
            prev.attendancePct >= cur.attendancePct)
      ).toBe(true);
    }

    // The card's read and the sheet's read are two separate calls into
    // `loadEntryRows`. Now that it is ordered and deduped they agree, so this
    // is assertable — when it is false, the read has regressed, not the filter.
    expect(rankingReadIsStable).toBe(true);
    expect(absent.slice(0, absentCard.length)).toEqual(absentCard);
    expect(active.slice(0, activeCard.length)).toEqual(activeCard);
  });

  it('the KPI cards and their sheets count the same marks', async () => {
    const { getAttendanceKpisRange } =
      await import('@/lib/attendance/dashboard');
    const { buildAttendanceDrillRows } = await import('@/lib/attendance/drill');

    // The cards read migration 148's RPCs — `distinct on (section_student_id,
    // date, period_id) order by recorded_at desc, id` plus `status is not
    // null`. The sheets read `loadEntryRows`, which now applies the same rule
    // in Node. Two independent implementations of one rule, so compare them.
    // Both the page's own window and the whole year — the year is where the
    // gap was widest before the fix (Absences 880 card / 983 sheet).
    const windows: Array<[string, string]> = [
      [FROM, TO],
      ['2000-01-01', '2100-01-01'],
    ];

    // ⚠ BRACKETED, because teachers mark attendance while this runs.
    //
    // The card and the sheet are two separate reads of a table being written
    // to, so a run during morning registration straddles new marks and the two
    // differ by a row or three for a reason that is not a bug: measured
    // 2026-09-15, three consecutive runs walked 1,230 → 1,245 → 1,248 marks.
    // So each figure is read BEFORE and AFTER the sheet, and the sheet has to
    // land inside that bracket. On a quiet window the bracket collapses and
    // this is exact equality — which is how the full-year window verified at
    // 48,483 = 48,483 earlier the same day.
    const kpisFor = (from: string, to: string) =>
      getAttendanceKpisRange({
        ayCode: AY,
        from,
        to,
        cmpFrom: null,
        cmpTo: null,
      });
    const within = (
      label: string,
      value: number,
      before: number,
      after: number
    ) => {
      const lo = Math.min(before, after);
      const hi = Math.max(before, after);
      expect(
        value >= lo && value <= hi,
        `${label}: sheet ${value} outside card bracket [${lo}, ${hi}]`
      ).toBe(true);
    };

    for (const [from, to] of windows) {
      const kpis = await kpisFor(from, to);
      const sheet = async (target: string) =>
        (await buildAttendanceDrillRows({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          target: target as any,
          ayCode: AY,
          from,
          to,
        })) as Array<Record<string, unknown>>;

      const lates = await sheet('lates');
      const excused = await sheet('excused');
      const absent = await sheet('absent');
      const summary = await sheet('attendance-summary');
      const kpisAfter = await kpisFor(from, to);
      const cardAllMarks =
        kpis.current.present +
        kpis.current.late +
        kpis.current.excused +
        kpis.current.absent;

      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          {
            window: `${from}..${to}`,
            lateIncidents: { card: kpis.current.late, sheetRows: lates.length },
            excused: { card: kpis.current.excused, sheetRows: excused.length },
            absences: { card: kpis.current.absent, sheetRows: absent.length },
            allMarks: { card: cardAllMarks, sheetRows: summary.length },
            blankStatusRowsInSheet: summary.filter((r) => r.status == null)
              .length,
            cardMovedDuringTheRun:
              cardAllMarks !==
              kpisAfter.current.present +
                kpisAfter.current.late +
                kpisAfter.current.excused +
                kpisAfter.current.absent,
          },
          null,
          2
        )
      );

      within('lates', lates.length, kpis.current.late, kpisAfter.current.late);
      within(
        'excused',
        excused.length,
        kpis.current.excused,
        kpisAfter.current.excused
      );
      within(
        'absences',
        absent.length,
        kpis.current.absent,
        kpisAfter.current.absent
      );
      expect(summary.filter((r) => r.status == null)).toHaveLength(0);
      // `attendance-summary` excludes NC, which the KPI reports separately.
      within(
        'all marks',
        summary.length,
        cardAllMarks,
        kpisAfter.current.present +
          kpisAfter.current.late +
          kpisAfter.current.excused +
          kpisAfter.current.absent
      );
    }
  });
});
