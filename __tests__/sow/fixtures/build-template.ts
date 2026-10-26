import * as XLSX from 'xlsx';

// A synthetic copy of the school's "Module Syllabus" template, with invented
// content. Christina's real file is not in the repo; this follows its layout
// (recorded at the top of lib/sow/excel-import.ts):
//
//   rows 3-13   label in column A, value in column B (merged B:F)
//   row 17      the week table's header row (A "Week" ... F "Remarks"), with
//               the "Monitoring Module Delivery" columns G-K beside it
//   row 18 on   one 6-row block per week; the week's cells are merged down six
//               rows, so the text sits on the block's first row. The monitoring
//               block repeats its five tick-box rows beside every week.

export type TemplateWeek = {
  /** First line of the week cell is "Week N". */
  number: number;
  topic?: string;
  outcomes?: string;
  pages?: string;
  activities?: string;
  remarks?: string;
};

export type TemplateTab = {
  name: string;
  weeks?: TemplateWeek[];
  /** Overrides for the header block's values, by label. */
  header?: Partial<Record<string, string>>;
  /** Extra "label / value" rows in the header block the SIS has no field for. */
  extraHeaderRows?: [string, string][];
};

const HEADER_ROWS: [string, string][] = [
  ['Module Title', 'Science'],
  ['Module Syllabus no. (if any)', 'Invented Science Syllabus'],
  ['Course', 'Secondary One'],
  ['Date', '24 March to 29 May 2026 (Term 2)'],
  ['No of teaching hours', '5 hours per week'],
  ['Teaching Methods', 'Inquiry; hands-on practicals'],
  ['Assessment Methods and Weightages', 'WW 40%; PT 40%; QA 20%'],
  ['Requirement for pass in module', 'At least 75 out of 100'],
  ['Textbook or  materials to be used', 'Science textbook 1'],
  ['Additional reference texts (if any)', 'Teacher slides'],
  ['Additional Remarks (if any)', 'Aim: curiosity'],
];

export function defaultWeeks(count: number): TemplateWeek[] {
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    return {
      number: n,
      topic: `Topic ${n}`,
      outcomes: `Outcome ${n}a\nOutcome ${n}b`,
      pages: `Pages ${n}0-${n}9`,
      activities: `Activity ${n}`,
      remarks: `Remark ${n}`,
    };
  });
}

function buildSheet(tab: TemplateTab): XLSX.WorkSheet {
  const aoa: (string | boolean | null)[][] = [];
  const at = (r: number, c: number, v: string | boolean) => {
    (aoa[r] ??= [])[c] = v;
  };

  at(0, 0, 'Module Syllabus');
  const merges: XLSX.Range[] = [];
  const rows = [...HEADER_ROWS, ...(tab.extraHeaderRows ?? [])];
  rows.forEach(([label, value], i) => {
    const r = 2 + i;
    at(r, 0, label);
    at(r, 1, tab.header?.[label] ?? value);
    merges.push({ s: { r, c: 1 }, e: { r, c: 5 } });
  });

  // The week table sits at row 17 (index 16) whatever the header block holds,
  // as in the real file; extra header rows push it down.
  const headerRow = Math.max(16, 2 + rows.length + 2);
  at(headerRow - 2, 0, 'Scheme of Work / Lesson Plan');
  at(headerRow - 1, 6, 'Monitoring Module Delivery');
  const heads = [
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
    if (h) at(headerRow, c, h);
  });

  (tab.weeks ?? []).forEach((w, i) => {
    const r = headerRow + 1 + i * 6;
    at(
      r,
      0,
      `Week ${w.number}\r\n1 Jan to 5 Jan\r\n\r\n2 Jan\r\nInvented holiday`
    );
    if (w.topic !== undefined) at(r, 1, w.topic);
    if (w.outcomes !== undefined) at(r, 2, w.outcomes);
    if (w.pages !== undefined) at(r, 3, w.pages);
    if (w.activities !== undefined) at(r, 4, w.activities);
    if (w.remarks !== undefined) at(r, 5, w.remarks);
    // The monitoring block: tick boxes and canned wording beside every week.
    [
      'Followed as planned.',
      'Minor adjustments.',
      'Delays.',
      'Extra.',
      'Other',
    ].forEach((t, k) => {
      at(r + k, 6, false);
      at(r + k, 7, t);
      at(r + k, 8, false);
      at(r + k, 9, t);
    });
    at(r + 5, 6, "Teacher's initials & date: ________________");
    at(r, 10, 'For supervisor review: invented text.');
    for (let c = 0; c <= 5; c++) {
      merges.push({ s: { r, c }, e: { r: r + 5, c } });
    }
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = merges;
  return ws;
}

/** An .xlsx as bytes, one tab per entry. */
export function buildTemplate(tabs: TemplateTab[]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const t of tabs) XLSX.utils.book_append_sheet(wb, buildSheet(t), t.name);
  const out = XLSX.write(wb, {
    type: 'array',
    bookType: 'xlsx',
  }) as ArrayBuffer;
  return out;
}
