'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, Save } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';

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

type LevelOption = { id: string; code: string; label: string };

function buildColumns(levels: LevelOption[]): ColumnDef<UnmatchedLevelLabel>[] {
  return [
    {
      id: 'rawLabel',
      accessorKey: 'rawLabel',
      header: ({ column }) => (
        <SortableHeader column={column}>Label</SortableHeader>
      ),
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
      id: 'totalRows',
      accessorFn: (row) => row.appsCount + row.statusCount,
      header: ({ column }) => (
        <SortableHeader column={column}>Rows</SortableHeader>
      ),
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
      initialSort={[{ id: 'rawLabel', desc: false }]}
      url={{ enabled: true, namespace: 'mismatches' }}
      emptyState={{
        icon: CheckCircle2,
        title: 'No unresolved level names.',
        body: 'Every observed level name currently resolves to a known level.',
      }}
      emptyFilteredState={{
        title: 'No level names match the current search.',
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
  const router = useRouter();
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
    onSuccess: () => {
      toast.success(
        `Mapped "${row.rawLabel}" — this label now resolves automatically.`
      );
      router.refresh();
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : 'Could not save mapping'
      );
    },
  });
  const saving = saveMutation.isPending;

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
        disabled={!selectedLevelId || saving}
        onClick={() => saveMutation.mutate()}
      >
        {saving ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Save className="size-3.5" />
        )}
        Save
      </Button>
    </div>
  );
}
