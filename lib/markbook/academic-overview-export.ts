import 'server-only';

import * as XLSX from 'xlsx';

import {
  AT_RISK_ATTENDANCE_THRESHOLD_PCT,
  BAND_DISPLAY_ORDER,
  type AcademicOverview,
  type BandCounts,
} from '@/lib/markbook/academic-overview-compute';

// School-wide Academic Overview → spreadsheet.
//
// Generates from the already-computed `AcademicOverview`, so the workbook can
// never disagree with the screen. Three tables, matching the three the page
// shows: terms, grade levels, subjects.
//
// Deliberately NOT the masterfile: that export is the per-student grid and
// still lives at the same route under `?level=`. This is the summary a
// coordinator forwards, so it carries the same columns they were just reading.
//
// ⚠ ONE THING ON THE PAGE IS DELIBERATELY NOT HERE: the named list of students
// below the at-risk attendance line. The page shows it because someone is
// sitting in front of it; a workbook gets forwarded, and a file that names
// children by their attendance should be produced on purpose, not as a
// side-effect of clicking Export. The per-level COUNT is here, so the figure
// is not lost — only the names are.

const DASH = '';

function bandCells(bands: BandCounts): number[] {
  return BAND_DISPLAY_ORDER.map((band) => bands[band.key]);
}

const BAND_HEADERS = BAND_DISPLAY_ORDER.map((band) => band.label);

type Table = { name: string; headers: string[]; rows: (string | number)[][] };

function num(value: number | null): string | number {
  return value == null ? DASH : value;
}

const TERM_STATUS_LABEL = {
  completed: 'Completed',
  in_progress: 'In progress',
  upcoming: 'Not started',
} as const;

export function buildOverviewTables(overview: AcademicOverview): Table[] {
  const attendanceByTermId = new Map(
    overview.attendance.terms.map((t) => [t.termId, t])
  );
  const terms: Table = {
    name: 'Terms',
    headers: [
      'Term',
      'Status',
      'Average grade',
      'Passing rate %',
      'Students graded',
      'Attendance %',
      'Students with a register',
    ],
    rows: overview.terms.map((term) => [
      term.label,
      TERM_STATUS_LABEL[term.status],
      num(term.average),
      num(term.passingRate),
      term.studentsGraded,
      num(attendanceByTermId.get(term.termId)?.rate ?? null),
      attendanceByTermId.get(term.termId)?.studentsRecorded ?? 0,
    ]),
  };

  const levels: Table = {
    name: 'Grade levels',
    headers: [
      'Grade level',
      'Students',
      'Average grade',
      'Passing rate %',
      'Subjects below 75 (avg)',
      'Strongest subject',
      'Strongest subject average',
      'Weakest subject',
      'Weakest subject average',
      ...BAND_HEADERS,
      'Change since first term',
      'Attendance %',
      `Students below ${AT_RISK_ATTENDANCE_THRESHOLD_PCT}% attendance`,
    ],
    rows: overview.levels.map((level) => [
      level.levelLabel,
      level.students,
      num(level.average),
      num(level.passingRate),
      num(level.failedSubjectsAvg),
      level.strongestSubject?.name ?? DASH,
      num(level.strongestSubject?.average ?? null),
      level.weakestSubject?.name ?? DASH,
      num(level.weakestSubject?.average ?? null),
      ...bandCells(level.bands),
      num(level.delta),
      num(level.attendanceRate),
      num(level.attendanceBelowThreshold),
    ]),
  };

  const subjects: Table = {
    name: 'Subjects',
    headers: [
      'Subject',
      'Students',
      'Average grade',
      'Passing rate %',
      'Strongest level',
      'Strongest level average',
      'Weakest level',
      'Weakest level average',
      ...BAND_HEADERS,
      'Change since first term',
    ],
    rows: overview.subjects.map((subject) => [
      subject.subjectName,
      subject.students,
      num(subject.average),
      num(subject.passingRate),
      subject.strongestLevel?.label ?? DASH,
      num(subject.strongestLevel?.average ?? null),
      subject.weakestLevel?.label ?? DASH,
      num(subject.weakestLevel?.average ?? null),
      ...bandCells(subject.bands),
      num(subject.delta),
    ]),
  };

  return [terms, levels, subjects];
}

/** The scope sentence that heads every export, so a stray file still explains itself. */
export function overviewScopeLines(overview: AcademicOverview): string[] {
  const range =
    overview.termProgress.reportedRangeLabel ?? 'No completed terms';
  const lines = [
    `HFSE Academic Overview — all grade levels — ${overview.ayCode}`,
    `Covers ${range}. Passing = 75 and above. Examinable subjects only.`,
    `${overview.coverage.studentsWithGrades} students have grades; ${overview.coverage.enrolledWithoutGrades} of ${overview.coverage.studentsEnrolled} enrolled students have none yet.`,
  ];
  if (overview.attendance.studentsRecorded > 0) {
    lines.push(
      `Attendance: ${overview.attendance.presentRate}% of school days attended. ${overview.attendance.concerns.length} of ${overview.attendance.studentsRecorded} students with a register are below ${AT_RISK_ATTENDANCE_THRESHOLD_PCT}% — a reading aid, not a school rule. They are named on the page, not in this file.`
    );
  }
  if (overview.anomalies.impossibleLowGrades > 0) {
    lines.push(
      `Warning: ${overview.anomalies.impossibleLowGrades} grades are stored below 60, which the grading formula cannot produce. They affect every average and passing rate below.`
    );
  }
  return lines;
}

/** RFC-4180 escape: wrap fields containing , " or newlines in double-quotes. */
function csvEscape(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function overviewToCsv(overview: AcademicOverview): string {
  // UTF-8 BOM so Excel opens it in the right encoding — same as the masterfile.
  const BOM = '﻿';
  const lines: string[] = [];
  for (const line of overviewScopeLines(overview)) {
    lines.push(csvEscape(line));
  }
  for (const table of buildOverviewTables(overview)) {
    lines.push('');
    lines.push(csvEscape(table.name));
    lines.push(table.headers.map(csvEscape).join(','));
    for (const row of table.rows) {
      lines.push(row.map(csvEscape).join(','));
    }
  }
  return BOM + lines.join('\r\n');
}

export function buildOverviewWorkbook(overview: AcademicOverview): Buffer {
  const wb = XLSX.utils.book_new();

  const scope = XLSX.utils.aoa_to_sheet(
    overviewScopeLines(overview).map((line) => [line])
  );
  scope['!cols'] = [{ wch: 120 }];
  XLSX.utils.book_append_sheet(wb, scope, 'About');

  for (const table of buildOverviewTables(overview)) {
    const sheet = XLSX.utils.aoa_to_sheet([table.headers, ...table.rows]);
    sheet['!cols'] = table.headers.map((h, i) => ({
      wch: Math.max(12, Math.min(28, i === 0 ? 20 : h.length + 2)),
    }));
    XLSX.utils.book_append_sheet(wb, sheet, table.name);
  }

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
