import * as XLSX from 'xlsx';

import {
  SOW_MODULE_CAPS,
  SOW_WEEK_PLAIN_CAPS,
  type SowModule,
} from '@/lib/schemas/sow';

// One-time import of a scheme of work from the school's Excel template (the
// "Module Syllabus" workbook, one tab per level).
//
// ── Layout, recorded from "AY2026 Term 2 Science SOW Secondary.xlsx" ─────────
// (four tabs: "Secondary 1" .. "Secondary 4"; every tab has the same shape,
// though Secondary 3 ends a row earlier — which is why nothing below is read
// by fixed coordinates, only by label.)
//
//   A1            "Module Syllabus" (title, ignored)
//   rows 3-13     header block. Label in column A, value in column B (merged
//                 B:F), one per row:
//                   Module Title                         -> module.title
//                   Module Syllabus no. (if any)         -> module.syllabus
//                   Course                               -> ignored (the level
//                                                           comes from the tab)
//                   Date                                 -> ignored (the SIS
//                                                           dates every week
//                                                           from the calendar)
//                   No of teaching hours                 -> module.hoursPerWeek
//                   Teaching Methods                     -> module.teachingMethods
//                   Assessment Methods and Weightages    -> ignored (weights
//                                                           come from subject
//                                                           setup)
//                   Requirement for pass in module       -> module.passRequirement
//                   Textbook or  materials to be used    -> module.textbook
//                                                           (two spaces in the
//                                                           real file)
//                   Additional reference texts (if any)  -> module.references
//                   Additional Remarks (if any)          -> module.remarks
//   A15           "Scheme of Work / Lesson Plan" (section title, no value)
//   G16           "Monitoring Module Delivery" over columns G-K — IGNORED.
//   row 17        the week table's header row:
//                   A Week | B Topic in syllabus
//                   | C Syllabus / Content / Learning Outcomes
//                   | D Textbook / chapters / pages
//                   | E Teaching and Learning Activities / Assessment
//                   | F Remarks
//                   | G Teacher (1) Remark | I Teacher (2) Remark
//                   | K Supervisor's Remarks & Date          (G-K: monitoring)
//   row 18 on     one block of SIX rows per week, columns A-F merged down the
//                 six rows (K too), so a week's text sits on the block's FIRST
//                 row. Column A reads "Week N" then the week's dates and the
//                 school events on later lines ("Week 1\r\n23 Mar to 27 Mar
//                 \r\n\r\n23 Mar\r\nIn Lieu of Hari Raya Puasa ..."); only N is
//                 used — dates and events come from the SIS calendar. Beside
//                 each block G-J repeat five tick-box rows ("Followed scheme of
//                 work as planned." ...) and "Teacher's initials & date", and K
//                 holds the supervisor's canned line — the monitoring block.
//   The real file has 10 weeks per tab (Term 2, AY2026).
//
// There is no separate Assessment column: column E holds activities AND
// assessment in one cell, so it all lands in `activities` and `assessment` is
// left empty for the teacher to split if they want to.

export type ParsedSow = {
  module: SowModule;
  weeks: {
    weekNumber: number;
    topic: string;
    learningOutcomes: string;
    textbookPages: string;
    activities: string;
    assessment: string;
    remarks: string;
  }[];
  warnings: string[];
};

export type ParseResult =
  | { ok: true; sow: ParsedSow }
  | { ok: false; error: string };

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const RICH_CAP = 20000;

// ── Text helpers ────────────────────────────────────────────────────────────

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Plain text from a cell as rich-text HTML: a blank line starts a new
 * paragraph, a single line break stays a line break inside it. Everything is
 * escaped, so nothing in a spreadsheet can become markup.
 */
export function plainTextToRichHtml(text: string): string {
  const clean = text.replace(/\r\n?/g, '\n').trim();
  if (clean === '') return '';
  return clean
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter((p) => p !== '')
    .map(
      (p) =>
        `<p>${p
          .split('\n')
          .map((line) => escapeHtml(line.trim()))
          .join('<br>')}</p>`
    )
    .join('');
}

/** A cell as text: line endings fixed, ends trimmed. */
const cellText = (v: unknown): string =>
  v === null || v === undefined ? '' : String(v).replace(/\r\n?/g, '\n').trim();

/** A cell for a single-line field: its lines joined with " / ". */
const oneLine = (s: string) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .join(' / ');

/** Label comparison: case, spacing and a trailing colon do not matter. */
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*:+\s*$/, '')
    .trim();

const listNumbers = (nums: number[]) =>
  nums.length <= 1
    ? String(nums[0])
    : `${nums.slice(0, -1).join(', ')} and ${nums[nums.length - 1]}`;

// ── Tab matching ────────────────────────────────────────────────────────────

const NUMBER_WORDS: Record<string, string> = {
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
};

/** "Secondary 1", "Sec 1", "S1", "Secondary One" all become "s1". */
function levelKey(name: string): string | null {
  const m = name
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .match(
      /^(primary|pri|p|secondary|sec|s)\s?(\d|one|two|three|four|five|six)$/
    );
  if (!m) return null;
  const kind = m[1].startsWith('p') ? 'p' : 's';
  return `${kind}${NUMBER_WORDS[m[2]] ?? m[2]}`;
}

function findTab(names: string[], levelLabel: string): string | undefined {
  const want = levelKey(levelLabel);
  if (want) return names.find((n) => levelKey(n) === want);
  const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return names.find((n) => plain(n) === plain(levelLabel));
}

// ── Header block ────────────────────────────────────────────────────────────

const MODULE_LABELS: { key: keyof typeof SOW_MODULE_CAPS; test: RegExp }[] = [
  { key: 'title', test: /^module title$/ },
  { key: 'syllabus', test: /^module syllabus no/ },
  { key: 'hoursPerWeek', test: /^no\.? of teaching hours/ },
  { key: 'teachingMethods', test: /^teaching methods/ },
  { key: 'passRequirement', test: /^requirement for pass/ },
  { key: 'textbook', test: /^textbook or/ },
  { key: 'references', test: /^additional reference/ },
  { key: 'remarks', test: /^additional remarks/ },
];

const MODULE_FIELD_NAMES: Record<keyof typeof SOW_MODULE_CAPS, string> = {
  title: 'module title',
  syllabus: 'syllabus',
  hoursPerWeek: 'hours per week',
  teachingMethods: 'teaching methods',
  passRequirement: 'pass requirement',
  textbook: 'textbook',
  references: 'references',
  remarks: 'remarks',
};

// Labels the template has and the SIS deliberately does not take.
const IGNORED_LABELS = [
  /^module syllabus$/,
  /^course$/,
  /^date$/,
  /^assessment methods/,
  /^scheme of work/,
  /^monitoring module delivery$/,
];

// ── The parser ──────────────────────────────────────────────────────────────

export function parseSowWorkbook(
  buf: ArrayBuffer,
  levelLabel: string,
  opts: { termWeekCount?: number } = {}
): ParseResult {
  // An .xlsx is a zip ("PK"); without this check xlsx would happily read a
  // text or CSV file as a one-tab workbook.
  const NOT_XLSX = 'This file could not be read. Choose an Excel (.xlsx) file.';
  const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  if (head.length < 4 || head[0] !== 0x50 || head[1] !== 0x4b) {
    return { ok: false, error: NOT_XLSX };
  }
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: 'array' });
  } catch {
    return { ok: false, error: NOT_XLSX };
  }
  if (wb.SheetNames.length === 0) return { ok: false, error: NOT_XLSX };

  const tab = findTab(wb.SheetNames, levelLabel);
  if (!tab) {
    return { ok: false, error: `This file has no tab for ${levelLabel}.` };
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[tab], {
    header: 1,
    raw: false,
    defval: '',
    blankrows: true,
  });
  const text = (r: number, c: number) => cellText(rows[r]?.[c]);

  // The week table's header row: the one with both "Week" and a "Topic ..."
  // heading in it.
  let headerRow = -1;
  const cols = {
    week: -1,
    topic: -1,
    outcomes: -1,
    pages: -1,
    activities: -1,
    remarks: -1,
  };
  for (let r = 0; r < rows.length && headerRow < 0; r++) {
    const labels = (rows[r] ?? []).map((c) => norm(cellText(c)));
    const week = labels.findIndex((l) => l === 'week');
    const topic = labels.findIndex((l) => l.startsWith('topic'));
    if (week >= 0 && topic >= 0) {
      headerRow = r;
      cols.week = week;
      cols.topic = topic;
      // First match left to right, so the monitoring columns on the right
      // ("Teacher (1) Remark", "Supervisor's Remarks & Date") never win.
      cols.outcomes = labels.findIndex(
        (l) => l.includes('learning outcomes') || l.startsWith('syllabus')
      );
      cols.pages = labels.findIndex((l) => l.startsWith('textbook'));
      cols.activities = labels.findIndex(
        (l) => l.includes('activities') || l.includes('assessment')
      );
      cols.remarks = labels.findIndex((l) => l === 'remarks' || l === 'remark');
    }
  }
  if (headerRow < 0) {
    return {
      ok: false,
      error: `The ${tab} tab has no week table. Is this the school's Module Syllabus template?`,
    };
  }

  const warnings: string[] = [];

  // Header block: label in one column, its value to the right.
  const module: SowModule = {};
  let labelCol = 0;
  for (let r = 0; r < headerRow; r++) {
    for (let c = 0; c < (rows[r]?.length ?? 0); c++) {
      if (norm(text(r, c)) === 'module title') labelCol = c;
    }
  }
  for (let r = 0; r < headerRow; r++) {
    const label = norm(text(r, labelCol));
    if (label === '') continue;
    let value = '';
    for (
      let c = labelCol + 1;
      c < (rows[r]?.length ?? 0) && value === '';
      c++
    ) {
      value = text(r, c);
    }
    const field = MODULE_LABELS.find((f) => f.test.test(label));
    if (field) {
      const v = oneLine(value);
      if (v === '') continue;
      module[field.key] = v;
      if (v.length > SOW_MODULE_CAPS[field.key]) {
        warnings.push(
          `The ${MODULE_FIELD_NAMES[field.key]} in the module details is longer than the ${SOW_MODULE_CAPS[field.key]} characters allowed. It was kept; shorten it before you send the SOW for review.`
        );
      }
      continue;
    }
    if (IGNORED_LABELS.some((t) => t.test(label))) continue;
    if (value !== '') {
      warnings.push(
        `"${text(r, labelCol).replace(/\s*:+\s*$/, '')}" is not part of a scheme of work here, so it was left out.`
      );
    }
  }

  // Week blocks: a row whose week cell starts "Week N". Only the six template
  // columns are read, so the monitoring block beside them is never touched.
  const weeks: ParsedSow['weeks'] = [];
  const seen = new Set<number>();
  for (let r = headerRow + 1; r < rows.length; r++) {
    const m = text(r, cols.week).match(/^week\s*(\d+)/i);
    if (!m) continue;
    const weekNumber = Number(m[1]);
    if (weekNumber < 1) continue;
    if (seen.has(weekNumber)) {
      warnings.push(
        `Week ${weekNumber} appears more than once in the file. The first one was used.`
      );
      continue;
    }
    seen.add(weekNumber);

    const get = (c: number) => (c < 0 ? '' : text(r, c));
    const week = {
      weekNumber,
      topic: oneLine(get(cols.topic)),
      learningOutcomes: plainTextToRichHtml(get(cols.outcomes)),
      textbookPages: oneLine(get(cols.pages)),
      activities: plainTextToRichHtml(get(cols.activities)),
      assessment: '',
      remarks: plainTextToRichHtml(get(cols.remarks)),
    };
    const tooLong = (name: string, len: number, cap: number) => {
      if (len > cap) {
        warnings.push(
          `Week ${weekNumber}: the ${name} is longer than the ${cap} characters allowed. It was kept; shorten it before you send the SOW for review.`
        );
      }
    };
    tooLong('topic', week.topic.length, SOW_WEEK_PLAIN_CAPS.topic);
    tooLong(
      'textbook pages',
      week.textbookPages.length,
      SOW_WEEK_PLAIN_CAPS.textbookPages
    );
    tooLong('learning outcomes', week.learningOutcomes.length, RICH_CAP);
    tooLong('activities', week.activities.length, RICH_CAP);
    tooLong('remarks', week.remarks.length, RICH_CAP);
    weeks.push(week);
  }

  if (weeks.length === 0) {
    return {
      ok: false,
      error: `The ${tab} tab has a week table, but no weeks in it.`,
    };
  }
  weeks.sort((a, b) => a.weekNumber - b.weekNumber);

  const termCount = opts.termWeekCount;
  if (termCount !== undefined && termCount > 0) {
    const extra = weeks.map((w) => w.weekNumber).filter((n) => n > termCount);
    const missing: number[] = [];
    for (let n = 1; n <= termCount; n++) if (!seen.has(n)) missing.push(n);
    if (extra.length > 0) {
      warnings.push(
        `This term has ${termCount} teaching weeks, but the file has ${weeks.length}. ${
          extra.length === 1
            ? `Week ${extra[0]} is added after the last week, and has`
            : `Weeks ${listNumbers(extra)} are added after the last week, and have`
        } to be merged or deleted before you send the SOW for review.`
      );
    }
    if (missing.length > 0) {
      warnings.push(
        `This term has ${termCount} teaching weeks, but the file only has ${weeks.length}. ${
          missing.length === 1
            ? `Week ${missing[0]} starts`
            : `Weeks ${listNumbers(missing)} start`
        } empty.`
      );
    }
  }

  return { ok: true, sow: { module, weeks, warnings } };
}
