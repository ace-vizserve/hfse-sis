'use client';

import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  AlertCircle,
  AlertTriangle,
  Asterisk,
  CheckCircle2,
  ClipboardList,
  Cog,
  FileText,
  GraduationCap,
  HelpCircle,
  RotateCcw,
  UserMinus,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import {
  DrillDownSheet,
  type DrillDownDensity,
  type DrillDownGroupBy,
} from '@/components/dashboard/drill-down-sheet';
import { DrillSheetSkeleton } from '@/components/dashboard/drill-sheet-skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ALL_DRILL_COLUMNS,
  DRILL_COLUMN_LABELS,
  defaultColumnsForTarget,
  drillHeaderForTarget,
  type DrillColumnKey,
  type DrillRow,
  type DrillTarget,
} from '@/lib/admissions/drill';
import { apiFetch } from '@/lib/query/fetcher';
import { queryKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils';

// Stable empty reference so `rows` keeps a steady identity while loading.
const EMPTY_ROWS: DrillRow[] = [];

// ─────────────────────────────────────────────────────────────────────────────
// Props

export type AdmissionsDrillSheetProps = {
  target: DrillTarget;
  segment?: string | null;
  ayCode: string;
  /** When set, these clamp the dataset to the page-level date range. */
  initialFrom?: string;
  initialTo?: string;
  /** Pre-fetched rows — when provided, the drill renders immediately without
   *  a network call. Used by the page (Server Component) to avoid loading
   *  spinners on first open. Subsequent scope changes still hit the API. */
  initialRows?: DrillRow[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Cell badges — visual patterns lifted from outdated-applications-table.tsx so
// every drill table reads as one visual family. When we eventually dedupe these
// into a shared module, both files import from the same place.

const BADGE_BASE =
  'h-6 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]';

type StaleTier = 'unknown' | 'green' | 'amber' | 'red';

function tierFor(days: number | null): StaleTier {
  if (days === null) return 'unknown';
  if (days >= 14) return 'red';
  if (days >= 7) return 'amber';
  return 'green';
}

function StalenessBadge({ days }: { days: number | null }) {
  const tier = tierFor(days);
  if (tier === 'unknown') {
    return (
      <Badge
        variant="outline"
        className={`${BADGE_BASE} border-hairline bg-gradient-to-b from-muted to-muted/60 text-ink-3`}
      >
        <HelpCircle className="h-3 w-3" aria-hidden />
        Never updated
      </Badge>
    );
  }
  if (tier === 'red') {
    return (
      <Badge
        variant="outline"
        className={`${BADGE_BASE} border-destructive/40 bg-gradient-to-b from-destructive/15 to-destructive/5 text-destructive`}
      >
        <AlertTriangle className="h-3 w-3" aria-hidden />
        {days}d stale
      </Badge>
    );
  }
  if (tier === 'amber') {
    return (
      <Badge
        variant="outline"
        className={`${BADGE_BASE} border-chart-4/50 bg-chart-4/15 text-ink`}
      >
        <AlertCircle className="h-3 w-3" aria-hidden />
        {days}d stale
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className={`${BADGE_BASE} border-brand-mint bg-gradient-to-b from-brand-mint/35 to-brand-mint/15 text-ink`}
    >
      <CheckCircle2 className="h-3 w-3" aria-hidden />
      Fresh · {days}d
    </Badge>
  );
}

const ENROLL_TIERS = [
  {
    label: 'Fast',
    maxDays: 7,
    className:
      'border-brand-mint bg-gradient-to-b from-brand-mint/35 to-brand-mint/15 text-ink',
  },
  {
    label: 'Typical',
    maxDays: 30,
    className:
      'border-hairline bg-gradient-to-b from-muted to-muted/60 text-ink-3',
  },
  {
    label: 'Slow',
    maxDays: 60,
    className: 'border-chart-4/50 bg-chart-4/15 text-ink',
  },
  {
    label: 'Very slow',
    maxDays: Infinity,
    className:
      'border-destructive/40 bg-gradient-to-b from-destructive/15 to-destructive/5 text-destructive',
  },
] as const;

function EnrollTimeTierBadge({ days }: { days: number }) {
  const tier =
    ENROLL_TIERS.find((t) => days <= t.maxDays) ??
    ENROLL_TIERS[ENROLL_TIERS.length - 1];
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm tabular-nums text-foreground">{days}d</span>
      <Badge variant="outline" className={`${BADGE_BASE} ${tier.className}`}>
        {tier.label}
      </Badge>
    </div>
  );
}

type StatusStyle = {
  icon: LucideIcon;
  label: string;
  className: string;
};

const STATUS_STYLES: Record<string, StatusStyle> = {
  Submitted: {
    icon: FileText,
    label: 'Submitted',
    className:
      'border-brand-indigo/40 bg-gradient-to-b from-brand-indigo/15 to-brand-indigo/5 text-brand-indigo',
  },
  'Ongoing Verification': {
    icon: ClipboardList,
    label: 'Verification',
    className: 'border-chart-4/50 bg-chart-4/15 text-ink',
  },
  Processing: {
    icon: Cog,
    label: 'Processing',
    className:
      'border-brand-indigo-soft/60 bg-gradient-to-b from-brand-indigo-soft/20 to-brand-indigo-soft/5 text-ink',
  },
  Enrolled: {
    icon: GraduationCap,
    label: 'Enrolled',
    className:
      'border-brand-mint bg-gradient-to-b from-brand-mint/35 to-brand-mint/15 text-ink',
  },
  'Enrolled (Conditional)': {
    icon: Asterisk,
    label: 'Conditional',
    className:
      'border-brand-mint/60 bg-gradient-to-b from-brand-mint/20 to-brand-mint/5 text-ink',
  },
  Withdrawn: {
    icon: UserMinus,
    label: 'Withdrawn',
    className:
      'border-destructive/30 bg-gradient-to-b from-destructive/10 to-destructive/0 text-ink-4',
  },
  Cancelled: {
    icon: XCircle,
    label: 'Cancelled',
    className:
      'border-destructive/30 bg-gradient-to-b from-destructive/10 to-destructive/0 text-ink-4',
  },
};

const UNKNOWN_STATUS: StatusStyle = {
  icon: HelpCircle,
  label: 'No status',
  className:
    'border-hairline bg-gradient-to-b from-muted to-muted/60 text-ink-3',
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? UNKNOWN_STATUS;
  const Icon = style.icon;
  return (
    <Badge variant="outline" className={`${BADGE_BASE} ${style.className}`}>
      <Icon className="h-3 w-3" aria-hidden />
      {style.label}
    </Badge>
  );
}

function AssessmentBadge({ outcome }: { outcome: string }) {
  const normalized = outcome.toLowerCase();
  if (normalized === 'pass') return <Badge variant="success">Pass</Badge>;
  if (normalized === 'fail') return <Badge variant="blocked">Fail</Badge>;
  return <Badge variant="muted">Unknown</Badge>;
}

function DocsCell({ complete, total }: { complete: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((complete / total) * 100);
  let badge: React.ReactNode;
  if (total > 0 && complete === total) {
    badge = (
      <Badge variant="success">
        {complete}/{total}
      </Badge>
    );
  } else if (complete === 0) {
    badge = <Badge variant="blocked">0/{total}</Badge>;
  } else {
    badge = (
      <Badge variant="muted">
        {complete}/{total}
      </Badge>
    );
  }
  // Inline meter under the badge — semantic tokens only, no hardcoded color.
  const fillClass =
    complete === total && total > 0
      ? 'bg-brand-mint'
      : complete === 0
        ? 'bg-destructive/60'
        : 'bg-chart-4';
  return (
    <div className="flex flex-col gap-1">
      {badge}
      <div className="h-px w-16 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full ${fillClass}`}
          style={{ width: `${pct}%` }}
          aria-hidden
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers

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

const CANONICAL_LEVELS = [
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
] as const;
const CANONICAL_LEVEL_INDEX: Record<string, number> = CANONICAL_LEVELS.reduce(
  (acc, lvl, i) => {
    acc[lvl] = i;
    return acc;
  },
  {} as Record<string, number>
);

function compareLevels(a: string, b: string): number {
  const aIsUnknown = a === 'Unknown';
  const bIsUnknown = b === 'Unknown';
  if (aIsUnknown && bIsUnknown) return 0;
  if (aIsUnknown) return 1;
  if (bIsUnknown) return -1;
  const aIdx = CANONICAL_LEVEL_INDEX[a];
  const bIdx = CANONICAL_LEVEL_INDEX[b];
  const aIsCanon = aIdx !== undefined;
  const bIsCanon = bIdx !== undefined;
  if (aIsCanon && bIsCanon) return aIdx - bIdx;
  if (aIsCanon) return -1;
  if (bIsCanon) return 1;
  return a.localeCompare(b);
}

function buildDrillUrl(
  target: DrillTarget,
  ayCode: string,
  from: string | undefined,
  to: string | undefined,
  segment: string | null | undefined,
  format: 'json' | 'csv',
  visibleColumnKeys?: string[]
): string {
  const params = new URLSearchParams();
  params.set('ay', ayCode);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (segment) params.set('segment', segment);
  if (format === 'csv') {
    params.set('format', 'csv');
    if (visibleColumnKeys && visibleColumnKeys.length > 0) {
      params.set('columns', visibleColumnKeys.join(','));
    }
  }
  return `/api/admissions/drill/${target}?${params.toString()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Column factory

function buildColumnDef(
  key: DrillColumnKey,
  opts?: { showDaysTier?: boolean }
): ColumnDef<DrillRow, unknown> {
  const header = DRILL_COLUMN_LABELS[key];
  switch (key) {
    case 'fullName':
      return {
        id: 'fullName',
        accessorKey: 'fullName',
        header,
        cell: ({ row }) => {
          const { enroleeNumber, studentNumber, status } = row.original;
          // KD #81: Enrolled rows route to Records; pre-Enrolled stay on Admissions.
          const isEnrolled =
            status === 'Enrolled' || status === 'Enrolled (Conditional)';
          const href = isEnrolled
            ? studentNumber
              ? `/records/students/${encodeURIComponent(studentNumber)}`
              : `/records/students/by-enrolee/${encodeURIComponent(enroleeNumber)}`
            : `/admissions/applications/${encodeURIComponent(enroleeNumber)}`;
          return (
            <div className="space-y-0.5">
              <Link
                href={href}
                className="font-medium text-foreground transition-colors hover:text-primary hover:underline underline-offset-4"
              >
                {row.original.fullName}
              </Link>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {enroleeNumber}
              </div>
            </div>
          );
        },
        enableSorting: true,
      };
    case 'enroleeNumber':
      return {
        id: 'enroleeNumber',
        accessorKey: 'enroleeNumber',
        header,
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.enroleeNumber}
          </span>
        ),
        enableSorting: true,
      };
    case 'studentNumber':
      return {
        id: 'studentNumber',
        accessorKey: 'studentNumber',
        header,
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.studentNumber ?? '—'}
          </span>
        ),
        enableSorting: true,
      };
    case 'status':
      return {
        id: 'status',
        accessorKey: 'status',
        header,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
        enableSorting: true,
      };
    case 'level':
      return {
        id: 'level',
        accessorKey: 'level',
        header,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.level ?? '—'}
          </span>
        ),
        enableSorting: true,
        sortingFn: (a, b) => {
          const av = a.original.level ?? 'Unknown';
          const bv = b.original.level ?? 'Unknown';
          return compareLevels(av, bv);
        },
      };
    case 'stage':
      return {
        id: 'stage',
        accessorKey: 'stage',
        header,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.stage ?? '—'}
          </span>
        ),
        enableSorting: true,
      };
    case 'referralSource':
      return {
        id: 'referralSource',
        accessorKey: 'referralSource',
        header,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.referralSource ?? '—'}
          </span>
        ),
        enableSorting: true,
      };
    case 'assessmentOutcome':
      return {
        id: 'assessmentOutcome',
        accessorKey: 'assessmentOutcome',
        header,
        cell: ({ row }) => (
          <AssessmentBadge
            outcome={row.original.assessmentOutcome ?? 'unknown'}
          />
        ),
        enableSorting: true,
      };
    case 'assessmentMath':
      return {
        id: 'assessmentMath',
        accessorKey: 'assessmentMath',
        header,
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            <span className="text-sm tabular-nums text-foreground">
              {row.original.assessmentMath ?? '—'}
            </span>
            {row.original.assessmentMath != null && (
              <AssessmentBadge outcome={row.original.assessmentMathOutcome} />
            )}
          </div>
        ),
        enableSorting: true,
      };
    case 'assessmentEnglish':
      return {
        id: 'assessmentEnglish',
        accessorKey: 'assessmentEnglish',
        header,
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            <span className="text-sm tabular-nums text-foreground">
              {row.original.assessmentEnglish ?? '—'}
            </span>
            {row.original.assessmentEnglish != null && (
              <AssessmentBadge
                outcome={row.original.assessmentEnglishOutcome}
              />
            )}
          </div>
        ),
        enableSorting: true,
      };
    case 'applicationDate':
      return {
        id: 'applicationDate',
        accessorKey: 'applicationDate',
        header,
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-muted-foreground">
            {formatDate(row.original.applicationDate)}
          </span>
        ),
        enableSorting: true,
      };
    case 'enrollmentDate':
      return {
        id: 'enrollmentDate',
        accessorKey: 'enrollmentDate',
        header,
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-muted-foreground">
            {formatDate(row.original.enrollmentDate)}
          </span>
        ),
        enableSorting: true,
      };
    case 'daysToEnroll':
      return {
        id: 'daysToEnroll',
        accessorKey: 'daysToEnroll',
        header,
        cell: ({ row }) => {
          const days = row.original.daysToEnroll;
          if (days === null)
            return <span className="text-sm text-muted-foreground">—</span>;
          if (opts?.showDaysTier) return <EnrollTimeTierBadge days={days} />;
          return (
            <span className="text-sm tabular-nums text-foreground">
              {days}d
            </span>
          );
        },
        enableSorting: true,
        sortingFn: (a, b) => {
          const av = a.original.daysToEnroll;
          const bv = b.original.daysToEnroll;
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          return av - bv;
        },
      };
    case 'daysSinceUpdate':
      return {
        id: 'daysSinceUpdate',
        accessorKey: 'daysSinceUpdate',
        header,
        cell: ({ row }) => (
          <StalenessBadge days={row.original.daysSinceUpdate} />
        ),
        enableSorting: true,
        sortingFn: (a, b) => {
          const av = a.original.daysSinceUpdate;
          const bv = b.original.daysSinceUpdate;
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          return av - bv;
        },
      };
    case 'daysInPipeline':
      return {
        id: 'daysInPipeline',
        accessorKey: 'daysInPipeline',
        header,
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-foreground">
            {row.original.daysInPipeline}d
          </span>
        ),
        enableSorting: true,
      };
    case 'documentsComplete':
      return {
        id: 'documentsComplete',
        accessorKey: 'documentsComplete',
        header,
        cell: ({ row }) => (
          <DocsCell
            complete={row.original.documentsComplete}
            total={row.original.documentsTotal}
          />
        ),
        enableSorting: true,
      };
    default: {
      // Exhaustiveness guard.
      const _exhaustive: never = key;
      throw new Error(`unreachable column key: ${String(_exhaustive)}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The wrapper

export function AdmissionsDrillSheet({
  target,
  segment,
  ayCode,
  initialFrom,
  initialTo,
  initialRows,
}: AdmissionsDrillSheetProps) {
  // ── State ────────────────────────────────────────────────────────────────
  const [selectedStatuses, setSelectedStatuses] = React.useState<string[]>([]);
  const [selectedLevels, setSelectedLevels] = React.useState<string[]>([]);
  const [groupBy, setGroupBy] = React.useState<DrillDownGroupBy>(() =>
    target === 'conversion' ? 'status' : 'none'
  );
  const [density, setDensity] = React.useState<DrillDownDensity>('comfortable');
  const [visibleColumnKeys, setVisibleColumnKeys] = React.useState<
    DrillColumnKey[]
  >(() => defaultColumnsForTarget(target));

  // ── Fetch on range change ────────────────────────────────────────────────
  // Read via TanStack Query. initialRows (when the parent hydrated us) are the
  // initialData, so the drill renders instantly and skips the round-trip within
  // staleTime; otherwise it fetches on open and shows the skeleton. The queryFn
  // forwards the abort signal so a fast close/reopen aborts the stale request.
  const drillQuery = useQuery({
    queryKey: queryKeys.admissionsDrill(target, {
      ay: ayCode,
      from: initialFrom ?? null,
      to: initialTo ?? null,
      segment: segment ?? null,
    }),
    queryFn: async ({ signal }) => {
      const url = buildDrillUrl(
        target,
        ayCode,
        initialFrom,
        initialTo,
        segment,
        'json'
      );
      const json = await apiFetch<{ rows?: DrillRow[] }>(url, {
        credentials: 'include',
        signal,
      });
      return Array.isArray(json.rows) ? json.rows : [];
    },
    // The seed (buildDrillRows) is the broad, un-narrowed row set — the
    // per-(target,segment) narrowing happens server-side in the drill route
    // (KD #82). So it's a placeholder for instant paint, NOT authoritative:
    // placeholderData paints it immediately while the query STILL fetches the
    // narrowed rows and replaces it. (initialData + a fresh timestamp marked the
    // broad seed fresh and skipped the fetch → every drill showed the same
    // unfiltered set.)
    placeholderData: initialRows,
  });

  const rows = drillQuery.data ?? EMPTY_ROWS;

  // ── Pre-filter rows by status + level ───────────────────────────────────
  // Search (`globalFilter`) is owned by react-table inside DrillDownSheet;
  // we apply the slower client filters here so they reduce the dataset
  // *before* the table builds its row model.
  const preFiltered = React.useMemo<DrillRow[]>(() => {
    if (selectedStatuses.length === 0 && selectedLevels.length === 0)
      return rows;
    const statusSet = new Set(selectedStatuses);
    const levelSet = new Set(selectedLevels);
    return rows.filter((r) => {
      if (selectedStatuses.length > 0 && !statusSet.has(r.status)) return false;
      if (selectedLevels.length > 0 && !levelSet.has(r.level ?? 'Unknown'))
        return false;
      return true;
    });
  }, [rows, selectedStatuses, selectedLevels]);

  // ── Conversion group labels (computed from preFiltered so they update with filters) ─
  const conversionGroupLabels = React.useMemo(() => {
    if (target !== 'conversion') return null;
    const total = preFiltered.length;
    const convertedCount = preFiltered.filter(
      (r) => r.status === 'Enrolled' || r.status === 'Enrolled (Conditional)'
    ).length;
    const notConvertedCount = total - convertedCount;
    const pct = total > 0 ? Math.round((convertedCount / total) * 100) : 0;
    return {
      converted: `Converted — ${convertedCount} (${pct}%)`,
      notConverted: `Did not convert — ${notConvertedCount} (${100 - pct}%)`,
    };
  }, [target, preFiltered]);

  // ── Filter options derived from the *fetched* row set ────────────────────
  // (Not the pre-filtered set — otherwise selecting a status would empty
  //  the level dropdown for the unselected statuses.)
  const statusOptions = React.useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.status) set.add(r.status);
    return Array.from(set).sort();
  }, [rows]);

  const levelOptions = React.useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.level ?? 'Unknown');
    return Array.from(set).sort(compareLevels);
  }, [rows]);

  // ── Columns ──────────────────────────────────────────────────────────────
  // Build full column set in canonical order; DrillDownSheet handles
  // visibility filtering via `visibleColumnKeys`.
  const columns = React.useMemo<ColumnDef<DrillRow, unknown>[]>(
    () =>
      ALL_DRILL_COLUMNS.map((k) =>
        buildColumnDef(k, { showDaysTier: target === 'avg-time' })
      ),
    [target]
  );

  const columnOptions = React.useMemo(
    () =>
      ALL_DRILL_COLUMNS.map((k) => ({
        key: k,
        label: DRILL_COLUMN_LABELS[k],
      })),
    []
  );

  // ── Group accessor ───────────────────────────────────────────────────────
  const groupAccessor = React.useCallback(
    (row: DrillRow): string | null => {
      if (target === 'conversion' && conversionGroupLabels) {
        const isConverted =
          row.status === 'Enrolled' || row.status === 'Enrolled (Conditional)';
        return isConverted
          ? conversionGroupLabels.converted
          : conversionGroupLabels.notConverted;
      }
      switch (groupBy) {
        case 'level':
          return row.level ?? 'Unknown';
        case 'status':
          return row.status;
        case 'stage':
          return row.stage ?? null;
        default:
          return null;
      }
    },
    [groupBy, target, conversionGroupLabels]
  );

  // ── Display rows — pre-sorted by actionability signal per target ─────────
  const displayRows = React.useMemo<DrillRow[]>(() => {
    if (target === 'avg-time') {
      return [...preFiltered].sort(
        (a, b) => (b.daysToEnroll ?? -1) - (a.daysToEnroll ?? -1)
      );
    }
    if (target === 'applications' || target === 'outdated') {
      return [...preFiltered].sort(
        (a, b) => (b.daysSinceUpdate ?? -1) - (a.daysSinceUpdate ?? -1)
      );
    }
    return preFiltered;
  }, [target, preFiltered]);

  // ── Header + CSV ────────────────────────────────────────────────────────
  const heading = drillHeaderForTarget(target, segment ?? null);

  // KD #82: each target anchors on a specific date column. Surface this so
  // the user understands why the date range picker affects some drills
  // differently from others.
  const dateAnchorLabel =
    target === 'enrolled' || target === 'avg-time'
      ? 'Anchored on enrollment date'
      : target === 'time-to-enroll-bucket'
        ? 'AY-wide · date range ignored'
        : 'Anchored on application date';

  const csvHref = buildDrillUrl(
    target,
    ayCode,
    initialFrom,
    initialTo,
    segment,
    'csv',
    visibleColumnKeys
  );

  // ── Per-target tweaks ────────────────────────────────────────────────────
  // For target-rows where every status is "Enrolled" / "Enrolled (Conditional)",
  // grouping by stage is meaningless. We still surface the control — the user
  // can flip back to None — but we let the option set degenerate naturally.
  // For 'conversion' the two-group layout is the feature; hide the control.
  const enrolledOnly =
    target === 'avg-time' ||
    target === 'time-to-enroll-bucket' ||
    target === 'enrolled';
  const showGroupBy =
    target !== 'conversion' && (!enrolledOnly || groupBy !== 'none');

  if (drillQuery.isLoading && rows.length === 0) {
    return <DrillSheetSkeleton title={heading.title} />;
  }

  if (
    drillQuery.isError &&
    (rows.length === 0 || drillQuery.isPlaceholderData)
  ) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-b from-destructive/15 to-destructive/5 text-destructive ring-1 ring-inset ring-destructive/20">
          <AlertTriangle className="size-6" />
        </div>
        <div className="space-y-1">
          <p className="font-serif text-lg font-semibold text-foreground">
            Couldn’t load {heading.title.toLowerCase()}
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

  return (
    <DrillDownSheet<DrillRow>
      title={heading.title}
      eyebrow={heading.eyebrow}
      description={dateAnchorLabel}
      count={preFiltered.length}
      csvHref={csvHref}
      columns={columns}
      rows={displayRows}
      // Toolkit
      statusOptions={statusOptions}
      selectedStatuses={selectedStatuses}
      onStatusesChange={setSelectedStatuses}
      levelOptions={levelOptions}
      selectedLevels={selectedLevels}
      onLevelsChange={setSelectedLevels}
      groupBy={groupBy}
      onGroupByChange={setGroupBy}
      showGroupBy={showGroupBy}
      groupAccessor={groupAccessor}
      density={density}
      onDensityChange={setDensity}
      columnOptions={columnOptions}
      visibleColumnKeys={visibleColumnKeys}
      onColumnsChange={(next) => setVisibleColumnKeys(next as DrillColumnKey[])}
    />
  );
}
