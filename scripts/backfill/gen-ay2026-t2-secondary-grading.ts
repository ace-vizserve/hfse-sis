// scripts/backfill/gen-ay2026-t2-secondary-grading.ts
// Generates ay2026-t2-secondary-grading-{preview,apply}.sql from HFSE's
// real T2 Secondary grading workbooks — Regular track ("GRADES/" folder)
// and Global track ("Lower Secondary Global Grading Sheets/" folder).
// Emits SQL for review — does NOT write to the database itself. See:
// docs/superpowers/specs/2026-07-19-ay2026-t2-secondary-grading-import-design.md
//
// Run: npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t2-secondary-grading.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createServiceClient } from '../../lib/supabase/service';
import { parseGradingWorkbookSecondaryT2 } from '../../lib/sis/backfill/grading/grading-workbook-secondary-t2';
import { parseGradingWorkbookGlobalT2 } from '../../lib/sis/backfill/grading/grading-workbook-global-t2';
import { buildSecondaryGradingImport } from '../../lib/sis/backfill/grading/build-secondary-grading-import';
import { dedupePreferringNonReservedTab } from '../../lib/sis/backfill/grading/t2-masthead';
import type {
  RosterLookupEntry,
  SubjectConfigWeight,
} from '../../lib/sis/backfill/grading/build-secondary-grading-import';
import type { ParsedSubjectSheet } from '../../lib/sis/backfill/grading/grading-workbook';

const AY_CODE = 'AY2026';
const TERM_NUMBER = 2;

// --- Regular track: "GRADES/" folder ---
// Never Filipino (its S1-S4 tabs are structurally incomplete — see design
// doc §2 Locked Decision #1), never Mandarin or STAR/MAPEH (no Secondary
// tabs exist in either file at all), never CCA (activity-rostered, not
// section-rostered — see design doc §1 point 3, out of scope this phase).
const REGULAR_DIR = 'AY2026/T2/Term 2 Grades/GRADES';
const REGULAR_SUBJECT_FILES: { file: string; subjectCode: string }[] = [
  { file: 'Math Grading AY2026 T2.xlsx', subjectCode: 'MATH' },
  { file: 'English Grading AY2026 T2.xlsx', subjectCode: 'ENG' },
  { file: 'Science Grading AY2026 T2.xlsx', subjectCode: 'SCI' },
  { file: 'Literature Grading AY2026 T2.xlsx', subjectCode: 'LIT' },
  { file: 'History Grading AY2026 T2.xlsx', subjectCode: 'HIST' }, // S1/S2 only, per the real file
  { file: 'SS & Geo Grading AY2026 T2.xlsx', subjectCode: 'SS' }, // S3/S4 only, per the real file
  { file: 'Contemporary Arts Grading AY2026 T2.xlsx', subjectCode: 'CA' },
  { file: 'PE (Sec) Grading AY2026 T2.xlsx', subjectCode: 'PEH' },
];

// --- Global track: "Lower Secondary Global Grading Sheets/" folder ---
// Explicit file list — never a directory glob. "Copy of English/Science/
// Mathematics..." are corrupted duplicates (same standing exclusion
// policy as every prior phase) and must never be read.
const GLOBAL_DIR =
  'AY2026/T2/Term 2 Grades/Lower Secondary Global Grading Sheets';
const GLOBAL_SUBJECT_FILES: { file: string; subjectCode: string }[] = [
  {
    file: 'Art and Design Grading Sheet Global Class AY2026 T2.xlsx',
    subjectCode: 'ARTD',
  },
  {
    file: 'Computing Grading Sheet Global Class AY2026 T2.xlsx',
    subjectCode: 'COMP',
  },
  {
    file: 'English Grading Sheet Global Class AY2026 T2.xlsx',
    subjectCode: 'ENG',
  },
  {
    file: 'Global Perspectives Grading Sheet Global Class AY2026 T2.xlsx',
    subjectCode: 'GP',
  },
  {
    file: 'Humanities Grading Sheet Global Class AY2026 T2.xlsx',
    subjectCode: 'HUM',
  },
  {
    file: 'Mathematics Grading Sheet Global Class AY2026 T2.xlsx',
    subjectCode: 'MATH',
  },
  {
    file: 'PE and Health Grading Sheet Global Class AY2026 T2.xlsx',
    subjectCode: 'PEH',
  },
  {
    file: 'Science Grading Sheet Global Class AY2026 T2.xlsx',
    subjectCode: 'SCI',
  },
];

// Hand-verified during design (docs/superpowers/specs/2026-07-19-ay2026-t2-secondary-grading-import-design.md
// §2 Locked Decision #5): every relevant subject is already correct and
// already weights_confirmed=true. Empty on purpose — NOT derived at
// generation time, and NOT simply omitted from the composer call (the
// composer must correctly handle this empty-but-real input, per Task 4).
const SUBJECT_CONFIG_WEIGHTS: SubjectConfigWeight[] = [];

function buildNotesSection(
  heading: string,
  docPointer: string,
  notes: string[]
): string {
  const lines: string[] = [];
  lines.push('--');
  lines.push(`-- ${heading} (${notes.length}):`);
  lines.push(`-- (${docPointer})`);
  if (notes.length === 0) lines.push('--   (none)');
  for (const n of notes) lines.push(`--   ${n}`);
  return lines.join('\n') + '\n';
}

async function main() {
  const svc = createServiceClient();

  const candidates: { sheetName: string; sheet: ParsedSubjectSheet }[] = [];
  let allIdentityCorrections: string[] = [];
  let allTruncationNotes: string[] = [];

  // 1. Regular track.
  for (const { file, subjectCode } of REGULAR_SUBJECT_FILES) {
    const result = parseGradingWorkbookSecondaryT2(
      join(REGULAR_DIR, file),
      subjectCode
    );
    for (let i = 0; i < result.sheets.length; i++) {
      candidates.push({
        sheetName: result.sheetNames[i],
        sheet: result.sheets[i],
      });
    }
    allIdentityCorrections = allIdentityCorrections.concat(
      result.identityCorrections
    );
    allTruncationNotes = allTruncationNotes.concat(result.truncationNotes);
    console.log(
      `[Regular] ${file}: ${result.sheets.length} Secondary sheet(s), skipped ${result.skippedPrimary.length} Primary + ${result.skippedUnrecognized.length} unrecognized, ${result.identityCorrections.length} correction(s), ${result.truncationNotes.length} truncation(s)`
    );
  }

  // 2. Global track.
  for (const { file, subjectCode } of GLOBAL_SUBJECT_FILES) {
    const result = parseGradingWorkbookGlobalT2(
      join(GLOBAL_DIR, file),
      subjectCode
    );
    for (let i = 0; i < result.sheets.length; i++) {
      candidates.push({
        sheetName: result.sheetNames[i],
        sheet: result.sheets[i],
      });
    }
    allIdentityCorrections = allIdentityCorrections.concat(
      result.identityCorrections
    );
    allTruncationNotes = allTruncationNotes.concat(result.truncationNotes);
    console.log(
      `[Global] ${file}: ${result.sheets.length} Secondary sheet(s), skipped ${result.skippedDoNotUse.length} DO-NOT-USE + ${result.skippedUnrecognized.length} unrecognized, ${result.identityCorrections.length} correction(s), ${result.truncationNotes.length} truncation(s)`
    );
  }

  // 3. Cross-file, cross-track dedup — the ONLY place a Regular-track
  // Reserved tab colliding with a Global-track real tab (or vice versa)
  // is visible, since every parser above only ever sees one file at a
  // time.
  const { kept: sheets, duplicateNotes: allDuplicateIdentityNotes } =
    dedupePreferringNonReservedTab(candidates);

  // 4. Build the roster lookup for AY2026's Secondary sections.
  const { data: ay, error: ayErr } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY_CODE)
    .single();
  if (ayErr) throw ayErr;

  const { data: rows, error: rowsErr } = await svc
    .from('section_students')
    .select(
      'id, index_number, sections!inner(name, academic_year_id, levels!inner(code, level_type))'
    )
    .eq('sections.academic_year_id', (ay as any).id)
    .eq('sections.levels.level_type', 'secondary');
  if (rowsErr) throw rowsErr;

  const rosterLookup: RosterLookupEntry[] = (rows ?? []).map((r: any) => ({
    levelCode: r.sections.levels.code,
    sectionName: r.sections.name,
    indexNumber: r.index_number,
    sectionStudentId: r.id,
  }));

  // 5. Compose.
  const result = buildSecondaryGradingImport({
    sheets,
    rosterLookup,
    subjectConfigWeights: SUBJECT_CONFIG_WEIGHTS,
    ayCode: AY_CODE,
    termNumber: TERM_NUMBER,
  });

  const finalPreview =
    result.preview +
    '\n' +
    buildNotesSection(
      'Identity corrections — tab name overrode a conflicting row 2 label',
      'see design doc §1 point 2 for why row 2 alone is not trustworthy',
      allIdentityCorrections
    ) +
    '\n' +
    buildNotesSection(
      "Tab name truncated — row 2's fuller label used instead",
      'see design doc §1 point 2 for the Excel 31-char sheet-name limit case',
      allTruncationNotes
    ) +
    '\n' +
    buildNotesSection(
      'Duplicate tabs — identical identity, empty duplicate dropped',
      'see design doc §1 point 2 and the Task 7 amendment for the cross-file Reserved-tab collision case',
      allDuplicateIdentityNotes
    );

  writeFileSync(
    'scripts/backfill/ay2026-t2-secondary-grading-preview.sql',
    finalPreview
  );
  writeFileSync(
    'scripts/backfill/ay2026-t2-secondary-grading-apply.sql',
    result.apply
  );

  console.log('Stats:', JSON.stringify(result.stats, null, 2));
  console.log(
    `Identity corrections: ${allIdentityCorrections.length}, truncation notes: ${allTruncationNotes.length}`
  );
  console.log('Wrote scripts/backfill/ay2026-t2-secondary-grading-preview.sql');
  console.log('Wrote scripts/backfill/ay2026-t2-secondary-grading-apply.sql');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
