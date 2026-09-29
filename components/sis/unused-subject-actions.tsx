'use client';

import { Trash2 } from 'lucide-react';
import { useState } from 'react';

import {
  AlertDialog,
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
import {
  describeSubjectSetup,
  type SubjectSetupSummary,
} from '@/lib/sis/subjects/setup-summary';

// Delete for a catalog subject (lib/sis/subjects/usage.ts has the rule; the
// route enforces it again).
//
// Delete — any subject no CLASS uses (2026-09-29). Its weights, level
// offerings and report-card mapping go with it, and the confirm says so in
// plain words; any subject reporting under it goes back to reporting as
// itself. The whole setup is snapshotted into the audit log first. A subject
// a class uses shows no Delete. It cannot be undone, so it asks first in a
// small confirm.
//
// There is no Change code any more (2026-09-29, Mr Ace: "the code is like a
// student number"): the server generates it at creation and it never
// changes. The name is edited in the subject's drawer (Edit).

type Subject = { id: string; code: string; name: string };

export function SubjectCatalogMenu({
  subject,
  deleteSetup,
}: {
  subject: Subject;
  /** Present only when the subject may be deleted — what goes with it. */
  deleteSetup?: SubjectSetupSummary;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = useWriteAction();
  const described = deleteSetup ? describeSubjectSetup(deleteSetup) : null;

  async function onDelete() {
    setBusy(true);
    await run(
      () =>
        apiFetch(
          `/api/sis/admin/subjects/catalog/${subject.id}`,
          jsonInit('DELETE')
        ),
      {
        pending: `Deleting ${subject.name}…`,
        success: `Deleted ${subject.name}`,
        // useWriteAction toasts and refreshes the page itself.
        onResolved: () => setConfirmOpen(false),
      }
    );
    setBusy(false);
  }

  if (!described) return null;

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        className="h-7 shrink-0 px-2.5 text-xs"
        aria-label={`Delete ${subject.name}`}
        onClick={() => setConfirmOpen(true)}
      >
        <Trash2 className="size-3.5" />
        Delete
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {subject.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              No class uses {subject.name}{' '}
              <span className="font-mono text-[11px]">({subject.code})</span>.
              Deleting it removes it from the catalog for good
              {described.removed.length > 0 ? ', along with:' : '.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {described.removed.length > 0 && (
            <ul className="space-y-1 border-l-2 border-destructive/40 pl-3 text-sm text-foreground">
              {described.removed.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          {described.repointed && (
            <p className="text-sm text-muted-foreground">
              {described.repointed}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              loading={busy}
              loadingText="Deleting…"
              onClick={() => void onDelete()}
            >
              Delete subject
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
