'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Lock, LockOpen } from 'lucide-react';
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
} from '@/components/ui/alert-dialog';
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
  const [confirmOpen, setConfirmOpen] = useState(false);

  const action: 'lock' | 'unlock' = isLocked ? 'unlock' : 'lock';

  async function runToggle() {
    setBusy(true);
    try {
      const res = await fetch(`/api/grading-sheets/${sheetId}/${action}`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `${action} failed`);
      toast.success(action === 'lock' ? 'Sheet locked' : 'Sheet unlocked');
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Failed to ${action} sheet`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        onClick={() => setConfirmOpen(true)}
        disabled={busy}
        size="sm"
        variant={isLocked ? 'default' : 'destructive'}
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

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isLocked ? 'Unlock this sheet?' : 'Lock this sheet?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isLocked
                ? 'Unlocking lets teachers edit scores again. Any changes made while unlocked are still audited.'
                : 'Locking prevents teachers from editing scores. Further changes will require an approval reference.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={
                isLocked ? 'bg-destructive text-white hover:bg-destructive/90' : undefined
              }
              onClick={async () => {
                setConfirmOpen(false);
                await runToggle();
              }}
            >
              {isLocked ? 'Unlock' : 'Lock'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
