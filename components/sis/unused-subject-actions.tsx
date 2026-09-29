'use client';

import { PencilLine, Trash2 } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import {
  describeSubjectSetup,
  type SubjectSetupSummary,
} from '@/lib/sis/subjects/setup-summary';

// Rename and Delete for a catalog subject (lib/sis/subjects/usage.ts has both
// rules; the route enforces them again).
//
// Rename — only a subject NOTHING uses yet (no weights in any year, no class,
// no teacher): a typo being corrected. A subject in use is renamed per year
// through "Subject name" in its edit drawer instead; its code never changes.
//
// Delete — any subject no CLASS uses (2026-09-29). Its weights, level
// offerings and report-card mapping go with it, and the confirm says so in
// plain words; any subject reporting under it goes back to reporting as
// itself. The whole setup is snapshotted into the audit log first. A subject
// a class uses shows no Delete.
//
// Rename is two fields, so it happens in the row (inline); Delete cannot be
// undone, so it asks first in a small confirm. Both are plain icon buttons
// in the row (pencil, trash) — no menu, so nothing is nested.

type Subject = { id: string; code: string; name: string };

export function SubjectCatalogMenu({
  subject,
  onRename,
  deleteSetup,
}: {
  subject: Subject;
  /** Present only when the subject may be renamed. */
  onRename?: () => void;
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

  if (!onRename && !described) return null;

  return (
    <>
      <div className="flex shrink-0 items-center gap-0.5">
        {onRename && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 text-foreground hover:text-brand-indigo-deep"
            aria-label={`Rename ${subject.name}`}
            title="Rename"
            onClick={onRename}
          >
            <PencilLine className="size-3.5" />
          </Button>
        )}
        {described && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 text-destructive hover:bg-destructive/10 hover:text-destructive"
            aria-label={`Delete ${subject.name}`}
            title="Delete subject"
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {subject.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              No class uses{' '}
              <span className="font-mono font-semibold text-foreground">
                {subject.code}
              </span>
              . Deleting it removes it from the catalog for good
              {described && described.removed.length > 0
                ? ', along with:'
                : '.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {described && described.removed.length > 0 && (
            <ul className="space-y-1 border-l-2 border-destructive/40 pl-3 text-sm text-foreground">
              {described.removed.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          {described?.repointed && (
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

/** The Subject cell while renaming: code + name, saved together. */
export function SubjectRenameInline({
  subject,
  onDone,
}: {
  subject: Subject;
  onDone: () => void;
}) {
  const [code, setCode] = useState(subject.code);
  const [name, setName] = useState(subject.name);
  const [busy, setBusy] = useState(false);
  const run = useWriteAction();

  const nextCode = code.trim().toUpperCase();
  const nextName = name.trim();
  const codeOk = /^[A-Z0-9_-]{1,32}$/.test(nextCode);
  const changed = nextCode !== subject.code || nextName !== subject.name;
  const canSave = codeOk && nextName.length > 0 && changed && !busy;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    await run(
      () =>
        apiFetch(
          `/api/sis/admin/subjects/catalog/${subject.id}`,
          jsonInit('PATCH', { code: nextCode, name: nextName })
        ),
      {
        pending: `Renaming ${subject.name}…`,
        success: `Renamed to ${nextName} (${nextCode})`,
        onResolved: onDone,
      }
    );
    setBusy(false);
  }

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        maxLength={32}
        aria-label="Subject code"
        aria-invalid={!codeOk}
        className="h-8 w-28 font-mono text-[12px] uppercase"
        autoFocus
      />
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={128}
        aria-label="Subject name"
        className="h-8 min-w-40 flex-1"
      />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={!canSave}
        loading={busy}
        loadingText="Saving…"
      >
        Save
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={onDone}
      >
        Cancel
      </Button>
      {!codeOk && (
        <p className="basis-full text-[11px] text-destructive">
          Codes use capital letters, numbers, - or _ only.
        </p>
      )}
    </form>
  );
}
