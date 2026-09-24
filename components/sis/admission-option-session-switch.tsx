'use client';

import { useMutation } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  STAFF_SCHEDULE_LABEL,
  optionDisplayName,
  type AdmissionSchedule,
} from '@/lib/admissions/options';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// One session (Morning / Afternoon / Whole day) of one enrolment-form option,
// switched open or closed on /sis/admin/admission-options. Writes on flip.
//
// Same shape as AyAcceptingApplicationsToggle: no local optimistic value. The
// switch shows the server's `isOpen` and only moves once the awaited refresh
// has re-read it, so the toast ("Morning closed for …") never claims a state
// the switch is not yet showing.
export function AdmissionOptionSessionSwitch({
  optionId,
  schedule,
  isOpen,
  levelLabel,
  classTypeLabel,
  hideLabel = false,
}: {
  optionId: string;
  schedule: AdmissionSchedule;
  isOpen: boolean;
  levelLabel: string;
  classTypeLabel: string;
  /** In the matrix the column header names the session; keep it for screen readers only. */
  hideLabel?: boolean;
}) {
  const id = useId();
  const session = STAFF_SCHEDULE_LABEL[schedule];
  const what = optionDisplayName(levelLabel, classTypeLabel);

  const mutation = useMutation({
    mutationFn: (next: boolean) =>
      apiFetch(
        `/api/sis/admission-options/${optionId}`,
        jsonInit('PATCH', { isOpen: next })
      ),
  });

  const run = useWriteAction();
  const [busy, setBusy] = useState(false);

  async function flip(next: boolean) {
    setBusy(true);
    await run(() => mutation.mutateAsync(next), {
      pending: next
        ? `Reopening ${session} for ${what}…`
        : `Closing ${session} for ${what}…`,
      success: next
        ? `${session} reopened for ${what}`
        : `${session} closed for ${what}`,
    });
    setBusy(false);
  }

  return (
    <div className="flex items-center gap-2">
      <Switch
        id={id}
        checked={isOpen}
        disabled={busy}
        onCheckedChange={(v) => void flip(Boolean(v))}
        aria-label={`${session} for ${what}`}
      />
      <Label
        htmlFor={id}
        className={
          hideLabel
            ? 'sr-only'
            : isOpen
              ? 'whitespace-nowrap text-[13px] font-medium text-foreground'
              : 'whitespace-nowrap text-[13px] font-medium text-muted-foreground'
        }
      >
        {session}
      </Label>
    </div>
  );
}
