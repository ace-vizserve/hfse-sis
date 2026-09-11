// scripts/backfill/verify-t3-reimport-applied.ts
// Read-only. Reports whether the T3 corrective re-import has actually landed,
// and what is left to do: calendar day types, marks written vs still missing,
// rollups recomputed, and the attendance spread.
//
// Run: npx tsx --env-file=.env.local scripts/backfill/verify-t3-reimport-applied.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { createServiceClient } from '../../lib/supabase/service';

const AY_CODE = 'AY2026';
const APPLY_DIR = 'scripts/backfill/ay2026-t3-attendance-reimport-apply';
const MARK_RE =
  /^\s*\('([0-9a-f-]{36})',\s*date '(\d{4}-\d{2}-\d{2})',\s*'([A-Z]{1,2})'\),?;?$/;

async function main() {
  const svc = createServiceClient();
  const { data: ay } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY_CODE)
    .single();
  const { data: term } = await svc
    .from('terms')
    .select('id')
    .eq('academic_year_id', (ay as any).id)
    .eq('term_number', 3)
    .single();
  const termId = (term as any).id;

  // --- calendar ---
  const { data: cal } = await svc
    .from('school_calendar')
    .select('date, day_type')
    .eq('term_id', termId);
  const byType: Record<string, number> = {};
  for (const r of cal as any[])
    byType[r.day_type] = (byType[r.day_type] ?? 0) + 1;
  console.log('school_calendar day types:', JSON.stringify(byType));
  const schoolDays = (cal as any[]).filter(
    (r) => r.day_type === 'school_day'
  ).length;
  console.log(
    `  school days: ${schoolDays}   (30 = not applied, 50 = applied)\n`
  );

  // --- marks ---
  const raw: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await svc
      .from('attendance_daily')
      .select('section_student_id, date, status, recorded_by, recorded_at')
      .eq('term_id', termId)
      .is('period_id', null)
      .order('section_student_id')
      .order('date')
      .order('recorded_at', { ascending: true })
      .range(from, from + 999);
    const rows = (data ?? []) as any[];
    raw.push(...rows);
    if (rows.length < 1000) break;
  }
  const live = new Map<string, any>();
  for (const r of raw) live.set(`${r.section_student_id}|${r.date}`, r);
  console.log(`attendance_daily rows written: ${raw.length}`);
  console.log(`live marks:                    ${live.size}\n`);

  // --- compare against what the apply files want ---
  const want = new Map<string, string>();
  for (const f of readdirSync(APPLY_DIR).sort()) {
    for (const line of readFileSync(join(APPLY_DIR, f), 'utf8').split('\n')) {
      const m = MARK_RE.exec(line);
      if (m) want.set(`${m[1]}|${m[2]}`, m[3]);
    }
  }
  let stillMissing = 0;
  let stillWrong = 0;
  let done = 0;
  const missingByChunkDate = new Map<string, number>();
  for (const [k, v] of want) {
    const l = live.get(k);
    if (!l) {
      stillMissing++;
      const d = k.split('|')[1];
      missingByChunkDate.set(d, (missingByChunkDate.get(d) ?? 0) + 1);
    } else if (l.status !== v) stillWrong++;
    else done++;
  }
  console.log(`register marks the files carry: ${want.size}`);
  console.log(`  now correct in the system:    ${done}`);
  console.log(`  still missing:                ${stillMissing}`);
  console.log(`  still at the old value:       ${stillWrong}`);
  if (stillMissing > 0) {
    const dates = [...missingByChunkDate.keys()].sort();
    console.log(
      `  missing spans ${dates[0]} .. ${dates[dates.length - 1]} across ${dates.length} dates`
    );
  }
  console.log('');

  // --- rollups ---
  const { data: recs } = await svc
    .from('attendance_records')
    .select(
      'section_student_id, school_days, days_present, days_absent, days_late, days_excused, attendance_pct'
    )
    .eq('term_id', termId);
  const rr = (recs ?? []) as any[];
  const pcts = rr
    .map((r) => Number(r.attendance_pct))
    .filter((n) => !Number.isNaN(n));
  const sdays = [...new Set(rr.map((r) => r.school_days))].sort(
    (a, b) => a - b
  );
  console.log(`attendance_records rows: ${rr.length}`);
  console.log(`  school_days values on the rollups: ${sdays.join(', ')}`);
  if (pcts.length) {
    const sum = pcts.reduce((a, b) => a + b, 0);
    console.log(
      `  attendance_pct  min ${Math.min(...pcts).toFixed(2)}  avg ${(sum / pcts.length).toFixed(1)}  max ${Math.max(...pcts).toFixed(2)}`
    );
  }
  const stale = rr.filter(
    (r) => r.school_days !== schoolDays && r.school_days > 0
  );
  console.log(
    `  rollups whose school_days != ${schoolDays}: ${stale.length} (late enrollees prorate, so some are expected)`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  });
