import * as XLSX from 'xlsx';
import { mapSubjectColumn } from './subject-map';

export type GradeCell = {
  name: string;
  level: string;
  sectionClass: string;
  status: string;
  subjectCode: string;
  examinable: boolean;
  term: 1 | 2 | 3 | 4;
  kind: 'numeric' | 'letter' | 'na';
  numeric: number | null; // examinable quarterly (integer) or null
  letter: string | null; // non-exam letter (A/B/C/IP) or null
  overall: number | null; // examinable Overall (for cross-check) or null
  award: string | null; // examinable Award text or null
};

const LETTERS = new Set(['A', 'B', 'C', 'IP']);

// Parse the AY2025 "Final Report Book" masterfile (sheet "Masterfile") into one
// GradeCell per (student × mapped-subject-column × term) where the term cell is
// non-empty. Examinable blocks span 6 columns (Term 1..4, Overall, Remarks);
// non-examinable span 4 (Term 1..4). The subject-header row is the row with
// ENGLISH at/after column 6; data rows have a number in col 0 and a name in col 1.
export function parseMasterfileGrades(filePath: string): GradeCell[] {
  const wb = XLSX.readFile(filePath);
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(
    wb.Sheets['Masterfile'],
    { header: 1, blankrows: false, defval: '' }
  );

  const hr = rows.findIndex((r) =>
    r.some((c, i) => i >= 6 && /ENGLISH/i.test(String(c ?? '')))
  );
  if (hr < 0) return [];
  const header = rows[hr];

  type Block = {
    code: string;
    examinable: boolean;
    t: [number, number, number, number];
    overall: number | null;
  };
  const blocks: Block[] = [];
  for (let c = 6; c < header.length; c++) {
    const label = String(header[c] ?? '').trim();
    if (!label) continue;
    const m = mapSubjectColumn(label);
    if (!m) continue; // OVERALL ACADEMIC AWARD / ATTENDANCE / TEACHER'S COMMENTS skipped
    blocks.push({
      code: m.code,
      examinable: m.examinable,
      t: [c, c + 1, c + 2, c + 3],
      overall: m.examinable ? c + 4 : null,
    });
  }

  const out: GradeCell[] = [];
  for (const r of rows) {
    if (typeof r[0] !== 'number' || !r[1]) continue; // data rows only
    const name = String(r[1]).trim();
    const level = String(r[2] ?? '').trim();
    const sectionClass = String(r[3] ?? '').trim();
    const status = String(r[5] ?? '').trim();
    for (const b of blocks) {
      const overall =
        b.overall != null && typeof r[b.overall] === 'number'
          ? (r[b.overall] as number)
          : null;
      const award =
        b.overall != null
          ? String(r[b.overall + 1] ?? '').trim() || null
          : null;
      b.t.forEach((col, i) => {
        const raw = r[col];
        const sraw = String(raw ?? '').trim();
        if (sraw === '') return; // blank = not taken
        const term = (i + 1) as 1 | 2 | 3 | 4;
        if (/^n\.?a\.?$/i.test(sraw)) {
          out.push({
            name,
            level,
            sectionClass,
            status,
            subjectCode: b.code,
            examinable: b.examinable,
            term,
            kind: 'na',
            numeric: null,
            letter: null,
            overall,
            award,
          });
        } else if (b.examinable && typeof raw === 'number') {
          out.push({
            name,
            level,
            sectionClass,
            status,
            subjectCode: b.code,
            examinable: true,
            term,
            kind: 'numeric',
            numeric: Math.round(raw),
            letter: null,
            overall,
            award,
          });
        } else if (!b.examinable && LETTERS.has(sraw.toUpperCase())) {
          out.push({
            name,
            level,
            sectionClass,
            status,
            subjectCode: b.code,
            examinable: false,
            term,
            kind: 'letter',
            numeric: null,
            letter: sraw.toUpperCase(),
            overall: null,
            award: null,
          });
        }
        // anything else (stray text) is skipped; surfaced via dry-run counts vs roster
      });
    }
  }
  return out;
}
