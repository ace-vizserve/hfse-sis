// lib/sis/backfill/attendance/build-attendance-import-t2.ts
// Composes attendance-workbook-t2 + day-classifier-t2 (plus Phase 1's
// section-identity + sql-escape, and Phase 2's legend-parser date
// resolver) into the two SQL artifacts described by the design doc: a
// read-only preview report and a transactional, idempotent apply script,
// split into chunked files the same way Phase 2's mid-session fix
// established (built in from the start this time, per the design doc's
// §5). No I/O — takes already-parsed sections and an already-fetched
// roster lookup.
import { deriveSectionIdentity } from '../enrollment/section-identity';
import { sqlString, sqlStringOrNull } from '../enrollment/sql-escape';
import { resolveHeaderDate } from './legend-parser';
import {
  classifyDatesT2,
  type DateClassificationT2,
} from './day-classifier-t2';
import type { ParsedSectionWithLabels } from './attendance-workbook-t2';
import type { RosterLookupEntry } from './build-attendance-import';

export type { RosterLookupEntry };

export interface BuildAttendanceImportT2Input {
  sections: ParsedSectionWithLabels[];
  rosterLookup: RosterLookupEntry[];
  ayCode: string;
  termNumber: number;
  year: number;
  // Overridable only for tests — forces multi-file splitting with a small
  // synthetic fixture instead of needing thousands of rows.
  marksChunkSize?: number;
}

interface AttendanceRow {
  sectionStudentId: string;
  date: string;
  status: 'P' | 'A' | 'EX' | 'L';
}

interface NeedsReviewRow {
  sheetName: string;
  indexNo: string;
  fullName: string;
  reason: string;
}

export interface ApplySqlFile {
  filename: string;
  sql: string;
  description: string;
}

export interface BuildAttendanceImportT2Result {
  preview: string;
  applyFiles: ApplySqlFile[];
  stats: {
    schoolDays: number;
    holidays: number;
    attendanceRows: number;
    needsReview: number;
    needsConfirmation: number;
    excludedYs: string[];
    unrecognized: string[];
    skippedEmpty: string[];
    unparseableDateHeaders: string[];
  };
}

const VALID_MARKS = new Set(['P', 'A', 'EX', 'L']);

// Same threshold Phase 2's mid-session fix settled on — see
// build-attendance-import.ts for the measured failure case this avoids.
const DEFAULT_MARKS_CHUNK_SIZE = 2000;

function chunkArray<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function padFileNum(n: number): string {
  return String(n).padStart(2, '0');
}

function sanitizeComment(text: string): string {
  return text.replace(/[\r\n]+/g, ' ');
}

export function buildAttendanceImportT2(
  input: BuildAttendanceImportT2Input
): BuildAttendanceImportT2Result {
  const { sections, rosterLookup, ayCode, termNumber, year } = input;

  const rosterMap = new Map<string, string>();
  for (const r of rosterLookup) {
    rosterMap.set(
      `${r.levelCode}::${r.cleanName}::${r.indexNumber}`,
      r.sectionStudentId
    );
  }

  const excludedYs: string[] = [];
  const unrecognized: string[] = [];
  const skippedEmpty: string[] = [];
  const coreSections: {
    parsed: ParsedSectionWithLabels;
    levelCode: string;
    cleanName: string;
  }[] = [];

  for (const parsed of sections) {
    if (parsed.section.students.length === 0) {
      skippedEmpty.push(parsed.section.sheetName);
      continue;
    }
    const identity = deriveSectionIdentity(parsed.section.sheetName);
    if (identity.kind === 'ys') {
      excludedYs.push(parsed.section.sheetName);
      continue;
    }
    if (identity.kind === 'unrecognized') {
      unrecognized.push(parsed.section.sheetName);
      continue;
    }
    coreSections.push({
      parsed,
      levelCode: identity.levelCode,
      cleanName: identity.cleanName,
    });
  }

  // --- Date classification (once, across all core sections) ---
  // allDatesRaw and allDatesISO MUST stay the same length and positionally
  // aligned — every downstream loop indexes both by the same `i`, the
  // same invariant Phase 2 established (see build-attendance-import.ts).
  const allDatesRaw = coreSections[0]?.parsed.section.dateColumns ?? [];
  const allDatesISO: (string | null)[] = allDatesRaw.map((d) =>
    resolveHeaderDate(d, year)
  );
  const unparseableDateHeaders: string[] = [];
  allDatesRaw.forEach((raw, i) => {
    if (allDatesISO[i] === null) unparseableDateHeaders.push(raw);
  });

  const blankDates = new Set<string>();
  for (let i = 0; i < allDatesRaw.length; i++) {
    const rawDate = allDatesRaw[i];
    const isoDate = allDatesISO[i];
    if (!isoDate) continue;
    const allBlank = coreSections.every(({ parsed }) =>
      parsed.section.students.every((s) => !(s.marks[rawDate] ?? '').trim())
    );
    if (allBlank) blankDates.add(isoDate);
  }

  // Row-8's label is section-specific in content (e.g. "P1&P2 Fieldtrip"
  // only appears on P1/P2 sheets) — take the label from whichever section
  // actually has one for that date column.
  const labelByDate = new Map<string, string>();
  for (let i = 0; i < allDatesRaw.length; i++) {
    const rawDate = allDatesRaw[i];
    const isoDate = allDatesISO[i];
    if (!isoDate || labelByDate.has(isoDate)) continue;
    for (const { parsed } of coreSections) {
      const label = (parsed.dateLabels[rawDate] ?? '').trim();
      if (label) {
        labelByDate.set(isoDate, label);
        break;
      }
    }
  }

  const validDatesISO = allDatesISO.filter((d): d is string => d !== null);
  const classifications = classifyDatesT2(
    validDatesISO,
    blankDates,
    labelByDate
  );
  const dayTypeByDate = new Map(classifications.map((c) => [c.date, c]));

  // --- Attendance rows + needs-review ---
  const attendanceRows: AttendanceRow[] = [];
  const needsReview: NeedsReviewRow[] = [];

  for (const { parsed, levelCode, cleanName } of coreSections) {
    for (const student of parsed.section.students) {
      const key = `${levelCode}::${cleanName}::${Number.parseInt(student.indexNo, 10)}`;
      const sectionStudentId = rosterMap.get(key);
      if (!sectionStudentId) {
        needsReview.push({
          sheetName: parsed.section.sheetName,
          indexNo: student.indexNo,
          fullName: student.fullName,
          reason: `no matching section_students row for index ${student.indexNo}`,
        });
        continue;
      }

      for (let i = 0; i < allDatesRaw.length; i++) {
        const rawDate = allDatesRaw[i];
        const isoDate = allDatesISO[i];
        if (!isoDate) continue;
        const classification = dayTypeByDate.get(isoDate);
        if (!classification || classification.dayType !== 'school_day')
          continue;

        const mark = (student.marks[rawDate] ?? '').trim();
        if (!mark) continue;
        if (!VALID_MARKS.has(mark)) {
          const reason =
            mark === '-'
              ? `"-" ("No Class" per the workbook's own legend) on ${isoDate} — not imported; does not affect the attendance rollup`
              : `unexpected mark "${mark}" on ${isoDate}`;
          needsReview.push({
            sheetName: parsed.section.sheetName,
            indexNo: student.indexNo,
            fullName: student.fullName,
            reason,
          });
          continue;
        }
        attendanceRows.push({
          sectionStudentId,
          date: isoDate,
          status: mark as AttendanceRow['status'],
        });
      }
    }
  }

  const stats: BuildAttendanceImportT2Result['stats'] = {
    schoolDays: classifications.filter((c) => c.dayType === 'school_day')
      .length,
    holidays: classifications.filter((c) => c.dayType !== 'school_day').length,
    attendanceRows: attendanceRows.length,
    needsReview: needsReview.length,
    needsConfirmation: classifications.filter((c) => c.needsConfirmation)
      .length,
    excludedYs,
    unrecognized,
    skippedEmpty,
    unparseableDateHeaders,
  };

  const markChunks = chunkArray(
    attendanceRows,
    input.marksChunkSize ?? DEFAULT_MARKS_CHUNK_SIZE
  );
  const applyFiles = buildApplyFiles(
    ayCode,
    termNumber,
    classifications,
    markChunks
  );

  return {
    preview: buildPreviewSql(
      termNumber,
      classifications,
      needsReview,
      stats,
      applyFiles
    ),
    applyFiles,
    stats,
  };
}

function buildPreviewSql(
  termNumber: number,
  classifications: DateClassificationT2[],
  needsReview: NeedsReviewRow[],
  stats: BuildAttendanceImportT2Result['stats'],
  applyFiles: ApplySqlFile[]
): string {
  const lines: string[] = [];
  lines.push(
    `-- AY2026 T${termNumber} attendance import — PREVIEW (read-only)`
  );
  lines.push('--');
  lines.push(
    '-- Generated by gen-ay2026-t2-attendance.ts from the T2 attendance workbook.'
  );
  lines.push(
    '-- Review this report BEFORE running the matching apply.sql file.'
  );
  lines.push('--');
  lines.push(`-- Date classification (${classifications.length} dates):`);
  for (const c of classifications) {
    const overlay = c.hblOverlay ? ' [hbl_overlay]' : '';
    const flag = c.needsConfirmation ? ' [NEEDS CONFIRMATION]' : '';
    const label = c.label ? ` "${sanitizeComment(c.label)}"` : '';
    lines.push(`--   ${c.date}: ${c.dayType}${overlay}${flag}${label}`);
  }
  lines.push('--');
  lines.push(
    `-- school_days=${stats.schoolDays} holidays=${stats.holidays} attendanceRows=${stats.attendanceRows}`
  );
  lines.push('--');
  lines.push(
    `-- Dates needing confirmation (${stats.needsConfirmation}) — classified as no_class`
  );
  lines.push(
    '-- but carry an unrecognized label; confirm none of these are an'
  );
  lines.push('-- unlisted real public holiday before running the apply files:');
  const flagged = classifications.filter((c) => c.needsConfirmation);
  if (flagged.length === 0) lines.push('--   (none)');
  for (const c of flagged) {
    lines.push(`--   ${c.date}: "${sanitizeComment(c.label ?? '')}"`);
  }
  lines.push('--');
  lines.push(
    `-- Skipped (empty section tabs): ${stats.skippedEmpty.map(sanitizeComment).join(', ') || '(none)'}`
  );
  lines.push(
    `-- Excluded (Youngstarters): ${stats.excludedYs.map(sanitizeComment).join(', ') || '(none)'}`
  );
  lines.push(
    `-- Unrecognized sheet names: ${stats.unrecognized.map(sanitizeComment).join(', ') || '(none)'}`
  );
  lines.push(
    `-- Unparseable date headers (ignored, no data written for these): ${stats.unparseableDateHeaders.map(sanitizeComment).join(', ') || '(none)'}`
  );
  lines.push('--');
  lines.push(
    `-- Needs review (${needsReview.length}) — NOT written by any apply file:`
  );
  if (needsReview.length === 0) lines.push('--   (none)');
  for (const r of needsReview) {
    lines.push(
      `--   [${sanitizeComment(r.sheetName)}] index ${sanitizeComment(r.indexNo)} "${sanitizeComment(r.fullName)}" — ${sanitizeComment(r.reason)}`
    );
  }
  lines.push('--');
  lines.push(
    `-- Apply files (${applyFiles.length}) — run every file IN ORDER, each is`
  );
  lines.push(
    '-- its own transaction and safe to re-run (idempotent) if you retry:'
  );
  for (const f of applyFiles) {
    lines.push(`--   ${f.filename} — ${sanitizeComment(f.description)}`);
  }
  return lines.join('\n') + '\n';
}

function applyFileHeader(
  termNumber: number,
  fileNum: number,
  totalFiles: number,
  title: string
): string[] {
  return [
    `-- AY2026 T${termNumber} attendance import — APPLY file ${fileNum} of ${totalFiles}: ${title}`,
    '--',
    `-- RUN ay2026-t${termNumber}-attendance-preview.sql FIRST, and run apply files`,
    '-- IN ORDER (see the "Apply files" list at the end of the preview).',
    '-- Generated by gen-ay2026-t2-attendance.ts — do not hand-edit; regenerate',
    '-- instead. Split into multiple files because the combined script was too',
    '-- large for the Supabase SQL Editor to run as one query (same threshold',
    '-- Phase 2 measured). Each file is its own transaction and is safe to',
    '-- re-run (idempotent) if you need to retry.',
    '--',
  ];
}

function buildApplyFiles(
  ayCode: string,
  termNumber: number,
  classifications: DateClassificationT2[],
  markChunks: AttendanceRow[][]
): ApplySqlFile[] {
  const totalFiles = 1 + markChunks.length + 1; // calendar + marks chunks + rollups
  const files: ApplySqlFile[] = [];
  let fileNum = 1;

  // --- File: school_calendar ---
  {
    const lines = applyFileHeader(
      termNumber,
      fileNum,
      totalFiles,
      'school_calendar'
    );
    lines.push('begin;');
    lines.push('');
    lines.push('drop table if exists _ay26att2_calendar;');
    lines.push(
      'create temp table _ay26att2_calendar (date, day_type, hbl_overlay, label) as'
    );
    lines.push('values');
    const calendarRows = classifications.map(
      (c) =>
        `  (date ${sqlString(c.date)}, ${sqlString(c.dayType)}, ${c.hblOverlay ? 'true' : 'false'}, ${sqlStringOrNull(c.label)})`
    );
    lines.push(
      (calendarRows.length
        ? calendarRows.join(',\n')
        : "  (date '1970-01-01', 'school_day', false, NULL)") + ';'
    );
    lines.push('');
    lines.push(
      'insert into school_calendar (term_id, date, day_type, hbl_overlay, label)'
    );
    lines.push('select t.id, c.date, c.day_type, c.hbl_overlay, c.label');
    lines.push('from _ay26att2_calendar c');
    lines.push(`join academic_years ay on ay.ay_code = ${sqlString(ayCode)}`);
    lines.push(
      `join terms t on t.academic_year_id = ay.id and t.term_number = ${termNumber}`
    );
    lines.push('on conflict (term_id, audience, date) do nothing;');
    lines.push('');
    lines.push('commit;');
    files.push({
      filename: `${padFileNum(fileNum)}-calendar.sql`,
      sql: lines.join('\n') + '\n',
      description: `school_calendar (${classifications.length} rows)`,
    });
    fileNum++;
  }

  // --- Files: attendance_daily marks, chunked ---
  markChunks.forEach((chunkRows, idx) => {
    const chunkLabel = `chunk ${idx + 1} of ${markChunks.length}`;
    const lines = applyFileHeader(
      termNumber,
      fileNum,
      totalFiles,
      `attendance_daily marks (${chunkLabel}, ${chunkRows.length} rows)`
    );
    lines.push(
      '-- ex_reason is always NULL — the source workbook has no sub-reason data'
    );
    lines.push(
      '-- for EX marks (written explicitly, not omitted, so this is visible here)'
    );
    lines.push('begin;');
    lines.push('');
    lines.push('drop table if exists _ay26att2_marks;');
    lines.push(
      'create temp table _ay26att2_marks (section_student_id, date, status) as'
    );
    lines.push('values');
    const markRows = chunkRows.map(
      (r) =>
        `  (${sqlString(r.sectionStudentId)}, date ${sqlString(r.date)}, ${sqlString(r.status)})`
    );
    lines.push(markRows.join(',\n') + ';');
    lines.push('');
    lines.push(
      'insert into attendance_daily (section_student_id, term_id, date, status, ex_reason, period_id, recorded_by, recorded_at)'
    );
    lines.push(
      'select m.section_student_id::uuid, t.id, m.date, m.status, null, null, null, now()'
    );
    lines.push('from _ay26att2_marks m');
    lines.push(`join academic_years ay on ay.ay_code = ${sqlString(ayCode)}`);
    lines.push(
      `join terms t on t.academic_year_id = ay.id and t.term_number = ${termNumber}`
    );
    lines.push('where not exists (');
    lines.push('  select 1 from attendance_daily ad');
    lines.push('  where ad.section_student_id = m.section_student_id::uuid');
    lines.push('    and ad.date = m.date');
    lines.push('    and ad.period_id is null');
    lines.push(');');
    lines.push('');
    lines.push('commit;');
    files.push({
      filename: `${padFileNum(fileNum)}-marks-${padFileNum(idx + 1)}-of-${padFileNum(markChunks.length)}.sql`,
      sql: lines.join('\n') + '\n',
      description: `attendance_daily marks — ${chunkLabel} (${chunkRows.length} rows)`,
    });
    fileNum++;
  });

  // --- File: rollups + verification ---
  {
    const distinctStudentIds = [
      ...new Set(markChunks.flat().map((r) => r.sectionStudentId)),
    ];
    const lines = applyFileHeader(
      termNumber,
      fileNum,
      totalFiles,
      'rollups + verification'
    );
    lines.push('begin;');
    lines.push('');
    for (const id of distinctStudentIds) {
      lines.push(
        `select public.recompute_attendance_rollup(t.id, ${sqlString(id)}::uuid) from academic_years ay join terms t on t.academic_year_id = ay.id and t.term_number = ${termNumber} where ay.ay_code = ${sqlString(ayCode)};`
      );
    }
    lines.push('');
    lines.push('-- pre-commit sanity check');
    lines.push('select');
    lines.push(
      `  (select count(*) from school_calendar sc join terms t on t.id=sc.term_id join academic_years ay on ay.id=t.academic_year_id where ay.ay_code=${sqlString(ayCode)} and t.term_number=${termNumber}) as calendar_count,`
    );
    lines.push(
      `  (select count(*) from attendance_records ar join terms t on t.id=ar.term_id join academic_years ay on ay.id=t.academic_year_id where ay.ay_code=${sqlString(ayCode)} and t.term_number=${termNumber}) as rollup_count;`
    );
    lines.push(
      `-- expect calendar_count ~= ${classifications.length}, rollup_count ~= ${distinctStudentIds.length}`
    );
    lines.push('');
    lines.push('commit;');
    lines.push('');
    lines.push('-- === post-commit verification ===');
    lines.push(
      `select count(*) as attendance_daily_rows from attendance_daily ad join terms t on t.id=ad.term_id join academic_years ay on ay.id=t.academic_year_id where ay.ay_code=${sqlString(ayCode)} and t.term_number=${termNumber};`
    );
    files.push({
      filename: `${padFileNum(fileNum)}-rollups-and-verify.sql`,
      sql: lines.join('\n') + '\n',
      description: `rollups + verification (${distinctStudentIds.length} students)`,
    });
    fileNum++;
  }

  return files;
}
