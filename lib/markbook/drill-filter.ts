import type {
  ChangeRequestRow,
  GradeEntryRow,
  MarkbookDrillRow,
  MarkbookDrillTarget,
  SheetRow,
} from '@/lib/markbook/drill';

// Client-safe Markbook drill-filter module. Single source of truth for two
// things that used to be triplicated / duplicated across dashboard.ts,
// drill.ts, and drill-target-filter.ts:
//
//   1. GRADE_BANDS — the canonical mastery-band vocabulary shared by the
//      grade-distribution histogram (dashboard.ts) and the grade-bucket-
//      entries drill (drill.ts). Previously drill.ts + drill-target-filter.ts
//      each hand-maintained a SECOND, DIFFERENTLY-WORDED band/label set
//      ("Below Minimum (< 75)" vs dashboard's "< 75 (DNM)") — dead in
//      practice (the chart only ever clicks through the bucket `key`, never
//      the label) but a drift risk regardless. dashboard.ts now re-exports
//      GRADE_BANDS from here for its existing consumers.
//
//   2. applyTargetFilter — the switch that narrows a universal drill row set
//      down to the target/segment the user clicked. drill.ts (server, has
//      service-role DB access) and the client drill-seed narrowing path in
//      components/markbook/drills/markbook-drill-sheet.tsx (the ONE
//      sanctioned exception to KD #24's drill-seed rule: markbook's client
//      seed is pre-narrowed via this exact function, so it's allowed to use
//      TanStack Query's `initialData` instead of `placeholderData`) both call
//      this single implementation now — previously drill-target-filter.ts
//      hand-maintained a client mirror of drill.ts's private switch, which
//      could silently drift from the server version it was supposed to copy.
//
// Runtime-pure: only `import type` for anything server-side (drill.ts's row
// shapes), no 'server-only' import, no Supabase client of any kind — safe to
// import from a 'use client' component.

// ---------------------------------------------------------------------------
// Grade bands

// HFSE-standard mastery bands (DepEd Phil. Sec style — widely used in intl
// schools following the K–12 grading framework). Buckets are inclusive-low,
// inclusive-high except the last which is 90–100.
export const GRADE_BANDS = [
  { key: 'dnm', label: '< 75 (DNM)', lo: 0, hi: 74 },
  { key: 'fs', label: '75–79 (FS)', lo: 75, hi: 79 },
  { key: 's', label: '80–84 (S)', lo: 80, hi: 84 },
  { key: 'vs', label: '85–89 (VS)', lo: 85, hi: 89 },
  { key: 'o', label: '90–100 (O)', lo: 90, hi: 100 },
] as const;

export type GradeBand = (typeof GRADE_BANDS)[number]['key'];

/** Classify a numeric grade into its mastery band, or null when ungraded. */
export function classifyGradeBucket(grade: number | null): GradeBand | null {
  if (grade == null || !Number.isFinite(grade)) return null;
  for (const b of GRADE_BANDS) {
    if (grade >= b.lo && grade <= b.hi) return b.key;
  }
  return null;
}

function findBucketByLabel(label: string): GradeBand | null {
  const match = GRADE_BANDS.find((b) => b.label === label);
  return match?.key ?? null;
}

// ---------------------------------------------------------------------------
// Target filter — narrow universal row set to the rows the user expected.
//
// Two semantic alignments made when this switch was centralized (previously
// the two independent copies — drill.ts's server switch and
// drill-target-filter.ts's client mirror — agreed with EACH OTHER but not
// with the dashboard KPI they're supposed to match):
//
//  - 'change-requests' segment='decided': now keys on `reviewedAt` (the raw
//    `reviewed_at` column), matching both loadChangeRequestSummaryUncached
//    and loadMarkbookKpisForRange in dashboard.ts, which compute
//    decidedCount/avgDecisionHours from `reviewed_at` alone. The row's
//    `resolvedAt` field (`applied_at ?? reviewed_at`, used for display) is a
//    DIFFERENT, later timestamp once a request has actually been applied —
//    filtering 'decided' on it undercounted `applied` requests whose
//    reviewed_at predates their applied_at outside the intended window, and
//    could diverge from the KPI's decided set entirely once the two
//    timestamps differ.
//
//  - 'sheets-locked': the range gate now reproduces
//    loadMarkbookKpisForRange's own `${date}T00:00:00+08:00` /
//    `${date}T23:59:59+08:00` SGT-day-boundary construction (KD #32) and
//    compares the raw ISO `lockedAt` string against it directly — matching
//    the dashboard's "sheets LOCKED inside the picker range" KPI bit for
//    bit. The previous `lockedAt.slice(0, 10) >= from` compared calendar
//    dates in UTC, which could disagree with the dashboard's SGT-anchored
//    check right at a day boundary.
//
//  - 'grade-bucket-entries': the histogram (dashboard.ts's
//    loadGradeDistributionUncached) is examinable-subjects-only and excludes
//    N.A. entries (Hard Rule #3 — an is_na=true row's quarterly_grade is
//    computed from placeholder zeros, not a real grade). The drill's entry
//    loader had neither filter, so the "Grade distribution" card and its
//    drill could disagree on which rows counted. Applied ONLY to this
//    target — 'grade-entries' (the "Grades entered" KPI) and
//    'teacher-entry-velocity' intentionally count every entry, examinable or
//    not, N.A. or not.
export function applyTargetFilter(
  rows: MarkbookDrillRow[],
  target: MarkbookDrillTarget,
  segment?: string | null,
  range?: { from?: string; to?: string }
): MarkbookDrillRow[] {
  switch (target) {
    case 'grade-entries':
      return rows;
    case 'sheets-locked': {
      // Match the dashboard KPI exactly: only sheets that were LOCKED inside
      // the active range count. The scope filter (applyScopeFilter in
      // drill.ts) intentionally lets unlocked sheets through (so the UI can
      // show pending work), so the target filter has to enforce the range
      // gate for this drill specifically.
      const from = range?.from;
      const to = range?.to;
      if (from && to) {
        const fromIso = `${from}T00:00:00+08:00`;
        const toIso = `${to}T23:59:59+08:00`;
        return (rows as SheetRow[]).filter(
          (r) =>
            r.isLocked &&
            r.lockedAt != null &&
            r.lockedAt >= fromIso &&
            r.lockedAt <= toIso
        ) as MarkbookDrillRow[];
      }
      return (rows as SheetRow[]).filter(
        (r) => r.isLocked
      ) as MarkbookDrillRow[];
    }
    case 'change-requests':
      if (!segment) return rows;
      // 'decided' = the set the avg-decision-time KPI averages over: any
      // request with a reviewed_at AND a terminal status. Keeps the drill
      // aligned with the headline number when the user clicks it.
      if (segment === 'decided') {
        return (rows as ChangeRequestRow[]).filter(
          (r) =>
            r.reviewedAt != null &&
            (r.status === 'approved' ||
              r.status === 'rejected' ||
              r.status === 'applied')
        ) as MarkbookDrillRow[];
      }
      return (rows as ChangeRequestRow[]).filter(
        (r) => r.status === segment
      ) as MarkbookDrillRow[];
    case 'publication-coverage':
      if (!segment) return rows;
      if (segment === 'published') {
        return (rows as SheetRow[]).filter(
          (r) => r.isPublished
        ) as MarkbookDrillRow[];
      }
      if (segment === 'not-published') {
        return (rows as SheetRow[]).filter(
          (r) => !r.isPublished
        ) as MarkbookDrillRow[];
      }
      return rows;
    case 'grade-bucket-entries': {
      // Examinable subjects only + exclude N.A. entries — mirrors
      // loadGradeDistributionUncached's sheet-level is_examinable inner join
      // + entry-level is_na skip. Scoped to THIS target only.
      const examinable = (rows as GradeEntryRow[]).filter(
        (r) => r.isExaminable && !r.isNa
      );
      if (!segment) return examinable as MarkbookDrillRow[];
      // Accept either the bucket key ('o', 'vs', …) or the bucket label.
      const key = GRADE_BANDS.some((b) => b.key === segment)
        ? (segment as GradeBand)
        : findBucketByLabel(segment);
      if (!key) return examinable as MarkbookDrillRow[];
      return examinable.filter(
        (r) => r.gradeBucket === key
      ) as MarkbookDrillRow[];
    }
    case 'term-sheet-status': {
      // The chart (`SheetProgressChart`) emits human labels like
      // 'Term 1 · Locked' / 'Term 1 · Open'. The legacy regex expected the
      // compact 'T1:locked' form and silently fell through to `return rows`
      // (= every sheet) when the label form came in — same class of bug as
      // term-publication-status had before its dual-regex fix. Accept both.
      // Bare 'T<n>' returns all sheets in that term.
      if (!segment) return rows;
      const compact = /^T(\d+)(?::(locked|open))?$/i.exec(segment);
      const labelled = /^Term\s+(\d+)\s*[·.\-]\s*(Locked|Open)$/i.exec(segment);
      const m = compact ?? labelled;
      if (!m) return rows;
      const termNumber = Number(m[1]);
      const status = (m[2] ?? '').toLowerCase() as 'locked' | 'open' | '';
      return (rows as SheetRow[]).filter((r) => {
        if (r.termNumber !== termNumber) return false;
        if (status === 'locked') return r.isLocked;
        if (status === 'open') return !r.isLocked;
        return true;
      }) as MarkbookDrillRow[];
    }
    case 'term-publication-status': {
      if (!segment) return rows;
      // The chart (`PublicationCoverageChart`) emits human labels like
      // 'Term 1 · Published' / 'Term 1 · Unpublished'. The legacy regex
      // expected the compact 'T1:not-published' form and silently fell
      // through to `return rows` (= every sheet) when the label form
      // came in. Accept both formats.
      const compact = /^T(\d+)(?::(published|not-published))?$/i.exec(segment);
      const labelled =
        /^Term\s+(\d+)\s*[·.\-]\s*(Published|Unpublished)$/i.exec(segment);
      const m = compact ?? labelled;
      if (!m) return rows;
      const termNumber = Number(m[1]);
      const raw = (m[2] ?? '').toLowerCase();
      const status: 'published' | 'not-published' | '' =
        raw === 'published'
          ? 'published'
          : raw === 'unpublished' || raw === 'not-published'
            ? 'not-published'
            : '';
      const filtered = (rows as SheetRow[]).filter((r) => {
        if (r.termNumber !== termNumber) return false;
        if (status === 'published') return r.isPublished;
        if (status === 'not-published') return !r.isPublished;
        return true;
      });
      // The chart counts SECTIONS-with-this-publication-status per term,
      // not sheets. Dedupe by sectionId so the drill returns one row per
      // section (matching the bar height the user clicked) instead of
      // one row per (section × subject) sheet. Keeps the first sheet
      // encountered as the section's representative — section-level
      // fields (sectionName, level, termNumber, isPublished) are uniform
      // across all of a section's sheets in the same term, so the choice
      // of representative doesn't change the displayed data.
      const seenSection = new Set<string>();
      const out: SheetRow[] = [];
      for (const r of filtered) {
        if (seenSection.has(r.sectionId)) continue;
        seenSection.add(r.sectionId);
        out.push(r);
      }
      return out as MarkbookDrillRow[];
    }
    case 'sheet-readiness-section': {
      // Segment = section name. Show non-locked sheets in that section so
      // the user sees the open-sheet backlog drilled-into.
      if (!segment) {
        return (rows as SheetRow[]).filter(
          (r) => !r.isLocked
        ) as MarkbookDrillRow[];
      }
      return (rows as SheetRow[]).filter(
        (r) => r.sectionName === segment && !r.isLocked
      ) as MarkbookDrillRow[];
    }
    case 'teacher-entry-velocity': {
      // Segment = teacher email. Show entries by that teacher; if no segment,
      // return all entries (teacher view will still group by enteredBy).
      if (!segment) return rows;
      return (rows as GradeEntryRow[]).filter(
        (r) => r.enteredBy === segment
      ) as MarkbookDrillRow[];
    }
    default: {
      const _exhaustive: never = target;
      throw new Error(`unreachable target: ${String(_exhaustive)}`);
    }
  }
}

// Back-compat alias — the name the client drill-seed narrowing path
// (components/markbook/drills/markbook-drill-sheet.tsx) imports. Kept as a
// distinct export name rather than renaming every call site, since it names
// the SPECIFIC sanctioned use (narrowing a pre-fetched seed client-side) that
// KD #24's drill-seed rule carves out as the one `initialData`-eligible case.
export const applyTargetFilterClient = applyTargetFilter;
