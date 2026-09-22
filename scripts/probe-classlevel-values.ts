// Read-only: distinct classLevel values on the AY2026 status table, which is
// what the document-chase emails print as the class.
// Usage: npx tsx --env-file=.env.local scripts/probe-classlevel-values.ts
import { createServiceClient } from '../lib/supabase/service';

const sb = createServiceClient();

async function main() {
  for (const t of [
    'ay2026_enrolment_status',
    'ay2025_enrolment_status',
    'ay2027_enrolment_status',
  ]) {
    const { data, error } = await sb.from(t).select('classLevel, classSection');
    if (error) {
      console.log(`${t}: ERROR ${error.message}`);
      continue;
    }
    const counts = new Map<string, number>();
    for (const r of data ?? []) {
      const k = String((r as any).classLevel ?? '(null)');
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    console.log(`\n${t} — ${data?.length ?? 0} rows`);
    for (const [k, v] of [...counts].sort()) console.log(`   "${k}"  x${v}`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
