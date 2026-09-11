// scripts/backfill/probe-cacao-supplies.ts
// Read-only. Shows Cacao's supplies stage as it stands now, what the audit log
// recorded for it, and what the supplies fields look like across every other
// enrolee — so an empty save can be told apart from the normal shape.
//
// Run: npx tsx --env-file=.env.local scripts/backfill/probe-cacao-supplies.ts
import { createServiceClient } from '../../lib/supabase/service';

const ENROLEE = 'E260309';

async function main() {
  const svc = createServiceClient();

  console.log('=== Cacao — every supplies field right now ===');
  const { data: row, error } = await svc
    .from('ay2026_enrolment_status')
    .select('*')
    .eq('enroleeNumber', ENROLEE)
    .single();
  if (error) throw error;
  for (const [k, v] of Object.entries(row as any))
    if (k.toLowerCase().startsWith('supplies'))
      console.log(
        `  ${k.padEnd(24)} ${v === null ? '(null)' : JSON.stringify(v)}`
      );

  console.log('\n=== his other stage statuses, for contrast ===');
  for (const k of [
    'applicationStatus',
    'registrationStatus',
    'documentStatus',
    'assessmentStatus',
    'contractStatus',
    'feeStatus',
    'classStatus',
    'orientationStatus',
  ])
    console.log(`  ${k.padEnd(24)} ${(row as any)[k] ?? '(null)'}`);

  console.log('\n=== audit_log entries mentioning him ===');
  const { data: audit, error: aErr } = await svc
    .from('audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(400);
  if (aErr) {
    console.log('  could not read audit_log:', aErr.message);
  } else {
    const hits = (audit as any[]).filter(
      (r) =>
        JSON.stringify(r).includes(ENROLEE) ||
        JSON.stringify(r).toUpperCase().includes('CACAO')
    );
    if (hits.length === 0) console.log('  none in the most recent 400 rows');
    for (const h of hits.slice(0, 8)) {
      console.log(
        `  ${h.created_at}  ${h.actor_email ?? h.actor_id ?? '?'}  ${h.action ?? ''}`
      );
      console.log(`     ${JSON.stringify(h).slice(0, 400)}`);
    }
  }

  console.log('\n=== supplies shape across all enrolees ===');
  const all: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await svc
      .from('ay2026_enrolment_status')
      .select(
        '"enroleeNumber", "applicationStatus", "suppliesStatus", "suppliesClaimedDate", "suppliesRemarks", "suppliesUpdatedDate", "suppliesUpdatedby"'
      )
      .range(from, from + 999);
    const page = (data ?? []) as any[];
    all.push(...page);
    if (page.length < 1000) break;
  }
  const status = new Map<string, number>();
  for (const r of all)
    status.set(
      r.suppliesStatus ?? '(null)',
      (status.get(r.suppliesStatus ?? '(null)') ?? 0) + 1
    );
  console.log('  suppliesStatus values:');
  for (const [k, v] of [...status].sort((a, b) => b[1] - a[1]))
    console.log(`    ${k}: ${v}`);

  const withDate = all.filter((r) => r.suppliesClaimedDate);
  const statusNoDate = all.filter(
    (r) => r.suppliesStatus && !r.suppliesClaimedDate
  );
  const dateNoStatus = all.filter(
    (r) => !r.suppliesStatus && r.suppliesClaimedDate
  );
  const touchedEmpty = all.filter(
    (r) => r.suppliesUpdatedDate && !r.suppliesStatus && !r.suppliesClaimedDate
  );
  console.log(`  with a claimed date:              ${withDate.length}`);
  console.log(`  status set but NO claimed date:    ${statusNoDate.length}`);
  console.log(`  claimed date but NO status:        ${dateNoStatus.length}`);
  console.log(`  stamped as updated yet fully empty:${touchedEmpty.length}`);
  for (const r of touchedEmpty.slice(0, 10))
    console.log(
      `      ${r.enroleeNumber}  updated ${r.suppliesUpdatedDate} by ${r.suppliesUpdatedby ?? '?'}`
    );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  });
