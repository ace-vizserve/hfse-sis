// lib/sis/backfill/attendance/build-attendance-import-t3.ts
// Composes attendance-workbook-t3 + day-classifier-t3 + legend-dates-t3
// (plus Phase 1's section-identity + sql-escape, and legend-parser's date
// resolver) into the SQL artifacts described by the design doc: a
// read-only preview report and a transactional, idempotent apply script
// split into chunked files from the start (T2's tuned ~150KB/file
// target). No I/O — takes already-parsed sections and an already-fetched
// roster lookup.
import { deriveSectionIdentity } from '../enrollment/section-identity';
import { sqlString, sqlStringOrNull } from '../enrollment/sql-escape';
import { resolveHeaderDate } from './legend-parser';
import { parseLegendDateTextT3 } from './legend-dates-t3';
import {
  classifyDatesT3,
  type DateClassificationT3,
  type EventCategoryT3,
} from './day-classifier-t3';
import type { LegendGroupT3, ParsedSectionT3 } from './attendance-workbook-t3';
import type { RosterLookupEntry } from './build-attendance-import';

export type { RosterLookupEntry };

export interface BuildAttendanceImportT3Input {
  sections: ParsedSectionT3[];
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

export interface BuildAttendanceImportT3Result {
  preview: string;
  applyFiles: ApplySqlFile[];
  stats: {
    schoolDays: number;
    holidays: number;
    events: number;
    eventsMissingLabel: number;
    attendanceRows: number;
    needsReview: number;
    excludedNonCore: string[];
    unrecognized: string[];
    skippedEmpty: string[];
    unparseableDateHeaders: string[];
  };
}

const VALID_MARKS = new Set(['P', 'A', 'EX', 'L']);
const DEFAULT_MARKS_CHUNK_SIZE = 2000; // T2's tuned threshold — reused as-is
const LEGEND_GROUPS: LegendGroupT3[] = [
  'schoolEvents',
  'schoolHoliday',
  'publicHoliday',
  'examination',
];

// "S1 Discipline - 1" -> "Discipline 1" (design doc §1 point 7 / §2
// Locked Decision 1) — sheet names suffix split sections with " - N",
// the live DB names them "N" with no dash.
function normalizeCleanNameT3(cleanName: string): string {
  return cleanName.replace(/\s*-\s*(\d+)$/, ' $1');
}

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

export function buildAttendanceImportT3(
  input: BuildAttendanceImportT3Input
): BuildAttendanceImportT3Result {
  const { sections, rosterLookup, ayCode, termNumber, year } = input;

  const rosterMap = new Map<string, string>();
  for (const r of rosterLookup) {
    rosterMap.set(
      `${r.levelCode}::${r.cleanName}::${r.indexNumber}`,
      r.sectionStudentId
    );
  }

  const excludedNonCore: string[] = [];
  const unrecognized: string[] = [];
  const skippedEmpty: string[] = [];
  const coreSections: {
    parsed: ParsedSectionT3;
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
      excludedNonCore.push(parsed.section.sheetName);
      continue;
    }
    if (identity.kind === 'unrecognized') {
      unrecognized.push(parsed.section.sheetName);
      continue;
    }
    coreSections.push({
      parsed,
      levelCode: identity.levelCode,
      cleanName: normalizeCleanNameT3(identity.cleanName),
    });
  }

  // --- Date resolution (once, across all core sections) ---
  const allDatesRaw = coreSections[0]?.parsed.section.dateColumns ?? [];
  const allDatesISO: (string | null)[] = allDatesRaw.map((d) =>
    resolveHeaderDate(d, year)
  );
  const unparseableDateHeaders: string[] = [];
  allDatesRaw.forEach((raw, i) => {
    if (allDatesISO[i] === null) unparseableDateHeaders.push(raw);
  });

  // --- Row-11 tags (shared across sections for a given date — first found wins) ---
  const tagByDate = new Map<string, string>();
  for (let i = 0; i < allDatesRaw.length; i++) {
    const rawDate = allDatesRaw[i];
    const isoDate = allDatesISO[i];
    if (!isoDate || tagByDate.has(isoDate)) continue;
    for (const { parsed } of coreSections) {
      const tag = parsed.dateTags[rawDate];
      if (tag) {
        tagByDate.set(isoDate, tag);
        break;
      }
    }
  }

  // --- Legend labels (section-specific content, merged across all groups + sections) ---
  const legendLabelByDate = new Map<string, string>();
  for (const { parsed } of coreSections) {
    for (const group of LEGEND_GROUPS) {
      for (const entry of parsed.legendGroups[group]) {
        for (const isoDate of parseLegendDateTextT3(entry.dateText, year)) {
          if (!legendLabelByDate.has(isoDate))
            legendLabelByDate.set(isoDate, entry.label);
        }
      }
    }
  }

  // --- Blank-date aggregation, for untagged columns only ---
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

  const validDatesISO = allDatesISO.filter((d): d is string => d !== null);
  const classifications = classifyDatesT3(
    validDatesISO,
    tagByDate,
    legendLabelByDate,
    blankDates
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

        const rawMark = (student.marks[rawDate] ?? '').trim();
        if (!rawMark) continue;
        const mark = rawMark.toUpperCase();
        if (!VALID_MARKS.has(mark)) {
          needsReview.push({
            sheetName: parsed.section.sheetName,
            indexNo: student.indexNo,
            fullName: student.fullName,
            reason: `unexpected mark "${rawMark}" on ${isoDate}`,
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

  const stats: BuildAttendanceImportT3Result['stats'] = {
    schoolDays: classifications.filter((c) => c.dayType === 'school_day')
      .length,
    holidays: classifications.filter((c) => c.dayType !== 'school_day').length,
    events: classifications.filter((c) => c.event !== null).length,
    eventsMissingLabel: classifications.filter((c) => c.event?.labelMissing)
      .length,
    attendanceRows: attendanceRows.length,
    needsReview: needsReview.length,
    excludedNonCore,
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
  classifications: DateClassificationT3[],
  needsReview: NeedsReviewRow[],
  stats: BuildAttendanceImportT3Result['stats'],
  applyFiles: ApplySqlFile[]
): string {
  const lines: string[] = [];
  lines.push(
    `-- AY2026 T${termNumber} attendance import — PREVIEW (read-only)`
  );
  lines.push('--');
  lines.push(
    '-- Generated by gen-ay2026-t3-attendance.ts from the T3 attendance workbook.'
  );
  lines.push(
    '-- Review this report BEFORE running the matching apply.sql file.'
  );
  lines.push('--');
  lines.push(`-- Date classification (${classifications.length} dates):`);
  for (const c of classifications) {
    const label = c.label ? ` "${sanitizeComment(c.label)}"` : '';
    const event = c.event
      ? ` [event:${c.event.category}${c.event.labelMissing ? ' NEEDS LABEL' : ''}]`
      : '';
    lines.push(`--   ${c.date}: ${c.dayType}${event}${label}`);
  }
  lines.push('--');
  lines.push(
    `-- school_days=${stats.schoolDays} holidays=${stats.holidays} events=${stats.events} attendanceRows=${stats.attendanceRows}`
  );
  lines.push('--');
  lines.push(
    `-- Events missing a label (${stats.eventsMissingLabel}) — NOT written to calendar_events,`
  );
  lines.push('-- add these by hand after checking the source workbook:');
  const missingLabel = classifications.filter((c) => c.event?.labelMissing);
  if (missingLabel.length === 0) lines.push('--   (none)');
  for (const c of missingLabel) {
    lines.push(`--   ${c.date}: [${c.event!.category}]`);
  }
  lines.push('--');
  lines.push(
    `-- Skipped (empty section tabs): ${stats.skippedEmpty.map(sanitizeComment).join(', ') || '(none)'}`
  );
  lines.push(
    `-- Excluded (non-core tabs, e.g. YS): ${stats.excludedNonCore.map(sanitizeComment).join(', ') || '(none)'}`
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
    '-- Generated by gen-ay2026-t3-attendance.ts — do not hand-edit; regenerate',
    '-- instead. Each file is its own transaction and is safe to re-run',
    '-- (idempotent) if you need to retry.',
    '--',
  ];
}

function buildApplyFiles(
  ayCode: string,
  termNumber: number,
  classifications: DateClassificationT3[],
  markChunks: AttendanceRow[][]
): ApplySqlFile[] {
  const totalFiles = 2 + markChunks.length + 1; // calendar + events + marks chunks + rollups
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
    lines.push('drop table if exists _ay26att3_calendar;');
    lines.push(
      'create temp table _ay26att3_calendar (date, day_type, hbl_overlay, label) as'
    );
    lines.push('values');
    const calendarRows = classifications.map(
      (c) =>
        `  (date ${sqlString(c.date)}, ${sqlString(c.dayType)}, false, ${sqlStringOrNull(c.label)})`
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
    lines.push('from _ay26att3_calendar c');
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

  // --- File: calendar_events ---
  {
    const eventRows: {
      date: string;
      category: EventCategoryT3;
      label: string;
    }[] = classifications
      .filter((c) => c.event !== null && c.event.label !== null)
      .map((c) => ({
        date: c.date,
        category: c.event!.category,
        label: c.event!.label as string,
      }));
    const lines = applyFileHeader(
      termNumber,
      fileNum,
      totalFiles,
      'calendar_events'
    );
    lines.push('begin;');
    lines.push('');
    lines.push('drop table if exists _ay26att3_events;');
    lines.push('create temp table _ay26att3_events (date, category, label) as');
    lines.push('values');
    const rows = eventRows.map(
      (e) =>
        `  (date ${sqlString(e.date)}, ${sqlString(e.category)}, ${sqlString(e.label)})`
    );
    lines.push(
      (rows.length
        ? rows.join(',\n')
        : "  (date '1970-01-01', 'other', 'placeholder')") + ';'
    );
    lines.push('');
    lines.push(
      'insert into calendar_events (term_id, start_date, end_date, label, audience, category)'
    );
    lines.push("select t.id, e.date, e.date, e.label, 'all', e.category");
    lines.push('from _ay26att3_events e');
    lines.push(`join academic_years ay on ay.ay_code = ${sqlString(ayCode)}`);
    lines.push(
      `join terms t on t.academic_year_id = ay.id and t.term_number = ${termNumber}`
    );
    lines.push('where not exists (');
    lines.push('  select 1 from calendar_events ce');
    lines.push('  where ce.term_id = t.id');
    lines.push('    and ce.start_date = e.date');
    lines.push('    and ce.end_date = e.date');
    lines.push('    and ce.category = e.category');
    lines.push(');');
    lines.push('');
    lines.push('commit;');
    files.push({
      filename: `${padFileNum(fileNum)}-events.sql`,
      sql: lines.join('\n') + '\n',
      description: `calendar_events (${eventRows.length} rows)`,
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
    lines.push('drop table if exists _ay26att3_marks;');
    lines.push(
      'create temp table _ay26att3_marks (section_student_id, date, status) as'
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
    lines.push('from _ay26att3_marks m');
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
      `  (select count(*) from calendar_events ce join terms t on t.id=ce.term_id join academic_years ay on ay.id=t.academic_year_id where ay.ay_code=${sqlString(ayCode)} and t.term_number=${termNumber}) as events_count,`
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
