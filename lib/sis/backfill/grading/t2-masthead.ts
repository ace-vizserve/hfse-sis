// lib/sis/backfill/grading/t2-masthead.ts
// Shared masthead-parsing helpers for every T2 grading-sheet source
// (Primary GRADES/ tabs — grading-workbook-t2.ts; Secondary Regular-track
// GRADES/ tabs — grading-workbook-secondary-t2.ts; Global-track Lower
// Secondary Global Grading Sheets/ — grading-workbook-global-t2.ts).
// Extracted from grading-workbook-t2.ts (Phase 6a) per the explicit
// recommendation in that phase's final whole-branch review: a third
// parser needing the same tab-name-first identity resolution and fixed
// printed-grade-column finder should share one copy, not duplicate a
// third time.
//
// Two real, hand-verified bugs are fixed here (both stay fixed for every
// consumer of this module):
//   1. Every T2 sheet has a SECOND, unreliable "Quarterly"/"Term 1" column
//      pair after the real printed-grade columns. The naive approach
//      (take the LAST "Initial"/"Quarterly" label match scanning
//      forward) silently grabs the wrong one. findPrintedGradeColsT2
//      takes the FIRST match of each label only.
//   2. Row 2's free-text identity label is sometimes simply wrong (a
//      copy-paste artifact from cloning a template tab in Excel), and
//      because roster resolution keys on (levelCode, sectionName,
//      indexNumber), a wrong label doesn't fail loud — it can silently
//      resolve against a DIFFERENT real section's roster. Tab names are
//      structurally reliable (Excel forbids duplicate tab names), so
//      resolveIdentity prefers the tab name whenever it parses.
//
// One further enhancement, added for Phase 6b: some GRADES/-folder
// Secondary tab names are truncated by Excel's 31-character sheet-name
// limit (e.g. "Social Studies&Geography - S3 C", really "...S3
// Consistency") — the OPPOSITE failure direction from bug #2 above (there
// row 2 was wrong; here the tab name is incomplete). resolveIdentity
// detects this specific pattern (tab-derived section is a genuine prefix
// of row 2's fuller text, both agreeing on level) and prefers row 2 in
// that one case, logging it as a distinct "truncation" note rather than a
// "correction" note — it isn't really a disagreement, the tab name just
// didn't have room to say the whole thing.

export const ROW_LEVEL_SECTION = 2;
export const ROW_TEACHER = 3;
export const ROW_LABELS = 5;
export const ROW_SUBCOLS = 7;
export const ROW_MAXSCORES = 8;
export const ROW_STUDENTS_START = 9;

export function cell(row: unknown[] | undefined, i: number): string {
  if (!row) return '';
  const v = row[i];
  return v == null ? '' : String(v).trim();
}

export function numOrNull(v: string): number | null {
  if (v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

export interface ColumnLayout {
  wwCols: number[];
  ptCols: number[];
  wwTotalCol: number;
  ptTotalCol: number;
  examCol: number;
}

export function findColumnLayout(subcolRow: unknown[]): ColumnLayout {
  const wwCols: number[] = [];
  const ptCols: number[] = [];
  const totalCols: number[] = [];
  let examCol = -1;
  for (let i = 2; i < subcolRow.length; i++) {
    const label = cell(subcolRow as unknown[], i);
    if (/^W\d+$/i.test(label)) wwCols.push(i);
    else if (/^PT\d+$/i.test(label)) ptCols.push(i);
    else if (/^Total$/i.test(label)) totalCols.push(i);
    else if (/^Exam$/i.test(label)) examCol = i;
  }
  const [wwTotalCol, ptTotalCol] = totalCols;
  if (wwTotalCol == null || ptTotalCol == null || examCol === -1) {
    throw new Error(
      't2-masthead: could not locate WW/PT Total columns or the Exam column in row 8 sub-labels'
    );
  }
  return { wwCols, ptCols, wwTotalCol, ptTotalCol, examCol };
}

export function weightAt(maxRow: unknown[], totalCol: number): number {
  const wsCell = cell(maxRow, totalCol + 2);
  const pct = Number(wsCell.replace('%', ''));
  if (Number.isNaN(pct)) {
    throw new Error(
      `t2-masthead: expected a WS% cell at column ${totalCol + 2}, got "${wsCell}"`
    );
  }
  return pct / 100;
}

// Takes the FIRST match of each label, not the last, and stops scanning
// once both are found. This is what keeps the spurious second
// "Quarterly"/"Term 1" pair out of every T2 import.
export function findPrintedGradeColsT2(
  labelRow: unknown[],
  fromCol: number
): { initialCol: number | null; quarterlyCol: number | null } {
  let initialCol: number | null = null;
  let quarterlyCol: number | null = null;
  for (let i = fromCol; i < labelRow.length; i++) {
    if (initialCol !== null && quarterlyCol !== null) break;
    const label = cell(labelRow, i);
    if (initialCol === null && /Initial/i.test(label)) {
      initialCol = i;
      continue;
    }
    if (quarterlyCol === null && /Quarterly/i.test(label)) {
      quarterlyCol = i;
    }
  }
  return { initialCol, quarterlyCol };
}

export type IdentityT2 =
  | { kind: 'primary'; levelCode: string; sectionName: string }
  | { kind: 'secondary'; levelCode: string; sectionName: string }
  | { kind: 'unrecognized' };

export function titleCase(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

// Row 2's shape: "Primary N NAME - SUBJECT" or "Secondary N NAME - SUBJECT".
const ROW2_IDENTITY_RE = /^(Primary|Secondary)\s+(\d+)\s+(.+?)\s+-\s+.+$/i;

function parseRow2Identity(raw: string): IdentityT2 {
  const m = ROW2_IDENTITY_RE.exec(raw.trim());
  if (!m) return { kind: 'unrecognized' };
  const [, levelWord, levelNum, sectionRaw] = m;
  const isPrimary = levelWord.toLowerCase() === 'primary';
  return {
    kind: isPrimary ? 'primary' : 'secondary',
    levelCode: `${isPrimary ? 'P' : 'S'}${levelNum}`,
    sectionName: titleCase(sectionRaw),
  };
}

// Tab name's shape: "<Subject> - P<N> <Name>", "<Subject> - S<N> <Name>", or
// "<Subject> - Sec <N> <Name>" (the S/Sec spelling varies by file — both
// observed in real data, "Sec" tried first so it isn't shadowed by the
// single-letter "S" alternative).
const TAB_NAME_IDENTITY_RE = /^.+?\s*-\s*(Sec|P|S)\.?\s*(\d+)\s+(.+)$/i;

function parseTabNameIdentity(sheetName: string): IdentityT2 {
  const m = TAB_NAME_IDENTITY_RE.exec(sheetName.trim());
  if (!m) return { kind: 'unrecognized' };
  const [, prefix, levelNum, sectionRaw] = m;
  const isPrimary = prefix.toLowerCase().startsWith('p');
  return {
    kind: isPrimary ? 'primary' : 'secondary',
    levelCode: `${isPrimary ? 'P' : 'S'}${levelNum}`,
    sectionName: titleCase(sectionRaw),
  };
}

function identityLabel(identity: IdentityT2): string {
  return identity.kind === 'unrecognized'
    ? '(unrecognized)'
    : `${identity.levelCode} ${identity.sectionName}`;
}

// True when `shortSection` is a genuine, strictly-shorter prefix of
// `longSection` (case-insensitive) — the signature of Excel's 31-character
// sheet-name truncation, not a real disagreement.
function isTruncationOf(shortSection: string, longSection: string): boolean {
  const s = shortSection.toLowerCase();
  const l = longSection.toLowerCase();
  return s.length < l.length && l.startsWith(s);
}

// Tab name wins whenever it parses — Excel forbids two tabs sharing a
// name, so a mistyped tab name would be immediately visible to whoever
// built the workbook, unlike a free-text label cell that's easy to
// fat-finger via copy-paste without visual feedback. Row 2 is the
// fallback ONLY when the tab name doesn't parse (the real case for
// never-renamed "Reserved N" tabs).
//
// EXCEPTION: when both parse, agree on level, but the tab-derived section
// is a genuine prefix of row 2's fuller section text, the tab name is
// treated as TRUNCATED (Excel's 31-char sheet-name limit) rather than
// simply wrong — row 2 wins in that one case, logged as a distinct
// "truncation" note, not a "correction" note (it isn't really a
// disagreement, the tab name just didn't have room to say the whole
// thing).
export function resolveIdentity(
  sheetName: string,
  row2Raw: string
): {
  identity: IdentityT2;
  correctionNote: string | null;
  truncationNote: string | null;
} {
  const tabIdentity = parseTabNameIdentity(sheetName);
  if (tabIdentity.kind === 'unrecognized') {
    return {
      identity: parseRow2Identity(row2Raw),
      correctionNote: null,
      truncationNote: null,
    };
  }

  const row2Identity = parseRow2Identity(row2Raw);
  if (row2Identity.kind === 'unrecognized') {
    return {
      identity: tabIdentity,
      correctionNote: null,
      truncationNote: null,
    };
  }

  const agrees =
    row2Identity.kind === tabIdentity.kind &&
    row2Identity.levelCode === tabIdentity.levelCode &&
    row2Identity.sectionName === tabIdentity.sectionName;
  if (agrees) {
    return {
      identity: tabIdentity,
      correctionNote: null,
      truncationNote: null,
    };
  }

  if (
    row2Identity.kind === tabIdentity.kind &&
    row2Identity.levelCode === tabIdentity.levelCode &&
    isTruncationOf(tabIdentity.sectionName, row2Identity.sectionName)
  ) {
    return {
      identity: row2Identity,
      correctionNote: null,
      truncationNote: `"${sheetName}": tab name appears truncated (Excel's sheet-name limit) — "${tabIdentity.sectionName}" vs row 2's fuller "${row2Identity.sectionName}" — using row 2`,
    };
  }

  return {
    identity: tabIdentity,
    correctionNote: `"${sheetName}": tab name says ${identityLabel(tabIdentity)}, row 2 says ${identityLabel(row2Identity)} — using tab name`,
    truncationNote: null,
  };
}

export function parseTeacherName(raw: string): string | null {
  const m = /Teacher:\s*(.*)/i.exec(raw);
  if (!m) return null;
  const name = m[1].trim();
  return name === '' ? null : name;
}

// A minimal structural shape — avoids importing the full ParsedSubjectSheet
// type from grading-workbook.ts into this masthead-only module.
interface ScoredSheetLike {
  levelCode: string;
  sectionName: string;
  students: {
    wwScores: (number | null)[];
    ptScores: (number | null)[];
    examScore: number | null;
  }[];
}

export function hasAnyScore(sheet: ScoredSheetLike): boolean {
  return sheet.students.some(
    (s) =>
      s.wwScores.some((v) => v != null) ||
      s.ptScores.some((v) => v != null) ||
      s.examScore != null
  );
}

// When two or more tabs in the same file resolve to the identical
// (levelCode, sectionName) identity — the signature of a stale, unused
// "Reserved N" scratch tab whose row-2 label happens to match a real,
// populated tab — keep only the one with real score data. This is
// deliberately NOT a blanket "drop every all-null sheet" rule: a lone,
// non-colliding section with genuinely zero scores recorded yet (no
// teacher has entered grades) is left completely untouched — that's an
// honest "nothing entered yet" state, not corrupted data. When a
// collision group has zero, or more than one, sheet with real scores,
// that's a genuinely ambiguous case this heuristic can't safely resolve —
// every sheet in the group is kept rather than guessed, so it surfaces
// downstream (needs-review / mismatch sections) instead of being silently
// dropped.
export function dedupeByIdentityPreferringScored<T extends ScoredSheetLike>(
  candidates: { sheetName: string; sheet: T }[]
): { kept: T[]; duplicateNotes: string[] } {
  const groups = new Map<string, { sheetName: string; sheet: T }[]>();
  for (const c of candidates) {
    const key = `${c.sheet.levelCode}::${c.sheet.sectionName}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }

  const kept: T[] = [];
  const duplicateNotes: string[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      kept.push(group[0].sheet);
      continue;
    }
    const scored = group.filter((c) => hasAnyScore(c.sheet));
    const empty = group.filter((c) => !hasAnyScore(c.sheet));
    if (scored.length === 1 && empty.length === group.length - 1) {
      kept.push(scored[0].sheet);
      for (const e of empty) {
        duplicateNotes.push(
          `"${e.sheetName}" and "${scored[0].sheetName}" both resolved to ${group[0].sheet.levelCode} ${group[0].sheet.sectionName} — "${e.sheetName}" has no scores at all, using "${scored[0].sheetName}"`
        );
      }
    } else {
      for (const c of group) kept.push(c.sheet);
    }
  }
  return { kept, duplicateNotes };
}

// A tab literally named "Reserved N" is never a real, currently-taught
// class. Verified against HFSE's own Term 2 Consolidated Form: the one
// real production case (Science's "Reserved 4") was NOT simply empty —
// it had a teacher assigned and real scores — but its 25-student roster
// turned out to be a stale, superseded snapshot of an entirely different
// section (S2 Integrity 2) under old index numbers, unrelated to
// whatever its row-2 label happened to claim. Score content is therefore
// not a reliable signal (see dedupeByIdentityPreferringScored's doc
// comment, which this supersedes for the Secondary parsers only) — the
// tab name itself is the reliable one. Whenever a Reserved-named tab's
// resolved identity collides with ANY other, properly-named tab, the
// Reserved tab always loses, unconditionally.
export function isReservedTabName(sheetName: string): boolean {
  return /^Reserved\b/i.test(sheetName.trim());
}

// Deliberately run ONCE across the FULL merged candidate set spanning
// every file and both tracks — not per-file — since the real bug this
// fixes is a CROSS-FILE collision (a Regular-track file's stray
// "Reserved N" tab colliding with a Global-track file's real,
// properly-named tab for the same identity). A per-file dedup call
// structurally cannot see this, since each file is parsed independently.
export function dedupePreferringNonReservedTab<
  T extends { levelCode: string; sectionName: string },
>(
  candidates: { sheetName: string; sheet: T }[]
): { kept: T[]; duplicateNotes: string[] } {
  const groups = new Map<string, { sheetName: string; sheet: T }[]>();
  for (const c of candidates) {
    const key = `${c.sheet.levelCode}::${c.sheet.sectionName}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }

  const kept: T[] = [];
  const duplicateNotes: string[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      kept.push(group[0].sheet);
      continue;
    }
    const named = group.filter((c) => !isReservedTabName(c.sheetName));
    const reserved = group.filter((c) => isReservedTabName(c.sheetName));
    if (named.length === 1 && reserved.length === group.length - 1) {
      kept.push(named[0].sheet);
      for (const r of reserved) {
        duplicateNotes.push(
          `"${r.sheetName}" and "${named[0].sheetName}" both resolved to ${group[0].sheet.levelCode} ${group[0].sheet.sectionName} — "${r.sheetName}" is a Reserved slot, using "${named[0].sheetName}"`
        );
      }
    } else {
      for (const c of group) kept.push(c.sheet);
    }
  }
  return { kept, duplicateNotes };
}
