'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowUpRight,
  Loader2,
  Lock,
  LockOpen,
} from 'lucide-react';
import { toast } from 'sonner';

import { apiFetch, ApiError, jsonInit } from '@/lib/query/fetcher';

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
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Surfaced after the server returns 409 because pending CRs exist; the
  // dialog this state opens is the explicit break-glass override path.
  const [pendingBlock, setPendingBlock] = useState<{
    pendingCount: number;
  } | null>(null);
  const [deadlineBlock, setDeadlineBlock] = useState<{
    termLabel: string;
    lockDate: string;
  } | null>(null);

  const action: 'lock' | 'unlock' = isLocked ? 'unlock' : 'lock';

  // Tier-2 mutation. The two 409 break-glass codes are NOT errors to the user —
  // they open a confirm dialog instead of toasting. apiFetch throws ApiError on
  // a 409, so we intercept those codes in onError and open the matching dialog
  // (returning without a toast); any other failure keeps the original
  // `body.error ?? \`${action} failed\`` fallback message. The success toast still
  // branches on whether this was a force-unlock, so `force` rides along in the
  // mutation variables. router.refresh() stays on the success path (Model A).
  const toggleMutation = useMutation({
    mutationFn: (vars: { force: boolean }) => {
      const qs = vars.force ? '?force=true' : '';
      return apiFetch(
        `/api/grading-sheets/${sheetId}/${action}${qs}`,
        jsonInit('POST')
      );
    },
    onSuccess: (_body, vars) => {
      toast.success(
        action === 'lock'
          ? 'Sheet locked'
          : vars.force
            ? 'Sheet unlocked (pending requests bypassed)'
            : 'Sheet unlocked'
      );
      router.refresh();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) {
        const body = (e.body ?? {}) as {
          error?: string;
          termLabel?: string;
          lockDate?: string;
          pendingCount?: number;
        };
        if (body.error === 'grading_lock_date_passed') {
          setDeadlineBlock({
            termLabel: body.termLabel ?? 'this term',
            lockDate: body.lockDate ?? '',
          });
          return;
        }
        if (body.error === 'pending_change_requests') {
          setPendingBlock({ pendingCount: body.pendingCount ?? 0 });
          return;
        }
      }
      // ApiError.message already resolves to the body's `error` field; fall
      // back to the original generic message for non-JSON / unknown failures.
      toast.error(e instanceof Error ? e.message : `Failed to ${action} sheet`);
    },
  });

  const busy = toggleMutation.isPending;

  async function runToggle(opts: { force?: boolean } = {}) {
    await toggleMutation
      .mutateAsync({ force: opts.force ?? false })
      .catch(() => {
        // onError already surfaced the outcome (dialog or toast); swallow so the
        // dialog-close callers don't see an unhandled rejection.
      });
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
                isLocked
                  ? 'bg-destructive text-white hover:bg-destructive/90'
                  : undefined
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

      {/* Deadline break-glass — opens after server returns 409
          `grading_lock_date_passed`. Force-unlock is audit-logged as
          `sheet.unlock_force_deadline_passed`. */}
      <AlertDialog
        open={deadlineBlock != null}
        onOpenChange={(o) => !o && setDeadlineBlock(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-destructive to-rose-700 text-white shadow-brand-tile">
                <AlertTriangle className="size-4" />
              </div>
              <div className="space-y-2">
                <AlertDialogTitle>Grading deadline has passed</AlertDialogTitle>
                <AlertDialogDescription className="space-y-2">
                  <span className="block">
                    The grading deadline for{' '}
                    <span className="font-medium text-foreground">
                      {deadlineBlock?.termLabel}
                    </span>{' '}
                    was{' '}
                    <span className="font-medium text-foreground">
                      {deadlineBlock?.lockDate
                        ? new Date(deadlineBlock.lockDate).toLocaleDateString(
                            'en-SG',
                            {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            }
                          )
                        : '—'}
                    </span>
                    . Sheets are locked for report card publishing.
                  </span>
                  <span className="block">
                    Forcing an unlock will be recorded in the audit log. Only do
                    this if the registrar has explicitly approved a late
                    correction.
                  </span>
                </AlertDialogDescription>
              </div>
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async () => {
                setDeadlineBlock(null);
                await runToggle({ force: true });
              }}
            >
              Force unlock
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Break-glass override dialog — only opens after the server returns
          409 with `error=pending_change_requests`. Lists the count and the
          plain-English consequence; the Force-unlock action is audit-logged
          as `sheet.unlock_force_with_pending_crs`. */}
      <AlertDialog
        open={pendingBlock != null}
        onOpenChange={(o) => !o && setPendingBlock(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-amber to-amber-600 text-white shadow-brand-tile-amber">
                <AlertTriangle className="size-4" />
              </div>
              <div className="space-y-2">
                <AlertDialogTitle>
                  Pending change requests block this unlock
                </AlertDialogTitle>
                <AlertDialogDescription className="space-y-2">
                  <span className="block">
                    This sheet has{' '}
                    <span className="font-medium text-foreground">
                      {pendingBlock?.pendingCount ?? 0}{' '}
                      {pendingBlock?.pendingCount === 1
                        ? 'pending change request'
                        : 'pending change requests'}
                    </span>
                    . Resolve them first so teachers&apos; requests aren&apos;t
                    orphaned by the unlock.
                  </span>
                  <span className="block">
                    Approve / decline each one on the change requests queue, or
                    use the force option to unlock without resolving — the
                    override is recorded in the audit log.
                  </span>
                </AlertDialogDescription>
              </div>
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/markbook/change-requests?sheet_id=${sheetId}`}>
                Open change requests
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </Button>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async () => {
                setPendingBlock(null);
                await runToggle({ force: true });
              }}
            >
              Force unlock
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
