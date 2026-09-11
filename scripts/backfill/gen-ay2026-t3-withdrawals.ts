// scripts/backfill/gen-ay2026-t3-withdrawals.ts
// Generates the SQL that withdraws the children who stopped appearing on the
// Term 3 register but are still marked active. Emits SQL for review; writes
// nothing itself.
//
// Hard Rule #6: a withdrawn child STAYS in section_students with
// enrollment_status='withdrawn'. Nothing is deleted, no attendance is removed,
// and their index number is retired rather than reused (KD #136).
//
// The withdrawal date is the last day the register actually marks them, except
// where Admissions recorded a real date in its remarks — that wins, because it
// is the school's own record rather than an inference from a blank cell.
//
// Run: npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t3-withdrawals.ts
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createServiceClient } from '../../lib/supabase/service';
import { sqlString } from '../../lib/sis/backfill/enrollment/sql-escape';

const AY_CODE = 'AY2026';
const APPLY_DIR = 'scripts/backfill/ay2026-withdrawals-apply';

// Children whose T3 attendance stops mid-term and who are absent from the
// current register. Names as Records holds them.
const LEAVERS = [
  'Brown, James',
  'Cam, Isaac Lucas',
  'Tun, Aung Chan Myae',
  'Lagman, Julian Caleb',
  'Kalingo, Crisanto Omar',
  'Brown, Charles',
  'Calina, Xander Grae',
  'Gandol, Ethan Jacob',
  'Tolosa, Priam Rai',
];

// Where Admissions wrote a real last-day-of-attendance in its remarks, that
// date is used instead of the register's last mark.
const DOCUMENTED_LAST_DAY: Record<string, string> = {
  // "Relocating to the Phils. Withdrawal Approval: 22 June 2026.
  //  Last Day of Attendance: 31 July 2026"
  'Lagman, Julian Caleb': '2026-07-31',
};

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

async function main() {
  const svc = createServiceClient();

  const { data: ay, error: ayErr } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY_CODE)
    .single();
  if (ayErr) throw ayErr;

  const { data: ssRows, error: ssErr } = await svc
    .from('section_students')
    .select(
      'id, index_number, enrollment_status, withdrawal_date, students!inner(student_number, last_name, first_name), sections!inner(name, academic_year_id, levels!inner(code))'
    )
    .eq('sections.academic_year_id', (ay as any).id);
  if (ssErr) throw ssErr;

  const roster = (ssRows as any[]).map((r) => ({
    id: r.id,
    idx: r.index_number,
    status: r.enrollment_status,
    withdrawn: r.withdrawal_date,
    number: r.students.student_number,
    name: `${r.students.last_name}, ${r.students.first_name}`,
    sec: `${r.sections.levels.code} ${r.sections.name}`,
  }));

  const resolved: {
    row: (typeof roster)[number];
    lastMark: string | null;
    date: string;
    source: string;
  }[] = [];
  const problems: string[] = [];

  for (const name of LEAVERS) {
    const hits = roster.filter((r) => norm(r.name) === norm(name));
    if (hits.length !== 1) {
      problems.push(
        `  "${name}" matched ${hits.length} roster rows — skipped, resolve by hand`
      );
      continue;
    }
    const row = hits[0];

    // last day the register actually marks them, across every term
    const { data: marks, error: mErr } = await svc
      .from('attendance_daily')
      .select('date, status')
      .eq('section_student_id', row.id)
      .is('period_id', null)
      .not('status', 'is', null)
      .order('date', { ascending: false })
      .limit(1);
    if (mErr) throw mErr;
    const lastMark = (marks as any[])?.[0]?.date ?? null;

    const documented = DOCUMENTED_LAST_DAY[name];
    if (!documented && !lastMark) {
      problems.push(
        `  "${name}" has no attendance at all and no documented date — skipped, needs a date from the school`
      );
      continue;
    }
    resolved.push({
      row,
      lastMark,
      date: documented ?? lastMark!,
      source: documented
        ? 'date recorded in the admissions remarks'
        : 'last day the register marks them',
    });
  }

  const L: string[] = [];
  L.push('-- AY2026 — withdraw the children who stopped attending mid-year');
  L.push('--');
  L.push(
    '-- They are still flagged active in Records, and still "Enrolled" in'
  );
  L.push(
    '-- Admissions, but the Term 3 register stops marking them and no longer'
  );
  L.push('-- lists them at all.');
  L.push('--');
  L.push('-- Nothing is deleted. Hard Rule #6: a withdrawn child stays on the');
  L.push(
    '-- section roster with enrollment_status = withdrawn, keeps every mark'
  );
  L.push(
    '-- already recorded, and keeps their index number (KD #136 — retired,'
  );
  L.push('-- never reused).');
  L.push('--');
  L.push('-- Safe to re-run: only rows still marked active are touched.');
  L.push('--');
  for (const r of resolved) {
    L.push(`--   ${r.row.sec} #${r.row.idx} ${r.row.name} (${r.row.number})`);
    L.push(
      `--     withdrawal_date ${r.date} — ${r.source}${r.lastMark && r.lastMark !== r.date ? ` (register's last mark: ${r.lastMark})` : ''}`
    );
  }
  if (problems.length) {
    L.push('--');
    L.push('-- NOT INCLUDED:');
    problems.forEach((p) => L.push(`--${p}`));
  }
  L.push('--');
  L.push(
    '-- Admissions still says "Enrolled" for all of these. That side has to be'
  );
  L.push('-- updated in the Admissions module so the two agree.');
  L.push('--');
  L.push('begin;');
  L.push('');
  L.push('drop table if exists _withdrawals;');
  L.push(
    'create temp table _withdrawals (section_student_id uuid, last_day date) as'
  );
  L.push('values');
  // Name above the row, not after it — a trailing comment would swallow the
  // comma that separates VALUES entries.
  L.push(
    resolved
      .map(
        (r) =>
          `  -- ${r.row.sec} #${r.row.idx} ${r.row.name}\n  (${sqlString(r.row.id)}::uuid, date ${sqlString(r.date)})`
      )
      .join(',\n') + ';'
  );
  L.push('');
  L.push('update section_students ss');
  L.push("set enrollment_status = 'withdrawn',");
  L.push('    withdrawal_date = w.last_day');
  L.push('from _withdrawals w');
  L.push('where ss.id = w.section_student_id');
  L.push("  and ss.enrollment_status <> 'withdrawn';");
  L.push('');
  L.push('commit;');
  L.push('');
  L.push('-- === verification (read-only) ===');
  L.push(
    'select l.code, sec.name, ss.index_number, s.last_name, s.first_name, ss.enrollment_status, ss.withdrawal_date'
  );
  L.push('from section_students ss');
  L.push('join students s on s.id = ss.student_id');
  L.push('join sections sec on sec.id = ss.section_id');
  L.push('join levels l on l.id = sec.level_id');
  L.push(
    `where ss.id in (${resolved.map((r) => `${sqlString(r.row.id)}::uuid`).join(', ')})`
  );
  L.push('order by l.code, sec.name, ss.index_number;');

  rmSync(APPLY_DIR, { recursive: true, force: true });
  mkdirSync(APPLY_DIR, { recursive: true });
  writeFileSync(join(APPLY_DIR, '01-withdrawals.sql'), L.join('\n') + '\n');

  console.log(`${resolved.length} child(ren) to withdraw:`);
  for (const r of resolved)
    console.log(
      `  ${r.row.sec.padEnd(18)} #${String(r.row.idx).padStart(2)} ${r.row.name.padEnd(26)} ${r.date}  (${r.source})`
    );
  if (problems.length) {
    console.log('\nnot included:');
    problems.forEach((p) => console.log(p));
  }
  console.log(`\nWrote ${APPLY_DIR}/01-withdrawals.sql`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  });
