'use client';

import { useMutation } from '@tanstack/react-query';
import { Layers, Loader2, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiError, apiFetch, jsonInit } from '@/lib/query/fetcher';
import { cn } from '@/lib/utils';

// AttachToSectionModal — the ONE confirm step in the simplified Subject
// Setup flow: check subjects on the catalog table, click "Attach to
// section," pick section(s) here, confirm. Fans out one
// POST /api/sections/[id]/subjects/attach-many per picked section (that
// route bulk-attaches the whole selected subject list AND silently
// ensures the section's level is marked as offering each subject — the
// simplified page has no separate "Offered" step for the user to do
// first). Mirrors the sequential-fan-out + aggregate-then-toast pattern
// already used by every other bulk action on this page's predecessor
// (SectionAssignCard's bulk mutations).

export type AttachSubject = {
  subjectConfigId: string;
  code: string;
  name: string;
};
export type AttachSection = {
  id: string;
  name: string;
  levelCode: string;
  levelType: 'primary' | 'secondary';
};

export function AttachToSectionModal({
  open,
  onOpenChange,
  subjects,
  sections,
  defaultLevelType,
  onAttached,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subjects: AttachSubject[];
  /** Every section, both level types — the dialog picks its own level
   * internally (level first, then that level's sections), independent of
   * whichever catalog tab is active on the page behind it. */
  sections: AttachSection[];
  /** Which level's sections to show pre-selected when the dialog opens —
   * the catalog tab the subjects were checked from. Still switchable. */
  defaultLevelType: 'primary' | 'secondary';
  /** Fired after at least one section was successfully attached to — the
   * catalog table uses this to clear its checkbox selection. */
  onAttached: () => void;
}) {
  const router = useRouter();
  const [selectedSectionIds, setSelectedSectionIds] = useState<Set<string>>(
    new Set()
  );
  const [search, setSearch] = useState('');
  const [sectionLevelType, setSectionLevelType] = useState(defaultLevelType);
  // Which single level (P1, S3, …) is currently drilled into — null until
  // a level is picked, at which point `effectiveLevelCode` below falls
  // back to the first level with sections for the active type.
  const [selectedLevelCode, setSelectedLevelCode] = useState<string | null>(
    null
  );

  // Fresh section pick + search + level every time the modal is opened for
  // a new subject selection — this component stays mounted (open toggles),
  // so state doesn't naturally reset on its own. Reset happens during
  // render (React's sanctioned "adjusting state on prop change" pattern)
  // rather than in an effect, which would commit one stale-state render
  // before clearing — this bails out of that render instead.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSelectedSectionIds(new Set());
      setSearch('');
      setSectionLevelType(defaultLevelType);
      setSelectedLevelCode(null);
    }
  }

  const sectionsAtLevel = useMemo(
    () => sections.filter((s) => s.levelType === sectionLevelType),
    [sections, sectionLevelType]
  );

  const filteredSections = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sectionsAtLevel;
    return sectionsAtLevel.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.levelCode.toLowerCase().includes(q)
    );
  }, [sectionsAtLevel, search]);

  // Drill-down step: which levels exist for the active type (P1..P6 /
  // S1..S4), each with its own section count + how many of its sections
  // are already selected (so switching levels doesn't lose track of picks
  // made elsewhere). Derived from `sectionsAtLevel`, not the search-filtered
  // list — the level picker itself stays stable while typing; only the
  // section list below it is search-scoped (see the flat search branch in
  // the render below).
  const levelsAtType = useMemo(() => {
    const byLevel = new Map<string, AttachSection[]>();
    for (const s of sectionsAtLevel) {
      const arr = byLevel.get(s.levelCode);
      if (arr) arr.push(s);
      else byLevel.set(s.levelCode, [s]);
    }
    return Array.from(byLevel.entries())
      .map(([code, group]) => ({
        code,
        count: group.length,
        selectedCount: group.filter((s) => selectedSectionIds.has(s.id)).length,
      }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [sectionsAtLevel, selectedSectionIds]);

  // Falls back to the first available level whenever the explicit pick is
  // missing or no longer valid (fresh open, or a level-type switch whose
  // levels don't include the previously picked code) — a plain computed
  // value, so no extra state-correction render is needed.
  const effectiveLevelCode =
    (selectedLevelCode &&
      levelsAtType.some((l) => l.code === selectedLevelCode) &&
      selectedLevelCode) ||
    levelsAtType[0]?.code ||
    null;

  const sectionsForActiveLevel = useMemo(
    () => sectionsAtLevel.filter((s) => s.levelCode === effectiveLevelCode),
    [sectionsAtLevel, effectiveLevelCode]
  );

  function toggleSection(id: string) {
    setSelectedSectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleMany(ids: string[], checked: boolean) {
    setSelectedSectionIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  const isSearching = search.trim().length > 0;
  const activeLevelSelectedCount = sectionsForActiveLevel.filter((s) =>
    selectedSectionIds.has(s.id)
  ).length;

  const attachMutation = useMutation({
    mutationFn: async () => {
      const subjectConfigIds = subjects.map((s) => s.subjectConfigId);
      let sectionCount = 0;
      let sheetCount = 0;
      const errors: string[] = [];
      for (const sectionId of selectedSectionIds) {
        const section = sections.find((s) => s.id === sectionId);
        try {
          const result = (await apiFetch(
            `/api/sections/${sectionId}/subjects/attach-many`,
            jsonInit('POST', { subjectConfigIds })
          )) as { inserted?: number; sheetsInserted?: number };
          if ((result.inserted ?? 0) > 0) sectionCount++;
          sheetCount += result.sheetsInserted ?? 0;
        } catch (e) {
          const detail =
            e instanceof ApiError && e.body && typeof e.body === 'object'
              ? (e.body as { error?: string }).error
              : undefined;
          errors.push(`${section?.name ?? sectionId}: ${detail ?? 'failed'}`);
        }
      }
      return { sectionCount, sheetCount, errors };
    },
    onSuccess: ({ sectionCount, sheetCount, errors }) => {
      if (sectionCount > 0) {
        toast.success(
          `Attached ${subjects.length} subject${subjects.length === 1 ? '' : 's'} to ${sectionCount} section${sectionCount === 1 ? '' : 's'}` +
            (sheetCount > 0
              ? ` — ${sheetCount} new sheet${sheetCount === 1 ? '' : 's'}`
              : '')
        );
      }
      if (errors.length > 0) {
        toast.error(
          `${errors.length} section${errors.length === 1 ? '' : 's'} failed`,
          { description: errors.join('\n') }
        );
      }
      if (sectionCount > 0) {
        onAttached();
        router.refresh();
      }
      if (errors.length === 0) onOpenChange(false);
    },
    onError: () => {
      toast.error('Could not attach subjects to the selected sections');
    },
  });
  const busy = attachMutation.isPending;

  const maxSheets = subjects.length * selectedSectionIds.size * 4;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="size-5 text-primary" />
            Attach {subjects.length} subject{subjects.length === 1 ? '' : 's'}
          </DialogTitle>
          <DialogDescription>
            Pick the section(s) to attach these to. Creates a grading sheet for
            Term 1–4 wherever one doesn&apos;t already exist.
          </DialogDescription>
          {subjects.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {subjects.map((s) => (
                <span
                  key={s.subjectConfigId}
                  className="rounded-full bg-accent px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-accent-foreground"
                >
                  {s.code} {s.name}
                </span>
              ))}
            </div>
          )}
        </DialogHeader>

        <div className="space-y-3">
          {/* Level comes first — which sections show up below depends on
              it, so it's the first decision in the dialog, not a filter
              buried alongside search. */}
          <Tabs
            value={sectionLevelType}
            onValueChange={(v) =>
              setSectionLevelType(v as 'primary' | 'secondary')
            }
          >
            <TabsList
              variant="segmented"
              aria-label="Section level"
              className="w-full"
            >
              <TabsTrigger value="primary" className="flex-1">
                Primary
              </TabsTrigger>
              <TabsTrigger value="secondary" className="flex-1">
                Secondary
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {sectionsAtLevel.length > 0 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search sections…"
                className="pl-9"
              />
            </div>
          )}

          {sectionsAtLevel.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No {sectionLevelType} sections yet — create one first.
            </p>
          ) : isSearching ? (
            // Search bypasses the level drill-down entirely — a flat,
            // cross-level result list with each row's own level chip, so
            // a search hit outside the currently-picked level still shows
            // up instead of silently appearing empty.
            filteredSections.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No sections match &ldquo;{search}&rdquo;.
              </p>
            ) : (
              <div className="max-h-72 overflow-y-auto pr-1">
                <div className="flex flex-wrap gap-1.5">
                  {filteredSections.map((s) => (
                    <SectionToggleChip
                      key={s.id}
                      section={s}
                      checked={selectedSectionIds.has(s.id)}
                      onToggle={() => toggleSection(s.id)}
                      showLevelCode
                    />
                  ))}
                </div>
              </div>
            )
          ) : (
            <>
              {/* Step 1 of the drill-down: pick a level. Each pill carries
                  its section count and, once ≥1 of its sections is picked,
                  a small selected-count badge — so switching levels never
                  loses track of picks made elsewhere. */}
              <div className="flex flex-wrap gap-1.5">
                {levelsAtType.map((l) => {
                  const active = l.code === effectiveLevelCode;
                  return (
                    <button
                      key={l.code}
                      type="button"
                      onClick={() => setSelectedLevelCode(l.code)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors',
                        active
                          ? 'border-primary bg-accent text-accent-foreground'
                          : 'border-border text-muted-foreground hover:border-hairline-strong'
                      )}
                    >
                      {l.code}
                      <span className="font-mono text-[10px] font-normal text-muted-foreground">
                        {l.count}
                      </span>
                      {l.selectedCount > 0 && (
                        <span className="flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-semibold text-primary-foreground">
                          {l.selectedCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Step 2: that level's sections only. */}
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">
                  {activeLevelSelectedCount} of {sectionsForActiveLevel.length}{' '}
                  selected
                </span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      toggleMany(
                        sectionsForActiveLevel.map((s) => s.id),
                        true
                      )
                    }
                    className="font-medium text-primary hover:underline"
                  >
                    Select all {effectiveLevelCode}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      toggleMany(
                        sectionsForActiveLevel.map((s) => s.id),
                        false
                      )
                    }
                    className="font-medium text-muted-foreground hover:underline"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="max-h-56 overflow-y-auto pr-1">
                <div className="flex flex-wrap gap-1.5">
                  {sectionsForActiveLevel.map((s) => (
                    <SectionToggleChip
                      key={s.id}
                      section={s}
                      checked={selectedSectionIds.has(s.id)}
                      onToggle={() => toggleSection(s.id)}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {selectedSectionIds.size > 0 ? (
              <>
                Will create up to <strong>{maxSheets}</strong> grading sheet
                {maxSheets === 1 ? '' : 's'}
              </>
            ) : (
              'Pick at least one section'
            )}
          </span>
          <Button
            type="button"
            onClick={() => attachMutation.mutate()}
            disabled={selectedSectionIds.size === 0 || busy}
            className="gap-1.5"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            Attach to {selectedSectionIds.size || ''} section
            {selectedSectionIds.size === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Shared checkbox-styled chip for a single section — used by both the
// level-drilled list and the flat cross-level search results, so the two
// render paths can't visually drift.
function SectionToggleChip({
  section,
  checked,
  onToggle,
  showLevelCode,
}: {
  section: AttachSection;
  checked: boolean;
  onToggle: () => void;
  showLevelCode?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      className={cn(
        'flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-sm transition-colors',
        checked
          ? 'border-primary bg-accent text-accent-foreground'
          : 'border-border hover:border-hairline-strong'
      )}
    >
      <span
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded border',
          checked
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-hairline-strong'
        )}
      >
        {checked && (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-2.5"
          >
            <path d="M20 6L9 17l-5-5" />
          </svg>
        )}
      </span>
      <span className="truncate">{section.name}</span>
      {showLevelCode && (
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
          {section.levelCode}
        </span>
      )}
    </button>
  );
}
