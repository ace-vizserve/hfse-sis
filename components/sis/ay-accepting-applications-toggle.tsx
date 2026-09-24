'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { HoverHint } from '@/components/ui/hover-hint';
import { Switch } from '@/components/ui/switch';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// Per-row application Switches on the SIS AY-setup table (KD #77).
//
// "Accepting applications" is HFSE's window. Current AY → its live application
// window; non-current AY → early-bird, which the PATCH route enforces as
// single-select (opening one closes any other open upcoming AY).
//
// "VizSchool applications" is VizSchool's own window for the same year
// (migration 176) — a plain switch, no single-select. Same endpoint for both,
// told apart by `program`; the server decides the semantics.
export function AyAcceptingApplicationsToggle({
  ayCode,
  current,
  vizschoolCurrent,
  isCurrentAy,
  showCaption = false,
}: {
  ayCode: string;
  current: boolean;
  /** `vizschool_accepting_applications` on this AY. */
  vizschoolCurrent: boolean;
  isCurrentAy: boolean;
  /**
   * Renders a short visible caption explaining the single-select early-bird
   * behavior (KD #118) beneath the switch — opt-in so call sites that already
   * render their own longer caption nearby (the Year Setup checklist row)
   * don't end up with the explanation twice.
   */
  showCaption?: boolean;
}) {
  const hfseHint = current
    ? isCurrentAy
      ? 'Active year — parents can apply.'
      : 'Open for early-bird applications.'
    : 'Closed to new applications.';

  const caption = isCurrentAy
    ? 'Live window for the active year.'
    : 'Opening this closes any other open upcoming year.';

  return (
    <div className="flex flex-col gap-1">
      <ProgramSwitch
        ayCode={ayCode}
        program="hfse"
        current={current}
        label="Accepting applications"
        hint={hfseHint}
        messages={{
          opening: `Opening ${ayCode} for applications…`,
          closing: `Closing ${ayCode} to applications…`,
          opened: `${ayCode} is now accepting applications.`,
          closed: `${ayCode} is no longer accepting applications.`,
        }}
      />
      {showCaption && (
        <p className="max-w-[180px] text-[11px] leading-snug text-muted-foreground">
          {caption}
        </p>
      )}
      <ProgramSwitch
        ayCode={ayCode}
        program="vizschool"
        current={vizschoolCurrent}
        label="VizSchool applications"
        hint={
          vizschoolCurrent
            ? 'VizSchool parents can apply for this year.'
            : 'Closed to VizSchool applications.'
        }
        messages={{
          opening: `Opening ${ayCode} for VizSchool applications…`,
          closing: `Closing ${ayCode} to VizSchool applications…`,
          opened: `${ayCode} is now accepting VizSchool applications.`,
          closed: `${ayCode} is no longer accepting VizSchool applications.`,
        }}
      />
    </div>
  );
}

function ProgramSwitch({
  ayCode,
  program,
  current,
  label,
  hint,
  messages,
}: {
  ayCode: string;
  program: 'hfse' | 'vizschool';
  current: boolean;
  label: string;
  hint: string;
  messages: {
    opening: string;
    closing: string;
    opened: string;
    closed: string;
  };
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
        jsonInit('PATCH', { ay_code: ayCode, accepting: next, program })
      ),
  });

  const run = useWriteAction();
  const [busy, setBusy] = useState(false);

  async function flip(next: boolean) {
    setBusy(true);
    await run(() => flipMutation.mutateAsync(next), {
      pending: next ? messages.opening : messages.closing,
      success: next ? messages.opened : messages.closed,
      error: (e) => (e instanceof Error ? e.message : 'Update failed'),
    });
    setBusy(false);
  }

  return (
    <HoverHint hint={hint}>
      <div className="flex items-center gap-2">
        <Switch
          checked={current}
          disabled={busy}
          onCheckedChange={(v) => void flip(Boolean(v))}
          aria-label={`${label} for ${ayCode}`}
        />
        <span className="whitespace-nowrap text-[13px] font-medium text-foreground">
          {label}
        </span>
      </div>
    </HoverHint>
  );
}
