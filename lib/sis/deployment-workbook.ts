// Reading the school's deployment workbook — the shared parser.
//
// `Teachers Deployment_Updated 29 Jun 26_Teacherscopy.xlsx`, sheet
// `Final Update_New`, is a printed timetable: 14 time-slot rows down the side,
// 28 teacher columns across, and free text in the cells written for a human
// eye. Two scripts read it — `probe-teacher-deployment.ts` (reports, writes
// nothing) and `import-teacher-assignments.ts` (writes) — and they MUST agree
// about what it says, so the parsing lives here rather than in either of them.
//
// This module takes no database dependency. It is given the sections and
// subjects that exist and returns what the workbook claims about them, so the
// parsing can be reasoned about (and tested) without a connection.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import * as XLSX from 'xlsx';

export const WORKBOOK_PATH = resolve(
  import.meta.dirname,
  '..',
  '..',
  'Teachers Deployment_Updated 29 Jun 26_Teacherscopy.xlsx'
);
export const SHEET = 'Final Update_New';

// ─── Short name → account ─────────────────────────────────────────────────
// HAND-WRITTEN ON PURPOSE. Fuzzy matching was rejected: "Ms. Elaine" and the
// relief teacher "Elaine" are different people, and any edit-distance scheme
// close enough to catch the source's own typo ("Mr Jospeh" for Joseph Ong) is
// also close enough to confuse them. An explicit table is auditable; a
// similarity threshold is not.
//
// `null` means DELIBERATELY UNRESOLVED — the name is in the timetable and we
// do not know who it is. Those are reported, never guessed.
export const ALIASES: Record<string, string | null> = {
  // Keys are matched AFTER whitespace collapsing, so the source's double space
  // in "Ms. Kristel  (AM)" is written single here.
  'Ms. Kristel (AM)': 'kristel.conado@hfse.edu.sg',
  'Ms Jenny (AM)': 'jenny.wong@hfse.edu.sg',
  'Mr. Wai (AM)': 'waichung.low@hfse.edu.sg',
  'Ms Parmi': 'parmithaa.reddy@hfse.edu.sg',
  'Ms. Mae': 'mae.juni@hfse.edu.sg',
  'Ms. Melissa': 'melissa.balantac@hfse.edu.sg',
  'Ms. Lhen': 'lhen.mendoza@hfse.edu.sg',
  'Ms Karen': 'karengrace.ledbetter@hfse.edu.sg',
  'Ms Arlene (AM)': 'arlene.raralio@hfse.edu.sg',
  'Ms. Jing': 'jing.lim@hfse.edu.sg',
  'Ms Radhika': 'radhika.putrevu@hfse.edu.sg',
  'Ms Carl': 'christine.sarmiento@hfse.edu.sg',
  'Ms. Med': 'medelyn.azucena@hfse.edu.sg',
  'Mr Jun': 'jun.chong@hfse.edu.sg',
  'Ms. Koh': 'kohsuat.hoon@hfse.edu.sg',
  'Ms.J': 'jocelyn.saguid@hfse.edu.sg',
  'Ms. Chandana': 'chandana.dileep@hfse.edu.sg',
  'Ms Sharon': 'sharonanne.menezes@hfse.edu.sg',
  'Mr Hanafi': 'muhammad.hanafi@hfse.edu.sg',

  // The source spells Joseph Ong's given name wrong. Recorded rather than
  // corrected, because the key has to match the workbook byte for byte.
  'Mr Jospeh': 'joseph.ong@hfse.edu.sg',

  // Zuraidah Zainal, confirmed by Mr Ace 2026-09-09. She is on the Teachers
  // List under her full name and in the timetable under a syllable of it, so
  // neither list alone connects them and no string comparison would have.
  'Ms Aida': 'zuraidah.zainal@hfse.edu.sg',

  // ⚠ Shares a column with a relief teacher ("Ms Shaf/Relief") and advises
  // P2 Honesty. Only one form adviser per section is allowed, so somebody had
  // to be the named person; Shafika is the one the sheet names.
  'Ms Shaf/Relief': 'shafika.jasni@hfse.edu.sg',

  // ⚠ Resolved by POSITION. Two Elaines hold accounts: May Ling Elaine Wee
  // (Secondary) and Fong Mei Yin Elaine (Relief). This column sits inside the
  // secondary block, so it reads as Wee.
  'Ms. Elaine': 'elaine.wee@hfse.edu.sg',

  // Natividad Laguyo, confirmed by Mr Ace 2026-09-09. The `tin.labrador@`
  // address made Christina Labrador look like a candidate, but the secondary
  // block accounts for exactly the ten listed secondary teachers plus a relief
  // placeholder, Natividad was the only one otherwise unplaced, and the
  // database already had her advising Integrity 1 — which is the class the
  // workbook gives Ms Tina.
  'Ms Tina': 'natividad.laguyo@hfse.edu.sg',

  // On the Teachers List, no email supplied — no account can exist yet.
  'Ms. Jasmine': null,
  'Ms. Li': null,

  // In the timetable, on no roster, matched to nobody.
  'Ms. Khim': null,
  'Relief Teacher': null,
};

// The school's own words for four subjects. STAR ("Sports, Talent, Arts and
// Rhythm") is what the timetable calls MAPEH throughout; the sheet misspells
// the other three. Written out rather than fuzzy-matched, same reason as the
// teacher aliases.
//
// ⚠ "Homeroom and Values Education" is NOT here on purpose. It appears in
// eleven cells and is not a subject — it is the form adviser's own pastoral
// period, already represented by the form_adviser row. Aliasing it would
// invent a subject teacher for something the school does not grade.
//
// ⚠ "MTW" is left alone too. It reads as Mother Tongue in Ms. Jasmine's and
// Ms. Li's cells and as Mon/Tue/Wed everywhere else, including one cell using
// both. Neither of those two teachers has an account, so resolving it would
// produce rows that cannot be written anyway.
export const SUBJECT_ALIASES: Record<string, string[]> = {
  MAPEH: ['star'],
  Mathematics: ['mathermatics'],
  'Pastoral Ministry and Personal Development': ['pastrolministry'],
  'Mother Tongue': ['mothertingue'],
};

export type SectionLite = {
  id: string;
  name: string;
  levels: { code: string } | { code: string }[] | null;
};
export type SubjectLite = { id: string; name: string };

export const levelCodeOf = (s: SectionLite) =>
  (Array.isArray(s.levels) ? s.levels[0] : s.levels)?.code ?? '??';

export function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** "P3 Courageous" → "P3"; "Sec 2I2" → "S2"; "Sec 4" → "S4". */
export function levelTokenOf(label: string): string | null {
  const p = label.match(/^P\s*([1-6])/i);
  if (p) return `P${p[1]}`;
  const s = label.match(/^Sec\s*([1-4])/i);
  if (s) return `S${s[1]}`;
  return null;
}

/**
 * The secondary stream shorthand, expanded.
 *
 * The school writes `Sec 1D1` / `Sec 2I2`; the sections are named
 * `Discipline 1` / `Integrity 2`. That is the sheet's own vocabulary — its
 * Secondary tab spells the headers out in full ("SECONDARY ONE DISCIPLINE") —
 * so this is a rule the school stated, not a guess at what a letter means.
 */
export function expandStream(tail: string): string {
  return tail
    .replace(/^\s*D\s*(\d)\b/i, 'Discipline $1')
    .replace(/^\s*I\s*(\d)\b/i, 'Integrity $1');
}

/**
 * Strip everything the SIS does not model.
 *
 * ⚠ `teacher_assignments` has NO TIME DIMENSION — it is (teacher, section,
 * subject, role) and nothing else. So every clock time, day name and day
 * abbreviation in these cells is noise, not difficulty. Treating it as
 * difficulty is what made an earlier pass call `P4 Trust STAR (Tu, W) P5
 * Commitment - STAR (Th F)` unparseable; drop the days and it is plainly two
 * assignments of the same subject to two classes.
 *
 * Order matters: clock times before day letters, or the `F` in a time range
 * survives as a phantom Friday.
 */
export function stripSchedule(text: string): string {
  return text
    .replace(/`?\d{1,2}:\d{2}\s*(?:[-–]\s*\d{1,2}:\d{2})?\s*(?:am|pm)?/gi, ' ')
    .replace(
      /\b(mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|mon|tues?|wed|thurs?|thu|fri|mtw|mo|tu|th|fr|w|f|m)\b/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();
}

const clean = (v: unknown) =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim();

export type WorkbookCells = {
  /** Column headers that name a teacher. */
  teacherNames: string[];
  /** The Assembly row: one class per teacher, the form-adviser register. */
  advisers: { teacher: string; classLabel: string }[];
  /** Every other teaching cell. */
  subjectCells: { teacher: string; text: string }[];
};

/**
 * Read the grid and split it into the two kinds of evidence it holds.
 *
 * ⚠ THE ASSEMBLY ROW IS THE RELIABLE PART. Each teacher's 08:15–08:30 cell
 * names exactly one class ("Assembly - P1 Patience"), and a second assembly
 * row at 13:15 covers the afternoon classes. That is a form-adviser register:
 * one signal each, no parsing beyond dropping the word "Assembly". Everything
 * else in the grid is weaker evidence and is kept separate, never mixed in.
 */
export function readWorkbookCells(path = WORKBOOK_PATH): WorkbookCells {
  const wb = XLSX.read(readFileSync(path), { type: 'buffer' });
  const ws = wb.Sheets[SHEET];
  if (!ws) throw new Error(`Sheet "${SHEET}" not found in ${path}`);
  const grid = XLSX.utils.sheet_to_json<string[]>(ws, {
    header: 1,
    raw: false,
    defval: '',
  });

  // Row index 2 carries the teacher short names. Columns 0/1 are the time and
  // duration; column 23 is the secondary block's own time column.
  const header = (grid[2] ?? []).map(clean);
  const cols = header
    .map((name, col) => ({ name, col }))
    .filter(({ name, col }) => name && col !== 0 && col !== 1 && col !== 23);

  const advisers: WorkbookCells['advisers'] = [];
  const subjectCells: WorkbookCells['subjectCells'] = [];

  for (const row of grid.slice(3)) {
    for (const { name, col } of cols) {
      const v = clean(row?.[col]);
      if (!v) continue;
      const assembly = v.match(/^Assembly\s*[-–]?\s*(.+)$/i);
      if (assembly) {
        advisers.push({ teacher: name, classLabel: clean(assembly[1]) });
        continue;
      }
      if (/^(break|lunch|cca|ys)\b/i.test(v)) continue;
      subjectCells.push({ teacher: name, text: v });
    }
  }

  return { teacherNames: cols.map((c) => c.name), advisers, subjectCells };
}

export type SectionResolution =
  | { ok: true; section: SectionLite }
  | { ok: false; why: string };

/**
 * Build the resolvers for one academic year's sections and subjects.
 *
 * Returned rather than exported as free functions because both of them close
 * over what exists in that year — the same label resolves differently in a
 * year with one Sec 3 and a year with two.
 */
export function buildResolvers(
  sections: SectionLite[],
  subjects: SubjectLite[]
) {
  // A level with exactly ONE section can be named by its level alone — the
  // sheet writes "Sec 3 Science" and "Sec 4 Contemporary Art" with no virtue
  // name because there is only one of each. Guarded on the count, so "Sec 1"
  // can never silently pick one of the two Discipline classes.
  const perLevel = new Map<string, number>();
  for (const s of sections)
    perLevel.set(levelCodeOf(s), (perLevel.get(levelCodeOf(s)) ?? 0) + 1);

  const subjectKeys = subjects.map((s) => ({
    id: s.id,
    name: s.name,
    keys: [norm(s.name), ...(SUBJECT_ALIASES[s.name] ?? []).map(norm)],
  }));

  const sectionLabels = sections.map((s) => ({
    section: s,
    label: `${levelCodeOf(s)} ${s.name}`,
    keys: [
      norm(`${levelCodeOf(s)}${s.name}`),
      norm(
        `Sec${levelCodeOf(s).replace(/^S/, '')}${s.name
          .replace(/^Discipline\s*/i, 'D')
          .replace(/^Integrity\s*/i, 'I')}`
      ),
      ...(perLevel.get(levelCodeOf(s)) === 1
        ? [norm(levelCodeOf(s)), norm(`Sec${levelCodeOf(s).replace(/^S/, '')}`)]
        : []),
    ],
  }));

  /**
   * A class label resolves only when its level token matches AND exactly one
   * section in that level has a name contained in the label. Anything else is
   * reported rather than picked — "Sec 3" matching three sections is not a
   * match, it is a question.
   */
  function resolveSection(label: string): SectionResolution {
    const lvl = levelTokenOf(label);
    if (!lvl) return { ok: false, why: 'no level token' };
    const inLevel = sections.filter((s) => levelCodeOf(s) === lvl);
    if (inLevel.length === 0)
      return { ok: false, why: `no sections at level ${lvl}` };
    const tail = label.replace(/^(P\s*[1-6]|Sec\s*[1-4])/i, '');
    const matchable = `${label} ${expandStream(tail)}`;
    const hits = inLevel.filter((s) => norm(matchable).includes(norm(s.name)));
    if (hits.length === 1) return { ok: true, section: hits[0] };
    if (hits.length === 0 && inLevel.length === 1)
      return { ok: true, section: inLevel[0] };
    if (hits.length > 1)
      return {
        ok: false,
        why: `ambiguous: ${hits.map((h) => h.name).join(', ')}`,
      };
    return {
      ok: false,
      why: `no name match among ${inLevel.map((s) => s.name).join(', ')}`,
    };
  }

  /**
   * Pull (class, subject) pairs out of one cell.
   *
   * Positional. A cell can name several classes, and the subject belonging to
   * each is the text FOLLOWING it — "P4 Trust STAR ... P5 Commitment - STAR
   * ..." is two pairs, not a four-way ambiguity. So find where each class name
   * starts, cut the cell at those points, and read the subjects out of each
   * piece. Text before the first class attaches to it, because the sheet
   * sometimes leads with the subject ("Science P1 ...").
   */
  function pairsIn(text: string): {
    section: SectionLite;
    label: string;
    subjectId: string;
    subject: string;
  }[] {
    const n = norm(stripSchedule(text));

    const found: { section: SectionLite; label: string; at: number }[] = [];
    for (const s of sectionLabels) {
      let best = -1;
      for (const k of s.keys) {
        const i = n.indexOf(k);
        if (i !== -1 && (best === -1 || i < best)) best = i;
      }
      if (best !== -1)
        found.push({ section: s.section, label: s.label, at: best });
    }
    if (found.length === 0) return [];
    found.sort((a, b) => a.at - b.at);

    const out: ReturnType<typeof pairsIn> = [];
    for (let i = 0; i < found.length; i++) {
      const from = i === 0 ? 0 : found[i].at;
      const to = i + 1 < found.length ? found[i + 1].at : n.length;
      const segment = n.slice(from, to);
      for (const subj of subjectKeys) {
        if (subj.keys.some((k) => segment.includes(k)))
          out.push({
            section: found[i].section,
            label: found[i].label,
            subjectId: subj.id,
            subject: subj.name,
          });
      }
    }
    return out;
  }

  return { resolveSection, pairsIn, sectionLabels };
}
