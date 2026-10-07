'use client';

import { Pencil, Trash2 } from 'lucide-react';
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
import { RowActionsMenu } from '@/components/ui/data-table';
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import {
  describeSubjectSetup,
  type SubjectSetupSummary,
} from '@/lib/sis/subjects/setup-summary';

// The row's ⋯ menu in the subject catalog: Edit, and Delete for a subject no
// class uses (lib/sis/subjects/usage.ts has the rule; the route enforces it
// again). Mr Ace, 2026-10-08: actions go in a three-dot menu, not as buttons.
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
  onEdit,
}: {
  subject: Subject;
  /** Present only when the subject may be deleted — what goes with it. */
  deleteSetup?: SubjectSetupSummary;
  /** Opens the subject's drawer. */
  onEdit: () => void;
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

  return (
    <>
      <RowActionsMenu>
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil className="size-3.5" />
          Edit
        </DropdownMenuItem>
        {described && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setConfirmOpen(true)}
            >
              <Trash2 className="size-3.5" />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </RowActionsMenu>

      {described && (
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
      )}
    </>
  );
}
