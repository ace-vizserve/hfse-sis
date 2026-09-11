// scripts/backfill/apply-clear-non-teaching-marks.ts
// Clears attendance marks that sit on a day the calendar says is not a
// teaching day, for a given term.
//
// WHY THIS IS NEEDED. `recompute_attendance_rollup` (migration 068) counts
// every dated row in the term with a non-null status. It does NOT join
// school_calendar, so it has no idea whether a date is a teaching day. A mark
// left on a `no_class` date therefore still inflates that child's school_days
// and skews their percentage — it does not silently drop out, as was assumed.
//
// This surfaced after the T3 re-import moved 2026-07-04 (a Saturday) from
// school_day to no_class to match the finished register, which leaves the
// register blank there. Five P5 Perseverance children kept a mark from the
// July import and their rollups read 46 days instead of 45.
//
// A clear is an APPEND, not a delete (migration 134): a new ledger row with
// status null supersedes the old mark by `recorded_at desc` and falls out of
// every aggregate. Nothing is erased, and restoring is another append.
//
//   dry run (default):  npx tsx --env-file=.env.local scripts/backfill/apply-clear-non-teaching-marks.ts
//   for real:           npx tsx --env-file=.env.local scripts/backfill/apply-clear-non-teaching-marks.ts --apply
import { createServiceClient } from '../../lib/supabase/service';

const AY_CODE = 'AY2026';
// NOT `TERM` — that is the shell's terminal-type variable ("xterm"), which
// every shell sets, so reading it here yields NaN rather than a term number.
const TERM_NUMBER = Number(process.env.HFSE_TERM ?? 3);
const APPLY = process.argv.includes('--apply');

async function page<T>(
  svc: any,
  table: string,
  select: string,
  build?: (q: any) => any
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = svc
      .from(table)
      .select(select)
      .range(from, from + 999);
    if (build) q = build(q);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

async function main() {
  const svc = createServiceClient();

  const { data: ay, error: ayErr } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY_CODE)
    .single();
  if (ayErr) throw ayErr;

  const { data: term, error: tErr } = await svc
    .from('terms')
    .select('id')
    .eq('academic_year_id', (ay as any).id)
    .eq('term_number', TERM_NUMBER)
    .single();
  if (tErr) throw tErr;
  const termId = (term as any).id;

  const { data: cal, error: cErr } = await svc
    .from('school_calendar')
    .select('date, day_type')
    .eq('term_id', termId);
  if (cErr) throw cErr;
  const teaching = new Set(
    (cal as any[]).filter((c) => c.day_type === 'school_day').map((c) => c.date)
  );
  const nonTeaching = new Map(
    (cal as any[])
      .filter((c) => c.day_type !== 'school_day')
      .map((c) => [c.date, c.day_type])
  );

  const daily = await page<any>(
    svc,
    'attendance_daily',
    'section_student_id, date, status, recorded_by, recorded_at',
    (q: any) => q.eq('term_id', termId).is('period_id', null)
  );
  const live = new Map<string, any>();
  for (const d of [...daily].sort((a, b) =>
    a.recorded_at < b.recorded_at ? -1 : 1
  ))
    live.set(`${d.section_student_id}|${d.date}`, d);

  const stray = [...live.values()].filter(
    (d) => d.status !== null && !teaching.has(d.date)
  );

  const roster = await page<any>(
    svc,
    'section_students',
    'id, index_number, students!inner(last_name, first_name), sections!inner(name, academic_year_id, levels!inner(code))',
    (q: any) => q.eq('sections.academic_year_id', (ay as any).id)
  );
  const label = new Map(
    roster.map((r) => [
      r.id,
      `${r.sections.levels.code} ${r.sections.name} #${r.index_number} ${r.students.last_name}, ${r.students.first_name}`,
    ])
  );

  console.log(
    `${APPLY ? 'APPLYING' : 'DRY RUN'} — AY${AY_CODE.slice(2)} T${TERM_NUMBER}\n`
  );
  console.log(`  teaching days:      ${teaching.size}`);
  console.log(`  non-teaching days:  ${nonTeaching.size}`);
  console.log(`  marks on a non-teaching day: ${stray.length}\n`);

  if (stray.length === 0) {
    console.log('nothing to clear');
    return;
  }

  for (const s of stray)
    console.log(
      `  ${s.date} (${nonTeaching.get(s.date)})  ${label.get(s.section_student_id) ?? s.section_student_id}  = ${s.status}${s.recorded_by ? '   <- marked in-system, NOT cleared' : ''}`
    );

  // A mark a teacher entered inside the system is their decision, not the
  // register's — never clear it automatically.
  const toClear = stray.filter((s) => !s.recorded_by);
  const kept = stray.length - toClear.length;
  console.log(
    `\n  ${toClear.length} to clear, ${kept} left alone because a teacher marked them in-system`
  );

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to write.');
    return;
  }

  console.log('');
  const rows = toClear.map((s) => ({
    section_student_id: s.section_student_id,
    term_id: termId,
    date: s.date,
    status: null,
    ex_reason: null,
    ex_note: null,
    period_id: null,
    recorded_by: null,
  }));
  const { error: insErr } = await svc.from('attendance_daily').insert(rows);
  if (insErr)
    throw new Error(
      `clear failed: ${insErr.message ?? JSON.stringify(insErr)}`
    );
  console.log(`  appended ${rows.length} clearing row(s)`);

  const students = [...new Set(toClear.map((s) => s.section_student_id))];
  for (const id of students) {
    const { error } = await svc.rpc('recompute_attendance_rollup', {
      p_term_id: termId,
      p_section_student_id: id,
    });
    if (error)
      throw new Error(
        `rollup for ${label.get(id) ?? id}: ${error.message ?? JSON.stringify(error)}`
      );
  }
  console.log(`  recomputed ${students.length} rollup(s)`);

  console.log('\nverifying...');
  const after = await page<any>(
    svc,
    'attendance_daily',
    'section_student_id, date, status, recorded_at',
    (q: any) => q.eq('term_id', termId).is('period_id', null)
  );
  const liveAfter = new Map<string, any>();
  for (const d of [...after].sort((a, b) =>
    a.recorded_at < b.recorded_at ? -1 : 1
  ))
    liveAfter.set(`${d.section_student_id}|${d.date}`, d);
  const remaining = [...liveAfter.values()].filter(
    (d) => d.status !== null && !teaching.has(d.date) && !d.recorded_by
  );
  console.log(
    `  marks still on a non-teaching day: ${remaining.length} (expect ${0})`
  );

  const { data: rollups } = await svc
    .from('attendance_records')
    .select('section_student_id, school_days, days_present, attendance_pct')
    .eq('term_id', termId)
    .in('section_student_id', students);
  for (const r of (rollups ?? []) as any[])
    console.log(
      `  ${label.get(r.section_student_id)}: ${r.school_days} days, ${r.days_present} present, ${r.attendance_pct}%`
    );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  });
