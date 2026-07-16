'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Waypoints } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  SECTION_CLASS_TYPES,
  type SectionClassType,
} from '@/lib/schemas/section';

/**
 * SectionTrackDialog — the "flag this section as Global or Standard"
 * bulk-assignment action. Secondary-only (the caller gates on
 * `level.level_type === 'secondary'`, mirroring how the Schedule/Class-type
 * fields are gated on the section-creation forms).
 *
 * `class_type` on `sections` — the SAME field the admissions auto-
 * enrollment matcher already reads (`lib/sis/class-assignment.ts`,
 * untouched by this dialog) — is a bulk-assignment TRIGGER only in this
 * role: this dialog additively attaches the chosen track's static subject
 * bundle (never removes a manual customization) and stamps
 * `sections.class_type` for the "G"/"S" badge; it never restricts what
 * subjects the section can actually carry (`section_subjects` stays the
 * source of truth, unaffected — the registrar can still add/remove any
 * subject afterward via the per-section attach panel below).
 */
export function SectionTrackDialog({
  sectionId,
  sectionName,
  currentTrack,
}: {
  sectionId: string;
  sectionName: string;
  currentTrack: SectionClassType | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<SectionClassType | ''>(
    currentTrack ?? ''
  );

  const applyMutation = useMutation({
    mutationFn: (classType: SectionClassType) =>
      apiFetch<{ inserted: number; sheetsInserted: number }>(
        `/api/sections/${sectionId}/track`,
        jsonInit('POST', { class_type: classType })
      ),
    onSuccess: (json, classType) => {
      const parts = [`Set ${sectionName} to ${classType}`];
      if (json?.inserted)
        parts.push(
          `${json.inserted} subject${json.inserted === 1 ? '' : 's'} attached`
        );
      toast.success(parts.join(' — '));
      setOpen(false);
      router.refresh();
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : 'Could not set track'),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSelected(currentTrack ?? '');
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Waypoints className="size-3.5" />
          {currentTrack ? 'Change track' : 'Set track'}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {currentTrack ? 'Change' : 'Set'} curriculum track
          </DialogTitle>
          <DialogDescription>
            Bulk-attaches the track&apos;s subject bundle to {sectionName} —
            additive only, never removes a subject already on this section.
            Mother Tongue isn&apos;t part of either bundle; attach it separately
            below (it needs a language pick).
          </DialogDescription>
        </DialogHeader>

        <RadioGroup
          value={selected}
          onValueChange={(v) => setSelected(v as SectionClassType)}
          className="flex flex-col gap-3"
        >
          {SECTION_CLASS_TYPES.map((t) => (
            <label
              key={t}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2.5 text-sm font-medium text-foreground has-[[data-state=checked]]:border-brand-indigo has-[[data-state=checked]]:bg-brand-indigo/5"
            >
              <RadioGroupItem value={t} />
              {t}
            </label>
          ))}
        </RadioGroup>
        <Label className="text-xs font-normal text-muted-foreground">
          {currentTrack ? `Currently ${currentTrack}. ` : ''}
          Changing the track doesn&apos;t remove any subject already attached —
          it only adds what&apos;s missing from the new bundle.
        </Label>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="gap-1.5"
            disabled={!selected || applyMutation.isPending}
            onClick={() => selected && applyMutation.mutate(selected)}
          >
            {applyMutation.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Waypoints className="size-3.5" />
            )}
            {applyMutation.isPending ? 'Applying…' : 'Apply'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
