// Read-only: is migration 181 (house points tables) applied to production?
// Selects a row count from each of the six tables and prints the seeded
// house_point_scales rows grouped by event_type. Writes nothing.
//
// Usage: npx tsx --env-file=.env.local scripts/probe-migration-181.ts

import { createServiceClient } from '../lib/supabase/service';

const sb = createServiceClient();

const TABLES = [
  'house_point_scales',
  'house_point_events',
  'house_point_places',
  'house_point_teams',
  'house_point_team_members',
  'house_point_entries',
] as const;

async function main() {
  let allPresent = true;

  for (const table of TABLES) {
    const { count, error } = await sb
      .from(table)
      .select('*', { count: 'exact', head: true });
    if (error) {
      allPresent = false;
      console.log(`${table}: MISSING —`, error.message);
    } else {
      console.log(`${table}: ${count} row(s)`);
    }
  }

  console.log('181 tables present:', allPresent);

  if (!allPresent) return;

  const { data: scales, error: scalesErr } = await sb
    .from('house_point_scales')
    .select('event_type, label, rank, points, sort_order')
    .order('event_type')
    .order('sort_order');
  if (scalesErr) throw scalesErr;

  const byType = new Map<string, typeof scales>();
  for (const row of scales ?? []) {
    const bucket = byType.get(row.event_type) ?? [];
    bucket.push(row);
    byType.set(row.event_type, bucket);
  }

  console.log('\nhouse_point_scales, by event_type:');
  for (const [eventType, rows] of byType) {
    console.log(` ${eventType}:`);
    for (const r of rows ?? []) {
      console.log(
        `   ${r.sort_order}. ${r.label} (rank ${r.rank ?? 'null'}) — ${r.points} pts`
      );
    }
  }

  const expectedCount = 14; // 4 + 4 + 4 + 2, per the migration's seed
  console.log(
    '\n181 scale seed applied:',
    (scales?.length ?? 0) === expectedCount
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
