// scripts/backfill/probe-t3-cacao-and-withdrawals.ts
// Read-only. Two questions left open on the T3 re-import:
//   1. Karl Miguel Cacao is said to be in S3 — which register sheet actually
//      carries his attendance row, and what does admissions say about him?
//   2. The nine children whose attendance stops mid-July are said to be
//      withdrawn — so who IS marked Withdrawn/Cancelled in admissions?
//
// Run: npx tsx --env-file=.env.local scripts/backfill/probe-t3-cacao-and-withdrawals.ts
import { parseWorkbookT3 } from '../../lib/sis/backfill/attendance/attendance-workbook-t3';
import { createServiceClient } from '../../lib/supabase/service';

const WORKBOOK = 'AY2026 Term 3 Attendance Latest.xlsx';

async function main() {
  console.log('=== 1. which register sheet carries a CACAO row ===');
  const sections = parseWorkbookT3(WORKBOOK);
  for (const s of sections) {
    const hits = s.section.students.filter((st) =>
      st.fullName.toUpperCase().includes('CACAO')
    );
    for (const h of hits) {
      const filled = Object.entries(h.marks).filter(([, v]) => v.trim());
      console.log(
        `  sheet "${s.section.sheetName}"  #${h.indexNo}  "${h.fullName}"  ${filled.length} marks, ${filled[0]?.[0]} .. ${filled[filled.length - 1]?.[0]}`
      );
    }
  }

  const svc = createServiceClient();
  const { data: cacao, error: cErr } = await svc
    .from('ay2026_enrolment_status')
    .select(
      '"enroleeNumber", "enroleeName", "applicationStatus", "applicationRemarks", "levelApplied", "classLevel", "classSection", "classStatus", "enrolmentDate"'
    )
    .ilike('enroleeName', '%CACAO%');
  if (cErr) throw cErr;
  console.log('\n  admissions rows matching CACAO:');
  for (const a of (cacao ?? []) as any[]) {
    console.log(
      `    ${a.enroleeNumber}  "${a.enroleeName}"  status=${a.applicationStatus}  levelApplied=${a.levelApplied ?? '-'}  class=${a.classLevel ?? '-'} ${a.classSection ?? '-'} (${a.classStatus ?? '-'})  enrolmentDate=${a.enrolmentDate ?? '-'}`
    );
    if (a.applicationRemarks)
      console.log(
        `        remarks: ${String(a.applicationRemarks).slice(0, 200)}`
      );
  }

  console.log('\n=== 2. everyone admissions marks Withdrawn or Cancelled ===');
  const { data: wd, error: wErr } = await svc
    .from('ay2026_enrolment_status')
    .select(
      '"enroleeNumber", "enroleeName", "applicationStatus", "applicationRemarks", "classLevel", "classSection"'
    )
    .in('applicationStatus', ['Withdrawn', 'Cancelled'])
    .order('applicationStatus');
  if (wErr) throw wErr;
  for (const a of (wd ?? []) as any[]) {
    console.log(
      `  ${String(a.applicationStatus).padEnd(9)} ${a.enroleeNumber}  ${String(a.enroleeName).padEnd(40)} ${a.classLevel ?? '-'} ${a.classSection ?? ''}`
    );
  }
  console.log(`  (${(wd ?? []).length} rows)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  });
