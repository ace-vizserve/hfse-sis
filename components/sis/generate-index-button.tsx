'use client';

// Generate class index button — per-section + bulk variant.
//
// Triggers POST /api/sections/[id]/generate-index (B2 route) which numbers the
// non-withdrawn roster alphabetically by (last_name, first_name, middle_name) —
// active first, late enrollees kept at the bottom in arrival order. Withdrawn
// students keep their existing (retired) numbers forever — they are never
// touched and their numbers are never reused.
//
// The `termStarted` prop controls the dialog tone:
//   false → normal confirmation (green year setup path)
//   true  → escalated warning (mid-year, students may already know their numbers)
//
// This is an outline/secondary action — the primary CTA on each page is
// "New section" (list page) or "Generate sheets" (detail page). One primary
// CTA per view per design system §2.3.

import { useState } from 'react';
import { ArrowDownAZ, TriangleAlert } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit, ApiError } from '@/lib/query/fetcher';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Alert,
  AlertDescription,
  AlertIcon,
  AlertTitle,
} from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// What GET /api/sections/[id]/generate-index returns — the same computation the
// POST performs, run with p_dry_run so it writes nothing (migration 147).
type IndexPreview = {
  rows_renumbered: number;
  rows_changed: number;
  after: Array<{
    id: string;
    name: string;
    old_index: number | null;
    new_index: number;
  }>;
};

// ─── Controlled dialog (no trigger — caller owns open state) ─────────────────

export function GenerateIndexDialog({
  sectionId,
  sectionName,
  termStarted,
  open,
  onOpenChange,
}: {
  sectionId: string;
  sectionName: string;
  termStarted: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const generateMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ rows_changed?: number; rows_renumbered?: number }>(
        `/api/sections/${sectionId}/generate-index`,
        jsonInit('POST')
      ),
  });

  // Fetch the before→after map while the dialog is open, so the renumber is
  // something you read first rather than something you discover afterwards.
  // `staleTime: 0` because the roster can change between two openings, and the
  // whole value of this panel is that it matches what the next click will do.
  const preview = useQuery({
    queryKey: ['section-index-preview', sectionId],
    queryFn: () =>
      apiFetch<IndexPreview>(`/api/sections/${sectionId}/generate-index`),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
  });

  const moves = (preview.data?.after ?? []).filter(
    (r) => r.old_index !== r.new_index
  );
  const nothingChanges = preview.data?.rows_changed === 0;

  const run = useWriteAction();
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    await run(() => generateMutation.mutateAsync(), {
      pending: `Renumbering ${sectionName}…`,
      // Reports the students whose number actually MOVED, not the size of the
      // class. "Renumbered 28 students" after a click that shifted three was
      // the old behaviour, and it read as though the whole class had churned.
      // Falls back to rows_renumbered — the pre-147 field — rather than to 0.
      // If the code ships before the migration the old 1-arg RPC still
      // resolves and still writes, so a bare `?? 0` would announce "already
      // numbered this way" immediately after renumbering the whole class.
      // Falling back to the class size is merely the old, vaguer message.
      success: (body) => {
        const count: number = body.rows_changed ?? body.rows_renumbered ?? 0;
        if (count === 0) return `${sectionName} was already numbered this way`;
        return `Renumbered ${count} student${count === 1 ? '' : 's'} in ${sectionName}`;
      },
      // The original threw `body.error ?? 'Could not generate index numbers'`,
      // but its final fallback was 'Something went wrong' (for a non-Error).
      // ApiError.message already carries body.error; reproduce the route
      // fallback when the body lacks an error field.
      error: (err) => {
        const serverError =
          err instanceof ApiError && err.body && typeof err.body === 'object'
            ? (err.body as { error?: string }).error
            : undefined;
        return (
          serverError ??
          (err instanceof ApiError
            ? 'Could not generate index numbers'
            : 'Something went wrong')
        );
      },
      onResolved: () => onOpenChange(false),
    });
    setBusy(false);
  }

  function handleGenerate(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    void generate();
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Renumber {sectionName} A–Z?</AlertDialogTitle>
          <AlertDialogDescription>
            This numbers <strong>{sectionName}</strong> alphabetically by
            surname (last name, then first name). Students who joined after the
            year started go at the bottom in the order they arrived, and
            students who have left keep their number — it is never given to
            anyone else.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* What the click will actually do, before it does it. Generate works
            out the numbers from each student's name, the date they started,
            and the numbers set aside for students who left — so it can be
            confidently wrong, and clicking again just repeats the same answer.
            Reading the list first is the only way to catch that. */}
        {preview.isPending ? (
          <div className="space-y-2" aria-label="Working out the new numbers">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : preview.isError ? (
          <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
            Couldn&rsquo;t work out the new numbers just now. You can still
            generate, or close this and try again.
          </p>
        ) : nothingChanges ? (
          <div className="rounded-lg border border-brand-mint bg-brand-mint/30 p-3 text-sm text-ink">
            Nothing changes — everyone already has the number this would give
            them.
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              <strong className="font-medium text-foreground">
                {moves.length}
              </strong>{' '}
              of {preview.data?.rows_renumbered ?? 0} students get a different
              number.
            </p>
            <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead className="w-16 text-right">Now</TableHead>
                    <TableHead className="w-16 text-right">After</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {moves.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-foreground">
                        {r.name}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {r.old_index == null ? '—' : `#${r.old_index}`}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold tabular-nums text-foreground">
                        #{r.new_index}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {/* Only worth raising when something actually moves — the escalated
            warning over a no-op run was just noise. */}
        {termStarted && !nothingChanges && (
          <Alert variant="warning">
            <AlertIcon variant="warning">
              <TriangleAlert />
            </AlertIcon>
            <AlertTitle>School year is in session</AlertTitle>
            <AlertDescription>
              Students may already know their current numbers and teachers may
              call them by these during class. This renumbers{' '}
              <strong>everyone</strong> — it does not fill in gaps. The master
              list is permanent: a student who has left keeps their number, and
              nobody moves up into it. To correct one student, swap their number
              with another instead. Only renumber if the whole class was set up
              wrongly.
            </AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleGenerate}
            // Held until the preview paints: a click over the skeleton is the
            // blind renumber this whole panel exists to prevent. Nothing to do
            // also has no work worth offering. A FAILED preview still leaves it
            // live — not knowing what will happen is a reason to warn, not to
            // block.
            disabled={busy || preview.isPending || nothingChanges}
            variant={termStarted ? 'destructive' : 'default'}
          >
            Renumber
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Per-section ─────────────────────────────────────────────────────────────

type GenerateIndexButtonProps = {
  sectionId: string;
  sectionName: string;
  /** True when the AY's first term has started (today ≥ earliest term start_date). */
  termStarted: boolean;
  /** 'compact' omits the label text, useful in pill/card layouts. */
  variant?: 'default' | 'compact';
};

export function GenerateIndexButton({
  sectionId,
  sectionName,
  termStarted,
  variant = 'default',
}: GenerateIndexButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => setOpen(true)}
      >
        <ArrowDownAZ className="size-3.5" />
        {variant === 'default' && 'Renumber A–Z'}
      </Button>
      <GenerateIndexDialog
        sectionId={sectionId}
        sectionName={sectionName}
        termStarted={termStarted}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

// ─── Bulk (all sections in the current AY) ───────────────────────────────────

type GenerateAllIndexButtonProps = {
  /** All section ids + names for the current AY. */
  sections: Array<{ id: string; name: string }>;
  termStarted: boolean;
};

export function GenerateAllIndexButton({
  sections,
  termStarted,
}: GenerateAllIndexButtonProps) {
  const [open, setOpen] = useState(false);

  const generateAllMutation = useMutation({
    // Fan out one POST per section (reuses the per-section route so we need no
    // new bulk API endpoint). Sequential to avoid hammering the DB with
    // parallel writes across many sections; fast enough in practice (<200ms
    // per section). Aggregates per-section outcomes inside the mutationFn so
    // the partial-success summary is preserved.
    mutationFn: async () => {
      let successCount = 0;
      let studentsMoved = 0;
      let sectionsMoved = 0;
      const errors: string[] = [];
      for (const section of sections) {
        try {
          const body = await apiFetch<{
            rows_changed?: number;
            rows_renumbered?: number;
          }>(`/api/sections/${section.id}/generate-index`, jsonInit('POST'));
          successCount++;
          // Count what actually moved, so the toast agrees with the preview
          // the admin just read. Reporting sections ATTEMPTED said "Renumbered
          // 21 sections" under a panel that had just said three students in one
          // section would change. Pre-147 the field is absent and the count
          // stays at zero, which the wording below handles.
          const moved = body.rows_changed ?? 0;
          if (moved > 0) {
            studentsMoved += moved;
            sectionsMoved++;
          }
        } catch (err) {
          if (err instanceof ApiError) {
            const serverError =
              err.body && typeof err.body === 'object'
                ? (err.body as { error?: string }).error
                : undefined;
            errors.push(`${section.name}: ${serverError ?? 'failed'}`);
          } else {
            errors.push(`${section.name}: network error`);
          }
        }
      }
      return { successCount, studentsMoved, sectionsMoved, errors };
    },
  });

  // Per-section summary of what the bulk run would do. This is the higher-stakes
  // click of the two — one press renumbers every class in the year — so it gets
  // the same "read it before you do it" treatment, condensed to a count per
  // section because the full map across 21 rosters is not a dialog.
  //
  // Reads go out in small batches rather than all at once. The writes below are
  // sequential on purpose, and firing 21 authenticated requests — each running
  // a `security definer` RPC that builds two jsonb roster arrays — the instant
  // a dialog opens is the same pressure in the other direction. Batching keeps
  // the panel quick without the thundering herd, including on an open-then-
  // cancel, which re-fires the whole set (staleTime/gcTime are 0 because a
  // stale preview is worse than a slow one).
  //
  // A section whose preview fails is reported as unknown, never silently
  // counted as no-change.
  const previewAll = useQuery({
    queryKey: [
      'section-index-preview-all',
      sections.map((s) => s.id).join(','),
    ],
    queryFn: async () => {
      const BATCH = 6;
      const out: Array<{ name: string; changed: number; failed: boolean }> = [];
      for (let i = 0; i < sections.length; i += BATCH) {
        const batch = await Promise.all(
          sections.slice(i, i + BATCH).map(async (s) => {
            try {
              const data = await apiFetch<IndexPreview>(
                `/api/sections/${s.id}/generate-index`
              );
              return {
                name: s.name,
                changed: data.rows_changed,
                failed: false,
              };
            } catch {
              return { name: s.name, changed: 0, failed: true };
            }
          })
        );
        out.push(...batch);
      }
      return out;
    },
    enabled: open,
    staleTime: 0,
    gcTime: 0,
  });

  const previews = previewAll.data ?? [];
  const movingSections = previews.filter((p) => !p.failed && p.changed > 0);
  const failedPreviews = previews.filter((p) => p.failed);
  const totalMoving = movingSections.reduce((sum, p) => sum + p.changed, 0);
  const allQuiet =
    previews.length > 0 &&
    movingSections.length === 0 &&
    failedPreviews.length === 0;

  const run = useWriteAction();
  const [busy, setBusy] = useState(false);

  async function generateAll() {
    setBusy(true);
    await run(() => generateAllMutation.mutateAsync(), {
      pending: `Renumbering ${sections.length} section${sections.length === 1 ? '' : 's'}…`,
      // A partial run is two facts, and the failures carry a list only a
      // description can hold — so the error half is raised here and the
      // success half returned. An all-failure run returns `null` so nothing
      // green appears over a run where nothing worked.
      success: ({ successCount, studentsMoved, sectionsMoved, errors }) => {
        if (errors.length > 0) {
          toast.error(
            `${errors.length} section${errors.length === 1 ? '' : 's'} failed`,
            { description: errors.join('\n') }
          );
        }
        if (successCount === 0) return null;
        if (studentsMoved === 0) {
          return 'Every class already had these numbers';
        }
        return `Renumbered ${studentsMoved} student${studentsMoved === 1 ? '' : 's'} across ${sectionsMoved} section${sectionsMoved === 1 ? '' : 's'}`;
      },
      onResolved: () => setOpen(false),
      // Only refresh when something actually changed — an all-failure run
      // leaves the page identical, so skip the needless re-render.
      refresh: ({ successCount }) => successCount > 0,
    });
    setBusy(false);
  }

  function handleGenerateAll(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    void generateAll();
  }

  const count = sections.length;

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <ArrowDownAZ className="size-3.5" />
          Renumber every class A–Z
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Renumber every class A–Z?</AlertDialogTitle>
          <AlertDialogDescription>
            Numbers every student in{' '}
            <strong>
              all {count} section{count === 1 ? '' : 's'}
            </strong>{' '}
            alphabetically by surname (last name, then first name). This is the
            same as clicking &ldquo;Renumber A–Z&rdquo; on each section
            individually.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {previewAll.isPending ? (
          <div className="space-y-2" aria-label="Checking every section">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : allQuiet ? (
          <div className="rounded-lg border border-brand-mint bg-brand-mint/30 p-3 text-sm text-ink">
            Nothing changes — every class already has the numbers this would
            give them.
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              <strong className="font-medium text-foreground">
                {totalMoving}
              </strong>{' '}
              student{totalMoving === 1 ? '' : 's'} across{' '}
              <strong className="font-medium text-foreground">
                {movingSections.length}
              </strong>{' '}
              of {count} section{count === 1 ? '' : 's'} get a different number.
            </p>
            {movingSections.length > 0 && (
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                {movingSections.map((p) => (
                  <div
                    key={p.name}
                    className="flex items-baseline justify-between gap-3 px-1 text-sm"
                  >
                    <span className="truncate text-foreground">{p.name}</span>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                      {p.changed}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {failedPreviews.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Couldn&rsquo;t check {failedPreviews.length} section
                {failedPreviews.length === 1 ? '' : 's'}:{' '}
                {failedPreviews.map((p) => p.name).join(', ')}.
              </p>
            )}
          </div>
        )}

        {termStarted && !allQuiet && (
          <Alert variant="warning">
            <AlertIcon variant="warning">
              <TriangleAlert />
            </AlertIcon>
            <AlertTitle>School year is in session</AlertTitle>
            <AlertDescription>
              Students in every class may already know their current numbers.
              This renumbers <strong>everyone, in every class</strong> — it does
              not fill in gaps. The master list is permanent: a student who has
              left keeps their number, and nobody moves up into it. Only
              renumber if every class was set up wrongly.
            </AlertDescription>
          </Alert>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleGenerateAll}
            // Same rule as the single-section dialog: held while the summary
            // loads, and no work to do means no button. A section whose preview
            // failed keeps it enabled — an unknown is a reason to warn, not to
            // block.
            disabled={busy || previewAll.isPending || allQuiet}
            variant={termStarted ? 'destructive' : 'default'}
          >
            Renumber all
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
