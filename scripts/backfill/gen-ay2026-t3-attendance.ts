// scripts/backfill/gen-ay2026-t3-attendance.ts
// Generates ay2026-t3-attendance-preview.sql + a chunked set of apply files
// under ay2026-t3-attendance-apply/ from HFSE's real T3 attendance
// workbook. Emits SQL for review — does NOT write to the database itself.
// See:
// docs/superpowers/specs/2026-07-21-ay2026-t3-attendance-import-design.md
//
// Run: npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t3-attendance.ts
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createServiceClient } from '../../lib/supabase/service';
import { parseWorkbookT3 } from '../../lib/sis/backfill/attendance/attendance-workbook-t3';
import { buildAttendanceImportT3 } from '../../lib/sis/backfill/attendance/build-attendance-import-t3';
import type { RosterLookupEntry } from '../../lib/sis/backfill/attendance/build-attendance-import-t3';

const AY_CODE = 'AY2026';
const TERM_NUMBER = 3;
const YEAR = 2026;
const WORKBOOK_PATH = 'AY2026/T3/AY2026 Term 3 Attendance (1).xlsx';

async function main() {
  const svc = createServiceClient();

  const sections = parseWorkbookT3(WORKBOOK_PATH);

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

  const result = buildAttendanceImportT3({
    sections,
    rosterLookup,
    ayCode: AY_CODE,
    termNumber: TERM_NUMBER,
    year: YEAR,
  });

  writeFileSync(
    'scripts/backfill/ay2026-t3-attendance-preview.sql',
    result.preview
  );

  const applyDir = 'scripts/backfill/ay2026-t3-attendance-apply';
  // Clear stale files from a prior run (e.g. a different chunk count) so
  // the directory never mixes filenames from two generations.
  rmSync(applyDir, { recursive: true, force: true });
  mkdirSync(applyDir, { recursive: true });
  for (const f of result.applyFiles) {
    writeFileSync(join(applyDir, f.filename), f.sql);
  }

  console.log('Stats:', JSON.stringify(result.stats, null, 2));
  console.log('Wrote scripts/backfill/ay2026-t3-attendance-preview.sql');
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
