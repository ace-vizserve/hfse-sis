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
  ayCode: string;
  /** Pre-computed blockers; empty array means the delete is allowed. */
  blockers: string[];
  children: ReactNode;
};

export function AyDeleteDialog({ ayCode, blockers, children }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const disabledByBlockers = blockers.length > 0;
  const canSubmit = !disabledByBlockers && confirm.trim().toUpperCase() === ayCode;

  async function handleConfirm(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/sis/ay-setup', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ay_code: ayCode, confirm_code: ayCode }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed to delete AY');
      toast.success(`${ayCode} deleted`);
      setOpen(false);
      setConfirm('');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete AY');
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
          <AlertDialogTitle>Delete {ayCode}?</AlertDialogTitle>
          <AlertDialogDescription>
            {disabledByBlockers ? (
              <>This academic year has data and can&apos;t be deleted. Resolve the items below first.</>
            ) : (
              <>
                This will <strong>permanently delete</strong> {ayCode} and everything set up for it
                (terms, sections, subjects, admissions data). This cannot be undone.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {disabledByBlockers && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
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
              Type <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{ayCode}</code> to
              confirm.
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
            {submitting && <Loader2 className="mr-1 size-4 animate-spin" />}
            Delete AY
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
