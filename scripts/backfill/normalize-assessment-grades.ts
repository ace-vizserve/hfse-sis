// scripts/backfill/normalize-assessment-grades.ts
// Rewrites the entrance-assessment grades to one clean shape: `score/max`
// (e.g. "29/31"), no HTML.
//
// WHY. `assessmentGradeMath` / `assessmentGradeEnglish` were typed into
// Directus's WYSIWYG editor, so they hold "<p>93.55% (29/31)</p>",
// "<p>23/31 - 74.19%</p>" and similar. Staff record the score over the max
// score (the percentage is only score ÷ max), so that pair is what the SIS
// keeps from now on (Mr Ace, 2026-09-28).
//
// Rules per value (parsed with lib/admissions/assessment-grade.ts):
//   - has a score/max, and any written percentage agrees with it (within 0.6
//     points of rounding)             → "score/max"
//   - anything else                   → left exactly as it is and LISTED:
//       percentage only (no score to recover), percentage and score that
//       disagree (a typo only admissions can settle), text that is not a
//       grade ("did not complete", "na").
// A value already in the target shape is not rewritten.
//
// ⚠ RUNS AS THE SERVICE ROLE, so NO `audit_log` ROW IS WRITTEN. This header is
// the record.
//
// Run:  npx tsx --env-file=.env.local scripts/backfill/normalize-assessment-grades.ts [AY2027 ...]
//       ... --apply   to write
//       (no year given = AY2025, AY2026 and AY2027)
import { createServiceClient } from '../../lib/supabase/service';
import { parseAssessmentGrade } from '../../lib/admissions/assessment-grade';

const APPLY = process.argv.includes('--apply');
const YEARS = process.argv
  .filter((a) => /^AY\d{4}$/i.test(a))
  .map((a) => a.toUpperCase());
const AYS = YEARS.length ? YEARS : ['AY2025', 'AY2026', 'AY2027'];
const COLS = ['assessmentGradeMath', 'assessmentGradeEnglish'] as const;

const fmt = (n: number) => String(Number(n.toFixed(2)));

function normalize(raw: string): { to: string } | { skip: string } {
  const g = parseAssessmentGrade(raw);
  if (g.score == null || g.max == null) {
    if (g.percent != null)
      return { skip: 'percentage only — no score to recover' };
    return { skip: 'not a grade' };
  }
  const calc = (g.score / g.max) * 100;
  // The parser keeps a written percentage over the fraction; compare them.
  if (g.percent != null && Math.abs(g.percent - calc) > 0.6) {
    return {
      skip: `percentage ${g.percent}% disagrees with ${fmt(g.score)}/${fmt(g.max)} = ${calc.toFixed(2)}%`,
    };
  }
  return { to: `${fmt(g.score)}/${fmt(g.max)}` };
}

async function main() {
  const svc = createServiceClient();
  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${AYS.join(', ')}\n`);

  for (const ay of AYS) {
    const table = `ay${ay.slice(2)}_enrolment_status`;
    const { data, error } = await svc
      .from(table)
      .select('enroleeNumber, assessmentGradeMath, assessmentGradeEnglish');
    if (error) throw new Error(`${table}: ${error.message}`);

    const writes: Array<{
      enroleeNumber: string;
      patch: Record<string, string>;
    }> = [];
    const skipped: string[] = [];
    let unchanged = 0;
    let filled = 0;

    for (const r of (data ?? []) as Array<Record<string, string | null>>) {
      const patch: Record<string, string> = {};
      for (const col of COLS) {
        const raw = r[col];
        if (raw == null || String(raw).trim() === '') continue;
        filled++;
        const res = normalize(String(raw));
        if ('skip' in res) {
          skipped.push(
            `${r.enroleeNumber} ${col.replace('assessmentGrade', '')}: ${JSON.stringify(raw)} — ${res.skip}`
          );
        } else if (res.to === String(raw)) {
          unchanged++;
        } else {
          patch[col] = res.to;
        }
      }
      if (Object.keys(patch).length)
        writes.push({ enroleeNumber: r.enroleeNumber!, patch });
    }

    const changed = writes.reduce((n, w) => n + Object.keys(w.patch).length, 0);
    console.log(
      `${ay}: ${filled} grades · ${changed} to rewrite · ${unchanged} already clean · ${skipped.length} left as is`
    );
    for (const w of writes.slice(0, 5)) {
      const r = (data as Array<Record<string, string | null>>).find(
        (x) => x.enroleeNumber === w.enroleeNumber
      )!;
      for (const [col, to] of Object.entries(w.patch))
        console.log(
          `   ${w.enroleeNumber} ${col.replace('assessmentGrade', '')}: ${JSON.stringify(r[col])} → ${to}`
        );
    }
    if (writes.length > 5)
      console.log(`   … and ${writes.length - 5} more rows`);
    for (const s of skipped) console.log(`   ! ${s}`);
    console.log('');

    if (APPLY) {
      for (const w of writes) {
        const { error: upErr } = await svc
          .from(table)
          .update(w.patch)
          .eq('enroleeNumber', w.enroleeNumber);
        if (upErr)
          throw new Error(`${table} ${w.enroleeNumber}: ${upErr.message}`);
      }
      console.log(`${ay}: written.\n`);
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
