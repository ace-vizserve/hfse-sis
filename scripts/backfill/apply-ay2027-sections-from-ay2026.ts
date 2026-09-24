// scripts/backfill/apply-ay2027-sections-from-ay2026.ts
// Gives AY2027 the same sections AY2026 has, so admissions never places a
// child into a section the SIS does not have. The sync skips a child whose
// section is missing — silently — which is how three AY2027 children went
// unplaced (see apply-ay2027-first-placements.ts).
//
// Copies name, level, class_type (Global/Standard) and schedule. Skips any
// section AY2027 already has, and AY2026's "Test Section" (not a real class).
// No form class advisers — next year's are not known.
//
// Run:  npx tsx --env-file=.env.local scripts/backfill/apply-ay2027-sections-from-ay2026.ts
//       ... --apply   to write
import { createServiceClient } from '../../lib/supabase/service';

const APPLY = process.argv.includes('--apply');
const SKIP = new Set(['Test Section']);

async function main() {
  const svc = createServiceClient();
  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'}\n`);

  const ayId = async (code: string) => {
    const { data, error } = await svc
      .from('academic_years')
      .select('id')
      .eq('ay_code', code)
      .single();
    if (error) throw error;
    return data.id as string;
  };
  const [from, to] = await Promise.all([ayId('AY2026'), ayId('AY2027')]);

  const cols = 'name, level_id, class_type, schedule, levels(code)';
  const [{ data: src, error: sErr }, { data: dst, error: dErr }] =
    await Promise.all([
      svc.from('sections').select(cols).eq('academic_year_id', from),
      svc.from('sections').select(cols).eq('academic_year_id', to),
    ]);
  if (sErr) throw sErr;
  if (dErr) throw dErr;

  const have = new Set((dst ?? []).map((s: any) => `${s.level_id}::${s.name}`));
  const code = (s: any) =>
    (Array.isArray(s.levels) ? s.levels[0] : s.levels)?.code ?? '?';

  const toCreate = (src ?? [])
    .filter((s: any) => !SKIP.has(s.name))
    .filter((s: any) => !have.has(`${s.level_id}::${s.name}`))
    .sort((a: any, b: any) =>
      `${code(a)} ${a.name}`.localeCompare(`${code(b)} ${b.name}`)
    );

  console.log(`AY2027 already has ${dst?.length ?? 0} sections.`);
  for (const s of toCreate as any[])
    console.log(
      `  create ${code(s)} ${s.name}  (class_type=${s.class_type}, schedule=${s.schedule})`
    );
  console.log(`\n${toCreate.length} to create.`);

  if (!APPLY) {
    console.log('Dry run only. Re-run with --apply to write.');
    return;
  }
  if (toCreate.length === 0) return;

  const { error } = await svc.from('sections').insert(
    (toCreate as any[]).map((s) => ({
      academic_year_id: to,
      level_id: s.level_id,
      name: s.name,
      class_type: s.class_type,
      schedule: s.schedule,
    }))
  );
  if (error) throw error;
  console.log(`Created ${toCreate.length}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
