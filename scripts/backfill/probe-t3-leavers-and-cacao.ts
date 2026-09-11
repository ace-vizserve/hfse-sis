// scripts/backfill/probe-t3-leavers-and-cacao.ts
// Read-only. Three follow-ups on the T3 re-import:
//   1. the nine children whose attendance stops mid-July — confirm against
//      admissions that they are withdrawn, and report what the SIS says;
//   2. Karl Miguel Cacao — look for him in S3, not S4;
//   3. Akter, Mst Rabaya/Rabiya — show the SIS record to be corrected.
//
// Run: npx tsx --env-file=.env.local scripts/backfill/probe-t3-leavers-and-cacao.ts
import { createServiceClient } from '../../lib/supabase/service';

const AY_CODE = 'AY2026';

const LEAVERS = [
  'Brown, James',
  'Cam, Isaac Lucas',
  'Tun, Aung Chan Myae',
  'Lagman, Julian Caleb',
  'Kalingo, Crisanto Omar',
  'Brown, Charles',
  'Calina, Xander Grae',
  'Gandol, Ethan Jacob',
  'Tolosa, Priam Rai',
  'Francisco, Jelenna Rei',
];

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

async function main() {
  const svc = createServiceClient();
  const { data: ay } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY_CODE)
    .single();

  const { data: ssRows } = await svc
    .from('section_students')
    .select(
      'id, index_number, enrollment_status, enrollment_date, withdrawal_date, students(id, student_number, last_name, first_name), sections!inner(name, academic_year_id, levels!inner(code))'
    )
    .eq('sections.academic_year_id', (ay as any).id);

  const roster = (ssRows as any[]).map((r) => ({
    ssId: r.id,
    studentId: r.students?.id,
    studentNumber: r.students?.student_number,
    idx: r.index_number,
    status: r.enrollment_status,
    withdrawn: r.withdrawal_date,
    sec: `${r.sections.levels.code} ${r.sections.name}`,
    name: `${r.students?.last_name}, ${r.students?.first_name}`,
  }));

  // --- admissions side ---
  const { data: adm, error: admErr } = await svc
    .from('ay2026_enrolment_status')
    .select(
      '"enroleeNumber", "enroleeName", "applicationStatus", "applicationRemarks", "applicationUpdatedDate", "classLevel", "classSection"'
    );
  if (admErr) {
    console.log('!! could not read ay2026_enrolment_status:', admErr.message);
  }
  const admRows = (adm ?? []) as any[];
  console.log(`admissions rows read: ${admRows.length}`);
  const admStatuses = new Map<string, number>();
  for (const a of admRows)
    admStatuses.set(
      a.applicationStatus ?? '(null)',
      (admStatuses.get(a.applicationStatus ?? '(null)') ?? 0) + 1
    );
  console.log(
    'applicationStatus spread:',
    [...admStatuses].map(([k, v]) => `${k}=${v}`).join('  ')
  );

  const findAdm = (name: string) => {
    const target = new Set(norm(name).split(' '));
    return admRows
      .map((a) => {
        const w = new Set(norm(a.enroleeName ?? '').split(' '));
        let hit = 0;
        for (const t of target) if (w.has(t)) hit++;
        return { a, score: hit / Math.max(1, target.size) };
      })
      .filter((x) => x.score >= 0.75)
      .sort((x, y) => y.score - x.score)
      .slice(0, 2);
  };

  console.log('\n=== 1. the nine (plus Francisco) — SIS vs admissions ===');
  for (const n of LEAVERS) {
    const sis = roster.find((r) => norm(r.name) === norm(n));
    console.log(`\n  ${n}`);
    if (!sis) {
      console.log('    SIS: not found');
    } else {
      console.log(
        `    SIS: ${sis.sec} #${sis.idx}  student_number=${sis.studentNumber}  status=${sis.status}  withdrawal_date=${sis.withdrawn ?? '-'}`
      );
    }
    const hits = findAdm(n);
    if (hits.length === 0) console.log('    admissions: no matching enrolee');
    for (const { a, score } of hits) {
      console.log(
        `    admissions (${score.toFixed(2)}): "${a.enroleeName}"  ${a.enroleeNumber}  status=${a.applicationStatus}  ${a.classLevel ?? ''} ${a.classSection ?? ''}  updated=${a.applicationUpdatedDate ?? '-'}`
      );
      if (a.applicationRemarks)
        console.log(
          `        remarks: ${String(a.applicationRemarks).slice(0, 160)}`
        );
    }
  }

  console.log('\n=== 2. Karl Miguel Cacao — searching S3 and everywhere ===');
  const cacao = roster.filter((r) => norm(r.name).includes('CACAO'));
  if (cacao.length === 0) console.log('  not in any AY2026 section');
  cacao.forEach((r) =>
    console.log(
      `  ${r.sec} #${r.idx} "${r.name}"  student_number=${r.studentNumber}  status=${r.status}`
    )
  );
  console.log('  S3 sections on the roster:');
  const s3 = [
    ...new Set(roster.filter((r) => r.sec.startsWith('S3')).map((r) => r.sec)),
  ];
  console.log(`    ${s3.join(', ')}`);
  const s3Members = roster.filter((r) => r.sec.startsWith('S3'));
  console.log(`  S3 roster (${s3Members.length}):`);
  for (const r of s3Members.sort((a, b) => a.idx - b.idx))
    console.log(
      `    #${String(r.idx).padStart(2)} ${r.name}${r.status !== 'active' ? ` [${r.status}]` : ''}`
    );
  const admCacao = findAdm('Cacao, Karl Miguel');
  for (const { a, score } of admCacao)
    console.log(
      `  admissions (${score.toFixed(2)}): "${a.enroleeName}" ${a.enroleeNumber} status=${a.applicationStatus} ${a.classLevel ?? ''} ${a.classSection ?? ''}`
    );

  console.log('\n=== 3. Akter — the SIS record to correct ===');
  for (const r of roster.filter((x) => norm(x.name).includes('AKTER')))
    console.log(
      `  ${r.sec} #${r.idx} "${r.name}"  students.id=${r.studentId}  student_number=${r.studentNumber}`
    );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  });
