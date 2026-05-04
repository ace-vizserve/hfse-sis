'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Props = {
  targetAyCode: string;
  currentAyCode: string | null;
  children: ReactNode;
};

export function AySwitchActiveDialog({ targetAyCode, currentAyCode, children }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = confirm.trim().toUpperCase() === targetAyCode;

  async function handleConfirm(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/sis/ay-setup', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target_ay_code: targetAyCode, confirm_code: targetAyCode }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed to switch AY');
      toast.success(`Active AY is now ${targetAyCode}`);
      setOpen(false);
      setConfirm('');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to switch AY');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirm('');
      }}
    >
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Switch active AY to {targetAyCode}?</AlertDialogTitle>
          <AlertDialogDescription>
            {currentAyCode && currentAyCode !== targetAyCode ? (
              <>
                The current AY is <strong>{currentAyCode}</strong>. After this switch, every page in
                the SIS and the parent portal will show <strong>{targetAyCode}</strong>.
              </>
            ) : (
              <>
                After this switch, every page in the SIS and the parent portal will show{' '}
                <strong>{targetAyCode}</strong>.
              </>
            )}{' '}
            You can switch back later, but this changes the live AY everyone sees.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="confirm-switch" className="text-xs font-medium">
            Type <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{targetAyCode}</code> to
            confirm.
          </Label>
          <Input
            id="confirm-switch"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={targetAyCode}
            autoComplete="off"
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={!canSubmit || submitting}>
            {submitting && <Loader2 className="mr-1 size-4 animate-spin" />}
            Switch active
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
