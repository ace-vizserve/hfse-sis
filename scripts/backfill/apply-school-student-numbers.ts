// scripts/backfill/apply-school-student-numbers.ts
// Records what the school calls each child, for the 221 AY2026 students whose
// number on the class list differs from the SIS's own.
//
// WHY THIS IS SAFE, and why it was not before migration 169. The school numbers
// children sequentially WITHIN A CLASS while the SIS numbers them by when the
// application arrived, so the two lists disagree about 221 of 430 children and
// can never be reconciled by adopting one. Before 169 the only place to put the
// school's number was `student_number` itself — which would have FUSED PAIRS OF
// CHILDREN (7 of these numbers are already a different child's system number)
// and broken the student sync. `school_student_number` is reference data: no
// join reads it, nothing syncs on it, and clearing it is a normal edit.
//
// SOURCE. `List of Students.xlsx` → "Class Lists", matched on section + index
// number, and only when the SURNAME also agrees — so a roster that has moved
// since the file was saved can never donate a number to the wrong child.
//
// ⚠ 7 OF THESE ARE ALREADY ANOTHER CHILD'S SYSTEM NUMBER, and that is expected
// rather than a fault to refuse. H260011 is Rosales Janella's system number and
// the school gives it to Carreon Lucian; David Nathan Angelo holds H260057 here
// and H260012 at the school, whose system holder is a third child. The school
// has not mis-numbered anybody — it has permuted the same pool. Different
// columns, so nothing collides; the consequence is that one string can name two
// children depending which field is read.
//
// ⚠ 35 MORE NAME THE CHILD'S OWN SECOND `students` ROW. Those children exist
// twice (one row on the roster, one orphaned), and the school's list names the
// orphan. Writing it here is still correct — that IS what the office calls
// them — and it does not merge, create or delete anything. The duplicate rows
// are a separate, ongoing matter: Mr Ace has confirmed duplicate parent
// submissions are normal, so the durable fix is in the sync, not here.
//
// ⚠ NOTHING IS OVERWRITTEN. A child who already carries a school number is
// reported and skipped, so the 15 YoungStarters set on 2026-09-18 are untouched
// and a hand-correction made on the student record always wins over this file.
//
// ⚠ Service-role writes leave NO `audit_log` row. The reasoning lives here.
//
// Dry run by default. Re-runnable: a second run writes nothing.
//
//   npx tsx --env-file=.env.local scripts/backfill/apply-school-student-numbers.ts
//   npx tsx --env-file=.env.local scripts/backfill/apply-school-student-numbers.ts --apply

import * as XLSX from 'xlsx';

import { createServiceClient } from '../../lib/supabase/service';

const WORKBOOK = 'List of Students.xlsx';
const AY = 'AY2026';
const APPLY = process.argv.includes('--apply');

const sb = createServiceClient();

const META = /^(form class adviser|room)\s*:/i;

type SheetEntry = {
  section: string;
  index: number | null;
  name: string;
  number: string | null;
};

function parseWorkbook(): SheetEntry[] {
  const wb = XLSX.readFile(WORKBOOK);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Class Lists'], {
    header: 1,
    blankrows: false,
  }) as unknown[][];

  const out: SheetEntry[] = [];
  let section = '(none)';
  for (const r of rows) {
    const cells = r.map((c) => (c == null ? '' : String(c).trim()));
    const nonEmpty = cells.filter(Boolean);
    if (!nonEmpty.length) continue;
    if (cells[0]?.toLowerCase() === 'index #') continue;
    if (nonEmpty.length === 1) {
      const v = nonEmpty[0];
      if (META.test(v)) continue;
      if (/^\d+$/.test(v)) continue; // a vacated slot
      section = v;
      continue;
    }
    const idx = Number(cells[0]);
    out.push({
      section,
      index: Number.isFinite(idx) && cells[0] !== '' ? idx : null,
      name: cells[1] ?? '',
      number: cells[2] || null,
    });
  }
  return out;
}

/** Workbook titles carry session and stream; the SIS stores them apart. */
function normaliseSection(title: string): string {
  let t = title
    .replace(/\(.*$/g, ' ')
    .replace(/[-–]\s*(global|standard)\b/gi, ' ')
    .replace(/\b(global|standard|morning session|afternoon session)\b/gi, ' ')
    .trim();
  t = t
    .replace(/^Sec\s*(\d)/i, 'S$1')
    .replace(/^Secondary\s*(\d)/i, 'S$1')
    .replace(/^Youngstarters?$/i, 'YS Youngstarters');
  const key = t.replace(/\s+/g, ' ').trim().toUpperCase();
  const ALIASES: Record<string, string> = {
    'S1 DISCIPLINE': 'S1 DISCIPLINE 1',
    'S2 I1': 'S2 INTEGRITY 1',
    'S2 I2': 'S2 INTEGRITY 2',
    S3: 'S3 CONSISTENCY',
    S4: 'S4 EXCELLENCE',
  };
  return ALIASES[key] ?? key;
}

const surname = (s: string) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(',')[0]
    .split(' ')[0]
    .toUpperCase()
    .replace(/[^A-Z]/g, '');

type Write = {
  studentId: string;
  studentNumber: string;
  schoolNumber: string;
  who: string;
  where: string;
};

async function main() {
  const sheet = parseWorkbook().filter((e) => e.index !== null && e.name);

  const { data: ay } = await sb
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY)
    .single();
  const { data: sections } = await sb
    .from('sections')
    .select('id,name,levels(code)')
    .eq('academic_year_id', (ay as any).id);

  const sisByKey = new Map<string, any>();
  const sectionKeys = new Set<string>();
  for (const s of sections ?? []) {
    const key = `${(s as any).levels?.code} ${(s as any).name}`.toUpperCase();
    sectionKeys.add(key);
    const { data: roster } = await sb
      .from('section_students')
      .select(
        'index_number,students(id,student_number,school_student_number,last_name,first_name)'
      )
      .eq('section_id', (s as any).id);
    for (const r of roster ?? []) {
      sisByKey.set(`${key}#${(r as any).index_number}`, r);
    }
  }

  // Every school number already in use, so a clash is named rather than thrown.
  const { data: taken } = await sb
    .from('students')
    .select('id,student_number,school_student_number,last_name,first_name')
    .not('school_student_number', 'is', null);
  const holderOf = new Map(
    (taken ?? []).map((t: any) => [t.school_student_number, t])
  );

  const writes: Write[] = [];
  const alreadySet: string[] = [];
  const skippedSame: number[] = [];
  const refused: string[] = [];
  const unmatchedSections = new Map<string, number>();

  for (const e of sheet) {
    const key = normaliseSection(e.section);
    if (!sectionKeys.has(key)) {
      unmatchedSections.set(
        e.section,
        (unmatchedSections.get(e.section) ?? 0) + 1
      );
      continue;
    }
    if (!e.number) continue;

    const hit = sisByKey.get(`${key}#${e.index}`);
    if (!hit) {
      refused.push(
        `${key} #${e.index} ${e.name}: nobody on the SIS roster at that index`
      );
      continue;
    }
    const st = hit.students;

    if (surname(e.name) !== surname(st.last_name)) {
      refused.push(
        `${key} #${e.index}: list says "${e.name}", SIS says "${st.last_name}, ${st.first_name}" — number NOT written`
      );
      continue;
    }

    // The two agree: there is no separate school number to record.
    if (st.student_number === e.number) {
      skippedSame.push(1);
      continue;
    }

    if (st.school_student_number) {
      alreadySet.push(
        `${st.last_name}, ${st.first_name}: already ${st.school_student_number}` +
          (st.school_student_number === e.number
            ? ''
            : ` (list says ${e.number})`)
      );
      continue;
    }

    const clash = holderOf.get(e.number);
    if (clash && clash.id !== st.id) {
      refused.push(
        `${st.last_name}, ${st.first_name}: ${e.number} is already the school number for ${clash.last_name}, ${clash.first_name}`
      );
      continue;
    }

    writes.push({
      studentId: st.id,
      studentNumber: st.student_number,
      schoolNumber: e.number,
      who: `${st.last_name}, ${st.first_name}`,
      where: `${key} #${e.index}`,
    });
    holderOf.set(e.number, { ...st, school_student_number: e.number });
  }

  console.log(`School student numbers — ${AY}\n`);
  console.log(`  to write            : ${writes.length}`);
  console.log(`  already set, skipped: ${alreadySet.length}`);
  console.log(`  numbers agree       : ${skippedSame.length}`);
  console.log(`  refused             : ${refused.length}`);

  if (unmatchedSections.size) {
    console.log(
      '\n🔴 SECTIONS THAT DID NOT MATCH — these contribute nothing, which is not the same as being correct:'
    );
    for (const [s, n] of unmatchedSections)
      console.log(`   "${s}" (${n} children skipped)`);
  }

  if (alreadySet.length) {
    console.log('\nAlready carrying a school number (left alone):');
    alreadySet.slice(0, 20).forEach((a) => console.log(`  ✅ ${a}`));
    if (alreadySet.length > 20)
      console.log(`  … and ${alreadySet.length - 20} more`);
  }

  if (refused.length) {
    console.log('\nRefused:');
    refused.forEach((r) => console.log(`  🔴 ${r}`));
  }

  if (!APPLY) {
    console.log('\nFirst 25 of what would be written:');
    writes
      .slice(0, 25)
      .forEach((w) =>
        console.log(
          `  ${w.where.padEnd(20)} ${w.who.padEnd(32)} ${w.studentNumber.padEnd(9)} → school ${w.schoolNumber}`
        )
      );
    console.log(`\nDRY RUN — ${writes.length} row(s). Re-run with --apply.`);
    return;
  }

  console.log('\nApplying…');
  let done = 0;
  for (const w of writes) {
    const { error } = await sb
      .from('students')
      .update({ school_student_number: w.schoolNumber })
      .eq('id', w.studentId);
    if (error) {
      console.log(`  🔴 ${w.who}: ${error.message}`);
      continue;
    }
    done++;
    if (done % 50 === 0) console.log(`  … ${done}/${writes.length}`);
  }
  console.log(`\nDone. ${done} of ${writes.length} written.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
