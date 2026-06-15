'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Switch } from '@/components/ui/switch';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// Per-row "Accepting applications" Switch on the SIS AY-setup table (KD #77).
// Current AY → its live application window; non-current AY → early-bird, which
// the PATCH route enforces as single-select (opening one closes any other open
// upcoming AY). Same endpoint either way; the server decides the semantics.
export function AyAcceptingApplicationsToggle({
  ayCode,
  current,
  isCurrentAy,
}: {
  ayCode: string;
  current: boolean;
  isCurrentAy: boolean;
}) {
  const router = useRouter();

  // Tier-2: no local optimistic value — the Switch reflects the server-provided
  // `current` prop, and a successful flip router.refresh()es to re-read it.
  // `isPending` drives the disable, the route's `body.error` is preserved via
  // ApiError.message (fallback 'Update failed' unchanged).
  const flipMutation = useMutation({
    mutationFn: (next: boolean) =>
      apiFetch(
        '/api/sis/ay-setup/accepting-applications',
        jsonInit('PATCH', { ay_code: ayCode, accepting: next })
      ),
    onSuccess: (_data, next) => {
      toast.success(
        next
          ? `${ayCode} is now accepting applications.`
          : `${ayCode} is no longer accepting applications.`
      );
      router.refresh();
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    },
  });

  const busy = flipMutation.isPending;

  function flip(next: boolean) {
    flipMutation.mutate(next);
  }

  const stateHint = current
    ? isCurrentAy
      ? 'Active year — parents can apply.'
      : 'Open for early-bird applications.'
    : 'Closed to new applications.';

  return (
    <div className="flex items-center gap-2" title={stateHint}>
      <Switch
        checked={current}
        disabled={busy}
        onCheckedChange={(v) => flip(Boolean(v))}
        aria-label={`Accepting applications for ${ayCode}`}
      />
      <span className="whitespace-nowrap text-[13px] font-medium text-foreground">
        Accepting applications
      </span>
    </div>
  );
}
