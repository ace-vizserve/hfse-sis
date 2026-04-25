'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Activity, CheckCircle2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import {
  DrillDownSheet,
  type DrillDownDensity,
} from '@/components/dashboard/drill-down-sheet';
import { DrillSheetSkeleton } from '@/components/dashboard/drill-sheet-skeleton';
import { Badge } from '@/components/ui/badge';
import type {
  AcademicYearDrillRow,
  ActorActivityDrillRow,
  ApproverAssignmentDrillRow,
  AuditDrillRow,
  SisAdminDrillTarget,
} from '@/lib/sis/drill';

// ─── Props ──────────────────────────────────────────────────────────────────

export type SisAdminDrillSheetProps = {
  target: SisAdminDrillTarget;
  segment?: string | null;
  rangeFrom?: string;
  rangeTo?: string;
};

const BADGE_BASE = 'h-6 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]';

type AnyRow =
  | AuditDrillRow
  | ApproverAssignmentDrillRow
  | AcademicYearDrillRow
  | ActorActivityDrillRow;

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-SG', { year: 'numeric', month: 'short', day: 'numeric' });
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
        <span className="text-xs text-muted-foreground">{row.original.actorEmail ?? '—'}</span>
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

function buildApproverColumns(): ColumnDef<ApproverAssignmentDrillRow, unknown>[] {
  return [
    {
      id: 'flow',
      accessorKey: 'flow',
      header: 'Flow',
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.flow}</span>
      ),
    },
    {
      id: 'email',
      accessorKey: 'email',
      header: 'Approver',
      cell: ({ row }) => (
        <div className="space-y-0.5">
          <div className="font-medium text-foreground">{row.original.email ?? row.original.userId}</div>
          {row.original.email && (
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {row.original.userId.slice(0, 8)}
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'role',
      accessorKey: 'role',
      header: 'Role',
      cell: ({ row }) => (
        <Badge variant="muted" className={BADGE_BASE}>
          {row.original.role}
        </Badge>
      ),
    },
    {
      id: 'assignedAt',
      accessorKey: 'assignedAt',
      header: 'Assigned',
      cell: ({ row }) => (
        <span className="text-sm tabular-nums text-muted-foreground">
          {formatDate(row.original.assignedAt)}
        </span>
      ),
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
          <div className="font-medium text-foreground">{row.original.ayCode}</div>
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
          <Badge variant="outline" className={`${BADGE_BASE} border-hairline bg-muted text-ink-3`}>
            Historical
          </Badge>
        ),
    },
    {
      id: 'termsCount',
      accessorKey: 'termsCount',
      header: 'Terms',
      cell: ({ row }) => (
        <span className="font-mono tabular-nums">{row.original.termsCount}</span>
      ),
    },
    {
      id: 'studentsCount',
      accessorKey: 'studentsCount',
      header: 'Students',
      cell: ({ row }) => (
        <span className="font-mono tabular-nums">{row.original.studentsCount}</span>
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
          <div className="font-medium text-foreground">{row.original.email ?? '—'}</div>
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
  const [rows, setRows] = React.useState<AnyRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [effectiveTarget, setEffectiveTarget] = React.useState<SisAdminDrillTarget>(target);
  const [title, setTitle] = React.useState('Loading…');
  const [eyebrow, setEyebrow] = React.useState('Drill');
  const [density, setDensity] = React.useState<DrillDownDensity>('comfortable');

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    if (segment) params.set('segment', segment);
    if (rangeFrom) params.set('from', rangeFrom);
    if (rangeTo) params.set('to', rangeTo);
    fetch(`/api/sis-admin/drill/${target}?${params.toString()}`)
      .then((r) => {
        if (!r.ok) throw new Error('drill_fetch_failed');
        return r.json();
      })
      .then((data: { rows: AnyRow[]; target: SisAdminDrillTarget; title: string; eyebrow: string }) => {
        if (cancelled) return;
        setRows(data.rows ?? []);
        setEffectiveTarget(data.target);
        setTitle(data.title);
        setEyebrow(data.eyebrow);
      })
      .catch(() => {
        if (!cancelled) toast.error('Failed to load drill data');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [target, segment, rangeFrom, rangeTo]);

  const columns = React.useMemo<ColumnDef<AnyRow, unknown>[]>(() => {
    switch (effectiveTarget) {
      case 'audit-events':
        return buildAuditColumns() as ColumnDef<AnyRow, unknown>[];
      case 'approver-coverage':
        return buildApproverColumns() as ColumnDef<AnyRow, unknown>[];
      case 'academic-years':
        return buildAYColumns() as ColumnDef<AnyRow, unknown>[];
      case 'activity-by-actor':
        return buildActorColumns() as ColumnDef<AnyRow, unknown>[];
    }
  }, [effectiveTarget]);

  if (loading && rows.length === 0) {
    return <DrillSheetSkeleton title={title} />;
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
    />
  );
}

// Suppress unused-import warning during refactor
void Activity;
void CheckCircle2;
