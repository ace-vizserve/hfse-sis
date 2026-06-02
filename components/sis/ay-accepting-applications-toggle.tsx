'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Switch } from '@/components/ui/switch';

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
  const [busy, setBusy] = useState(false);

  async function flip(next: boolean) {
    setBusy(true);
    try {
      const res = await fetch('/api/sis/ay-setup/accepting-applications', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ay_code: ayCode, accepting: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? 'Update failed');
      toast.success(
        next
          ? `${ayCode} is now accepting applications.`
          : `${ayCode} is no longer accepting applications.`
      );
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusy(false);
    }
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
