'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Lock, LockOpen } from 'lucide-react';

import { Button } from '@/components/ui/button';

export function LockToggle({
  sheetId,
  isLocked,
}: {
  sheetId: string;
  isLocked: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const action = isLocked ? 'unlock' : 'lock';
    if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} this sheet?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/grading-sheets/${sheetId}/${action}`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `${action} failed`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        onClick={toggle}
        disabled={busy}
        size="sm"
        variant={isLocked ? 'outline' : 'default'}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : isLocked ? (
          <LockOpen className="h-4 w-4" />
        ) : (
          <Lock className="h-4 w-4" />
        )}
        {isLocked ? 'Unlock sheet' : 'Lock sheet'}
      </Button>
      {error && <span className="font-mono text-[10px] text-destructive">{error}</span>}
    </div>
  );
}
