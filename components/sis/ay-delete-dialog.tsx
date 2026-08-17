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
  ayCode: string;
  /** Pre-computed blockers; empty array means the delete is allowed. */
  blockers: string[];
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function AyDeleteDialog({
  ayCode,
  blockers,
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

  const disabledByBlockers = blockers.length > 0;
  const canSubmit =
    !disabledByBlockers && confirm.trim().toUpperCase() === ayCode;

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch(
        '/api/sis/ay-setup',
        jsonInit('DELETE', { ay_code: ayCode, confirm_code: ayCode })
      ),
  });

  const run = useWriteAction();
  const [submitting, setSubmitting] = useState(false);

  async function remove() {
    setSubmitting(true);
    await run(() => deleteMutation.mutateAsync(), {
      pending: `Deleting ${ayCode}…`,
      success: `${ayCode} deleted`,
      error: (err) =>
        err instanceof Error ? err.message : 'Failed to delete AY',
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
    void remove();
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
          <AlertDialogTitle>Delete {ayCode}?</AlertDialogTitle>
          <AlertDialogDescription>
            {disabledByBlockers ? (
              <>
                This academic year has data and can&apos;t be deleted. Resolve
                the items below first.
              </>
            ) : (
              <>
                This will <strong>permanently delete</strong> {ayCode} and
                everything set up for it (terms, sections, subjects, admissions
                data). This cannot be undone.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {disabledByBlockers && (
          <div className="rounded-md border border-destructive/30 bg-gradient-to-b from-destructive/10 to-destructive/0 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-destructive">
              Reasons it can&apos;t be deleted ({blockers.length})
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-foreground">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        )}

        {!disabledByBlockers && (
          <div className="space-y-2">
            <Label htmlFor="confirm-delete" className="text-xs font-medium">
              Type{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
                {ayCode}
              </code>{' '}
              to confirm.
            </Label>
            <Input
              id="confirm-delete"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={ayCode}
              autoComplete="off"
            />
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={!canSubmit || submitting}
            className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive"
          >
            {submitting ? 'Deleting…' : 'Delete AY'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
