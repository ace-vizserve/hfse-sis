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
  students: Array<{
    indexNumber: number;
    fullName: string;
    busCare: string | null;
    withdrawn: boolean;
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

function shortDate(iso: string): string {
  return new Date(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10))
  ).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
}

export function buildAttendanceSheetWorkbook(
  input: AttendanceSheetExportInput
): Buffer {
  const dates = eachDateInclusive(input.term.startDate, input.term.endDate);
  const months = monthsInRange(input.term.startDate, input.term.endDate);
  const eventsByDate = (iso: string) =>
    input.events.filter((e) => iso >= e.startDate && iso <= e.endDate);

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
  aoa.push([]);

  // ── Dated lists (Events / Holidays / PH / Examination) ──
  const exams = input.events.filter((e) => e.category === 'term_exam');
  const schoolEvents = input.events.filter((e) => e.category !== 'term_exam');
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
  for (const mk of [...months, 'TERM']) {
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
    // Per-month + term summary VALUES.
    const allMarks: Mark[] = dates.map((d) => ({
      date: d,
      status: st.marksByDate.get(d) ?? null,
    }));
    for (const mk of [...months, 'TERM']) {
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

  const wb = XLSX.utils.book_new();
  // Excel tab names cap at 31 chars and forbid : \ / ? * [ ].
  const safeTab = input.sheetName.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31);
  XLSX.utils.book_append_sheet(wb, ws, safeTab);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
