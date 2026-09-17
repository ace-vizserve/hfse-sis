// Can the PUBLIC ANON KEY read the AY admissions tables?
//
// WHY THIS EXISTS. Migration 025 backfills RLS onto every
// `ay{YY}_{enrolment_applications,enrolment_status,enrolment_documents,discount_codes}`
// table by walking pg_tables for `^ay[0-9]{2}_...`. This database names those
// tables with a FOUR-digit year (`ay2026_...`, per prefixFor in
// lib/sis/queries.ts), so that pattern matches nothing — the same defect that
// made migration 160's backfill a silent no-op (fixed in 161). 025's loop ran,
// reported success, and may have enabled RLS on zero tables.
//
// WHAT THIS CAN AND CANNOT ANSWER. `pg_policies` and `pg_tables` are not
// reachable through PostgREST (see scripts/verify-perf-migrations.ts:53), so
// this cannot read the RLS FLAG directly. It tests the question that actually
// matters instead: with nothing but the public anon key — the one shipped to
// every browser — do these tables hand back rows?
//
// ⚠ A "readable" result does NOT by itself prove RLS is off. 025's policy is
// `for all to public using (true)`, which is wide open BY DESIGN, so an
// enabled-RLS table with that policy reads exactly the same as a table with no
// RLS at all. Either way the answer to "can anon read the admissions form" is
// the same, and that is the finding.
//
// Writes nothing. Reads at most one row per table.

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error(
    'NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_KEY must be set'
  );
  process.exit(1);
}

const anon = createClient(url, anonKey);
const service = createClient(url, serviceKey);

const SUFFIXES = [
  'enrolment_applications',
  'enrolment_status',
  'enrolment_documents',
  'discount_codes',
] as const;

async function main() {
  const { data: ays, error } = await service
    .from('academic_years')
    .select('ay_code')
    .order('ay_code', { ascending: false });
  if (error) {
    console.error(`academic_years read failed: ${error.message}`);
    process.exit(1);
  }
  const ayCodes = (ays ?? []).map((a: { ay_code: string }) => a.ay_code);

  console.log('Reading with the PUBLIC ANON KEY — the one in every browser.\n');

  let readable = 0;
  let denied = 0;

  for (const ayCode of ayCodes) {
    const slug = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
    console.log(ayCode);
    for (const suffix of SUFFIXES) {
      const table = `${slug}_${suffix}`;
      // head+count: asks for the row COUNT without transferring any row, so
      // this never pulls a real child's record onto a developer machine.
      const { count, error: readErr } = await anon
        .from(table)
        .select('*', { count: 'exact', head: true });

      if (readErr) {
        const notFound = /does not exist|schema cache/i.test(readErr.message);
        console.log(
          `  ${table.padEnd(34)} ${notFound ? 'no such table' : `DENIED (${readErr.message})`}`
        );
        if (!notFound) denied += 1;
        continue;
      }
      readable += 1;
      console.log(
        `  ${table.padEnd(34)} 🔴 READABLE — ${count ?? '?'} rows visible to anon`
      );
    }
    console.log();
  }

  console.log('─'.repeat(60));
  console.log(`readable by anon: ${readable}    denied: ${denied}`);
  if (readable > 0) {
    console.log(
      '\n🔴 The public anon key can count/read these tables. Whether that is\n' +
        "   RLS-disabled or RLS-enabled-with-025's `using (true)` policy, the\n" +
        '   effective access is the same. These hold the full admissions form.'
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
