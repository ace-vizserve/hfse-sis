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
  // markbook/drill.ts).
  type EntryRow = { grading_sheet_id: string; quarterly_grade: number | null };
  const entries = await fetchInChunks<EntryRow>(sheetIds, (slice) =>
    fetchAllPages<EntryRow>((from, to) =>
      service
        .from('grade_entries')
        .select('grading_sheet_id, quarterly_grade')
        .in('grading_sheet_id', slice)
        .not('quarterly_grade', 'is', null)
        .range(from, to)
    )
  );

  // Step C: sum per (termId, subjectName).
  const sums = new Map<string, { sum: number; count: number }>();
  for (const entry of entries) {
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
