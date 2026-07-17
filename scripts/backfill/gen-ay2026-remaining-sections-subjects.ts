// scripts/backfill/gen-ay2026-remaining-sections-subjects.ts
// Attaches real subjects to the AY2026 sections Phase 3 never touched: the
// 15 Primary sections and the 4 "Regular"-track Secondary sections
// (Discipline 2, Integrity 2, Consistency, Excellence — as opposed to
// Discipline 1/Integrity 1, the "Global Class" sections Phase 3 already
// covered). Emits SQL for review — does NOT write to the database itself.
//
// Every subject/weight/section mapping below was read directly from the
// real T2 "GRADES" folder workbooks' tab names and header rows (Term 2,
// not Term 1 — no real T1 data exists for these sections/subjects, this
// script only attaches CONFIGURATION, it does not import any grades) —
// never assumed from the Structure Defaults template. Two real corrections
// this makes vs. an earlier template-sourced backfill:
//   - SS (Social Studies): real weight is 30/50/20, not the template's
//     40/40/20 — corrected here. Also real data shows SS is offered ONLY
//     at Secondary S3/S4 ("SS & Geo"), not at any Primary level — the
//     earlier backfill wrongly attached it to P1-P6; removed here.
//   - CL (Christian Living): left untouched — no evidence in any T1/T2
//     workbook of it being graded via WW/PT/QA at any level. Not attached
//     to anything by this script.
//
// Run: npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-remaining-sections-subjects.ts
import { writeFileSync } from 'node:fs';

import { createServiceClient } from '../../lib/supabase/service';
import { sqlString } from '../../lib/sis/backfill/enrollment/sql-escape';

const AY_CODE = 'AY2026';

// Subjects genuinely universal to every Primary section (Global + Regular).
const PRIMARY_ALL = ['ENG', 'MATH', 'SCI', 'MAPEH'];
// Mother tongue splits by track — never both on the same section.
const PRIMARY_GLOBAL_SECTIONS = [
  'Patience',
  'Honesty',
  'Courtesy',
  'Diligence',
  'Commitment',
];
const PRIMARY_REGULAR_SECTIONS = [
  'Obedience',
  'Humility',
  'Courageous',
  'Responsibility',
  'Trust',
  'Tenacity',
  'Perseverance',
  'Loyalty',
  'Grit',
];

const SECONDARY_REGULAR_S1S2_SECTIONS = ['Discipline 2', 'Integrity 2'];
const SECONDARY_REGULAR_S1S2_SUBJECTS = [
  'ENG',
  'SCI',
  'MATH',
  'CA',
  'LIT',
  'PEH',
  'FIL',
  'HIST',
];
const SECONDARY_REGULAR_S3S4_SECTIONS = ['Consistency', 'Excellence'];
const SECONDARY_REGULAR_S3S4_SUBJECTS = [
  'ENG',
  'SCI',
  'MATH',
  'CA',
  'LIT',
  'PEH',
  'FIL',
  'SS',
];

// New/corrected subject_configs, sourced from real T2 workbook headers
// (Contemporary Arts, Literature, History, Social Studies & Geography).
// Slot counts/qa_max use the template's values (5/5/30, consistent across
// nearly every subject in the catalog) since those are just defaults for
// grading_sheets this script does not create — only the WW/PT/QA weight
// percentages were verified against real data.
const REAL_SUBJECT_CONFIGS: {
  code: string;
  ww: number;
  pt: number;
  qa: number;
}[] = [
  { code: 'CA', ww: 0.3, pt: 0.5, qa: 0.2 },
  { code: 'LIT', ww: 0.3, pt: 0.5, qa: 0.2 },
  { code: 'HIST', ww: 0.3, pt: 0.5, qa: 0.2 },
  { code: 'SS', ww: 0.3, pt: 0.5, qa: 0.2 }, // correction: template had 0.4/0.4/0.2
];

async function main() {
  const svc = createServiceClient();

  const { data: ay, error: ayErr } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY_CODE)
    .single();
  if (ayErr) throw ayErr;
  const ayId = (ay as any).id;

  const { data: levels, error: levelsErr } = await svc
    .from('levels')
    .select('id, code, level_type');
  if (levelsErr) throw levelsErr;
  const primaryLevelIds = (levels ?? [])
    .filter((l: any) => l.level_type === 'primary')
    .map((l: any) => l.id);

  const { data: sections, error: sectionsErr } = await svc
    .from('sections')
    .select('id, name, level_id, levels(code)')
    .eq('academic_year_id', ayId);
  if (sectionsErr) throw sectionsErr;

  const sectionByName = new Map((sections ?? []).map((s: any) => [s.name, s]));

  // --- Build the per-section subject list ---
  const sectionSubjectPairs: { sectionName: string; subjectCode: string }[] =
    [];

  for (const s of sections ?? []) {
    const sec: any = s;
    if (!primaryLevelIds.includes(sec.level_id)) continue; // handle Primary here
    for (const code of PRIMARY_ALL) {
      sectionSubjectPairs.push({ sectionName: sec.name, subjectCode: code });
    }
    if (PRIMARY_GLOBAL_SECTIONS.includes(sec.name)) {
      sectionSubjectPairs.push({
        sectionName: sec.name,
        subjectCode: 'MANDARIN',
      });
    } else if (PRIMARY_REGULAR_SECTIONS.includes(sec.name)) {
      sectionSubjectPairs.push({ sectionName: sec.name, subjectCode: 'FIL' });
    }
  }
  for (const name of SECONDARY_REGULAR_S1S2_SECTIONS) {
    for (const code of SECONDARY_REGULAR_S1S2_SUBJECTS) {
      sectionSubjectPairs.push({ sectionName: name, subjectCode: code });
    }
  }
  for (const name of SECONDARY_REGULAR_S3S4_SECTIONS) {
    for (const code of SECONDARY_REGULAR_S3S4_SUBJECTS) {
      sectionSubjectPairs.push({ sectionName: name, subjectCode: code });
    }
  }

  // Sanity check: every referenced section name must exist for this AY.
  const missingSections = [
    ...new Set(sectionSubjectPairs.map((p) => p.sectionName)),
  ].filter((name) => !sectionByName.has(name));
  if (missingSections.length > 0) {
    throw new Error(
      `gen-ay2026-remaining-sections-subjects: section(s) not found for ${AY_CODE}: ${missingSections.join(', ')}`
    );
  }

  // --- subject_level_offerings needed (derive from the section pairs) ---
  const offeringPairs = new Map<
    string,
    { subjectCode: string; levelCode: string }
  >();
  for (const p of sectionSubjectPairs) {
    const sec: any = sectionByName.get(p.sectionName);
    const levelCode = sec.levels.code;
    offeringPairs.set(`${p.subjectCode}::${levelCode}`, {
      subjectCode: p.subjectCode,
      levelCode,
    });
  }

  const preview: string[] = [];
  preview.push(
    '-- AY2026 remaining sections/subjects attachment — PREVIEW (read-only)'
  );
  preview.push('--');
  preview.push(
    '-- Generated by gen-ay2026-remaining-sections-subjects.ts from real T2'
  );
  preview.push(
    '-- workbook tab names/headers. Attaches CONFIGURATION only (subjects to'
  );
  preview.push(
    '-- sections) — does NOT import any grade data for these sections.'
  );
  preview.push('--');
  preview.push('-- New/corrected subject_configs (real T2 header data):');
  for (const c of REAL_SUBJECT_CONFIGS) {
    preview.push(
      `--   ${c.code}: ww=${c.ww} pt=${c.pt} qa=${c.qa}${c.code === 'SS' ? '  <-- corrects the template-sourced 0.4/0.4/0.2 written earlier' : ''}`
    );
  }
  preview.push('--');
  preview.push(
    '-- SS removed from these Primary levels (was wrongly template-sourced):'
  );
  preview.push('--   P1, P2, P3, P4, P5, P6');
  preview.push('--');
  preview.push(
    `-- subject_level_offerings to add/ensure (${offeringPairs.size}):`
  );
  for (const o of [...offeringPairs.values()].sort((a, b) =>
    (a.subjectCode + a.levelCode).localeCompare(b.subjectCode + b.levelCode)
  )) {
    preview.push(`--   ${o.subjectCode} × ${o.levelCode}`);
  }
  preview.push('--');
  preview.push(
    `-- section_subjects to add (${sectionSubjectPairs.length}), by section:`
  );
  const bySection = new Map<string, string[]>();
  for (const p of sectionSubjectPairs) {
    bySection.set(p.sectionName, [
      ...(bySection.get(p.sectionName) ?? []),
      p.subjectCode,
    ]);
  }
  for (const [name, codes] of bySection) {
    preview.push(`--   ${name}: ${codes.sort().join(', ')}`);
  }

  const apply: string[] = [];
  apply.push(
    '-- AY2026 remaining sections/subjects attachment — APPLY (transactional)'
  );
  apply.push('--');
  apply.push('-- RUN ay2026-remaining-sections-subjects-preview.sql FIRST.');
  apply.push(
    '-- Generated by gen-ay2026-remaining-sections-subjects.ts — do not hand-edit; regenerate instead.'
  );
  apply.push('--');
  apply.push('begin;');
  apply.push('');

  // 1) New/corrected subject_configs (CA, LIT, HIST new; SS corrected).
  apply.push('drop table if exists _ay26rem_configs;');
  apply.push(
    'create temp table _ay26rem_configs (subject_code, ww_weight, pt_weight, qa_weight) as'
  );
  apply.push('values');
  apply.push(
    REAL_SUBJECT_CONFIGS.map(
      (c) => `  (${sqlString(c.code)}, ${c.ww}, ${c.pt}, ${c.qa})`
    ).join(',\n') + ';'
  );
  apply.push('');
  apply.push(
    'insert into subject_configs (academic_year_id, subject_id, ww_weight, pt_weight, qa_weight, ww_max_slots, pt_max_slots, qa_max, weights_confirmed)'
  );
  apply.push(
    'select ay.id, sub.id, c.ww_weight, c.pt_weight, c.qa_weight, 5, 5, 30, true'
  );
  apply.push('from _ay26rem_configs c');
  apply.push(`join academic_years ay on ay.ay_code = ${sqlString(AY_CODE)}`);
  apply.push('join subjects sub on sub.code = c.subject_code');
  apply.push('on conflict (academic_year_id, subject_id) do update set');
  apply.push('  ww_weight = excluded.ww_weight,');
  apply.push('  pt_weight = excluded.pt_weight,');
  apply.push('  qa_weight = excluded.qa_weight,');
  apply.push('  weights_confirmed = excluded.weights_confirmed;');
  apply.push('');

  // 2) Remove the wrongly-offered SS-at-Primary rows.
  apply.push(
    '-- Remove SS wrongly offered at Primary (template-sourced error; real'
  );
  apply.push('-- data shows SS is Secondary S3/S4 only).');
  apply.push('delete from subject_level_offerings slo');
  apply.push('using academic_years ay, subjects sub, levels lvl');
  apply.push(`where ay.ay_code = ${sqlString(AY_CODE)}`);
  apply.push("  and sub.code = 'SS'");
  apply.push("  and lvl.level_type = 'primary'");
  apply.push('  and slo.academic_year_id = ay.id');
  apply.push('  and slo.subject_id = sub.id');
  apply.push('  and slo.level_id = lvl.id;');
  apply.push('');

  // 3) subject_level_offerings.
  apply.push('drop table if exists _ay26rem_offerings;');
  apply.push(
    'create temp table _ay26rem_offerings (subject_code, level_code) as'
  );
  apply.push('values');
  apply.push(
    [...offeringPairs.values()]
      .map((o) => `  (${sqlString(o.subjectCode)}, ${sqlString(o.levelCode)})`)
      .join(',\n') + ';'
  );
  apply.push('');
  apply.push(
    'insert into subject_level_offerings (academic_year_id, subject_id, level_id)'
  );
  apply.push('select ay.id, sub.id, lvl.id');
  apply.push('from _ay26rem_offerings o');
  apply.push(`join academic_years ay on ay.ay_code = ${sqlString(AY_CODE)}`);
  apply.push('join subjects sub on sub.code = o.subject_code');
  apply.push('join levels lvl on lvl.code = o.level_code');
  apply.push(
    'on conflict (subject_id, level_id, academic_year_id) do nothing;'
  );
  apply.push('');

  // 4) section_subjects.
  apply.push('drop table if exists _ay26rem_section_subjects;');
  apply.push(
    'create temp table _ay26rem_section_subjects (section_name, subject_code) as'
  );
  apply.push('values');
  apply.push(
    sectionSubjectPairs
      .map(
        (p) => `  (${sqlString(p.sectionName)}, ${sqlString(p.subjectCode)})`
      )
      .join(',\n') + ';'
  );
  apply.push('');
  apply.push('insert into section_subjects (section_id, subject_config_id)');
  apply.push('select distinct sec.id, sc.id');
  apply.push('from _ay26rem_section_subjects ss');
  apply.push(`join academic_years ay on ay.ay_code = ${sqlString(AY_CODE)}`);
  apply.push('join subjects sub on sub.code = ss.subject_code');
  apply.push(
    'join sections sec on sec.academic_year_id = ay.id and sec.name = ss.section_name'
  );
  apply.push(
    'join subject_configs sc on sc.academic_year_id = ay.id and sc.subject_id = sub.id'
  );
  apply.push('on conflict (section_id, subject_config_id) do nothing;');
  apply.push('');
  apply.push('commit;');
  apply.push('');
  apply.push('-- === post-commit verification ===');
  apply.push(
    `select count(*) as subject_configs_rows from subject_configs sc join academic_years ay on ay.id=sc.academic_year_id where ay.ay_code=${sqlString(AY_CODE)};`
  );
  apply.push(
    `select count(*) as subject_level_offerings_rows from subject_level_offerings slo join academic_years ay on ay.id=slo.academic_year_id where ay.ay_code=${sqlString(AY_CODE)};`
  );
  apply.push(
    `select count(*) as section_subjects_rows from section_subjects ss join sections sec on sec.id=ss.section_id join academic_years ay on ay.id=sec.academic_year_id where ay.ay_code=${sqlString(AY_CODE)};`
  );

  writeFileSync(
    'scripts/backfill/ay2026-remaining-sections-subjects-preview.sql',
    preview.join('\n') + '\n'
  );
  writeFileSync(
    'scripts/backfill/ay2026-remaining-sections-subjects-apply.sql',
    apply.join('\n') + '\n'
  );

  console.log('Sections covered:', bySection.size);
  console.log('section_subjects pairs:', sectionSubjectPairs.length);
  console.log('subject_level_offerings pairs:', offeringPairs.size);
  console.log(
    'Wrote scripts/backfill/ay2026-remaining-sections-subjects-preview.sql'
  );
  console.log(
    'Wrote scripts/backfill/ay2026-remaining-sections-subjects-apply.sql'
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
