'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { ChevronRight, ListTree, Loader2 } from 'lucide-react';
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

// Step ② "Assign to sections" — the real UI (Task 3 of the "Unified
// Subject Setup page" plan; docs:
// C:\Users\Ace\.claude\plans\my-bad-its-not-graceful-creek.md). Task 1
// shipped a stub here; Task 2 built Step ①'s SubjectCatalogCard, which
// this deliberately does not touch or reuse UI from.
//
// Two complementary mechanisms, per the plan's design decisions:
//   1. Bulk "Flag selected as Global/Standard" — sets `class_type` AND
//      additively bulk-attaches the resolved bundle, for several sections
//      at once. Behind an AlertDialog confirm naming the resolved section
//      count + a per-level-group bundle preview (Standard sections at
//      different levels can resolve to different bundles since Task 3's
//      HIST/HUM fix — the preview reflects that, not one generic list).
//   2. Per-section lazy-expand → `SectionSubjectChecklist` — the
//      fine-grained view/adjustment surface underneath, whether a section
//      was just bulk-flagged or needs individual attention.
// Neither ever opens a further dialog from within itself.

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
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [bulkClassType, setBulkClassType] = useState<SectionClassType | null>(
    null
  );

  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedSections = sections.filter((s) => selectedIds.has(s.id));

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

        {levelType === 'secondary' && (
          <div className="flex shrink-0 items-center gap-2">
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
          </div>
        )}
      </div>

      {sections.length === 0 ? (
        <div className="border-t border-border px-5 py-10 text-center text-sm text-muted-foreground">
          No sections at this level yet.
        </div>
      ) : (
        <div className="divide-y divide-border border-t border-border">
          {sections.map((section) => {
            const isExpanded = expandedIds.has(section.id);
            const bundleSize = section.classType
              ? resolveTrackBundle(section.classType, section.levelCode).length
              : null;
            const recommendedAttachedCount = section.subjects.filter(
              (s) => s.attached && s.recommended
            ).length;
            const attachedCount = section.subjects.filter(
              (s) => s.attached
            ).length;

            return (
              <div key={section.id}>
                <div className="flex items-center gap-3 px-5 py-3">
                  {levelType === 'secondary' && (
                    <Checkbox
                      checked={selectedIds.has(section.id)}
                      onCheckedChange={(v) =>
                        toggleSelected(section.id, v === true)
                      }
                      aria-label={`Select ${section.name} for bulk track-flag`}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => toggleExpanded(section.id)}
                    aria-expanded={isExpanded}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <ChevronRight
                      className={cn(
                        'size-4 shrink-0 text-muted-foreground transition-transform',
                        isExpanded && 'rotate-90'
                      )}
                    />
                    <span className="truncate font-serif text-[15px] font-semibold text-foreground">
                      {section.name}
                    </span>
                    {levelType === 'secondary' &&
                      (section.classType ? (
                        <Badge variant="secondary" className="shrink-0">
                          {section.classType}
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="shrink-0 text-muted-foreground"
                        >
                          Unflagged
                        </Badge>
                      ))}
                    <span className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                      {bundleSize !== null
                        ? `${recommendedAttachedCount} of ${bundleSize} recommended`
                        : `${attachedCount} attached`}
                    </span>
                  </button>
                </div>

                {isExpanded && (
                  <SectionSubjectChecklist
                    section={section}
                    levelType={levelType}
                  />
                )}
              </div>
            );
          })}
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
