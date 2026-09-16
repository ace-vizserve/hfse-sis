// scripts/audit-document-needs-by-category.ts
//
// WHAT DOES A "CURRENT" STUDENT'S DOCUMENT ROW ACTUALLY HOLD?
//
// ── WHY ────────────────────────────────────────────────────────────────────
//
// Mr Ace, 2026-09-16, supplied the school's real document lists: one set for
// New students (the eight school forms) and a much shorter set for Current
// students (Form 12 + Signed Contract, plus re-collecting passports/passes
// ONLY when the previous copy expired, and a medical report ONLY when there
// is a new condition to declare).
//
// Before making any slot conditional on category, three things have to be
// measured rather than assumed:
//
//  1. IS `category` EVEN POPULATED? A condition keyed on a column that is
//     null for most rows would hide documents for nearly everyone. The
//     `hollow columns` lesson: the seeder stamps columns that are empty in
//     production, so dashboards look fine and real data is hollow.
//
//  2. FOR A CURRENT STUDENT, IS THE AY ROW BLANK? Nothing copies documents
//     forward between academic years -- each ay{YYYY}_enrolment_documents
//     table starts empty and the parent portal fills it on submit. If a
//     returning student's row is blank, then "hide the one-time documents"
//     and "the school already holds them" are two very different claims, and
//     only one of them is true.
//
//  3. CAN "IF THE PREVIOUS COPY IS EXPIRED" BE COMPUTED AT ALL? That needs a
//     prior-year expiry date to compare against. This checks whether the
//     prior AY actually carries one.
//
// STRICTLY READ-ONLY. SELECTs only. No --fix, nothing to apply.
//
// Run:
//   npx tsx --env-file=.env.local scripts/audit-document-needs-by-category.ts
import { createServiceClient } from '../lib/supabase/service';
import { createAdmissionsClient } from '../lib/supabase/admissions';

// The one-time documents a Current student is NOT asked for again, per the
// school's list. Measured here to see whether they are on file or blank.
const ONE_TIME_SLOTS = ['idPicture', 'birthCert', 'educCert'];

// The school forms (migration 135). Per the school's list these belong to New
// students only -- except Form 12 and Signed Contract, which both lists carry.
const NEW_ONLY_FORMS = [
  'lastSchoolRecommendation',
  'assessmentResult',
  'newStudentChecksheet',
  'pfilesChecklist',
  'preCounsellingAck',
];
const BOTH_LISTS = ['form12', 'signedContract'];

// Expiring slots -- re-collected only when the previous copy expired.
const EXPIRING_SLOTS = [
  'passport',
  'pass',
  'motherPassport',
  'motherPass',
  'fatherPassport',
  'fatherPass',
  'guardianPassport',
  'guardianPass',
];

type Row = Record<string, string | null>;

function filled(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

/** How many of `keys` are filled on `row`. */
function countFilled(row: Row | undefined, keys: string[]): number {
  if (!row) return 0;
  return keys.filter((k) => filled(row[k])).length;
}

async function main() {
  const svc = createServiceClient();
  const admissions = createAdmissionsClient();

  const { data: years } = await svc
    .from('academic_years')
    .select('id, ay_code')
    .order('ay_code');

  const ayCodes = (years ?? []).map((y) => (y as { ay_code: string }).ay_code);
  console.log(`Academic years: ${ayCodes.join(', ')}\n`);

  for (const ayCode of ayCodes) {
    const prefix = `ay${ayCode.slice(2)}`;

    // ── Category population ────────────────────────────────────────────────
    const { data: statusRows, error: sErr } = await admissions
      .from(`${prefix}_enrolment_status`)
      .select('enroleeNumber, enroleeType, applicationStatus');
    if (sErr) {
      console.log(`${ayCode}: no status table (${sErr.message})\n`);
      continue;
    }
    const statuses = (statusRows ?? []) as unknown as {
      enroleeNumber: string;
      enroleeType: string | null;
      applicationStatus: string | null;
    }[];
    if (statuses.length === 0) {
      console.log(`${ayCode}: status table empty\n`);
      continue;
    }

    const { data: appRows } = await admissions
      .from(`${prefix}_enrolment_applications`)
      .select('enroleeNumber, category');
    const apps = (appRows ?? []) as unknown as {
      enroleeNumber: string;
      category: string | null;
    }[];
    const catByEnrolee = new Map(
      apps.map((a) => [a.enroleeNumber, a.category])
    );

    console.log(`══ ${ayCode} ══ (${statuses.length} status rows)`);

    // enroleeType (status row) vs category (apps row) -- the schema comment
    // claims they always agree. Verify rather than trust.
    const typeCounts = new Map<string, number>();
    const catCounts = new Map<string, number>();
    let disagree = 0;
    for (const s of statuses) {
      const t = (s.enroleeType ?? '').trim() || '(blank)';
      typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
      const c = (catByEnrolee.get(s.enroleeNumber) ?? '').trim() || '(blank)';
      catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
      if (t !== c) disagree += 1;
    }
    console.log('  enroleeType (status row):');
    for (const [k, v] of [...typeCounts].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${k.padEnd(22)} ${v}`);
    }
    console.log('  category (applications row):');
    for (const [k, v] of [...catCounts].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${k.padEnd(22)} ${v}`);
    }
    console.log(
      `  → rows where the two DISAGREE: ${disagree}` +
        (disagree > 0 ? '  ⚠ they are NOT interchangeable' : '')
    );

    // ── What each category's document row actually holds ───────────────────
    const allSlots = [
      ...ONE_TIME_SLOTS,
      ...NEW_ONLY_FORMS,
      ...BOTH_LISTS,
      ...EXPIRING_SLOTS,
    ];
    const selectCols = [
      'enroleeNumber',
      ...allSlots,
      ...EXPIRING_SLOTS.map((s) => `${s}Expiry`),
    ];
    const { data: docRows, error: dErr } = await admissions
      .from(`${prefix}_enrolment_documents`)
      .select(selectCols.join(','));
    if (dErr) {
      console.log(`  documents: ${dErr.message}\n`);
      continue;
    }
    const docs = (docRows ?? []) as unknown as Row[];
    const docByEnrolee = new Map(docs.map((d) => [String(d.enroleeNumber), d]));
    console.log(`  documents rows: ${docs.length}`);

    // Group students by category and report averages.
    const byCat = new Map<string, string[]>();
    for (const s of statuses) {
      const c = (s.enroleeType ?? '').trim() || '(blank)';
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c)!.push(s.enroleeNumber);
    }

    for (const [cat, enrolees] of [...byCat].sort(
      (a, b) => b[1].length - a[1].length
    )) {
      const rows = enrolees
        .map((e) => docByEnrolee.get(e))
        .filter((r): r is Row => r != null);
      if (rows.length === 0) {
        console.log(`  ${cat}: ${enrolees.length} students, NO document rows`);
        continue;
      }
      const oneTime = rows.map((r) => countFilled(r, ONE_TIME_SLOTS));
      const newForms = rows.map((r) => countFilled(r, NEW_ONLY_FORMS));
      const both = rows.map((r) => countFilled(r, BOTH_LISTS));
      const expiring = rows.map((r) => countFilled(r, EXPIRING_SLOTS));
      const avg = (a: number[]) =>
        (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2);
      const anyOf = (a: number[]) => a.filter((n) => n > 0).length;

      console.log(
        `  ${cat}: ${enrolees.length} students, ${rows.length} doc rows`
      );
      console.log(
        `      one-time (${ONE_TIME_SLOTS.length} slots):   avg ${avg(oneTime)} filled, ` +
          `${anyOf(oneTime)}/${rows.length} have ANY`
      );
      console.log(
        `      new-only forms (${NEW_ONLY_FORMS.length}): avg ${avg(newForms)} filled, ` +
          `${anyOf(newForms)}/${rows.length} have ANY`
      );
      console.log(
        `      both-list (${BOTH_LISTS.length} slots):    avg ${avg(both)} filled, ` +
          `${anyOf(both)}/${rows.length} have ANY`
      );
      console.log(
        `      expiring (${EXPIRING_SLOTS.length} slots):  avg ${avg(expiring)} filled, ` +
          `${anyOf(expiring)}/${rows.length} have ANY`
      );
    }

    // ── Can "previous copy expired" be computed? ───────────────────────────
    const withExpiry = docs.filter((d) =>
      EXPIRING_SLOTS.some((s) => filled(d[`${s}Expiry`]))
    ).length;
    console.log(
      `  rows carrying ANY expiry date: ${withExpiry}/${docs.length}` +
        (withExpiry === 0
          ? '  ⚠ "if the previous copy expired" cannot be computed'
          : '')
    );
    console.log('');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
