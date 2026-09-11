// scripts/backfill/gen-ay2026-t3-attendance-reimport.ts
// Generates the CORRECTIVE re-import for AY2026 T3 attendance from the latest
// register, as a preview report plus chunked apply files. Emits SQL for review
// — writes nothing to the database itself.
//
// Why this exists rather than re-running ay2026-t3-attendance-apply/:
//
//   1. The July import ran off a mid-term snapshot (29 Jun – 21 Jul). Its
//      apply files write school_calendar with `on conflict do nothing`, so the
//      21 dates it recorded as "no class" — which the finished register shows
//      as ordinary teaching days — stay wrong on a re-run.
//   2. Its marks insert is guarded by `where not exists (student, date)`, so
//      the 91 marks the register has since corrected stay at their old value.
//   3. It resolves a register row to a student by (section, index_number).
//      18 students' index numbers have since moved in the SIS, so that rule
//      would now file one child's attendance against another. This script
//      resolves by NAME within the section and reports every row it cannot
//      place, rather than guessing.
//
// `attendance_daily` is an append-only ledger (migration 014): a correction is
// a NEW row that supersedes the prior one by `recorded_at desc`. Nothing here
// updates or deletes a mark.
//
// Run: npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t3-attendance-reimport.ts
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createServiceClient } from '../../lib/supabase/service';
import { parseWorkbookT3 } from '../../lib/sis/backfill/attendance/attendance-workbook-t3';
import { buildAttendanceImportT3 } from '../../lib/sis/backfill/attendance/build-attendance-import-t3';
import { deriveSectionIdentity } from '../../lib/sis/backfill/enrollment/section-identity';
import {
  sqlString,
  sqlStringOrNull,
} from '../../lib/sis/backfill/enrollment/sql-escape';
import type { RosterLookupEntry } from '../../lib/sis/backfill/attendance/build-attendance-import-t3';

const AY_CODE = 'AY2026';
const TERM_NUMBER = 3;
const YEAR = 2026;
const WORKBOOK =
  process.env.T3_WORKBOOK ?? 'AY2026 Term 3 Attendance Latest.xlsx';
const APPLY_DIR = 'scripts/backfill/ay2026-t3-attendance-reimport-apply';
const PREVIEW = 'scripts/backfill/ay2026-t3-attendance-reimport-preview.sql';
const CHUNK = 2000;
const VALID = new Set(['P', 'A', 'EX', 'L']);

const CAL_ROW_RE =
  /^\s*\(date '(\d{4}-\d{2}-\d{2})',\s*'([a-z_]+)',\s*(?:true|false),\s*(.*)\)/;

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

function words(raw: string): string[] {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

function nameKey(raw: string): string {
  const [last = '', first = ''] = raw.split(',');
  return `${words(last).join(' ')}|${words(first).join(' ')}`;
}

function prefixAgree(a: string, b: string): boolean {
  if (a === b) return true;
  const [al, af] = a.split('|');
  const [bl, bf] = b.split('|');
  if (al !== bl) return false;
  return af.startsWith(bf) || bf.startsWith(af);
}

// Order-insensitive word overlap — catches a reversed surname/given name and
// a single-letter misspelling. Only accepted at >= 0.75 AND strictly ahead of
// the runner-up, because a wrong match here files one child's attendance
// against another.
function overlap(a: string, b: string): number {
  const wa = new Set(words(a));
  const wb = new Set(words(b));
  let hit = 0;
  for (const w of wa) if (wb.has(w)) hit++;
  return hit / Math.max(1, Math.min(wa.size, wb.size));
}

interface Mark {
  sectionStudentId: string;
  date: string;
  status: string;
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

  const { data: ssRows, error: ssErr } = await svc
    .from('section_students')
    .select(
      'id, index_number, enrollment_status, students(last_name, first_name), sections!inner(name, academic_year_id, levels!inner(code))'
    )
    .eq('sections.academic_year_id', (ay as any).id);
  if (ssErr) throw ssErr;

  const roster = (ssRows as any[]).map((r) => ({
    id: r.id,
    idx: r.index_number,
    status: r.enrollment_status,
    sec: `${r.sections.levels.code}::${r.sections.name}`,
    display: `${r.sections.levels.code} ${r.sections.name} #${r.index_number} ${r.students?.last_name}, ${r.students?.first_name}`,
    name: `${r.students?.last_name ?? ''}, ${r.students?.first_name ?? ''}`,
  }));

  const byName = new Map<string, typeof roster>();
  for (const r of roster) {
    const k = `${r.sec}::${nameKey(r.name)}`;
    byName.set(k, [...(byName.get(k) ?? []), r]);
  }

  // --- day classification, straight from the shipped builder ---
  const sections = parseWorkbookT3(WORKBOOK);
  const rosterLookup: RosterLookupEntry[] = roster.map((r) => ({
    levelCode: r.sec.split('::')[0],
    cleanName: r.sec.split('::')[1],
    indexNumber: r.idx,
    sectionStudentId: r.id,
  }));
  const built = buildAttendanceImportT3({
    sections,
    rosterLookup,
    ayCode: AY_CODE,
    termNumber: TERM_NUMBER,
    year: YEAR,
  });

  const wantCal = new Map<string, { dayType: string; label: string }>();
  for (const f of built.applyFiles) {
    if (!/-calendar\.sql$/.test(f.filename)) continue;
    for (const line of f.sql.split('\n')) {
      const m = CAL_ROW_RE.exec(line);
      if (m) wantCal.set(m[1], { dayType: m[2], label: m[3].trim() });
    }
  }

  // --- resolve the register, by name ---
  const marks: Mark[] = [];
  const unresolved: string[] = [];
  const fuzzy: string[] = [];
  const indexMoved: string[] = [];
  const droppedFromRegister: string[] = [];
  const seenIds = new Set<string>();

  for (const parsed of sections) {
    if (parsed.section.students.length === 0) continue;
    const identity = deriveSectionIdentity(parsed.section.sheetName);
    if (identity.kind !== 'core') continue;
    const sec = `${identity.levelCode}::${normalizeCleanNameT3(identity.cleanName)}`;

    for (const s of parsed.section.students) {
      const nk = nameKey(s.fullName);
      let hits = byName.get(`${sec}::${nk}`) ?? [];
      if (hits.length === 0) {
        for (const [k, v] of byName) {
          if (!k.startsWith(`${sec}::`)) continue;
          if (prefixAgree(nk, k.slice(sec.length + 2))) {
            hits = v;
            break;
          }
        }
      }
      if (hits.length === 0) {
        let best: (typeof roster)[number] | null = null;
        let bestScore = 0;
        let runnerUp = 0;
        for (const r of roster) {
          if (r.sec !== sec) continue;
          const sc = overlap(s.fullName, r.name);
          if (sc > bestScore) {
            runnerUp = bestScore;
            bestScore = sc;
            best = r;
          } else if (sc > runnerUp) runnerUp = sc;
        }
        if (best && bestScore >= 0.75 && bestScore > runnerUp) {
          hits = [best];
          fuzzy.push(
            `  ${sec.replace('::', ' ')}: register "${s.fullName}" -> SIS "${best.name}" (#${best.idx}, score ${bestScore.toFixed(2)})`
          );
        }
      }
      if (hits.length !== 1) {
        unresolved.push(
          `  ${sec.replace('::', ' ')} #${s.indexNo} "${s.fullName}" — ${hits.length === 0 ? 'no matching student in the SIS' : `${hits.length} possible matches`}`
        );
        continue;
      }

      const target = hits[0];
      seenIds.add(target.id);
      if (Number.parseInt(s.indexNo, 10) !== target.idx) {
        indexMoved.push(
          `  ${sec.replace('::', ' ')} "${s.fullName}": register #${s.indexNo}, SIS #${target.idx}`
        );
      }

      for (const [rawDate, rawMark] of Object.entries(s.marks)) {
        const iso = isoFor(rawDate);
        if (!iso) continue;
        if (wantCal.get(iso)?.dayType !== 'school_day') continue;
        const mark = rawMark.trim().toUpperCase();
        if (!mark || !VALID.has(mark)) continue;
        marks.push({ sectionStudentId: target.id, date: iso, status: mark });
      }
    }
  }

  // students the SIS still carries that the register no longer lists
  for (const r of roster) {
    if (seenIds.has(r.id)) continue;
    droppedFromRegister.push(
      `  ${r.display}${r.status !== 'active' ? ` [${r.status}]` : ''}`
    );
  }

  // --- current calendar, to write only the dates that actually disagree ---
  const { data: dbCal, error: calErr } = await svc
    .from('school_calendar')
    .select('date, day_type, label')
    .eq('term_id', (term as any).id);
  if (calErr) throw calErr;
  const haveCal = new Map(
    (dbCal as any[]).map((r) => [
      r.date,
      { dayType: r.day_type, label: r.label },
    ])
  );

  const calFixes: { date: string; from: string; to: string; label: string }[] =
    [];
  const calInserts: { date: string; to: string; label: string }[] = [];
  for (const [date, want] of wantCal) {
    const have = haveCal.get(date);
    if (!have) calInserts.push({ date, to: want.dayType, label: want.label });
    else if (have.dayType !== want.dayType)
      calFixes.push({
        date,
        from: have.dayType,
        to: want.dayType,
        label: want.label,
      });
  }

  // ---------------- SQL ----------------
  const files: { filename: string; sql: string; description: string }[] = [];
  const header = (n: number, total: number, what: string) => [
    `-- AY2026 T3 attendance RE-IMPORT — APPLY file ${n} of ${total}: ${what}`,
    '--',
    '-- Read ay2026-t3-attendance-reimport-preview.sql FIRST, then run these',
    '-- files IN ORDER, one file per SQL-editor run. Generated by',
    '-- gen-ay2026-t3-attendance-reimport.ts — do not hand-edit; regenerate.',
    '-- Each file is its own transaction and is safe to re-run.',
    '--',
  ];

  const markChunks: Mark[][] = [];
  for (let i = 0; i < marks.length; i += CHUNK)
    markChunks.push(marks.slice(i, i + CHUNK));
  const totalFiles = 1 + markChunks.length + 1;
  let n = 1;

  // --- file 1: school_calendar day-type corrections ---
  {
    const lines = header(n, totalFiles, 'school_calendar corrections');
    lines.push(
      `-- ${calFixes.length} date(s) currently hold the wrong day type because the July`,
      '-- import ran off a register that had not been filled in past 21 July.',
      `-- ${calInserts.length} date(s) are missing from school_calendar entirely.`,
      '--'
    );
    for (const f of calFixes)
      lines.push(`--   ${f.date}: ${f.from} -> ${f.to}`);
    lines.push('');
    lines.push('begin;');
    lines.push('');
    if (calFixes.length === 0 && calInserts.length === 0) {
      lines.push('-- nothing to correct');
    } else {
      lines.push('drop table if exists _t3reimp_cal;');
      lines.push('create temp table _t3reimp_cal (date, day_type, label) as');
      lines.push('values');
      lines.push(
        [...calFixes, ...calInserts.map((c) => ({ ...c, from: '(missing)' }))]
          .map(
            (c) =>
              `  (date ${sqlString(c.date)}, ${sqlString(c.to)}, ${c.label === 'NULL' ? 'NULL' : c.label})`
          )
          .join(',\n') + ';'
      );
      lines.push('');
      lines.push('-- existing rows: correct the day type in place');
      lines.push('update school_calendar sc');
      lines.push('set day_type = c.day_type,');
      lines.push('    label = coalesce(c.label, sc.label)');
      lines.push('from _t3reimp_cal c');
      lines.push(
        'join academic_years ay on ay.ay_code = ' + sqlString(AY_CODE)
      );
      lines.push(
        `join terms t on t.academic_year_id = ay.id and t.term_number = ${TERM_NUMBER}`
      );
      lines.push('where sc.term_id = t.id and sc.date = c.date;');
      lines.push('');
      lines.push('-- any date not present at all');
      lines.push(
        'insert into school_calendar (term_id, date, day_type, hbl_overlay, label)'
      );
      lines.push('select t.id, c.date, c.day_type, false, c.label');
      lines.push('from _t3reimp_cal c');
      lines.push(
        'join academic_years ay on ay.ay_code = ' + sqlString(AY_CODE)
      );
      lines.push(
        `join terms t on t.academic_year_id = ay.id and t.term_number = ${TERM_NUMBER}`
      );
      lines.push('on conflict (term_id, audience, date) do nothing;');
    }
    lines.push('');
    lines.push('commit;');
    files.push({
      filename: '01-calendar-corrections.sql',
      sql: lines.join('\n') + '\n',
      description: `school_calendar: ${calFixes.length} corrected, ${calInserts.length} inserted`,
    });
    n++;
  }

  // --- files 2..: attendance_daily ledger rows ---
  markChunks.forEach((chunk, i) => {
    const lines = header(
      n,
      totalFiles,
      `attendance_daily marks (chunk ${i + 1} of ${markChunks.length})`
    );
    lines.push(
      '-- attendance_daily is an APPEND-ONLY ledger: a correction is a new row',
      '-- that supersedes the prior one by `recorded_at desc`. Nothing is',
      '-- updated or deleted here.',
      '--',
      '-- A row is written only when the register disagrees with the mark the',
      '-- app currently shows, so re-running this file is a no-op. A day a',
      '-- teacher has marked inside the system is never overwritten — their',
      '-- mark is newer knowledge than the register.',
      '--',
      '-- ex_reason / ex_note stay NULL: the register carries no reason text.',
      '--'
    );
    lines.push('begin;');
    lines.push('');
    lines.push('drop table if exists _t3reimp_marks;');
    lines.push(
      'create temp table _t3reimp_marks (section_student_id, date, status) as'
    );
    lines.push('values');
    lines.push(
      chunk
        .map(
          (m) =>
            `  (${sqlString(m.sectionStudentId)}, date ${sqlString(m.date)}, ${sqlString(m.status)})`
        )
        .join(',\n') + ';'
    );
    lines.push('');
    lines.push('-- the mark the app shows today, per (student, date)');
    lines.push('drop table if exists _t3reimp_live;');
    lines.push('create temp table _t3reimp_live as');
    lines.push('select distinct on (ad.section_student_id, ad.date)');
    lines.push(
      '       ad.section_student_id, ad.date, ad.status, ad.recorded_by'
    );
    lines.push('from attendance_daily ad');
    lines.push('join academic_years ay on ay.ay_code = ' + sqlString(AY_CODE));
    lines.push(
      `join terms t on t.academic_year_id = ay.id and t.term_number = ${TERM_NUMBER}`
    );
    lines.push('where ad.term_id = t.id and ad.period_id is null');
    lines.push('order by ad.section_student_id, ad.date, ad.recorded_at desc;');
    lines.push('');
    lines.push(
      'insert into attendance_daily (section_student_id, term_id, date, status, ex_reason, ex_note, period_id, recorded_by, recorded_at)'
    );
    lines.push(
      'select m.section_student_id::uuid, t.id, m.date, m.status, null, null, null, null, now()'
    );
    lines.push('from _t3reimp_marks m');
    lines.push('join academic_years ay on ay.ay_code = ' + sqlString(AY_CODE));
    lines.push(
      `join terms t on t.academic_year_id = ay.id and t.term_number = ${TERM_NUMBER}`
    );
    lines.push('left join _t3reimp_live l');
    lines.push('  on l.section_student_id = m.section_student_id::uuid');
    lines.push('  and l.date = m.date');
    lines.push('where l.section_student_id is null            -- no mark yet');
    lines.push(
      '   or (l.status is distinct from m.status     -- register disagrees'
    );
    lines.push(
      '       and l.recorded_by is null);            -- and no teacher has touched it'
    );
    lines.push('');
    lines.push('commit;');
    files.push({
      filename: `${String(n).padStart(2, '0')}-marks-${String(i + 1).padStart(2, '0')}-of-${String(markChunks.length).padStart(2, '0')}.sql`,
      sql: lines.join('\n') + '\n',
      description: `attendance_daily — chunk ${i + 1} (${chunk.length} register marks)`,
    });
    n++;
  });

  // --- last file: rollups + verification ---
  {
    const ids = [...new Set(marks.map((m) => m.sectionStudentId))];
    const lines = header(n, totalFiles, 'rollups + verification');
    lines.push(
      `-- Recomputes attendance_records for the ${ids.length} students touched above.`,
      '--'
    );
    lines.push('begin;');
    lines.push('');
    for (const id of ids) {
      lines.push(
        `select public.recompute_attendance_rollup(t.id, ${sqlString(id)}::uuid) from academic_years ay join terms t on t.academic_year_id = ay.id and t.term_number = ${TERM_NUMBER} where ay.ay_code = ${sqlString(AY_CODE)};`
      );
    }
    lines.push('');
    lines.push('commit;');
    lines.push('');
    lines.push('-- === verification (read-only) ===');
    lines.push('select');
    lines.push(
      `  (select count(*) from school_calendar sc join terms t on t.id=sc.term_id join academic_years ay on ay.id=t.academic_year_id where ay.ay_code=${sqlString(AY_CODE)} and t.term_number=${TERM_NUMBER} and sc.day_type='school_day') as school_days,`
    );
    lines.push(
      `  (select count(*) from attendance_records ar join terms t on t.id=ar.term_id join academic_years ay on ay.id=t.academic_year_id where ay.ay_code=${sqlString(AY_CODE)} and t.term_number=${TERM_NUMBER}) as rollups;`
    );
    lines.push(
      `-- expect school_days = ${[...wantCal.values()].filter((c) => c.dayType === 'school_day').length}`
    );
    lines.push('');
    lines.push('-- attendance percentages should spread, not sit at 0 or 100');
    lines.push(
      `select min(attendance_pct), round(avg(attendance_pct),1), max(attendance_pct), count(*)`
    );
    lines.push(
      `from attendance_records ar join terms t on t.id=ar.term_id join academic_years ay on ay.id=t.academic_year_id`
    );
    lines.push(
      `where ay.ay_code=${sqlString(AY_CODE)} and t.term_number=${TERM_NUMBER};`
    );
    files.push({
      filename: `${String(n).padStart(2, '0')}-rollups-and-verify.sql`,
      sql: lines.join('\n') + '\n',
      description: `rollups + verification (${ids.length} students)`,
    });
  }

  // ---------------- preview ----------------
  const P: string[] = [];
  const p = (s = '') => P.push(s);
  p('-- AY2026 T3 attendance RE-IMPORT — PREVIEW (read-only)');
  p('--');
  p(`-- Register: ${WORKBOOK}`);
  p('--');
  p('-- WHAT THIS CORRECTS');
  p(`--   register marks resolved to a student: ${marks.length}`);
  p(
    `--   school days per the register:         ${[...wantCal.values()].filter((c) => c.dayType === 'school_day').length}`
  );
  p(`--   calendar dates to correct:            ${calFixes.length}`);
  p(`--   calendar dates to insert:             ${calInserts.length}`);
  p('--');
  for (const f of calFixes) p(`--   ${f.date}: ${f.from} -> ${f.to}`);
  p('--');
  p('-- ROSTER RESOLUTION (by name within the section, never by index number)');
  p(`--   students matched:                     ${seenIds.size}`);
  p(`--   matched despite a name difference:    ${fuzzy.length}`);
  p(`--   index number differs register vs SIS: ${indexMoved.length}`);
  p(`--   register rows NOT matched:            ${unresolved.length}`);
  p(`--   in the SIS but not in the register:   ${droppedFromRegister.length}`);
  p('--');
  if (fuzzy.length) {
    p('-- MATCHED DESPITE A NAME DIFFERENCE — check each one:');
    fuzzy.forEach((l) => p(`--${l}`));
    p('--');
  }
  if (unresolved.length) {
    p('-- NOT MATCHED — these register rows are NOT imported:');
    unresolved.forEach((l) => p(`--${l}`));
    p('--');
  }
  if (indexMoved.length) {
    p('-- INDEX NUMBER DIFFERS (matched by name; nothing is renumbered here):');
    indexMoved.forEach((l) => p(`--${l}`));
    p('--');
  }
  if (droppedFromRegister.length) {
    p('-- IN THE SIS BUT NOT IN THE REGISTER — existing marks are left alone:');
    droppedFromRegister.forEach((l) => p(`--${l}`));
    p('--');
  }
  p('-- APPLY FILES — run in this order, one per SQL-editor run:');
  for (const f of files) p(`--   ${f.filename}  — ${f.description}`);
  p('');
  p('-- Read-only: what the database holds right now.');
  p('select sc.day_type, count(*)');
  p('from school_calendar sc');
  p('join terms t on t.id = sc.term_id');
  p('join academic_years ay on ay.id = t.academic_year_id');
  p(
    `where ay.ay_code = ${sqlString(AY_CODE)} and t.term_number = ${TERM_NUMBER}`
  );
  p('group by sc.day_type order by 2 desc;');
  p('');

  writeFileSync(PREVIEW, P.join('\n') + '\n');
  rmSync(APPLY_DIR, { recursive: true, force: true });
  mkdirSync(APPLY_DIR, { recursive: true });
  for (const f of files) writeFileSync(join(APPLY_DIR, f.filename), f.sql);

  console.log(P.join('\n'));
  console.log(`\nWrote ${PREVIEW}`);
  console.log(`Wrote ${files.length} apply files to ${APPLY_DIR}/`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  });
