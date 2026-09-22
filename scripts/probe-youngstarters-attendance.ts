// Do Youngstarters actually attend? Read-only.
//
// WHY THIS IS THE DECIDING QUESTION. The Edit Application dialog asks for
// "the last day they actually attended" before a student can be withdrawn,
// whenever they hold an active class row. All 15 AY2026 students who trip
// that gate with a non-Enrolled status are in YS Youngstarters (15/15 — every
// other section is 100% Enrolled).
//
// So: if Youngstarters carry attendance marks, a last day is a real, sensible
// question and only the dialog's WORDING needs work. If they carry none, the
// gate is asking about days that do not exist for this cohort.
//
// Usage: npx tsx --env-file=.env.local scripts/probe-youngstarters-attendance.ts

import { createServiceClient } from '@/lib/supabase/service';

async function main() {
  const ayCode = process.argv[2] ?? 'AY2026';
  const service = createServiceClient();

  const { data: ay } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  if (!ay) throw new Error(`No such academic year: ${ayCode}`);
  const ayId = (ay as { id: string }).id;

  const { data: sections } = await service
    .from('sections')
    .select('id, name, level:levels(code)')
    .eq('academic_year_id', ayId);

  type Section = {
    id: string;
    name: string;
    level: { code: string } | { code: string }[] | null;
  };

  console.log(`${ayCode} — attendance marks per section:\n`);

  for (const s of ((sections ?? []) as unknown as Section[]).sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    const level = Array.isArray(s.level) ? s.level[0] : s.level;
    const label = [level?.code, s.name].filter(Boolean).join(' ');

    // attendance_daily keys on section_student_id, not section_id (migration
    // 014) — so the join runs through section_students.
    const { count, error } = await service
      .from('attendance_daily')
      .select('id, section_student:section_students!inner(section_id)', {
        count: 'exact',
        head: true,
      })
      .eq('section_students.section_id', s.id);

    const { data: latest } = await service
      .from('attendance_daily')
      .select('date, section_student:section_students!inner(section_id)')
      .eq('section_students.section_id', s.id)
      .order('date', { ascending: false })
      .limit(1);

    const last =
      ((latest ?? []) as unknown as Array<{ date: string | null }>)[0]?.date ??
      '—';

    console.log(
      `  ${label.padEnd(24)} marks=${error ? `ERROR ${error.message}` : String(count ?? 0).padStart(6)}   latest=${last}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
