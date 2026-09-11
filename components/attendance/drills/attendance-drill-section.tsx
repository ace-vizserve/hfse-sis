import { AttendanceBySectionCard } from '@/components/attendance/drills/attendance-by-section-card';
import {
  DayTypeDrillCard,
  ExReasonDrillCard,
  TopAbsentDrillCard,
} from '@/components/attendance/drills/chart-drill-cards';
import { CompassionateQuotaCard } from '@/components/attendance/drills/compassionate-quota-card';
import { VacationLeaveQuotaCard } from '@/components/attendance/drills/vacation-leave-quota-card';
import type { ExReasonMix, DayTypePoint } from '@/lib/attendance/dashboard';
import { buildAllRowSets } from '@/lib/attendance/drill';

// The page owns the ~180k-row `buildAllRowSets` scan (creates the promise
// once, un-awaited) so it can share ONE scan between this section and the
// "Export CSV" button — both consumers await the same promise rather than
// triggering the scan twice. React still suspends on it here, independently
// of the fast top-of-fold (hero + PriorityPanel, KD #56/#57) and the
// range-scoped KPIs above it, which don't depend on this scan.
// `exMix`/`dayTypes` are cheap queries the page already fetched — passed
// through rather than re-fetched here.
export async function AttendanceDrillSection({
  ayCode,
  rangeFrom,
  rangeTo,
  vacationTermId,
  currentTermLabel,
  rowSetsPromise,
  exMix,
  dayTypes,
}: {
  ayCode: string;
  rangeFrom?: string;
  rangeTo?: string;
  vacationTermId: string | null;
  currentTermLabel: string | null;
  rowSetsPromise: ReturnType<typeof buildAllRowSets>;
  exMix: ExReasonMix[];
  dayTypes: DayTypePoint[];
}) {
  const drillRowSets = await rowSetsPromise;

  return (
    <>
      <section className="grid gap-4 lg:grid-cols-2">
        <ExReasonDrillCard
          data={exMix}
          ayCode={ayCode}
          rangeFrom={rangeFrom}
          rangeTo={rangeTo}
        />
        <DayTypeDrillCard
          data={dayTypes}
          ayCode={ayCode}
          rangeFrom={rangeFrom}
          rangeTo={rangeTo}
          initialCalendar={drillRowSets.calendar}
        />
      </section>

      <AttendanceBySectionCard
        data={drillRowSets.sectionAttendance}
        ayCode={ayCode}
        rangeFrom={rangeFrom}
        rangeTo={rangeTo}
      />

      <section className="grid gap-4 lg:grid-cols-2">
        <CompassionateQuotaCard
          data={drillRowSets.compassionate}
          ayCode={ayCode}
        />
        {vacationTermId && currentTermLabel && (
          <VacationLeaveQuotaCard
            data={drillRowSets.vacationLeave}
            ayCode={ayCode}
            termId={vacationTermId}
            termLabel={currentTermLabel}
          />
        )}
      </section>

      <TopAbsentDrillCard
        data={drillRowSets.topAbsent}
        ayCode={ayCode}
        rangeFrom={rangeFrom}
        rangeTo={rangeTo}
        initialTopAbsent={drillRowSets.topAbsent}
      />
    </>
  );
}
