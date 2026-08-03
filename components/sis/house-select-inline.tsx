'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { houseSwatchClass, type HouseRow } from '@/lib/sis/houses';
import { cn } from '@/lib/utils';

const NONE = '__none__';

// Sets which house a student belongs to (migration 110).
//
// Saves on selection rather than behind a Save button — it is a single choice
// from four, and the allowance editors next to it need a button only because
// they take free numeric input that can be mid-typing. There is nothing to
// "finish" here.
//
// "Not assigned" is offered as a real option, not just an empty state: a house
// can be set by mistake and must be removable.
export function HouseSelectInline({
  enroleeNumber,
  houses,
  initialHouseId,
  disabled,
  disabledReason,
}: {
  enroleeNumber: string;
  houses: HouseRow[];
  initialHouseId: string | null;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();

  const saveMutation = useMutation({
    mutationFn: (houseId: string | null) =>
      apiFetch(
        `/api/sis/students/${encodeURIComponent(enroleeNumber)}/house`,
        jsonInit('PATCH', { houseId })
      ),
    onSuccess: (_data, houseId) => {
      const name = houses.find((h) => h.id === houseId)?.name;
      toast.success(name ? `Moved to ${name}` : 'House cleared');
      router.refresh();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'save failed');
    },
  });

  const saving = saveMutation.isPending;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background p-4">
      <div className="min-w-[220px] flex-1">
        <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          House
        </div>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          Stays with the student for their whole time at the school — it is not
          reset when the year rolls over.
          {disabled && disabledReason && (
            <span className="ml-1 text-destructive">· {disabledReason}</span>
          )}
        </p>
      </div>
      <Select
        value={initialHouseId ?? NONE}
        disabled={disabled || saving || houses.length === 0}
        onValueChange={(v) => saveMutation.mutate(v === NONE ? null : v)}
      >
        <SelectTrigger className="h-9 w-48" aria-label="House">
          <SelectValue placeholder="Not assigned" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Not assigned</SelectItem>
          {houses.map((h) => (
            <SelectItem key={h.id} value={h.id}>
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    houseSwatchClass(h.colourToken)
                  )}
                  aria-hidden
                />
                {h.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
