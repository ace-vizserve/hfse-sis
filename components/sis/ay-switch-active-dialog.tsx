'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

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
  const router = useRouter();
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
    onSuccess: () => {
      toast.success(`Active AY is now ${targetAyCode}`);
      setOpen(false);
      setConfirm('');
      router.refresh();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to switch AY');
    },
  });
  const submitting = switchMutation.isPending;

  function handleConfirm(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    switchMutation.mutate();
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
            {submitting && <Loader2 className="mr-1 size-4 animate-spin" />}
            Switch active
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
