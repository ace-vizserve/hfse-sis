// Renumbers `admission_options.sort_order` to the parent portal's own level
// order, so the portal switching to the SIS list moves nothing a parent sees.
//
// The first seed ordered rows by SIS level, which put the five "HFSE
// International Education Programme" levels beside the level each counts as
// instead of at the end of the dropdown, where the portal has always had them.
// Found when the portal's Phase 5 check ran the live endpoint through its own
// derivation on 2026-09-24: same options, different level order.
//
// Touches `sort_order` ONLY — never `is_open`, labels or levels. Rows are
// matched by (level_label, class_type_label, schedule) against what the
// corrected seed builds; a row the seed does not build (added by staff on the
// admin page) keeps its number, shifted after the seeded rows.
//
// ⚠ RUNS AS THE SERVICE ROLE, so NO `audit_log` ROW EXISTS. This header is
// the record.
//
// Run:
//   npx tsx --env-file=.env.local scripts/backfill/apply-admission-options-portal-order.ts          (dry run)
//   npx tsx --env-file=.env.local scripts/backfill/apply-admission-options-portal-order.ts --apply
import { createServiceClient } from '../../lib/supabase/service';
import {
  SEED_AY_CODES,
  buildAdmissionOptionRows,
  loadAyIds,
  loadLevelCatalog,
} from './seed-admission-options';

const APPLY = process.argv.includes('--apply');
const sb = createServiceClient();

const key = (r: {
  level_label: string;
  class_type_label: string;
  schedule: string;
}) => `${r.level_label}\u0000${r.class_type_label}\u0000${r.schedule}`;

async function main() {
  const { levels, aliases } = await loadLevelCatalog(sb);
  const ayIds = await loadAyIds(sb, SEED_AY_CODES);
  let changes = 0;
  const updates: Array<{ id: string; sort_order: number }> = [];

  for (const ay of SEED_AY_CODES) {
    const ayId = ayIds.get(ay);
    if (!ayId) throw new Error(`No academic year ${ay}`);
    const wanted = new Map(
      buildAdmissionOptionRows(ayId, levels, aliases).map((r) => [
        key(r),
        r.sort_order,
      ])
    );
    const maxWanted = Math.max(...wanted.values());

    const { data, error } = await sb
      .from('admission_options')
      .select('id, level_label, class_type_label, schedule, sort_order')
      .eq('academic_year_id', ayId)
      .order('sort_order');
    if (error) throw error;

    let extra = 0;
    for (const row of data ?? []) {
      const target = wanted.get(key(row)) ?? maxWanted + ++extra * 10;
      if (target !== row.sort_order) {
        updates.push({ id: row.id, sort_order: target });
        changes += 1;
      }
    }
    console.log(
      `${ay}: ${data?.length ?? 0} row(s), ${extra} not from the seed, ` +
        `${updates.length} to renumber so far`
    );
  }

  if (!APPLY) {
    console.log(
      `\nDRY RUN — re-run with --apply to renumber ${changes} row(s).`
    );
    return;
  }
  for (const u of updates) {
    const { error } = await sb
      .from('admission_options')
      .update({ sort_order: u.sort_order })
      .eq('id', u.id);
    if (error) throw error;
  }
  console.log(`\nRenumbered ${changes} row(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
