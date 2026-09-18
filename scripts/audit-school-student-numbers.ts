// scripts/audit-school-student-numbers.ts
// How many children does the school number differently from the SIS?
//
// WHY NOW. On 2026-09-17 the masterlist alignment found the school's own class
// list disagrees with the SIS about ~200 student numbers, and they were left
// untouched on purpose: adopting them into `students.student_number` would have
// FUSED PAIRS OF CHILDREN, because the school reuses numbers the SIS does not.
//
// Migration 169 removes the standoff. `school_student_number` records what the
// office writes without touching the system key, so the school's number can be
// kept AND the sync stays safe. This measures the job before anyone does it.
//
// MATCHING. Section + index number, then the surname must agree. The alignment
// pass already made index numbers match the school's list, so (section, index)
// is a reliable key — but a number is compared only when the NAME also matches,
// so a stale row can never donate its number to the wrong child.
//
// ⚠ REPORTS THE MIRROR SIDE TOO. "SIS children the list does not number" cannot
// distinguish "absent from the list" from "the section failed to match", and a
// section that fails to match reports no discrepancies at all — which is
// indistinguishable from being correct. That is how three wrong index numbers
// stayed hidden in September.
//
// Reads only. Usage:
//   npx tsx --env-file=.env.local scripts/audit-school-student-numbers.ts

import * as XLSX from 'xlsx';

import { createServiceClient } from '../lib/supabase/service';

const WORKBOOK = 'List of Students.xlsx';
const AY = 'AY2026';

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
      if (/^\d+$/.test(v)) continue; // a hole
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

  // SIS side, keyed the same way the sheet is.
  const sisByKey = new Map<string, any>();
  const sectionKeys = new Set<string>();
  for (const s of sections ?? []) {
    const key = `${(s as any).levels?.code} ${(s as any).name}`.toUpperCase();
    sectionKeys.add(key);
    const { data: roster } = await sb
      .from('section_students')
      .select(
        'index_number,enrollment_status,students(student_number,school_student_number,last_name,first_name)'
      )
      .eq('section_id', (s as any).id);
    for (const r of roster ?? []) {
      sisByKey.set(`${key}#${(r as any).index_number}`, {
        ...(r as any),
        sectionKey: key,
      });
    }
  }

  const differ: string[] = [];
  const same: string[] = [];
  const nameMismatch: string[] = [];
  const notInSis: string[] = [];
  const noNumberOnList: string[] = [];
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
    if (!e.number) {
      noNumberOnList.push(`${key} #${e.index} ${e.name}`);
      continue;
    }

    const hit = sisByKey.get(`${key}#${e.index}`);
    if (!hit) {
      notInSis.push(`${key} #${e.index} ${e.name} (list says ${e.number})`);
      continue;
    }

    const st = hit.students;
    if (surname(e.name) !== surname(st.last_name)) {
      nameMismatch.push(
        `${key} #${e.index}: list "${e.name}" vs SIS "${st.last_name}, ${st.first_name}"`
      );
      continue;
    }

    if (st.student_number === e.number) same.push(key);
    else {
      const already =
        st.school_student_number === e.number ? '  [already recorded]' : '';
      differ.push(
        `${key.padEnd(20)} #${String(e.index).padStart(2)}  ${`${st.last_name}, ${st.first_name}`.padEnd(32)} SIS ${String(st.student_number).padEnd(9)} list ${e.number}${already}`
      );
    }
  }

  console.log(`School class list vs the SIS — ${AY}\n`);
  console.log(`  numbers AGREE            : ${same.length}`);
  console.log(`  numbers DIFFER           : ${differ.length}`);
  console.log(`  list has no number       : ${noNumberOnList.length}`);
  console.log(`  name mismatch, skipped   : ${nameMismatch.length}`);
  console.log(`  list row not on SIS roster: ${notInSis.length}`);

  if (unmatchedSections.size) {
    console.log(
      '\n🔴 SECTIONS THAT DID NOT MATCH — these report NOTHING, which is not the same as being correct:'
    );
    for (const [s, n] of unmatchedSections)
      console.log(`   "${s}" (${n} children skipped)`);
  }

  if (differ.length) {
    console.log('\n─ where they differ ─');
    differ.sort().forEach((d) => console.log('  ' + d));
  }
  if (nameMismatch.length) {
    console.log('\n─ name mismatch (number NOT compared) ─');
    nameMismatch.forEach((d) => console.log('  ⚠ ' + d));
  }
  if (notInSis.length) {
    console.log('\n─ on the list, not on the SIS roster at that index ─');
    notInSis.forEach((d) => console.log('  ⚠ ' + d));
  }

  // Would recording these collide? `school_student_number` is unique where present.
  const listNumbers = differ
    .map((d) => d.trim().split(/\s+/).pop()!)
    .filter((n) => /^[A-Z]\d+$/i.test(n));
  const dupes = listNumbers.filter((n, i) => listNumbers.indexOf(n) !== i);
  console.log(
    `\nDuplicate numbers among the differing rows (would break the unique index): ${dupes.length ? [...new Set(dupes)].join(', ') : 'none'}`
  );

  // 🔴 THE REASON THESE WERE NEVER ADOPTED INTO `student_number`. The school
  // numbers children sequentially WITHIN A CLASS, so its value for one child is
  // frequently the SYSTEM number of a DIFFERENT child. Writing them into the
  // system key would have fused those pairs. Writing them into
  // `school_student_number` is safe at the database level — different column —
  // but it does mean one string can name two children depending which field is
  // being read, which any search or import must reckon with.
  const { data: allStudents } = await sb
    .from('students')
    .select('student_number,last_name,first_name');
  const ownerOf = new Map(
    (allStudents ?? []).map((s: any) => [
      s.student_number,
      `${s.last_name}, ${s.first_name}`,
    ])
  );
  const overlaps = differ
    .map((d) => {
      const n = d.trim().split(/\s+/).pop()!;
      const owner = ownerOf.get(n);
      return owner ? { n, owner, row: d.trim() } : null;
    })
    .filter(Boolean) as { n: string; owner: string; row: string }[];

  // The overlap is TWO different faults wearing one shape, and they need
  // opposite responses — so split them by whether the holder is the same child.
  const collisions: typeof overlaps = [];
  const duplicates: typeof overlaps = [];
  for (const o of overlaps) {
    const rosterName = (o.row.split(/\s{2,}/)[2] ?? '').trim();
    (surname(rosterName) === surname(o.owner) ? duplicates : collisions).push({
      ...o,
      row: rosterName,
    });
  }

  console.log(
    `\nSchool numbers that are already SOME student's system number: ${overlaps.length} of ${differ.length}`
  );

  console.log(
    `\n🔴 A DIFFERENT CHILD holds it — adopting the list into student_number would FUSE these: ${collisions.length}`
  );
  for (const o of collisions) {
    console.log(`   ${o.n} — list: ${o.row}   |   SIS: ${o.owner}`);
  }

  console.log(
    `\n🔴 THE SAME CHILD holds it under a SECOND students row — these are DUPLICATE RECORDS: ${duplicates.length}`
  );
  console.log('   (the roster points at one row, the school names the other)');
  for (const o of duplicates.slice(0, 15)) {
    console.log(`   ${o.n} — ${o.owner}`);
  }
  if (duplicates.length > 15)
    console.log(`   … and ${duplicates.length - 15} more`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
