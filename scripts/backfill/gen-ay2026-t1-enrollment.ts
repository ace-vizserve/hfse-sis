// scripts/backfill/gen-ay2026-t1-enrollment.ts
// Generates ay2026-t1-enrollment-{preview,apply}.sql from HFSE's real T1
// attendance workbook. Emits SQL for review — does NOT write to the
// database itself. See:
// docs/superpowers/specs/2026-07-17-ay2026-t1-enrollment-import-design.md
//
// Run: npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t1-enrollment.ts
import { writeFileSync } from 'node:fs';

import { createServiceClient } from '../../lib/supabase/service';
import { parseWorkbook } from '../../lib/sis/backfill/enrollment/attendance-workbook';
import { buildEnrollmentImport } from '../../lib/sis/backfill/enrollment/build-import';
import type { CandidateName } from '../../lib/sis/backfill/enrollment/name-match';

const AY_CODE = 'AY2026';
const TERM_NUMBER = 1;
const TERM_START = '2026-01-08';
const TERM_END = '2026-03-13';
const WORKBOOK_PATH = 'AY2026/T1/T1 Attendance Jan-Mar (1).xlsx';
const NON_CANDIDATE_STATUSES = new Set(['Cancelled', 'Withdrawn']);

async function main() {
  const svc = createServiceClient();

  const sections = parseWorkbook(WORKBOOK_PATH);

  const { data: apps, error: appsErr } = await svc
    .from('ay2026_enrolment_applications')
    .select('enroleeNumber, studentNumber, lastName, firstName, middleName');
  if (appsErr) throw appsErr;

  const { data: statuses, error: statusErr } = await svc
    .from('ay2026_enrolment_status')
    .select('enroleeNumber, applicationStatus');
  if (statusErr) throw statusErr;

  const statusByEnrolee = new Map(
    (statuses ?? []).map((s: any) => [
      s.enroleeNumber as string,
      s.applicationStatus as string,
    ])
  );

  const candidates: CandidateName[] = (apps ?? [])
    .filter(
      (a: any) =>
        !NON_CANDIDATE_STATUSES.has(statusByEnrolee.get(a.enroleeNumber) ?? '')
    )
    .map((a: any) => ({
      enroleeNumber: a.enroleeNumber,
      studentNumber: a.studentNumber ?? null,
      lastName: a.lastName ?? '',
      firstName: a.firstName ?? '',
      middleName: a.middleName ?? null,
    }));

  const result = buildEnrollmentImport({
    sections,
    candidates,
    ayCode: AY_CODE,
    termNumber: TERM_NUMBER,
    termStart: TERM_START,
    termEnd: TERM_END,
  });

  writeFileSync(
    'scripts/backfill/ay2026-t1-enrollment-preview.sql',
    result.preview
  );
  writeFileSync(
    'scripts/backfill/ay2026-t1-enrollment-apply.sql',
    result.apply
  );

  console.log('Stats:', JSON.stringify(result.stats, null, 2));
  console.log('Wrote scripts/backfill/ay2026-t1-enrollment-preview.sql');
  console.log('Wrote scripts/backfill/ay2026-t1-enrollment-apply.sql');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
