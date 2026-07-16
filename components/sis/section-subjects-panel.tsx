'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { BookOpen, Languages, Loader2, Plus, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';

import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { MOTHER_TONGUE_SUBJECT_CODES } from '@/lib/schemas/subject';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type SectionSubjectChip = {
  subjectConfigId: string;
  code: string;
  name: string;
  isExaminable: boolean;
};

// "Mother Tongue" (`MT`) has no subject_configs/subject_level_offerings
// row of its own since migration 081 retargeted it to a report-only
// fan-in label — Filipino/Mandarin are the real attachable subjects.
// Radix Select/RadioGroup reject empty-string values, so a sentinel
// stands in for "the user picked the Mother Tongue umbrella, now show
// the language sub-choice" — it is never itself sent to the API.
const MOTHER_TONGUE_SENTINEL = '__mother_tongue__';

function isMotherTongueCode(code: string): boolean {
  return (MOTHER_TONGUE_SUBJECT_CODES as readonly string[]).includes(code);
}

/**
 * SectionSubjectsPanel — per-section subject overrides (migration 079,
 * section_subjects). A section's subjects default to every subject
 * configured at its level (subject_configs, KD #4 — weights/slot-counts
 * stay a single per-level source of truth, never edited here); this panel
 * only decides WHICH of those subjects apply to THIS section. Every
 * existing section was backfilled with the full default set, so the empty
 * state below should be rare in practice — it's the pre-sync state for a
 * freshly created section or one created before this feature shipped.
 */
export function SectionSubjectsPanel({
  sectionId,
  levelLabel,
  assigned,
  availableToAdd,
}: {
  sectionId: string;
  levelLabel: string | null;
  assigned: SectionSubjectChip[];
  availableToAdd: SectionSubjectChip[];
}) {
  const router = useRouter();
  const [pickerValue, setPickerValue] = useState<string>('');
  // Which language the Mother Tongue sub-choice currently has selected —
  // only meaningful while pickerValue === MOTHER_TONGUE_SENTINEL.
  const [motherTongueChoice, setMotherTongueChoice] = useState<string>('');

  // availableToAdd is already scoped to this section's level (built from
  // subject_level_offerings server-side), so a Primary section past P5
  // simply never has Mandarin in this list — Filipino-only there
  // naturally degrades to a single-option sub-choice, no separate P6
  // special-case needed here (matches the existing server-side 422 gate).
  const motherTongueOptions = availableToAdd.filter((s) =>
    isMotherTongueCode(s.code)
  );
  const otherOptions = availableToAdd.filter(
    (s) => !isMotherTongueCode(s.code)
  );

  const addMutation = useMutation({
    mutationFn: (subjectConfigId: string) =>
      apiFetch(
        `/api/sections/${sectionId}/subjects`,
        jsonInit('POST', { subjectConfigId })
      ),
    onSuccess: () => {
      setPickerValue('');
      setMotherTongueChoice('');
      router.refresh();
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : 'Could not add subject'),
  });

  const removeMutation = useMutation({
    mutationFn: (subjectConfigId: string) =>
      apiFetch(`/api/sections/${sectionId}/subjects/${subjectConfigId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => router.refresh(),
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : 'Could not remove subject'),
  });

  const loadDefaultsMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ inserted: number }>(
        `/api/sections/${sectionId}/subjects/load-defaults`,
        jsonInit('POST', {})
      ),
    onSuccess: (json) => {
      const n = json?.inserted ?? 0;
      toast.success(
        n > 0
          ? `Loaded ${n} default subject${n === 1 ? '' : 's'}.`
          : 'Already fully loaded — nothing to add.'
      );
      router.refresh();
    },
    onError: (e) =>
      toast.error(
        e instanceof Error ? e.message : 'Could not load default subjects'
      ),
  });

  const total = assigned.length + availableToAdd.length;

  return (
    <Card className="@container/card gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
          <BookOpen className="size-4" />
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Subjects for this section
          </p>
          <p className="font-serif text-[16px] font-semibold text-foreground">
            {assigned.length} of {total} configured
            {levelLabel ? ` for ${levelLabel}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {availableToAdd.length > 0 && (
            <Select
              value={pickerValue}
              onValueChange={(v) => {
                setPickerValue(v);
                if (v === MOTHER_TONGUE_SENTINEL) {
                  // Umbrella pick — don't attach yet, surface the
                  // language sub-choice below instead.
                  setMotherTongueChoice(
                    motherTongueOptions[0]?.subjectConfigId ?? ''
                  );
                  return;
                }
                addMutation.mutate(v);
              }}
            >
              <SelectTrigger
                className="h-8 w-auto gap-1.5 text-xs"
                disabled={addMutation.isPending}
              >
                {addMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Plus className="size-3.5" />
                )}
                <SelectValue placeholder="Add subject" />
              </SelectTrigger>
              <SelectContent>
                {otherOptions.map((s) => (
                  <SelectItem key={s.subjectConfigId} value={s.subjectConfigId}>
                    <span className="font-mono text-xs">{s.code}</span>
                    <span className="ml-2 text-muted-foreground">{s.name}</span>
                  </SelectItem>
                ))}
                {motherTongueOptions.length > 0 && (
                  <SelectItem value={MOTHER_TONGUE_SENTINEL}>
                    <Languages className="size-3.5 text-muted-foreground" />
                    <span>Mother Tongue</span>
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={
              availableToAdd.length === 0 || loadDefaultsMutation.isPending
            }
            onClick={() => loadDefaultsMutation.mutate()}
          >
            {loadDefaultsMutation.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            Load default subject set
          </Button>
        </div>
      </div>

      {pickerValue === MOTHER_TONGUE_SENTINEL && (
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/40 px-5 py-3">
          <Label className="shrink-0 text-xs text-muted-foreground">
            Mother Tongue — choose a language
          </Label>
          <RadioGroup
            value={motherTongueChoice}
            onValueChange={setMotherTongueChoice}
            className="flex flex-row flex-wrap items-center gap-4"
          >
            {motherTongueOptions.map((s) => (
              <label
                key={s.subjectConfigId}
                className="flex items-center gap-1.5 text-xs font-medium text-foreground"
              >
                <RadioGroupItem value={s.subjectConfigId} />
                {s.name}
              </label>
            ))}
          </RadioGroup>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                setPickerValue('');
                setMotherTongueChoice('');
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              disabled={!motherTongueChoice || addMutation.isPending}
              onClick={() => addMutation.mutate(motherTongueChoice)}
            >
              {addMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" />
              )}
              Add
            </Button>
          </div>
        </div>
      )}

      {assigned.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-5 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            No subjects assigned yet — grading sheets won&apos;t be generated
            for this section until subjects are loaded.
          </p>
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            disabled={
              availableToAdd.length === 0 || loadDefaultsMutation.isPending
            }
            onClick={() => loadDefaultsMutation.mutate()}
          >
            {loadDefaultsMutation.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            Load default subject set
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5 px-5 py-4">
          {assigned.map((s) => (
            <span
              key={s.subjectConfigId}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card py-1 pl-2 pr-1 text-xs font-medium text-foreground"
            >
              <span className="font-mono text-[10px] text-muted-foreground">
                {s.code}
              </span>
              {s.name}
              {isMotherTongueCode(s.code) && (
                <Badge variant="outline" className="h-4 px-1 text-[9px]">
                  Mother Tongue
                </Badge>
              )}
              {!s.isExaminable && (
                <Badge variant="muted" className="h-4 px-1 text-[9px]">
                  Non-exam
                </Badge>
              )}
              <button
                type="button"
                aria-label={`Remove ${s.name} from this section`}
                className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-50"
                disabled={removeMutation.isPending}
                onClick={() => removeMutation.mutate(s.subjectConfigId)}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}
