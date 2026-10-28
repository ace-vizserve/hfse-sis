'use client';

import { useMutation } from '@tanstack/react-query';
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import type { SupplyClassType, SupplyKind } from '@/lib/sis/supplies/types';

// The add / edit drawer and the row actions on /admissions/book-list (plan
// 2026-10-28-books-supplies-tracker.md, Phase 4; 09a §8 "Sheet for secondary
// forms"). One drawer for both kinds and both modes: a book is subject, title,
// publisher, ISBN and (on a Primary level) its track; a supply is a title and
// whether it is for every level or Youngstarters only.
//
// Remove asks first, and refuses up front when any student has been given the
// item — the route refuses it too (409), because deleting the item would
// delete those handovers with it.

/** What the page knows about the level being shown. */
export type BookListLevel = {
  id: string;
  label: string;
  levelType: 'primary' | 'secondary';
};

/** An item as the page passes it to Edit / Remove. */
export type BookListItemTarget = {
  id: string;
  kind: SupplyKind;
  title: string;
  subject: string | null;
  publisher: string | null;
  isbn: string | null;
  classType: SupplyClassType | null;
  /** A supply: null = every level. */
  levelId: string | null;
  /** Handover rows for the item — any at all blocks Remove. */
  handedOver: number;
};

type Track = 'Global' | 'Standard' | 'Both';
type Scope = 'every' | 'ys';

type FormState = {
  subjectChoice: string; // an existing subject, or NEW_SUBJECT
  newSubject: string;
  title: string;
  publisher: string;
  isbn: string;
  track: Track;
  scope: Scope;
};

const NEW_SUBJECT = '__new__';

function initialState(
  target: BookListItemTarget | null,
  subjects: readonly string[],
  defaultTrack: SupplyClassType | null
): FormState {
  const subject = target?.subject ?? '';
  const known = subject !== '' && subjects.includes(subject);
  return {
    subjectChoice: known
      ? subject
      : subject !== '' || subjects.length === 0
        ? NEW_SUBJECT
        : '',
    newSubject: known ? '' : subject,
    title: target?.title ?? '',
    publisher: target?.publisher ?? '',
    isbn: target?.isbn ?? '',
    track: target ? (target.classType ?? 'Both') : (defaultTrack ?? 'Both'),
    scope: target && target.levelId !== null ? 'ys' : 'every',
  };
}

function BookListItemSheet({
  open,
  onOpenChange,
  kind,
  ayCode,
  level,
  subjects,
  defaultTrack,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: SupplyKind;
  ayCode: string;
  level: BookListLevel;
  subjects: readonly string[];
  defaultTrack: SupplyClassType | null;
  /** null = add a new item. */
  target: BookListItemTarget | null;
}) {
  // State starts from `target` on mount; callers remount (a fresh `key`) each
  // time the drawer opens, so a cancelled edit never leaks into the next.
  const isEdit = target !== null;
  const isBook = kind === 'book';
  const [form, setForm] = useState<FormState>(() =>
    initialState(target, subjects, defaultTrack)
  );
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const run = useWriteAction();

  const subject =
    form.subjectChoice === NEW_SUBJECT
      ? form.newSubject.trim()
      : form.subjectChoice;
  const showTrack = isBook && level.levelType === 'primary';
  const classType: SupplyClassType | null =
    showTrack && form.track !== 'Both' ? form.track : null;

  const body = isBook
    ? {
        kind,
        subject,
        title: form.title.trim(),
        publisher: form.publisher.trim() || null,
        isbn: form.isbn.trim() || null,
        classType,
      }
    : {
        kind,
        title: form.title.trim(),
        youngstartersOnly: form.scope === 'ys',
      };

  const mutation = useMutation({
    mutationFn: () =>
      target !== null
        ? apiFetch(
            `/api/sis/supplies/items/${target.id}`,
            jsonInit('PATCH', body)
          )
        : apiFetch(
            '/api/sis/supplies/items',
            jsonInit(
              'POST',
              isBook
                ? { ...body, ay: ayCode, levelId: level.id }
                : { ...body, ay: ayCode }
            )
          ),
  });

  const titleError = form.title.trim() ? null : 'Enter the title.';
  // "A new subject…" picked but left empty is no subject at all.
  const subjectError =
    isBook && !subject ? 'Pick a subject, or type a new one.' : null;
  const noun = isBook ? 'book' : 'supply';
  const name = form.title.trim();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (titleError || subjectError) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    await run(() => mutation.mutateAsync(), {
      pending: isEdit ? `Saving ${name}…` : `Adding ${name}…`,
      success: isEdit ? `Saved ${name}` : `Added ${name} to the ${ayCode} list`,
      onResolved: () => onOpenChange(false),
    });
    setSaving(false);
  }

  const description = isBook
    ? isEdit
      ? `A book on ${ayCode}'s list for ${level.label}.`
      : `It goes on ${ayCode}'s list for ${level.label}, at the end of its subject.`
    : isEdit && target?.levelId === null
      ? `On ${ayCode}'s list for every level — a change here shows on every level.`
      : `A supply on ${ayCode}'s list.`;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 sm:max-w-lg"
      >
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader className="gap-1.5 border-b border-border p-5">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Book list · {ayCode}
              {isBook ? ` · ${level.label}` : ''}
            </p>
            <SheetTitle className="font-serif text-[22px] leading-tight tracking-tight">
              {isEdit ? `Edit ${noun}` : `Add a ${noun}`}
            </SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <FieldGroup>
              {isBook && (
                <Field data-invalid={showErrors && !!subjectError}>
                  <FieldLabel htmlFor="bl-subject">Subject</FieldLabel>
                  {subjects.length > 0 && (
                    <Select
                      value={form.subjectChoice}
                      onValueChange={(v) =>
                        setForm((f) => ({ ...f, subjectChoice: v }))
                      }
                    >
                      <SelectTrigger id="bl-subject" className="w-full">
                        <SelectValue placeholder="Choose a subject" />
                      </SelectTrigger>
                      <SelectContent>
                        {subjects.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                        <SelectSeparator />
                        <SelectItem value={NEW_SUBJECT}>
                          A new subject…
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  {form.subjectChoice === NEW_SUBJECT && (
                    <Input
                      id={subjects.length > 0 ? 'bl-new-subject' : 'bl-subject'}
                      aria-label="New subject"
                      value={form.newSubject}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, newSubject: e.target.value }))
                      }
                      placeholder="Science"
                    />
                  )}
                  {showErrors && subjectError && (
                    <FieldError>{subjectError}</FieldError>
                  )}
                  <FieldDescription>
                    Books are grouped by subject on the page and on each
                    student&apos;s list.
                  </FieldDescription>
                </Field>
              )}

              <Field data-invalid={showErrors && !!titleError}>
                <FieldLabel htmlFor="bl-title">Title</FieldLabel>
                <Input
                  id="bl-title"
                  autoFocus
                  value={form.title}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, title: e.target.value }))
                  }
                  placeholder={
                    isBook ? 'Science Activity Book 5A' : 'Exercise book A4'
                  }
                />
                {showErrors && titleError && (
                  <FieldError>{titleError}</FieldError>
                )}
              </Field>

              {isBook && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="bl-publisher">Publisher</FieldLabel>
                    <Input
                      id="bl-publisher"
                      value={form.publisher}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, publisher: e.target.value }))
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="bl-isbn">ISBN</FieldLabel>
                    <Input
                      id="bl-isbn"
                      className="font-mono tabular-nums"
                      value={form.isbn}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, isbn: e.target.value }))
                      }
                    />
                  </Field>
                </div>
              )}

              {showTrack && (
                <FieldSet className="gap-3">
                  <FieldLegend variant="label" className="mb-0">
                    Which classes get it
                  </FieldLegend>
                  <RadioGroup
                    value={form.track}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, track: v as Track }))
                    }
                    className="grid grid-cols-3 gap-3"
                  >
                    {(['Global', 'Standard', 'Both'] as const).map((t) => (
                      <label
                        key={t}
                        className="flex items-center gap-2 rounded-md border border-border px-3 py-2.5 text-sm font-medium text-foreground has-[[data-state=checked]]:border-brand-indigo has-[[data-state=checked]]:bg-brand-indigo/5"
                      >
                        <RadioGroupItem value={t} />
                        {t}
                      </label>
                    ))}
                  </RadioGroup>
                </FieldSet>
              )}

              {!isBook && (
                <FieldSet className="gap-3">
                  <FieldLegend variant="label" className="mb-0">
                    Who it is for
                  </FieldLegend>
                  <RadioGroup
                    value={form.scope}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, scope: v as Scope }))
                    }
                    className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                  >
                    {(
                      [
                        ['every', 'Every level'],
                        ['ys', 'Youngstarters only'],
                      ] as const
                    ).map(([value, label]) => (
                      <label
                        key={value}
                        className="flex items-center gap-2 rounded-md border border-border px-3 py-2.5 text-sm font-medium text-foreground has-[[data-state=checked]]:border-brand-indigo has-[[data-state=checked]]:bg-brand-indigo/5"
                      >
                        <RadioGroupItem value={value} />
                        {label}
                      </label>
                    ))}
                  </RadioGroup>
                </FieldSet>
              )}
            </FieldGroup>
          </div>

          <SheetFooter className="gap-2 border-t border-border p-5">
            <SheetClose asChild>
              <Button type="button" variant="outline" disabled={saving}>
                Cancel
              </Button>
            </SheetClose>
            <Button
              type="submit"
              loading={saving}
              loadingText={isEdit ? 'Saving…' : 'Adding…'}
            >
              {isEdit ? 'Save changes' : `Add ${noun}`}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/** "Add book" / "Add supply" — outline, opening the drawer empty. */
export function AddBookListItemButton({
  kind,
  ayCode,
  level,
  subjects,
  defaultTrack,
}: {
  kind: SupplyKind;
  ayCode: string;
  level: BookListLevel;
  subjects: readonly string[];
  /** The track tab being viewed — a new book starts on it. */
  defaultTrack: SupplyClassType | null;
}) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setSession((n) => n + 1);
          setOpen(true);
        }}
      >
        <Plus className="size-4" />
        {kind === 'book' ? 'Add book' : 'Add supply'}
      </Button>
      <BookListItemSheet
        key={session}
        open={open}
        onOpenChange={setOpen}
        kind={kind}
        ayCode={ayCode}
        level={level}
        subjects={subjects}
        defaultTrack={defaultTrack}
        target={null}
      />
    </>
  );
}

/** A row's Edit and Remove. The drawer and the confirm are siblings, never nested. */
export function BookListItemActions({
  item,
  ayCode,
  level,
  subjects,
}: {
  item: BookListItemTarget;
  ayCode: string;
  level: BookListLevel;
  subjects: readonly string[];
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [session, setSession] = useState(0);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const run = useWriteAction();

  const removeMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/sis/supplies/items/${item.id}`, jsonInit('DELETE')),
  });

  function openEdit() {
    setSession((n) => n + 1);
    setEditOpen(true);
  }

  async function remove() {
    setRemoving(true);
    await run(() => removeMutation.mutateAsync(), {
      pending: `Removing ${item.title}…`,
      success: `Removed ${item.title} from the ${ayCode} list`,
      onResolved: () => setRemoveOpen(false),
    });
    setRemoving(false);
  }

  const given = item.handedOver;
  const everyLevel = item.kind === 'supply' && item.levelId === null;

  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="size-7"
            aria-label={`Actions for ${item.title}`}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onSelect={openEdit}>
            <Pencil className="size-3.5" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setRemoveOpen(true)}
          >
            <Trash2 className="size-3.5" />
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <BookListItemSheet
        key={session}
        open={editOpen}
        onOpenChange={setEditOpen}
        kind={item.kind}
        ayCode={ayCode}
        level={level}
        subjects={subjects}
        defaultTrack={null}
        target={item}
      />

      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          {given > 0 ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {given} {given === 1 ? 'student has' : 'students have'} been
                  given this; edit it instead
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {item.title} can&apos;t be removed while any student is
                  recorded as having it — removing it would lose that record.
                  Change its details instead, or untick it on those
                  students&apos; Supplies stage first.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Close</AlertDialogCancel>
                <Button
                  onClick={() => {
                    setRemoveOpen(false);
                    openEdit();
                  }}
                >
                  <Pencil className="size-4" />
                  Edit it
                </Button>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {item.title}?</AlertDialogTitle>
                <AlertDialogDescription>
                  {everyLevel
                    ? `It comes off ${ayCode}'s list for every level.`
                    : `It comes off ${ayCode}'s list for ${level.label}.`}{' '}
                  No student has been given it yet.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={removing}>
                  Cancel
                </AlertDialogCancel>
                <Button
                  variant="destructive"
                  onClick={() => void remove()}
                  loading={removing}
                  loadingText="Removing…"
                >
                  Remove
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
