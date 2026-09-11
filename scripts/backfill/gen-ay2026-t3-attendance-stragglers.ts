// scripts/backfill/gen-ay2026-t3-attendance-stragglers.ts
// Generates the SQL for the T3 register rows the main re-import held back
// because the child could not be matched to an SIS record. Emits SQL for
// review — writes nothing itself.
//
// Currently one case is resolvable:
//   Akter — the register spells her "Mst Rabaya", the SIS "Mst Rabiya".
//   Mr Ace confirmed the register spelling is correct, so the SIS name is
//   corrected and her 45 marks are then imported.
//
// Karl Miguel Cacao is NOT handled here: admissions has him at
// applicationStatus "Submitted" with no placement, so he has no students row
// to attach attendance to. Enrol him first, then re-run.
//
// Run: npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t3-attendance-stragglers.ts
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createServiceClient } from '../../lib/supabase/service';
import { parseWorkbookT3 } from '../../lib/sis/backfill/attendance/attendance-workbook-t3';
import { deriveSectionIdentity } from '../../lib/sis/backfill/enrollment/section-identity';
import { sqlString } from '../../lib/sis/backfill/enrollment/sql-escape';

const AY_CODE = 'AY2026';
const TERM_NUMBER = 3;
const YEAR = 2026;
const WORKBOOK = 'AY2026 Term 3 Attendance Latest.xlsx';
const APPLY_DIR = 'scripts/backfill/ay2026-t3-attendance-stragglers-apply';
const VALID = new Set(['P', 'A', 'EX', 'L']);

const MONTHS: Record<string, string> = {
  Jan: '01',
  Feb: '02',
  Mar: '03',
  Apr: '04',
  May: '05',
  Jun: '06',
  Jul: '07',
  Aug: '08',
  Sep: '09',
  Oct: '10',
  Nov: '11',
  Dec: '12',
};

function isoFor(raw: string): string | null {
  const [d, mon] = raw.split('-');
  const m = MONTHS[mon];
  return m ? `${YEAR}-${m}-${d.padStart(2, '0')}` : null;
}

function normalizeCleanNameT3(n: string): string {
  return n.replace(/\s*-\s*(\d+)$/, ' $1');
}

// Each straggler names the register row and the SIS student it belongs to.
const CASES = [
  {
    sheet: 'P3 Courageous',
    registerIndex: 13,
    registerName: 'AKTER, Mst Rabaya',
    studentId: '186c5e21-0c44-4a2a-ba40-54d650d34a4f',
    // Mr Ace, 2026-09-11: the register spelling is the correct one.
    renameTo: { lastName: 'Akter', firstName: 'Mst Rabaya' },
  },
];

async function main() {
  const svc = createServiceClient();

  const { data: ay, error: ayErr } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY_CODE)
    .single();
  if (ayErr) throw ayErr;

  const { data: term, error: termErr } = await svc
    .from('terms')
    .select('id')
    .eq('academic_year_id', (ay as any).id)
    .eq('term_number', TERM_NUMBER)
    .single();
  if (termErr) throw termErr;

  const { data: cal, error: calErr } = await svc
    .from('school_calendar')
    .select('date, day_type')
    .eq('term_id', (term as any).id);
  if (calErr) throw calErr;
  const schoolDay = new Set(
    (cal as any[]).filter((r) => r.day_type === 'school_day').map((r) => r.date)
  );

  const sections = parseWorkbookT3(WORKBOOK);
  const lines: string[] = [];
  let totalMarks = 0;

  lines.push('-- AY2026 T3 attendance — HELD-BACK REGISTER ROWS');
  lines.push('--');
  lines.push(
    '-- Rows the main re-import skipped because the child could not be matched'
  );
  lines.push('-- to an SIS record. One transaction; safe to re-run.');
  lines.push('--');
  lines.push('begin;');
  lines.push('');

  for (const c of CASES) {
    const parsed = sections.find((s) => {
      const id = deriveSectionIdentity(s.section.sheetName);
      return (
        id.kind === 'core' &&
        `${id.levelCode} ${normalizeCleanNameT3(id.cleanName)}` === c.sheet
      );
    });
    if (!parsed) throw new Error(`sheet not found for ${c.sheet}`);

    const row = parsed.section.students.find(
      (s) => Number.parseInt(s.indexNo, 10) === c.registerIndex
    );
    if (!row)
      throw new Error(`no register row #${c.registerIndex} on ${c.sheet}`);
    if (row.fullName.trim() !== c.registerName)
      throw new Error(
        `register row #${c.registerIndex} on ${c.sheet} reads "${row.fullName}", expected "${c.registerName}" — the workbook changed, recheck before running`
      );

    // confirm the SIS row is the one we mean, and belongs to this section
    const { data: ss, error: ssErr } = await svc
      .from('section_students')
      .select(
        'id, index_number, students!inner(id, last_name, first_name), sections!inner(name, academic_year_id, levels!inner(code))'
      )
      .eq('students.id', c.studentId)
      .eq('sections.academic_year_id', (ay as any).id)
      .single();
    if (ssErr) throw ssErr;
    const sisSection = `${(ss as any).sections.levels.code} ${(ss as any).sections.name}`;
    if (sisSection !== c.sheet)
      throw new Error(
        `SIS has that student in ${sisSection}, register row is on ${c.sheet}`
      );

    lines.push(
      `-- ${c.sheet} #${c.registerIndex} — register "${c.registerName}"`
    );
    lines.push(
      `--   SIS: "${(ss as any).students.last_name}, ${(ss as any).students.first_name}" (section_students #${(ss as any).index_number})`
    );

    if (c.renameTo) {
      lines.push('--   correcting the spelling held in the SIS');
      lines.push('update students');
      lines.push(`set last_name = ${sqlString(c.renameTo.lastName)},`);
      lines.push(`    first_name = ${sqlString(c.renameTo.firstName)},`);
      lines.push('    updated_at = now()');
      lines.push(`where id = ${sqlString(c.studentId)}::uuid;`);
      lines.push('');
    }

    const marks: { date: string; status: string }[] = [];
    for (const [rawDate, rawMark] of Object.entries(row.marks)) {
      const iso = isoFor(rawDate);
      if (!iso || !schoolDay.has(iso)) continue;
      const mark = rawMark.trim().toUpperCase();
      if (!mark || !VALID.has(mark)) continue;
      marks.push({ date: iso, status: mark });
    }
    totalMarks += marks.length;
    lines.push(`--   ${marks.length} marks to import`);
    lines.push('');

    if (marks.length > 0) {
      lines.push(`drop table if exists _t3strag_marks;`);
      lines.push(
        'create temp table _t3strag_marks (section_student_id, date, status) as'
      );
      lines.push('values');
      lines.push(
        marks
          .map(
            (m) =>
              `  (${sqlString((ss as any).id)}, date ${sqlString(m.date)}, ${sqlString(m.status)})`
          )
          .join(',\n') + ';'
      );
      lines.push('');
      lines.push('drop table if exists _t3strag_live;');
      lines.push('create temp table _t3strag_live as');
      lines.push('select distinct on (ad.section_student_id, ad.date)');
      lines.push('       ad.section_student_id, ad.date, ad.status');
      lines.push('from attendance_daily ad');
      lines.push(
        `join academic_years ay on ay.ay_code = ${sqlString(AY_CODE)}`
      );
      lines.push(
        `join terms t on t.academic_year_id = ay.id and t.term_number = ${TERM_NUMBER}`
      );
      lines.push('where ad.term_id = t.id and ad.period_id is null');
      lines.push(
        'order by ad.section_student_id, ad.date, ad.recorded_at desc;'
      );
      lines.push('');
      lines.push(
        'insert into attendance_daily (section_student_id, term_id, date, status, ex_reason, ex_note, period_id, recorded_by, recorded_at)'
      );
      lines.push(
        'select m.section_student_id::uuid, t.id, m.date, m.status, null, null, null, null, now()'
      );
      lines.push('from _t3strag_marks m');
      lines.push(
        `join academic_years ay on ay.ay_code = ${sqlString(AY_CODE)}`
      );
      lines.push(
        `join terms t on t.academic_year_id = ay.id and t.term_number = ${TERM_NUMBER}`
      );
      lines.push('left join _t3strag_live l');
      lines.push('  on l.section_student_id = m.section_student_id::uuid');
      lines.push('  and l.date = m.date');
      lines.push(
        'where l.section_student_id is null or l.status is distinct from m.status;'
      );
      lines.push('');
      lines.push('-- refresh her term totals');
      lines.push(
        `select public.recompute_attendance_rollup(t.id, ${sqlString((ss as any).id)}::uuid) from academic_years ay join terms t on t.academic_year_id = ay.id and t.term_number = ${TERM_NUMBER} where ay.ay_code = ${sqlString(AY_CODE)};`
      );
      lines.push('');
    }
  }

  lines.push('commit;');
  lines.push('');
  lines.push('-- === verification (read-only) ===');
  lines.push(
    'select s.last_name, s.first_name, ar.school_days, ar.days_present, ar.days_absent, ar.attendance_pct'
  );
  lines.push('from attendance_records ar');
  lines.push('join section_students ss on ss.id = ar.section_student_id');
  lines.push('join students s on s.id = ss.student_id');
  lines.push('join terms t on t.id = ar.term_id');
  lines.push('join academic_years ay on ay.id = t.academic_year_id');
  lines.push(
    `where ay.ay_code = ${sqlString(AY_CODE)} and t.term_number = ${TERM_NUMBER}`
  );
  lines.push(
    `  and ss.student_id in (${CASES.map((c) => `${sqlString(c.studentId)}::uuid`).join(', ')});`
  );

  rmSync(APPLY_DIR, { recursive: true, force: true });
  mkdirSync(APPLY_DIR, { recursive: true });
  writeFileSync(join(APPLY_DIR, '01-stragglers.sql'), lines.join('\n') + '\n');

  console.log(lines.join('\n'));
  console.log(
    `\n-- ${CASES.length} case(s), ${totalMarks} marks -> ${APPLY_DIR}/01-stragglers.sql`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  });
