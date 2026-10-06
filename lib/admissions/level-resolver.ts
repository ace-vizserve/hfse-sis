import {
  loadLevelLabelResolver,
  makeLevelLabelResolver,
  type LevelLabelResolver,
} from '@/lib/sis/levels';
import { createServiceClient } from '@/lib/supabase/service';

// The rule itself lives in lib/sis/levels.ts so Records, Admissions and
// P-Files share one implementation; re-exported here so admissions imports
// keep working.
export { resolveChildLevel } from '@/lib/sis/levels';

// ─────────────────────────────────────────────────────────────────────────
// A child's level, as the Admissions and P-Files screens show, group, filter,
// sort and count it.
//
// An application stores the parent-facing name the enrolment form offered
// ("Year 10", "K2"); the enrolment form options map each name to the SIS level
// it counts as (`level_aliases`). Every admissions/P-Files loader resolves
// through that mapping SERVER-SIDE and hands the client the resolved label —
// so a "Year 10" child sits under Secondary Three, not in a bucket of its own.
// Client components never fetch aliases.
// ─────────────────────────────────────────────────────────────────────────

/**
 * The resolver for a loader. Build it INSIDE the uncached function of an
 * `unstable_cache`d loader. Never fails the page: a missing service client
 * (or any other failure) degrades to the alias-less resolver, which still
 * canonicalises exact and legacy-digit labels.
 */
export async function loadAdmissionsLevelResolver(): Promise<LevelLabelResolver> {
  try {
    return await loadLevelLabelResolver(createServiceClient());
  } catch (err) {
    console.warn(
      '[admissions/level-resolver] resolver unavailable, using labels as stored:',
      err instanceof Error ? err.message : String(err)
    );
    return makeLevelLabelResolver([], []);
  }
}
