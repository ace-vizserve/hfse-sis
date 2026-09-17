// Read-only: match the YoungStarters sheet of `List of Students.xlsx` against
// AY2026 admissions + the SIS roster.
//
// WHY. The YS level exists (`levels.code = 'YS'`) but AY2026 has NO YS section,
// so none of these children are on a roster in any module. Step 1 is finding
// out which of them admissions already knows about.
//
// ⚠ The sheet writes SURNAME FIRST in caps, then given names, then a middle
// initial: "BEDICO Miguel Zion C". Admissions stores lastName/firstName split.
//
// Usage: npx tsx --env-file=.env.local scripts/audit-youngstarters-vs-admissions.ts

import * as XLSX from 'xlsx';

import { createServiceClient } from '../lib/supabase/service';

const WORKBOOK = 'List of Students.xlsx';
const AY = 'ay2026';

type Row = { index: number; name: string; tier: string };

function readSheet(): Row[] {
  const wb = XLSX.readFile(WORKBOOK);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['YoungStarters'], {
    header: 1,
    blankrows: false,
  }) as unknown[][];
  const out: Row[] = [];
  for (const r of rows) {
    const idx = Number(r[0]);
    const name = String(r[1] ?? '').trim();
    if (!Number.isFinite(idx) || !name) continue;
    out.push({
      index: idx,
      name: name.replace(/\s+/g, ' '),
      tier: String(r[2] ?? '').trim(),
    });
  }
  return out;
}

/** "BEDICO Miguel Zion C" -> { surname: 'BEDICO', given: 'Miguel Zion' } */
function split(name: string) {
  const parts = name.split(' ');
  const surname = parts[0];
  let rest = parts.slice(1);
  // drop a trailing single-letter middle initial
  if (rest.length > 1 && rest[rest.length - 1].replace(/\./g, '').length === 1)
    rest = rest.slice(0, -1);
  return { surname, given: rest.join(' ') };
}

const norm = (s: string) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

async function main() {
  const sheet = readSheet();
  const sb = createServiceClient();

  const { data: apps, error } = await sb
    .from(`${AY}_enrolment_applications`)
    .select(
      '"enroleeNumber","studentNumber","enroleeFullName","lastName","firstName","middleName","levelApplied",category'
    );
  if (error) throw error;

  const { data: statuses } = await sb
    .from(`${AY}_enrolment_status`)
    .select(
      '"enroleeNumber","enroleeName","applicationStatus","classStatus","classRemarks","applicationRemarks"'
    );
  const statusBy = new Map(
    (statuses ?? []).map((s: any) => [s.enroleeNumber, s])
  );

  // SIS side
  const { data: students } = await sb
    .from('students')
    .select('id,student_number,last_name,first_name,middle_name');
  const byNumber = new Map(
    (students ?? []).map((s: any) => [s.student_number, s])
  );
  const byName = new Map(
    (students ?? []).map((s: any) => [
      norm(`${s.last_name} ${s.first_name}`),
      s,
    ])
  );

  console.log(`YoungStarters sheet: ${sheet.length} children\n`);
  console.log(
    'idx  tier         name                                 | admissions                                   | SIS students row'
  );
  console.log('─'.repeat(160));

  const unmatched: Row[] = [];
  for (const row of sheet) {
    const { surname, given } = split(row.name);
    const hits = (apps ?? []).filter((a: any) => {
      const ln = norm(a.lastName ?? '');
      const fn = norm(a.firstName ?? '');
      const full = norm(a.enroleeFullName ?? '');
      if (
        ln === norm(surname) &&
        (fn.startsWith(norm(given)) || norm(given).startsWith(fn))
      )
        return true;
      return (
        full.includes(norm(surname)) &&
        full.includes(norm(given).split(' ')[0] ?? '#')
      );
    });

    const adm =
      hits.length === 0
        ? '— NOT IN ADMISSIONS —'
        : hits
            .map((h: any) => {
              const st = statusBy.get(h.enroleeNumber) as any;
              return `${h.enroleeNumber} ${h.studentNumber ?? '(no studentNumber)'} lvl=${h.levelApplied ?? '?'} ${st?.applicationStatus ?? '?'}/${st?.classStatus ?? '-'}`;
            })
            .join(' ;; ');

    const sisHit =
      hits
        .map((h: any) => h.studentNumber)
        .filter(Boolean)
        .map((n: string) => byNumber.get(n))
        .find(Boolean) ??
      byName.get(norm(`${surname} ${given.split(' ')[0]}`)) ??
      null;

    console.log(
      String(row.index).padStart(3),
      row.tier.padEnd(12),
      row.name.padEnd(36),
      '|',
      adm.padEnd(44),
      '|',
      sisHit
        ? `${(sisHit as any).student_number} ${(sisHit as any).last_name}, ${(sisHit as any).first_name}`
        : '— none —'
    );
    if (hits.length === 0) unmatched.push(row);
  }

  console.log(
    '\n=== MIRROR SIDE: AY2026 admissions rows whose levelApplied looks like YS ==='
  );
  for (const a of apps ?? []) {
    const lvl = String((a as any).levelApplied ?? '');
    if (/young|^ys$|star|nursery|kinder|pre/i.test(lvl)) {
      const st = statusBy.get((a as any).enroleeNumber) as any;
      console.log(
        ' ',
        (a as any).enroleeNumber,
        String((a as any).studentNumber ?? '—').padEnd(9),
        lvl.padEnd(22),
        (a as any).enroleeFullName,
        '|',
        st?.applicationStatus ?? '?'
      );
    }
  }

  console.log('\n=== distinct levelApplied values in AY2026 ===');
  const lv = new Map<string, number>();
  for (const a of apps ?? []) {
    const k = String((a as any).levelApplied ?? '(null)');
    lv.set(k, (lv.get(k) ?? 0) + 1);
  }
  for (const [k, v] of [...lv].sort())
    console.log('  ', String(v).padStart(4), k);

  console.log(`\nNot found in admissions: ${unmatched.length}`);
  for (const u of unmatched) console.log('  ', u.index, u.name);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
