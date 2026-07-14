'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, FilePlus2, Loader2 } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { apiFetch, jsonInit, ApiError } from '@/lib/query/fetcher';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

// Rebuilt "Generate grading sheets" dialog for SIS Admin surfaces (Phase 4,
// AY-Setup redesign). Was a bare one-click confirm; now a real
// select-then-preview-then-generate flow so committing isn't a leap of
// faith — you see exactly which (section × subject × term) sheets will be
// created before generating, and a read-only summary of the weights that
// will be copied from subject_configs (KD #4 — weights stay edited only at
// /sis/admin/subjects, never here).
//
// Two scopes:
//   - AY scope      → /sis/ay-setup checklist row. Full picker: section
//                      multi-select + term multi-select, live preview.
//   - Section scope  → /sis/sections/[id] header button. One section, fixed;
//                      still shows the term picker + live preview + summary.
//
// Idempotent server-side (RPC uses ON CONFLICT DO NOTHING). Safe to re-run.

type Scope =
  | { kind: 'ay'; ayId: string; ayCode: string }
  | { kind: 'section'; sectionId: string; sectionLabel: string; ayId: string };

type PreviewSection = {
  id: string;
  name: string;
  levelLabel: string;
  subjectCount: number;
  toCreate: number;
  alreadyExists: number;
};
type PreviewSubject = {
  subjectConfigId: string;
  code: string;
  name: string;
  wwSlots: number;
  ptSlots: number;
  qaMax: number;
  wwWeight: number;
  ptWeight: number;
  qaWeight: number;
};
type PreviewTerm = { id: string; label: string; termNumber: number };
type PreviewResponse = {
  sections: PreviewSection[];
  subjects: PreviewSubject[];
  terms: PreviewTerm[];
  totals: { toCreate: number; alreadyExists: number };
};

function formatPct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

export function GenerateSheetsDialog({
  scope,
  children,
  open: openProp,
  onOpenChange,
}: {
  scope: Scope;
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;
  const setOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };

  // Full, unfiltered option list — fetched once per dialog open. Kept
  // separate from the (filtered) live preview below so narrowing the
  // selection never shrinks the checklist itself.
  const optionsQuery = useQuery({
    queryKey: ['grading-sheets-options', scope.ayId],
    queryFn: () =>
      apiFetch<PreviewResponse>(
        '/api/grading-sheets/bulk-create/preview',
        jsonInit('POST', {
          ay_id: scope.ayId,
          section_ids: scope.kind === 'section' ? [scope.sectionId] : undefined,
        })
      ),
    enabled: open,
  });

  const [selectedSectionIds, setSelectedSectionIds] = useState<string[]>([]);
  const [selectedTermIds, setSelectedTermIds] = useState<string[]>([]);

  // Seed selection once options arrive — sections + terms both default to
  // "all" (sections locked to the one section for section-scope; the term
  // checkboxes still render either way so a specific term can be excluded).
  useEffect(() => {
    if (!optionsQuery.data) return;
    setSelectedSectionIds(optionsQuery.data.sections.map((s) => s.id));
    setSelectedTermIds(optionsQuery.data.terms.map((t) => t.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsQuery.data]);

  const previewQuery = useQuery({
    queryKey: [
      'grading-sheets-preview',
      scope.ayId,
      scope.kind === 'section' ? scope.sectionId : selectedSectionIds,
      selectedTermIds,
    ],
    queryFn: () =>
      apiFetch<PreviewResponse>(
        '/api/grading-sheets/bulk-create/preview',
        jsonInit('POST', {
          ay_id: scope.ayId,
          section_ids:
            scope.kind === 'section'
              ? [scope.sectionId]
              : selectedSectionIds.length > 0
                ? selectedSectionIds
                : undefined,
          term_ids: selectedTermIds.length > 0 ? selectedTermIds : undefined,
        })
      ),
    enabled:
      open && (scope.kind === 'section' || selectedSectionIds.length > 0),
  });

  const generateMutation = useMutation({
    mutationFn: () => {
      const body =
        scope.kind === 'ay'
          ? {
              ay_id: scope.ayId,
              section_ids:
                selectedSectionIds.length > 0 ? selectedSectionIds : undefined,
              term_ids:
                selectedTermIds.length > 0 ? selectedTermIds : undefined,
            }
          : {
              section_id: scope.sectionId,
              term_ids:
                selectedTermIds.length > 0 ? selectedTermIds : undefined,
            };
      return apiFetch<{ inserted?: number }>(
        '/api/grading-sheets/bulk-create',
        jsonInit('POST', body)
      );
    },
    onSuccess: (json) => {
      const inserted = Number(json?.inserted ?? 0);
      const label = scope.kind === 'ay' ? scope.ayCode : scope.sectionLabel;

      if (inserted > 0) {
        toast.success(
          `Generated ${inserted.toLocaleString('en-SG')} sheet${inserted === 1 ? '' : 's'} for ${label}.`
        );
      } else {
        toast.info(
          `Nothing to generate — every selected sheet already exists.`
        );
      }

      setOpen(false);
      router.refresh();
    },
    onError: (e) => {
      const serverError =
        e instanceof ApiError && e.body && typeof e.body === 'object'
          ? (e.body as { error?: string }).error
          : undefined;
      toast.error(serverError ?? 'generation failed');
    },
  });
  const busy = generateMutation.isPending;

  const scopeLabel = scope.kind === 'ay' ? scope.ayCode : scope.sectionLabel;

  const defaultTrigger = (
    <Button type="button" size="sm" variant="outline" className="h-7 text-xs">
      <FilePlus2 className="mr-1 size-3" />
      Generate sheets
    </Button>
  );

  const preview = previewQuery.data;
  const loadingOptions = optionsQuery.isLoading;
  const loadingPreview = previewQuery.isFetching;
  const nothingSelected =
    (scope.kind === 'ay' && selectedSectionIds.length === 0) ||
    (optionsQuery.data !== undefined && selectedTermIds.length === 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setSelectedSectionIds([]);
          setSelectedTermIds([]);
        }
      }}
    >
      {(children || !isControlled) && (
        <DialogTrigger asChild>{children ?? defaultTrigger}</DialogTrigger>
      )}
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Generate grading sheets for {scopeLabel}?</DialogTitle>
          <DialogDescription>
            Creates one grading sheet per (section × subject × term). Safe to
            re-run — sheets that already exist are skipped.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {scope.kind === 'ay' && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                Sections ({selectedSectionIds.length} of{' '}
                {optionsQuery.data?.sections.length ?? 0} selected)
              </p>
              {loadingOptions ? (
                <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Loading sections…
                </div>
              ) : (
                <ScrollArea className="h-40 rounded-md border border-border">
                  <div className="divide-y divide-border">
                    {(optionsQuery.data?.sections ?? []).map((s) => (
                      <label
                        key={s.id}
                        className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-accent/40"
                      >
                        <Checkbox
                          checked={selectedSectionIds.includes(s.id)}
                          onCheckedChange={(checked) =>
                            setSelectedSectionIds((prev) =>
                              checked
                                ? [...prev, s.id]
                                : prev.filter((id) => id !== s.id)
                            )
                          }
                        />
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {s.levelLabel}
                          </span>{' '}
                          {s.name}
                        </span>
                        <Badge
                          variant="outline"
                          className="h-5 shrink-0 text-[10px]"
                        >
                          {s.subjectCount} subject
                          {s.subjectCount === 1 ? '' : 's'}
                        </Badge>
                      </label>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Terms
            </p>
            {loadingOptions ? (
              <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Loading terms…
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                {(optionsQuery.data?.terms ?? []).map((t) => (
                  <label
                    key={t.id}
                    className="flex cursor-pointer items-center gap-1.5 text-sm"
                  >
                    <Checkbox
                      checked={selectedTermIds.includes(t.id)}
                      onCheckedChange={(checked) =>
                        setSelectedTermIds((prev) =>
                          checked
                            ? [...prev, t.id]
                            : prev.filter((id) => id !== t.id)
                        )
                      }
                    />
                    {t.label}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Weights (read-only)
            </p>
            {loadingPreview && !preview ? (
              <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Loading…
              </div>
            ) : preview && preview.subjects.length > 0 ? (
              <div className="rounded-md border border-border">
                <ScrollArea className="max-h-40">
                  <div className="divide-y divide-border">
                    {preview.subjects.map((s) => (
                      <div
                        key={s.subjectConfigId}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs"
                      >
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {s.code}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {s.name}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          WW {s.wwSlots}×/{formatPct(s.wwWeight)} · PT{' '}
                          {s.ptSlots}×/{formatPct(s.ptWeight)} · QA {s.qaMax}/
                          {formatPct(s.qaWeight)}
                        </span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
                <div className="border-t border-border px-3 py-1.5">
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto gap-1 p-0 text-xs"
                    asChild
                  >
                    <Link href="/sis/admin/subjects" target="_blank">
                      Wrong? Edit in Subject weights{' '}
                      <ArrowUpRight className="size-3" />
                    </Link>
                  </Button>
                </div>
              </div>
            ) : (
              <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                No subjects in scope — assign subjects on the section(s) first.
              </p>
            )}
          </div>

          <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
            {loadingPreview && !preview ? (
              <span className="text-muted-foreground">Calculating…</span>
            ) : preview ? (
              <>
                <span className="font-semibold text-foreground">
                  {preview.totals.toCreate.toLocaleString('en-SG')}
                </span>{' '}
                sheet{preview.totals.toCreate === 1 ? '' : 's'} will be created
                {preview.totals.alreadyExists > 0 && (
                  <>
                    {' · '}
                    <span className="text-muted-foreground">
                      {preview.totals.alreadyExists.toLocaleString('en-SG')}{' '}
                      already exist and will be skipped
                    </span>
                  </>
                )}
                .
              </>
            ) : (
              <span className="text-muted-foreground">
                Select at least one section to preview.
              </span>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => generateMutation.mutate()}
            disabled={
              busy ||
              nothingSelected ||
              !preview ||
              preview.totals.toCreate === 0
            }
          >
            {busy && <Loader2 className="mr-1 size-4 animate-spin" />}
            Generate sheets
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
