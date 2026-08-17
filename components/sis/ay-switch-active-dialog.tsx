'use client';

import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';

import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
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
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function AySwitchActiveDialog({
  targetAyCode,
  currentAyCode,
  children,
  open: openProp,
  onOpenChange,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;
  const setOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const [confirm, setConfirm] = useState('');

  const canSubmit = confirm.trim().toUpperCase() === targetAyCode;

  const switchMutation = useMutation({
    mutationFn: () =>
      apiFetch(
        '/api/sis/ay-setup',
        jsonInit('PATCH', {
          target_ay_code: targetAyCode,
          confirm_code: targetAyCode,
        })
      ),
  });

  // Switching the active year re-renders essentially every surface in the app,
  // so this is one of the writes most worth holding the toast for.
  const run = useWriteAction();
  const [submitting, setSubmitting] = useState(false);

  async function switchAy() {
    setSubmitting(true);
    await run(() => switchMutation.mutateAsync(), {
      pending: `Switching to ${targetAyCode}…`,
      success: `Active AY is now ${targetAyCode}`,
      error: (err) =>
        err instanceof Error ? err.message : 'Failed to switch AY',
      onResolved: () => {
        setOpen(false);
        setConfirm('');
      },
    });
    setSubmitting(false);
  }

  function handleConfirm(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    void switchAy();
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirm('');
      }}
    >
      {children && <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Switch active AY to {targetAyCode}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {currentAyCode && currentAyCode !== targetAyCode ? (
              <>
                The current AY is <strong>{currentAyCode}</strong>. After this
                switch, every page in the SIS and the parent portal will show{' '}
                <strong>{targetAyCode}</strong>.
              </>
            ) : (
              <>
                After this switch, every page in the SIS and the parent portal
                will show <strong>{targetAyCode}</strong>.
              </>
            )}{' '}
            You can switch back later, but this changes the live AY everyone
            sees.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="confirm-switch" className="text-xs font-medium">
            Type{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
              {targetAyCode}
            </code>{' '}
            to confirm.
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
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={!canSubmit || submitting}
          >
            {submitting ? 'Switching…' : 'Switch active'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
