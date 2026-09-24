// Seeds `admission_options` (migration 174) for AY2026 and AY2027 with the
// parent portal's CURRENT rules, transcribed verbatim.
//
// Sources, in the portal repo (`../app-online-admission`), as of 2026-09-24:
//   - LEVELS: `classLevels` in `src/data.ts`. NOT `vizSchoolClassLevels` —
//     the VizSchool forms are out of scope and keep their own lists.
//   - LEVEL → CLASS TYPE: the dropdown in
//     `src/pages/private/enrol-student/new/enrollment-information.tsx`.
//     The other three copies — `old/old-enrollment-information.tsx`,
//     `open-house/application-form/open-house-enrollment-information.tsx` and
//     `public/complete-enrolment.tsx`'s `classTypeOptionsForLevel` — were
//     checked on 2026-09-24 and AGREE with it, constants and dropdowns alike.
//   - SCHEDULE: `scheduleOptionsForLevel` in `src/lib/schedule-rules.ts`.
//
// A row is written for EVERY schedule a level can structurally have —
// Morning + Afternoon at a MORNING_AFTERNOON level, Whole Day at a WHOLE_DAY
// level — and `is_open` is false where today's rules withhold it: a Global
// type is Morning only (its Afternoon row is closed), and Standard at the
// AFTERNOON_ONLY levels (Primary Three, Primary Six) is Afternoon only (its
// Morning row is closed). Closed options therefore show up as switches staff
// can flip, instead of being absent.
//
// Track: "Global" in the class type label means Global, so the Cambridge types
// are Global (Mr Ace, 2026-09-24). ⚠ "Enrichment Class" — the only class type
// at the two YoungStarter levels — is recorded as STANDARD. It carries no
// "global" and there are only two tracks; no section today has a track that
// Enrichment could be matched against, so this only affects the future
// "Matches their application" hint. Revisit if Youngstarters gets a Global
// stream.
//
// level_id: each label resolves through `resolveLevelIdFromCatalog` against
// live `levels` + `level_aliases`. A label that does not resolve aborts the
// run — nothing is written with a guessed level.
//
// sort_order: the portal's own level order (`classLevels`), then class type
// order, then Morning / Afternoon / Whole Day — numbered 10, 20, 30... per AY
// so an inserted row fits between two. It orders the parent's dropdowns, so it
// must reproduce today's order exactly.
//
// Insert-only and idempotent: a row that already exists by
// (academic_year_id, level_label, class_type_label, schedule) is skipped, and
// its `is_open` is NEVER overwritten — once staff have flipped a switch, a
// re-run must not flip it back.
//
// ⚠ RUNS AS THE SERVICE ROLE, so NO `audit_log` ROW EXISTS for these rows.
// This header is the record.
//
// Run:
//   npx tsx --env-file=.env.local scripts/backfill/seed-admission-options.ts          (dry run)
//   npx tsx --env-file=.env.local scripts/backfill/seed-admission-options.ts --apply
import { createServiceClient } from '../../lib/supabase/service';
import {
  resolveLevelIdFromCatalog,
  type LevelAliasRow,
  type LevelRow,
} from '../../lib/sis/levels';
import {
  trackForClassType,
  type AdmissionSchedule,
  type AdmissionTrack,
} from '../../lib/admissions/options';

export const SEED_AY_CODES = ['AY2026', 'AY2027'] as const;

// ── Portal transcription (verbatim strings — the en dash is significant) ────

// src/data.ts `classLevels`, in its order.
export const PORTAL_CLASS_LEVELS = [
  'YoungStarter Little Star',
  'YoungStarter Junior Star',
  'Primary One',
  'Primary Two',
  'Primary Three',
  'Primary Four',
  'Primary Five',
  'Primary Six',
  'Secondary One',
  'Secondary Two',
  'Secondary Three',
  'Secondary Four',
  'HFSE International Education Programme – Year 1 (equivalent to K2)',
  'HFSE International Education Programme – Year 2 (equivalent to Primary One)',
  'HFSE International Education Programme – Year 8',
  'HFSE International Education Programme – Year 9',
  'HFSE International Education Programme – Year 10',
] as const;

// enrollment-information.tsx constants.
const ENRICHMENT_CLASS_LEVELS = [
  'YoungStarter Little Star',
  'YoungStarter Junior Star',
];
const CAMBRIDGE_YEAR_1_LEVELS = [
  'HFSE International Education Programme – Year 1 (equivalent to K2)',
];
const CAMBRIDGE_YEAR_2_LEVELS = [
  'HFSE International Education Programme – Year 2 (equivalent to Primary One)',
];
const CAMBRIDGE_SECONDARY_LEVELS = [
  'HFSE International Education Programme – Year 8',
  'HFSE International Education Programme – Year 9',
  'HFSE International Education Programme – Year 10',
];
const CAMBRIDGE_YEAR_2_CLASS_TYPES = [
  'Global Class-Cambridge (ENGLISH+FILIPINO)',
  'Global Class-Cambridge (ENGLISH+MANDARIN)',
  'Global Class-Cambridge (ENGLISH+FRENCH)',
];
const GLOBAL_LANGUAGE_LEVELS = [
  'Primary Two',
  'Primary Three',
  'Primary Four',
  'Primary Five',
  'Primary Six',
];
const STANDARD_CLASS_LEVELS = [
  'Primary One',
  'Primary Two',
  'Primary Three',
  'Primary Four',
  'Primary Five',
  'Primary Six',
  'Secondary One',
  'Secondary Two',
  'Secondary Three',
  'Secondary Four',
];

// The dropdown's branch order (== complete-enrolment.tsx classTypeOptionsForLevel).
export function portalClassTypesForLevel(level: string): string[] {
  if (ENRICHMENT_CLASS_LEVELS.includes(level)) return ['Enrichment Class'];
  if (CAMBRIDGE_YEAR_2_LEVELS.includes(level))
    return [...CAMBRIDGE_YEAR_2_CLASS_TYPES];
  if (CAMBRIDGE_YEAR_1_LEVELS.includes(level))
    return ['Global Class-Cambridge'];
  if (CAMBRIDGE_SECONDARY_LEVELS.includes(level))
    return ['Global Class (CAMBRIDGE)'];
  if (STANDARD_CLASS_LEVELS.includes(level)) {
    const types = ['Standard Class (ENGLISH + FILIPINO)'];
    if (GLOBAL_LANGUAGE_LEVELS.includes(level)) {
      types.push(
        'GLOBAL (ENGLISH + MANDARIN)',
        'GLOBAL (ENGLISH + FRENCH)',
        'GLOBAL (ENGLISH + TAMIL)'
      );
    }
    return types;
  }
  return [];
}

// src/lib/schedule-rules.ts.
const MORNING_AFTERNOON_CLASS_LEVEL = [
  'YoungStarter Little Star',
  'YoungStarter Junior Star',
  'Primary One',
  'Primary Two',
  'Primary Three',
  'Primary Four',
  'Primary Five',
  'Primary Six',
  'HFSE International Education Programme – Year 1 (equivalent to K2)',
  'HFSE International Education Programme – Year 2 (equivalent to Primary One)',
];
const WHOLE_DAY_CLASS_LEVEL = [
  'Secondary One',
  'Secondary Two',
  'Secondary Three',
  'Secondary Four',
  'HFSE International Education Programme – Year 8',
  'HFSE International Education Programme – Year 9',
  'HFSE International Education Programme – Year 10',
];
const MORNING_ONLY_CLASS_TYPE_MARKER = 'global';
const AFTERNOON_ONLY_CLASS_LEVEL = ['Primary Three', 'Primary Six'];
const AFTERNOON_ONLY_CLASS_TYPE = 'Standard Class (ENGLISH + FILIPINO)';

/** Every schedule the level can have at all, before any restriction. */
function structuralSchedules(level: string): AdmissionSchedule[] {
  if (WHOLE_DAY_CLASS_LEVEL.includes(level)) return ['whole_day'];
  if (MORNING_AFTERNOON_CLASS_LEVEL.includes(level))
    return ['morning', 'afternoon'];
  return [];
}

/** `scheduleOptionsForLevel`, verbatim, in the SIS vocabulary. */
function openSchedules(level: string, classType: string): AdmissionSchedule[] {
  if (WHOLE_DAY_CLASS_LEVEL.includes(level)) return ['whole_day'];
  if (!MORNING_AFTERNOON_CLASS_LEVEL.includes(level)) return [];
  if (classType.toLowerCase().includes(MORNING_ONLY_CLASS_TYPE_MARKER))
    return ['morning'];
  if (
    AFTERNOON_ONLY_CLASS_LEVEL.includes(level) &&
    classType === AFTERNOON_ONLY_CLASS_TYPE
  ) {
    return ['afternoon'];
  }
  return ['morning', 'afternoon'];
}

// ── Row builder (shared with scripts/verify-admission-options-parity.ts) ────

export type SeedRow = {
  academic_year_id: string;
  level_label: string;
  level_id: string;
  class_type_label: string;
  track: AdmissionTrack;
  schedule: AdmissionSchedule;
  is_open: boolean;
  sort_order: number;
};

/**
 * Builds one AY's rows from the portal transcription. Pure: the caller
 * supplies the live levels + aliases. Throws, naming every label, if any
 * portal level does not resolve to an SIS level.
 */
export function buildAdmissionOptionRows(
  academicYearId: string,
  levels: LevelRow[],
  aliases: LevelAliasRow[]
): SeedRow[] {
  const unresolved: string[] = [];
  const resolved = PORTAL_CLASS_LEVELS.map((label, portalIndex) => {
    const levelId = resolveLevelIdFromCatalog(label, levels, aliases);
    if (!levelId) unresolved.push(label);
    return { label, portalIndex, levelId: levelId ?? '' };
  });
  if (unresolved.length > 0) {
    throw new Error(
      `Portal level label(s) resolve to no SIS level:\n  ${unresolved.join('\n  ')}`
    );
  }

  // The portal's own list order, NOT SIS level order: `sort_order` is what the
  // parent's level dropdown is ordered by, and switching the source must not
  // move anything a parent sees. (The first version sorted by SIS level, which
  // pulled the five International Education Programme levels up beside the
  // level each counts as.) The admin page groups by SIS level regardless.
  resolved.sort((a, b) => a.portalIndex - b.portalIndex);

  const rows: SeedRow[] = [];
  for (const { label, levelId } of resolved) {
    for (const classType of portalClassTypesForLevel(label)) {
      const open = openSchedules(label, classType);
      for (const schedule of structuralSchedules(label)) {
        rows.push({
          academic_year_id: academicYearId,
          level_label: label,
          level_id: levelId,
          class_type_label: classType,
          track: trackForClassType(classType),
          schedule,
          is_open: open.includes(schedule),
          sort_order: (rows.length + 1) * 10,
        });
      }
    }
  }
  return rows;
}

/** Live levels + aliases, shaped for `resolveLevelIdFromCatalog`. */
export async function loadLevelCatalog(
  sb: ReturnType<typeof createServiceClient>
): Promise<{ levels: LevelRow[]; aliases: LevelAliasRow[] }> {
  const [{ data: lv, error: lvErr }, { data: al, error: alErr }] =
    await Promise.all([
      sb
        .from('levels')
        .select(
          'id, code, label, level_type, sort_order, next_level_id, is_core'
        )
        .order('sort_order'),
      sb.from('level_aliases').select('raw_label, level_id'),
    ]);
  if (lvErr) throw lvErr;
  if (alErr) throw alErr;
  const levels: LevelRow[] = (lv ?? []).map((r) => ({
    id: r.id as string,
    code: r.code as string,
    label: r.label as string,
    levelType: r.level_type as 'primary' | 'secondary',
    sortOrder: r.sort_order as number,
    nextLevelId: (r.next_level_id as string | null) ?? null,
    isCore: r.is_core as boolean,
  }));
  return { levels, aliases: (al ?? []) as LevelAliasRow[] };
}

/** AY code → id, failing loudly on a missing year. */
export async function loadAyIds(
  sb: ReturnType<typeof createServiceClient>,
  codes: readonly string[]
): Promise<Map<string, string>> {
  const { data, error } = await sb
    .from('academic_years')
    .select('id, ay_code')
    .in('ay_code', codes as string[]);
  if (error) throw error;
  const byCode = new Map(
    (data ?? []).map((r) => [r.ay_code as string, r.id as string])
  );
  const missing = codes.filter((c) => !byCode.has(c));
  if (missing.length)
    throw new Error(`No academic_years row for ${missing.join(', ')}`);
  return byCode;
}

// ── Main (only when run directly, not when imported by the parity check) ────

async function main() {
  const APPLY = process.argv.includes('--apply');
  const sb = createServiceClient();
  const { levels, aliases } = await loadLevelCatalog(sb);
  const codeById = new Map(levels.map((l) => [l.id, l.code]));
  const ayIds = await loadAyIds(sb, SEED_AY_CODES);

  // Existing rows by unique key. A missing table (migration 174 not applied)
  // is tolerated on a dry run only: treated as "no rows yet".
  const { data: existing, error: exErr } = await sb
    .from('admission_options')
    .select('academic_year_id, level_label, class_type_label, schedule')
    .in('academic_year_id', [...ayIds.values()]);
  let existingKeys = new Set<string>();
  if (exErr) {
    if (APPLY) throw exErr;
    console.log(
      `⚠ Could not read admission_options (${exErr.code ?? ''} ${exErr.message}) — ` +
        'migration 174 is probably not applied. Treating existing rows as none.\n'
    );
  } else {
    existingKeys = new Set(
      (existing ?? []).map(
        (r) =>
          `${r.academic_year_id}|${r.level_label}|${r.class_type_label}|${r.schedule}`
      )
    );
  }

  const writes: SeedRow[] = [];
  for (const ayCode of SEED_AY_CODES) {
    const ayId = ayIds.get(ayCode)!;
    const rows = buildAdmissionOptionRows(ayId, levels, aliases);
    let skipped = 0;
    console.log(`\n${ayCode} — ${rows.length} row(s)`);
    for (const r of rows) {
      const key = `${r.academic_year_id}|${r.level_label}|${r.class_type_label}|${r.schedule}`;
      const tag = existingKeys.has(key) ? 'skip' : 'add ';
      if (existingKeys.has(key)) skipped += 1;
      else writes.push(r);
      console.log(
        `  ${tag} ${String(r.sort_order).padStart(4)}  ${codeById.get(r.level_id)?.padEnd(3)} ` +
          `${r.level_label} | ${r.class_type_label} | ${r.track} | ${r.schedule} | ` +
          `${r.is_open ? 'open' : 'CLOSED'}`
      );
    }
    console.log(
      `  ${rows.length - skipped} to add, ${skipped} already present`
    );
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
  // ignoreDuplicates = ON CONFLICT DO NOTHING: a row that appeared since the
  // read above is left alone rather than failing the batch or being overwritten.
  const { error } = await sb.from('admission_options').upsert(writes, {
    onConflict: 'academic_year_id,level_label,class_type_label,schedule',
    ignoreDuplicates: true,
  });
  if (error) throw error;
  console.log(`\nWrote ${writes.length} row(s).`);
}

if (/seed-admission-options\.ts$/.test(process.argv[1] ?? '')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
