// Parity check: do the `admission_options` rows the seed would write give
// parents EXACTLY the dropdowns the portal gives them today?
//
// Read-only. Builds AY2027's rows with the seed script's own row builder
// (so it works before migration 174 is applied), derives the three dropdowns
// with `deriveOptions` (lib/admissions/options.ts — the same function the
// endpoint will use), and compares them with EXPECTED below.
//
// EXPECTED is a flat, hand-written literal of what the portal's forms offer,
// read off `app-online-admission` on 2026-09-24 — `classLevels` (src/data.ts),
// the class-type dropdown in the four enrolment forms, and
// `scheduleOptionsForLevel` (src/lib/schedule-rules.ts). It is deliberately
// NOT computed from rules: the seed transcribes the rules, this transcribes
// the outcome, and the check is that the two transcriptions agree. Nothing is
// imported from the portal repo (different repo, different toolchain).
//
// Compared: the set of levels, each level's class types IN ORDER, and each
// type's schedules IN ORDER. Level order is not compared — the table orders
// by SIS level, the portal by its own list.
//
// Run: npx tsx --env-file=.env.local scripts/verify-admission-options-parity.ts
import { createServiceClient } from '../lib/supabase/service';
import { deriveOptions, type PortalSchedule } from '../lib/admissions/options';
import {
  buildAdmissionOptionRows,
  loadAyIds,
  loadLevelCatalog,
} from './backfill/seed-admission-options';

const AY = 'AY2027';

const M: PortalSchedule[] = ['Morning'];
const A: PortalSchedule[] = ['Afternoon'];
const MA: PortalSchedule[] = ['Morning', 'Afternoon'];
const WD: PortalSchedule[] = ['Whole Day'];

const STD = 'Standard Class (ENGLISH + FILIPINO)';
const MAN = 'GLOBAL (ENGLISH + MANDARIN)';
const FRE = 'GLOBAL (ENGLISH + FRENCH)';
const TAM = 'GLOBAL (ENGLISH + TAMIL)';

// level → [class type, schedules][] — what a parent can pick today.
const EXPECTED: Record<string, Array<[string, PortalSchedule[]]>> = {
  'YoungStarter Little Star': [['Enrichment Class', MA]],
  'YoungStarter Junior Star': [['Enrichment Class', MA]],
  'Primary One': [[STD, MA]],
  'Primary Two': [
    [STD, MA],
    [MAN, M],
    [FRE, M],
    [TAM, M],
  ],
  'Primary Three': [
    [STD, A],
    [MAN, M],
    [FRE, M],
    [TAM, M],
  ],
  'Primary Four': [
    [STD, MA],
    [MAN, M],
    [FRE, M],
    [TAM, M],
  ],
  'Primary Five': [
    [STD, MA],
    [MAN, M],
    [FRE, M],
    [TAM, M],
  ],
  'Primary Six': [
    [STD, A],
    [MAN, M],
    [FRE, M],
    [TAM, M],
  ],
  'Secondary One': [[STD, WD]],
  'Secondary Two': [[STD, WD]],
  'Secondary Three': [[STD, WD]],
  'Secondary Four': [[STD, WD]],
  'HFSE International Education Programme – Year 1 (equivalent to K2)': [
    ['Global Class-Cambridge', M],
  ],
  'HFSE International Education Programme – Year 2 (equivalent to Primary One)':
    [
      ['Global Class-Cambridge (ENGLISH+FILIPINO)', M],
      ['Global Class-Cambridge (ENGLISH+MANDARIN)', M],
      ['Global Class-Cambridge (ENGLISH+FRENCH)', M],
    ],
  'HFSE International Education Programme – Year 8': [
    ['Global Class (CAMBRIDGE)', WD],
  ],
  'HFSE International Education Programme – Year 9': [
    ['Global Class (CAMBRIDGE)', WD],
  ],
  'HFSE International Education Programme – Year 10': [
    ['Global Class (CAMBRIDGE)', WD],
  ],
};

async function main() {
  const sb = createServiceClient();
  const { levels, aliases } = await loadLevelCatalog(sb);
  const ayIds = await loadAyIds(sb, [AY]);
  const rows = buildAdmissionOptionRows(ayIds.get(AY)!, levels, aliases);
  const derived = deriveOptions(rows);

  const diffs: string[] = [];
  const derivedByLevel = new Map(derived.map((d) => [d.levelLabel, d]));

  for (const level of Object.keys(EXPECTED)) {
    if (!derivedByLevel.has(level)) diffs.push(`missing level: ${level}`);
  }
  for (const d of derived) {
    const exp = EXPECTED[d.levelLabel];
    if (!exp) {
      diffs.push(`unexpected level: ${d.levelLabel}`);
      continue;
    }
    const gotTypes = d.classTypes.map((t) => t.classTypeLabel);
    const expTypes = exp.map(([t]) => t);
    if (gotTypes.join(' || ') !== expTypes.join(' || ')) {
      diffs.push(
        `${d.levelLabel}: class types\n    expected ${expTypes.join(', ')}\n    got      ${gotTypes.join(', ')}`
      );
      continue;
    }
    for (const [type, expSched] of exp) {
      const got = d.classTypes.find(
        (t) => t.classTypeLabel === type
      )!.schedules;
      if (got.join(',') !== expSched.join(',')) {
        diffs.push(
          `${d.levelLabel} × ${type}: expected ${expSched.join('/')}, got ${got.join('/')}`
        );
      }
    }
  }

  const combos = derived.reduce((n, d) => n + d.classTypes.length, 0);
  console.log(
    `${AY}: ${rows.length} row(s) (${rows.filter((r) => r.is_open).length} open) → ` +
      `${derived.length} level(s), ${combos} level × type combination(s)`
  );
  if (diffs.length) {
    console.log(`\n${diffs.length} difference(s):`);
    for (const d of diffs) console.log(`  - ${d}`);
    process.exit(1);
  }
  console.log('0 differences — the table reproduces the portal.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
