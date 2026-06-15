'use client';

import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { Loader2, PackagePlus } from 'lucide-react';
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
import { Button } from '@/components/ui/button';

// "Create all sheets for [AY]" — calls the bulk-create RPC for every
// (section × subject × term) missing in this AY. Idempotent: existing sheets
// are untouched. Safe to click after mid-year section additions.
export function BulkCreateSheetsButton({
  ayId,
  ayCode,
}: {
  ayId: string;
  ayCode: string;
}) {
  const router = useRouter();

  // Tier-2 mutation (Model A): the bulk-create POST runs through useMutation.
  // The success body carries `inserted` + `reason` (it's a 200 with a result
  // shape, not an error), so the reason/inserted branching stays in onSuccess;
  // the 'bulk create failed' fallback is preserved in onError (ApiError.message
  // already resolves to body.error). router.refresh() fires on success as before.
  const bulkCreate = useMutation({
    mutationFn: () =>
      apiFetch<{ inserted?: number; reason?: string }>(
        '/api/grading-sheets/bulk-create',
        jsonInit('POST', { ay_id: ayId })
      ),
    onSuccess: (body) => {
      const inserted: number = body.inserted ?? 0;
      const reason: string = body.reason ?? 'already_covered';

      if (inserted === 0) {
        if (reason === 'no_sections') {
          toast.warning(
            `No sections configured for ${ayCode}. Create sections in SIS Admin → Sections first.`
          );
        } else if (reason === 'no_subjects') {
          toast.warning(
            `No subject weights configured for ${ayCode}. Apply the class template in SIS Admin → Class Template first.`
          );
        } else if (reason === 'no_terms') {
          toast.warning(
            `No terms configured for ${ayCode}. Complete AY Setup in SIS Admin first.`
          );
        } else {
          toast.info(
            `No new sheets needed for ${ayCode} — every (section × subject × term) is already covered.`
          );
        }
      } else {
        toast.success(
          `Created ${inserted.toLocaleString('en-SG')} sheet${inserted === 1 ? '' : 's'} for ${ayCode}.`
        );
      }
      router.refresh();
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'bulk create failed');
    },
  });

  const busy = bulkCreate.isPending;

  function run() {
    bulkCreate.mutate();
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={busy}
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <PackagePlus className="size-3.5" />
          )}
          Create all sheets
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Create every missing sheet for {ayCode}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This runs against every section in {ayCode} and creates one grading
            sheet per (subject in that section&apos;s level × term). Existing
            sheets are left alone — the operation is idempotent, so re-clicking
            after adding a new section is safe.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={run} disabled={busy}>
            {busy ? 'Creating…' : 'Create missing sheets'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
