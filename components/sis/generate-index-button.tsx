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
import { useMutation } from '@tanstack/react-query';
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
      apiFetch<{ rows_renumbered?: number }>(
        `/api/sections/${sectionId}/generate-index`,
        jsonInit('POST')
      ),
  });

  const run = useWriteAction();
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    await run(() => generateMutation.mutateAsync(), {
      pending: `Renumbering ${sectionName}…`,
      success: (body) => {
        const count: number = body.rows_renumbered ?? 0;
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
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Generate class index?</AlertDialogTitle>
          <AlertDialogDescription>
            This numbers <strong>{sectionName}</strong> alphabetically by
            surname (last name, then first name). New students enrolled later
            keep getting the next number at the bottom; withdrawn students
            retain their retired numbers.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {termStarted && (
          <Alert variant="warning">
            <AlertIcon variant="warning">
              <TriangleAlert />
            </AlertIcon>
            <AlertTitle>School year is in session</AlertTitle>
            <AlertDescription>
              Students may already know their current numbers and teachers may
              call them by these during class. Regenerating will renumber
              everyone — only do this if you&apos;re correcting a setup mistake.
            </AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleGenerate}
            disabled={busy}
            variant={termStarted ? 'destructive' : 'default'}
          >
            Generate
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
        {variant === 'default' && 'Generate index'}
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
      const errors: string[] = [];
      for (const section of sections) {
        try {
          await apiFetch(
            `/api/sections/${section.id}/generate-index`,
            jsonInit('POST')
          );
          successCount++;
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
      return { successCount, errors };
    },
  });

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
      success: ({ successCount, errors }) => {
        if (errors.length > 0) {
          toast.error(
            `${errors.length} section${errors.length === 1 ? '' : 's'} failed`,
            { description: errors.join('\n') }
          );
        }
        return successCount > 0
          ? `Renumbered ${successCount} section${successCount === 1 ? '' : 's'}`
          : null;
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
          Generate all indexes
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Generate index for all sections?</AlertDialogTitle>
          <AlertDialogDescription>
            Numbers every student in{' '}
            <strong>
              all {count} section{count === 1 ? '' : 's'}
            </strong>{' '}
            alphabetically by surname (last name, then first name). This is the
            same as clicking &ldquo;Generate index&rdquo; on each section
            individually.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {termStarted && (
          <Alert variant="warning">
            <AlertIcon variant="warning">
              <TriangleAlert />
            </AlertIcon>
            <AlertTitle>School year is in session</AlertTitle>
            <AlertDescription>
              Students in all sections may already know their current numbers.
              Regenerating will renumber everyone — only do this if you&apos;re
              correcting a setup mistake across the board.
            </AlertDescription>
          </Alert>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleGenerateAll}
            disabled={busy}
            variant={termStarted ? 'destructive' : 'default'}
          >
            Generate all
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
