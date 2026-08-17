'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { Switch } from '@/components/ui/switch';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// Per-row "Accepting applications" Switch on the SIS AY-setup table (KD #77).
// Current AY → its live application window; non-current AY → early-bird, which
// the PATCH route enforces as single-select (opening one closes any other open
// upcoming AY). Same endpoint either way; the server decides the semantics.
export function AyAcceptingApplicationsToggle({
  ayCode,
  current,
  isCurrentAy,
  showCaption = false,
}: {
  ayCode: string;
  current: boolean;
  isCurrentAy: boolean;
  /**
   * Renders a short visible caption explaining the single-select early-bird
   * behavior (KD #118) beneath the switch — opt-in so call sites that already
   * render their own longer caption nearby (the Year Setup checklist row)
   * don't end up with the explanation twice.
   */
  showCaption?: boolean;
}) {
  // No local optimistic value — the Switch reflects the server-provided
  // `current` prop, so it only moves once the awaited refresh has re-read it.
  // That is exactly why the toast has to wait too: claiming the year is open
  // while the switch is still showing "closed" is the mismatch this fixes.
  // The route's `body.error` is preserved via ApiError.message (fallback
  // 'Update failed' unchanged).
  const flipMutation = useMutation({
    mutationFn: (next: boolean) =>
      apiFetch(
        '/api/sis/ay-setup/accepting-applications',
        jsonInit('PATCH', { ay_code: ayCode, accepting: next })
      ),
  });

  const run = useWriteAction();
  const [busy, setBusy] = useState(false);

  async function flip(next: boolean) {
    setBusy(true);
    await run(() => flipMutation.mutateAsync(next), {
      pending: next
        ? `Opening ${ayCode} for applications…`
        : `Closing ${ayCode} to applications…`,
      success: next
        ? `${ayCode} is now accepting applications.`
        : `${ayCode} is no longer accepting applications.`,
      error: (e) => (e instanceof Error ? e.message : 'Update failed'),
    });
    setBusy(false);
  }

  const stateHint = current
    ? isCurrentAy
      ? 'Active year — parents can apply.'
      : 'Open for early-bird applications.'
    : 'Closed to new applications.';

  const caption = isCurrentAy
    ? 'Live window for the active year.'
    : 'Opening this closes any other open upcoming year.';

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2" title={stateHint}>
        <Switch
          checked={current}
          disabled={busy}
          onCheckedChange={(v) => void flip(Boolean(v))}
          aria-label={`Accepting applications for ${ayCode}`}
        />
        <span className="whitespace-nowrap text-[13px] font-medium text-foreground">
          Accepting applications
        </span>
      </div>
      {showCaption && (
        <p className="max-w-[180px] text-[11px] leading-snug text-muted-foreground">
          {caption}
        </p>
      )}
    </div>
  );
}
