// scripts/probe-nationality-values.ts
//
// Measures the data behind two proposed Insights sections BEFORE either is
// built. Answers one question per section, and nothing else.
//
// STRICTLY READ-ONLY. Every statement below is a SELECT; nothing is written,
// so it is safe to point at production. It reports; it does not decide, and
// it never repairs a value it disapproves of — `nationality` is data the
// parent supplied on their application, not the school's to correct.
//
// WHY THIS EXISTS AT ALL. `nationality` is `text null` with no CHECK and no
// FK. The strict country-name enum in lib/schemas/sis.ts applies only to new
// SIS writes, and the field is PROFILE-gated, so untouched legacy rows keep
// whatever the parent portal stored years ago. A distribution chart drawn
// over that without looking first will silently split "Filipino" /
// "Philippines" / "filipino" into three bars and report a wrong answer with
// total confidence. Run this, read it, THEN decide what normalising the
// chart needs.
//
// RUN IT AGAINST PRODUCTION, NOT THE SEEDER. AY9999 stamps these columns, so
// seeded data looks clean when production is not. That failure mode has bitten
// this project before.
//
// Run:
//   npx tsx --env-file=.env.local scripts/probe-nationality-values.ts
//
// Exit code is 0 whenever the probe itself ran. A "bad" finding is a finding,
// not a failure — this script has no opinion about what the numbers should be.
import { fetchAllPages } from '../lib/supabase/paginate';
import { prefixFor } from '../lib/admissions/_shared';
import { COUNTRY_NAME_SET } from '../lib/data/countries';
import { createServiceClient } from '../lib/supabase/service';

// ── formatting helpers ──────────────────────────────────────────────────────
const h1 = (s: string) =>
  console.log(`\n\n══ ${s} ${'═'.repeat(Math.max(0, 68 - s.length))}`);
const h2 = (s: string) =>
  console.log(`\n── ${s} ${'─'.repeat(Math.max(0, 68 - s.length))}`);
const pct = (n: number, d: number) =>
  d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`;

/** Digits only, with a Singapore country code stripped. Parent mobiles are
 *  bigint and referrerMobile is text, so both sides must be flattened to the
 *  same shape before any comparison means anything. */
function normaliseMobile(v: string | number | null): string | null {
  if (v === null || v === undefined) return null;
  let d = String(v).replace(/\D/g, '');
  if (d.startsWith('65') && d.length > 8) d = d.slice(2);
  d = d.replace(/^0+/, '');
  return d.length >= 8 ? d : null;
}

type AppRow = {
  enroleeNumber: string | null;
  nationality: string | null;
  referrerName: string | null;
  referrerMobile: string | null;
  marketingReferrerName: string | null;
  howDidYouKnowAboutHFSEIS: string | null;
  discount1: string | null;
  discount2: string | null;
  discount3: string | null;
  fatherMobile: number | null;
  motherMobile: number | null;
  guardianMobile: number | null;
};

const APP_COLUMNS = [
  'enroleeNumber',
  'nationality',
  'referrerName',
  'referrerMobile',
  'marketingReferrerName',
  'howDidYouKnowAboutHFSEIS',
  'discount1',
  'discount2',
  'discount3',
  'fatherMobile',
  'motherMobile',
  'guardianMobile',
].join(', ');

const filled = (v: string | null) => Boolean((v ?? '').trim());

async function main() {
  const service = createServiceClient();

  // ── Which AYs actually exist, and which have an admissions table? ─────────
  //
  // This is not trivia. The Records year-over-year comparison needs an
  // ay{YYYY}_enrolment_applications table for the year being compared
  // against. ay2025_ never appears as a literal anywhere in the repo, and
  // the AY2025 backfill loaded SIS-side data only — so the compare may have
  // nothing to compare against and must be suppressed rather than drawn as
  // a cliff.
  h1('AY COVERAGE');

  const { data: ayRows, error: ayErr } = await service
    .from('academic_years')
    .select('ay_code, is_current')
    .order('ay_code');

  if (ayErr) {
    console.error(`Could not read academic_years: ${ayErr.message}`);
    process.exit(1);
  }

  const ayCodes = (ayRows ?? []).map((r) => r.ay_code as string);
  console.log(
    `academic_years rows: ${ayCodes.length}  [${ayCodes.join(', ')}]`
  );

  const appsByAy = new Map<string, AppRow[]>();

  for (const ay of ayCodes) {
    const isCurrent = (ayRows ?? []).find((r) => r.ay_code === ay)?.is_current;
    const prefix = prefixFor(ay);
    try {
      // The AY table name is dynamic, so the generated types can't resolve it.
      // Same cast the shipped loaders use (see loadFunnelRowsUncached).
      const rows = await fetchAllPages<AppRow>(
        (from, to) =>
          service
            .from(`${prefix}_enrolment_applications`)
            .select(APP_COLUMNS)
            .range(from, to) as unknown as PromiseLike<{
            data: AppRow[] | null;
            error: { message: string } | null;
          }>
      );
      appsByAy.set(ay, rows);
      console.log(
        `  ${ay}${isCurrent ? ' (current)' : ''} → ${prefix}_enrolment_applications: ${rows.length} rows`
      );
    } catch (err) {
      console.log(
        `  ${ay}${isCurrent ? ' (current)' : ''} → ${prefix}_enrolment_applications: NOT READABLE` +
          `\n      ${err instanceof Error ? err.message : String(err)}` +
          `\n      ⚠ no admissions table for this AY — it cannot be a comparison year.`
      );
    }
  }

  // Enrolled headcount per AY, for the Records-side denominator. Phase 2's
  // nationality total must equal this, or the Unspecified bucket is dropping
  // students rather than surfacing them.
  h2('Enrolled headcount (section_students, non-withdrawn)');
  for (const ay of ayCodes) {
    const { data: ayRow } = await service
      .from('academic_years')
      .select('id')
      .eq('ay_code', ay)
      .maybeSingle();
    const ayId = (ayRow as { id: string } | null)?.id;
    if (!ayId) continue;
    const rows = await fetchAllPages<{ enrolee_number: string | null }>(
      (from, to) =>
        service
          .from('section_students')
          .select('enrolee_number, section:sections!inner(academic_year_id)')
          .eq('section.academic_year_id', ayId)
          .neq('enrollment_status', 'withdrawn')
          .range(from, to)
    );
    const linked = rows.filter((r) => Boolean(r.enrolee_number?.trim())).length;
    console.log(
      `  ${ay}: ${rows.length} enrolled · ${linked} carry an enrolee_number ` +
        `(${rows.length - linked} would bucket to Unspecified on the Records chart)`
    );
  }

  // ── PHASE 0 · nationality hygiene ────────────────────────────────────────
  h1('PHASE 0 · NATIONALITY');

  for (const [ay, rows] of appsByAy) {
    if (rows.length === 0) continue;
    h2(`${ay} — ${rows.length} applications`);

    const raw = new Map<string, number>();
    let blank = 0;
    for (const r of rows) {
      const v = r.nationality;
      if (!filled(v)) {
        blank += 1;
        continue;
      }
      raw.set(v as string, (raw.get(v as string) ?? 0) + 1);
    }

    const distinct = [...raw.entries()].sort((a, b) => b[1] - a[1]);
    const offList = distinct.filter(([v]) => !COUNTRY_NAME_SET.has(v.trim()));

    console.log(
      `  blank/null           : ${blank} (${pct(blank, rows.length)})`
    );
    console.log(`  distinct values      : ${distinct.length}`);
    console.log(
      `  off the country list : ${offList.length} distinct ` +
        `(${offList.reduce((s, [, c]) => s + c, 0)} rows)`
    );

    // Case/whitespace collisions — the thing that silently splits a bar.
    const byLoose = new Map<string, string[]>();
    for (const [v] of distinct) {
      const k = v.trim().toLowerCase();
      byLoose.set(k, [...(byLoose.get(k) ?? []), v]);
    }
    const collisions = [...byLoose.entries()].filter(([, vs]) => vs.length > 1);
    console.log(`  case/space collisions: ${collisions.length}`);
    for (const [k, vs] of collisions) {
      console.log(
        `      "${k}" ← ${vs.map((v) => JSON.stringify(v)).join(' , ')}`
      );
    }

    console.log(`\n  Every distinct value, most common first:`);
    for (const [v, c] of distinct) {
      const flag = COUNTRY_NAME_SET.has(v.trim()) ? '   ' : ' ! ';
      console.log(`   ${flag}${String(c).padStart(5)}  ${JSON.stringify(v)}`);
    }
    if (offList.length > 0) {
      console.log(
        `\n  ! = not in COUNTRY_NAME_SET. Decide whether these are demonyms\n` +
          `      ("Filipino" for "Philippines"), typos, or legitimately absent\n` +
          `      from the list. Map them for GROUPING only; never write back.`
      );
    }
  }

  // ── PHASE 0b · referral attribution ──────────────────────────────────────
  //
  // Training action item #13 claims the referrer's category is "read from the
  // existing record, not inferred. Low effort." But referrerName and
  // referrerMobile are plain text with no FK to anything, so finding "the
  // existing record" IS an inference. The match rate below is what decides
  // whether that item is buildable at all.
  h1('PHASE 0b · REFERRAL ATTRIBUTION (measure only)');

  // Every parent mobile across every AY, so a referrer can be matched against
  // families who applied in an earlier year, not just the current one.
  const parentMobiles = new Map<string, string>(); // normalised → "AY / enroleeNumber"
  for (const [ay, rows] of appsByAy) {
    for (const r of rows) {
      for (const m of [r.fatherMobile, r.motherMobile, r.guardianMobile]) {
        const n = normaliseMobile(m);
        if (n && !parentMobiles.has(n)) {
          parentMobiles.set(n, `${ay} / ${r.enroleeNumber ?? '?'}`);
        }
      }
    }
  }
  console.log(
    `Distinct parent mobiles on record, all AYs: ${parentMobiles.size}`
  );

  for (const [ay, rows] of appsByAy) {
    if (rows.length === 0) continue;
    h2(`${ay} — ${rows.length} applications`);

    const count = (f: (r: AppRow) => string | null) =>
      rows.filter((r) => filled(f(r))).length;

    const fills: [string, number][] = [
      ['howDidYouKnowAboutHFSEIS', count((r) => r.howDidYouKnowAboutHFSEIS)],
      ['marketingReferrerName', count((r) => r.marketingReferrerName)],
      ['referrerName', count((r) => r.referrerName)],
      ['referrerMobile', count((r) => r.referrerMobile)],
      ['discount1', count((r) => r.discount1)],
      ['discount2', count((r) => r.discount2)],
      ['discount3', count((r) => r.discount3)],
    ];
    console.log('  fill rates:');
    for (const [name, n] of fills) {
      console.log(
        `    ${name.padEnd(26)} ${String(n).padStart(5)} / ${rows.length}  ${pct(n, rows.length)}`
      );
    }

    // The number the whole feature hinges on.
    const withMobile = rows.filter((r) => filled(r.referrerMobile));
    let matched = 0;
    let unparseable = 0;
    for (const r of withMobile) {
      const n = normaliseMobile(r.referrerMobile);
      if (!n) {
        unparseable += 1;
        continue;
      }
      if (parentMobiles.has(n)) matched += 1;
    }
    console.log(
      `\n  ▶ referrerMobile present   : ${withMobile.length}` +
        `\n  ▶ unparseable as a number  : ${unparseable}` +
        `\n  ▶ MATCHED to a known family: ${matched}  (${pct(matched, withMobile.length)} of those present)`
    );
    console.log(
      `      ^ this is the number that decides whether action item #13 is buildable.`
    );
  }

  h1('DONE — read the numbers before writing any chart code');
  console.log(
    'Nothing was written. Two decisions come out of this run:\n' +
      '  1. Does computeNationalityMix need normalising beyond trim(), and what map?\n' +
      '  2. Is the referrer match rate high enough for #13 to exist at all?\n'
  );
}

main().catch((err) => {
  console.error('\nProbe failed to run:', err);
  process.exit(1);
});
