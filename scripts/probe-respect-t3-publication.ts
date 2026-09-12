// scripts/probe-respect-t3-publication.ts
// Read-only. Answers: "I published the Respect T3 report card and the parent
// portal does not show it." Walks every gate between the publication row and
// what /api/parent/v2/students + /api/parent/v2/report-card will return.
//
// Run: npx tsx --env-file=.env.local scripts/probe-respect-t3-publication.ts
import { createServiceClient } from '../lib/supabase/service';

const SGT = 'Asia/Singapore';
const fmt = (iso: string | null) =>
  iso == null
    ? 'null'
    : `${iso}  (SGT ${new Date(iso).toLocaleString('en-SG', { timeZone: SGT })})`;

async function main() {
  const svc = createServiceClient();
  const now = Date.now();
  console.log(
    'NOW:',
    new Date(now).toISOString(),
    ' (SGT',
    new Date(now).toLocaleString('en-SG', { timeZone: SGT }),
    ')\n'
  );

  console.log('=== sections named "%Respect%" ===');
  const { data: sections, error: secErr } = await svc
    .from('sections')
    .select(
      'id, name, academic_year_id, level:levels(label), academic_year:academic_years(ay_code)'
    )
    .ilike('name', '%respect%');
  if (secErr) console.log('  ERROR:', secErr.message);
  const secs = (sections ?? []) as any[];
  for (const s of secs) {
    console.log(
      ` ${s.id}  ${s.level?.label ?? '?'} ${s.name}  AY=${s.academic_year?.ay_code ?? s.academic_year_id}`
    );
  }
  if (secs.length === 0) return;

  const sectionIds = secs.map((s) => s.id);

  console.log('\n=== report_card_publications for those sections ===');
  const { data: pubs, error: pubErr } = await svc
    .from('report_card_publications')
    .select(
      'id, section_id, term_id, publish_from, publish_until, published_by, notified_at, created_at, updated_at'
    )
    .in('section_id', sectionIds);
  if (pubErr) console.log('  ERROR:', pubErr.message);
  const pubRows = (pubs ?? []) as any[];

  const termIds = Array.from(new Set(pubRows.map((p) => p.term_id)));
  const { data: terms } =
    termIds.length > 0
      ? await svc
          .from('terms')
          .select('id, term_number, label, academic_year_id')
          .in('id', termIds)
      : { data: [] };
  const termById = new Map(((terms ?? []) as any[]).map((t) => [t.id, t]));
  const secById = new Map(secs.map((s) => [s.id, s]));

  if (pubRows.length === 0) console.log('  (none)');
  for (const p of pubRows) {
    const s = secById.get(p.section_id);
    const t = termById.get(p.term_id);
    const from = new Date(p.publish_from).getTime();
    const until = new Date(p.publish_until).getTime();
    const active = now >= from && now <= until;
    console.log(
      `\n ${s?.level?.label ?? '?'} ${s?.name}  term=${t ? `T${t.term_number} (${t.label})` : p.term_id}`
    );
    console.log('   publish_from :', fmt(p.publish_from));
    console.log('   publish_until:', fmt(p.publish_until));
    console.log(
      '   ACTIVE NOW   :',
      active
        ? 'YES'
        : `NO  (${now < from ? 'window has not started' : 'window already ended'})`
    );
    console.log('   term AY      :', t?.academic_year_id ?? '?');
    console.log('   section AY   :', s?.academic_year_id ?? '?');
    console.log(
      '   term AY == section AY:',
      t?.academic_year_id === s?.academic_year_id ? 'yes' : 'NO — MISMATCH'
    );
    console.log(
      '   published_by :',
      p.published_by,
      '| notified_at:',
      fmt(p.notified_at)
    );
  }

  // Per-student linkage check for the section(s) with a T3 publication.
  const t3Pubs = pubRows.filter(
    (p) => termById.get(p.term_id)?.term_number === 3
  );
  for (const p of t3Pubs) {
    const s = secById.get(p.section_id);
    console.log(
      `\n=== parent-linkage check: ${s?.level?.label ?? ''} ${s?.name} (T3) ===`
    );
    const { data: roster } = await svc
      .from('section_students')
      .select(
        'id, index_number, enrollment_status, student:students(id, student_number, last_name, first_name)'
      )
      .eq('section_id', p.section_id)
      .order('index_number');
    const rows = (roster ?? []) as any[];
    console.log(`  roster rows: ${rows.length}`);

    const studentNumbers = rows
      .map((r) => r.student?.student_number)
      .filter(Boolean);

    // Admissions side: applications (emails + studentNumber) and status.
    const ayCode = (s?.academic_year?.ay_code ?? 'AY2026') as string;
    const slug = ayCode.toLowerCase();
    const appsTable = `${slug}_enrolment_applications`;
    const statusTable = `${slug}_enrolment_status`;
    const { data: apps, error: appErr } = await svc
      .from(appsTable)
      .select(
        '"enroleeNumber", "studentNumber", "lastName", "firstName", "motherEmail", "fatherEmail"'
      )
      .in('studentNumber', studentNumbers);
    if (appErr) console.log('  apps ERROR:', appErr.message);
    const appByNumber = new Map(
      ((apps ?? []) as any[]).map((a) => [a.studentNumber, a])
    );
    const enroleeNumbers = ((apps ?? []) as any[])
      .map((a) => a.enroleeNumber)
      .filter(Boolean);
    const { data: statuses, error: stErr } =
      enroleeNumbers.length > 0
        ? await svc
            .from(statusTable)
            .select(
              '"enroleeNumber", "classLevel", "classSection", "applicationStatus"'
            )
            .in('enroleeNumber', enroleeNumbers)
        : { data: [], error: null };
    if (stErr) console.log('  status ERROR:', stErr.message);
    const statusByEnrolee = new Map(
      ((statuses ?? []) as any[]).map((r) => [r.enroleeNumber, r])
    );

    let ok = 0;
    const problems: string[] = [];
    for (const r of rows) {
      const sn = r.student?.student_number;
      const name = `${r.student?.last_name ?? ''}, ${r.student?.first_name ?? ''}`;
      const app = sn ? appByNumber.get(sn) : null;
      const issues: string[] = [];
      if (!app)
        issues.push('no admissions application row for this student_number');
      else {
        const emails = [app.motherEmail, app.fatherEmail].filter(Boolean);
        if (emails.length === 0)
          issues.push('NO parent email on the application');
        const st = statusByEnrolee.get(app.enroleeNumber);
        if (!st) issues.push('no admissions status row');
        else {
          if (!st.classSection)
            issues.push('classSection is null (filtered out)');
          if (['Cancelled', 'Withdrawn'].includes(st.applicationStatus ?? ''))
            issues.push(
              `applicationStatus = ${st.applicationStatus} (filtered out)`
            );
        }
      }
      if (issues.length === 0) ok++;
      else
        problems.push(
          `  #${r.index_number} ${name} [${sn}] — ${issues.join('; ')}`
        );
    }
    console.log(`  parents can resolve this child: ${ok}/${rows.length}`);
    if (problems.length > 0) {
      console.log('  blocked:');
      for (const l of problems) console.log(l);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
