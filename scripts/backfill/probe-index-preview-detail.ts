// scripts/backfill/probe-index-preview-detail.ts
//
// Read-only. Dumps the exact old→new map "Generate index" would apply to a
// section, straight from the RPC's own dry-run — no re-derivation, so this is
// what the button would really do.
//
// Written because the headline counts were misleading on their own: a section
// reporting "12 of 12 would move" turned out to have an almost-correct ORDER.
// Position and number are not the same thing — one student inserted in the
// wrong place, or one number retired by a student who left, shifts the number
// of everyone below without anyone being in the wrong sequence.
//
// Run: npx tsx --env-file=.env.local scripts/backfill/probe-index-preview-detail.ts [SectionName ...]
import { createServiceClient } from '../../lib/supabase/service';

const AY_CODE = 'AY2026';
const DEFAULT_SECTIONS = ['Perseverance', 'Courageous', 'Consistency'];

async function main() {
  const wanted = process.argv.slice(2);
  const names = wanted.length > 0 ? wanted : DEFAULT_SECTIONS;
  const svc = createServiceClient();

  const { data: ay } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY_CODE)
    .single();
  const { data: sections } = await svc
    .from('sections')
    .select('id, name')
    .eq('academic_year_id', (ay as { id: string }).id);
  const secs = (sections ?? []) as Array<{ id: string; name: string }>;

  for (const name of names) {
    const sec = secs.find((s) => s.name.endsWith(name) || s.name === name);
    if (!sec) {
      console.log(`\n(no section matching "${name}")`);
      continue;
    }

    // Numbers currently held by students who have left. These are retired and
    // skipped when the sequence is handed out, which shifts everyone below.
    const { data: gone } = await svc
      .from('section_students')
      .select('index_number, student:students(last_name, first_name)')
      .eq('section_id', sec.id)
      .eq('enrollment_status', 'withdrawn')
      .order('index_number');
    const retired = (gone ?? []) as Array<{
      index_number: number;
      student:
        | { last_name: string; first_name: string }
        | Array<{ last_name: string; first_name: string }>
        | null;
    }>;

    const { data, error } = await svc.rpc('generate_section_index_numbers', {
      p_section_id: sec.id,
      p_dry_run: true,
    });
    if (error) {
      console.log(`\n${sec.name}: preview failed — ${error.message}`);
      continue;
    }
    const result = data as {
      rows_renumbered: number;
      rows_changed: number;
      after: Array<{
        name: string;
        old_index: number | null;
        new_index: number;
      }>;
    };

    console.log(`\n=== ${sec.name} ===`);
    console.log(
      `  ${result.rows_changed} of ${result.rows_renumbered} would change`
    );
    if (retired.length > 0) {
      console.log(
        `  numbers kept aside for students who left: ${retired
          .map((r) => {
            const s = Array.isArray(r.student) ? r.student[0] : r.student;
            return `#${r.index_number} (${s?.last_name ?? '?'})`;
          })
          .join(', ')}`
      );
    } else {
      console.log('  no retired numbers in this class');
    }
    console.log('  now  ->  after   student');
    for (const r of result.after) {
      const moved = r.old_index !== r.new_index;
      console.log(
        `  ${String(r.old_index ?? '—').padStart(4)} -> ${String(r.new_index).padStart(5)}   ${moved ? '*' : ' '} ${r.name}`
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
