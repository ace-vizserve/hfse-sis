'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Save } from 'lucide-react';

import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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

type LevelOption = { id: string; code: string; label: string };

export function LevelMismatchesTable({
  rows,
  levels,
}: {
  rows: UnmatchedLevelLabel[];
  levels: LevelOption[];
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No unresolved level names right now.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <LevelMismatchRow key={row.rawLabel} row={row} levels={levels} />
      ))}
    </div>
  );
}

function LevelMismatchRow({
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

  const totalRows = row.appsCount + row.statusCount;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-hairline bg-card p-4 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="font-mono text-sm font-medium text-foreground">
          {row.rawLabel}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">
            {totalRows} row{totalRows === 1 ? '' : 's'}
          </Badge>
          <span>{row.ayCodes.join(', ')}</span>
          {row.sampleEnrolees.length > 0 && (
            <span>e.g. {row.sampleEnrolees.slice(0, 3).join(', ')}</span>
          )}
        </div>
      </div>
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
    </div>
  );
}
