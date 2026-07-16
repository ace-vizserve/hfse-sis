'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { Layers, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';

import { apiFetch, jsonInit, ApiError } from '@/lib/query/fetcher';
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
export type AttachSection = { id: string; name: string; levelCode: string };

export function AttachToSectionModal({
  open,
  onOpenChange,
  subjects,
  sections,
  onAttached,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subjects: AttachSubject[];
  sections: AttachSection[];
  /** Fired after at least one section was successfully attached to — the
   * catalog table uses this to clear its checkbox selection. */
  onAttached: () => void;
}) {
  const router = useRouter();
  const [selectedSectionIds, setSelectedSectionIds] = useState<Set<string>>(
    new Set()
  );
  const [search, setSearch] = useState('');

  // Fresh section pick + search every time the modal is opened for a new
  // subject selection — this component stays mounted (open toggles), so
  // state doesn't naturally reset on its own. Reset happens during render
  // (React's sanctioned "adjusting state on prop change" pattern) rather
  // than in an effect, which would commit one stale-state render before
  // clearing — this bails out of that render instead.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSelectedSectionIds(new Set());
      setSearch('');
    }
  }

  const filteredSections = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sections;
    return sections.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.levelCode.toLowerCase().includes(q)
    );
  }, [sections, search]);

  function toggleSection(id: string) {
    setSelectedSectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
      <DialogContent className="sm:max-w-md">
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
          {sections.length > 0 && (
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

          {sections.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No sections at this level yet — create one first.
            </p>
          ) : filteredSections.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No sections match &ldquo;{search}&rdquo;.
            </p>
          ) : (
            <div className="grid max-h-64 grid-cols-2 gap-1.5 overflow-y-auto pr-1">
              {filteredSections.map((s) => {
                const checked = selectedSectionIds.has(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    onClick={() => toggleSection(s.id)}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm transition-colors',
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
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                      {s.levelCode}
                    </span>
                  </button>
                );
              })}
            </div>
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
