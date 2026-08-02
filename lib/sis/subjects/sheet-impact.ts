import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { compareLevelCodes } from '@/lib/sis/subjects/level-span';

// "Who uses this subject, how much would saving it change, and where do I go
// to fix one class?"
//
// A `subject_configs` row is per (subject × AY) — migration 080 dropped the
// level dimension — so one save reaches every unlocked grading sheet for that
// subject, across every section and level in the year. For English or Maths
// that is 21 classes spanning P1 to S4. Subject Setup asked an admin to change
// those numbers while showing neither who they belonged to nor how far the
// change would travel.
//
// The breadth itself is correct and deliberate: HFSE agrees a Scheme of Work
// before each AY and one save is how it lands (KD #176). The fix is telling the
// operator what they are about to touch — and, since per-class max scores are
// set on the SHEET rather than here, handing them a way to get to it.
//
// TWO DIFFERENT NUMBERS, ON PURPOSE.
//   * `unlocked*` — what a save can actually change. Locked sheets are immune
//     (Hard Rule #5), so this is the honest blast radius, and it is what the
//     edit drawer's alert quotes.
//   * `total*` / `sectionsByLevel` — who uses the subject at all. A class whose
//     T1 sheet is locked is still a consumer, so the table column counts it.
// The table saying "21 classes" beside a drawer saying "2 classes" is these
// two questions, not a contradiction.

export type UsedBySection = {
  name: string;
  /** The sheet a click opens — the current term's, else the latest that
   * exists. A section has up to four sheets for one subject and lock state is
   * per term, so a chip cannot represent all of them; it represents the one
   * you would want to open. */
  sheetId: string;
  termNumber: number;
  /** Whether THAT sheet is locked. Other terms may differ. */
  isLocked: boolean;
  /** True when the linked sheet is the current term's rather than a fallback. */
  isCurrentTerm: boolean;
};

export type SubjectSheetImpact = {
  /** Unlocked sheets a save would update. */
  unlockedSheets: number;
  /** Distinct classes among those unlocked sheets. */
  unlockedSections: number;
  /** Distinct classes with a sheet for this subject at all. */
  totalSections: number;
  /** Level codes with at least one sheet, school order (P before S). */
  levelCodes: string[];
  /** Sections per level, both sorted — feeds the expandable panel. */
  sectionsByLevel: Array<{ levelCode: string; sections: UsedBySection[] }>;
};

type SheetRow = {
  id: string;
  subject_config_id: string | null;
  section_id: string;
  term_id: string;
  is_locked: boolean;
};

export async function getSheetImpactByConfig(
  service: SupabaseClient,
  academicYearId: string
): Promise<Map<string, SubjectSheetImpact>> {
  const out = new Map<string, SubjectSheetImpact>();

  const [termsRes, sectionsRes, levelsRes] = await Promise.all([
    service
      .from('terms')
      .select('id, term_number, is_current')
      .eq('academic_year_id', academicYearId),
    service
      .from('sections')
      .select('id, name, level_id')
      .eq('academic_year_id', academicYearId),
    service.from('levels').select('id, code'),
  ]);

  // Best-effort throughout: the column degrades to "no data" rather than
  // failing the page. Subject Setup must open even when this cannot be built.
  for (const [label, res] of [
    ['terms', termsRes],
    ['sections', sectionsRes],
    ['levels', levelsRes],
  ] as const) {
    if (res.error) {
      console.error(`[sheet-impact] ${label} read failed:`, res.error.message);
      return out;
    }
  }

  type TermRow = { id: string; term_number: number; is_current: boolean };
  const terms = (termsRes.data ?? []) as TermRow[];
  if (terms.length === 0) return out;
  const termById = new Map(terms.map((t) => [t.id, t]));

  const levelCodeById = new Map(
    ((levelsRes.data ?? []) as { id: string; code: string }[]).map((l) => [
      l.id,
      l.code,
    ])
  );
  const sectionById = new Map(
    (
      (sectionsRes.data ?? []) as {
        id: string;
        name: string;
        level_id: string;
      }[]
    ).map((s) => [s.id, s])
  );

  const { data: sheetRows, error: sheetErr } = await service
    .from('grading_sheets')
    .select('id, subject_config_id, section_id, term_id, is_locked')
    .in(
      'term_id',
      terms.map((t) => t.id)
    );
  if (sheetErr) {
    console.error('[sheet-impact] sheets read failed:', sheetErr.message);
    return out;
  }

  type Candidate = UsedBySection & { levelCode: string };
  type Acc = {
    unlockedSheets: number;
    unlockedSections: Set<string>;
    /** section_id -> the sheet that section's chip should open. */
    pick: Map<string, Candidate>;
  };
  const acc = new Map<string, Acc>();

  for (const row of (sheetRows ?? []) as SheetRow[]) {
    const configId = row.subject_config_id;
    if (!configId) continue;
    const section = sectionById.get(row.section_id);
    const term = termById.get(row.term_id);
    if (!section || !term) continue; // another AY's row — not ours
    const levelCode = levelCodeById.get(section.level_id) ?? '—';

    let entry = acc.get(configId);
    if (!entry) {
      entry = {
        unlockedSheets: 0,
        unlockedSections: new Set(),
        pick: new Map(),
      };
      acc.set(configId, entry);
    }

    if (!row.is_locked) {
      entry.unlockedSheets += 1;
      entry.unlockedSections.add(row.section_id);
    }

    const candidate: Candidate = {
      name: section.name,
      sheetId: row.id,
      termNumber: term.term_number,
      isLocked: row.is_locked,
      isCurrentTerm: term.is_current,
      levelCode,
    };

    // The current term wins outright; otherwise the latest term that exists.
    // A teacher opening a class from here wants the sheet they are working in,
    // not whichever row the database happened to return first.
    const existing = entry.pick.get(row.section_id);
    const better =
      !existing ||
      (candidate.isCurrentTerm && !existing.isCurrentTerm) ||
      (candidate.isCurrentTerm === existing.isCurrentTerm &&
        candidate.termNumber > existing.termNumber);
    if (better) entry.pick.set(row.section_id, candidate);
  }

  for (const [configId, entry] of acc) {
    const byLevel = new Map<string, Candidate[]>();
    for (const candidate of entry.pick.values()) {
      const list = byLevel.get(candidate.levelCode) ?? [];
      list.push(candidate);
      byLevel.set(candidate.levelCode, list);
    }

    const sectionsByLevel = [...byLevel.entries()]
      .sort((a, b) => compareLevelCodes(a[0], b[0]))
      .map(([levelCode, list]) => ({
        levelCode,
        sections: list
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(({ levelCode: _drop, ...section }) => section),
      }));

    out.set(configId, {
      unlockedSheets: entry.unlockedSheets,
      unlockedSections: entry.unlockedSections.size,
      totalSections: entry.pick.size,
      levelCodes: sectionsByLevel.map((g) => g.levelCode),
      sectionsByLevel,
    });
  }

  return out;
}
