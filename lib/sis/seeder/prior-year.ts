import type { SupabaseClient } from '@supabase/supabase-js';

import { ensureTestStructure } from './structural';
import { seedPopulated } from './populated';

/**
 * Provisions the prior-year test AY (AY9998) so compare-mode (KD #78),
 * Masterfile prior-year, and cross-year Records history have real data.
 *
 * Caller (switchEnvironment) passes the already-ensured AY9998 row. Lays down
 * the structural config (sections, terms, subject_configs, school_calendar,
 * grading_sheets) with all terms in the PRIOR calendar year, then fills every
 * term with full populated data. `seedPopulated` is now self-contained — it
 * creates students itself via admissions personas + buildSyncPlan — so
 * `seedTestAy` is no longer called.
 *
 * Idempotent: ensureTestStructure + seedPopulated converge on re-run (per-row
 * filters / natural-key skip-guards).
 *
 * Because AY9998's terms all sit in the prior calendar year (T1-T4 all
 * closed), `allTermsFull: true` fills every term — no temporal split needed
 * (that's only for AY9999's active T2). The deterministic seed keys off the
 * ay_code, so AY9998 gets its own stable dataset distinct from AY9999.
 */
export async function seedPriorYearTestAy(
  service: SupabaseClient,
  priorAy: { id: string; ay_code: string }
): Promise<void> {
  const currentYear = new Date().getFullYear();

  // Structural config — terms must sit in the PRIOR calendar year so
  // AY9998 is a fully-closed historical year.
  await ensureTestStructure(
    service,
    { id: priorAy.id, ay_code: priorAy.ay_code },
    { targetYear: currentYear - 1, forceOverwriteDates: true }
  );

  // Populated data — closed-AY mode (KD #95): every term gets full grades +
  // attendance + evaluation writeups so the Masterfile award badges, T4
  // report card General Average, and compare-mode prior-period panel render
  // with real numbers.
  await seedPopulated(service, priorAy, { allTermsFull: true });
}
