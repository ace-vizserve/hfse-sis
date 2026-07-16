'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { Languages, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { MOTHER_TONGUE_SUBJECT_CODES } from '@/lib/schemas/subject';
import type { SectionClassType } from '@/lib/schemas/section';
import { resolveTrackBundle } from '@/lib/sis/track-bundles';
import type { SectionWithSubjectsRow } from '@/lib/sis/subjects/queries';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

// SectionSubjectChecklist — Step ② "Assign to sections"'s per-section
// full-catalog checklist (Task 3 of the "Unified Subject Setup page"
// plan; docs: C:\Users\Ace\.claude\plans\my-bad-its-not-graceful-creek.md).
// Genuinely NOT `SectionSubjectsPanel` reused — that component is a
// dropdown-add + chip-remove picker; this renders every catalog subject
// offered at this section's level as one checkbox row so an admin sees
// what's attached AND what's missing at a glance, with a "Recommended"
// tag (independent of checked state) driven by `resolveTrackBundle`. Only
// shares the underlying single-attach/detach ROUTES with that panel, not
// its UI. `SectionSubjectsPanel` itself is untouched — still used by the
// single-section detail page.
//
// Mounts only while its section is expanded (SectionAssignCard renders it
// conditionally, mirroring subject-catalog-card.tsx's inline-fix
// pattern) — so every piece of local state below re-derives cleanly from
// fresh props on each expand, no prop-sync effect needed while mounted.

function isMotherTongueCode(code: string): boolean {
  return (MOTHER_TONGUE_SUBJECT_CODES as readonly string[]).includes(code);
}

// Sentinel for the Mother-Tongue radio's "nothing attached" state — Radix
// RadioGroupItem rejects an empty-string value (same reasoning as
// SectionSubjectsPanel's MOTHER_TONGUE_SENTINEL), and this checklist
// additionally needs a way to CLEAR a language (SectionSubjectsPanel's
// picker is add-only; a section's already-attached Mother Tongue subject
// is only removable there via its chip's 'X', which this checklist has no
// equivalent of since Mother Tongue rows are deliberately excluded from
// the generic checkbox list below).
const MOTHER_TONGUE_NONE_SENTINEL = '__none__';

const TRACK_PREVIEW_OPTIONS: Array<{
  value: 'unflagged' | SectionClassType;
  label: string;
}> = [
  { value: 'unflagged', label: 'Unflagged' },
  { value: 'Global', label: 'Global' },
  { value: 'Standard', label: 'Standard' },
];

export function SectionSubjectChecklist({
  section,
  levelType,
}: {
  section: SectionWithSubjectsRow;
  levelType: 'primary' | 'secondary';
}) {
  const router = useRouter();

  // Per-section track PREVIEW selector — LOCAL STATE ONLY, initialized
  // from the section's persisted class_type. Selecting a value here
  // recomputes which rows below are tagged "Recommended" via the SAME
  // `resolveTrackBundle` the server uses; it never calls
  // POST /api/sections/[id]/track and never writes `section.class_type`.
  //
  // This is a deliberate design decision (see this task's report for the
  // full reasoning): the bulk "Flag selected as Global/Standard" buttons
  // in SectionAssignCard are the ONLY action that actually SETS a
  // section's track + bulk-attaches its bundle. This control lets an
  // admin preview "what would Standard look like here?" or correct their
  // own read of a lone odd section's fit, without triggering a bulk
  // attach they may not want yet — attaching/detaching individual
  // subjects always goes through the checkbox rows below, never through
  // this selector.
  const [previewClassType, setPreviewClassType] =
    useState<SectionClassType | null>(section.classType);

  const recommendedCodes = useMemo(
    () =>
      previewClassType
        ? new Set(resolveTrackBundle(previewClassType, section.levelCode))
        : null,
    [previewClassType, section.levelCode]
  );

  // Local optimistic "attached" set (Tier-1 optimistic per KD #24 —
  // snapshot-and-restore on error, not a setState-updater-derived
  // snapshot). Re-derives fresh on every mount since this component only
  // mounts while its section is expanded.
  const [attachedIds, setAttachedIds] = useState<Set<string>>(
    () =>
      new Set(
        section.subjects.filter((s) => s.attached).map((s) => s.subjectConfigId)
      )
  );
  const [pendingId, setPendingId] = useState<string | null>(null);

  const toggleMutation = useMutation({
    mutationFn: (vars: { subjectConfigId: string; attach: boolean }) =>
      vars.attach
        ? apiFetch(
            `/api/sections/${section.id}/subjects`,
            jsonInit('POST', { subjectConfigId: vars.subjectConfigId })
          )
        : apiFetch(
            `/api/sections/${section.id}/subjects/${vars.subjectConfigId}`,
            { method: 'DELETE' }
          ),
    onSuccess: () => router.refresh(),
  });

  function handleToggle(subjectConfigId: string, nextChecked: boolean) {
    const snapshot = new Set(attachedIds);
    setAttachedIds((prev) => {
      const next = new Set(prev);
      if (nextChecked) next.add(subjectConfigId);
      else next.delete(subjectConfigId);
      return next;
    });
    setPendingId(subjectConfigId);
    toggleMutation.mutate(
      { subjectConfigId, attach: nextChecked },
      {
        onError: (e) => {
          setAttachedIds(snapshot);
          toast.error(
            e instanceof Error ? e.message : 'Could not update this subject'
          );
        },
        onSettled: () => setPendingId(null),
      }
    );
  }

  // Mother Tongue stays a dedicated radio, never two more checkbox rows
  // (Filipino/Mandarin are mutually exclusive for a section). Excluded
  // from the generic list below entirely. Gated to sections where a
  // language is actually offered at THIS section's specific level —
  // reads `offeredAtThisLevel` (Task 3's addition to the loader) rather
  // than assuming every catalog subject is offered everywhere in the
  // level type (the verified MIXED case: Mandarin is P1-P5 only, not P6).
  // An already-attached language still shows even if it's since fallen
  // out of offering (data-drift safety net — never hide what's actually
  // attached).
  const motherTongueSubjects = section.subjects.filter(
    (s) =>
      isMotherTongueCode(s.code) &&
      (s.offeredAtThisLevel || attachedIds.has(s.subjectConfigId))
  );
  const genericSubjects = section.subjects.filter(
    (s) =>
      !isMotherTongueCode(s.code) &&
      (s.offeredAtThisLevel || attachedIds.has(s.subjectConfigId))
  );

  const motherTongueAttached = motherTongueSubjects.find((s) =>
    attachedIds.has(s.subjectConfigId)
  );

  const motherTongueMutation = useMutation({
    mutationFn: async (vars: {
      attachId: string | null;
      detachId: string | null;
    }) => {
      if (vars.attachId) {
        await apiFetch(
          `/api/sections/${section.id}/subjects`,
          jsonInit('POST', { subjectConfigId: vars.attachId })
        );
      }
      if (vars.detachId) {
        await apiFetch(
          `/api/sections/${section.id}/subjects/${vars.detachId}`,
          { method: 'DELETE' }
        );
      }
    },
    onSuccess: () => router.refresh(),
  });

  function handleMotherTongueChange(value: string) {
    const previousId = motherTongueAttached?.subjectConfigId ?? null;
    const nextId = value === MOTHER_TONGUE_NONE_SENTINEL ? null : value;
    if (nextId === previousId) return;

    const snapshot = new Set(attachedIds);
    setAttachedIds((prev) => {
      const next = new Set(prev);
      if (previousId) next.delete(previousId);
      if (nextId) next.add(nextId);
      return next;
    });
    motherTongueMutation.mutate(
      { attachId: nextId, detachId: previousId },
      {
        onError: (e) => {
          // This mutation is two sequential requests (attach THEN detach) —
          // unlike handleToggle's single-request mutation, a failure here
          // can be a PARTIAL failure (e.g. attach succeeded, the following
          // detach then threw). Reverting the local snapshot alone would
          // silently show the pre-mutation state while the server's
          // section_subjects rows may have actually drifted to something
          // that violates "at most one Mother Tongue language attached at a
          // time" (both attached, or neither). router.refresh() re-syncs
          // the UI to server truth so a partial failure surfaces instead of
          // hiding behind a stale-but-clean-looking snapshot.
          setAttachedIds(snapshot);
          router.refresh();
          toast.error(
            e instanceof Error ? e.message : 'Could not update Mother Tongue'
          );
        },
      }
    );
  }

  return (
    <div className="space-y-4 border-t border-dashed border-border p-5">
      {levelType === 'secondary' && (
        <div className="flex flex-wrap items-center gap-3">
          <Label className="shrink-0 text-xs text-muted-foreground">
            Preview track
          </Label>
          <Tabs
            value={previewClassType ?? 'unflagged'}
            onValueChange={(v) =>
              setPreviewClassType(
                v === 'unflagged' ? null : (v as SectionClassType)
              )
            }
          >
            <TabsList
              variant="segmented"
              aria-label="Preview recommended track"
            >
              {TRACK_PREVIEW_OPTIONS.map((opt) => (
                <TabsTrigger key={opt.value} value={opt.value}>
                  {opt.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <span className="text-xs text-muted-foreground">
            Only changes which rows below are tagged Recommended — doesn&apos;t
            attach or save anything by itself.
          </span>
        </div>
      )}

      {/* Compact toggle-chip grid, not a tall one-subject-per-row list —
          with 17+ sections on a level and every section carrying roughly
          the same subject set, a vertical list here is what turns the
          whole page into a wall of near-identical scrolling. A chip wraps
          typically 1-2 lines instead of 5-6. Four states, all visible on
          the chip itself: attached+recommended (filled, no extra mark),
          attached+not-recommended ("extra" tag — a leftover from a track
          flip, still real), unattached+recommended (dashed amber ring —
          a gap), unattached+not-recommended (plain outline). */}
      <div className="flex flex-wrap gap-1.5">
        {genericSubjects.map((s) => {
          const checked = attachedIds.has(s.subjectConfigId);
          const recommended = recommendedCodes?.has(s.code) ?? false;
          const busy =
            pendingId === s.subjectConfigId && toggleMutation.isPending;
          return (
            <button
              key={s.subjectConfigId}
              type="button"
              role="checkbox"
              aria-checked={checked}
              aria-label={`${s.name} — ${checked ? 'attached to' : 'not attached to'} ${section.name}`}
              disabled={busy}
              onClick={() => handleToggle(s.subjectConfigId, !checked)}
              title={s.name}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60',
                checked
                  ? 'border-brand-indigo/40 bg-accent text-accent-foreground'
                  : 'border-border bg-card text-muted-foreground hover:border-hairline-strong hover:text-foreground',
                !checked && recommended && 'border-dashed border-brand-amber/60'
              )}
            >
              <span className="font-mono text-[9px] uppercase tracking-[0.08em] opacity-70">
                {s.code}
              </span>
              {s.name}
              {checked && !recommended && (
                <span className="font-mono text-[8px] font-semibold uppercase tracking-[0.06em] text-brand-amber">
                  extra
                </span>
              )}
              {!checked && recommended && (
                <span
                  className="size-1.5 shrink-0 rounded-full bg-brand-amber"
                  aria-hidden
                />
              )}
              {busy && <Loader2 className="size-3 shrink-0 animate-spin" />}
            </button>
          );
        })}
        {genericSubjects.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No catalog subjects are offered at this section&apos;s level yet.
          </p>
        )}
      </div>

      {motherTongueSubjects.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2.5">
          <Languages className="size-3.5 shrink-0 text-muted-foreground" />
          <Label className="shrink-0 text-xs text-muted-foreground">
            Mother Tongue
          </Label>
          <RadioGroup
            value={
              motherTongueAttached?.subjectConfigId ??
              MOTHER_TONGUE_NONE_SENTINEL
            }
            onValueChange={handleMotherTongueChange}
            className="flex flex-row flex-wrap items-center gap-4"
          >
            <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <RadioGroupItem
                value={MOTHER_TONGUE_NONE_SENTINEL}
                disabled={motherTongueMutation.isPending}
              />
              None
            </label>
            {motherTongueSubjects.map((s) => (
              <label
                key={s.subjectConfigId}
                className="flex items-center gap-1.5 text-xs font-medium text-foreground"
              >
                <RadioGroupItem
                  value={s.subjectConfigId}
                  disabled={motherTongueMutation.isPending}
                />
                {s.name}
              </label>
            ))}
          </RadioGroup>
        </div>
      )}
    </div>
  );
}
