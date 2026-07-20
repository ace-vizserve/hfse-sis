// scripts/backfill/gen-ay2026-t1-attendance.ts
// Generates ay2026-t1-attendance-preview.sql + a chunked set of apply files
// under ay2026-t1-attendance-apply/ from HFSE's real T1 attendance
// workbook. Emits SQL for review — does NOT write to the database itself.
// Apply is split into multiple files because a single combined query (the
// full ~16k-row attendance_daily VALUES list) is too large for the
// Supabase SQL Editor to run in one go. See:
// docs/superpowers/specs/2026-07-17-ay2026-t1-attendance-import-design.md
//
// Run: npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t1-attendance.ts
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createServiceClient } from '../../lib/supabase/service';
import { parseWorkbook } from '../../lib/sis/backfill/enrollment/attendance-workbook';
import { buildAttendanceImport } from '../../lib/sis/backfill/attendance/build-attendance-import';
import type { RosterLookupEntry } from '../../lib/sis/backfill/attendance/build-attendance-import';

const AY_CODE = 'AY2026';
const TERM_NUMBER = 1;
const YEAR = 2026;
const WORKBOOK_PATH = 'AY2026/T1/T1 Attendance Jan-Mar (1).xlsx';

async function main() {
  const svc = createServiceClient();

  const sections = parseWorkbook(WORKBOOK_PATH);

  const { data: ay, error: ayErr } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY_CODE)
    .single();
  if (ayErr) throw ayErr;

  const { data: rows, error: rowsErr } = await svc
    .from('section_students')
    .select(
      'id, index_number, sections!inner(name, academic_year_id, levels!inner(code))'
    )
    .eq('sections.academic_year_id', (ay as any).id);
  if (rowsErr) throw rowsErr;

  const rosterLookup: RosterLookupEntry[] = (rows ?? []).map((r: any) => ({
    levelCode: r.sections.levels.code,
    cleanName: r.sections.name,
    indexNumber: r.index_number,
    sectionStudentId: r.id,
  }));

  const result = buildAttendanceImport({
    sections,
    rosterLookup,
    ayCode: AY_CODE,
    termNumber: TERM_NUMBER,
    year: YEAR,
  });

  writeFileSync(
    'scripts/backfill/ay2026-t1-attendance-preview.sql',
    result.preview
  );

  const applyDir = 'scripts/backfill/ay2026-t1-attendance-apply';
  // Clear stale files from a prior run (e.g. a different chunk count) so
  // the directory never mixes filenames from two generations.
  rmSync(applyDir, { recursive: true, force: true });
  mkdirSync(applyDir, { recursive: true });
  for (const f of result.applyFiles) {
    writeFileSync(join(applyDir, f.filename), f.sql);
  }

  console.log('Stats:', JSON.stringify(result.stats, null, 2));
  console.log('Wrote scripts/backfill/ay2026-t1-attendance-preview.sql');
  console.log(
    `Wrote ${result.applyFiles.length} apply files to ${applyDir}/ — run them IN ORDER (see preview.sql).`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
