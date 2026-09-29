'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';

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
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// "Remove sheet" on the sheet itself — rendered ONLY when nothing was ever
// entered on it (the page asks `loadSheetRemovability`; the route re-checks).
// KD #131 update, 2026-09-29. The page is a canvas, not a drawer, so a small
// confirm dialog is fine here.
export function RemoveSheetButton({
  sheetId,
  termLabel,
  subjectName,
  sectionName,
}: {
  sheetId: string;
  termLabel: string;
  subjectName: string;
  sectionName: string;
}) {
  const router = useRouter();
  const run = useWriteAction();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    const result = await run(
      () => apiFetch(`/api/grading-sheets/${sheetId}`, jsonInit('DELETE')),
      {
        pending: 'Removing sheet…',
        success: 'Sheet removed',
        // The page this button sits on no longer exists — refreshing it would
        // render a 404. Go to the list instead.
        refresh: false,
        onResolved: () => router.push('/markbook/grading'),
      }
    );
    if (result === undefined) setBusy(false);
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        loading={busy}
        loadingText="Removing…"
        onClick={() => setOpen(true)}
      >
        {!busy && <Trash2 className="h-4 w-4" />}
        Remove sheet
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this sheet?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove {termLabel}&rsquo;s {subjectName} sheet for {sectionName}?
              It has no scores, so nothing is lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void remove()}
            >
              Remove sheet
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
