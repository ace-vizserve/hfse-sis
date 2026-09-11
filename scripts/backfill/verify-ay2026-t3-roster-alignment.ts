// scripts/backfill/verify-ay2026-t3-roster-alignment.ts
// Read-only. The T3 importer resolves a workbook row to a student by
// (section, index_number) and never looks at the name. That is only safe
// while the workbook's index numbers still mean what the database's mean.
//
// This script checks exactly that: for every roster row in a workbook, it
// looks up the DB student at the same (level, section, index) and compares
// the names. A mismatch means the import would file one child's attendance
// against another child.
//
// Run: npx tsx --env-file=.env.local scripts/backfill/verify-ay2026-t3-roster-alignment.ts
import { writeFileSync } from 'node:fs';

import { createServiceClient } from '../../lib/supabase/service';
import { parseWorkbookT3 } from '../../lib/sis/backfill/attendance/attendance-workbook-t3';
import { deriveSectionIdentity } from '../../lib/sis/backfill/enrollment/section-identity';

const AY_CODE = 'AY2026';
const WORKBOOKS = [
  [
    'OLD (July, already imported)',
    'AY2026/T3/AY2026 Term 3 Attendance (1).xlsx',
  ],
  ['NEW (Latest)', 'AY2026 Term 3 Attendance Latest.xlsx'],
] as const;
const OUT = 'scripts/backfill/ay2026-t3-roster-alignment-report.txt';

function normalizeCleanNameT3(cleanName: string): string {
  return cleanName.replace(/\s*-\s*(\d+)$/, ' $1');
}

// "FABRE, Kian Iñigo P." and "Fabre, Kian Inigo" should compare equal:
// strip accents, punctuation and trailing middle initials, casefold.
function nameKey(raw: string): string {
  const [last = '', first = ''] = raw.split(',');
  const clean = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^A-Z ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1) // drops middle initials like "P." / "A."
      .join(' ')
      .trim();
  return `${clean(last)}|${clean(first)}`;
}

// True when one name is a prefix-compatible version of the other — the DB
// often stores fewer given names than the workbook ("Kian Inigo" vs
// "Kian Iñigo P.").
function namesAgree(a: string, b: string): boolean {
  if (a === b) return true;
  const [al, af] = a.split('|');
  const [bl, bf] = b.split('|');
  if (al !== bl) return false;
  return af.startsWith(bf) || bf.startsWith(af);
}

async function main() {
  const svc = createServiceClient();

  const { data: ay, error: ayErr } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY_CODE)
    .single();
  if (ayErr) throw ayErr;

  const { data: rows, error: rowsErr } = await svc
    .from('section_students')
    .select(
      'id, index_number, enrollment_status, students(last_name, first_name), sections!inner(name, academic_year_id, levels!inner(code))'
    )
    .eq('sections.academic_year_id', (ay as any).id);
  if (rowsErr) throw rowsErr;

  const byKey = new Map<string, any>();
  const byName = new Map<string, any[]>();
  for (const r of rows as any[]) {
    const sec = `${r.sections.levels.code}::${r.sections.name}`;
    byKey.set(`${sec}::${r.index_number}`, r);
    const nk = `${sec}::${nameKey(`${r.students?.last_name ?? ''}, ${r.students?.first_name ?? ''}`)}`;
    byName.set(nk, [...(byName.get(nk) ?? []), r]);
  }

  const L: string[] = [];
  const say = (s = '') => {
    L.push(s);
    console.log(s);
  };

  say('AY2026 T3 — roster alignment check (read-only)');
  say(
    'Does (section, index_number) in the workbook still name the same student as the database?'
  );
  say('');

  for (const [label, path] of WORKBOOKS) {
    const sections = parseWorkbookT3(path);
    let checked = 0;
    let agreed = 0;
    const mismatches: string[] = [];
    const notInDb: string[] = [];

    for (const parsed of sections) {
      if (parsed.section.students.length === 0) continue;
      const identity = deriveSectionIdentity(parsed.section.sheetName);
      if (identity.kind !== 'core') continue;
      const sec = `${identity.levelCode}::${normalizeCleanNameT3(identity.cleanName)}`;

      for (const s of parsed.section.students) {
        const idx = Number.parseInt(s.indexNo, 10);
        if (!Number.isFinite(idx)) continue;
        checked++;
        const dbRow = byKey.get(`${sec}::${idx}`);
        const wbKey = nameKey(s.fullName);
        if (!dbRow) {
          const elsewhere = byName.get(`${sec}::${wbKey}`);
          notInDb.push(
            `    ${sec.replace('::', ' ')} #${idx} "${s.fullName}" — no DB row at that index` +
              (elsewhere?.length
                ? ` (that student IS in the DB at index ${elsewhere.map((e) => e.index_number).join('/')})`
                : ' (and that name is not in this section at all)')
          );
          continue;
        }
        const dbKey = nameKey(
          `${dbRow.students?.last_name ?? ''}, ${dbRow.students?.first_name ?? ''}`
        );
        if (namesAgree(wbKey, dbKey)) {
          agreed++;
        } else {
          const elsewhere = byName.get(`${sec}::${wbKey}`);
          mismatches.push(
            `    ${sec.replace('::', ' ')} #${idx}: workbook "${s.fullName}"  vs  DB "${dbRow.students?.last_name}, ${dbRow.students?.first_name}"` +
              (elsewhere?.length
                ? ` — workbook's student sits at DB index ${elsewhere.map((e) => e.index_number).join('/')}`
                : ' — workbook name not found anywhere in this section')
          );
        }
      }
    }

    say(`--- ${label} ---`);
    say(`  ${path}`);
    say(`  roster rows checked:            ${checked}`);
    say(`  index -> same student as DB:    ${agreed}`);
    say(`  index -> a DIFFERENT student:   ${mismatches.length}`);
    say(`  index has no DB row:            ${notInDb.length}`);
    if (mismatches.length) {
      say(
        '  MISMATCHES (import would file attendance against the wrong child):'
      );
      mismatches.forEach((m) => say(m));
    }
    if (notInDb.length) {
      say('  NO DB ROW AT THAT INDEX:');
      notInDb.forEach((m) => say(m));
    }
    say('');
  }

  writeFileSync(OUT, L.join('\n') + '\n');
  console.log(`Wrote ${OUT}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  });
