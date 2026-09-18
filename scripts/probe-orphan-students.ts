// Read-only: how many `students` rows sit on no class roster at all, and how
// many of those are a second record for a child who IS on one?
//
// Usage: npx tsx --env-file=.env.local scripts/probe-orphan-students.ts

import { createServiceClient } from '../lib/supabase/service';

const sb = createServiceClient();

const key = (s: any) =>
  [s.last_name, s.first_name, s.middle_name ?? '']
    .join('|')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z|]/g, '');

async function main() {
  const { data: students } = await sb
    .from('students')
    .select('id,student_number,last_name,first_name,middle_name');

  // Every student_id that appears on any roster, any year.
  const enrolled = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await sb
      .from('section_students')
      .select('student_id')
      .range(from, from + 999);
    if (!data?.length) break;
    for (const r of data) enrolled.add((r as any).student_id);
    if (data.length < 1000) break;
  }

  const all = (students ?? []) as any[];
  const orphans = all.filter((s) => !enrolled.has(s.id));

  // An orphan is a DUPLICATE when another row with the same full name IS enrolled.
  const enrolledByName = new Map<string, any[]>();
  for (const s of all) {
    if (!enrolled.has(s.id)) continue;
    const k = key(s);
    enrolledByName.set(k, [...(enrolledByName.get(k) ?? []), s]);
  }

  const dupes = orphans.filter((o) => enrolledByName.has(key(o)));
  const lone = orphans.filter((o) => !enrolledByName.has(key(o)));

  console.log(`students rows total            : ${all.length}`);
  console.log(
    `  on at least one roster       : ${all.length - orphans.length}`
  );
  console.log(`  on NO roster (orphans)       : ${orphans.length}`);
  console.log(
    `    …a second row for an enrolled child (DUPLICATE) : ${dupes.length}`
  );
  console.log(
    `    …nobody enrolled shares the name (other)        : ${lone.length}`
  );

  console.log('\nDuplicates, by the prefix of the orphaned number:');
  const byPrefix = new Map<string, number>();
  for (const d of dupes) {
    const p = String(d.student_number).slice(0, 3);
    byPrefix.set(p, (byPrefix.get(p) ?? 0) + 1);
  }
  for (const [p, n] of [...byPrefix].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${p}…  ${n}`);
  }

  console.log(
    '\nFirst 20 duplicates — orphan number → the number actually in use:'
  );
  for (const d of dupes.slice(0, 20)) {
    const live = enrolledByName.get(key(d))!;
    console.log(
      `  ${String(d.student_number).padEnd(9)} ${`${d.last_name}, ${d.first_name}`.padEnd(34)} → ${live.map((l: any) => l.student_number).join(', ')}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
