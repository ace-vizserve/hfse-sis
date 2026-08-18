// scripts/verify-awards-overview.ts
//
// Cross-checks computeAwardsOverview against the independently-written probe
// (scripts/probe-masterfile-integrity.ts). The probe walks the tables by hand;
// this runs the real production code path. Agreement between two separately
// written implementations is worth far more than either alone.
//
// STRICTLY READ-ONLY.
//   npx tsx --env-file=.env.local scripts/verify-awards-overview.ts
// `overview-data.ts` is marked `server-only`, which throws the moment it is
// imported outside a React Server Component. Neutralising the guard here is
// what lets this script exercise the REAL loader rather than a copy of it — a
// copy would agree with itself and prove nothing. Nothing else is stubbed.
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
const serverOnly = req.resolve('server-only');
req.cache[serverOnly] = {
  id: serverOnly,
  filename: serverOnly,
  loaded: true,
  exports: {},
  path: '',
  paths: [],
  children: [],
  parent: null,
  isPreloading: false,
  require: req,
} as NodeJS.Module;

async function main() {
  const { computeAwardsOverview } =
    await import('../lib/markbook/awards-overview-compute');
  const { loadOverviewDataUncached } =
    await import('../lib/markbook/overview-data');
  const { createServiceClient } = await import('../lib/supabase/service');

  const service = createServiceClient();
  const { data } = await service
    .from('academic_years')
    .select('id, ay_code, is_current')
    .eq('is_current', true)
    .limit(1)
    .maybeSingle();
  const ay = data as { id: string; ay_code: string } | null;
  if (!ay) return console.log('no current AY');

  // Uncached: `unstable_cache` needs a request-scoped incremental cache.
  const raw = await loadOverviewDataUncached(ay.ay_code, ay.id);
  const o = computeAwardsOverview({ ...raw });

  console.log(`AY ${o.ayCode} · ${o.categoryLabel}`);
  console.log(
    `thresholds  bronze ${o.thresholds.bronzeMin} silver ${o.thresholds.silverMin} gold ${o.thresholds.goldMin}`
  );
  console.log(
    `terms       ${o.coverage.termsMarked} of ${o.coverage.termsTotal} marked · awards settled: ${o.coverage.complete}`
  );
  console.log(
    `students    ${o.coverage.studentsWithMarks} with marks of ${o.coverage.studentsEnrolled} enrolled`
  );
  console.log(
    `standing    gold ${o.tiers.gold} · silver ${o.tiers.silver} · bronze ${o.tiers.bronze} · none ${o.tiers.none}`
  );
  console.log(
    `within 1pt  bronze ${o.withinReach.bronze} · silver ${o.withinReach.silver} · gold ${o.withinReach.gold} · total ${o.withinReach.total}`
  );
  console.log(`range       ${o.range?.min} – ${o.range?.max}`);
  console.log(
    `settled     ${o.students.filter((s) => s.official != null).length} students carry an official award`
  );
  console.log('\nBy level:');
  for (const l of o.levels) {
    console.log(
      `  ${l.levelLabel.padEnd(17)} gold ${String(l.tiers.gold).padStart(2)}  silver ${String(l.tiers.silver).padStart(2)}  bronze ${String(l.tiers.bronze).padStart(2)}  none ${String(l.tiers.none).padStart(3)}  avg ${l.average}`
    );
  }
  console.log('\nClosest to moving up:');
  for (const s of o.students.slice(0, 5)) {
    console.log(
      `  ${s.studentNumber.padEnd(10)} ${String(s.score).padStart(5)}  ${s.standing}  +${s.toNextBand} to ${s.nextBand}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
