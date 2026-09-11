// scripts/backfill/probe-double-placed.ts
// Read-only. Lists any student holding more than one placement in the same
// academic year, with each placement's status — so a real double-booking can
// be told apart from one live class plus a withdrawn one.
//
// Run: npx tsx --env-file=.env.local scripts/backfill/probe-double-placed.ts
import { createServiceClient } from '../../lib/supabase/service';

async function main() {
  const svc = createServiceClient();
  const { data: years } = await svc
    .from('academic_years')
    .select('id, ay_code');
  const ayById = new Map((years as any[]).map((y) => [y.id, y.ay_code]));

  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await svc
      .from('section_students')
      .select(
        'id, index_number, enrollment_status, withdrawal_date, students!inner(student_number, last_name, first_name), sections!inner(name, academic_year_id, levels!inner(code))'
      )
      .range(from, from + 999);
    if (error) throw error;
    const page = (data ?? []) as any[];
    rows.push(...page);
    if (page.length < 1000) break;
  }

  const byKey = new Map<string, any[]>();
  for (const r of rows) {
    const ay = ayById.get(r.sections.academic_year_id) ?? '?';
    const k = `${ay}|${r.students.student_number}`;
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }

  const doubles = [...byKey].filter(([, v]) => v.length > 1);
  console.log(
    `students placed twice in one academic year: ${doubles.length}\n`
  );
  for (const [k, list] of doubles) {
    const [ay, sn] = k.split('|');
    console.log(
      `  ${ay}  ${sn}  "${list[0].students.last_name}, ${list[0].students.first_name}"`
    );
    for (const r of list)
      console.log(
        `      ${r.sections.levels.code} ${r.sections.name} #${r.index_number}  ${r.enrollment_status}${r.withdrawal_date ? ` (withdrawn ${r.withdrawal_date})` : ''}`
      );
    const active = list.filter((r) => r.enrollment_status !== 'withdrawn');
    console.log(
      `      -> ${active.length} active placement(s)${active.length === 1 ? ' — the other is withdrawn, so this is not a live double-booking' : ''}`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  });
