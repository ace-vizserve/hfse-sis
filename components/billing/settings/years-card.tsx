'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';

import {
  ChangePreviewDialog,
  type PreviewResult,
} from '@/components/billing/settings/change-preview-dialog';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { DatePicker } from '@/components/ui/date-picker';
import { FieldError } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { overlapMessage } from '@/lib/billing/classify';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

type Range = { ayCode: string; startsOn: string; endsOn: string };

// The invoice-date range of each school year: an invoice dated inside it fills
// that year's tile. Outside every range it shows on the customer page only.
export function YearsCard({
  ayCodes,
  ranges,
}: {
  ayCodes: string[];
  ranges: Range[];
}) {
  const run = useWriteAction();
  const [rows, setRows] = React.useState<
    Record<string, { startsOn: string; endsOn: string }>
  >(() =>
    Object.fromEntries(
      ayCodes.map((ay) => {
        const r = ranges.find((x) => x.ayCode === ay);
        return [ay, { startsOn: r?.startsOn ?? '', endsOn: r?.endsOn ?? '' }];
      })
    )
  );
  const [preview, setPreview] = React.useState<PreviewResult | null>(null);
  const filled = Object.entries(rows)
    .filter(([, r]) => r.startsOn && r.endsOn)
    .map(([ayCode, r]) => ({ ayCode, ...r }));
  const half = Object.entries(rows).find(
    ([, r]) => !!r.startsOn !== !!r.endsOn
  )?.[0];
  const problem = half
    ? `${half} needs both dates, or neither.`
    : overlapMessage(filled);
  const ask = useMutation({
    mutationFn: () =>
      apiFetch<PreviewResult>(
        '/api/billing/settings/preview',
        jsonInit('POST', { ranges: filled })
      ),
  });
  const save = useMutation({
    mutationFn: () =>
      apiFetch<{ studentsAffected: number; tilesSkipped?: string }>(
        '/api/billing/settings/years',
        jsonInit('PUT', { ranges: filled })
      ),
  });
  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Tiles
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight">
          School years
        </CardTitle>
        <CardAction>
          <Button
            variant="default"
            disabled={!!problem}
            loading={ask.isPending || save.isPending}
            loadingText={save.isPending ? 'Saving…' : 'Checking…'}
            onClick={() =>
              run(() => ask.mutateAsync(), {
                pending: 'Checking what would change…',
                refresh: false,
                success: (p) => (setPreview(p), null),
              })
            }
          >
            Save years
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          An invoice dated inside a year&rsquo;s range fills that year&rsquo;s
          Registration or Fees stage. Outside every range it fills no stage, and
          still shows on the customer page.
        </p>
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,1fr)] gap-3 border-b border-border bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground">
            <span>Year</span>
            <span>From</span>
            <span>To</span>
          </div>
          {ayCodes.map((ay) => (
            <div
              key={ay}
              className="grid grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
            >
              <p className="font-mono text-[12px] font-semibold text-foreground">
                {ay}
              </p>
              <div className="min-w-0">
                <Label htmlFor={`${ay}-from`} className="sr-only">
                  {ay} from
                </Label>
                <DatePicker
                  id={`${ay}-from`}
                  value={rows[ay].startsOn}
                  onChange={(v) =>
                    setRows((s) => ({ ...s, [ay]: { ...s[ay], startsOn: v } }))
                  }
                  placeholder="Not set"
                />
              </div>
              <div className="min-w-0">
                <Label htmlFor={`${ay}-to`} className="sr-only">
                  {ay} to
                </Label>
                <DatePicker
                  id={`${ay}-to`}
                  value={rows[ay].endsOn}
                  onChange={(v) =>
                    setRows((s) => ({ ...s, [ay]: { ...s[ay], endsOn: v } }))
                  }
                  placeholder="Not set"
                />
              </div>
            </div>
          ))}
        </div>
        {problem && <FieldError>{problem}</FieldError>}
      </CardContent>
      <ChangePreviewDialog
        preview={preview}
        onCancel={() => setPreview(null)}
        onConfirm={() => {
          setPreview(null);
          void run(() => save.mutateAsync(), {
            pending: 'Saving and re-checking every invoice…',
            success: (d) =>
              d.tilesSkipped
                ? `Saved. ${d.tilesSkipped}`
                : `Saved · ${d.studentsAffected} students re-checked`,
          });
        }}
      />
    </Card>
  );
}
