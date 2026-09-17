// scripts/backfill/apply-roster-enrolee-link.ts
// Fills `section_students.enrolee_number` for the AY2026 roster rows missing it.
//
// WHY THIS MATTERS MORE THAN IT LOOKS. That column (migration 041) is the
// PRIMARY link between Records and Admissions. Six call sites read it, and when
// it is null they fall back to matching the Records `student_number` against
// the admissions `studentNumber` — which is a DIFFERENT column in a DIFFERENT
// table that nothing keeps in step. For AY2026 those two disagree for 24
// children, so for them the fallback silently finds nothing:
//
//   lib/classroom/student-details-source.ts  the teacher's student drawer —
//       allergies, medical conditions, parent mobiles, emergency contact. It
//       logs and returns null, so the drawer opens EMPTY rather than failing.
//   lib/supabase/admissions.ts               parent email lookup. No row, no
//       address, so report-card and P-File notices never reach the parent.
//   lib/sis/queries.ts                       cross-year enrolment history.
//   lib/sis/drill.ts                         dashboard drill-down — its own
//       comment says a miss collapses level/applicationStatus to defaults.
//   lib/sis/movements.ts                     movements fallback.
//   app/(sis)/sis/sections/[id]/page.tsx     roster → application link.
//   app/(attendance)/attendance/students/[studentNumber]/page.tsx
//
// Filling the column fixes all of them at once, and — unlike rewriting either
// store's number — it needs no decision about which number is "right". The
// enrolee number is unambiguous: it is on the application the child was
// enrolled from.
//
// 🔴 15 OF THE 18 ARE THE YOUNGSTARTERS ADDED ON 2026-09-18, whose roster rows
// were created without this column. The other three are earlier hand-placements
// (Cacao, Ajmal, Cama) that predate it being routinely set.
//
// ⚠ Each row is verified against admissions before writing: the enrolee number
// must exist in `ay2026_enrolment_applications` and its name must match the
// Records row. A child is never linked to somebody else's application.
//
// ⚠ Service-role writes leave NO `audit_log` row. The reasoning lives here.
//
// Dry run by default.
//
//   npx tsx --env-file=.env.local scripts/backfill/apply-roster-enrolee-link.ts
//   npx tsx --env-file=.env.local scripts/backfill/apply-roster-enrolee-link.ts --apply

import { createServiceClient } from '../../lib/supabase/service';

const AY = 'AY2026';
const APPLY = process.argv.includes('--apply');

/** studentNumber (Records) → enroleeNumber (Admissions). */
const LINKS: Record<string, string> = {
  // YoungStarters — from `scripts/audit-youngstarters-vs-admissions.ts`.
  Y250006: 'E260357', // Bedico, Miguel Zion
  Y240009: 'E260420', // Alvarez, Jianna Ava Elisse
  Y260001: 'E260379', // Canta, Juliam Lukas
  Y250004: 'E260369', // Infante, Myles Gabrielle
  Y260003: 'E260475', // Jaramilla, Zed Adriel
  Y240006: 'E260470', // Mathusudhanan, Brianna
  Y260005: 'E260011', // Rosales, Janella Marielle
  Y260006: 'E260407', // Semodio, Aeron Kryztofer
  Y250007: 'E260385', // Sia, Atarah Isabelle
  Y250005: 'E260373', // Vergara, Xaria Lia Elena
  Y260007: 'E260487', // Sencir, Jalen Alyxander
  Y260008: 'E260484', // Abdon, Reika Mei
  Y260009: 'E260424', // Borromeo, Angelie Cloud
  Y260010: 'E260523', // Gabaldon, Gerard Marqael
  Y260011: 'E260534', // Gonzales, Allysha Aj
};

const norm = (s: string) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');

async function main() {
  const sb = createServiceClient();

  const { data: ay } = await sb
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY)
    .single();
  const { data: sections } = await sb
    .from('sections')
    .select('id')
    .eq('academic_year_id', (ay as any).id);
  const sectionIds = (sections ?? []).map((s: any) => s.id);

  const { data: rows } = await sb
    .from('section_students')
    .select(
      'id,index_number,enrolee_number,section_id,students(student_number,last_name,first_name)'
    )
    .in('section_id', sectionIds)
    .is('enrolee_number', null);

  const { data: apps } = await sb
    .from('ay2026_enrolment_applications')
    .select('"enroleeNumber","lastName","firstName"');
  const appByNumber = new Map(
    (apps ?? []).map((a: any) => [a.enroleeNumber, a])
  );
  const appsByName = new Map<string, any[]>();
  for (const a of apps ?? []) {
    const k = norm(`${(a as any).lastName}${(a as any).firstName}`);
    appsByName.set(k, [...(appsByName.get(k) ?? []), a]);
  }

  const ready: {
    id: string;
    who: string;
    sn: string;
    en: string;
    how: string;
  }[] = [];
  const refused: string[] = [];

  for (const r of (rows ?? []) as any[]) {
    const sn = r.students.student_number as string;
    const who = `${r.students.last_name}, ${r.students.first_name}`;

    // Declared mapping first; otherwise fall back to a UNIQUE name match.
    let en = LINKS[sn] ?? null;
    let how = 'declared';
    if (!en) {
      const hits =
        appsByName.get(
          norm(`${r.students.last_name}${r.students.first_name}`)
        ) ?? [];
      if (hits.length === 1) {
        en = hits[0].enroleeNumber;
        how = 'name match (unique)';
      } else {
        refused.push(
          `${sn} ${who}: ${hits.length === 0 ? 'no AY2026 application by name' : `${hits.length} applications share that name`}`
        );
        continue;
      }
    }

    // The application must exist AND be the same child. Never link a roster row
    // to somebody else's record.
    const app = appByNumber.get(en);
    if (!app) {
      refused.push(`${sn} ${who}: ${en} is not an AY2026 application`);
      continue;
    }
    const sameChild =
      norm(app.lastName ?? '') === norm(r.students.last_name) &&
      (norm(app.firstName ?? '').startsWith(norm(r.students.first_name)) ||
        norm(r.students.first_name).startsWith(norm(app.firstName ?? '')));
    if (!sameChild) {
      refused.push(
        `${sn} ${who}: ${en} belongs to ${app.lastName}, ${app.firstName}`
      );
      continue;
    }

    ready.push({ id: r.id, who, sn, en, how });
  }

  console.log(
    `Roster rows missing the admissions link — ${AY}: ${(rows ?? []).length}\n`
  );
  for (const r of ready) {
    console.log(
      `  ${r.sn.padEnd(9)} ${r.who.padEnd(32)} → ${r.en}   (${r.how})`
    );
  }
  if (refused.length) {
    console.log('\nRefused:');
    refused.forEach((x) => console.log(`  🔴 ${x}`));
  }

  if (!APPLY) {
    console.log(
      `\nDRY RUN — ${ready.length} row(s) would be linked. Re-run with --apply.`
    );
    return;
  }

  console.log('\nApplying…');
  for (const r of ready) {
    const { error } = await sb
      .from('section_students')
      .update({ enrolee_number: r.en })
      .eq('id', r.id);
    if (error) throw error;
    console.log(`  ${r.sn} → ${r.en}`);
  }
  console.log(`\nDone. ${ready.length} row(s) linked.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
