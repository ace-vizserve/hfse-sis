'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';

import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  SectionUpdateSchema,
  type SectionUpdateInput,
} from '@/lib/schemas/section';

export function SectionRenameDialog({
  sectionId,
  currentName,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: {
  sectionId: string;
  currentName: string;
  /** Dual-mode, same pattern as NewSectionButton: uncontrolled with its
   * own trigger button by default (the section detail page), or
   * controlled + trigger-less for embedding in a ⋯ actions menu (the
   * sections list page's per-row menu). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const isControlled = controlledOpen !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = isControlled
    ? (controlledOnOpenChange ?? (() => {}))
    : setUncontrolledOpen;
  const form = useForm<SectionUpdateInput>({
    resolver: zodResolver(SectionUpdateSchema),
    defaultValues: { name: currentName },
  });

  const renameMutation = useMutation({
    mutationFn: (nextName: string) =>
      apiFetch(
        `/api/sections/${sectionId}`,
        jsonInit('PATCH', { name: nextName })
      ),
  });

  const run = useWriteAction();

  async function onSubmit(values: SectionUpdateInput) {
    const nextName = values.name?.trim() ?? currentName;
    if (nextName === currentName) {
      setOpen(false);
      return;
    }
    // Awaited inside RHF's handleSubmit so `formState.isSubmitting` stays the
    // busy signal — and because `run` is awaited, it stays true through the
    // refresh, not just the PATCH. `run` never rejects, so the old
    // `.catch(() => {})` is gone.
    await run(() => renameMutation.mutateAsync(nextName), {
      pending: `Renaming to ${nextName}…`,
      success: `Section renamed to ${nextName}`,
      error: (e) => (e instanceof Error ? e.message : 'update failed'),
      onResolved: () => setOpen(false),
    });
  }

  const busy = form.formState.isSubmitting;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) form.reset({ name: currentName });
      }}
    >
      {!isControlled && (
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" className="gap-1.5">
            <Pencil className="size-3.5" />
            Rename
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename section</DialogTitle>
          <DialogDescription>
            Update the section name. Level and academic year stay the same.
            Existing rosters, grading sheets, and report cards follow
            automatically.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Section name</FormLabel>
                  <FormControl>
                    <Input autoFocus placeholder="e.g. Patience" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                loading={busy}
                loadingText="Saving…"
                className="gap-1.5"
              >
                Save
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
