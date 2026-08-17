'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Clock } from 'lucide-react';

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
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { SCHEDULE_LABELS, SCHEDULE_VALUES } from '@/lib/schemas/section';
import type { Schedule } from '@/lib/schemas/section';

/**
 * SectionScheduleDialog — sets whether a class runs in the morning, the
 * afternoon, or the whole day.
 *
 * Until this shipped, nothing in the app could write `sections.schedule`: AY
 * rollover stamps it from the fixed static catalog, and section creation
 * deliberately drops the field, so a hand-created class was stuck showing no
 * schedule with no way to fix it. This is that path.
 *
 * Structure mirrors SectionTrackDialog exactly — same dual-mode
 * controlled/uncontrolled shape, so it can render its own trigger on the
 * section detail page and be driven trigger-less from the per-row ⋯ menu.
 *
 * Deliberately SIS-Admin-only. Schedule is shared, school-level config, not a
 * per-teacher preference: it belongs beside Rename and Track, and never in
 * Classroom's Settings tab, which is personal-only by construction (KD #160).
 */
export function SectionScheduleDialog({
  sectionId,
  sectionName,
  currentSchedule,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: {
  sectionId: string;
  sectionName: string;
  currentSchedule: Schedule | null;
  /** Dual-mode, same pattern as SectionTrackDialog: uncontrolled with its own
   * trigger button by default (the section detail page), or controlled +
   * trigger-less for embedding in a ⋯ actions menu. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const isControlled = controlledOpen !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = isControlled
    ? (controlledOnOpenChange ?? (() => {}))
    : setUncontrolledOpen;

  // '' is the "Not set" choice, which maps to a real `null` write — clearing
  // is a legitimate action, not just a starting state.
  const [selected, setSelected] = useState<Schedule | ''>(
    currentSchedule ?? ''
  );

  const saveMutation = useMutation({
    mutationFn: (next: Schedule | null) =>
      apiFetch<{ changed: boolean }>(
        `/api/sections/${sectionId}/schedule`,
        jsonInit('PATCH', { schedule: next })
      ),
  });

  const run = useWriteAction();
  const [saving, setSaving] = useState(false);

  async function save() {
    const next = selected === '' ? null : selected;
    setSaving(true);
    await run(() => saveMutation.mutateAsync(next), {
      pending: 'Saving schedule…',
      success: next
        ? `${sectionName} set to ${SCHEDULE_LABELS[next]}`
        : `Cleared the schedule for ${sectionName}`,
      error: (e) =>
        e instanceof Error ? e.message : 'Could not save the schedule',
      onResolved: () => setOpen(false),
    });
    setSaving(false);
  }

  const isUnchanged = (currentSchedule ?? '') === selected;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSelected(currentSchedule ?? '');
      }}
    >
      {!isControlled && (
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" className="gap-1.5">
            <Clock className="size-3.5" />
            {currentSchedule ? 'Change schedule' : 'Set schedule'}
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {currentSchedule ? 'Change' : 'Set'} class schedule
          </DialogTitle>
          <DialogDescription>
            When {sectionName} meets. This shows on the section and class pages,
            and is what the admissions matcher will read when placing an
            applicant who asked for a morning or afternoon class.
          </DialogDescription>
        </DialogHeader>

        <RadioGroup
          value={selected}
          onValueChange={(v) => setSelected(v as Schedule | '')}
          className="flex flex-col gap-3"
        >
          {SCHEDULE_VALUES.map((s) => (
            <label
              key={s}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2.5 text-sm font-medium text-foreground has-[[data-state=checked]]:border-brand-indigo has-[[data-state=checked]]:bg-brand-indigo/5"
            >
              <RadioGroupItem value={s} />
              {SCHEDULE_LABELS[s]}
            </label>
          ))}
          <label className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground has-[[data-state=checked]]:border-brand-indigo has-[[data-state=checked]]:bg-brand-indigo/5">
            <RadioGroupItem value="" />
            Not set
          </label>
        </RadioGroup>
        <Label className="text-xs font-normal text-muted-foreground">
          {currentSchedule
            ? `Currently ${SCHEDULE_LABELS[currentSchedule]}.`
            : 'No schedule recorded for this class yet.'}
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
            loading={saving}
            loadingText="Saving…"
            disabled={isUnchanged}
            onClick={() => void save()}
          >
            {!saving && <Clock className="size-3.5" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
