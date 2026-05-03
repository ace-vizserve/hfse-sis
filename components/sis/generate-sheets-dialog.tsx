'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, FilePlus2 } from 'lucide-react';
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
import { Button } from '@/components/ui/button';

// Shared "Generate grading sheets" dialog for SIS Admin surfaces.
//
// Wraps the same `POST /api/grading-sheets/bulk-create` endpoint the Markbook
// button calls, but with two scopes:
//   - AY scope      → /sis/ay-setup row button
//   - Section scope → /sis/sections/[id] header button
//
// Idempotent server-side (RPC uses ON CONFLICT DO NOTHING on the unique
// (term_id, section_id, subject_id) constraint). Safe to re-click.

type Scope =
  | { kind: 'ay'; ayId: string; ayCode: string }
  | { kind: 'section'; sectionId: string; sectionLabel: string };

export function GenerateSheetsDialog({
  scope,
  children,
}: {
  scope: Scope;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const body =
        scope.kind === 'ay' ? { ay_id: scope.ayId } : { section_id: scope.sectionId };
      const res = await fetch('/api/grading-sheets/bulk-create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? 'generation failed');

      const inserted = Number(json?.inserted ?? 0);
      const repaired = Number(json?.repaired_unconfigured_sheets ?? 0);
      const resized = Number(json?.resized_entry_arrays ?? 0);
      const label = scope.kind === 'ay' ? scope.ayCode : scope.sectionLabel;

      // Three meaningful outcomes:
      //   - inserted > 0  → fresh sheets created (initial generate)
      //   - inserted = 0 + repaired > 0 → re-click repaired previously-
      //     unconfigured sheets in place (fills WW/PT/QA defaults from
      //     subject_configs onto sheets created before the defaults
      //     migration was applied)
      //   - inserted = 0 + repaired = 0 → genuinely nothing to do
      if (inserted > 0) {
        toast.success(
          `Generated ${inserted.toLocaleString('en-SG')} sheet${inserted === 1 ? '' : 's'} for ${label}.` +
            (repaired > 0 ? ` Repaired ${repaired} unconfigured.` : ''),
        );
      } else if (repaired > 0 || resized > 0) {
        const parts: string[] = [];
        if (repaired > 0) {
          parts.push(`${repaired} sheet${repaired === 1 ? '' : 's'} defaulted`);
        }
        if (resized > 0) {
          parts.push(`${resized} entr${resized === 1 ? 'y' : 'ies'} resized`);
        }
        toast.success(`${label}: ${parts.join(' · ')}.`);
      } else {
        toast.info(
          `${label} is already fully configured — every sheet has totals + every roster row has an entry.`,
        );
      }
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'generation failed');
    } finally {
      setBusy(false);
    }
  }

  const scopeLabel = scope.kind === 'ay' ? scope.ayCode : scope.sectionLabel;
  const description =
    scope.kind === 'ay'
      ? `Create one grading sheet per (section × subject × term) in ${scopeLabel}. Safe to re-run — already-created sheets are untouched.`
      : `Create one grading sheet per (subject × term) for ${scopeLabel}. Safe to re-run — already-created sheets are untouched.`;

  const defaultTrigger = (
    <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={busy}>
      {busy ? <Loader2 className="mr-1 size-3 animate-spin" /> : <FilePlus2 className="mr-1 size-3" />}
      Generate sheets
    </Button>
  );

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>{children ?? defaultTrigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Generate grading sheets for {scopeLabel}?</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={run} disabled={busy}>
            {busy && <Loader2 className="mr-1 size-4 animate-spin" />}
            Generate sheets
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
