// Composes parsed T1 evaluation write-up rows into preview/apply SQL.
// Unlike Phase 7's T2 composer, roster resolution here is NAME-FIRST
// against the whole active AY2026 roster — the sheet's own index number
// is informational only, never used to resolve a row. See:
// docs/superpowers/specs/2026-07-20-ay2026-t1-evaluation-writeups-import-design.md
import { sqlString } from '../enrollment/sql-escape';
import { matchName, parseSheetFullName } from '../enrollment/name-match';
import type { CandidateName } from '../enrollment/name-match';
import type { ParsedT1WriteupRow, SheetT1Stats } from './parse-t1-writeups';

export interface T1RosterCandidate extends CandidateName {
  levelCode: string;
  sectionName: string;
  indexNumber: number;
  studentId: string;
  sectionId: string;
}

export interface BuildT1WriteupsImportInput {
  rows: ParsedT1WriteupRow[];
  sheetStats: SheetT1Stats[];
  rosterCandidates: T1RosterCandidate[];
  termId: string;
  submittedAt: string;
}

interface ResolvedT1Writeup {
  levelCode: string;
  sectionName: string;
  sheetIndexNo: string;
  fullName: string;
  studentId: string;
  sectionId: string;
  resolvedSectionLabel: string;
  writeup: string;
}

interface NeedsReviewT1Row {
  levelCode: string;
  sectionName: string;
  sheetIndexNo: string;
  fullName: string;
  reason: string;
}

interface T1SectionStats {
  levelCode: string;
  sectionName: string;
  resolved: number;
  needsReview: number;
  namedBlank: number;
  unusedTemplate: number;
}

export interface BuildT1WriteupsImportResult {
  preview: string;
  apply: string;
  stats: {
    writeupsWritten: number;
    needsReview: number;
  };
}

function buildSectionStats(
  sheetStats: SheetT1Stats[],
  resolved: ResolvedT1Writeup[],
  needsReview: NeedsReviewT1Row[]
): T1SectionStats[] {
  const key = (levelCode: string, sectionName: string) =>
    `${levelCode}::${sectionName}`;
  const map = new Map<string, T1SectionStats>();

  for (const s of sheetStats) {
    map.set(key(s.levelCode, s.sectionName), {
      levelCode: s.levelCode,
      sectionName: s.sectionName,
      resolved: 0,
      needsReview: 0,
      namedBlank: s.namedBlankCount,
      unusedTemplate: s.unusedTemplateCount,
    });
  }
  for (const r of resolved) {
    const s = map.get(key(r.levelCode, r.sectionName));
    if (s) s.resolved++;
  }
  for (const n of needsReview) {
    const s = map.get(key(n.levelCode, n.sectionName));
    if (s) s.needsReview++;
  }
  return Array.from(map.values());
}

export function buildT1WriteupsImport(
  input: BuildT1WriteupsImportInput
): BuildT1WriteupsImportResult {
  const { rows, sheetStats, rosterCandidates, termId, submittedAt } = input;

  const resolved: ResolvedT1Writeup[] = [];
  const needsReview: NeedsReviewT1Row[] = [];

  for (const row of rows) {
    const sheetName = parseSheetFullName(row.fullName);
    const result = matchName(sheetName, rosterCandidates);
    if (result.tier === 'none' || !result.candidate) {
      needsReview.push({
        levelCode: row.levelCode,
        sectionName: row.sectionName,
        sheetIndexNo: row.sheetIndexNo,
        fullName: row.fullName,
        reason: 'no name match against the active AY2026 roster',
      });
      continue;
    }
    const candidate = result.candidate as T1RosterCandidate;
    resolved.push({
      levelCode: row.levelCode,
      sectionName: row.sectionName,
      sheetIndexNo: row.sheetIndexNo,
      fullName: row.fullName,
      studentId: candidate.studentId,
      sectionId: candidate.sectionId,
      resolvedSectionLabel: `${candidate.levelCode} ${candidate.sectionName}`,
      writeup: row.writeup,
    });
  }

  const stats: BuildT1WriteupsImportResult['stats'] = {
    writeupsWritten: resolved.length,
    needsReview: needsReview.length,
  };

  const sectionStats = buildSectionStats(sheetStats, resolved, needsReview);

  return {
    preview: buildPreviewSql(sectionStats, resolved, needsReview, stats),
    apply: buildApplySql(termId, submittedAt, resolved),
    stats,
  };
}

const SNIPPET_LENGTH = 100;

function buildFullResolvedListing(resolved: ResolvedT1Writeup[]): string[] {
  const lines: string[] = [];
  lines.push(
    `-- Resolved write-ups (${resolved.length}) — full listing, not a sample:`
  );
  if (resolved.length === 0) {
    lines.push('--   (none)');
    return lines;
  }
  for (const r of resolved) {
    const snippet =
      r.writeup.length > SNIPPET_LENGTH
        ? `${r.writeup.slice(0, SNIPPET_LENGTH)}...`
        : r.writeup;
    lines.push(
      `--   [sheet: ${r.levelCode} ${r.sectionName} idx${r.sheetIndexNo}] -> [now: ${r.resolvedSectionLabel}] "${r.fullName}": "${snippet}"`
    );
  }
  return lines;
}

function buildPreviewSql(
  sectionStats: T1SectionStats[],
  resolved: ResolvedT1Writeup[],
  needsReview: NeedsReviewT1Row[],
  stats: BuildT1WriteupsImportResult['stats']
): string {
  const lines: string[] = [];
  lines.push('-- AY2026 T1 evaluation write-ups import — PREVIEW (read-only)');
  lines.push('--');
  lines.push(
    '-- Generated by gen-ay2026-t1-writeups.ts from the T1 Student Evaluation file.'
  );
  lines.push(
    '-- Review this report BEFORE running the matching apply.sql file.'
  );
  lines.push('--');
  lines.push(`-- writeups=${stats.writeupsWritten}`);
  lines.push('--');
  lines.push(
    '-- Per-section breakdown (resolved / needs-review / named-blank / unused-template):'
  );
  for (const s of sectionStats) {
    lines.push(
      `--   ${s.levelCode} ${s.sectionName}: resolved=${s.resolved} needsReview=${s.needsReview} namedBlank=${s.namedBlank} unusedTemplate=${s.unusedTemplate}`
    );
  }
  lines.push('--');
  lines.push(...buildFullResolvedListing(resolved));
  lines.push('--');
  lines.push(
    `-- Needs review (${needsReview.length}) — NOT written by apply.sql:`
  );
  if (needsReview.length === 0) lines.push('--   (none)');
  for (const r of needsReview) {
    lines.push(
      `--   [${r.levelCode} ${r.sectionName}] sheet index ${r.sheetIndexNo} "${r.fullName}" — ${r.reason}`
    );
  }
  return lines.join('\n') + '\n';
}

function buildApplySql(
  termId: string,
  submittedAt: string,
  resolved: ResolvedT1Writeup[]
): string {
  const lines: string[] = [];
  lines.push(
    '-- AY2026 T1 evaluation write-ups import — APPLY (transactional)'
  );
  lines.push('--');
  lines.push('-- RUN ay2026-t1-writeups-preview.sql FIRST.');
  lines.push(
    '-- Generated by gen-ay2026-t1-writeups.ts — do not hand-edit; regenerate instead.'
  );
  lines.push('--');
  lines.push('-- Run the WHOLE file in one go (one connection/session).');
  lines.push('');
  lines.push('begin;');
  lines.push('');

  lines.push('drop table if exists _ay26t1writeup_rows;');
  lines.push(
    'create temp table _ay26t1writeup_rows (student_id, section_id, writeup) as'
  );
  lines.push('values');
  const valueRows = resolved.map(
    (r) =>
      `  (${sqlString(r.studentId)}::uuid, ${sqlString(r.sectionId)}::uuid, ${sqlString(r.writeup)})`
  );
  lines.push(
    (valueRows.length
      ? valueRows.join(',\n')
      : "  ('00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, '__NONE__')") +
      ';'
  );
  lines.push('');
  lines.push(
    'insert into evaluation_writeups (term_id, student_id, section_id, writeup, submitted, submitted_at)'
  );
  lines.push(
    `select ${sqlString(termId)}::uuid, r.student_id, r.section_id, r.writeup, true, ${sqlString(submittedAt)}::timestamptz`
  );
  lines.push('from _ay26t1writeup_rows r');
  lines.push("where r.writeup <> '__NONE__'");
  lines.push('on conflict (term_id, student_id) do nothing;');
  lines.push('');
  lines.push('commit;');
  lines.push('');
  lines.push('-- === post-commit verification ===');
  lines.push(
    `select count(*) as evaluation_writeups_rows from evaluation_writeups where term_id = ${sqlString(termId)}::uuid;`
  );
  return lines.join('\n') + '\n';
}
