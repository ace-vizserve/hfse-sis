'use client';

// Generate class index button — per-section + bulk variant.
//
// Triggers POST /api/sections/[id]/generate-index (B2 route) which assigns
// index_numbers 1..N alphabetically by (last_name, first_name) to all
// non-withdrawn students, appending withdrawn students at the bottom.
//
// The `termStarted` prop controls the dialog tone:
//   false → normal confirmation (green year setup path)
//   true  → escalated warning (mid-year, students may already know their numbers)
//
// This is an outline/secondary action — the primary CTA on each page is
// "New section" (list page) or "Generate sheets" (detail page). One primary
// CTA per view per design system §2.3.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDownAZ, Loader2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';

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
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleGenerate(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`/api/sections/${sectionId}/generate-index`, {
        method: 'POST',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? 'Could not generate index numbers');
      }
      const count: number = body.rows_renumbered ?? 0;
      toast.success(
        `Renumbered ${count} student${count === 1 ? '' : 's'} in ${sectionName}`
      );
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <ArrowDownAZ className="size-3.5" />
          {variant === 'default' && 'Generate index'}
        </Button>
      </AlertDialogTrigger>

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

        {/* Mid-year escalation warning — shown only when a term is in session */}
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
            {busy && <Loader2 className="mr-1 size-4 animate-spin" />}
            Generate
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleGenerateAll(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      // Fan out one POST per section (reuses the per-section route so we need
      // no new bulk API endpoint). Sequential to avoid hammering the DB with
      // parallel writes across many sections; fast enough in practice (<200ms
      // per section).
      let successCount = 0;
      const errors: string[] = [];
      for (const section of sections) {
        try {
          const res = await fetch(
            `/api/sections/${section.id}/generate-index`,
            { method: 'POST' }
          );
          const body = await res.json().catch(() => ({}));
          if (!res.ok) {
            errors.push(`${section.name}: ${body.error ?? 'failed'}`);
          } else {
            successCount++;
          }
        } catch {
          errors.push(`${section.name}: network error`);
        }
      }

      if (successCount > 0) {
        toast.success(
          `Renumbered ${successCount} section${successCount === 1 ? '' : 's'}`
        );
      }
      if (errors.length > 0) {
        toast.error(
          `${errors.length} section${errors.length === 1 ? '' : 's'} failed`,
          {
            description: errors.join('\n'),
          }
        );
      }

      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
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
            {busy && <Loader2 className="mr-1 size-4 animate-spin" />}
            Generate all
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
