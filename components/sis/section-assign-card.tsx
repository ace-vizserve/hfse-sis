'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Circle,
  ListTree,
  Loader2,
  MousePointerClick,
} from 'lucide-react';
import { toast } from 'sonner';

import { apiFetch, jsonInit, ApiError } from '@/lib/query/fetcher';
import type { SectionClassType } from '@/lib/schemas/section';
import { resolveTrackBundle } from '@/lib/sis/track-bundles';
import type { SectionWithSubjectsRow } from '@/lib/sis/subjects/queries';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { SectionSubjectChecklist } from '@/components/sis/section-subject-checklist';
import { cn } from '@/lib/utils';

// Step ② "Assign to sections" — Task 3 of the "Unified Subject Setup page"
// plan (docs: C:\Users\Ace\.claude\plans\my-bad-its-not-graceful-creek.md),
// reshaped after live review: a level with a normal section count (10-20+
// for Primary) turned into a wall of stacked, individually-expandable cards
// — compacting each card's *content* didn't fix that, because the problem
// was the page SHAPE, not the density. This is a master-detail layout
// instead: a compact scrollable list on the left, ONE section's checklist
// in a fixed pane on the right. Selecting a different section REPLACES the
// pane's content instead of adding another expanded block underneath — the
// page can never grow past "list + one detail pane," no matter how many
// sections exist.
//
// Two complementary mechanisms, per the plan's design decisions (unchanged
// by the relayout): bulk "Flag selected as Global/Standard" (Secondary) /
// "Attach subjects to selected sections" (Primary, reuses the existing
// load-defaults route) operate on the LEFT rail's checkboxes, independent
// of which section is currently shown in the detail pane. Neither ever
// opens a further dialog from within itself.

function groupBundlePreviews(
  classType: SectionClassType,
  sections: SectionWithSubjectsRow[]
): Array<{
  levelCodes: string[];
  sectionNames: string[];
  bundle: readonly string[];
}> {
  const byBundleKey = new Map<
    string,
    {
      levelCodes: Set<string>;
      sectionNames: string[];
      bundle: readonly string[];
    }
  >();
  for (const s of sections) {
    const bundle = resolveTrackBundle(classType, s.levelCode);
    const key = bundle.join('|');
    const entry = byBundleKey.get(key) ?? {
      levelCodes: new Set<string>(),
      sectionNames: [],
      bundle,
    };
    entry.levelCodes.add(s.levelCode);
    entry.sectionNames.push(s.name);
    byBundleKey.set(key, entry);
  }
  return Array.from(byBundleKey.values()).map((e) => ({
    levelCodes: Array.from(e.levelCodes).sort(),
    sectionNames: e.sectionNames,
    bundle: e.bundle,
  }));
}

// The one question this whole step exists to answer: is this class ready
// to grade? A section is measured against its track bundle when it has
// one (Secondary, class_type set); otherwise against every catalog
// subject offered at its level (Primary has no track concept, so "the
// bundle" is just "everything this level offers"). Shown as a status icon
// per section in the left rail so a registrar can scan the whole list and
// see what's actually left to do, without opening each one.
type SectionStatus = 'done' | 'partial' | 'not-started';

function sectionCompletionStatus(
  section: SectionWithSubjectsRow,
  levelType: 'primary' | 'secondary'
): { status: SectionStatus; numerator: number; denominator: number } {
  const bundleSize =
    levelType === 'secondary' && section.classType
      ? resolveTrackBundle(section.classType, section.levelCode).length
      : null;
  const denominator = bundleSize ?? section.subjects.length;
  const numerator =
    bundleSize !== null
      ? section.subjects.filter((s) => s.attached && s.recommended).length
      : section.subjects.filter((s) => s.attached).length;

  const status: SectionStatus =
    denominator === 0 || numerator === 0
      ? 'not-started'
      : numerator >= denominator
        ? 'done'
        : 'partial';

  return { status, numerator, denominator };
}

const STATUS_ICON: Record<SectionStatus, React.ReactNode> = {
  done: <CheckCircle2 className="size-3.5 shrink-0 text-brand-mint" />,
  partial: <AlertTriangle className="size-3.5 shrink-0 text-brand-amber" />,
  'not-started': (
    <Circle className="size-3.5 shrink-0 text-muted-foreground/40" />
  ),
};

export function SectionAssignCard({
  sections,
  levelLabel,
}: {
  sections: SectionWithSubjectsRow[];
  levelLabel: string;
}) {
  const router = useRouter();
  const levelType =
    levelLabel.toLowerCase() === 'secondary' ? 'secondary' : 'primary';

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkClassType, setBulkClassType] = useState<SectionClassType | null>(
    null
  );
  // The one section shown in the detail pane — defaults to the first so
  // the pane is never empty on first load. Distinct from `selectedIds`
  // (the bulk-action checkboxes) on purpose: "which section am I looking
  // at" and "which sections should the bulk button act on" are different
  // questions an admin can answer independently.
  const [activeId, setActiveId] = useState<string | null>(
    sections[0]?.id ?? null
  );

  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const selectedSections = sections.filter((s) => selectedIds.has(s.id));
  const activeSection = sections.find((s) => s.id === activeId) ?? null;

  const bulkApplyMutation = useMutation({
    // Fan out one POST per selected section (reuses the existing per-
    // section track route — no new bulk API surface), sequential to keep
    // this simple and match GenerateAllIndexButton's established
    // aggregate-then-summarize pattern for this exact kind of "one action,
    // N section ids" bulk flow.
    mutationFn: async (classType: SectionClassType) => {
      let successCount = 0;
      const errors: string[] = [];
      for (const s of selectedSections) {
        try {
          await apiFetch(
            `/api/sections/${s.id}/track`,
            jsonInit('POST', { class_type: classType })
          );
          successCount++;
        } catch (e) {
          const detail =
            e instanceof ApiError && e.body && typeof e.body === 'object'
              ? (e.body as { error?: string }).error
              : undefined;
          errors.push(`${s.name}: ${detail ?? 'failed'}`);
        }
      }
      return { successCount, errors };
    },
    onSuccess: ({ successCount, errors }, classType) => {
      if (successCount > 0) {
        toast.success(
          `Flagged ${successCount} section${successCount === 1 ? '' : 's'} as ${classType}`
        );
      }
      if (errors.length > 0) {
        toast.error(
          `${errors.length} section${errors.length === 1 ? '' : 's'} failed`,
          { description: errors.join('\n') }
        );
      }
      setBulkClassType(null);
      setSelectedIds(new Set());
      if (successCount > 0) router.refresh();
    },
    onError: () => {
      toast.error('Could not flag the selected sections');
    },
  });
  const bulkBusy = bulkApplyMutation.isPending;

  function handleBulkConfirm(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    if (!bulkClassType) return;
    bulkApplyMutation.mutate(bulkClassType);
  }

  // Primary has no Global/Standard track — its equivalent of the bulk
  // flag-buttons is "attach everything offered here that isn't already,"
  // one click across every selected section, reusing the existing
  // load-defaults route (pre-existing, additive-only, same as every other
  // section_subjects write path) instead of forcing one-by-one expand +
  // check per section.
  const bulkLoadDefaultsMutation = useMutation({
    mutationFn: async () => {
      let sectionCount = 0;
      let sheetCount = 0;
      const errors: string[] = [];
      for (const s of selectedSections) {
        try {
          const result = (await apiFetch(
            `/api/sections/${s.id}/subjects/load-defaults`,
            jsonInit('POST', {})
          )) as { inserted?: number; sheetsInserted?: number };
          if ((result.inserted ?? 0) > 0) sectionCount++;
          sheetCount += result.sheetsInserted ?? 0;
        } catch (e) {
          const detail =
            e instanceof ApiError && e.body && typeof e.body === 'object'
              ? (e.body as { error?: string }).error
              : undefined;
          errors.push(`${s.name}: ${detail ?? 'failed'}`);
        }
      }
      return { sectionCount, sheetCount, errors };
    },
    onSuccess: ({ sectionCount, sheetCount, errors }) => {
      if (sectionCount > 0) {
        toast.success(
          `Attached subjects to ${sectionCount} section${sectionCount === 1 ? '' : 's'}` +
            (sheetCount > 0
              ? ` — ${sheetCount} new sheet${sheetCount === 1 ? '' : 's'}`
              : '')
        );
      } else if (errors.length === 0) {
        toast.info('Everything selected already has its subjects attached');
      }
      if (errors.length > 0) {
        toast.error(
          `${errors.length} section${errors.length === 1 ? '' : 's'} failed`,
          { description: errors.join('\n') }
        );
      }
      setSelectedIds(new Set());
      if (sectionCount > 0) router.refresh();
    },
    onError: () => {
      toast.error('Could not attach subjects to the selected sections');
    },
  });

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-center gap-3 px-5 pb-4 pt-5">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
          <ListTree className="size-4" />
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            ② Assign to sections
          </p>
          <p className="truncate font-serif text-[16px] font-semibold text-foreground">
            {levelLabel} sections
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {levelType === 'secondary' ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={selectedIds.size === 0}
                onClick={() => setBulkClassType('Global')}
              >
                Flag selected as Global
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={selectedIds.size === 0}
                onClick={() => setBulkClassType('Standard')}
              >
                Flag selected as Standard
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={
                selectedIds.size === 0 || bulkLoadDefaultsMutation.isPending
              }
              onClick={() => bulkLoadDefaultsMutation.mutate()}
            >
              {bulkLoadDefaultsMutation.isPending && (
                <Loader2 className="size-3.5 animate-spin" />
              )}
              Attach subjects to selected sections
            </Button>
          )}
        </div>
      </div>

      {sections.length === 0 ? (
        <div className="border-t border-border px-5 py-10 text-center text-sm text-muted-foreground">
          No sections at this level yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 border-t border-border md:grid-cols-[minmax(220px,280px)_1fr]">
          {/* LEFT — compact section list, always the same height regardless
              of how many are "expanded" (there's no per-row expand anymore
              — clicking a row swaps the detail pane instead). */}
          <div className="max-h-[32rem] divide-y divide-border overflow-y-auto border-b border-border md:max-h-[40rem] md:border-b-0 md:border-r">
            {sections.map((section) => {
              const isActive = section.id === activeId;
              const { status, numerator, denominator } =
                sectionCompletionStatus(section, levelType);

              return (
                <div
                  key={section.id}
                  className={cn(
                    'flex items-center gap-2.5 px-3 py-2',
                    isActive && 'bg-accent'
                  )}
                >
                  <Checkbox
                    checked={selectedIds.has(section.id)}
                    onCheckedChange={(v) =>
                      toggleSelected(section.id, v === true)
                    }
                    aria-label={`Select ${section.name} for bulk assignment`}
                  />
                  <button
                    type="button"
                    onClick={() => setActiveId(section.id)}
                    aria-pressed={isActive}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    {STATUS_ICON[status]}
                    <div className="min-w-0 flex-1 leading-tight">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            'truncate font-serif text-sm',
                            isActive
                              ? 'font-semibold text-accent-foreground'
                              : 'font-medium text-foreground'
                          )}
                        >
                          {section.name}
                        </span>
                        {levelType === 'secondary' &&
                          (section.classType ? (
                            <Badge
                              variant="secondary"
                              className="h-4 shrink-0 px-1 text-[9px]"
                            >
                              {section.classType[0]}
                            </Badge>
                          ) : null)}
                      </div>
                      <p className="truncate font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                        {status === 'done'
                          ? 'Ready'
                          : `${numerator} of ${denominator} ready`}
                      </p>
                    </div>
                    <ChevronRight
                      className={cn(
                        'size-3.5 shrink-0 text-muted-foreground/60',
                        isActive && 'text-accent-foreground'
                      )}
                    />
                  </button>
                </div>
              );
            })}
          </div>

          {/* RIGHT — the active section's checklist, and only the active
              one. Clicking a different row on the left replaces this pane
              instead of adding a second block below it. */}
          <div className="min-w-0">
            {activeSection ? (
              <>
                <div className="flex items-center gap-2 border-b border-dashed border-border px-5 py-3">
                  <span className="font-serif text-base font-semibold text-foreground">
                    {activeSection.name}
                  </span>
                  {levelType === 'secondary' && (
                    <Badge
                      variant={
                        activeSection.classType ? 'secondary' : 'outline'
                      }
                      className={cn(
                        'shrink-0',
                        !activeSection.classType && 'text-muted-foreground'
                      )}
                    >
                      {activeSection.classType ?? 'Unflagged'}
                    </Badge>
                  )}
                </div>
                <SectionSubjectChecklist
                  section={activeSection}
                  levelType={levelType}
                />
              </>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 px-5 py-16 text-center">
                <MousePointerClick className="size-5 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Select a section from the list to manage its subjects.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <AlertDialog
        open={bulkClassType !== null}
        onOpenChange={(open) => {
          if (!open && !bulkBusy) setBulkClassType(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Flag {selectedIds.size} section{selectedIds.size === 1 ? '' : 's'}{' '}
              as {bulkClassType}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Sets the track and additively attaches its subject bundle —
              existing attachments are never removed, and sheets generate
              automatically for anything newly attached.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {bulkClassType && (
            <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
              {groupBundlePreviews(bulkClassType, selectedSections).map(
                (group, i) => (
                  <div key={i}>
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                      {group.levelCodes.join('/')} — {group.sectionNames.length}{' '}
                      section{group.sectionNames.length === 1 ? '' : 's'} (
                      {group.sectionNames.join(', ')})
                    </p>
                    <p className="text-foreground">{group.bundle.join(', ')}</p>
                  </div>
                )
              )}
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkConfirm} disabled={bulkBusy}>
              {bulkBusy && <Loader2 className="mr-1 size-3.5 animate-spin" />}
              Flag {selectedIds.size} section{selectedIds.size === 1 ? '' : 's'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
