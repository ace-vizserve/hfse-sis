'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';

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
  TRACK_LABELS,
  TRACK_VALUES,
  type SectionCreateInput,
  type Track,
} from '@/lib/schemas/section';

type LevelOption = {
  id: string;
  code: string;
  label: string;
  level_type: 'primary' | 'secondary';
};

function blankValues(initialLevelId?: string): SectionCreateInput {
  return {
    name: '',
    level_id: initialLevelId ?? '',
    class_type: null,
    track: null,
  };
}

export function NewSectionButton({
  levels,
  ayCode,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  initialLevelId,
}: {
  levels: LevelOption[];
  ayCode: string | null;
  /** Dual-mode, same pattern as AddLevelDialog (components/sis/levels-
   * manager-client.tsx): uncontrolled with its own trigger button by
   * default (the page header CTA), or controlled + pre-filled for a
   * cross-module "add a section for THIS level" quick action (e.g. from
   * Grade Levels' row menu, or the "Levels with no section yet" callout
   * on this page). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  initialLevelId?: string;
}) {
  const router = useRouter();
  const isControlled = controlledOpen !== undefined;
  // Auto-opens on first render when an initialLevelId arrives while
  // uncontrolled — e.g. Grade Levels' row menu deep-links here via
  // ?addSectionLevel=<id>, and the page resolves that into initialLevelId
  // server-side. Only affects the very first mount (a later initialLevelId
  // change while already open/closed doesn't reopen it).
  const [uncontrolledOpen, setUncontrolledOpen] = useState(
    () => !isControlled && Boolean(initialLevelId)
  );
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = isControlled
    ? (controlledOnOpenChange ?? (() => {}))
    : setUncontrolledOpen;
  const form = useForm<SectionCreateInput>({
    resolver: zodResolver(SectionCreateSchema),
    defaultValues: blankValues(initialLevelId),
  });

  useEffect(() => {
    if (open) form.reset(blankValues(initialLevelId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialLevelId]);

  const selectedLevelId = form.watch('level_id');
  const selectedLevelType =
    levels.find((l) => l.id === selectedLevelId)?.level_type ?? null;

  // Tier-2 mutation (Model A): the POST is routed through useMutation; we keep
  // onSubmit async + mutateAsync so RHF's isSubmitting still drives `busy`, and
  // router.push/refresh fire on success exactly as before. The bespoke error
  // fallback ('create failed') is preserved — ApiError.message already resolves
  // to body.error, so a thrown ApiError carries the route's specific copy.
  const createMutation = useMutation({
    mutationFn: (values: SectionCreateInput) =>
      apiFetch<{ id: string }>(
        '/api/sections',
        jsonInit('POST', {
          name: values.name.trim(),
          level_id: values.level_id,
          class_type: values.class_type ?? null,
          track:
            selectedLevelType === 'secondary' ? (values.track ?? null) : null,
        })
      ),
  });

  async function onSubmit(values: SectionCreateInput) {
    // Track is required-for-Secondary at the application layer only (the
    // schema can't see level_type) — guard here so the error surfaces
    // inline instead of round-tripping to the server's 422.
    if (selectedLevelType === 'secondary' && !values.track) {
      form.setError('track', {
        message: 'Pick Global or Standard for a Secondary section',
      });
      return;
    }
    try {
      const body = await createMutation.mutateAsync(values);
      toast.success(`Created ${values.name}`);
      setOpen(false);
      form.reset(blankValues());
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
        if (!next) form.reset(blankValues(initialLevelId));
      }}
    >
      {!isControlled && (
        <DialogTrigger asChild>
          <Button size="sm" className="gap-1.5">
            <Plus className="size-3.5" />
            New section
          </Button>
        </DialogTrigger>
      )}
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
            Mid-year addition for the current AY. Rollover still happens through
            AY Setup; this is for the surprise-late-transfer case.
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
                          <span className="ml-2 text-muted-foreground">
                            {l.label}
                          </span>
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
                    <Input
                      placeholder="e.g. Patience"
                      {...field}
                      autoCapitalize="words"
                    />
                  </FormControl>
                  <FormDescription>
                    Just the virtue / label. Level prefix is added automatically
                    on display.
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
                        v === ''
                          ? null
                          : (v as (typeof SECTION_CLASS_TYPES)[number])
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
                    Global (G) = multi-track homeroom; Standard = fixed track.
                    Leave blank if not applicable.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {selectedLevelType === 'secondary' && (
              <FormField
                control={form.control}
                name="track"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Track</FormLabel>
                    <Select
                      value={field.value ?? ''}
                      onValueChange={(v) => field.onChange(v as Track)}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Global or Standard — required" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {TRACK_VALUES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {TRACK_LABELS[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Bulk-attaches the track&apos;s subjects to this section —
                      additive, never removes a manual customization later.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy} className="gap-1.5">
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Plus className="size-3.5" />
                )}
                {busy ? 'Creating…' : 'Create section'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
