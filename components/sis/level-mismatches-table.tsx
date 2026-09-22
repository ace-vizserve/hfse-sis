'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Save } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';

import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { UnmatchedLevelLabel } from '@/lib/sis/level-review';

// Reconciliation queue for `/records/level-mismatches` (KD-#90-adjacent
// pattern: surface the gap, offer a one-click fix, badge decrements as the
// registrar clears rows). Each row is an observed admissions `levelApplied`
// string that doesn't canonicalize onto any known `public.levels` row; the
// registrar picks the level it should map to and the Task 2.4 route
// (`POST /api/sis/level-aliases`) persists the alias so it resolves
// automatically going forward.
//
// On the shared <DataTable> shell (data-table redesign roadmap step 5) —
// was a hand-rolled card list with zero search/sort/pagination.
//
// ⚠ THE LIST IS DEMAND-DRIVEN NOW. Every row used to look equally urgent, so
// mapping a name and watching nothing happen read as a broken save — which is
// exactly what it looked like on 2026-09-22, when six Youngstarters variants
// were mapped correctly and not one of the 23 children behind them moved,
// because all 23 were still `Submitted`. `blockedCount` says how many are
// genuinely stuck (enrolled, no class), the first tab holds only those, and
// the sidebar badge counts the same thing.

type LevelOption = { id: string; code: string; label: string };

function buildColumns(levels: LevelOption[]): ColumnDef<UnmatchedLevelLabel>[] {
  return [
    {
      id: 'rawLabel',
      accessorKey: 'rawLabel',
      header: ({ column }) => (
        <SortableHeader column={column}>Label</SortableHeader>
      ),
      meta: { label: 'Label' },
      cell: ({ row }) => (
        <div className="space-y-0.5">
          <div className="font-mono text-sm font-medium text-foreground">
            {row.original.rawLabel}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {row.original.ayCodes.join(', ')}
          </div>
        </div>
      ),
    },
    {
      id: 'waiting',
      accessorFn: (row) => row.blockedCount,
      header: ({ column }) => (
        <SortableHeader column={column}>Waiting</SortableHeader>
      ),
      meta: { label: 'Students waiting' },
      cell: ({ row }) => {
        const waiting = row.original.blockedCount;
        // ⚠ PIXEL-IDENTICAL TO `LevelsAwaitingSectionsCard`'s "N waiting"
        // badge, deliberately (design system §10.2 — the key and the thing it
        // documents share one source). Both halves of this page now say
        // "somebody is stuck behind this", and a registrar should not have to
        // learn that twice.
        if (waiting === 0) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        return (
          <Badge
            variant="outline"
            className="h-6 border-destructive/40 bg-destructive/10 text-destructive"
          >
            <span className="tabular-nums">{waiting}</span>
            waiting
          </Badge>
        );
      },
    },
    {
      id: 'totalRows',
      accessorFn: (row) => row.appsCount + row.statusCount,
      header: ({ column }) => (
        <SortableHeader column={column}>Rows</SortableHeader>
      ),
      meta: { label: 'Rows' },
      cell: ({ row }) => {
        const total = row.original.appsCount + row.original.statusCount;
        return (
          <Badge variant="outline">
            {total} row{total === 1 ? '' : 's'}
          </Badge>
        );
      },
    },
    {
      id: 'sampleEnrolees',
      accessorFn: (row) => row.sampleEnrolees.join(', '),
      header: 'Sample enrolees',
      cell: ({ row }) =>
        row.original.sampleEnrolees.length > 0 ? (
          <span className="text-xs text-muted-foreground">
            {row.original.sampleEnrolees.slice(0, 3).join(', ')}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      id: 'action',
      header: 'Maps to',
      cell: ({ row }) => (
        <LevelMismatchAction row={row.original} levels={levels} />
      ),
      enableSorting: false,
      enableHiding: false,
    },
  ];
}

export function LevelMismatchesTable({
  rows,
  levels,
}: {
  rows: UnmatchedLevelLabel[];
  levels: LevelOption[];
}) {
  const columns = buildColumns(levels);

  return (
    <DataTable<UnmatchedLevelLabel>
      data={rows}
      columns={columns}
      getRowId={(row) => row.rawLabel}
      searchKeys={[
        'rawLabel',
        (row) => row.ayCodes.join(' '),
        (row) => row.sampleEnrolees.join(' '),
      ]}
      searchPlaceholder="Search label or enrolee…"
      initialSort={[{ id: 'waiting', desc: true }]}
      // Two jobs wearing one coat until now. A name in front of an enrolled
      // child with no class is work; a name in front of an applicant who has
      // not enrolled is tidying, and clearing it moves nobody. The queue
      // opens on the first, so an empty first tab is a true "nothing to do"
      // — the same promise the "No class to put them in" card above already
      // makes.
      statusTabs={[
        {
          value: 'blocking',
          label: 'Blocking a student',
          isDefault: true,
          predicate: (row) => row.blockedCount > 0,
        },
        {
          value: 'waiting-on-enrolment',
          label: 'Nobody waiting',
          predicate: (row) => row.blockedCount === 0,
        },
        { value: 'all', label: 'All names', predicate: () => true },
      ]}
      url={{ enabled: true, namespace: 'mismatches' }}
      emptyState={{
        icon: CheckCircle2,
        title: 'No unresolved level names.',
        body: 'Every observed level name currently resolves to a known level.',
      }}
      emptyFilteredState={{
        title: 'No level names here.',
        body: 'Nothing matches this tab and search. Try All names, or clear the search.',
      }}
    />
  );
}

function LevelMismatchAction({
  row,
  levels,
}: {
  row: UnmatchedLevelLabel;
  levels: LevelOption[];
}) {
  const [selectedLevelId, setSelectedLevelId] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: true }>(
        '/api/sis/level-aliases',
        jsonInit('POST', {
          fromLabel: row.rawLabel,
          toLevelId: selectedLevelId,
        })
      ),
  });

  const run = useWriteAction();
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await run(() => saveMutation.mutateAsync(), {
      pending: `Mapping "${row.rawLabel}"…`,
      success: `Mapped "${row.rawLabel}" — this label now resolves automatically.`,
      error: (err) =>
        err instanceof Error ? err.message : 'Could not save mapping',
    });
    setSaving(false);
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Select
        value={selectedLevelId ?? undefined}
        onValueChange={setSelectedLevelId}
        disabled={saving}
      >
        <SelectTrigger className="h-9 w-48">
          <SelectValue placeholder="Maps to…" />
        </SelectTrigger>
        <SelectContent>
          {levels.map((l) => (
            <SelectItem key={l.id} value={l.id}>
              <span className="font-mono text-xs">{l.code}</span>
              <span className="ml-2 text-muted-foreground">{l.label}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        loading={saving}
        loadingText="Saving…"
        disabled={!selectedLevelId}
        onClick={() => void save()}
      >
        {!saving && <Save className="size-3.5" />}
        Save
      </Button>
    </div>
  );
}
