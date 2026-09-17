// Read-only: how many AY2026 roster rows carry the admissions link?
//
// `section_students.enrolee_number` (migration 041) is the PRIMARY key between
// Records and Admissions. When it is null, six call sites fall back to matching
// on the student number — and that fallback fails for any child whose two
// stores disagree.
//
// Usage: npx tsx --env-file=.env.local scripts/audit-roster-enrolee-link.ts

import { createServiceClient } from '../lib/supabase/service';

const sb = createServiceClient();

async function main() {
  const { data: ay } = await sb
    .from('academic_years')
    .select('id')
    .eq('ay_code', 'AY2026')
    .single();
  const { data: sections } = await sb
    .from('sections')
    .select('id,name,levels(code)')
    .eq('academic_year_id', (ay as any).id);

  let total = 0;
  let linked = 0;
  const gaps: string[] = [];

  for (const s of sections ?? []) {
    const { data: rows } = await sb
      .from('section_students')
      .select(
        'enrolee_number,index_number,students(student_number,last_name,first_name)'
      )
      .eq('section_id', (s as any).id);
    const miss = (rows ?? []).filter((r: any) => !r.enrolee_number);
    total += (rows ?? []).length;
    linked += (rows ?? []).length - miss.length;
    if (miss.length) {
      gaps.push(
        `  ${String((s as any).levels?.code ?? '?').padEnd(3)} ${String((s as any).name).padEnd(16)} ${String(miss.length).padStart(3)} of ${String((rows ?? []).length).padStart(3)} unlinked` +
          (miss.length <= 20
            ? '\n' +
              miss
                .map(
                  (m: any) =>
                    `        #${String(m.index_number).padStart(2)} ${m.students.student_number} ${m.students.last_name}, ${m.students.first_name}`
                )
                .join('\n')
            : '')
      );
    }
  }

  console.log(`AY2026 roster rows: ${total}`);
  console.log(`  carry enrolee_number : ${linked}`);
  console.log(`  null (fallback path) : ${total - linked}\n`);
  if (gaps.length) {
    console.log('Sections with unlinked rows:');
    gaps.forEach((g) => console.log(g));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
