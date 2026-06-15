'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, FilePlus2 } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

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

  const generateMutation = useMutation({
    mutationFn: () => {
      const body =
        scope.kind === 'ay'
          ? { ay_id: scope.ayId }
          : { section_id: scope.sectionId };
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
          `${label} is already fully configured — every sheet has totals + every roster row has an entry.`
        );
      }

      setOpen(false);
      router.refresh();
    },
    onError: (e) => {
      // Preserve the original `json?.error ?? 'generation failed'` fallback.
      const serverError =
        e instanceof ApiError && e.body && typeof e.body === 'object'
          ? (e.body as { error?: string }).error
          : undefined;
      toast.error(serverError ?? 'generation failed');
    },
  });
  const busy = generateMutation.isPending;

  function run() {
    generateMutation.mutate();
  }

  const scopeLabel = scope.kind === 'ay' ? scope.ayCode : scope.sectionLabel;
  const description =
    scope.kind === 'ay'
      ? `Create one grading sheet per (section × subject × term) in ${scopeLabel}. Safe to re-run — already-created sheets are untouched.`
      : `Create one grading sheet per (subject × term) for ${scopeLabel}. Safe to re-run — already-created sheets are untouched.`;

  const defaultTrigger = (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-7 text-xs"
      disabled={busy}
    >
      {busy ? (
        <Loader2 className="mr-1 size-3 animate-spin" />
      ) : (
        <FilePlus2 className="mr-1 size-3" />
      )}
      Generate sheets
    </Button>
  );

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {(children || !isControlled) && (
        <AlertDialogTrigger asChild>
          {children ?? defaultTrigger}
        </AlertDialogTrigger>
      )}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Generate grading sheets for {scopeLabel}?
          </AlertDialogTitle>
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
