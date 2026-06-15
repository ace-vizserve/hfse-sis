'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  STP_APPLICATION_STATUS_OPTIONS,
  type StpApplicationStatus,
} from '@/lib/sis/queries';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// Single-Select editor for the new stpApplicationStatus column. Mounts
// inside <StpApplicationCard>. Patches the column via /api/sis/students/
// [enroleeNumber]/stp-status?ay=… on change; toast.success / toast.error
// surface the outcome and router.refresh() so the card re-renders with
// the new value baked in by the server.

export function StpStatusEditor({
  ayCode,
  enroleeNumber,
  initialStatus,
}: {
  ayCode: string;
  enroleeNumber: string;
  initialStatus: StpApplicationStatus | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<StpApplicationStatus | null>(
    initialStatus
  );

  // Tier-1 optimistic: `status` is local display state. onMutate snapshots the
  // prior value (from the closure, not a setState updater) + sets the new value
  // immediately; onError restores it. The route's `body.error` is preserved via
  // ApiError.message (fallback 'save failed' unchanged).
  const statusMutation = useMutation({
    mutationFn: (next: StpApplicationStatus) =>
      apiFetch(
        `/api/sis/students/${enroleeNumber}/stp-status?ay=${ayCode}`,
        jsonInit('PATCH', { stpApplicationStatus: next })
      ),
    onMutate: (next) => {
      const prev = status;
      setStatus(next);
      return { prev };
    },
    onSuccess: (_data, next) => {
      toast.success(`STP status updated to ${next}`);
      router.refresh();
    },
    onError: (e, _next, ctx) => {
      // Roll back the optimistic update on failure.
      if (ctx) setStatus(ctx.prev);
      toast.error(e instanceof Error ? e.message : 'save failed');
    },
  });

  const saving = statusMutation.isPending;

  function handleChange(next: StpApplicationStatus) {
    if (next === status) return;
    statusMutation.mutate(next);
  }

  return (
    <div className="flex items-center gap-2">
      <Select
        value={status ?? undefined}
        onValueChange={(v) => void handleChange(v as StpApplicationStatus)}
        disabled={saving}
      >
        <SelectTrigger className="h-9 w-44">
          <SelectValue placeholder="Set status…" />
        </SelectTrigger>
        <SelectContent>
          {STP_APPLICATION_STATUS_OPTIONS.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {saving && (
        <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}
