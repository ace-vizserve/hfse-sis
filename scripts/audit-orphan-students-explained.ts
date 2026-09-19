// scripts/audit-orphan-students-explained.ts
// 237 `students` rows sit on no class roster in any year. What ARE they?
//
// WHY. `probe-orphan-students.ts` counted them and split off the 36 that are a
// second record for an enrolled child. It left 201 unexplained, which is a
// number surfaced and then abandoned — the shape of finding that turns into a
// scare later. This classifies every one of them.
//
// A student with no `section_students` row anywhere is invisible in every
// module: no register, no grades, no P-File slot list, no report card. That is
// correct for an applicant who never enrolled, and a fault for anybody else.
//
// Reads only. Usage:
//   npx tsx --env-file=.env.local scripts/audit-orphan-students-explained.ts

import { createServiceClient } from '../lib/supabase/service';

const sb = createServiceClient();

const AYS = ['ay2025', 'ay2026', 'ay2027'] as const;

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
    .select('id,student_number,last_name,first_name,middle_name,is_active');
  const all = (students ?? []) as any[];

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

  const orphans = all.filter((s) => !enrolled.has(s.id));

  // Name index of everyone who IS on a roster, to spot second records.
  const enrolledByName = new Map<string, any[]>();
  for (const s of all) {
    if (!enrolled.has(s.id)) continue;
    enrolledByName.set(key(s), [...(enrolledByName.get(key(s)) ?? []), s]);
  }

  // Every admissions row, by studentNumber, across all three years.
  type Adm = { ay: string; status: string | null; level: string | null };
  const admissionsBy = new Map<string, Adm[]>();
  for (const ay of AYS) {
    const { data: apps } = await sb
      .from(`${ay}_enrolment_applications`)
      .select('"studentNumber","enroleeNumber","levelApplied"');
    const { data: st } = await sb
      .from(`${ay}_enrolment_status`)
      .select('"enroleeNumber","applicationStatus"');
    const statusBy = new Map(
      (st ?? []).map((r: any) => [r.enroleeNumber, r.applicationStatus])
    );
    for (const a of (apps ?? []) as any[]) {
      if (!a.studentNumber) continue;
      admissionsBy.set(a.studentNumber, [
        ...(admissionsBy.get(a.studentNumber) ?? []),
        {
          ay: ay.toUpperCase(),
          status: statusBy.get(a.enroleeNumber) ?? null,
          level: a.levelApplied,
        },
      ]);
    }
  }

  const buckets = new Map<string, any[]>();
  const put = (k: string, v: any) =>
    buckets.set(k, [...(buckets.get(k) ?? []), v]);

  for (const o of orphans) {
    const adm = admissionsBy.get(o.student_number) ?? [];
    const statuses = adm.map((a) => a.status).filter(Boolean) as string[];
    const twin = enrolledByName.get(key(o));

    if (twin?.length) {
      put('A second record for a child who IS enrolled', { o, adm, twin });
    } else if (!adm.length) {
      put('No admissions row at all under this number', { o, adm });
    } else if (statuses.some((s) => /enrol|registered/i.test(s))) {
      put('🔴 Admissions says ENROLLED but on no roster', { o, adm });
    } else if (statuses.every((s) => /withdraw/i.test(s))) {
      put('Withdrawn', { o, adm });
    } else if (statuses.every((s) => /cancel/i.test(s))) {
      put('Cancelled', { o, adm });
    } else if (statuses.every((s) => /submitted|pending|new/i.test(s))) {
      put('Applied, never enrolled', { o, adm });
    } else {
      put('Other admissions status', { o, adm });
    }
  }

  console.log(`students rows        : ${all.length}`);
  console.log(`  on a roster        : ${all.length - orphans.length}`);
  console.log(`  on NO roster       : ${orphans.length}\n`);
  console.log('Why each orphan has no roster row:');
  for (const [k, v] of [...buckets].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(v.length).padStart(4)}  ${k}`);
  }

  const alarming = buckets.get('🔴 Admissions says ENROLLED but on no roster');
  if (alarming?.length) {
    console.log(
      `\n🔴 THE ONLY BUCKET THAT IS A FAULT — ${alarming.length} children admissions calls enrolled, on no roster in any year:`
    );
    for (const { o, adm } of alarming) {
      console.log(
        `   ${o.student_number.padEnd(9)} ${`${o.last_name}, ${o.first_name}`.padEnd(32)} ${adm.map((a: Adm) => `${a.ay} ${a.status}/${a.level ?? '?'}`).join(' · ')}`
      );
    }
  }

  const noAdm = buckets.get('No admissions row at all under this number');
  if (noAdm?.length) {
    // These split cleanly by the SHAPE of the number. The demo/seed years
    // minted numbers from an academic year that no longer exists (AY9999, and
    // the AY2799/AY2709998 rollover fixtures), so they are far longer than a
    // real one and can never collide with a live child.
    const seedish = (n: string) =>
      n.length > 9 || /^H9|^H2709|^H2799|^V?9{3}/.test(n);
    const seeded = noAdm.filter(({ o }: any) => seedish(o.student_number));
    const real = noAdm.filter(({ o }: any) => !seedish(o.student_number));

    console.log(`\n⚠ ${noAdm.length} carry a number NO admissions row uses:`);
    console.log(
      `   ${String(seeded.length).padStart(4)}  look SEEDED — a number shape no real intake produces (AY9999 and the rollover fixtures, whose year is gone)`
    );
    console.log(
      `   ${String(real.length).padStart(4)}  have a REAL-looking number and no admissions row — these are the ones worth a look`
    );

    if (real.length) {
      console.log('\n   Real-looking, no admissions row:');
      for (const { o } of real.slice(0, 25)) {
        console.log(
          `     ${o.student_number.padEnd(9)} ${`${o.last_name}, ${o.first_name}`.padEnd(32)}${o.is_active ? '' : '(inactive)'}`
        );
      }
      if (real.length > 25) console.log(`     … and ${real.length - 25} more`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
