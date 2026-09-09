import { SectionSummaryCard } from '@/components/attendance/section-summary-card';
import { getSectionAttendanceSummary } from '@/lib/attendance/queries';
import { sgToday } from '@/lib/dates';

// Compact attendance rollup card for /markbook/sections/[id]. Reads
// `attendance_records` (shared rollup target, KD #47) and the school calendar,
// and deep-links into the Attendance module for editing. Never writes.
//
// The card itself is `components/attendance/section-summary-card.tsx`, shared
// with the Classroom Attendance tab. This file is now the fetch and the two
// things that differ between the surfaces: a smaller headline inside Markbook's
// stack, and a link that lands on today's register rather than the term view.
export async function SectionAttendanceSummary({
  sectionId,
  termId,
  termLabel,
}: {
  sectionId: string;
  termId: string;
  termLabel: string | null;
}) {
  const summary = await getSectionAttendanceSummary(sectionId, termId);

  return (
    <SectionSummaryCard
      summary={summary}
      termLabel={termLabel}
      headline="sm"
      // sgToday, not a hand-rolled local-time formatter. The old one here read
      // the SERVER's timezone: on a UTC host, "today" flips at 8am Singapore
      // time and the register opens on yesterday for the first third of the
      // school day.
      href={`/attendance/${sectionId}?date=${sgToday()}`}
      linkLabel="Mark attendance"
    />
  );
}
