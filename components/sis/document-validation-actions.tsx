'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { AlertCircle, Check, X, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useWriteAction } from '@/lib/hooks/use-write-action';

import { ApiError, apiFetch, jsonInit } from '@/lib/query/fetcher';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';

type Props = {
  ayCode: string;
  enroleeNumber: string;
  slotKey: string;
  label: string;
  /** Raw status string from the DB (e.g. "Valid", "Rejected", "Uploaded", null) */
  status: string | null;
  /** Effective file URL — no file means nothing to validate */
  url: string | null;
  /**
   * Current application status. When the student is enrolled
   * (`Enrolled` / `Enrolled (Conditional)`), document validation moves to
   * P-Files (KD #147), so Approve / Reject are hidden here. The server route
   * also 403s these calls for enrolled students.
   */
  applicationStatus?: string | null;
};

// Statuses where the student is enrolled — documents are handed to P-Files
// post-enrolment (mirrors isStudentEnrolled in lib/p-files/queries.ts).
const ENROLLED_STATUSES = new Set(['Enrolled', 'Enrolled (Conditional)']);

// Local schema — the route-side DocumentValidationSchema is a discriminated
// union; here we only need the Reject reason validated client-side.
const RejectFormSchema = z.object({
  rejectionReason: z
    .string()
    .trim()
    .min(20, 'Please explain in at least 20 characters')
    .max(2000, 'Keep this under 2000 characters'),
});

type RejectFormInput = z.infer<typeof RejectFormSchema>;

function normalize(raw: string | null): string {
  return (raw ?? '').trim().toLowerCase();
}

export function DocumentValidationActions({
  ayCode,
  enroleeNumber,
  slotKey,
  label,
  status,
  url,
  applicationStatus,
}: Props) {
  const [rejectOpen, setRejectOpen] = useState(false);

  const form = useForm<RejectFormInput>({
    resolver: zodResolver(RejectFormSchema),
    defaultValues: { rejectionReason: '' },
  });

  // Declared up here, above the early returns below — hooks cannot live after
  // a conditional return. (Reject's busy signal is RHF's `isSubmitting`; only
  // Approve, which has no form, needs its own flag.)
  const run = useWriteAction();
  const [approving, setApproving] = useState(false);

  // No local optimistic value — the new status only appears once the server
  // re-renders, so each toast waits for it. The original `send` threw
  // `data.error ?? successMsg + ' failed'`; ApiError.message already carries
  // the route's `body.error`, and `errorMessage` below preserves the exact
  // `'Approve failed'` / `'Reject failed'` fallback.
  const validateMutation = useMutation({
    mutationFn: ({ body }: { body: Record<string, unknown> }) =>
      apiFetch(
        `/api/sis/students/${encodeURIComponent(enroleeNumber)}/document/${encodeURIComponent(slotKey)}?ay=${encodeURIComponent(ayCode)}`,
        jsonInit('PATCH', body)
      ),
  });

  // Enrolled students → document validation is handled in P-Files (KD #147).
  if (ENROLLED_STATUSES.has((applicationStatus ?? '').trim())) {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <AlertCircle className="size-3 text-muted-foreground" />
        Enrolled — document validation is handled in P-Files.
      </span>
    );
  }

  // No file → nothing to validate. Parent hasn't uploaded yet.
  if (!url) return null;

  const s = normalize(status);
  const isValid = s === 'valid';
  const isRejected = s === 'rejected';
  const isExpired = s === 'expired';

  // Expired documents need a parent re-upload (KD #60) — manual approval
  // would resurrect a stale doc and bypass the re-upload signal. Hide
  // both buttons and surface a small advisory note. The server gate in
  // /api/sis/students/[enroleeNumber]/document/[slotKey] enforces the
  // same rule with a 422 if anyone calls the API directly.
  if (isExpired) {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <AlertCircle className="size-3 text-destructive" />
        Awaiting re-upload
      </span>
    );
  }

  // Mirrors the original `data.error ?? '<Action> failed'`: prefer the route's
  // `body.error` (ApiError surfaces non-string/absent bodies as a generic
  // message), else the action-specific fallback.
  function errorMessage(e: unknown, fallback: string): string {
    if (e instanceof ApiError) {
      const body = e.body;
      if (body && typeof body === 'object') {
        const err = (body as Record<string, unknown>).error;
        if (typeof err === 'string' && err) return err;
      }
      return fallback;
    }
    return e instanceof Error ? e.message : fallback;
  }

  async function handleApprove() {
    setApproving(true);
    await run(
      () => validateMutation.mutateAsync({ body: { status: 'Valid' } }),
      {
        pending: `Approving ${label}…`,
        success: `${label} approved`,
        error: (e) => errorMessage(e, 'Approve failed'),
      }
    );
    setApproving(false);
  }

  async function handleReject(values: RejectFormInput) {
    await run(
      () =>
        validateMutation.mutateAsync({
          body: {
            status: 'Rejected',
            rejectionReason: values.rejectionReason,
          },
        }),
      {
        pending: `Rejecting ${label}…`,
        success: `${label} rejected`,
        error: (e) => errorMessage(e, 'Reject failed'),
        onResolved: () => {
          setRejectOpen(false);
          form.reset({ rejectionReason: '' });
        },
      }
    );
  }

  const busy = form.formState.isSubmitting;

  return (
    <>
      {!isValid && (
        <Button
          variant={'success'}
          loading={approving}
          loadingText="Approving…"
          onClick={() => void handleApprove()}
        >
          {!approving && <Check className="size-3" />}
          Approve
        </Button>
      )}
      {!isRejected && (
        <Button variant="destructive" onClick={() => setRejectOpen(true)}>
          <X className="size-3" />
          Reject
        </Button>
      )}

      <Dialog
        open={rejectOpen}
        onOpenChange={(next) => {
          setRejectOpen(next);
          if (!next) form.reset({ rejectionReason: '' });
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground shadow-brand-tile">
                <XCircle className="size-4" />
              </div>
              <div className="space-y-1.5 text-left">
                <DialogTitle className="font-serif text-lg font-semibold">
                  Reject {label}
                </DialogTitle>
                <DialogDescription>
                  Tell the parent what&apos;s wrong so they can re-upload.
                  Minimum 20 characters.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleReject)}
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="rejectionReason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reason for rejection</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={5}
                        placeholder="e.g. Photo is blurry and the name is cut off at the top edge. Please re-upload a clearer scan."
                        maxLength={2000}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter className="gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRejectOpen(false)}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  variant="destructive"
                  loading={busy}
                  loadingText="Rejecting…"
                >
                  Reject document
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}
