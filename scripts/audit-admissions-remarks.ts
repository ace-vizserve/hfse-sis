// scripts/audit-admissions-remarks.ts
//
// WHAT THE OFFICE WROTE IN PROSE, AND WHAT THE SIS HAS NOWHERE TO PUT.
//
// Mr Ace, 2026-09-16: "before SIS they are using remarks about the details."
// The remarks fields in `ay{YYYY}_enrolment_status` are the school's real
// record of everything the schema never had a column for — and the first one
// found the hard way was a withdrawal: Ashley Rae Cama's last day of
// attendance lived only in
//
//   applicationRemarks: "<p>Withdrawal approved 11 May 2026<br>Last Day: 26 April 2026</p>"
//
// which is why 23 withdrawn AY2026 students had no `withdrawal_date`. That one
// is now fixable (migration 163 gives the date a home). This script asks the
// wider question before anyone assumes it was the only one: across EVERY
// status, what is sitting in those remarks, and how much of it is a fact the
// SIS should be storing rather than prose nobody can query?
//
// STRICTLY READ-ONLY. SELECTs only, no --fix, safe against production.
//
// Run:
//   npx tsx --env-file=.env.local scripts/audit-admissions-remarks.ts
//   npx tsx --env-file=.env.local scripts/audit-admissions-remarks.ts --ay AY2026
//   npx tsx --env-file=.env.local scripts/audit-admissions-remarks.ts --full
//
// Flags:
//   --ay <code>  one academic year (default: every year with a status table)
//   --full       print every remark rather than a sample per status
import { createServiceClient } from '../lib/supabase/service';

/** Every `*Remarks` column the status table carries. */
const REMARK_COLUMNS = [
  'applicationRemarks',
  'documentRemarks',
  'assessmentRemarks',
  'contractRemarks',
  'feeRemarks',
  'classRemarks',
  'suppliesRemarks',
  'orientationRemarks',
  'registrationRemarks',
] as const;

/** Prose that looks like it is recording a DATE the schema has no column for. */
const DATE_HINT =
  /\b(\d{1,2}\s+\w+\s+20\d{2}|\w+\s+\d{1,2},?\s+20\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/;

/** Prose naming a thing the SIS models as a field rather than a sentence. */
const TOPIC_PATTERNS: { label: string; re: RegExp }[] = [
  { label: 'last day of attendance', re: /last\s*day/i },
  { label: 'withdrawal approved', re: /withdraw\w*\s*(approv|:)/i },
  {
    label: 'approved elsewhere (Teams/email)',
    re: /\b(teams?|teama|email)\b/i,
  },
  { label: 'refund / credit', re: /\brefund|credit\b/i },
  { label: 'deferred / postponed', re: /\bdefer|postpon/i },
  { label: 'transfer / moved class', re: /\btransfer|moved?\s+to\b/i },
  { label: 'sibling / family', re: /\bsibling|brother|sister\b/i },
  { label: 'relocation', re: /\brelocat|migrat|overseas\b/i },
  { label: 'scholarship / discount', re: /\bscholar|discount|bursar/i },
  { label: 'medical', re: /\bmedical|illness|surgery\b/i },
];

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, ' / ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseArgs(argv: string[]) {
  const i = argv.indexOf('--ay');
  return { ayCode: i >= 0 ? argv[i + 1] : null, full: argv.includes('--full') };
}

async function main() {
  const { ayCode, full } = parseArgs(process.argv.slice(2));
  const svc = createServiceClient();

  const { data: years, error: ayErr } = await svc
    .from('academic_years')
    .select('ay_code')
    .order('ay_code');
  if (ayErr) throw new Error(`academic_years: ${ayErr.message}`);

  const codes = (years ?? [])
    .map((y) => (y as { ay_code: string }).ay_code)
    .filter((c) => !ayCode || c === ayCode);

  for (const code of codes) {
    const table = `ay${code.slice(2)}_enrolment_status`;
    const { data, error } = await svc.from(table).select('*');
    if (error) {
      console.log(`\n${code}: ${error.message}`);
      continue;
    }
    const rows = (data ?? []) as Record<string, unknown>[];
    if (rows.length === 0) continue;

    console.log(`\n${'='.repeat(70)}`);
    console.log(`${code} — ${rows.length} rows in ${table}`);
    console.log('='.repeat(70));

    // Which remark columns actually exist and hold anything.
    const present = REMARK_COLUMNS.filter((c) => c in (rows[0] ?? {}));
    for (const col of present) {
      const filled = rows.filter(
        (r) => typeof r[col] === 'string' && stripHtml(r[col] as string) !== ''
      );
      if (filled.length === 0) continue;

      const withDate = filled.filter((r) =>
        DATE_HINT.test(stripHtml(r[col] as string))
      );

      console.log(
        `\n  ${col}: ${filled.length} filled of ${rows.length}` +
          `  ·  ${withDate.length} contain a date`
      );

      // What subjects come up, and how often.
      const hits = new Map<string, number>();
      for (const r of filled) {
        const text = stripHtml(r[col] as string);
        for (const { label, re } of TOPIC_PATTERNS) {
          if (re.test(text)) hits.set(label, (hits.get(label) ?? 0) + 1);
        }
      }
      for (const [label, n] of [...hits.entries()].sort(
        (a, b) => b[1] - a[1]
      )) {
        console.log(`      ${String(n).padStart(4)}  ${label}`);
      }

      // Show the prose itself — this is the whole point, a count tells you
      // nothing about whether a fact is hiding in there.
      const sample = full ? filled : filled.slice(0, 6);
      for (const r of sample) {
        const text = stripHtml(r[col] as string);
        const status = r.applicationStatus ?? '?';
        console.log(
          `      ${String(r.enroleeNumber)} [${status}] ${text.slice(0, 150)}`
        );
      }
      if (!full && filled.length > sample.length) {
        console.log(
          `      … ${filled.length - sample.length} more (use --full)`
        );
      }
    }

    // Cross-cut: remarks by application status, so "which stages rely on prose"
    // is answerable rather than inferred.
    console.log('\n  Rows carrying ANY remark, by application status:');
    const byStatus = new Map<string, { total: number; withRemark: number }>();
    for (const r of rows) {
      const s = String(r.applicationStatus ?? '(none)');
      const entry = byStatus.get(s) ?? { total: 0, withRemark: 0 };
      entry.total += 1;
      if (
        present.some(
          (c) => typeof r[c] === 'string' && stripHtml(r[c] as string) !== ''
        )
      ) {
        entry.withRemark += 1;
      }
      byStatus.set(s, entry);
    }
    for (const [status, e] of [...byStatus.entries()].sort(
      (a, b) => b[1].withRemark - a[1].withRemark
    )) {
      console.log(
        `      ${status.padEnd(24)} ${String(e.withRemark).padStart(4)} / ${e.total}`
      );
    }
  }

  console.log(
    '\nRemarks are prose, not fields. A fact in here cannot be filtered, counted,' +
      '\nor read by any screen — which is how 23 withdrawn students ended up with' +
      '\nno withdrawal date. Read the samples above and decide which of these' +
      '\ndeserve a column.\n'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
