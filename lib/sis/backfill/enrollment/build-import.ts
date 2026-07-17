// lib/sis/backfill/enrollment/build-import.ts
// Composes the pure enrollment/name-match modules into the two SQL files
// described by the design doc: a read-only preview report and a
// transactional, idempotent apply script. No I/O — takes already-parsed
// sections and an already-fetched candidate pool.
import {
  matchName,
  parseSheetFullName,
  type CandidateName,
  type MatchTier,
} from './name-match';
import { deriveSectionIdentity } from './section-identity';
import { sqlString, sqlStringOrNull } from './sql-escape';
import type { ParsedSection } from './attendance-workbook';

export interface BuildImportInput {
  sections: ParsedSection[];
  candidates: CandidateName[];
  ayCode: string;
  termNumber: number;
  termStart: string;
  termEnd: string;
}

interface MatchedRow {
  levelCode: string;
  cleanName: string;
  indexNumber: number;
  candidate: CandidateName;
  tier: MatchTier;
}

interface NeedsReviewRow {
  levelCode: string;
  cleanName: string;
  sheetFullName: string;
  reason: string;
}

interface SectionMetaEntry {
  levelCode: string;
  cleanName: string;
  formTeacher: string | null;
}

export interface BuildImportResult {
  preview: string;
  apply: string;
  stats: {
    exact: number;
    strong: number;
    fuzzy: number;
    needsReview: number;
    sectionsCreated: number;
    excludedYs: string[];
    unrecognized: string[];
    skippedEmpty: string[];
  };
}

export function buildEnrollmentImport(
  input: BuildImportInput
): BuildImportResult {
  const matched: MatchedRow[] = [];
  const needsReview: NeedsReviewRow[] = [];
  const excludedYs: string[] = [];
  const unrecognized: string[] = [];
  const skippedEmpty: string[] = [];
  const sectionMeta = new Map<string, SectionMetaEntry>();

  for (const section of input.sections) {
    if (section.students.length === 0) {
      skippedEmpty.push(section.sheetName);
      continue;
    }
    const identity = deriveSectionIdentity(section.sheetName);
    if (identity.kind === 'ys') {
      excludedYs.push(section.sheetName);
      continue;
    }
    if (identity.kind === 'unrecognized') {
      unrecognized.push(section.sheetName);
      continue;
    }

    const key = `${identity.levelCode}::${identity.cleanName}`;
    if (!sectionMeta.has(key)) {
      sectionMeta.set(key, {
        levelCode: identity.levelCode,
        cleanName: identity.cleanName,
        formTeacher: section.formTeacher,
      });
    }

    for (const student of section.students) {
      const sheetName = parseSheetFullName(student.fullName);
      const result = matchName(sheetName, input.candidates);
      const indexNumber = Number.parseInt(student.indexNo, 10);

      if (result.tier === 'none' || !result.candidate) {
        needsReview.push({
          levelCode: identity.levelCode,
          cleanName: identity.cleanName,
          sheetFullName: student.fullName,
          reason: 'no confident match',
        });
        continue;
      }
      if (!Number.isFinite(indexNumber) || indexNumber <= 0) {
        needsReview.push({
          levelCode: identity.levelCode,
          cleanName: identity.cleanName,
          sheetFullName: student.fullName,
          reason: `unparseable index number "${student.indexNo}"`,
        });
        continue;
      }
      if (!result.candidate.studentNumber) {
        needsReview.push({
          levelCode: identity.levelCode,
          cleanName: identity.cleanName,
          sheetFullName: student.fullName,
          reason: `matched ${result.candidate.enroleeNumber} but it has no studentNumber`,
        });
        continue;
      }
      matched.push({
        levelCode: identity.levelCode,
        cleanName: identity.cleanName,
        indexNumber,
        candidate: result.candidate,
        tier: result.tier,
      });
    }
  }

  // Dup-claim detection: the same enroleeNumber matched from >1 roster row.
  const byEnrolee = new Map<string, MatchedRow[]>();
  for (const row of matched) {
    const list = byEnrolee.get(row.candidate.enroleeNumber) ?? [];
    list.push(row);
    byEnrolee.set(row.candidate.enroleeNumber, list);
  }
  const finalMatched: MatchedRow[] = [];
  for (const [enroleeNumber, rows] of byEnrolee) {
    if (rows.length > 1) {
      for (const row of rows) {
        needsReview.push({
          levelCode: row.levelCode,
          cleanName: row.cleanName,
          sheetFullName: `${row.candidate.lastName}, ${row.candidate.firstName}`,
          reason: `duplicate claim on enrolee ${enroleeNumber} (matched from ${rows.length} roster rows)`,
        });
      }
      continue;
    }
    finalMatched.push(rows[0]);
  }

  const stats: BuildImportResult['stats'] = {
    exact: finalMatched.filter((r) => r.tier === 'exact').length,
    strong: finalMatched.filter((r) => r.tier === 'strong').length,
    fuzzy: finalMatched.filter((r) => r.tier === 'fuzzy').length,
    needsReview: needsReview.length,
    sectionsCreated: sectionMeta.size,
    excludedYs,
    unrecognized,
    skippedEmpty,
  };

  return {
    preview: buildPreviewSql(
      input,
      finalMatched,
      needsReview,
      sectionMeta,
      stats
    ),
    apply: buildApplySql(input, finalMatched, sectionMeta),
    stats,
  };
}

function buildPreviewSql(
  input: BuildImportInput,
  matched: MatchedRow[],
  needsReview: NeedsReviewRow[],
  sectionMeta: Map<string, SectionMetaEntry>,
  stats: BuildImportResult['stats']
): string {
  const lines: string[] = [];
  lines.push(
    `-- AY2026 T${input.termNumber} enrollment import — PREVIEW (read-only)`
  );
  lines.push('--');
  lines.push(
    '-- Generated by gen-ay2026-t1-enrollment.ts from the T1 attendance workbook.'
  );
  lines.push(
    '-- Review this report BEFORE running the matching apply.sql file.'
  );
  lines.push('--');
  lines.push(`-- Sections to create: ${sectionMeta.size}`);
  for (const s of sectionMeta.values()) {
    lines.push(
      `--   ${s.levelCode} ${s.cleanName}${s.formTeacher ? ` (${s.formTeacher})` : ''}`
    );
  }
  lines.push('--');
  lines.push(
    `-- Matched students: ${matched.length} (exact=${stats.exact}, strong=${stats.strong}, fuzzy=${stats.fuzzy})`
  );
  lines.push('--');
  lines.push(
    `-- Skipped (empty section tabs): ${stats.skippedEmpty.join(', ') || '(none)'}`
  );
  lines.push(
    `-- Excluded (Youngstarters — level catalog reworked concurrently, resolve separately): ${
      stats.excludedYs.join(', ') || '(none)'
    }`
  );
  lines.push(
    `-- Unrecognized sheet names (needs manual attention): ${stats.unrecognized.join(', ') || '(none)'}`
  );
  lines.push('--');
  lines.push(
    `-- Needs review (${needsReview.length}) — NOT written by apply.sql:`
  );
  if (needsReview.length === 0) lines.push('--   (none)');
  for (const r of needsReview) {
    lines.push(
      `--   [${r.levelCode} ${r.cleanName}] "${r.sheetFullName}" — ${r.reason}`
    );
  }
  return lines.join('\n') + '\n';
}

function buildApplySql(
  input: BuildImportInput,
  matched: MatchedRow[],
  sectionMeta: Map<string, SectionMetaEntry>
): string {
  const statusTable = `ay${input.ayCode.slice(2)}_enrolment_status`;
  const lines: string[] = [];
  lines.push(
    `-- AY2026 T${input.termNumber} enrollment import — APPLY (transactional)`
  );
  lines.push('--');
  lines.push(
    `-- RUN ay2026-t${input.termNumber}-enrollment-preview.sql FIRST.`
  );
  lines.push(
    '-- Generated by gen-ay2026-t1-enrollment.ts — do not hand-edit; regenerate instead.'
  );
  lines.push('--');
  lines.push(
    '-- Run the WHOLE file in one go (one connection/session) — a tool that opens'
  );
  lines.push(
    '-- a new connection per query will silently roll back an uncommitted transaction.'
  );
  lines.push('');
  lines.push('begin;');
  lines.push('');
  lines.push('drop table if exists _ay26_sections;');
  lines.push(
    'create temp table _ay26_sections (level_code, clean_name, form_teacher) as'
  );
  lines.push('values');
  const sectionRows = [...sectionMeta.values()].map(
    (s) =>
      `  (${sqlString(s.levelCode)}, ${sqlString(s.cleanName)}, ${sqlStringOrNull(s.formTeacher)})`
  );
  lines.push(
    (sectionRows.length ? sectionRows.join(',\n') : "  ('', '', NULL)") + ';'
  );
  lines.push('');
  lines.push('drop table if exists _ay26_roster;');
  lines.push(
    'create temp table _ay26_roster (level_code, clean_name, student_number, last_name, first_name, middle_name, index_number, enrolee_number) as'
  );
  lines.push('values');
  const rosterRows = matched.map((r) => {
    const c = r.candidate;
    return `  (${sqlString(r.levelCode)}, ${sqlString(r.cleanName)}, ${sqlString(
      c.studentNumber as string
    )}, ${sqlString(c.lastName)}, ${sqlString(c.firstName)}, ${sqlStringOrNull(
      c.middleName
    )}, ${r.indexNumber}, ${sqlString(c.enroleeNumber)})`;
  });
  lines.push(
    (rosterRows.length
      ? rosterRows.join(',\n')
      : "  ('', '', '', '', '', NULL, 0, '')") + ';'
  );
  lines.push('');
  lines.push('-- 1) Term');
  lines.push(
    'insert into terms (academic_year_id, term_number, start_date, end_date)'
  );
  lines.push(
    `select ay.id, ${input.termNumber}, date ${sqlString(input.termStart)}, date ${sqlString(input.termEnd)}`
  );
  lines.push('from academic_years ay');
  lines.push(`where ay.ay_code = ${sqlString(input.ayCode)}`);
  lines.push('  and not exists (');
  lines.push(
    `    select 1 from terms t where t.academic_year_id = ay.id and t.term_number = ${input.termNumber}`
  );
  lines.push('  );');
  lines.push('');
  lines.push('-- 2) Sections');
  lines.push(
    'insert into sections (academic_year_id, level_id, name, form_class_adviser)'
  );
  lines.push('select ay.id, lv.id, s.clean_name, s.form_teacher');
  lines.push('from _ay26_sections s');
  lines.push(
    `join academic_years ay on ay.ay_code = ${sqlString(input.ayCode)}`
  );
  lines.push('join levels lv on lv.code = s.level_code');
  lines.push('on conflict (academic_year_id, level_id, name) do nothing;');
  lines.push('');
  lines.push('-- 3) students (upsert by student_number)');
  lines.push(
    'insert into students (student_number, last_name, first_name, middle_name)'
  );
  lines.push(
    'select distinct r.student_number, r.last_name, r.first_name, r.middle_name'
  );
  lines.push('from _ay26_roster r');
  lines.push('on conflict (student_number) do nothing;');
  lines.push('');
  lines.push(
    '-- 4) section_students (enrollment_date left NULL — on-time T1 enrollees)'
  );
  lines.push(
    'insert into section_students (section_id, student_id, index_number, enrollment_status, enrollment_date, enrolee_number)'
  );
  lines.push(
    "select sec.id, st.id, r.index_number, 'active', null, r.enrolee_number"
  );
  lines.push('from _ay26_roster r');
  lines.push(
    `join academic_years ay on ay.ay_code = ${sqlString(input.ayCode)}`
  );
  lines.push('join levels lv on lv.code = r.level_code');
  lines.push(
    'join sections sec on sec.academic_year_id = ay.id and sec.level_id = lv.id and sec.name = r.clean_name'
  );
  lines.push('join students st on st.student_number = r.student_number');
  lines.push('on conflict (section_id, student_id) do nothing;');
  lines.push('');
  lines.push('-- 5) status flip');
  lines.push(`update ${statusTable} st`);
  lines.push('set "applicationStatus" = \'Enrolled\',');
  lines.push('    "classSection" = r.clean_name,');
  lines.push('    "classLevel" = lv.label');
  lines.push('from _ay26_roster r');
  lines.push('join levels lv on lv.code = r.level_code');
  lines.push('where st."enroleeNumber" = r.enrolee_number;');
  lines.push('');
  lines.push('-- pre-commit sanity check');
  lines.push('select');
  lines.push(
    `  (select count(*) from terms t join academic_years ay on ay.id=t.academic_year_id where ay.ay_code=${sqlString(
      input.ayCode
    )}) as term_count,`
  );
  lines.push(
    `  (select count(*) from sections sec join academic_years ay on ay.id=sec.academic_year_id where ay.ay_code=${sqlString(
      input.ayCode
    )}) as section_count,`
  );
  lines.push(
    `  (select count(*) from section_students ss join sections sec on sec.id=ss.section_id join academic_years ay on ay.id=sec.academic_year_id where ay.ay_code=${sqlString(
      input.ayCode
    )}) as roster_count;`
  );
  lines.push(
    `-- expect term_count >= 1, section_count = ${sectionMeta.size}, roster_count ~= ${matched.length}`
  );
  lines.push('');
  lines.push('commit;');
  lines.push('');
  lines.push('-- === post-commit verification ===');
  lines.push(
    `select "applicationStatus", count(*) from ${statusTable} group by 1 order by 2 desc;`
  );
  return lines.join('\n') + '\n';
}
