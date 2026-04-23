'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Loader2, Plus } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  SECTION_CLASS_TYPES,
  SectionCreateSchema,
  type SectionCreateInput,
} from '@/lib/schemas/section';

type LevelOption = { id: string; code: string; label: string };

const BLANK: SectionCreateInput = {
  name: '',
  level_id: '',
  class_type: null,
};

export function NewSectionButton({
  levels,
  ayCode,
}: {
  levels: LevelOption[];
  ayCode: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const form = useForm<SectionCreateInput>({
    resolver: zodResolver(SectionCreateSchema),
    defaultValues: BLANK,
  });

  async function onSubmit(values: SectionCreateInput) {
    try {
      const res = await fetch('/api/sections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: values.name.trim(),
          level_id: values.level_id,
          class_type: values.class_type ?? null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? 'create failed');
      toast.success(`Created ${values.name}`);
      setOpen(false);
      form.reset(BLANK);
      // Section setup lives in SIS Admin now (2026-04-22).
      router.push(`/sis/sections/${body.id}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'create failed');
    }
  }

  const busy = form.formState.isSubmitting;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) form.reset(BLANK);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="size-3.5" />
          New section
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            New section
            {ayCode && (
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {ayCode}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            Mid-year addition for the current AY. Rollover still happens through AY Setup; this
            is for the surprise-late-transfer case.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="level_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Level</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Pick a level" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {levels.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          <span className="font-mono text-xs">{l.code}</span>
                          <span className="ml-2 text-muted-foreground">{l.label}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Section name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Patience" {...field} autoCapitalize="words" />
                  </FormControl>
                  <FormDescription>
                    Just the virtue / label. Level prefix is added automatically on display.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="class_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Class type</FormLabel>
                  <Select
                    value={field.value ?? ''}
                    onValueChange={(v) =>
                      field.onChange(
                        v === '' ? null : (v as (typeof SECTION_CLASS_TYPES)[number]),
                      )
                    }
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Optional" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {SECTION_CLASS_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Global (G) = multi-track homeroom; Standard = fixed track. Leave blank if not applicable.
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
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                {busy ? 'Creating…' : 'Create section'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
