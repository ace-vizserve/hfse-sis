// What can the PUBLIC ANON KEY actually do? Full blast-radius probe.
//
// Context: `scripts/probe-ay-admissions-anon-read.ts` established that the
// anon key can READ the AY admissions tables. That is one question. This asks
// the three that decide how serious it is:
//
//   1. WRITES — can anon modify or delete admissions rows, not just read them?
//      Read-only exposure is a privacy problem. Write access is an integrity
//      problem, and a different order of urgency.
//   2. STORAGE — the tables hold URLs; the actual passports, birth
//      certificates and medical forms are FILES. A locked table in front of a
//      public bucket protects nothing.
//   3. BLAST RADIUS — is this the AY admissions tables only, or do the SIS's
//      own tables (students, grades, attendance) read too? Migration 004
//      tightened RLS across the SIS tables; this checks whether that held.
//
// ⚠ SAFETY. This writes NOTHING. The write probes use a WHERE clause that
// matches no row (`enroleeNumber = '__rls_probe_no_such_row__'`), so a
// permitted write still changes nothing — the answer is in whether Postgres
// refuses with 42501 (permission denied) or accepts and reports zero rows.
// The storage probe lists bucket metadata and never downloads a file.

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error('URL, ANON_KEY and SERVICE_KEY must all be set');
  process.exit(1);
}

const anon = createClient(url, anonKey);
const service = createClient(url, serviceKey);

const NO_SUCH_ROW = '__rls_probe_no_such_row__';

/**
 * ⚠ A ZERO-MATCH WRITE PROVES NOTHING, and an earlier version of this file
 * claimed otherwise.
 *
 * The reasoning was: a missing grant raises 42501 before the WHERE is
 * evaluated, so "no error" means the write was permitted. That is wrong under
 * RLS. Control-tested 2026-09-16 against `students`, a table anon demonstrably
 * cannot read (anon=0 rows, service=761): a zero-match UPDATE and DELETE there
 * ALSO returned no error. With no rows matching, there is nothing to refuse,
 * so silence is the answer in both the permitted and the forbidden case.
 *
 * Writes therefore cannot be settled from the client without actually
 * modifying a row, which this script will not do. Settle it in the SQL editor
 * instead — the query is in the findings doc.
 */
function verdict(error: { code?: string; message: string } | null): string {
  if (!error) return 'inconclusive (no error — see note above)';
  if (error.code === '42501' || /permission denied/i.test(error.message)) {
    return '✅ denied outright (42501)';
  }
  if (/does not exist|schema cache/i.test(error.message)) {
    return `— rejected before execution (${error.message.slice(0, 50)})`;
  }
  return `reached execution: ${error.code ?? ''} ${error.message.slice(0, 55)}`;
}

async function main() {
  // ── Which AY tables exist ───────────────────────────────────────────────
  const { data: ays } = await service
    .from('academic_years')
    .select('ay_code')
    .order('ay_code', { ascending: false });
  const ayCodes = (ays ?? []).map((a: { ay_code: string }) => a.ay_code);
  const newest = ayCodes[0];
  const slug = `ay${newest.replace(/^AY/i, '').toLowerCase()}`;
  const appsTable = `${slug}_enrolment_applications`;

  // ── 1. Writes ───────────────────────────────────────────────────────────
  console.log(`1. CAN ANON WRITE?  (probing ${appsTable}, matching no rows)\n`);

  const upd = await anon
    .from(appsTable)
    .update({ category: 'rls-probe' })
    .eq('enroleeNumber', NO_SUCH_ROW);
  console.log(`   UPDATE   ${verdict(upd.error)}`);

  const del = await anon
    .from(appsTable)
    .delete()
    .eq('enroleeNumber', NO_SUCH_ROW);
  console.log(`   DELETE   ${verdict(del.error)}`);

  // INSERT is probed with a row that cannot satisfy the table: if the grant is
  // missing we get 42501 BEFORE any constraint is evaluated, so a non-42501
  // error still tells us the write was permitted. Nothing is committed either
  // way — a permitted insert of this shape fails on the column check.
  const ins = await anon
    .from(appsTable)
    .insert({ __rls_probe_missing_column__: 1 } as unknown as Record<
      string,
      unknown
    >);
  console.log(`   INSERT   ${verdict(ins.error)}`);

  // ── 2. Storage ──────────────────────────────────────────────────────────
  console.log(
    '\n2. STORAGE — where the actual passports and certificates live\n'
  );
  const { data: buckets, error: bucketErr } = await anon.storage.listBuckets();
  if (bucketErr) {
    console.log(`   listBuckets: ✅ denied (${bucketErr.message})`);
  } else if (!buckets?.length) {
    console.log('   listBuckets: returned nothing');
  } else {
    for (const b of buckets) {
      console.log(
        `   ${b.name.padEnd(28)} ${b.public ? '🔴 PUBLIC — files readable by URL alone' : '✅ private'}`
      );
      const { data: files, error: listErr } = await anon.storage
        .from(b.name)
        .list('', { limit: 1 });
      console.log(
        `     └ anon list: ${listErr ? `✅ denied (${listErr.message.slice(0, 50)})` : `🔴 ALLOWED (${files?.length ?? 0} entries at root)`}`
      );
    }
  }

  // ── 3. Blast radius — the SIS's own tables ──────────────────────────────
  console.log('\n3. BLAST RADIUS — does this reach the SIS tables too?\n');
  const SIS_TABLES = [
    'students',
    'sections',
    'section_students',
    'grade_entries',
    'grading_sheets',
    'attendance_marks',
    'audit_log',
    'role_permissions',
    'academic_years',
  ];
  // ⚠ Compare anon against service. A table protected by RLS returns an EMPTY
  // SET to anon, not an error — so "no error, 0 rows" is the SAFE result, and
  // reading it as "readable" (as an earlier version did) inverts the finding.
  // Only anon seeing the same rows the service role sees is exposure.
  for (const t of SIS_TABLES) {
    const a = await anon.from(t).select('*', { count: 'exact', head: true });
    const s = await service.from(t).select('*', { count: 'exact', head: true });
    if (a.error) {
      const notFound = /does not exist|schema cache/i.test(a.error.message);
      console.log(
        `   ${t.padEnd(20)} ${notFound ? '— no table' : '✅ denied'}`
      );
      continue;
    }
    const anonCount = a.count ?? 0;
    const serviceCount = s.count ?? 0;
    console.log(
      `   ${t.padEnd(20)} anon=${String(anonCount).padStart(5)}  service=${String(serviceCount).padStart(5)}  ` +
        (anonCount === 0 && serviceCount > 0
          ? '✅ RLS filtering'
          : anonCount > 0
            ? '🔴 EXPOSED'
            : '(empty table)')
    );
  }

  // ── 4. Storage buckets, read as the service role ────────────────────────
  // anon.listBuckets() returns nothing whether or not buckets are public, so
  // it cannot answer this. The service role can see the `public` flag, which
  // is what decides whether a file is fetchable by URL with no key at all.
  console.log('\n4. BUCKET VISIBILITY (service-role view of the flag)\n');
  const { data: allBuckets } = await service.storage.listBuckets();
  for (const b of allBuckets ?? []) {
    console.log(
      `   ${b.name.padEnd(28)} ${b.public ? '🔴 public=true — any file readable by URL alone' : '✅ private'}`
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
