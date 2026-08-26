// scripts/probe-existing-teacher-evidence.ts
//
// Read-only. Answers two staffing questions from data the school has already
// entered, so they do not have to be asked:
//
//   1. WHO ADVISES SEC 4 EXCELLENCE? The deployment workbook says
//      "Ms Med & Ms Elaine" and the schema allows one form adviser per section.
//      `evaluation_writeups.created_by` names whoever wrote each form-class-
//      adviser comment — that is the adviser doing the adviser's job.
//
//   2. WHOSE GRADING SHEET IS IT? Four class+subjects are shared between two
//      teachers across different days (Sec 3 and Sec 4 Humanities, P2 Humility
//      and P4 Diligence STAR). `grading_sheets.teacher_name` is free text the
//      school itself put on the sheet, so it is their answer, not ours.
//
// ⚠ BOTH ANSWERS CAN BE WORTHLESS, AND THE SCRIPT SAYS SO RATHER THAN LETTING
// YOU ASSUME. AY2026's write-ups and grading sheets were BACKFILLED by scripts
// in scripts/backfill/, which run as the service role. If a backfill stamped
// `created_by` with the operator (or left it null), the column records who ran
// the import and not who advises the class. So every row prints its AY and the
// distinct values are shown — one value across a whole section is a signal, and
// a value identical across EVERY section is the tell that it is an artefact.
//
// Run:
//   npx tsx --env-file=.env.local scripts/probe-existing-teacher-evidence.ts
import { createServiceClient } from '../lib/supabase/service';
import { listAllAuthUsers } from '../lib/supabase/paginate';

const SHARED_SUBJECTS: { section: string; level: string; code: string }[] = [
  { section: 'Consistency', level: 'S3', code: 'HUM' },
  { section: 'Excellence', level: 'S4', code: 'HUM' },
  { section: 'Humility', level: 'P2', code: 'MAPEH' },
  { section: 'Diligence', level: 'P4', code: 'MAPEH' },
];

async function main() {
  const service = createServiceClient();

  const users = await listAllAuthUsers(service);
  const nameById = new Map(
    users.map((u) => [
      u.id,
      `${(u.user_metadata as { display_name?: string })?.display_name ?? '(no name)'} <${u.email ?? '?'}>`,
    ])
  );

  const { data: ays } = await service
    .from('academic_years')
    .select('id, ay_code')
    .order('ay_code');
  const ayById = new Map((ays ?? []).map((a) => [a.id, a.ay_code as string]));

  const { data: sections } = await service
    .from('sections')
    .select('id, name, academic_year_id, levels(code)');
  type Sec = {
    id: string;
    name: string;
    academic_year_id: string;
    levels: { code: string } | { code: string }[] | null;
  };
  const secs = (sections ?? []) as unknown as Sec[];
  const levelOf = (s: Sec) =>
    (Array.isArray(s.levels) ? s.levels[0] : s.levels)?.code ?? '??';

  // ── 1. Who writes the form-adviser comments? ───────────────────────────
  console.log('═══ 1. FCA WRITE-UP AUTHORS ═══');
  console.log('   (blank created_by = backfilled without an author)\n');

  const { data: writeups } = await service
    .from('evaluation_writeups')
    .select('section_id, created_by, terms!inner(academic_year_id)');

  const authorsBySection = new Map<string, Map<string, number>>();
  for (const row of writeups ?? []) {
    const r = row as unknown as {
      section_id: string;
      created_by: string | null;
    };
    const m = authorsBySection.get(r.section_id) ?? new Map<string, number>();
    const key = r.created_by ?? '(null)';
    m.set(key, (m.get(key) ?? 0) + 1);
    authorsBySection.set(r.section_id, m);
  }

  if (authorsBySection.size === 0) {
    console.log(
      '   No write-ups at all. This question cannot be answered here.'
    );
  }
  for (const [sectionId, authors] of authorsBySection) {
    const sec = secs.find((s) => s.id === sectionId);
    if (!sec) continue;
    const ay = ayById.get(sec.academic_year_id) ?? '????';
    const label = `${ay} ${levelOf(sec)} ${sec.name}`;
    const parts = [...authors.entries()].map(
      ([id, n]) =>
        `${id === '(null)' ? '(no author recorded)' : (nameById.get(id) ?? id)} ×${n}`
    );
    // Sec 4 Excellence is the one being asked about; flag it.
    const mark = /Excellence/i.test(sec.name) ? ' ←' : '  ';
    console.log(`  ${mark} ${label.padEnd(28)} ${parts.join('  |  ')}`);
  }

  // ── 2. Whose name is on the shared grading sheets? ─────────────────────
  console.log('\n═══ 2. TEACHER NAME ON THE SHARED GRADING SHEETS ═══');
  console.log(
    '   (the four class+subjects the workbook splits between two people)\n'
  );

  const { data: subjects } = await service.from('subjects').select('id, code');
  const subjectIdByCode = new Map(
    (subjects ?? []).map((s: { id: string; code: string }) => [s.code, s.id])
  );

  for (const want of SHARED_SUBJECTS) {
    const subjectId = subjectIdByCode.get(want.code);
    const matching = secs.filter(
      (s) =>
        s.name.toLowerCase() === want.section.toLowerCase() &&
        levelOf(s) === want.level
    );
    console.log(`  ${want.level} ${want.section} — ${want.code}`);
    if (!subjectId || matching.length === 0) {
      console.log('     no such section or subject in this project');
      continue;
    }
    for (const sec of matching) {
      const ay = ayById.get(sec.academic_year_id) ?? '????';
      const { data: sheets } = await service
        .from('grading_sheets')
        .select('teacher_name, terms!inner(term_number, academic_year_id)')
        .eq('section_id', sec.id)
        .eq('subject_id', subjectId);
      const names = new Map<string, number>();
      for (const row of sheets ?? []) {
        const r = row as unknown as { teacher_name: string | null };
        const key = r.teacher_name?.trim() || '(blank)';
        names.set(key, (names.get(key) ?? 0) + 1);
      }
      if (names.size === 0) {
        console.log(`     ${ay}: no grading sheets`);
        continue;
      }
      const parts = [...names.entries()].map(([n, c]) => `${n} ×${c}`);
      console.log(`     ${ay}: ${parts.join('  |  ')}`);
    }
  }

  console.log(
    '\n⚠ Before trusting either answer: if one value repeats across EVERY\n' +
      '  section, it is an import artefact, not a staffing fact.'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
