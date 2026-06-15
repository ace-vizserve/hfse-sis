'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  AlertTriangle,
  CheckCircle2,
  Lock,
  RotateCcw,
  Unlock,
} from 'lucide-react';

import {
  DrillDownSheet,
  type DrillDownDensity,
  type DrillDownGroupBy,
} from '@/components/dashboard/drill-down-sheet';
import { DrillSheetSkeleton } from '@/components/dashboard/drill-sheet-skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/query/fetcher';
import { queryKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils';
import {
  allColumnsForKind,
  defaultColumnsForTarget,
  drillHeaderForTarget,
  DRILL_COLUMN_LABELS,
  rowKindForTarget,
  type ChangeRequestRow,
  type DrillColumnKey,
  type GradeEntryRow,
  type MarkbookDrillRow,
  type MarkbookDrillRowKind,
  type MarkbookDrillTarget,
  type SheetRow,
} from '@/lib/markbook/drill';
import { applyTargetFilterClient } from '@/lib/markbook/drill-target-filter';

// Stable reference so `rows` doesn't get a fresh [] each render while the query
// is loading (downstream memos depend on its identity).
const EMPTY_ROWS: MarkbookDrillRow[] = [];

export type MarkbookDrillSheetProps = {
  target: MarkbookDrillTarget;
  segment?: string | null;
  ayCode: string;
  initialFrom?: string;
  initialTo?: string;
  /** Pre-fetched rows keyed by kind. The component uses the kind matching the target. */
  initialEntries?: GradeEntryRow[];
  initialSheets?: SheetRow[];
  initialChangeRequests?: ChangeRequestRow[];
};

const CANONICAL_LEVEL_ORDER = [
  'P1',
  'P2',
  'P3',
  'P4',
  'P5',
  'P6',
  'S1',
  'S2',
  'S3',
  'S4',
];
function compareLevels(a: string | null, b: string | null): number {
  const av = a ?? 'Unknown';
  const bv = b ?? 'Unknown';
  if (av === bv) return 0;
  if (av === 'Unknown') return 1;
  if (bv === 'Unknown') return -1;
  const ai = CANONICAL_LEVEL_ORDER.indexOf(av);
  const bi = CANONICAL_LEVEL_ORDER.indexOf(bv);
  if (ai !== -1 && bi !== -1) return ai - bi;
  if (ai !== -1) return -1;
  if (bi !== -1) return 1;
  return av.localeCompare(bv);
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-SG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

const BADGE_BASE =
  'h-6 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]';

function GradeBucketBadge({ bucket }: { bucket: string | null }) {
  if (!bucket) return <span className="text-muted-foreground">—</span>;
  const variant: 'success' | 'muted' | 'blocked' =
    bucket === 'o' || bucket === 'vs'
      ? 'success'
      : bucket === 'dnm'
        ? 'blocked'
        : 'muted';
  return (
    <Badge variant={variant} className={BADGE_BASE}>
      {bucket.toUpperCase()}
    </Badge>
  );
}

function LockBadge({ locked }: { locked: boolean }) {
  return locked ? (
    <Badge variant="blocked" className={BADGE_BASE}>
      <Lock className="h-3 w-3" /> Locked
    </Badge>
  ) : (
    <Badge variant="muted" className={BADGE_BASE}>
      <Unlock className="h-3 w-3" /> Open
    </Badge>
  );
}

function PublishBadge({ published }: { published: boolean }) {
  return published ? (
    <Badge variant="success" className={BADGE_BASE}>
      <CheckCircle2 className="h-3 w-3" /> Published
    </Badge>
  ) : (
    <Badge variant="muted" className={BADGE_BASE}>
      —
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  const lower = status.toLowerCase();
  const variant: 'success' | 'muted' | 'blocked' =
    lower === 'approved' || lower === 'closed'
      ? 'success'
      : lower === 'rejected'
        ? 'blocked'
        : 'muted';
  return (
    <Badge variant={variant} className={BADGE_BASE}>
      {status}
    </Badge>
  );
}

function CompletenessCell({ row }: { row: SheetRow }) {
  const tone =
    row.completenessPct >= 100
      ? 'text-foreground'
      : row.completenessPct >= 50
        ? 'text-foreground'
        : 'text-destructive';
  return (
    <span className={`font-mono text-[11px] tabular-nums ${tone}`}>
      {row.entriesPresent}/{row.entriesExpected} · {row.completenessPct}%
    </span>
  );
}

function buildEntryColumns(
  visible: DrillColumnKey[]
): ColumnDef<GradeEntryRow, unknown>[] {
  const cols: ColumnDef<GradeEntryRow, unknown>[] = [];
  for (const key of visible) {
    switch (key) {
      case 'studentName':
        cols.push({
          id: 'studentName',
          accessorKey: 'studentName',
          header: DRILL_COLUMN_LABELS.studentName,
          cell: ({ row }) => (
            <div className="space-y-0.5">
              <Link
                href={`/records/students/${encodeURIComponent(row.original.studentNumber)}`}
                className="font-medium text-foreground transition-colors hover:text-primary hover:underline underline-offset-4"
              >
                {row.original.studentName}
              </Link>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {row.original.studentNumber}
              </div>
            </div>
          ),
        });
        break;
      case 'studentNumber':
        cols.push({
          id: 'studentNumber',
          accessorKey: 'studentNumber',
          header: DRILL_COLUMN_LABELS.studentNumber,
          cell: ({ row }) => (
            <span className="font-mono text-xs">
              {row.original.studentNumber}
            </span>
          ),
        });
        break;
      case 'level':
        cols.push({
          id: 'level',
          accessorKey: 'level',
          header: DRILL_COLUMN_LABELS.level,
          cell: ({ row }) => (
            <span className="text-sm text-muted-foreground">
              {row.original.level ?? '—'}
            </span>
          ),
          sortingFn: (a, b) =>
            compareLevels(a.original.level, b.original.level),
        });
        break;
      case 'sectionName':
        cols.push({
          id: 'sectionName',
          accessorKey: 'sectionName',
          header: DRILL_COLUMN_LABELS.sectionName,
          cell: ({ row }) => (
            <Link
              href={`/markbook/grading?grading.section=${encodeURIComponent(row.original.sectionName)}`}
              className="text-sm text-foreground transition-colors hover:text-primary hover:underline underline-offset-4"
            >
              {row.original.sectionName}
            </Link>
          ),
        });
        break;
      case 'subjectCode':
        cols.push({
          id: 'subjectCode',
          accessorKey: 'subjectCode',
          header: DRILL_COLUMN_LABELS.subjectCode,
          cell: ({ row }) => (
            <span className="font-mono text-xs">
              {row.original.subjectCode}
            </span>
          ),
        });
        break;
      case 'termNumber':
        cols.push({
          id: 'termNumber',
          accessorKey: 'termNumber',
          header: DRILL_COLUMN_LABELS.termNumber,
          cell: ({ row }) => (
            <span className="font-mono text-xs">
              T{row.original.termNumber}
            </span>
          ),
        });
        break;
      case 'rawScore':
        cols.push({
          id: 'rawScore',
          accessorKey: 'rawScore',
          header: DRILL_COLUMN_LABELS.rawScore,
          cell: ({ row }) => (
            <span className="tabular-nums">
              {row.original.rawScore ?? '—'}/{row.original.maxScore}
            </span>
          ),
        });
        break;
      case 'wwScores':
        cols.push({
          id: 'wwScores',
          accessorKey: 'wwScores',
          header: DRILL_COLUMN_LABELS.wwScores,
          cell: ({ row }) => (
            <span className="font-mono text-xs tabular-nums">
              {(row.original.wwScores ?? []).length === 0
                ? '—'
                : (row.original.wwScores ?? [])
                    .map((s) => (s == null ? '—' : s))
                    .join(' · ')}
            </span>
          ),
        });
        break;
      case 'ptScores':
        cols.push({
          id: 'ptScores',
          accessorKey: 'ptScores',
          header: DRILL_COLUMN_LABELS.ptScores,
          cell: ({ row }) => (
            <span className="font-mono text-xs tabular-nums">
              {(row.original.ptScores ?? []).length === 0
                ? '—'
                : (row.original.ptScores ?? [])
                    .map((s) => (s == null ? '—' : s))
                    .join(' · ')}
            </span>
          ),
        });
        break;
      case 'qaScore':
        cols.push({
          id: 'qaScore',
          accessorKey: 'qaScore',
          header: DRILL_COLUMN_LABELS.qaScore,
          cell: ({ row }) => (
            <span className="font-mono text-xs tabular-nums">
              {row.original.qaScore ?? '—'}/{row.original.qaMax ?? '—'}
            </span>
          ),
        });
        break;
      case 'computedGrade':
        cols.push({
          id: 'computedGrade',
          accessorKey: 'computedGrade',
          header: DRILL_COLUMN_LABELS.computedGrade,
          cell: ({ row }) => (
            <span className="font-mono text-sm font-semibold tabular-nums">
              {row.original.computedGrade ?? '—'}
            </span>
          ),
        });
        break;
      case 'letterGrade':
        cols.push({
          id: 'letterGrade',
          accessorKey: 'letterGrade',
          header: DRILL_COLUMN_LABELS.letterGrade,
          cell: ({ row }) => (
            <span className="font-mono text-sm font-semibold">
              {row.original.letterGrade ?? '—'}
            </span>
          ),
        });
        break;
      case 'isLocked':
        cols.push({
          id: 'isLocked',
          accessorKey: 'isLocked',
          header: DRILL_COLUMN_LABELS.isLocked,
          cell: ({ row }) => <LockBadge locked={row.original.isLocked} />,
        });
        break;
      case 'enteredAt':
        cols.push({
          id: 'enteredAt',
          accessorKey: 'enteredAt',
          header: DRILL_COLUMN_LABELS.enteredAt,
          cell: ({ row }) => (
            <span className="text-sm tabular-nums text-muted-foreground">
              {formatDate(row.original.enteredAt)}
            </span>
          ),
        });
        break;
      case 'enteredBy':
        cols.push({
          id: 'enteredBy',
          accessorKey: 'enteredBy',
          header: DRILL_COLUMN_LABELS.enteredBy,
          cell: ({ row }) => (
            <span className="text-xs text-muted-foreground">
              {row.original.enteredBy ?? '—'}
            </span>
          ),
        });
        break;
    }
  }
  return cols;
}

function buildSheetColumns(
  visible: DrillColumnKey[]
): ColumnDef<SheetRow, unknown>[] {
  const cols: ColumnDef<SheetRow, unknown>[] = [];
  for (const key of visible) {
    switch (key) {
      case 'sheetSubjectTerm':
        cols.push({
          id: 'sheetSubjectTerm',
          header: DRILL_COLUMN_LABELS.sheetSubjectTerm,
          accessorFn: (r) => `${r.subjectCode} · T${r.termNumber}`,
          cell: ({ row }) => (
            <div className="space-y-0.5">
              <div className="font-mono text-xs">
                {row.original.subjectCode}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Term {row.original.termNumber}
              </div>
            </div>
          ),
        });
        break;
      case 'sectionName':
        cols.push({
          id: 'sectionName',
          accessorKey: 'sectionName',
          header: DRILL_COLUMN_LABELS.sectionName,
          cell: ({ row }) => {
            // Namespaced filter params (KD #84 — the grading DataTable reads
            // its url-state under the `grading.` prefix). `grading.section` is
            // an exact-match facet; `grading.subject`/`grading.term` values
            // mirror the table's cell values (subject name + term.label).
            const p: Record<string, string> = {
              'grading.section': row.original.sectionName,
              'grading.status': row.original.isLocked ? 'locked' : 'open',
            };
            if (row.original.subjectName)
              p['grading.subject'] = row.original.subjectName;
            if (row.original.termLabel)
              p['grading.term'] = row.original.termLabel;
            return (
              <Link
                href={`/markbook/grading?${new URLSearchParams(p).toString()}`}
                className="text-sm text-foreground transition-colors hover:text-primary hover:underline underline-offset-4"
              >
                {row.original.sectionName}
              </Link>
            );
          },
        });
        break;
      case 'level':
        cols.push({
          id: 'level',
          accessorKey: 'level',
          header: DRILL_COLUMN_LABELS.level,
          cell: ({ row }) => (
            <span className="text-sm text-muted-foreground">
              {row.original.level ?? '—'}
            </span>
          ),
          sortingFn: (a, b) =>
            compareLevels(a.original.level, b.original.level),
        });
        break;
      case 'subjectCode':
        cols.push({
          id: 'subjectCode',
          accessorKey: 'subjectCode',
          header: DRILL_COLUMN_LABELS.subjectCode,
          cell: ({ row }) => (
            <span className="font-mono text-xs">
              {row.original.subjectCode}
            </span>
          ),
        });
        break;
      case 'termNumber':
        cols.push({
          id: 'termNumber',
          accessorKey: 'termNumber',
          header: DRILL_COLUMN_LABELS.termNumber,
          cell: ({ row }) => (
            <span className="font-mono text-xs">
              T{row.original.termNumber}
            </span>
          ),
        });
        break;
      case 'isLocked':
        cols.push({
          id: 'isLocked',
          accessorKey: 'isLocked',
          header: DRILL_COLUMN_LABELS.isLocked,
          cell: ({ row }) => <LockBadge locked={row.original.isLocked} />,
        });
        break;
      case 'lockedAt':
        cols.push({
          id: 'lockedAt',
          accessorKey: 'lockedAt',
          header: DRILL_COLUMN_LABELS.lockedAt,
          cell: ({ row }) => (
            <span className="text-sm tabular-nums text-muted-foreground">
              {formatDate(row.original.lockedAt)}
            </span>
          ),
        });
        break;
      case 'publishedAt':
        cols.push({
          id: 'publishedAt',
          accessorKey: 'publishedAt',
          header: DRILL_COLUMN_LABELS.publishedAt,
          cell: ({ row }) =>
            row.original.isPublished ? (
              <span className="text-sm tabular-nums">
                {formatDate(row.original.publishedAt)}
              </span>
            ) : (
              <PublishBadge published={false} />
            ),
        });
        break;
      case 'completeness':
        cols.push({
          id: 'completeness',
          accessorKey: 'completenessPct',
          header: DRILL_COLUMN_LABELS.completeness,
          cell: ({ row }) => <CompletenessCell row={row.original} />,
        });
        break;
      case 'teacherName':
        cols.push({
          id: 'teacherName',
          accessorKey: 'teacherName',
          header: DRILL_COLUMN_LABELS.teacherName,
          cell: ({ row }) => (
            <span className="text-xs text-muted-foreground">
              {row.original.teacherName ?? '—'}
            </span>
          ),
        });
        break;
    }
  }
  return cols;
}

function buildChangeRequestColumns(
  visible: DrillColumnKey[]
): ColumnDef<ChangeRequestRow, unknown>[] {
  const cols: ColumnDef<ChangeRequestRow, unknown>[] = [];
  for (const key of visible) {
    switch (key) {
      case 'sectionName':
        cols.push({
          id: 'sectionName',
          accessorKey: 'sectionName',
          header: DRILL_COLUMN_LABELS.sectionName,
          cell: ({ row }) => (
            <Link
              href={`/markbook/grading?grading.section=${encodeURIComponent(row.original.sectionName)}`}
              className="text-sm text-foreground transition-colors hover:text-primary hover:underline underline-offset-4"
            >
              {row.original.sectionName}
            </Link>
          ),
        });
        break;
      case 'subjectCode':
        cols.push({
          id: 'subjectCode',
          accessorKey: 'subjectCode',
          header: DRILL_COLUMN_LABELS.subjectCode,
          cell: ({ row }) => (
            <span className="font-mono text-xs">
              {row.original.subjectCode}
            </span>
          ),
        });
        break;
      case 'termNumber':
        cols.push({
          id: 'termNumber',
          accessorKey: 'termNumber',
          header: DRILL_COLUMN_LABELS.termNumber,
          cell: ({ row }) => (
            <span className="font-mono text-xs">
              T{row.original.termNumber}
            </span>
          ),
        });
        break;
      case 'status':
        cols.push({
          id: 'status',
          accessorKey: 'status',
          header: DRILL_COLUMN_LABELS.status,
          cell: ({ row }) => <StatusBadge status={row.original.status} />,
        });
        break;
      case 'fieldChanged':
        cols.push({
          id: 'fieldChanged',
          accessorKey: 'fieldChanged',
          header: DRILL_COLUMN_LABELS.fieldChanged,
          cell: ({ row }) => (
            <span className="font-mono text-xs">
              {row.original.fieldChanged}
            </span>
          ),
        });
        break;
      case 'reasonCategory':
        cols.push({
          id: 'reasonCategory',
          accessorKey: 'reasonCategory',
          header: DRILL_COLUMN_LABELS.reasonCategory,
          cell: ({ row }) => (
            <span className="text-xs text-muted-foreground">
              {row.original.reasonCategory}
            </span>
          ),
        });
        break;
      case 'requestedBy':
        cols.push({
          id: 'requestedBy',
          accessorKey: 'requestedBy',
          header: DRILL_COLUMN_LABELS.requestedBy,
          cell: ({ row }) => (
            <span className="text-xs text-muted-foreground">
              {row.original.requestedBy}
            </span>
          ),
        });
        break;
      case 'requestedAt':
        cols.push({
          id: 'requestedAt',
          accessorKey: 'requestedAt',
          header: DRILL_COLUMN_LABELS.requestedAt,
          cell: ({ row }) => (
            <span className="text-sm tabular-nums">
              {formatDate(row.original.requestedAt)}
            </span>
          ),
        });
        break;
      case 'resolvedAt':
        cols.push({
          id: 'resolvedAt',
          accessorKey: 'resolvedAt',
          header: DRILL_COLUMN_LABELS.resolvedAt,
          cell: ({ row }) => (
            <span className="text-sm tabular-nums text-muted-foreground">
              {formatDate(row.original.resolvedAt)}
            </span>
          ),
        });
        break;
    }
  }
  return cols;
}

export function MarkbookDrillSheet(props: MarkbookDrillSheetProps) {
  const {
    target,
    segment,
    ayCode,
    initialFrom,
    initialTo,
    initialEntries,
    initialSheets,
    initialChangeRequests,
  } = props;

  const kind = rowKindForTarget(target);
  // Seed rows arrive scope-filtered (lockedAt/publishedAt or requestedAt in
  // range) but NOT target-narrowed. Without the client-side filter pass, the
  // drill displays the whole scope-filtered universe — e.g. "sheets-locked"
  // drill includes unlocked sheets, "change-requests pending" drill includes
  // approved/rejected rows — and the count diverges from the metric card.
  // Apply the same logic the API uses so the seed shortcut renders the same
  // rows the API would have returned.
  const seedRows: MarkbookDrillRow[] = React.useMemo(() => {
    const raw: MarkbookDrillRow[] =
      kind === 'entry'
        ? (initialEntries ?? [])
        : kind === 'sheet'
          ? (initialSheets ?? [])
          : (initialChangeRequests ?? []);
    if (raw.length === 0) return raw;
    return applyTargetFilterClient(raw, target, segment ?? null, {
      from: initialFrom,
      to: initialTo,
    });
  }, [
    kind,
    target,
    segment,
    initialFrom,
    initialTo,
    initialEntries,
    initialSheets,
    initialChangeRequests,
  ]);

  // Read via TanStack Query. Seed rows (scope-filtered + target-narrowed by the
  // memo above) are passed as initialData, so a seeded drill renders instantly
  // and — being fresh within staleTime — skips the network round-trip, matching
  // the old skipNextFetchRef behaviour. An unseeded drill fetches on open and
  // shows the skeleton. The queryFn forwards the abort signal, so a fast
  // close/reopen aborts the stale request instead of racing it onto the screen.
  const drillQuery = useQuery({
    queryKey: queryKeys.markbookDrill(target, {
      ay: ayCode,
      from: initialFrom ?? null,
      to: initialTo ?? null,
      segment: segment ?? null,
    }),
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ ay: ayCode });
      if (initialFrom) params.set('from', initialFrom);
      if (initialTo) params.set('to', initialTo);
      if (segment) params.set('segment', segment);
      const data = await apiFetch<{ rows: MarkbookDrillRow[] }>(
        `/api/markbook/drill/${target}?${params.toString()}`,
        { signal }
      );
      return data.rows ?? [];
    },
    // NOTE: markbook is the ONE drill that uses initialData (skip the fetch)
    // rather than placeholderData. That's only valid because `seedRows` is
    // already narrowed to the exact (target, segment) via applyTargetFilterClient
    // above — i.e. seed === what the fetch would return (KD #82). The other
    // drills seed a BROAD/un-narrowed set, so they MUST use placeholderData and
    // let the server fetch narrow it. Do NOT copy this initialData skip to a
    // drill whose seed isn't client-narrowed — it would show the full unfiltered
    // set. initialDataUpdatedAt stamps the seed fresh so the redundant refetch is
    // skipped.
    initialData: seedRows.length > 0 ? seedRows : undefined,
    initialDataUpdatedAt: seedRows.length > 0 ? Date.now() : undefined,
  });

  const rows = drillQuery.data ?? EMPTY_ROWS;
  const [globalFilter, _setGlobalFilter] = React.useState('');
  void _setGlobalFilter;
  const [selectedStatuses, setSelectedStatuses] = React.useState<string[]>([]);
  const [selectedLevels, setSelectedLevels] = React.useState<string[]>([]);
  const [groupBy, setGroupBy] = React.useState<DrillDownGroupBy>('none');
  const [density, setDensity] = React.useState<DrillDownDensity>('comfortable');
  const [visibleColumnKeys, setVisibleColumnKeys] = React.useState<
    DrillColumnKey[]
  >(() => defaultColumnsForTarget(target));

  // Status + level options derived from the unfiltered rows.
  const statusOptions = React.useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      if (kind === 'entry')
        s.add((r as GradeEntryRow).isLocked ? 'Locked' : 'Open');
      else if (kind === 'sheet')
        s.add((r as SheetRow).isLocked ? 'Locked' : 'Open');
      else s.add((r as ChangeRequestRow).status);
    }
    return Array.from(s).sort();
  }, [rows, kind]);

  const levelOptions = React.useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      if (kind === 'entry') s.add((r as GradeEntryRow).level ?? 'Unknown');
      else if (kind === 'sheet') s.add((r as SheetRow).level ?? 'Unknown');
      // change-request rows have no level
    }
    const arr = Array.from(s);
    arr.sort(compareLevels);
    return arr;
  }, [rows, kind]);

  // Apply status + level filters before passing to DrillDownSheet.
  const preFiltered = React.useMemo(() => {
    if (selectedStatuses.length === 0 && selectedLevels.length === 0)
      return rows;
    const statusSet = new Set(selectedStatuses);
    const levelSet = new Set(selectedLevels);
    return rows.filter((r) => {
      if (selectedStatuses.length > 0) {
        let status: string;
        if (kind === 'entry')
          status = (r as GradeEntryRow).isLocked ? 'Locked' : 'Open';
        else if (kind === 'sheet')
          status = (r as SheetRow).isLocked ? 'Locked' : 'Open';
        else status = (r as ChangeRequestRow).status;
        if (!statusSet.has(status)) return false;
      }
      if (selectedLevels.length > 0 && kind !== 'change-request') {
        const lvl =
          (kind === 'entry'
            ? (r as GradeEntryRow).level
            : (r as SheetRow).level) ?? 'Unknown';
        if (!levelSet.has(lvl)) return false;
      }
      return true;
    });
  }, [rows, selectedStatuses, selectedLevels, kind]);

  // Build columns based on row kind.
  const columns = React.useMemo(() => {
    if (kind === 'entry')
      return buildEntryColumns(visibleColumnKeys) as ColumnDef<
        MarkbookDrillRow,
        unknown
      >[];
    if (kind === 'sheet')
      return buildSheetColumns(visibleColumnKeys) as ColumnDef<
        MarkbookDrillRow,
        unknown
      >[];
    return buildChangeRequestColumns(visibleColumnKeys) as ColumnDef<
      MarkbookDrillRow,
      unknown
    >[];
  }, [kind, visibleColumnKeys]);

  const columnOptions = React.useMemo(
    () =>
      allColumnsForKind(kind as MarkbookDrillRowKind).map((k) => ({
        key: k,
        label: DRILL_COLUMN_LABELS[k] ?? k,
      })),
    [kind]
  );

  const groupAccessor = React.useCallback(
    (row: MarkbookDrillRow): string | null => {
      if (groupBy === 'none') return null;
      if (kind === 'entry') {
        const r = row as GradeEntryRow;
        if (groupBy === 'level') return r.level ?? 'Unknown';
        if (groupBy === 'status') return r.isLocked ? 'Locked' : 'Open';
        if (groupBy === 'stage') return `T${r.termNumber}`;
      }
      if (kind === 'sheet') {
        const r = row as SheetRow;
        if (groupBy === 'level') return r.level ?? 'Unknown';
        if (groupBy === 'status') return r.isLocked ? 'Locked' : 'Open';
        if (groupBy === 'stage') return `T${r.termNumber}`;
      }
      const r = row as ChangeRequestRow;
      if (groupBy === 'status') return r.status;
      if (groupBy === 'stage') return `T${r.termNumber}`;
      return null;
    },
    [groupBy, kind]
  );

  const header = drillHeaderForTarget(target, segment ?? null);

  if (drillQuery.isLoading && rows.length === 0) {
    return <DrillSheetSkeleton title={header.title} />;
  }

  // Error state with a manual retry. Only shown when we have nothing to display;
  // if seed rows are present we keep showing them rather than blanking the sheet.
  if (drillQuery.isError && rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-b from-destructive/15 to-destructive/5 text-destructive ring-1 ring-inset ring-destructive/20">
          <AlertTriangle className="size-6" />
        </div>
        <div className="space-y-1">
          <p className="font-serif text-lg font-semibold text-foreground">
            Couldn’t load {header.title.toLowerCase()}
          </p>
          <p className="text-sm text-muted-foreground">
            {drillQuery.error instanceof Error
              ? drillQuery.error.message
              : 'Something went wrong while loading this list.'}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void drillQuery.refetch()}
          disabled={drillQuery.isFetching}
        >
          <RotateCcw
            className={cn('size-4', drillQuery.isFetching && 'animate-spin')}
          />
          Try again
        </Button>
      </div>
    );
  }

  const csvParams = new URLSearchParams({ ay: ayCode, format: 'csv' });
  if (initialFrom) csvParams.set('from', initialFrom);
  if (initialTo) csvParams.set('to', initialTo);
  if (segment) csvParams.set('segment', segment);
  if (visibleColumnKeys.length)
    csvParams.set('columns', visibleColumnKeys.join(','));
  const csvHref = `/api/markbook/drill/${target}?${csvParams.toString()}`;

  return (
    <DrillDownSheet<MarkbookDrillRow>
      title={header.title}
      eyebrow={header.eyebrow}
      count={preFiltered.length}
      csvHref={csvHref}
      columns={columns}
      rows={preFiltered}
      statusOptions={statusOptions}
      selectedStatuses={selectedStatuses}
      onStatusesChange={setSelectedStatuses}
      levelOptions={kind === 'change-request' ? undefined : levelOptions}
      selectedLevels={selectedLevels}
      onLevelsChange={setSelectedLevels}
      groupBy={groupBy}
      onGroupByChange={setGroupBy}
      groupAccessor={groupAccessor}
      density={density}
      onDensityChange={setDensity}
      columnOptions={columnOptions}
      visibleColumnKeys={visibleColumnKeys}
      onColumnsChange={(next) => setVisibleColumnKeys(next as DrillColumnKey[])}
    />
  );
}
