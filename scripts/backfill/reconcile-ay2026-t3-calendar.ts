// scripts/backfill/reconcile-ay2026-t3-calendar.ts
// Read-only. Compares the LATEST T3 workbook's day classification against
// what school_calendar / calendar_events currently hold, and lists the
// roster rows the two workbooks disagree about.
//
// Matters because the T3 apply SQL writes school_calendar with
// `on conflict do nothing` and calendar_events with `where not exists` —
// so a day already stored as `no_class` stays `no_class` on a re-run even
// when the fuller workbook now shows it as a teaching day.
//
// Run: npx tsx --env-file=.env.local scripts/backfill/reconcile-ay2026-t3-calendar.ts
import { writeFileSync } from 'node:fs';

import { createServiceClient } from '../../lib/supabase/service';
import { parseWorkbookT3 } from '../../lib/sis/backfill/attendance/attendance-workbook-t3';
import { buildAttendanceImportT3 } from '../../lib/sis/backfill/attendance/build-attendance-import-t3';
import type { RosterLookupEntry } from '../../lib/sis/backfill/attendance/build-attendance-import-t3';

const AY_CODE = 'AY2026';
const TERM_NUMBER = 3;
const YEAR = 2026;
const OLD_WORKBOOK = 'AY2026/T3/AY2026 Term 3 Attendance (1).xlsx';
const NEW_WORKBOOK = 'AY2026 Term 3 Attendance Latest.xlsx';
const OUT = 'scripts/backfill/ay2026-t3-attendance-calendar-report.txt';

// `  (date '2026-06-29', 'school_day', false, null)` — the school_calendar
// temp-table VALUES rows the builder emits.
const CAL_ROW_RE =
  /^\s*\(date '(\d{4}-\d{2}-\d{2})',\s*'([a-z_]+)',\s*(?:true|false),\s*(.*)\)/;

function classificationsFrom(applyFiles: { filename: string; sql: string }[]) {
  const out = new Map<string, { dayType: string; label: string }>();
  for (const f of applyFiles) {
    if (!/-calendar\.sql$/.test(f.filename)) continue;
    for (const line of f.sql.split('\n')) {
      const m = CAL_ROW_RE.exec(line);
      if (m) out.set(m[1], { dayType: m[2], label: m[3].trim() });
    }
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
      'id, index_number, sections!inner(name, academic_year_id, levels!inner(code))'
    )
    .eq('sections.academic_year_id', (ay as any).id);
  if (rowsErr) throw rowsErr;
  const rosterLookup: RosterLookupEntry[] = (rows ?? []).map((r: any) => ({
    levelCode: r.sections.levels.code,
    cleanName: r.sections.name,
    indexNumber: r.index_number,
    sectionStudentId: r.id,
  }));

  const build = (path: string) =>
    buildAttendanceImportT3({
      sections: parseWorkbookT3(path),
      rosterLookup,
      ayCode: AY_CODE,
      termNumber: TERM_NUMBER,
      year: YEAR,
    });

  const oldRes = build(OLD_WORKBOOK);
  const newRes = build(NEW_WORKBOOK);
  const oldCal = classificationsFrom(oldRes.applyFiles);
  const newCal = classificationsFrom(newRes.applyFiles);

  const { data: dbCal, error: calErr } = await svc
    .from('school_calendar')
    .select('date, day_type, label')
    .eq('term_id', (term as any).id)
    .order('date');
  if (calErr) throw calErr;
  const db = new Map(
    (dbCal as any[]).map((r) => [
      r.date,
      { dayType: r.day_type, label: r.label },
    ])
  );

  const { data: dbEv, error: evErr } = await svc
    .from('calendar_events')
    .select('start_date, end_date, label, category, audience')
    .eq('term_id', (term as any).id)
    .order('start_date');
  if (evErr) throw evErr;

  const L: string[] = [];
  const say = (s = '') => {
    L.push(s);
    console.log(s);
  };

  say('AY2026 T3 — calendar / day-type reconcile (read-only)');
  say('');
  say(
    `old workbook school days: ${oldRes.stats.schoolDays}  holidays: ${oldRes.stats.holidays}  events: ${oldRes.stats.events}`
  );
  say(
    `new workbook school days: ${newRes.stats.schoolDays}  holidays: ${newRes.stats.holidays}  events: ${newRes.stats.events}`
  );
  say(
    `DB school_calendar rows:  ${db.size}   calendar_events rows: ${(dbEv as any[]).length}`
  );
  say('');

  say('=== day-type: DB vs NEW workbook (only where they disagree) ===');
  let n = 0;
  for (const [date, nw] of [...newCal].sort()) {
    const d = db.get(date);
    const o = oldCal.get(date);
    if (!d) {
      say(`  ${date}  DB=(missing)        new=${nw.dayType}  ${nw.label}`);
      n++;
      continue;
    }
    if (d.dayType !== nw.dayType) {
      say(
        `  ${date}  DB=${d.dayType.padEnd(15)} new=${nw.dayType.padEnd(15)} (old workbook said ${o?.dayType ?? '-'})  ${nw.label}`
      );
      n++;
    }
  }
  say(`  -> ${n} dates disagree`);
  say('');

  say('=== calendar_events currently in the DB ===');
  for (const e of dbEv as any[]) {
    say(
      `  ${e.start_date}${e.end_date !== e.start_date ? `..${e.end_date}` : ''}  ${e.category}  [${e.audience}]  ${e.label}`
    );
  }
  say('');

  say('=== events the NEW workbook wants ===');
  for (const f of newRes.applyFiles) {
    if (!/-events\.sql$/.test(f.filename)) continue;
    for (const line of f.sql.split('\n')) {
      if (/^\s*\(date '/.test(line)) say(`  ${line.trim()}`);
    }
  }
  say('');

  say('=== needs-review (new workbook) ===');
  for (const line of newRes.preview.split('\n')) {
    if (/^--\s+\[/.test(line)) say(`  ${line.replace(/^--\s+/, '')}`);
  }

  writeFileSync(OUT, L.join('\n') + '\n');
  console.log(`\nWrote ${OUT}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  });
