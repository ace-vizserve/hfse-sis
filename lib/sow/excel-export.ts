import * as XLSX from 'xlsx';

import { toPlainText } from '@/lib/rich-text';
import type { SowModule } from '@/lib/schemas/sow';

// Download a scheme of work in the school's "Module Syllabus" layout — the
// same one `excel-import.ts` reads (its top comment records the layout). The
// labels below are the importer's, so a file downloaded here imports back
// unchanged; the round-trip test is what keeps the two from drifting.
//
//   - one tab, named after the level
//   - header block (rows 3-13): label in A, value in B merged to F
//   - the week table's header at row 17, "Monitoring Module Delivery" beside it
//   - one 6-row block per week, A-F merged down the six rows, the text on the
//     block's first row; column A reads "Week N", its dates, then the events
//   - the monitoring block (G-K) is drawn with its headings and tick-box
//     labels but left empty — it is filled in by hand on paper
//
// There is no separate Assessment column in the template, so a week's
// assessment is written under its activities in column E.

export type SowForExport = {
  module: SowModule;
  levelLabel: string;
  ayCode: string;
  termNumber: number;
  termStart: string | null;
  termEnd: string | null;
  /** Numbered weeks only; break rows have no number and are not written. */
  weeks: {
    weekNumber: number;
    startsOn: string;
    endsOn: string;
    events: string[];
    topic: string | null;
    learningOutcomes: string | null;
    textbookPages: string | null;
    activities: string | null;
    assessment: string | null;
    remarks: string | null;
  }[];
};

const BLOCK_ROWS = 6;
const HEADER_ROW = 16; // row 17 in Excel

const MONTHS = [
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
];

/** "2026-10-05" as "5 Oct". */
function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

function longDate(iso: string): string {
  return `${shortDate(iso)} ${iso.slice(0, 4)}`;
}

/** Excel tab names: at most 31 characters, none of  [ ] : * ? / \ */
const tabName = (label: string) =>
  label
    .replace(/[[\]:*?/\\]/g, ' ')
    .trim()
    .slice(0, 31) || 'Scheme of Work';

export function buildSowWorkbook(sow: SowForExport): ArrayBuffer {
  const aoa: (string | boolean)[][] = [];
  const at = (r: number, c: number, v: string | boolean) => {
    (aoa[r] ??= [])[c] = v;
  };
  const merges: XLSX.Range[] = [];

  at(0, 0, 'Module Syllabus');

  const m = sow.module;
  const term =
    sow.termStart && sow.termEnd
      ? `${longDate(sow.termStart)} to ${longDate(sow.termEnd)} (Term ${sow.termNumber})`
      : `${sow.ayCode} Term ${sow.termNumber}`;
  const headerBlock: [string, string][] = [
    ['Module Title', m.title ?? ''],
    ['Module Syllabus no. (if any)', m.syllabus ?? ''],
    ['Course', sow.levelLabel],
    ['Date', term],
    ['No of teaching hours', m.hoursPerWeek ?? ''],
    ['Teaching Methods', m.teachingMethods ?? ''],
    // Weights come from subject setup, so there is nothing to write here.
    ['Assessment Methods and Weightages', ''],
    ['Requirement for pass in module', m.passRequirement ?? ''],
    // Two spaces in the real file.
    ['Textbook or  materials to be used', m.textbook ?? ''],
    ['Additional reference texts (if any)', m.references ?? ''],
    ['Additional Remarks (if any)', m.remarks ?? ''],
  ];
  headerBlock.forEach(([label, value], i) => {
    const r = 2 + i;
    at(r, 0, label);
    // A blank value still gets its cell, so the merge and the layout are the
    // template's.
    if (value !== '') at(r, 1, value);
    merges.push({ s: { r, c: 1 }, e: { r, c: 5 } });
  });

  at(HEADER_ROW - 2, 0, 'Scheme of Work / Lesson Plan');
  at(HEADER_ROW - 1, 6, 'Monitoring Module Delivery');
  merges.push({
    s: { r: HEADER_ROW - 1, c: 6 },
    e: { r: HEADER_ROW - 1, c: 10 },
  });
  const heads: (string | null)[] = [
    'Week',
    'Topic in syllabus',
    'Syllabus / Content / Learning Outcomes',
    'Textbook / chapters / pages',
    'Teaching and Learning Activities / Assessment',
    'Remarks',
    'Teacher (1) Remark',
    null,
    'Teacher (2) Remark',
    null,
    "Supervisor's Remarks & Date",
  ];
  heads.forEach((h, c) => {
    if (h) at(HEADER_ROW, c, h);
  });
  merges.push({ s: { r: HEADER_ROW, c: 6 }, e: { r: HEADER_ROW, c: 7 } });
  merges.push({ s: { r: HEADER_ROW, c: 8 }, e: { r: HEADER_ROW, c: 9 } });

  const plain = (html: string | null) => toPlainText(html);
  const sorted = [...sow.weeks].sort((a, b) => a.weekNumber - b.weekNumber);
  sorted.forEach((w, i) => {
    const r = HEADER_ROW + 1 + i * BLOCK_ROWS;

    const when = `${shortDate(w.startsOn)} to ${shortDate(w.endsOn)}`;
    at(
      r,
      0,
      [
        `Week ${w.weekNumber}`,
        when,
        ...(w.events.length > 0 ? ['', ...w.events] : []),
      ].join('\r\n')
    );
    if (w.topic) at(r, 1, w.topic);
    const outcomes = plain(w.learningOutcomes);
    if (outcomes) at(r, 2, outcomes);
    if (w.textbookPages) at(r, 3, w.textbookPages);
    const activities = [plain(w.activities), plain(w.assessment)]
      .filter((t) => t !== '')
      .join('\n');
    if (activities) at(r, 4, activities);
    const remarks = plain(w.remarks);
    if (remarks) at(r, 5, remarks);

    // The monitoring block, drawn but empty: unticked boxes, the wording the
    // paper form uses, and the initials line.
    [
      'Followed scheme of work as planned.',
      'Followed with minor adjustments.',
      'Delayed.',
      'Extra activities were added.',
      'Other:',
    ].forEach((t, k) => {
      at(r + k, 7, t);
      at(r + k, 9, t);
    });
    at(r + 5, 6, "Teacher's initials & date: ________________");
    at(r + 5, 8, "Teacher's initials & date: ________________");

    for (const c of [0, 1, 2, 3, 4, 5, 10]) {
      merges.push({ s: { r, c }, e: { r: r + BLOCK_ROWS - 1, c } });
    }
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = merges;
  ws['!cols'] = [
    { wch: 18 },
    { wch: 26 },
    { wch: 40 },
    { wch: 20 },
    { wch: 40 },
    { wch: 26 },
    { wch: 5 },
    { wch: 30 },
    { wch: 5 },
    { wch: 30 },
    { wch: 32 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, tabName(sow.levelLabel));
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}
