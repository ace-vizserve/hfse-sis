'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { PackagePlus } from 'lucide-react';
import { toast } from 'sonner';

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
  // The success body carries `inserted` + `reason` (it's a 200 with a result
  // shape, not an error), so "nothing was created, and here is why" arrives on
  // the SUCCESS path. Those branches are warnings and notices, not successes —
  // returning `null` lets each keep its own colour. The 'bulk create failed'
  // fallback is preserved (ApiError.message already resolves to body.error).
  const bulkCreate = useMutation({
    mutationFn: () =>
      apiFetch<{ inserted?: number; reason?: string }>(
        '/api/grading-sheets/bulk-create',
        jsonInit('POST', { ay_id: ayId })
      ),
  });

  const run = useWriteAction();
  const [busy, setBusy] = useState(false);

  async function createSheets() {
    setBusy(true);
    await run(() => bulkCreate.mutateAsync(), {
      pending: `Creating sheets for ${ayCode}…`,
      success: (body) => {
        const inserted: number = body.inserted ?? 0;
        const reason: string = body.reason ?? 'already_covered';

        if (inserted === 0) {
          if (reason === 'no_sections') {
            toast.warning(
              `No sections configured for ${ayCode}. Create sections in SIS Admin → Sections first.`
            );
          } else if (reason === 'no_subjects') {
            toast.warning(
              `No subject weights configured for ${ayCode}. Attach subjects in SIS Admin → Subject Weights first.`
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
          return null;
        }
        return `Created ${inserted.toLocaleString('en-SG')} sheet${inserted === 1 ? '' : 's'} for ${ayCode}.`;
      },
      error: (e) => (e instanceof Error ? e.message : 'bulk create failed'),
    });
    setBusy(false);
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          loading={busy}
          loadingText="Creating…"
        >
          {!busy && <PackagePlus className="size-3.5" />}
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
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void createSheets();
            }}
            disabled={busy}
          >
            {busy ? 'Creating…' : 'Create missing sheets'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
