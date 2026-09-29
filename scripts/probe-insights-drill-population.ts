// Measures how far the Admissions Insights figures move when their loaders
// switch from a status-first to an application-first join (KD #229, phase 3
// of docs/superpowers/plans/2026-09-29-insights-drill-sheets.md).
//
// STRICTLY READ-ONLY — every statement is a SELECT. Safe against production.
// Run it against PRODUCTION, not the seeder.
//
// Run:
//   npx tsx --env-file=.env.local scripts/probe-insights-drill-population.ts
import { prefixFor } from '../lib/admissions/_shared';
import { fetchAllPages } from '../lib/supabase/paginate';
import { createServiceClient } from '../lib/supabase/service';

type App = { enroleeNumber: string | null; created_at: string | null };
type Status = {
  enroleeNumber: string | null;
  applicationStatus: string | null;
  applicationTerminalReason: string | null;
};
type P<T> = PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
}>;

const CANONICAL = new Set([
  'Submitted',
  'Ongoing Verification',
  'Processing',
  'Enrolled',
  'Enrolled (Conditional)',
  'Withdrawn',
  'Cancelled',
]);

async function main() {
  const supabase = createServiceClient();
  for (const ay of ['AY2025', 'AY2026', 'AY2027']) {
    const p = prefixFor(ay);
    const apps = await fetchAllPages<App>(
      (from, to) =>
        supabase
          .from(`${p}_enrolment_applications`)
          .select('enroleeNumber, created_at')
          .range(from, to) as unknown as P<App>
    );
    const statuses = await fetchAllPages<Status>(
      (from, to) =>
        supabase
          .from(`${p}_enrolment_status`)
          .select(
            'enroleeNumber, applicationStatus, "applicationTerminalReason"'
          )
          .range(from, to) as unknown as P<Status>
    );
    const appNumbers = new Set(
      apps.map((a) => a.enroleeNumber).filter((n): n is string => !!n)
    );
    const statusCount = new Map<string, number>();
    for (const s of statuses) {
      if (s.enroleeNumber) {
        statusCount.set(
          s.enroleeNumber,
          (statusCount.get(s.enroleeNumber) ?? 0) + 1
        );
      }
    }
    const orphan = (s: Status) =>
      !s.enroleeNumber || !appNumbers.has(s.enroleeNumber);
    console.log(ay, {
      applications: apps.length,
      applicationsWithoutNumber: apps.filter((a) => !a.enroleeNumber).length,
      statusRows: statuses.length,
      statusRowsWithoutApplication: statuses.filter(orphan).length,
      applicationsWithoutStatusRow: [...appNumbers].filter(
        (n) => !statusCount.has(n)
      ).length,
      applicantsWithDuplicateStatusRows: [...statusCount.values()].filter(
        (c) => c > 1
      ).length,
      statusRowsBlankOrNonCanonical: statuses.filter(
        (s) => !CANONICAL.has((s.applicationStatus ?? '').trim())
      ).length,
      terminalReasonRows: statuses.filter(
        (s) => s.applicationTerminalReason !== null
      ).length,
      terminalReasonRowsWithoutApplication: statuses.filter(
        (s) => s.applicationTerminalReason !== null && orphan(s)
      ).length,
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
