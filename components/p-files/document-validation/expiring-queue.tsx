'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { ChevronRight, Loader2, Mail } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { apiFetch, ApiError, jsonInit } from '@/lib/query/fetcher';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import type {
  FacetConfig,
  StatusTabConfig,
} from '@/components/ui/data-table/types';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import type { PFileValidationRow } from '@/lib/p-files/document-validation';
import { cn } from '@/lib/utils';

type Props = {
  rows: PFileValidationRow[];
};

// Inline notify button for the expiring-queue row.
// Mirrors the useMutation in NotifyDialog: same route, same body shape, same
// error-handling (including the no_recipients kind check and 24h cooldown
// message surfaced verbatim from ApiError.message).
// Recipients are resolved server-side by the route — the row type doesn't
// carry email addresses, so we skip the pre-send recipient preview.
type NotifyResult = { sent: number; recipients: number };

function NotifyButton({
  enroleeNumber,
  slotKey,
  fullName,
}: {
  enroleeNumber: string;
  slotKey: string;
  fullName: string;
}) {
  const router = useRouter();

  const mutation = useMutation<NotifyResult, Error>({
    mutationFn: () =>
      apiFetch<NotifyResult>(
        `/api/p-files/${encodeURIComponent(enroleeNumber)}/notify`,
        jsonInit('POST', { slotKey, module: 'p-files' })
      ),
    onSuccess: (body) => {
      toast.success(
        `Reminder sent to ${body.sent} of ${body.recipients} recipient${body.recipients === 1 ? '' : 's'}`
      );
      router.refresh();
    },
    onError: (e) => {
      const kind =
        e instanceof ApiError &&
        e.body &&
        typeof e.body === 'object' &&
        (e.body as { kind?: string }).kind;
      if (kind === 'no_recipients') {
        toast.error(
          'No parent or guardian email on file — update the contact record in Admissions to send a reminder.',
          {
            action: {
              label: 'Open in Admissions',
              onClick: () =>
                window.open(
                  `/admissions/applications/${encodeURIComponent(enroleeNumber)}?tab=family`,
                  '_blank'
                ),
            },
          }
        );
        return;
      }
      toast.error(e instanceof Error ? e.message : 'Failed to send reminder');
    },
  });

  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-8 gap-1.5 text-xs"
      aria-label={`Notify parent for ${fullName}`}
      disabled={mutation.isPending}
      onClick={() => mutation.mutate()}
    >
      {mutation.isPending ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <Mail className="size-3" />
      )}
      Notify
    </Button>
  );
}

function ExpiringGroupHeader({
  rows,
  isExpanded,
  toggle,
}: {
  rows: PFileValidationRow[];
  isExpanded: boolean;
  toggle: () => void;
}) {
  const first = rows[0];
  return (
    // A <button> can't legally contain the <a> that IdentifierLink
    // renders (HTML forbids interactive content inside <button>) — use
    // a keyboard-accessible div instead (role="button" + tabIndex +
    // Enter/Space handling), same substitution React docs recommend
    // whenever a clickable container must wrap a link.
    <div
      role="button"
      tabIndex={0}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      }}
      aria-expanded={isExpanded}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronRight
        className={cn(
          'size-4 shrink-0 text-muted-foreground transition-transform',
          isExpanded && 'rotate-90'
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        {/* IdentifierLink doesn't accept onClick — wrap it so the link
            navigates without also toggling the group (the wrapping
            div's onClick would otherwise fire on every click inside). */}
        <span onClick={(e) => e.stopPropagation()}>
          <IdentifierLink
            href={`/p-files/${encodeURIComponent(first.enroleeNumber)}`}
          >
            {first.fullName}
          </IdentifierLink>
        </span>
        <span className="ml-2 font-mono text-[10px] text-muted-foreground">
          {first.enroleeNumber}
        </span>
      </div>
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {first.levelApplied ?? '—'}
      </span>
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {first.classSection ?? '—'}
      </span>
      <Badge variant="secondary" className="font-mono text-[10px] tabular-nums">
        {rows.length} document{rows.length === 1 ? '' : 's'}
      </Badge>
    </div>
  );
}

function expiryTone(days: number | null): string {
  if (days === null) return 'text-muted-foreground';
  if (days <= 0) return 'text-destructive font-medium';
  if (days <= 30) return 'text-destructive';
  if (days <= 60) return 'text-amber-600 dark:text-amber-400';
  return 'text-muted-foreground';
}

export function ExpiringQueue({ rows }: Props) {
  // Active window filter: ≤30 | ≤60 | ≤90
  const [window, setWindow] = React.useState<30 | 60 | 90>(90);

  const filtered = React.useMemo(
    () => rows.filter((r) => (r.daysUntilExpiry ?? 9999) <= window),
    [rows, window]
  );

  const rowKey = React.useCallback(
    (r: PFileValidationRow) => `${r.enroleeNumber}::${r.slotKey}`,
    []
  );

  const columns = React.useMemo<ColumnDef<PFileValidationRow>[]>(
    () => [
      {
        accessorKey: 'slotLabel',
        header: ({ column }) => (
          <SortableHeader column={column}>Document</SortableHeader>
        ),
        cell: ({ row }) => (
          <Badge variant="secondary">{row.original.slotLabel}</Badge>
        ),
      },
      {
        accessorKey: 'owner',
        header: 'Owner',
        cell: ({ row }) => (
          <Badge
            variant="outline"
            className="font-mono text-[10px] uppercase tracking-wider"
          >
            {row.original.owner}
          </Badge>
        ),
        filterFn: 'arrIncludesSome',
      },
      {
        accessorKey: 'levelApplied',
        header: ({ column }) => (
          <SortableHeader column={column}>Level</SortableHeader>
        ),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.levelApplied ?? '—'}
          </span>
        ),
        filterFn: 'arrIncludesSome',
      },
      {
        accessorKey: 'classSection',
        header: ({ column }) => (
          <SortableHeader column={column}>Section</SortableHeader>
        ),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.classSection ?? '—'}
          </span>
        ),
        filterFn: 'arrIncludesSome',
      },
      {
        accessorKey: 'daysUntilExpiry',
        header: ({ column }) => (
          <SortableHeader column={column}>Expires in</SortableHeader>
        ),
        cell: ({ row }) => {
          const days = row.original.daysUntilExpiry;
          const iso = row.original.expiryDateIso;
          const label = iso
            ? new Date(iso).toLocaleDateString('en-SG', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })
            : '—';
          return (
            <div className="space-y-0.5">
              <span
                className={cn(
                  'font-mono text-xs tabular-nums',
                  expiryTone(days)
                )}
              >
                {days !== null ? (days === 0 ? 'Today' : `${days}d`) : '—'}
              </span>
              <div className="font-mono text-[10px] text-muted-foreground">
                {label}
              </div>
            </div>
          );
        },
      },
      {
        id: 'preview',
        header: 'Preview',
        cell: ({ row }) => (
          <a
            href={row.original.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline"
          >
            Open file
          </a>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            <NotifyButton
              enroleeNumber={row.original.enroleeNumber}
              slotKey={row.original.slotKey}
              fullName={row.original.fullName}
            />
            <Button size="sm" variant="outline" asChild>
              <Link
                href={`/p-files/${encodeURIComponent(row.original.enroleeNumber)}`}
              >
                View profile
              </Link>
            </Button>
          </div>
        ),
      },
    ],
    []
  );

  const facets: FacetConfig[] = React.useMemo(
    // Owner is the status-tab dimension (below) — not duplicated as a facet.
    () => [
      { columnId: 'slotLabel', label: 'Document' },
      { columnId: 'levelApplied', label: 'Level' },
      { columnId: 'classSection', label: 'Section' },
    ],
    []
  );

  const statusTabs: StatusTabConfig<PFileValidationRow>[] = React.useMemo(
    () => [
      { value: 'all', label: 'All', predicate: () => true, isDefault: true },
      {
        value: 'student',
        label: 'Student',
        predicate: (r) => r.owner === 'Student',
      },
      {
        value: 'parent',
        label: 'Parent',
        predicate: (r) => r.owner === 'Mother' || r.owner === 'Father',
      },
      {
        value: 'guardian',
        label: 'Guardian',
        predicate: (r) => r.owner === 'Guardian',
      },
    ],
    []
  );

  const windowFilter = (
    <div className="flex items-center gap-1 rounded-lg border border-hairline p-0.5">
      {([30, 60, 90] as const).map((w) => (
        <button
          key={w}
          type="button"
          onClick={() => setWindow(w)}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium transition',
            window === w
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/60'
          )}
        >
          ≤{w}d
        </button>
      ))}
    </div>
  );

  return (
    <DataTable
      columns={columns}
      data={filtered}
      getRowId={rowKey}
      searchKeys={['fullName', 'enroleeNumber', 'slotLabel']}
      searchPlaceholder="Search student or document…"
      facets={facets}
      statusTabs={statusTabs}
      toolbarTrailing={windowFilter}
      // Distinct namespace from the sibling Awaiting queue on this same page so
      // the two tables' filters don't collide in the URL (KD #84).
      url={{ enabled: true, namespace: 'expiring' }}
      initialSort={[{ id: 'daysUntilExpiry', desc: false }]}
      pageSize={25}
      // Level + section render once in the group header (keyed by enroleeNumber); hide the redundant per-row
      // cells while keeping both columns filterable via their facets.
      initialColumnVisibility={{ levelApplied: false, classSection: false }}
      expandable={{
        enabled: true,
        groupBy: (row) => row.enroleeNumber,
        renderGroupHeader: ({ rows, isExpanded, toggle }) => (
          <ExpiringGroupHeader
            rows={rows}
            isExpanded={isExpanded}
            toggle={toggle}
          />
        ),
      }}
    />
  );
}
