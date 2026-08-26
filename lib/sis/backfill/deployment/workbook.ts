// Parses Mr Hanafi's "Teachers Deployment" workbook into teacher assignments.
//
// Pure module — no database, no filesystem beyond the workbook itself, so the
// parsing rules can be tested without production access.
//
// ─────────────────────────────────────────────────────────────────────────
// WHAT THIS FILE IS AND HOW TO READ IT
//
// The workbook is a working school timetable, not an export. It holds the same
// assignments three times over, in three different shapes:
//
//   * CLASS-MAJOR  (`Primary_New`, `Secondary_New`) — side-by-side column
//     bands, one band per class, columns Start/End/Duration/Mon–Fri. Each cell
//     is a subject plus a teacher nickname. **This is the primary source**: it
//     is the only one where a class, a subject and a teacher sit in one cell
//     with no free text between them.
//   * TEACHER-MAJOR (`Final Update_New`) — one COLUMN per teacher, each cell a
//     run of free text ("Sec 3 Humanities Tue Literature Wed Sec 4 Humanities
//     Thu"). Used as a CROSS-CHECK, never as the primary read: the free text
//     cannot be tokenised with the confidence the grid gives.
//   * PER-TEACHER (`Ms Jing`, `Ms Med`, …) — the same free text again, for 7
//     of the 26 teachers.
//
// ⚠ THREE THINGS THAT PRODUCED WRONG READINGS BEFORE. Keep them in mind before
// changing anything here.
//
//  1. **Bands bleed.** Classes are stacked vertically as well as side by side,
//     and every band reuses the same column indices. A parser that reads from
//     a band's header row to the end of the sheet will attribute a lower
//     class's lessons to an upper one. Bands are bounded by the NEXT header
//     row, minus its title line.
//  2. **Never truncate a row.** `Final Update_New`'s teacher header runs to
//     column 34; reading the first 320 characters of it hides the `Relief
//     Teacher` column and five secondary teachers.
//  3. **A subject shared between two teachers is NORMAL.** Sec 3 Humanities is
//     Ms Elaine on Tue/Fri and Ms Carl on Wed, and all three sheets agree on
//     that. It is ordinary timetabling — do NOT treat it as a defect in the
//     workbook. Our schema is the thing that cannot express it
//     (migration 118 allows one subject teacher per section+subject), so the
//     caller picks a teacher of record. The parser reports both, faithfully.
import * as XLSX from 'xlsx';

/** One lesson: this teacher teaches this subject to this class. */
export type LessonCell = {
  /** Sheet name + A1-style cell reference, for the review report. */
  source: string;
  /** Class exactly as the workbook writes it, e.g. "SECONDARY THREE CONSISTENCY". */
  classRaw: string;
  /** Subject exactly as written, e.g. "Physical Education and Health". */
  subjectRaw: string;
  /** Teacher nickname exactly as written, e.g. "Ms.Elaine", "Relief Teacher". */
  teacherRaw: string;
  /** Weekday column this cell sat in: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri'. */
  day: string;
};

/** The form adviser named in a class's Assembly / Homeroom row. */
export type AdviserCell = {
  source: string;
  classRaw: string;
  /** May name TWO people — the workbook does, for Sec 4. Left verbatim. */
  teacherRaw: string;
};

/**
 * A cell naming a subject but NO teacher.
 *
 * ⚠ This is a real staffing gap in the workbook, not a parse failure. Sec 1D2
 * (Cambridge) is the clearest case: its band (`Secondary_New` R7C20, days
 * X–AB) names a teacher for English and Mathematics only, leaving Science,
 * Mother Tongue, History, Personal Development and STAR blank.
 */
export type NoTeacherCell = {
  source: string;
  classRaw: string;
  subjectRaw: string;
  day: string;
};

/** A cell the parser could not read at all. Never guessed. */
export type UnparsedCell = {
  source: string;
  classRaw: string;
  text: string;
  reason: string;
};

export type ClassMajorParse = {
  lessons: LessonCell[];
  advisers: AdviserCell[];
  noTeacher: NoTeacherCell[];
  unparsed: UnparsedCell[];
  /** Class names found, in sheet order. */
  classes: string[];
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;

/**
 * Cells that are not lessons. `CCA` is here deliberately: it IS a subject in
 * our registry, but the workbook never names a teacher for it, so importing it
 * would create assignments with nobody in them.
 */
const NON_LESSON = new Set([
  'break',
  'lunch break',
  'lunch',
  'cca',
  'dismissal',
  'recess',
]);

const norm = (v: unknown): string =>
  String(v ?? '')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Keeps line breaks — the subject/teacher split depends on them. */
const rawText = (v: unknown): string =>
  String(v ?? '')
    .replace(/ /g, ' ')
    .trim();

const colLetter = (c: number): string => XLSX.utils.encode_col(c);

export type CellSplit =
  | { kind: 'ok'; subject: string; teacher: string }
  | { kind: 'no-teacher'; subject: string }
  | { kind: 'unparsed' };

/**
 * Splits one timetable cell into subject + teacher.
 *
 * The workbook writes this four different ways, all present in the same sheet:
 *   "Science\nMs Tina"              — newline separated (most common)
 *   "Humanities Ms.Elaine"          — one line, title-prefixed nickname
 *   "English Relief Teacher"        — one line, NO title (a role, not a person)
 *   "Mother Tongue (Mandarin) - Jasmine" — dash separated, bare given name
 *
 * ⚠ THE DASH FORM IS DELIBERATELY NARROW, and this is the important part.
 * Subjects contain dashes too — "Science - Chemistry", "Humanities - *SS and
 * Literature". A general dash split reads those as teachers named "Chemistry"
 * and "*SS and Literature", which is exactly the sort of confident nonsense
 * that puts the wrong name on a grading sheet. So the dash form only fires for
 * names the CALLER declares in `bareNames` — the two teachers the workbook
 * writes without a title.
 *
 * Everything else with a subject but no recognisable teacher comes back as
 * `no-teacher`, which is a real staffing gap and reported as one.
 */
export function splitSubjectTeacher(
  cell: string,
  bareNames: ReadonlySet<string> = new Set()
): CellSplit {
  const lines = cell.split(/\r?\n/).map(norm).filter(Boolean);
  if (lines.length === 0) return { kind: 'unparsed' };

  // Newline form: first line is the subject, the rest is the teacher.
  if (lines.length >= 2) {
    return { kind: 'ok', subject: lines[0], teacher: lines.slice(1).join(' ') };
  }

  const one = lines[0];

  // "Relief Teacher" is a ROLE the workbook staffs a slot with, not a name.
  // It gets its own column in `Final Update_New`, so it is first-class here.
  const relief = one.match(/^(.*?)\s*(Relief\s+Teacher)$/i);
  if (relief && norm(relief[1])) {
    return { kind: 'ok', subject: norm(relief[1]), teacher: 'Relief Teacher' };
  }

  // Title-prefixed nickname. Take the LAST title so subjects containing a
  // capital word are not mistaken for one.
  const title = /\b(Ms|Mr|Mrs|Miss)\b\.?\s*/gi;
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = title.exec(one)) !== null) last = m;
  if (last && last.index > 0) {
    return {
      kind: 'ok',
      subject: norm(one.slice(0, last.index)),
      teacher: norm(one.slice(last.index)),
    };
  }

  // Dash form — ONLY for declared bare names. See the warning above.
  const dash = one.match(/^(.*\S)\s*[-–]\s*(\S.*)$/);
  if (dash) {
    const tail = norm(dash[2]);
    if (bareNames.has(tail.toLowerCase())) {
      return { kind: 'ok', subject: norm(dash[1]), teacher: tail };
    }
    // A dash inside a subject name: keep the whole thing as the subject.
    return { kind: 'no-teacher', subject: one };
  }

  return { kind: 'no-teacher', subject: one };
}

/** True for Assembly / Homeroom rows, which name the form adviser. */
function isAdviserCell(text: string): boolean {
  return /^(assembly|homeroom)/i.test(text);
}

/**
 * Pulls the adviser out of an Assembly / Homeroom cell.
 *
 * The workbook writes "Assembly - Ms Koh", "Assembly Sec 2I2" (naming the
 * CLASS, not a person — that is the teacher-major sheet's convention) and
 * "Assembly - Ms Med & Ms Elaine". Only the person form yields an adviser.
 */
export function adviserFromCell(text: string): string | null {
  // ⚠ The connector is "&" as often as "and" — "Homeroom & Values Education
  // Mr Joseph". Matching only "and" left "& Values Education Mr Joseph" as the
  // adviser's name, which then looked like a SECOND adviser on four primary
  // classes and produced four false conflicts.
  const body = norm(text).replace(
    /^(assembly|homeroom)(\s*(and|&)\s*values\s+education)?\s*/i,
    ''
  );
  const cleaned = body.replace(/^[-–\s]+/, '').trim();
  if (!cleaned) return null;
  // A class reference, not a person.
  if (/^(sec|p\d|ys)\b/i.test(cleaned)) return null;
  if (!/\b(Ms|Mr|Mrs|Miss)\b/i.test(cleaned)) return null;
  return cleaned;
}

/**
 * Parses a class-major sheet (`Primary_New`, `Secondary_New`).
 *
 * Bands are located by their `Start Time` header cell. A band owns the five
 * columns starting three to its right (Start/End/Duration then Mon–Fri), and
 * the rows from its header down to just above the NEXT header row — see trap 1
 * in the file header.
 */
export function parseClassMajorSheet(
  sheetName: string,
  ws: XLSX.WorkSheet,
  bareNames: ReadonlySet<string> = new Set()
): ClassMajorParse {
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: '',
  });

  const headerRows = rows
    .map((r, i) =>
      r.some((c) => norm(c).toLowerCase() === 'start time') ? i : -1
    )
    .filter((i) => i >= 0);

  const lessons: LessonCell[] = [];
  const advisers: AdviserCell[] = [];
  const noTeacher: NoTeacherCell[] = [];
  const unparsed: UnparsedCell[] = [];
  const classes: string[] = [];

  headerRows.forEach((hr) => {
    const startCols: number[] = [];
    rows[hr].forEach((c, ci) => {
      if (norm(c).toLowerCase() === 'start time') startCols.push(ci);
    });

    for (const sc of startCols) {
      // ⚠ A BAND ENDS WHERE THE NEXT BAND *IN ITS OWN COLUMNS* BEGINS — not at
      // the next header row anywhere on the sheet.
      //
      // This cost the entire Secondary One timetable. `Secondary_New` puts the
      // Sec 1 pair's header on row 3 (Start Time at columns 2 and 11), and a
      // THIRD timetable — "SECONDARY 1D2 (Cambridge)" — three rows lower at
      // column 20, so its header lands on row 6. Ending every row-3 band two
      // rows above row 6 left them one row long: the Assembly row, and nothing
      // else. Both classes kept their adviser and lost every lesson, and
      // nothing reported it, because a band with no rows is not an error.
      //
      // Matching on the SAME start column is exact rather than approximate:
      // stacked bands repeat their columns (rows 3 and 16 both start at 2 and
      // 11), while a side-by-side band never shares one.
      const nextInThisColumn = headerRows.find(
        (other) =>
          other > hr &&
          norm((rows[other] ?? [])[sc]).toLowerCase() === 'start time'
      );
      // Stop above the next band's TITLE line, not its header line.
      const endRow =
        nextInThisColumn !== undefined ? nextInThisColumn - 2 : rows.length - 1;

      // The title sits in the row(s) above, at or just right of the band start.
      let classRaw = '';
      for (let up = hr - 1; up >= Math.max(0, hr - 3) && !classRaw; up--) {
        for (let k = sc; k <= sc + 3; k++) {
          const v = norm((rows[up] ?? [])[k]);
          // Skip the bare band numbers ("1", "2") that sit beside some titles.
          if (v && !/^\d+$/.test(v)) {
            classRaw = v;
            break;
          }
        }
      }
      if (!classRaw) continue;
      if (!classes.includes(classRaw)) classes.push(classRaw);

      for (let ri = hr + 1; ri <= endRow; ri++) {
        // ⚠ A row belongs to this band only if the band's own Start Time
        // column carries a time. Without this the LAST band runs to the end of
        // the sheet and swallows whatever sits below the timetable — in
        // `Secondary_New` that is a subject-per-level legend table at rows
        // 50–56, which arrived as lessons called "Subject 1" and "Secondary
        // Four" attributed to Sec 3 Consistency.
        //
        // It must be a TIME, not merely non-empty: that legend table has text
        // in some bands' start columns ("Subject 6" sits in Sec 4's), so a
        // non-empty check still let one row of it through. Times are stored as
        // Excel day fractions, i.e. numbers.
        const startCell = (rows[ri] ?? [])[sc];
        const startVal = norm(startCell);
        if (!startVal || !Number.isFinite(Number(startVal))) continue;

        DAYS.forEach((day, di) => {
          const ci = sc + 3 + di;
          const raw = rawText((rows[ri] ?? [])[ci]);
          if (!raw) return;
          const source = `${sheetName}!${colLetter(ci)}${ri + 1}`;
          const flat = norm(raw);

          if (isAdviserCell(flat)) {
            const who = adviserFromCell(flat);
            if (who) advisers.push({ source, classRaw, teacherRaw: who });
            return;
          }
          if (NON_LESSON.has(flat.toLowerCase())) return;

          const split = splitSubjectTeacher(raw, bareNames);
          if (split.kind === 'unparsed') {
            unparsed.push({
              source,
              classRaw,
              text: flat,
              reason: 'no subject/teacher split',
            });
            return;
          }
          if (NON_LESSON.has(split.subject.toLowerCase())) return;
          if (split.kind === 'no-teacher') {
            noTeacher.push({
              source,
              classRaw,
              subjectRaw: split.subject,
              day,
            });
            return;
          }
          lessons.push({
            source,
            classRaw,
            subjectRaw: split.subject,
            teacherRaw: split.teacher,
            day,
          });
        });
      }
    }
  });

  return { lessons, advisers, noTeacher, unparsed, classes };
}

/**
 * Normalises a teacher nickname for comparison: drops the title and all
 * punctuation, lowercases.
 *
 * ⚠ Needed because the workbook writes the same person both ways within one
 * sheet — `Ms.Melissa` and `Ms Melissa`, `Ms J` and `Ms.J`. Comparing raw
 * strings made one adviser look like two on P5 Perseverance.
 */
export function normaliseNickname(raw: string): string {
  return raw
    .replace(/\b(Ms|Mr|Mrs|Miss)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * The teacher-major sheet, read as a CROSS-CHECK only.
 *
 * Returns, per teacher column, the raw text of every cell. The caller looks for
 * class tokens in that text to confirm the class-major read; it deliberately
 * does not try to produce assignments, because the free text ("Sec 2 I2 (10:45
 * - 11:45) Literature Tu, Th Sec 3 Literature Mon Humanities Wed") cannot be
 * tokenised with the confidence the grid gives.
 *
 * ⚠ Row 3 is the teacher header and it runs to column 34 — read all of it.
 */
export function parseTeacherMajorSheet(
  sheetName: string,
  ws: XLSX.WorkSheet,
  headerRowIndex = 2
): { teacherRaw: string; source: string; text: string }[] {
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: '',
  });
  const header = rows[headerRowIndex] ?? [];
  const out: { teacherRaw: string; source: string; text: string }[] = [];

  header.forEach((h, ci) => {
    const who = norm(h);
    // 'min' and 'Time' are layout columns, not people.
    if (!who || /^(min|time)$/i.test(who)) return;
    rows.forEach((r, ri) => {
      if (ri <= headerRowIndex) return;
      const text = norm(r[ci]);
      if (!text) return;
      out.push({
        teacherRaw: who,
        source: `${sheetName}!${colLetter(ci)}${ri + 1}`,
        text,
      });
    });
  });

  return out;
}

/**
 * Class tokens found in a free-text cell: "Sec 1D2", "Sec 2 I1", "P5 Tenacity".
 *
 * Used only to cross-check, so it is allowed to miss; it must not invent.
 */
export function classTokensIn(text: string): string[] {
  const out: string[] = [];
  const secRe = /\bSec(?:ondary)?\s*(\d)\s*([ID])\s*(\d)\b/gi;
  const secPlain = /\bSec(?:ondary)?\s*(\d)\b(?!\s*[ID]\s*\d)/gi;
  const primary = /\bP(\d)\s+([A-Z][a-z]+)\b/g;
  let m: RegExpExecArray | null;
  while ((m = secRe.exec(text)) !== null)
    out.push(`S${m[1]}${m[2].toUpperCase()}${m[3]}`);
  while ((m = secPlain.exec(text)) !== null) out.push(`S${m[1]}`);
  while ((m = primary.exec(text)) !== null) out.push(`P${m[1]} ${m[2]}`);
  return [...new Set(out)];
}

/** A class name from the workbook, resolved to a level code + section name. */
export type ClassIdentity = {
  levelCode: string;
  /** The section's own name, e.g. "Patience", "Discipline 2", "Consistency". */
  sectionName: string;
  /**
   * A stream annotation the workbook carries that our catalogue may not —
   * "Cambridge", "Global", "Standard", "Morning", "Afternoon", "AM".
   * Reported, never used to match, because we do not know which of them name
   * a separate section here and which are just description.
   */
  annotations: string[];
};

const WORD_NUMBERS: Record<string, string> = {
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
};

/**
 * Turns a workbook class heading into a level code and a section name.
 *
 * The workbook uses three conventions for the same catalogue, sometimes on one
 * sheet: "SECONDARY THREE CONSISTENCY", "Sec 1D2 (Cambridge)" and
 * "P5 Tenacity". It also carries a typo — "P3RIMARY THREE COURTESY".
 *
 * ⚠ This does NOT decide anything. A near-miss here puts a teacher in front of
 * the wrong children, so the caller matches the result against the live
 * section list and reports whatever fails to match rather than taking a best
 * guess.
 */
export function deriveClassIdentity(classRaw: string): ClassIdentity | null {
  let text = norm(classRaw);
  if (!text) return null;

  const annotations: string[] = [];
  // Parentheticals are annotations, never part of the name.
  text = text.replace(/\(([^)]*)\)/g, (_m, inner: string) => {
    const v = norm(inner);
    if (v) annotations.push(v);
    return ' ';
  });
  // Trailing session/stream words.
  text = text.replace(
    /\b(morning|afternoon|am|pm|standard|global|cambridge|tbc)\b/gi,
    (m) => {
      annotations.push(m.toUpperCase() === 'TBC' ? 'TBC' : norm(m));
      return ' ';
    }
  );
  text = text.replace(/[-–]/g, ' ').replace(/\s+/g, ' ').trim();

  // "SECONDARY 1D2" / "SEC 2I1" — level digit and section letter+digit fused.
  const fused = text.match(
    /^(sec(?:ondary)?|p(?:rimary)?)\s*(\d)\s*([ID])\s*(\d)$/i
  );
  if (fused) {
    const band = /^s/i.test(fused[1]) ? 'S' : 'P';
    const houseWord =
      fused[3].toUpperCase() === 'D' ? 'Discipline' : 'Integrity';
    return {
      levelCode: `${band}${fused[2]}`,
      sectionName: `${houseWord} ${fused[4]}`,
      annotations,
    };
  }

  // "PRIMARY ONE PATIENCE" / "P3RIMARY THREE COURTESY" / "P5 Tenacity".
  const words = text.split(' ').filter(Boolean);
  if (words.length < 2) return null;

  let band: 'P' | 'S' | null = null;
  let levelDigit: string | null = null;
  let i = 0;

  const first = words[0].toLowerCase();
  // The roster typo "P3RIMARY" carries its own digit; take it.
  const typo = first.match(/^p(\d)rimary$/);
  if (typo) {
    band = 'P';
    levelDigit = typo[1];
    i = 1;
    // ⚠ "P3RIMARY THREE COURTESY" carries the level TWICE — once in the typo'd
    // digit and once as a word. Consuming only the digit left the section name
    // as "THREE COURTESY", which matched no live section and quietly dropped
    // P3 Courtesy from the import.
    const next = (words[1] ?? '').toLowerCase();
    if (WORD_NUMBERS[next] === levelDigit) i = 2;
  } else if (/^p(\d)$/.test(first)) {
    band = 'P';
    levelDigit = first.slice(1);
    i = 1;
  } else if (/^s(\d)$/.test(first)) {
    band = 'S';
    levelDigit = first.slice(1);
    i = 1;
  } else if (/^prim(ary)?$/.test(first) || /^sec(ondary)?$/.test(first)) {
    band = /^p/.test(first) ? 'P' : 'S';
    i = 1;
    const next = (words[1] ?? '').toLowerCase();
    if (WORD_NUMBERS[next]) {
      levelDigit = WORD_NUMBERS[next];
      i = 2;
    } else if (/^\d$/.test(next)) {
      levelDigit = next;
      i = 2;
    }
  }

  if (!band || !levelDigit) return null;
  const sectionName = words.slice(i).join(' ').trim();
  if (!sectionName) return null;

  return { levelCode: `${band}${levelDigit}`, sectionName, annotations };
}

/** Loose comparison for matching a workbook name to a catalogue name. */
export function normaliseSectionName(v: string): string {
  return v
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
