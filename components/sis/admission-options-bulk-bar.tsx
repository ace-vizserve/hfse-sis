'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  STAFF_SCHEDULE_LABEL,
  bulkSessionMessage,
  planBulkSessionChange,
  sessionsAmong,
  type AdminOptionCombo,
  type AdmissionSchedule,
} from '@/lib/admissions/options';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// The bulk bar under the matrix on /sis/admin/admission-options: pick a
// session, open or close it for every ticked class at once.
//
// Only the sessions that exist AND differ are sent, so "Close Morning" over a
// mix of open, closed and Afternoon-only classes writes exactly the open
// Mornings. Closing is reversible (the switch or this bar turns it back on),
// so neither button is destructive (09a §9.2) — both are configuration.
export function AdmissionOptionsBulkBar({
  ayCode,
  combos,
  onDone,
}: {
  ayCode: string;
  /** The ticked, visible combinations. */
  combos: readonly AdminOptionCombo[];
  /** Clears the selection once the write has landed. */
  onDone: () => void;
}) {
  const available = sessionsAmong(combos);
  const [picked, setPicked] = useState<AdmissionSchedule | null>(null);
  const schedule: AdmissionSchedule | undefined =
    picked && available.includes(picked) ? picked : available[0];

  const mutation = useMutation({
    mutationFn: (vars: { optionIds: string[]; isOpen: boolean }) =>
      apiFetch<{ ok: true; changed: number }>(
        '/api/sis/admission-options/bulk',
        jsonInit('PATCH', { ayCode, ...vars })
      ),
  });

  const run = useWriteAction();
  const [busy, setBusy] = useState<'open' | 'close' | null>(null);

  async function apply(isOpen: boolean) {
    if (!schedule) return;
    const plan = planBulkSessionChange(combos, schedule, isOpen);
    if (plan.optionIds.length === 0) {
      toast.info(bulkSessionMessage(schedule, isOpen, 0));
      return;
    }
    const session = STAFF_SCHEDULE_LABEL[schedule];
    const n = plan.optionIds.length;
    setBusy(isOpen ? 'open' : 'close');
    const result = await run(
      () => mutation.mutateAsync({ optionIds: plan.optionIds, isOpen }),
      {
        pending: `${isOpen ? 'Reopening' : 'Closing'} ${session} for ${n} ${n === 1 ? 'class' : 'classes'}…`,
        success: (data) => bulkSessionMessage(schedule, isOpen, data.changed),
      }
    );
    setBusy(null);
    // Cleared only once the refresh has landed and the toast is out: clearing
    // earlier would unmount this bar mid-write and take its toast with it.
    if (result) onDone();
  }

  const count = combos.length;

  return (
    <div
      role="region"
      aria-label="Change the selected classes"
      className="sticky bottom-4 z-20 flex flex-col gap-3 rounded-xl border border-border bg-card p-3 shadow-md sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="px-1 text-sm text-foreground">
        <span className="font-semibold tabular-nums">{count}</span>{' '}
        {count === 1 ? 'class' : 'classes'} selected
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={schedule}
          onValueChange={(v) => setPicked(v as AdmissionSchedule)}
          disabled={busy !== null || available.length === 0}
        >
          <SelectTrigger className="h-9 w-[140px]" aria-label="Session">
            <SelectValue placeholder="Session" />
          </SelectTrigger>
          <SelectContent>
            {available.map((s) => (
              <SelectItem key={s} value={s}>
                {STAFF_SCHEDULE_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          onClick={() => void apply(true)}
          disabled={!schedule || busy !== null}
          loading={busy === 'open'}
          loadingText="Opening…"
        >
          Open
        </Button>
        <Button
          variant="outline"
          onClick={() => void apply(false)}
          disabled={!schedule || busy !== null}
          loading={busy === 'close'}
          loadingText="Closing…"
        >
          Close
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={busy !== null}>
          Clear
        </Button>
      </div>
    </div>
  );
}
