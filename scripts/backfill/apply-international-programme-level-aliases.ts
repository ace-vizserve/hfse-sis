// Saves the level aliases the parent portal's 2026-07-20 rename left unmapped.
//
// On 2026-07-20 the portal renamed "HFSE Global Education Programme" to
// "HFSE International Education Programme" (portal commit f374751). The same
// day migration 088 seeded `level_aliases` with the OLD names only, so every
// family that applied after the rename sent a level the SIS could not resolve
// and the child landed on /records/level-mismatches. A probe on 2026-09-24
// found 12 such names across AY2026/AY2027 — the new spelling plus the
// hyphen / no-dash variants families typed on older form versions.
//
// Where each one points, and why:
//   - Year 1 (equivalent to K2)            → YS. Mr Ace, 2026-09-24: K2 is the
//                                             year before Primary One.
//   - Year 2 (equivalent to Primary One)   → P1, as its own label says.
//   - Year 8 / 9 / 10                      → S1 / S2 / S3. The portal's own
//                                             progression (`GRADE_PROGRESSIONS`)
//                                             moves Primary Six → Year 8,
//                                             Secondary One → Year 9 and
//                                             Secondary Two → Year 10, and the
//                                             088 aliases for the old names say
//                                             the same.
//   - "Cambridge Secondary Two (Year 9)"   → S2. Cambridge is the Global track,
//                                             not a level (Mr Ace, 2026-09-24).
//   - "Year 8" (a bare `classLevel`)       → S1.
//
// Insert-only: a label that already has an alias to the SAME level is skipped,
// one aliased to a DIFFERENT level is refused, never re-pointed.
//
// ⚠ RUNS AS THE SERVICE ROLE, so NO `audit_log` ROW EXISTS for these aliases
// and `created_by` is null, like the 088 seed. This header is the record.
// The level-mismatches cache is not invalidated from here; its TTL clears it.
//
// Run:
//   npx tsx --env-file=.env.local scripts/backfill/apply-international-programme-level-aliases.ts          (dry run)
//   npx tsx --env-file=.env.local scripts/backfill/apply-international-programme-level-aliases.ts --apply
import { createServiceClient } from '../../lib/supabase/service';

const APPLY = process.argv.includes('--apply');

// Exact strings as stored — the en dash (–) and hyphen (-) forms are distinct.
const ALIASES: ReadonlyArray<[rawLabel: string, levelCode: string]> = [
  ['HFSE International Education Programme – Year 1 (equivalent to K2)', 'YS'],
  ['HFSE International Education Programme - Year 1', 'YS'],
  [
    'HFSE International Education Programme – Year 2 (equivalent to Primary One)',
    'P1',
  ],
  ['HFSE International Education Programme - Year 2', 'P1'],
  ['HFSE International Education Programme – Year 8', 'S1'],
  ['HFSE International Education Programme - Year 8', 'S1'],
  ['Year 8', 'S1'],
  ['HFSE International Education Programme – Year 9', 'S2'],
  ['HFSE International Education Programme - Year 9', 'S2'],
  ['HFSE International Education Programme Year 9', 'S2'],
  ['Cambridge Secondary Two (Year 9)', 'S2'],
  ['HFSE International Education Programme – Year 10', 'S3'],
];

const sb = createServiceClient();

async function main() {
  const { data: levels, error: levelsErr } = await sb
    .from('levels')
    .select('id, code');
  if (levelsErr) throw levelsErr;
  const idByCode = new Map(
    levels!.map((l) => [l.code as string, l.id as string])
  );
  const codeById = new Map(
    levels!.map((l) => [l.id as string, l.code as string])
  );

  const { data: existing, error: aliasErr } = await sb
    .from('level_aliases')
    .select('raw_label, level_id');
  if (aliasErr) throw aliasErr;
  const existingByLabel = new Map(
    existing!.map((a) => [a.raw_label as string, a.level_id as string])
  );

  const writes: Array<{ raw_label: string; level_id: string }> = [];
  let refused = 0;
  for (const [rawLabel, code] of ALIASES) {
    const levelId = idByCode.get(code);
    if (!levelId) throw new Error(`No level with code ${code}`);
    const prior = existingByLabel.get(rawLabel);
    if (prior === levelId) {
      console.log(`  skip     "${rawLabel}" already → ${code}`);
    } else if (prior) {
      refused += 1;
      console.log(
        `  REFUSED  "${rawLabel}" is already → ${codeById.get(prior)}, not ${code}`
      );
    } else {
      writes.push({ raw_label: rawLabel, level_id: levelId });
      console.log(`  add      "${rawLabel}" → ${code}`);
    }
  }

  if (refused > 0) {
    console.log(`\n${refused} label(s) conflict — nothing written.`);
    process.exit(1);
  }
  if (!APPLY) {
    console.log(
      `\nDRY RUN — re-run with --apply to write ${writes.length} row(s).`
    );
    return;
  }
  if (writes.length === 0) {
    console.log('\nNothing to write.');
    return;
  }
  const { error } = await sb.from('level_aliases').insert(writes);
  if (error) throw error;
  console.log(`\nWrote ${writes.length} alias row(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
