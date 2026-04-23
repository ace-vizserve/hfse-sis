'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';

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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { SectionUpdateSchema, type SectionUpdateInput } from '@/lib/schemas/section';

// Rename a section. Opens from the /sis/sections/[id] Overview header.
// Only `name` is editable today — level, AY, and class_type are
// structurally pinned. Server surfaces 23505 unique-violation as a 409
// with a friendly message.
export function SectionRenameDialog({
  sectionId,
  currentName,
}: {
  sectionId: string;
  currentName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const form = useForm<SectionUpdateInput>({
    resolver: zodResolver(SectionUpdateSchema),
    defaultValues: { name: currentName },
  });

  async function onSubmit(values: SectionUpdateInput) {
    const nextName = values.name.trim();
    if (nextName === currentName) {
      setOpen(false);
      return;
    }
    try {
      const res = await fetch(`/api/sections/${sectionId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: nextName }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? 'rename failed');
      toast.success(`Renamed to ${nextName}`);
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'rename failed');
    }
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
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Pencil className="size-3.5" />
          Rename
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename section</DialogTitle>
          <DialogDescription>
            Changes the display name school-wide. Level, academic year, and class type stay the
            same. Existing rosters, grading sheets, and report cards follow automatically.
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
                  <FormDescription>
                    Just the virtue / label. Level prefix is inferred on display.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy} className="gap-1.5">
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
