import type {
  DashboardExport,
  ExportSection,
} from '@/lib/export/dashboard-export';
import type {
  AcademicHistoryRow,
  AttendanceHistoryRow,
  PlacementRow,
  StudentHeader,
} from '@/lib/sis/records-history';
import { toPlainText } from '@/lib/rich-text';

// ONE CHILD'S WHOLE RECORD, as a file somebody can send.
//
// ── WHY ────────────────────────────────────────────────────────────────────
//
// Miss Joann, 2026-09-15 registrar training, on the consolidated file: it is
// _"importante sa lahat"_, it is requested by Ms. Chandana, and it holds per
// student per term the attendance and the grades per subject. She has agreed it
// is retired into the SIS.
//
// The masterfile export is its cohort-shaped equivalent, but it is LEVEL
// SCOPED: handing one child's record to somebody meant exporting an entire
// year group and deleting 60 rows, which nobody does — so in practice the
// answer was "open the screen and read it out". This is the missing half.
//
// ⚠ PURE. It takes what the student page has already loaded and rearranges it;
// it issues no queries of its own. The page is the only place that decides who
// may see this record, and a builder that could fetch would be a second place
// to get that wrong.
//
// ⚠ Cross-year by construction. Every section is grouped by academic year,
// because a child's record is their whole time at the school — that is what
// `studentNumber` being the stable id is FOR (Hard Rule #4), and a leaver's
// transcript is the case this has to serve.

export type StudentRecordExportInput = {
  student: StudentHeader;
  placements: PlacementRow[];
  academic: AcademicHistoryRow[];
  attendance: AttendanceHistoryRow[];
  /** `${ayCode}|${termNumber}` → "12 Aug absent · 3 Sep late". May be empty. */
  missedDates?: Map<string, string>;
  writeups?: Array<{
    ayCode: string;
    termNumber: number;
    virtueTheme: string | null;
    writeup: string | null;
  }>;
};

function fullName(s: StudentHeader): string {
  return [s.lastName, s.firstName, s.middleName]
    .filter((p) => p && p.trim().length > 0)
    .join(', ');
}

const STATUS_LABEL: Record<string, string> = {
  active: 'Enrolled',
  late_enrollee: 'Late enrolment',
  withdrawn: 'Withdrawn',
};

/** `attendance_records` counts P, L and EX alike into `days_present` (migration 014). */
function attendanceRate(
  present: number | null,
  schoolDays: number | null
): string {
  if (present == null || !schoolDays) return '';
  return `${Math.round((present / schoolDays) * 1000) / 10}%`;
}

export function buildStudentRecordExport(
  input: StudentRecordExportInput
): DashboardExport {
  const { student, placements, academic, attendance } = input;
  const name = fullName(student);
  const sections: ExportSection[] = [];

  // ---- Classes, year by year -------------------------------------------
  sections.push({
    title: 'Classes',
    headers: [
      'Year',
      'Level',
      'Class',
      'Number',
      'Status',
      'Started',
      'Left',
      'Reason for leaving',
    ],
    rows: placements.map((p) => [
      p.ayCode,
      p.levelLabel || p.levelCode,
      p.sectionName,
      p.indexNumber,
      STATUS_LABEL[p.enrollmentStatus] ?? p.enrollmentStatus,
      p.enrollmentDate ?? '',
      p.withdrawalDate ?? '',
      p.withdrawalReason ?? '',
    ]),
  });

  // ---- Grades, one row per (year × subject) ----------------------------
  //
  // Terms across, subjects down — the shape of the grading sheet the school
  // already reads, rather than one row per (subject × term), which is correct
  // and unreadable.
  for (const year of academic) {
    const termNumbers = [...new Set(year.terms.map((t) => t.termNumber))].sort(
      (a, b) => a - b
    );
    const subjectCodes = [
      ...new Set(
        year.terms.flatMap((t) => t.subjects.map((s) => s.subjectCode))
      ),
    ].sort();

    if (subjectCodes.length === 0) continue;

    const byKey = new Map<
      string,
      (typeof year.terms)[number]['subjects'][number]
    >();
    for (const term of year.terms) {
      for (const s of term.subjects) {
        byKey.set(`${term.termNumber}|${s.subjectCode}`, s);
      }
    }

    sections.push({
      title: `Grades — ${year.ayLabel || year.ayCode}`,
      headers: ['Subject', ...termNumbers.map((n) => `Term ${n}`), 'Year-end'],
      rows: subjectCodes.map((code) => {
        const anyCell = termNumbers
          .map((n) => byKey.get(`${n}|${code}`))
          .find(Boolean);
        const cells: (string | number | null)[] = [
          anyCell?.subjectName || code,
        ];
        for (const n of termNumbers) {
          const cell = byKey.get(`${n}|${code}`);
          if (!cell) {
            cells.push('');
            continue;
          }
          // A letter subject's number is a band stand-in, not a mark (KD #176),
          // so the letter is what belongs in a record somebody reads.
          cells.push(
            cell.isExaminable
              ? (cell.quarterlyGrade ?? '')
              : (cell.annualLetterGrade ?? cell.quarterlyGrade ?? '')
          );
        }
        const t4 = byKey.get(`4|${code}`);
        cells.push(t4?.annualLetterGrade ?? '');
        return cells;
      }),
    });
  }

  // ---- Attendance, with the dates behind the counts ---------------------
  for (const year of attendance) {
    if (year.terms.length === 0) continue;
    sections.push({
      title: `Attendance — ${year.ayLabel || year.ayCode}`,
      headers: [
        'Term',
        'School days',
        'Present',
        'Late',
        'Attendance',
        'Days missed',
      ],
      rows: year.terms.map((t) => [
        `Term ${t.termNumber}`,
        t.schoolDays ?? '',
        t.daysPresent ?? '',
        t.daysLate ?? '',
        attendanceRate(t.daysPresent, t.schoolDays),
        input.missedDates?.get(`${year.ayCode}|${t.termNumber}`) ?? '',
      ]),
    });
  }

  // ---- The form adviser's write-ups -------------------------------------
  const writeups = (input.writeups ?? []).filter(
    (w) => w.writeup && toPlainText(w.writeup).trim().length > 0
  );
  if (writeups.length > 0) {
    sections.push({
      title: "Form class adviser's comments",
      headers: ['Year', 'Term', 'Virtue theme', 'Comment'],
      rows: writeups.map((w) => [
        w.ayCode,
        `Term ${w.termNumber}`,
        w.virtueTheme ?? '',
        // These columns hold HTML (KD #205). Anything LEAVING the app is
        // stripped — a <ul> in a spreadsheet cell is not a list, it is markup.
        toPlainText(w.writeup ?? ''),
      ]),
    });
  }

  return {
    filename: `student-record-${student.studentNumber}.csv`,
    scope: [
      ['Student', name],
      ['Student number', student.studentNumber],
    ],
    sections,
  };
}
