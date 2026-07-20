// scripts/backfill/gen-ay2026-t2-writeups.ts
// Generates ay2026-t2-writeups-{preview,apply}.sql from HFSE's real T2
// Consolidated Form. Emits SQL for review — does NOT write to the
// database itself. See:
// docs/superpowers/specs/2026-07-20-ay2026-t2-evaluation-writeups-import-design.md
//
// Run: npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t2-writeups.ts
import { writeFileSync } from 'node:fs';

import { createServiceClient } from '../../lib/supabase/service';
import { parseConsolidatedWriteups } from '../../lib/sis/backfill/evaluation/parse-consolidated-writeups';
import { buildWriteupsImport } from '../../lib/sis/backfill/evaluation/build-writeups-import';
import type { RosterLookupEntry } from '../../lib/sis/backfill/evaluation/build-writeups-import';

const AY_CODE = 'AY2026';
const TERM_NUMBER = 2;
const SOURCE_FILE = 'AY2026/T2/Term 2 CONSOLIDATED FORM.xlsx';

async function main() {
  const svc = createServiceClient();

  const parsed = parseConsolidatedWriteups(SOURCE_FILE);
  console.log(
    `Parsed: ${parsed.rows.length} write-up row(s) across ${parsed.blankCounts.length} recognized sheet(s), ${parsed.unrecognizedSheets.length} unrecognized sheet(s)`
  );
  for (const b of parsed.blankCounts) {
    console.log(
      `  ${b.levelCode} ${b.sectionName}: ${b.blankCount} blank cell(s)`
    );
  }
  if (parsed.unrecognizedSheets.length > 0) {
    console.log('  Unrecognized sheets:', parsed.unrecognizedSheets.join(', '));
  }

  // Defensive check (design doc §9): every sheet must resolve to a
  // DISTINCT identity — no two sheets in this file should ever claim the
  // same section. This file has no known collision risk (unlike the
  // grading workbooks' multi-file Reserved-tab bug), but the assertion is
  // free insurance earned by that bug's three fix rounds.
  const seen = new Set<string>();
  for (const b of parsed.blankCounts) {
    const key = `${b.levelCode}::${b.sectionName}`;
    if (seen.has(key)) {
      throw new Error(
        `Duplicate section identity "${key}" across sheets — investigate before proceeding.`
      );
    }
    seen.add(key);
  }
  console.log(`Distinct section identities: ${seen.size}`);

  const { data: ay, error: ayErr } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY_CODE)
    .single();
  if (ayErr) throw ayErr;

  const { data: term, error: termErr } = await svc
    .from('terms')
    .select('id, end_date')
    .eq('academic_year_id', (ay as any).id)
    .eq('term_number', TERM_NUMBER)
    .single();
  if (termErr) throw termErr;

  const { data: rows, error: rowsErr } = await svc
    .from('section_students')
    .select(
      'student_id, section_id, index_number, sections!inner(name, academic_year_id, levels!inner(code))'
    )
    .eq('sections.academic_year_id', (ay as any).id)
    .neq('enrollment_status', 'withdrawn');
  if (rowsErr) throw rowsErr;

  const rosterLookup: RosterLookupEntry[] = (rows ?? []).map((r: any) => ({
    levelCode: r.sections.levels.code,
    sectionName: r.sections.name,
    indexNumber: r.index_number,
    studentId: r.student_id,
    sectionId: r.section_id,
  }));

  const result = buildWriteupsImport({
    rows: parsed.rows,
    blankCounts: parsed.blankCounts,
    rosterLookup,
    termId: (term as any).id,
    submittedAt: (term as any).end_date,
  });

  writeFileSync(
    'scripts/backfill/ay2026-t2-writeups-preview.sql',
    result.preview
  );
  writeFileSync('scripts/backfill/ay2026-t2-writeups-apply.sql', result.apply);

  console.log('Stats:', JSON.stringify(result.stats, null, 2));
  console.log('Wrote scripts/backfill/ay2026-t2-writeups-preview.sql');
  console.log('Wrote scripts/backfill/ay2026-t2-writeups-apply.sql');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
