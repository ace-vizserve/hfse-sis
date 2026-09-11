// scripts/backfill/verify-t3-crossfiled.ts
// Read-only. Settles, per student, whether the attendance stored in the
// database belongs to that student or to somebody else.
//
// Method: for every database row, take the student's stored T3 marks and
// compare them against (a) the OLD workbook row carrying the SAME NAME and
// (b) the OLD workbook row at the SAME INDEX. Whichever matches tells us how
// the July import actually resolved that student. Where the two differ and
// the stored marks follow the index rather than the name, that child's record
// holds another child's attendance.
//
// Run: npx tsx --env-file=.env.local scripts/backfill/verify-t3-crossfiled.ts
import { createServiceClient } from '../../lib/supabase/service';
import { parseWorkbookT3 } from '../../lib/sis/backfill/attendance/attendance-workbook-t3';
import { deriveSectionIdentity } from '../../lib/sis/backfill/enrollment/section-identity';

const AY_CODE = 'AY2026';
const OLD = 'AY2026/T3/AY2026 Term 3 Attendance (1).xlsx';

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
  return m ? `2026-${m}-${d.padStart(2, '0')}` : null;
}

function normalizeCleanNameT3(n: string): string {
  return n.replace(/\s*-\s*(\d+)$/, ' $1');
}

function words(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

// Order-insensitive name comparison, so "TAYEB, Taseen" matches
// "Taseen, Tayeb" and a workbook typo still scores high.
function nameScore(a: string, b: string): number {
  const wa = new Set(words(a));
  const wb = new Set(words(b));
  let hit = 0;
  for (const w of wa) if (wb.has(w)) hit++;
  return hit / Math.max(1, Math.min(wa.size, wb.size));
}

function marksToMap(marks: Record<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [raw, v] of Object.entries(marks)) {
    const iso = isoFor(raw);
    const t = v.trim().toUpperCase();
    if (iso && t) out.set(iso, t);
  }
  return out;
}

function agreement(
  db: Map<string, string>,
  wb: Map<string, string>
): { same: number; diff: number } {
  let same = 0;
  let diff = 0;
  for (const [d, s] of wb) {
    const v = db.get(d);
    if (v === undefined) continue;
    if (v === s) same++;
    else diff++;
  }
  return { same, diff };
}

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

  const { data: ssRows } = await svc
    .from('section_students')
    .select(
      'id, index_number, students(last_name, first_name), sections!inner(name, academic_year_id, levels!inner(code))'
    )
    .eq('sections.academic_year_id', (ay as any).id);

  // all T3 daily marks, paged
  const daily: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await svc
      .from('attendance_daily')
      .select('section_student_id, date, status')
      .eq('term_id', (term as any).id)
      .is('period_id', null)
      .order('section_student_id')
      .order('date')
      .range(from, from + 999);
    const rows = (data ?? []) as any[];
    daily.push(...rows);
    if (rows.length < 1000) break;
  }
  const dbMarks = new Map<string, Map<string, string>>();
  for (const r of daily) {
    const m = dbMarks.get(r.section_student_id) ?? new Map();
    m.set(r.date, r.status);
    dbMarks.set(r.section_student_id, m);
  }

  const wb = parseWorkbookT3(OLD);
  const sheets = new Map<string, any>();
  for (const parsed of wb) {
    if (parsed.section.students.length === 0) continue;
    const id = deriveSectionIdentity(parsed.section.sheetName);
    if (id.kind !== 'core') continue;
    sheets.set(
      `${id.levelCode}::${normalizeCleanNameT3(id.cleanName)}`,
      parsed.section.students
    );
  }

  const crossFiled: string[] = [];
  const clean: string[] = [];

  for (const r of ssRows as any[]) {
    const sec = `${r.sections.levels.code}::${r.sections.name}`;
    const students = sheets.get(sec);
    if (!students) continue;
    const db = dbMarks.get(r.id);
    if (!db || db.size === 0) continue;

    const dbName = `${r.students?.last_name}, ${r.students?.first_name}`;
    const byIndex = students.find(
      (s: any) => Number.parseInt(s.indexNo, 10) === r.index_number
    );
    let byNameRow: any = null;
    let best = 0;
    for (const s of students) {
      const sc = nameScore(dbName, s.fullName);
      if (sc > best) {
        best = sc;
        byNameRow = s;
      }
    }
    if (best < 0.6) byNameRow = null;

    const idxAgree = byIndex
      ? agreement(db, marksToMap(byIndex.marks))
      : { same: 0, diff: 0 };
    const nameAgree = byNameRow
      ? agreement(db, marksToMap(byNameRow.marks))
      : { same: 0, diff: 0 };

    const sameRow =
      byIndex && byNameRow && byIndex.indexNo === byNameRow.indexNo;
    if (sameRow) continue; // nothing to distinguish

    const idxScore = idxAgree.same - idxAgree.diff;
    const nameScoreV = nameAgree.same - nameAgree.diff;

    const line =
      `  ${r.sections.levels.code} ${r.sections.name} #${r.index_number} "${dbName}"\n` +
      `      vs workbook row at same index  (#${byIndex?.indexNo ?? '-'} "${byIndex?.fullName ?? 'none'}"):  ${idxAgree.same} agree / ${idxAgree.diff} differ\n` +
      `      vs workbook row with same name (#${byNameRow?.indexNo ?? '-'} "${byNameRow?.fullName ?? 'none'}"): ${nameAgree.same} agree / ${nameAgree.diff} differ`;

    if (idxScore > nameScoreV && idxAgree.same > 0) crossFiled.push(line);
    else clean.push(line);
  }

  console.log('=== STORED ATTENDANCE FOLLOWS THE INDEX, NOT THE NAME ===');
  console.log("(these records hold another child's attendance)\n");
  if (crossFiled.length === 0) console.log('  none\n');
  crossFiled.forEach((l) => console.log(l + '\n'));

  console.log('=== STORED ATTENDANCE FOLLOWS THE NAME (correct) ===\n');
  clean.forEach((l) => console.log(l + '\n'));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  });
