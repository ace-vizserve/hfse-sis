import 'server-only';

import { unstable_cache } from 'next/cache';

import {
  buildCompareCells,
  type CompareCellResult,
  type CompareInput,
  type CompareResult,
} from '@/lib/dashboard/compare';
import { fetchAllPages, fetchInChunks } from '@/lib/supabase/paginate';
import { createServiceClient } from '@/lib/supabase/service';

import { getMarkbookKpisRange, type MarkbookRangeKpis } from './dashboard';
import type { SubjectLevelRawPoint } from './insights-level';

export type MarkbookCompareKpis = MarkbookRangeKpis;

export type SubjectTrendPoint = {
  /** e.g. "T1", "T2" */
  periodLabel: string;
  ayCode: string;
  termId: string;
  subjectName: string;
  /** Average quarterly grade rounded to 1dp. null when no entries exist. */
  avgGrade: number | null;
};

/**
 * Fans out across CompareInput's cells, calling the existing per-range
 * KPI loader for each (ayCode, range) tuple. Each cell stays cached
 * independently via getMarkbookKpisRange's per-call unstable_cache, so
 * compare mode shares cache slots with the operational dashboard.
 */
export async function getMarkbookCompareKpis(
  input: CompareInput
): Promise<CompareResult<MarkbookCompareKpis>> {
  const cells = await buildCompareCells(input);
  if (cells.length === 0) return { cells: [] };

  const results = await Promise.all(
    cells.map((cell) =>
      getMarkbookKpisRange({
        ayCode: cell.ayCode,
        from: cell.range.from,
        to: cell.range.to,
        cmpFrom: null,
        cmpTo: null,
      })
    )
  );

  return {
    cells: cells.map((cell, i) => ({ cell, data: results[i].current })),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Subject performance trend — average quarterly grade per (subject × term)
// for examinable subjects. Powers the compare-page multi-series trend chart.
// KD #95: non-examinable subjects use letter grades, not numeric, so they
// are excluded from averages.
// ──────────────────────────────────────────────────────────────────────────

type CellMeta = {
  termId: string;
  periodLabel: string;
  ayCode: string;
};

async function loadSubjectPerformanceTrendUncached(
  termIds: string[],
  cellMeta: CellMeta[]
): Promise<SubjectTrendPoint[]> {
  const service = createServiceClient();

  // Step A: examinable grading sheets for the selected terms.
  // grading_sheets has a direct subject_id FK → subjects (confirmed in
  // masterfile.ts which selects subject_id from grading_sheets directly).
  // The !inner join + dot-notation filter follows the same pattern as
  // other queries in dashboard.ts (e.g. grading_sheets!inner joined to
  // sections!inner with dot-notation eq).
  type SheetRow = {
    id: string;
    term_id: string;
    subject:
      | { name: string; is_examinable: boolean }
      | { name: string; is_examinable: boolean }[]
      | null;
  };
  const { data: sheets, error: sheetsErr } = await service
    .from('grading_sheets')
    .select('id, term_id, subject:subjects!inner(name, is_examinable)')
    .in('term_id', termIds)
    .eq('subjects.is_examinable', true);

  if (sheetsErr || !sheets || sheets.length === 0) return [];

  const sheetMeta = new Map<string, { termId: string; subjectName: string }>();
  for (const s of sheets as SheetRow[]) {
    const subject = Array.isArray(s.subject) ? s.subject[0] : s.subject;
    if (!subject?.is_examinable) continue;
    sheetMeta.set(s.id, { termId: s.term_id, subjectName: subject.name });
  }

  const sheetIds = Array.from(sheetMeta.keys());
  if (sheetIds.length === 0) return [];

  // Step B: all grade entries for these sheets (paginated past the 1000-row
  // cap — at HFSE scale grade_entries can hit 14K+ rows per term per
  // dashboard.ts comment). The grading_sheet_id IN-clause is chunked so the
  // request URL stays under PostgREST's length cap: a two-AY comparison spans
  // ~2× the sheets of a single AY, which overflowed the limit and surfaced as
  // a bare 400 "Bad Request" (sibling pattern: loadEntriesRollup in
  // markbook/drill.ts). Select is_na so we can exclude N.A. terms — a student
  // not enrolled for a term carries is_na=true with a placeholder quarterly_grade
  // that should not pollute the subject average (Hard Rule #3 + KD #148).
  type EntryRow = {
    grading_sheet_id: string;
    quarterly_grade: number | null;
    is_na: boolean | null;
  };
  const entries = await fetchInChunks<EntryRow>(sheetIds, (slice) =>
    fetchAllPages<EntryRow>((from, to) =>
      service
        .from('grade_entries')
        .select('grading_sheet_id, quarterly_grade, is_na')
        .in('grading_sheet_id', slice)
        .not('quarterly_grade', 'is', null)
        .range(from, to)
    )
  );

  // Step C: sum per (termId, subjectName).
  const sums = new Map<string, { sum: number; count: number }>();
  for (const entry of entries) {
    // Skip N.A. rows — is_na=true means the student was not enrolled for this
    // term; the quarterly_grade is a placeholder, not a real grade (KD #148).
    if (entry.is_na === true) continue;
    if (entry.quarterly_grade === null) continue;
    const meta = sheetMeta.get(entry.grading_sheet_id);
    if (!meta) continue;
    const key = `${meta.termId}\x00${meta.subjectName}`;
    const slot = sums.get(key) ?? { sum: 0, count: 0 };
    slot.sum += entry.quarterly_grade;
    slot.count += 1;
    sums.set(key, slot);
  }

  // Step D: assemble result using cellMeta for period labels.
  const cellByTermId = new Map<string, CellMeta>(
    cellMeta.map((c) => [c.termId, c])
  );

  const points: SubjectTrendPoint[] = [];
  for (const [key, { sum, count }] of sums) {
    const nullIdx = key.indexOf('\x00');
    const termId = key.slice(0, nullIdx);
    const subjectName = key.slice(nullIdx + 1);
    const cell = cellByTermId.get(termId);
    if (!cell) continue;
    points.push({
      periodLabel: cell.periodLabel,
      ayCode: cell.ayCode,
      termId,
      subjectName,
      avgGrade: count > 0 ? Math.round((sum / count) * 10) / 10 : null,
    });
  }

  return points;
}

export function getSubjectPerformanceTrend(
  cells: CompareCellResult<MarkbookCompareKpis>[]
): Promise<SubjectTrendPoint[]> {
  const cellMeta: CellMeta[] = cells
    .filter((c) => !!c.cell.termId)
    .map((c) => ({
      termId: c.cell.termId!,
      periodLabel: `T${c.cell.termNumber ?? '?'}`,
      ayCode: c.cell.ayCode,
    }));

  if (cellMeta.length === 0) return Promise.resolve([]);

  const termIds = [...new Set(cellMeta.map((c) => c.termId))].sort();
  // Tag every AY in the comparison so a grade mutation in any selected AY
  // invalidates this view (KD #80) — not just the first one listed.
  const ayTags = [...new Set(cellMeta.map((c) => c.ayCode))].map(
    (ay) => `markbook-drill:${ay}`
  );

  return unstable_cache(
    loadSubjectPerformanceTrendUncached,
    ['markbook', 'subject-performance', ...termIds],
    { tags: ayTags, revalidate: 60 }
  )(termIds, cellMeta);
}

// ──────────────────────────────────────────────────────────────────────────
// Subject × Level performance trend — average quarterly grade per
// (subject × level × term) for examinable subjects. Extends
// getSubjectPerformanceTrend by adding the grading_sheet → section → level
// join so the Insights page can identify whether a weak subject is a
// curriculum-wide problem or confined to one level.
//
// Produces SubjectLevelRawPoint[] (sums + counts + failingCount) so the
// client-side pure helpers in insights-level.ts can derive averages and deltas
// without a second DB round-trip.
// ──────────────────────────────────────────────────────────────────────────

async function loadSubjectLevelTrendUncached(
  termIds: string[],
  cellMeta: CellMeta[]
): Promise<SubjectLevelRawPoint[]> {
  const service = createServiceClient();

  // Step A: examinable grading sheets for the selected terms, with section→level.
  // grading_sheets.section_id → sections.level_id → levels.code
  // We join sections + levels inline using the nested PostgREST syntax.
  type LevelSheetRow = {
    id: string;
    term_id: string;
    subject:
      | { name: string; is_examinable: boolean }
      | { name: string; is_examinable: boolean }[]
      | null;
    section:
      | { level: { code: string } | { code: string }[] | null }
      | { level: { code: string } | { code: string }[] | null }[]
      | null;
  };
  const { data: sheets, error: sheetsErr } = await service
    .from('grading_sheets')
    .select(
      'id, term_id, subject:subjects!inner(name, is_examinable), section:sections!inner(level:levels!inner(code))'
    )
    .in('term_id', termIds)
    .eq('subjects.is_examinable', true);

  if (sheetsErr || !sheets || sheets.length === 0) return [];

  // Build sheet-level metadata map: sheetId → { termId, subjectName, levelCode }
  type SheetMeta = { termId: string; subjectName: string; levelCode: string };
  const sheetMeta = new Map<string, SheetMeta>();
  for (const s of sheets as LevelSheetRow[]) {
    const subject = Array.isArray(s.subject) ? s.subject[0] : s.subject;
    if (!subject?.is_examinable) continue;
    const section = Array.isArray(s.section) ? s.section[0] : s.section;
    const levelRaw = section?.level;
    const level = Array.isArray(levelRaw) ? levelRaw[0] : levelRaw;
    if (!level?.code) continue;
    sheetMeta.set(s.id, {
      termId: s.term_id,
      subjectName: subject.name,
      levelCode: level.code,
    });
  }

  const sheetIds = Array.from(sheetMeta.keys());
  if (sheetIds.length === 0) return [];

  // Step B: grade entries for these sheets — same chunked + paginated pattern
  // as loadSubjectPerformanceTrendUncached. Include is_na to exclude N.A. terms
  // (KD #148), and quarterly_grade for sums + failing-band counts.
  type EntryRow = {
    grading_sheet_id: string;
    quarterly_grade: number | null;
    is_na: boolean | null;
  };
  const entries = await fetchInChunks<EntryRow>(sheetIds, (slice) =>
    fetchAllPages<EntryRow>((from, to) =>
      service
        .from('grade_entries')
        .select('grading_sheet_id, quarterly_grade, is_na')
        .in('grading_sheet_id', slice)
        .not('quarterly_grade', 'is', null)
        .range(from, to)
    )
  );

  // Step C: accumulate sums + counts + failing counts per (termId, subjectName, levelCode).
  // Failing bands: DNM (< 75) + FS (75–79) — keys 'dnm' and 'fs'.
  const FAILING_LO = 0;
  const FAILING_HI = 79; // inclusive upper bound of the two failing bands

  const sums = new Map<
    string,
    { sum: number; count: number; failingCount: number }
  >();
  for (const entry of entries) {
    if (entry.is_na === true) continue;
    if (entry.quarterly_grade === null) continue;
    const meta = sheetMeta.get(entry.grading_sheet_id);
    if (!meta) continue;
    const key = `${meta.termId}\x00${meta.subjectName}\x00${meta.levelCode}`;
    const slot = sums.get(key) ?? { sum: 0, count: 0, failingCount: 0 };
    slot.sum += entry.quarterly_grade;
    slot.count += 1;
    if (
      entry.quarterly_grade >= FAILING_LO &&
      entry.quarterly_grade <= FAILING_HI
    ) {
      slot.failingCount += 1;
    }
    sums.set(key, slot);
  }

  // Step D: assemble using cellMeta for period labels.
  const cellByTermId = new Map<string, CellMeta>(
    cellMeta.map((c) => [c.termId, c])
  );

  const points: SubjectLevelRawPoint[] = [];
  for (const [key, { sum, count, failingCount }] of sums) {
    const parts = key.split('\x00');
    const [termId, subjectName, levelCode] = parts;
    const cell = cellByTermId.get(termId);
    if (!cell) continue;
    points.push({
      periodLabel: cell.periodLabel,
      ayCode: cell.ayCode,
      termId,
      subjectName,
      levelCode,
      sum,
      count,
      failingCount,
    });
  }

  return points;
}

export function getSubjectLevelTrend(
  cells: CompareCellResult<MarkbookCompareKpis>[]
): Promise<SubjectLevelRawPoint[]> {
  const cellMeta: CellMeta[] = cells
    .filter((c) => !!c.cell.termId)
    .map((c) => ({
      termId: c.cell.termId!,
      periodLabel: `T${c.cell.termNumber ?? '?'}`,
      ayCode: c.cell.ayCode,
    }));

  if (cellMeta.length === 0) return Promise.resolve([]);

  const termIds = [...new Set(cellMeta.map((c) => c.termId))].sort();
  const ayTags = [...new Set(cellMeta.map((c) => c.ayCode))].map(
    (ay) => `markbook-drill:${ay}`
  );

  return unstable_cache(
    loadSubjectLevelTrendUncached,
    ['markbook', 'subject-level-trend', ...termIds],
    { tags: ayTags, revalidate: 60 }
  )(termIds, cellMeta);
}
