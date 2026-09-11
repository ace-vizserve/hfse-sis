'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
  Sparkles,
} from 'lucide-react';

import {
  DrillDownSheet,
  type DrillDownDensity,
} from '@/components/dashboard/drill-down-sheet';
import { DrillSheetSkeleton } from '@/components/dashboard/drill-sheet-skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  describeGradeChangeStepPeople,
  type AcademicYearDrillRow,
  type ActorActivityDrillRow,
  type AuditDrillRow,
  type GradeChangeStepDrillRow,
  type SisAdminDrillTarget,
} from '@/lib/sis/drill';
import { apiFetch } from '@/lib/query/fetcher';
import { queryKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils';

// Stable empty reference so `rows` keeps a steady identity while loading.
const EMPTY_ROWS: AnyRow[] = [];

type DrillResponse = {
  rows: AnyRow[];
  target: SisAdminDrillTarget;
  title: string;
  eyebrow: string;
};

// ─── Props ──────────────────────────────────────────────────────────────────

export type SisAdminDrillSheetProps = {
  target: SisAdminDrillTarget;
  segment?: string | null;
  rangeFrom?: string;
  rangeTo?: string;
};

const BADGE_BASE =
  'h-6 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]';

type AnyRow =
  | AuditDrillRow
  | GradeChangeStepDrillRow
  | AcademicYearDrillRow
  | ActorActivityDrillRow;

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

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const diffMs = Date.now() - d.getTime();
  const days = Math.floor(diffMs / 86_400_000);
  if (days < 0) return formatDate(iso);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return formatDate(iso);
}

// ─── Per-target column factories ────────────────────────────────────────────

function buildAuditColumns(): ColumnDef<AuditDrillRow, unknown>[] {
  return [
    {
      id: 'createdAt',
      accessorKey: 'createdAt',
      header: 'When',
      cell: ({ row }) => (
        <span className="text-sm tabular-nums text-muted-foreground">
          {formatRelative(row.original.createdAt)}
        </span>
      ),
    },
    {
      id: 'action',
      accessorKey: 'action',
      header: 'Action',
      cell: ({ row }) => (
        <Badge variant="muted" className={BADGE_BASE}>
          {row.original.action}
        </Badge>
      ),
    },
    {
      id: 'actorEmail',
      accessorKey: 'actorEmail',
      header: 'Actor',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.actorEmail ?? '—'}
        </span>
      ),
    },
    {
      id: 'entity',
      header: 'Entity',
      accessorFn: (r) => `${r.entityType}:${r.entityId}`,
      cell: ({ row }) => (
        <div className="space-y-0.5">
          <div className="font-mono text-xs">{row.original.entityType}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {row.original.entityId ?? '—'}
          </div>
        </div>
      ),
    },
  ];
}

/**
 * The grade-change approval steps, route by route.
 *
 * The step marker is the same numbered disc the teacher's filing form draws
 * (`ApprovalRoutePanel` in the grading sheet's Request edit dialog), so what
 * the superadmin checks here looks like what a teacher is shown before
 * sending. Numbered because the steps genuinely run in that order.
 *
 * Colour carries state only (09a §9): destructive where a teacher would be
 * refused — a route with no steps, a named step with nobody on it. The
 * half-of-the-school note is words in the mono metadata voice, not a colour,
 * matching the approvers screen's tag.
 */
function buildGradeChangeStepColumns(): ColumnDef<
  GradeChangeStepDrillRow,
  unknown
>[] {
  return [
    {
      id: 'routeLabel',
      accessorKey: 'routeLabel',
      header: 'Kind of change',
      cell: ({ row }) => (
        <span className="text-sm font-medium text-foreground">
          {row.original.routeLabel}
        </span>
      ),
    },
    {
      id: 'step',
      accessorFn: (r) => r.stepOrder ?? 0,
      header: 'Step',
      cell: ({ row }) => {
        const r = row.original;
        if (r.stepOrder == null) {
          return <span className="text-sm text-muted-foreground">—</span>;
        }
        return (
          <span className="inline-flex items-center gap-2 whitespace-nowrap">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-brand-indigo-soft bg-background font-mono text-[10px] font-semibold tabular-nums text-brand-indigo-deep">
              {r.stepOrder}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              of {r.stepCount}
            </span>
          </span>
        );
      },
    },
    {
      id: 'label',
      accessorFn: (r) => r.label ?? 'No steps set up yet',
      header: 'Step name',
      cell: ({ row }) =>
        row.original.label == null ? (
          <span className="text-sm font-medium text-destructive">
            No steps set up yet
          </span>
        ) : (
          <span className="text-sm text-foreground">{row.original.label}</span>
        ),
    },
    {
      id: 'people',
      accessorFn: (r) => describeGradeChangeStepPeople(r),
      header: 'Who approves',
      cell: ({ row }) => {
        const r = row.original;
        if (r.kind === 'not_set_up') {
          return (
            <span className="text-xs leading-relaxed text-muted-foreground">
              Teachers can’t send this kind of change until its steps are set up
              in SIS Admin → Approvers.
            </span>
          );
        }
        if (r.kind === 'form_adviser') {
          return (
            <div className="space-y-0.5">
              <div className="text-sm text-foreground">Form class adviser</div>
              <div className="text-xs text-muted-foreground">
                Whoever advises the child’s class at the time
              </div>
            </div>
          );
        }
        if (r.people.length === 0) {
          return (
            <span className="text-sm font-medium text-destructive">
              Nobody set up yet
            </span>
          );
        }
        // ⚠ ONE WORD CARRIES THE SETTING. "Mr Gary or Ms Nina" — either of
        // them approves; "Mr Gary and Ms Nina" — both must. Read as a sentence
        // so the word sits where the eye already is.
        if (!r.people.some((p) => p.scope)) {
          const word = r.approvalRule === 'all' ? 'and' : 'or';
          return (
            <p className="text-sm leading-relaxed">
              {r.people.map((p, i) => (
                <React.Fragment key={`${p.name}-${i}`}>
                  {i > 0 && (
                    <span className="text-muted-foreground">
                      {i === r.people.length - 1 ? ` ${word} ` : ', '}
                    </span>
                  )}
                  <span
                    className={
                      p.disabled ? 'text-muted-foreground' : 'text-foreground'
                    }
                  >
                    {p.name}
                  </span>
                  {p.disabled && (
                    <span className="text-xs text-muted-foreground">
                      {' '}
                      (account turned off)
                    </span>
                  )}
                </React.Fragment>
              ))}
            </p>
          );
        }
        // Split by half of the school: a child gets ONE of these people, so no
        // joining word fits. On a step that needs everyone, a line says what
        // that means for a half.
        return (
          <div className="space-y-1">
            <ul className="space-y-1">
              {r.people.map((p, i) => (
                <li
                  key={`${p.name}-${p.scope ?? 'all'}-${i}`}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
                >
                  <span
                    className={cn(
                      'text-sm',
                      p.disabled ? 'text-muted-foreground' : 'text-foreground'
                    )}
                  >
                    {p.name}
                  </span>
                  {p.scope && (
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-indigo-deep">
                      {p.scope.replace(' only', '')}
                    </span>
                  )}
                  {p.disabled && (
                    <span className="text-xs text-muted-foreground">
                      Account turned off
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {r.approvalRule === 'all' && r.people.length > 1 && (
              <p className="text-xs text-muted-foreground">
                Everyone covering the child’s half must approve
              </p>
            )}
          </div>
        );
      },
    },
  ];
}

function buildAYColumns(): ColumnDef<AcademicYearDrillRow, unknown>[] {
  return [
    {
      id: 'ayCode',
      accessorKey: 'ayCode',
      header: 'AY',
      cell: ({ row }) => (
        <div className="space-y-0.5">
          <div className="font-medium text-foreground">
            {row.original.ayCode}
          </div>
          {row.original.label && (
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {row.original.label}
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'isCurrent',
      accessorKey: 'isCurrent',
      header: 'Status',
      cell: ({ row }) =>
        row.original.isCurrent ? (
          <Badge variant="success" className={BADGE_BASE}>
            <Sparkles className="h-3 w-3" /> Current
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className={`${BADGE_BASE} border-hairline bg-gradient-to-b from-muted to-muted/60 text-ink-3`}
          >
            Historical
          </Badge>
        ),
    },
    {
      id: 'termsCount',
      accessorKey: 'termsCount',
      header: 'Terms',
      cell: ({ row }) => (
        <span className="font-mono tabular-nums">
          {row.original.termsCount}
        </span>
      ),
    },
    {
      id: 'studentsCount',
      accessorKey: 'studentsCount',
      header: 'Students',
      cell: ({ row }) => (
        <span className="font-mono tabular-nums">
          {row.original.studentsCount}
        </span>
      ),
    },
  ];
}

function buildActorColumns(): ColumnDef<ActorActivityDrillRow, unknown>[] {
  return [
    {
      id: 'email',
      accessorKey: 'email',
      header: 'Actor',
      cell: ({ row }) => (
        <div className="space-y-0.5">
          <div className="font-medium text-foreground">
            {row.original.email ?? '—'}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {row.original.userId.slice(0, 8)}
          </div>
        </div>
      ),
    },
    {
      id: 'count',
      accessorKey: 'count',
      header: 'Events',
      cell: ({ row }) => (
        <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
          {row.original.count}
        </span>
      ),
    },
    {
      id: 'lastEventAt',
      accessorKey: 'lastEventAt',
      header: 'Last event',
      cell: ({ row }) => (
        <span className="text-sm tabular-nums text-muted-foreground">
          {formatRelative(row.original.lastEventAt)}
        </span>
      ),
    },
  ];
}

// ─── Main component ─────────────────────────────────────────────────────────

export function SisAdminDrillSheet({
  target,
  segment,
  rangeFrom,
  rangeTo,
}: SisAdminDrillSheetProps) {
  const [density, setDensity] = React.useState<DrillDownDensity>('comfortable');

  // Read via TanStack Query. No seed — this drill always fetches on open
  // (the original had no initialRows prop and always ran the effect). The
  // response carries the resolved target/title/eyebrow, which we read off the
  // query data rather than mirroring into local state. The queryFn forwards
  // the abort signal so a fast close/reopen aborts the stale request.
  const drillQuery = useQuery({
    queryKey: queryKeys.sisAdminDrill(target, {
      ay: '',
      from: rangeFrom ?? null,
      to: rangeTo ?? null,
      segment: segment ?? null,
    }),
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      if (segment) params.set('segment', segment);
      if (rangeFrom) params.set('from', rangeFrom);
      if (rangeTo) params.set('to', rangeTo);
      return apiFetch<DrillResponse>(
        `/api/sis-admin/drill/${target}?${params.toString()}`,
        { signal }
      );
    },
  });

  const rows = drillQuery.data?.rows ?? EMPTY_ROWS;
  // Resolve target/title/eyebrow from the response; fall back to the prop
  // target + the original placeholder copy while loading.
  const effectiveTarget = drillQuery.data?.target ?? target;
  const title = drillQuery.data?.title ?? 'Loading…';
  const eyebrow = drillQuery.data?.eyebrow ?? 'Drill';

  const columns = React.useMemo<ColumnDef<AnyRow, unknown>[]>(() => {
    switch (effectiveTarget) {
      case 'audit-events':
        return buildAuditColumns() as ColumnDef<AnyRow, unknown>[];
      case 'approver-coverage':
        return buildGradeChangeStepColumns() as ColumnDef<AnyRow, unknown>[];
      case 'academic-years':
        return buildAYColumns() as ColumnDef<AnyRow, unknown>[];
      case 'activity-by-actor':
        return buildActorColumns() as ColumnDef<AnyRow, unknown>[];
    }
  }, [effectiveTarget]);

  if (drillQuery.isLoading && rows.length === 0) {
    return <DrillSheetSkeleton title={title} />;
  }

  if (drillQuery.isError && rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-b from-destructive/15 to-destructive/5 text-destructive ring-1 ring-inset ring-destructive/20">
          <AlertTriangle className="size-6" />
        </div>
        <div className="space-y-1">
          <p className="font-serif text-lg font-semibold text-foreground">
            Couldn’t load this list
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

  const csvParams = new URLSearchParams({ format: 'csv' });
  if (segment) csvParams.set('segment', segment);
  if (rangeFrom) csvParams.set('from', rangeFrom);
  if (rangeTo) csvParams.set('to', rangeTo);
  const csvHref = `/api/sis-admin/drill/${target}?${csvParams.toString()}`;

  return (
    <DrillDownSheet<AnyRow>
      title={title}
      eyebrow={eyebrow}
      count={rows.length}
      csvHref={csvHref}
      columns={columns}
      rows={rows}
      density={density}
      onDensityChange={setDensity}
      {...(effectiveTarget === 'approver-coverage'
        ? {
            description:
              'Who approves each kind of grade change, in the order the steps run. Change them in SIS Admin → Approvers.',
            // Grouping by level, status or stage means nothing for a list of
            // steps, so the tabs are not offered.
            showGroupBy: false,
          }
        : {})}
    />
  );
}

// Suppress unused-import warning during refactor
void Activity;
void CheckCircle2;
