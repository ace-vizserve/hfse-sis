'use client';

import { MoreHorizontal, PencilLine, Trash2 } from 'lucide-react';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// Rename and Delete for a catalog subject NOTHING uses yet — no weights in any
// year, no class, no teacher (lib/sis/subjects/usage.ts). That is a subject
// added by mistake or with the wrong code, and fixing it should not need SQL.
// A subject in use is renamed per year through "Subject name" in its edit
// drawer instead; its code never changes. The route refuses both anyway.
//
// Rename is two fields, so it happens in the row (inline); Delete cannot be
// undone, so it asks first in a small confirm. The menu closes before the
// confirm opens — nothing is nested.

type Subject = { id: string; code: string; name: string };

export function UnusedSubjectMenu({
  subject,
  onRename,
}: {
  subject: Subject;
  onRename: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = useWriteAction();

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
        onResolved: () => setConfirmOpen(false),
      }
    );
    setBusy(false);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 text-muted-foreground opacity-60 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
            aria-label={`More for ${subject.name}`}
          >
            <MoreHorizontal className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onRename}>
            <PencilLine className="size-3.5" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setConfirmOpen(true)}
          >
            <Trash2 className="size-3.5" />
            Delete subject
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {subject.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Nothing uses{' '}
              <span className="font-mono font-semibold text-foreground">
                {subject.code}
              </span>{' '}
              yet — no weights, classes or teachers in any school year. Deleting
              it removes it from the catalog for good.
            </AlertDialogDescription>
          </AlertDialogHeader>
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
