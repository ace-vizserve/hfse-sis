// scripts/backfill/reconcile-ay2026-t3-by-name.ts
// Read-only. Re-runs the T3 reconcile resolving each workbook roster row to a
// student BY NAME within its section, instead of by index number.
//
// Why: the July import's (section, index_number) matching no longer holds —
// the database's index numbers have moved relative to the workbook's for ~21
// students. Matching by index against today's database would file one child's
// attendance against another. Name matching is the check that tells us which
// side is right, and it is the resolution the corrective re-import must use.
//
// Run: npx tsx --env-file=.env.local scripts/backfill/reconcile-ay2026-t3-by-name.ts
import { writeFileSync } from 'node:fs';

import { createServiceClient } from '../../lib/supabase/service';
import { parseWorkbookT3 } from '../../lib/sis/backfill/attendance/attendance-workbook-t3';
import { buildAttendanceImportT3 } from '../../lib/sis/backfill/attendance/build-attendance-import-t3';
import { deriveSectionIdentity } from '../../lib/sis/backfill/enrollment/section-identity';
import type { RosterLookupEntry } from '../../lib/sis/backfill/attendance/build-attendance-import-t3';

const AY_CODE = 'AY2026';
const TERM_NUMBER = 3;
const YEAR = 2026;
const NEW_WORKBOOK =
  process.env.T3_WORKBOOK ?? 'AY2026 Term 3 Attendance Latest.xlsx';
const OUT = 'scripts/backfill/ay2026-t3-by-name-report.txt';

const CAL_ROW_RE =
  /^\s*\(date '(\d{4}-\d{2}-\d{2})',\s*'([a-z_]+)',\s*(?:true|false),/;

function normalizeCleanNameT3(cleanName: string): string {
  return cleanName.replace(/\s*-\s*(\d+)$/, ' $1');
}

function nameKey(raw: string): string {
  const [last = '', first = ''] = raw.split(',');
  const clean = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^A-Z ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .join(' ')
      .trim();
  return `${clean(last)}|${clean(first)}`;
}

function namesAgree(a: string, b: string): boolean {
  if (a === b) return true;
  const [al, af] = a.split('|');
  const [bl, bf] = b.split('|');
  if (al !== bl) return false;
  return af.startsWith(bf) || bf.startsWith(af);
}

// Order-insensitive word overlap, so the register's "TAYEB, Taseen" still
// finds the database's "Taseen, Tayeb", and a one-letter misspelling
// ("Aleksndr" vs "Aleksandr") still scores on the rest of the name.
function wordSet(raw: string): Set<string> {
  return new Set(
    raw
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^A-Z ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1)
  );
}

function overlapScore(a: string, b: string): number {
  const wa = wordSet(a);
  const wb = wordSet(b);
  let hit = 0;
  for (const w of wa) if (wb.has(w)) hit++;
  return hit / Math.max(1, Math.min(wa.size, wb.size));
}

interface DbRow {
  section_student_id: string;
  date: string;
  status: string | null;
  recorded_by: string | null;
  recorded_at: string;
}

// `attendance_daily` is an append-only ledger (migration 014): a correction
// INSERTs a new row and supersedes the prior one by `recorded_at desc`, and a
// `status` of null means the day was CLEARED (migration 134) and falls out of
// every rollup. Reading raw rows would compare against superseded history, so
// reduce to the live mark per (student, date) first — the same rule the
// rollup RPC applies.
async function fetchLiveDaily(
  svc: any,
  termId: string
): Promise<{ live: DbRow[]; rawCount: number; supersededCount: number }> {
  const raw: DbRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await svc
      .from('attendance_daily')
      .select('section_student_id, date, status, recorded_by, recorded_at')
      .eq('term_id', termId)
      .is('period_id', null)
      .order('section_student_id')
      .order('date')
      .order('recorded_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as DbRow[];
    raw.push(...rows);
    if (rows.length < PAGE) break;
  }
  // ascending recorded_at, so the last write for a key wins
  const latest = new Map<string, DbRow>();
  for (const r of raw) latest.set(`${r.section_student_id}|${r.date}`, r);
  const live = [...latest.values()].filter((r) => r.status !== null);
  return {
    live,
    rawCount: raw.length,
    supersededCount: raw.length - latest.size,
  };
}

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

  const { data: rows, error: rowsErr } = await svc
    .from('section_students')
    .select(
      'id, index_number, enrollment_status, students(last_name, first_name), sections!inner(name, academic_year_id, levels!inner(code))'
    )
    .eq('sections.academic_year_id', (ay as any).id);
  if (rowsErr) throw rowsErr;

  const rosterLookup: RosterLookupEntry[] = (rows as any[]).map((r) => ({
    levelCode: r.sections.levels.code,
    cleanName: r.sections.name,
    indexNumber: r.index_number,
    sectionStudentId: r.id,
  }));

  // section -> nameKey -> rows
  const byName = new Map<string, any[]>();
  const label = new Map<string, string>();
  for (const r of rows as any[]) {
    const sec = `${r.sections.levels.code}::${r.sections.name}`;
    const nk = `${sec}::${nameKey(`${r.students?.last_name ?? ''}, ${r.students?.first_name ?? ''}`)}`;
    byName.set(nk, [...(byName.get(nk) ?? []), r]);
    label.set(
      r.id,
      `${r.sections.levels.code} ${r.sections.name} #${r.index_number} ${r.students?.last_name}, ${r.students?.first_name}${r.enrollment_status !== 'active' ? ` [${r.enrollment_status}]` : ''}`
    );
  }

  // --- day classification, straight from the shipped builder ---
  const sections = parseWorkbookT3(NEW_WORKBOOK);
  const built = buildAttendanceImportT3({
    sections,
    rosterLookup,
    ayCode: AY_CODE,
    termNumber: TERM_NUMBER,
    year: YEAR,
  });
  const dayType = new Map<string, string>();
  for (const f of built.applyFiles) {
    if (!/-calendar\.sql$/.test(f.filename)) continue;
    for (const line of f.sql.split('\n')) {
      const m = CAL_ROW_RE.exec(line);
      if (m) dayType.set(m[1], m[2]);
    }
  }

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
  const isoFor = (raw: string): string | null => {
    const [d, mon] = raw.split('-');
    const m = MONTHS[mon];
    return m ? `${YEAR}-${m}-${d.padStart(2, '0')}` : null;
  };

  // --- workbook marks, resolved BY NAME ---
  const wb = new Map<string, string>();
  const unresolved: string[] = [];
  const ambiguous: string[] = [];
  const indexMoved: string[] = [];
  const fuzzyMatched: string[] = [];
  const VALID = new Set(['P', 'A', 'EX', 'L']);
  const badMarks: string[] = [];
  let resolvedStudents = 0;

  for (const parsed of sections) {
    if (parsed.section.students.length === 0) continue;
    const identity = deriveSectionIdentity(parsed.section.sheetName);
    if (identity.kind !== 'core') continue;
    const sec = `${identity.levelCode}::${normalizeCleanNameT3(identity.cleanName)}`;

    for (const s of parsed.section.students) {
      const nk = nameKey(s.fullName);
      let hits = byName.get(`${sec}::${nk}`) ?? [];
      if (hits.length === 0) {
        // fall back to the prefix rule ("Kian Iñigo P." vs "Kian Inigo")
        for (const [k, v] of byName) {
          if (!k.startsWith(`${sec}::`)) continue;
          if (namesAgree(nk, k.slice(sec.length + 2))) {
            hits = v;
            break;
          }
        }
      }
      if (hits.length === 0) {
        // last resort: best word-overlap within the section, which catches a
        // reversed surname/given name and a single-letter misspelling. 0.75 is
        // deliberately strict — a wrong match here files one child's
        // attendance against another.
        let best: any = null;
        let bestScore = 0;
        let runnerUp = 0;
        for (const r of rows as any[]) {
          if (`${r.sections.levels.code}::${r.sections.name}` !== sec) continue;
          const sc = overlapScore(
            s.fullName,
            `${r.students?.last_name} ${r.students?.first_name}`
          );
          if (sc > bestScore) {
            runnerUp = bestScore;
            bestScore = sc;
            best = r;
          } else if (sc > runnerUp) runnerUp = sc;
        }
        if (best && bestScore >= 0.75 && bestScore > runnerUp) {
          hits = [best];
          fuzzyMatched.push(
            `    ${sec.replace('::', ' ')} workbook "${s.fullName}" -> database "${best.students?.last_name}, ${best.students?.first_name}" (#${best.index_number}, score ${bestScore.toFixed(2)})`
          );
        }
      }
      if (hits.length === 0) {
        unresolved.push(
          `    ${sec.replace('::', ' ')} #${s.indexNo} "${s.fullName}"`
        );
        continue;
      }
      if (hits.length > 1) {
        ambiguous.push(
          `    ${sec.replace('::', ' ')} #${s.indexNo} "${s.fullName}" -> ${hits.length} DB rows (index ${hits.map((h) => h.index_number).join('/')})`
        );
        continue;
      }
      const dbRow = hits[0];
      resolvedStudents++;
      if (Number.parseInt(s.indexNo, 10) !== dbRow.index_number) {
        indexMoved.push(
          `    ${sec.replace('::', ' ')} "${s.fullName}": workbook #${s.indexNo} -> database #${dbRow.index_number}`
        );
      }
      for (const [rawDate, rawMark] of Object.entries(s.marks)) {
        const iso = isoFor(rawDate);
        if (!iso) continue;
        if (dayType.get(iso) !== 'school_day') continue;
        const mark = rawMark.trim().toUpperCase();
        if (!mark) continue;
        if (!VALID.has(mark)) {
          badMarks.push(
            `    ${sec.replace('::', ' ')} "${s.fullName}" ${iso}: "${rawMark}"`
          );
          continue;
        }
        wb.set(`${dbRow.id}|${iso}`, mark);
      }
    }
  }

  // --- database side ---
  const {
    live: dbRows,
    rawCount,
    supersededCount,
  } = await fetchLiveDaily(svc, (term as any).id);
  const db = new Map<string, DbRow>();
  for (const r of dbRows) db.set(`${r.section_student_id}|${r.date}`, r);

  const missing: { key: string; status: string }[] = [];
  const different: { key: string; wbStatus: string; row: DbRow }[] = [];
  const extra: DbRow[] = [];
  for (const [key, status] of wb) {
    const d = db.get(key);
    if (!d) missing.push({ key, status });
    else if (d.status !== status)
      different.push({ key, wbStatus: status, row: d });
  }
  for (const [key, d] of db) if (!wb.has(key)) extra.push(d);

  const fmt = (key: string) => {
    const [id, date] = key.split('|');
    return `${date}  ${label.get(id) ?? id}`;
  };
  const prov = (r: DbRow) =>
    r.recorded_by ? 'marked in-system AFTER import' : 'from July import';

  const L: string[] = [];
  const say = (s = '') => {
    L.push(s);
    console.log(s);
  };

  say('AY2026 T3 attendance — RECONCILE BY NAME (read-only)');
  say(`Workbook: ${NEW_WORKBOOK}`);
  say('');
  say('--- roster resolution (by name, within section) ---');
  say(`  students resolved:                 ${resolvedStudents}`);
  say(`  name not found in DB section:      ${unresolved.length}`);
  say(`  name matched >1 DB row:            ${ambiguous.length}`);
  say(`  resolved but index number moved:   ${indexMoved.length}`);
  say(`  matched on a near-miss spelling:   ${fuzzyMatched.length}`);
  say(`  unexpected mark values:            ${badMarks.length}`);
  say('');
  if (fuzzyMatched.length) {
    say('  MATCHED DESPITE A NAME DIFFERENCE (check each one):');
    fuzzyMatched.forEach((u) => say(u));
    say('');
  }
  if (unresolved.length) {
    say('  NOT FOUND IN THE DATABASE:');
    unresolved.forEach((u) => say(u));
    say('');
  }
  if (ambiguous.length) {
    say('  AMBIGUOUS:');
    ambiguous.forEach((u) => say(u));
    say('');
  }
  if (indexMoved.length) {
    say(
      '  INDEX NUMBER DIFFERS (workbook vs database) — matched by name anyway:'
    );
    indexMoved.forEach((u) => say(u));
    say('');
  }
  if (badMarks.length) {
    say('  UNEXPECTED MARK VALUES:');
    badMarks.forEach((u) => say(u));
    say('');
  }

  say('--- totals ---');
  say(`  workbook marks resolved to a student: ${wb.size}`);
  say(`  attendance_daily rows written so far: ${rawCount}`);
  say(`    superseded by a later correction:   ${supersededCount}`);
  say(`    live marks (what the app shows):    ${dbRows.length}`);
  say('');
  say(`  MISSING   (workbook has it, DB does not): ${missing.length}`);
  say(`  DIFFERENT (status disagrees):             ${different.length}`);
  say(
    `    of which the DB row was marked in-system: ${different.filter((d) => d.row.recorded_by).length}`
  );
  say(`  EXTRA     (DB has it, workbook blank):    ${extra.length}`);
  say(
    `    of which the DB row was marked in-system: ${extra.filter((e) => e.recorded_by).length}`
  );
  say('');

  say('=== DIFFERENT (all) ===');
  for (const d of different) {
    say(
      `  ${fmt(d.key)}  DB=${d.row.status} (${prov(d.row)})  workbook=${d.wbStatus}`
    );
  }
  say('');
  say('=== EXTRA (all) ===');
  for (const e of extra) {
    say(
      `  ${fmt(`${e.section_student_id}|${e.date}`)}  DB=${e.status} (${prov(e)})`
    );
  }
  say('');
  say('=== MISSING — first 60 of ' + missing.length + ' ===');
  for (const m of missing.slice(0, 60)) say(`  ${fmt(m.key)}  -> ${m.status}`);

  writeFileSync(OUT, L.join('\n') + '\n');
  console.log(`\nWrote ${OUT}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  });
