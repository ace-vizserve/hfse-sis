import 'server-only';

import * as XLSX from 'xlsx';

import type { CalendarEventRow } from '@/lib/attendance/calendar';
import {
  eachDateInclusive,
  monthLabelOf,
  monthsInRange,
  resolveColumnTag,
} from '@/lib/attendance/sheet-columns';
import { summarizeMarks, type Mark } from '@/lib/attendance/sheet-summary';
import type { AttendanceStatus, DayType } from '@/lib/schemas/attendance';

// Literal reproduction of HFSE's per-section attendance sheet
// (AY2026 Term 3 Attendance.xlsx). One worksheet. Summary VALUES are
// precomputed via the shared summary engine (not Excel formulas) so the
// export and the live panel can't diverge.

export type AttendanceSheetExportInput = {
  schoolName: string; // 'HFSE INTERNATIONAL SCHOOL' | 'HFSE YOUNGSTARTERS'
  sheetName: string; // worksheet tab name, e.g. 'P1 Obedience'
  term: {
    label: string;
    termNumber: number;
    startDate: string;
    endDate: string;
  };
  courseLabel: string;
  sectionName: string;
  formAdviser: string | null;
  scheduleLabel: string | null;
  /** date → { dayType, label } from school_calendar (dates not present = no tag). */
  calendarByDate: Map<string, { dayType: DayType; label: string | null }>;
  events: CalendarEventRow[];
  /** 'YYYY-MM' — when set, the sheet carries only that month's date columns
   *  and that month's summary block (no term-total block). Set it through
   *  `narrowSheetExport`, which checks the month is inside the term. */
  month?: string | null;
  students: Array<{
    /** section_students.id — what `narrowSheetExport` matches `studentIds` on. */
    enrolmentId?: string;
    indexNumber: number;
    fullName: string;
    busCare: string | null;
    withdrawn: boolean;
    enrollmentDate: string | null;
    marksByDate: Map<string, AttendanceStatus | null>;
  }>;
};

const SUMMARY_SUBCOLS = [
  'Total Days',
  'Present',
  'Late',
  'Excused',
  'Absent',
  'Attendance %',
] as const;

const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

function shortDate(iso: string): string {
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  return `${day} ${MONTH_ABBR[month - 1]}`;
}

/** A request asked for a month or a student the term / section doesn't have.
 *  The route answers it with a 400. */
export class SheetExportScopeError extends Error {}

export type SheetExportScope = {
  /** 'YYYY-MM', must be a month the term touches. */
  month?: string | null;
  /** section_students ids; every one must be on the input's roster. */
  studentIds?: string[] | null;
};

/**
 * Narrow one term's export to a month and/or some students. Pure — returns a
 * new input; roster order (index number) and every student's marks and
 * enrollment date are kept as they are, so proration and the formula are the
 * same as the whole-term sheet's.
 */
export function narrowSheetExport(
  input: AttendanceSheetExportInput,
  scope: SheetExportScope
): AttendanceSheetExportInput {
  let out = input;
  if (scope.month != null) {
    const months = monthsInRange(input.term.startDate, input.term.endDate);
    if (!/^\d{4}-\d{2}$/.test(scope.month) || !months.includes(scope.month)) {
      throw new SheetExportScopeError(
        `${scope.month} is not a month of ${input.term.label}.`
      );
    }
    out = { ...out, month: scope.month };
  }
  if (scope.studentIds != null) {
    const wanted = new Set(scope.studentIds);
    const onRoster = new Set(
      input.students.map((s) => s.enrolmentId).filter(Boolean)
    );
    for (const id of wanted) {
      if (!onRoster.has(id)) {
        throw new SheetExportScopeError(
          'One or more of the students asked for are not in this class.'
        );
      }
    }
    out = {
      ...out,
      students: input.students.filter(
        (s) => s.enrolmentId != null && wanted.has(s.enrolmentId)
      ),
    };
  }
  return out;
}

/**
 * The download's file name, saying what is in it:
 * `P5-Commitment_Term4.xlsx`, `P5-Commitment_Term4_October-2026.xlsx`,
 * `P5-Commitment_AY2026.xlsx`, `P5-Commitment_Term4_3-students.xlsx`.
 */
export function sheetExportFilename(args: {
  levelCode: string | null;
  sectionName: string;
  /** Term label ('Term 4') — or, for the whole year, the AY code. */
  periodLabel: string;
  month?: string | null;
  studentCount?: number | null;
}): string {
  const part = (s: string) =>
    s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const head = [args.levelCode, args.sectionName]
    .filter((s): s is string => Boolean(s && s.trim()))
    .map(part)
    .join('-');
  const pieces = [head || 'Attendance', args.periodLabel.replace(/\s+/g, '')];
  if (args.month) pieces.push(part(monthLabelOf(args.month)));
  if (args.studentCount != null) {
    pieces.push(
      `${args.studentCount}-${args.studentCount === 1 ? 'student' : 'students'}`
    );
  }
  return `${pieces.map((p) => p.replace(/[^A-Za-z0-9._-]+/g, '')).join('_')}.xlsx`;
}

function safeTabName(name: string): string {
  // Excel tab names cap at 31 chars and forbid : \ / ? * [ ].
  return name.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31);
}

export function buildAttendanceSheetWorkbook(
  input: AttendanceSheetExportInput
): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    buildAttendanceWorksheet(input),
    safeTabName(input.sheetName)
  );
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/**
 * Whole year: one worksheet per term, in the order given, each exactly the
 * sheet that term exports on its own. Tabs are named by `sheetName` (the
 * route passes the term label), de-duplicated if two collide.
 */
export function buildAttendanceYearWorkbook(
  inputs: AttendanceSheetExportInput[]
): Buffer {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const input of inputs) {
    const base = safeTabName(input.sheetName) || 'Term';
    let tab = base;
    for (let n = 2; used.has(tab); n++) {
      const suffix = ` (${n})`;
      tab = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(tab);
    XLSX.utils.book_append_sheet(wb, buildAttendanceWorksheet(input), tab);
  }
  if (inputs.length === 0) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([['No term in this year has dates set.']]),
      'Year'
    );
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function buildAttendanceWorksheet(
  input: AttendanceSheetExportInput
): XLSX.WorkSheet {
  const month = input.month ?? null;
  const dates = eachDateInclusive(
    input.term.startDate,
    input.term.endDate
  ).filter((d) => month == null || d.slice(0, 7) === month);
  const months =
    month == null
      ? monthsInRange(input.term.startDate, input.term.endDate)
      : [month];
  // A month sheet's summary is that month alone; the term total would
  // describe days the sheet doesn't show.
  const summaryBlocks = month == null ? [...months, 'TERM'] : months;
  const eventsByDate = (iso: string) =>
    input.events.filter((e) => iso >= e.startDate && iso <= e.endDate);
  const firstDate = dates[0] ?? input.term.startDate;
  const lastDate = dates[dates.length - 1] ?? input.term.endDate;
  const events =
    month == null
      ? input.events
      : input.events.filter(
          (e) => e.startDate <= lastDate && e.endDate >= firstDate
        );

  const aoa: (string | number)[][] = [];
  const merges: XLSX.Range[] = [];

  // ── Title band ──
  aoa.push([input.schoolName]);
  aoa.push(['STUDENT ATTENDANCE SHEET']);
  aoa.push([]);

  // ── Class info + legend (compact rows) ──
  aoa.push([
    'Term',
    String(input.term.termNumber),
    '',
    'LEGEND',
    'P',
    'Present',
  ]);
  aoa.push(['Course', input.courseLabel, '', '', 'A', 'Absent']);
  aoa.push([
    'Section',
    input.sectionName,
    '',
    '',
    'EX',
    'Excused (MC or Excuse Leave)',
  ]);
  aoa.push([
    'Form Class Adviser',
    input.formAdviser ?? '',
    '',
    '',
    'L',
    'Late',
  ]);
  if (input.scheduleLabel) aoa.push(['Schedule', input.scheduleLabel]);
  if (month != null) aoa.push(['Month', monthLabelOf(month)]);
  aoa.push([]);

  // ── Dated lists (Events / Holidays / PH / Examination) ──
  const exams = events.filter((e) => e.category === 'term_exam');
  const schoolEvents = events.filter((e) => e.category !== 'term_exam');
  const phRows = dates
    .filter((d) => input.calendarByDate.get(d)?.dayType === 'public_holiday')
    .map((d) => ({
      date: d,
      label: input.calendarByDate.get(d)?.label ?? 'Public holiday',
    }));
  const shRows = dates
    .filter((d) => input.calendarByDate.get(d)?.dayType === 'school_holiday')
    .map((d) => ({
      date: d,
      label: input.calendarByDate.get(d)?.label ?? 'School holiday',
    }));
  const listBlock = (
    title: string,
    items: Array<{ date: string; label: string }>
  ) => {
    aoa.push([title]);
    for (const it of items) aoa.push([shortDate(it.date), it.label]);
  };
  listBlock(
    'SCHOOL EVENTS',
    schoolEvents.map((e) => ({ date: e.startDate, label: e.label }))
  );
  listBlock('SCHOOL HOLIDAY', shRows);
  listBlock('PUBLIC HOLIDAY', phRows);
  listBlock(
    'EXAMINATION',
    exams.map((e) => ({ date: e.startDate, label: e.label }))
  );
  aoa.push([]);

  // ── Grid header rows ──
  // Row A: fixed roster headers + date tags + summary block group labels.
  // Row B: blank roster cells + the date numbers + summary sub-columns.
  const fixedHeaders = [
    'Index No',
    'Bus No. / Student Care',
    'Academics',
    'Admin',
    'Full Name',
  ];
  const tagRow: (string | number)[] = fixedHeaders.map(() => '');
  const dateRow: (string | number)[] = [...fixedHeaders];

  for (const iso of dates) {
    const cal = input.calendarByDate.get(iso) ?? null;
    const tag = resolveColumnTag({
      dayType: cal?.dayType ?? null,
      events: eventsByDate(iso),
    });
    tagRow.push(tag ?? '');
    dateRow.push(shortDate(iso));
  }

  // Summary group headers: one block per month + a term-total block.
  // Merges are computed at r:0 as placeholders; re-based onto the real
  // header row index after the aoa is fully assembled above.
  for (const mk of summaryBlocks) {
    const groupLabel =
      mk === 'TERM' ? `${input.term.label} total` : monthLabelOf(mk);
    const start = tagRow.length;
    tagRow.push(groupLabel);
    dateRow.push(SUMMARY_SUBCOLS[0]);
    for (let i = 1; i < SUMMARY_SUBCOLS.length; i++) {
      tagRow.push('');
      dateRow.push(SUMMARY_SUBCOLS[i]);
    }
    merges.push({ s: { r: 0, c: start }, e: { r: 0, c: tagRow.length - 1 } });
  }

  // The two header rows are appended now — record the real row index so we can
  // re-base the placeholder merges.
  const tagRowIndex = aoa.length;
  aoa.push(tagRow);
  aoa.push(dateRow);

  // Re-base the summary group merges onto tagRowIndex.
  const rebased = merges.map((m) => ({
    s: { r: tagRowIndex, c: m.s.c },
    e: { r: tagRowIndex, c: m.e.c },
  }));

  // ── Student rows ──
  for (const st of input.students) {
    const row: (string | number)[] = [
      st.indexNumber,
      st.busCare ?? '',
      '', // Academics — placeholder (v1)
      '', // Admin — placeholder (v1)
      st.withdrawn ? `${st.fullName || ''} (Withdrawn)`.trim() : st.fullName,
    ];
    for (const iso of dates) {
      const s = st.marksByDate.get(iso) ?? null;
      row.push(s && s !== 'NC' ? s : ''); // NC → blank (matches template)
    }
    // Per-month + term summary VALUES. Dates before enrollmentDate are
    // excluded here (matching buildTermSummaryRows' proration) — the raw
    // per-day cells above are left untouched, same posture as the live
    // Term sheet grid, which dims pre-enrollment cells but still shows them.
    const allMarks: Mark[] = dates
      .filter((d) => !st.enrollmentDate || d >= st.enrollmentDate)
      .map((d) => ({
        date: d,
        status: st.marksByDate.get(d) ?? null,
      }));
    for (const mk of summaryBlocks) {
      const scoped =
        mk === 'TERM'
          ? allMarks
          : allMarks.filter((m) => m.date.slice(0, 7) === mk);
      const stat = summarizeMarks(scoped);
      row.push(
        stat.totalDays,
        stat.present,
        stat.late,
        stat.excused,
        stat.absent,
        stat.attendancePct == null ? '' : stat.attendancePct
      );
    }
    aoa.push(row);
  }

  // ── Build worksheet ──
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Title merges across the first few columns for readability.
  rebased.push(
    { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } }
  );
  ws['!merges'] = rebased;
  return ws;
}
