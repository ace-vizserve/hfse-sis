// scripts/backfill/gen-withdrawal-dates-from-remarks.ts
//
// READS the withdrawal dates the office wrote in prose and WRITES A PREVIEW.
// It changes nothing itself — same shape as the calendar reconciliation:
// the documents answer the question, a human confirms the reading.
//
// ── WHY ────────────────────────────────────────────────────────────────────
//
// Mr Ace, 2026-09-16: "before SIS they are using remarks about the details",
// then: "did you import the withdrawn remarks? i think we should."
//
// `ay{YYYY}_enrolment_status` has no withdrawal date column, so the office
// records it in `applicationRemarks`:
//
//   "<p>Withdrawal approved 11 May 2026<br>Last Day: 26 April 2026</p>"
//
// Migration 163 gave both dates a home — `withdrawal_date` (last day of
// attendance) and `withdrawal_approved_date`. This reads the prose into them.
//
// ── WHAT IT WILL AND WILL NOT DECIDE ───────────────────────────────────────
//
// ⚠ THE WORDING VARIES AND SOME ROWS SAY NOTHING. Across AY2026's 23 withdrawn
// rows the office wrote "Last Day:", "Last Day", "last Day of attendance",
// "Last Day of Attendance:", one with no year at all ("Last Day 29 May"), and
// several with no last day of any kind ("Withdrawn", "Approved via Teama 13
// March 2026"). A parser that resolves all of those is a parser that is
// guessing.
//
// So this script is deliberately timid. It emits a row as READY only when the
// last day is unambiguous — a day, a named month, and a four-digit year, found
// after a "last day" phrase. Everything else is emitted as NEEDS A HUMAN with
// the raw prose printed beside it, for Mr Ace to read and fill in by hand.
// A confident wrong date on a child's record is worse than a blank one.
//
// ⚠ A MISSING YEAR IS NOT INFERRED. "Last Day 29 May" could be 2026 given the
// row's academic year, and that is exactly the kind of reasoning that produces
// a plausible wrong answer. It goes in the human pile.
//
// ⚠ IT ONLY FILLS BLANKS. A row that already carries a `withdrawal_date` is
// left alone and reported, because 11 rows hold dates written by the old
// auto-stamp (migration 163's header) and this script cannot tell those from a
// date somebody entered on purpose.
//
// STRICTLY READ-ONLY. Emits SQL for review; does not write.
//
// Run:
//   npx tsx --env-file=.env.local scripts/backfill/gen-withdrawal-dates-from-remarks.ts
//   npx tsx --env-file=.env.local scripts/backfill/gen-withdrawal-dates-from-remarks.ts --ay AY2026
import { writeFileSync } from 'node:fs';

import { createServiceClient } from '../../lib/supabase/service';
import { createAdmissionsClient } from '../../lib/supabase/admissions';

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** `26 April 2026` or `April 26 2026` / `April 26, 2026` → `2026-04-26`. */
function parseDate(text: string): string | null {
  const dmy = text.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(20\d{2})\b/);
  if (dmy) {
    const m = MONTHS[dmy[2].toLowerCase()];
    if (m) return iso(Number(dmy[3]), m, Number(dmy[1]));
  }
  const mdy = text.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(20\d{2})\b/);
  if (mdy) {
    const m = MONTHS[mdy[1].toLowerCase()];
    if (m) return iso(Number(mdy[3]), m, Number(mdy[2]));
  }
  return null;
}

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * The phrase, then the date after it. Anchoring on the phrase is what stops
 * "Withdrawal approved 11 May 2026 / Last Day: 26 April 2026" yielding 11 May
 * as the last day — the two dates sit in one blob and order is not enough.
 */
function afterPhrase(text: string, phrase: RegExp): string | null {
  const m = text.match(phrase);
  if (!m || m.index === undefined) return null;
  // Read to the end of that line only. A following line is a different fact.
  const rest = text.slice(m.index + m[0].length).split('\n')[0];
  return parseDate(rest);
}

type Row = {
  enroleeNumber: string;
  name: string;
  remarks: string;
  lastDay: string | null;
  approved: string | null;
  existingDate: string | null;
  studentNumber: string | null;
};

async function main() {
  const i = process.argv.indexOf('--ay');
  const onlyAy = i >= 0 ? process.argv[i + 1] : null;

  const svc = createServiceClient();
  const admissions = createAdmissionsClient();

  const { data: years } = await svc
    .from('academic_years')
    .select('ay_code')
    .order('ay_code');
  const codes = (years ?? [])
    .map((y) => (y as { ay_code: string }).ay_code)
    .filter((c) => !onlyAy || c === onlyAy);

  const sql: string[] = [
    '-- Generated by scripts/backfill/gen-withdrawal-dates-from-remarks.ts',
    '-- Withdrawal dates read out of the admissions remarks. Review every row.',
    '-- `withdrawal_date` is the LAST DAY OF ATTENDANCE (migration 163).',
    'begin;',
  ];
  let ready = 0;
  let needsHuman = 0;
  let alreadySet = 0;

  for (const ayCode of codes) {
    const prefix = `ay${ayCode.slice(2)}`;
    const { data, error } = await admissions
      .from(`${prefix}_enrolment_status`)
      .select(
        'enroleeNumber, enroleeName, applicationStatus, applicationRemarks'
      )
      .eq('applicationStatus', 'Withdrawn');
    if (error) {
      console.log(`${ayCode}: ${error.message}`);
      continue;
    }
    const raw = (data ?? []) as {
      enroleeNumber: string;
      enroleeName: string | null;
      applicationRemarks: string | null;
    }[];
    if (raw.length === 0) continue;

    // Map enrolee -> student number -> the enrolment row we would update.
    const { data: apps } = await admissions
      .from(`${prefix}_enrolment_applications`)
      .select('enroleeNumber, studentNumber')
      .in(
        'enroleeNumber',
        raw.map((r) => r.enroleeNumber)
      );
    const numberByEnrolee = new Map(
      (apps ?? []).map((a) => [
        (a as { enroleeNumber: string }).enroleeNumber,
        (a as { studentNumber: string | null }).studentNumber,
      ])
    );

    const rows: Row[] = [];
    for (const r of raw) {
      const text = stripHtml(r.applicationRemarks ?? '');
      rows.push({
        enroleeNumber: r.enroleeNumber,
        name: (r.enroleeName ?? '').trim(),
        remarks: text,
        lastDay: afterPhrase(text, /last\s*day(\s*of\s*attendance)?\s*:?/i),
        approved: afterPhrase(
          text,
          /(withdrawal\s*(approval|approved)|approved\s*withdrawal)\s*:?/i
        ),
        existingDate: null,
        studentNumber: numberByEnrolee.get(r.enroleeNumber) ?? null,
      });
    }

    // What the SIS already holds, so a row with a date is left alone.
    const numbers = rows
      .map((r) => r.studentNumber)
      .filter((n): n is string => !!n);
    const { data: students } = await svc
      .from('students')
      .select('id, student_number')
      .in('student_number', numbers);
    const idByNumber = new Map(
      (students ?? []).map((s) => [
        (s as { student_number: string }).student_number,
        (s as { id: string }).id,
      ])
    );
    const { data: ay } = await svc
      .from('academic_years')
      .select('id')
      .eq('ay_code', ayCode)
      .maybeSingle();
    const { data: enrolments } = await svc
      .from('section_students')
      .select(
        'id, student_id, withdrawal_date, section:sections!inner(academic_year_id)'
      )
      .in('student_id', [...idByNumber.values()])
      .eq('sections.academic_year_id', (ay as { id: string } | null)?.id ?? '');
    const enrolByStudent = new Map(
      (enrolments ?? []).map((e) => [
        (e as { student_id: string }).student_id,
        e as { id: string; withdrawal_date: string | null },
      ])
    );

    console.log(`\n${'='.repeat(72)}`);
    console.log(`${ayCode} — ${rows.length} withdrawn`);
    console.log('='.repeat(72));

    sql.push('', `-- ${ayCode}`);

    for (const r of rows.sort((a, b) =>
      a.enroleeNumber.localeCompare(b.enroleeNumber)
    )) {
      const studentId = r.studentNumber
        ? idByNumber.get(r.studentNumber)
        : undefined;
      const enrol = studentId ? enrolByStudent.get(studentId) : undefined;
      const who = `${r.enroleeNumber} ${r.name.slice(0, 28).padEnd(30)}`;

      if (!enrol) {
        console.log(`  SKIP   ${who} no ${ayCode} enrolment row in the SIS`);
        continue;
      }
      if (enrol.withdrawal_date) {
        alreadySet += 1;
        console.log(
          `  HAS    ${who} already ${enrol.withdrawal_date} — left alone`
        );
        continue;
      }
      if (!r.lastDay) {
        needsHuman += 1;
        console.log(
          `  HUMAN  ${who} ${r.remarks.replace(/\n/g, ' / ').slice(0, 70) || '(no remark)'}`
        );
        continue;
      }

      ready += 1;
      console.log(
        `  READY  ${who} last day ${r.lastDay}` +
          (r.approved ? `  approved ${r.approved}` : '  (no approval date)')
      );
      sql.push(
        `update public.section_students set withdrawal_date = '${r.lastDay}'` +
          (r.approved ? `, withdrawal_approved_date = '${r.approved}'` : '') +
          ` where id = '${enrol.id}';  -- ${r.enroleeNumber} ${r.name}`
      );
    }
  }

  sql.push('', 'commit;');
  const out = 'scripts/backfill/withdrawal-dates-from-remarks-apply.sql';
  writeFileSync(out, sql.join('\n') + '\n', 'utf8');

  console.log(
    `\n${'-'.repeat(72)}\n` +
      `  ready to write : ${ready}\n` +
      `  needs a human  : ${needsHuman}\n` +
      `  already set    : ${alreadySet}\n` +
      `\nWrote ${out} — READ IT before running anything.\n`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
