// scripts/backfill/gen-ay2026-t1-grading.ts
// Generates ay2026-t1-grading-{preview,apply}.sql from HFSE's real T1
// "Global Class" grading workbooks. Emits SQL for review — does NOT write
// to the database itself. See:
// docs/superpowers/specs/2026-07-17-ay2026-t1-grading-import-design.md
//
// Run: npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t1-grading.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createServiceClient } from '../../lib/supabase/service';
import { parseGradingWorkbook } from '../../lib/sis/backfill/grading/grading-workbook';
import { buildGradingImport } from '../../lib/sis/backfill/grading/build-grading-import';
import type { RosterLookupEntry } from '../../lib/sis/backfill/grading/build-grading-import';

const AY_CODE = 'AY2026';
const TERM_NUMBER = 1;
const DIR = 'AY2026/T1/Term 1 Grades/Lower Secondary Global Grading Sheets';

// Explicit file list — never a directory glob. "Copy of Mathematics
// Grading Sheet..." is a corrupted duplicate (broken #REF! student names,
// wrong weights on its Integrity 1 tab) and must never be read.
const SUBJECT_FILES: { file: string; subjectCode: string }[] = [
  {
    file: 'Art and Design Grading Sheet Global Class AY2026 T1.xlsx',
    subjectCode: 'ARTD',
  },
  {
    file: 'Computing Grading Sheet Global Class AY2026 T1.xlsx',
    subjectCode: 'COMP',
  },
  {
    file: 'English Grading Sheet Global Class AY2026 T1.xlsx',
    subjectCode: 'ENG',
  },
  {
    file: 'Global Perspectives Grading Sheet Global Class AY2026 T1.xlsx',
    subjectCode: 'GP',
  },
  {
    file: 'Humanities Grading Sheet Global Class AY2026 T1.xlsx',
    subjectCode: 'HUM',
  },
  {
    file: 'Mathematics Grading Sheet Global Class AY2026 T1.xlsx',
    subjectCode: 'MATH',
  },
  {
    file: 'PE and Health Grading Sheet Global Class AY2026 T1.xlsx',
    subjectCode: 'PEH',
  },
  {
    file: 'Science Grading Sheet Global Class AY2026 T1.xlsx',
    subjectCode: 'SCI',
  },
];

const SECTION_IDS: { levelCode: string; sectionName: string }[] = [
  { levelCode: 'S1', sectionName: 'Discipline 1' },
  { levelCode: 'S2', sectionName: 'Integrity 1' },
];

async function main() {
  const svc = createServiceClient();

  // 1. Parse every real workbook.
  const sheets = SUBJECT_FILES.flatMap(({ file, subjectCode }) =>
    parseGradingWorkbook(join(DIR, file), subjectCode)
  );

  // 2. Build the roster lookup for Discipline 1 + Integrity 1.
  const { data: ay, error: ayErr } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY_CODE)
    .single();
  if (ayErr) throw ayErr;

  const { data: sections, error: sectionsErr } = await svc
    .from('sections')
    .select('id, name, levels!inner(code)')
    .eq('academic_year_id', (ay as any).id)
    .in(
      'name',
      SECTION_IDS.map((s) => s.sectionName)
    );
  if (sectionsErr) throw sectionsErr;

  const sectionIdsByName = new Map<string, string>();
  for (const s of sections ?? [])
    sectionIdsByName.set((s as any).name, (s as any).id);

  const rosterLookup: RosterLookupEntry[] = [];
  for (const { levelCode, sectionName } of SECTION_IDS) {
    const sectionId = sectionIdsByName.get(sectionName);
    if (!sectionId) {
      throw new Error(
        `gen-ay2026-t1-grading: section "${sectionName}" not found for ${AY_CODE}`
      );
    }
    const { data: rows, error: rowsErr } = await svc
      .from('section_students')
      .select('id, index_number')
      .eq('section_id', sectionId);
    if (rowsErr) throw rowsErr;
    for (const r of rows ?? []) {
      rosterLookup.push({
        levelCode,
        sectionName,
        indexNumber: (r as any).index_number,
        sectionStudentId: (r as any).id,
      });
    }
  }

  // 3. Compose.
  const result = buildGradingImport({
    sheets,
    rosterLookup,
    ayCode: AY_CODE,
    termNumber: TERM_NUMBER,
  });

  writeFileSync(
    'scripts/backfill/ay2026-t1-grading-preview.sql',
    result.preview
  );
  writeFileSync('scripts/backfill/ay2026-t1-grading-apply.sql', result.apply);

  console.log('Stats:', JSON.stringify(result.stats, null, 2));
  console.log('Wrote scripts/backfill/ay2026-t1-grading-preview.sql');
  console.log('Wrote scripts/backfill/ay2026-t1-grading-apply.sql');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
