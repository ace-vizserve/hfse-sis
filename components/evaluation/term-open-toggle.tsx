'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Lock, LockOpen } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

// Open/close the Evaluation window for a given term. Surfaced in the
// Evaluation hub to registrar+; not shown to teachers (they're subject-
// to the gate, not the controller).
export function TermOpenToggle({
  termId,
  termLabel,
  isOpen,
  canToggle,
}: {
  termId: string;
  termLabel: string;
  isOpen: boolean;
  canToggle: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(isOpen);

  async function toggle() {
    const next = !open;
    setBusy(true);
    try {
      const res = await fetch(`/api/evaluation/terms/${termId}/config`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isOpen: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? 'toggle failed');
      setOpen(next);
      toast.success(next ? `${termLabel} evaluation opened` : `${termLabel} closed`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'toggle failed');
    } finally {
      setBusy(false);
    }
  }

  if (!canToggle) {
    return (
      <span
        className={`inline-flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] ${
          open ? 'text-primary' : 'text-muted-foreground'
        }`}
      >
        {open ? <LockOpen className="size-3" /> : <Lock className="size-3" />}
        {open ? 'Open' : 'Closed'}
      </span>
    );
  }

  return (
    <Button
      type="button"
      variant={open ? 'outline' : 'default'}
      size="sm"
      disabled={busy}
      onClick={toggle}
      className="gap-1.5"
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : open ? (
        <Lock className="size-3.5" />
      ) : (
        <LockOpen className="size-3.5" />
      )}
      {open ? 'Close window' : 'Open window'}
    </Button>
  );
}
