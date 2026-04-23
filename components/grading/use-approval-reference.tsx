'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  CORRECTION_REASONS,
  CORRECTION_REASON_LABELS,
  type CorrectionReason,
} from '@/lib/schemas/change-request';

// Shape the hook resolves with after the user makes a choice.
export type ChangeReference =
  | { mode: 'request'; change_request_id: string }
  | {
      mode: 'correction';
      correction_reason: CorrectionReason;
      correction_justification: string;
    };

// Arguments describing the cell being edited. Used to filter the approved
// request list to ones that actually match this patch.
export type ChangeReferenceTarget = {
  sheetId: string;
  entryId: string;
  field: 'ww_scores' | 'pt_scores' | 'qa_score' | 'letter_grade' | 'is_na';
  slotIndex?: number | null;
};

type PendingRequest = {
  id: string;
  field_changed: string;
  slot_index: number | null;
  current_value: string | null;
  proposed_value: string;
  reason_category: string;
  justification: string;
  requested_by_email: string;
  reviewed_by_email: string | null;
};

// Branched dialog that replaces the old free-text approval reference prompt.
// Two tabs:
//   - Apply approved request  → picks from approved-not-yet-applied requests
//     that match the cell being edited (sheet, entry, field, slot).
//   - Data entry correction   → structured reason + justification (Path B).
//
// Return shape is a discriminated union so the calling grid can spread either
// `{ change_request_id }` or `{ correction_reason, correction_justification }`
// into the PATCH body.
export function useChangeReference() {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<ChangeReferenceTarget | null>(null);
  const [tab, setTab] = useState<'request' | 'correction'>('request');

  // Path A state
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Path B state
  const [correctionReason, setCorrectionReason] = useState<CorrectionReason>('typo');
  const [correctionJustification, setCorrectionJustification] = useState('');

  const pending = useRef<((value: ChangeReference | null) => void) | null>(null);

  const resolve = useCallback((value: ChangeReference | null) => {
    const fn = pending.current;
    pending.current = null;
    fn?.(value);
  }, []);

  const requireChangeReference = useCallback(
    (next: ChangeReferenceTarget): Promise<ChangeReference | null> => {
      setTarget(next);
      setTab('request');
      setSelectedRequestId(null);
      setCorrectionReason('typo');
      setCorrectionJustification('');
      setLoadError(null);
      setRequests([]);
      setLoadingRequests(true);
      setOpen(true);
      return new Promise<ChangeReference | null>((res) => {
        pending.current = res;
      });
    },
    [],
  );

  // Fetch approved-not-yet-applied requests for the sheet whenever the dialog
  // opens with a new target. Filter client-side to the specific field/slot.
  // setState is only called from async callbacks (React Compiler friendly).
  useEffect(() => {
    if (!open || !target) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/change-requests?status=approved&sheet_id=${encodeURIComponent(target.sheetId)}`,
        );
        const bodyJson = (await res.json()) as {
          requests?: PendingRequest[];
          error?: string;
        };
        if (!res.ok) throw new Error(bodyJson.error ?? 'failed to load requests');
        if (cancelled) return;
        const filtered = (bodyJson.requests ?? []).filter((r) => {
          if (r.field_changed !== target.field) return false;
          if (target.field === 'ww_scores' || target.field === 'pt_scores') {
            return r.slot_index === (target.slotIndex ?? null);
          }
          return true;
        });
        setRequests(filtered);
      } catch (e) {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : 'failed to load');
        setRequests([]);
      } finally {
        if (!cancelled) setLoadingRequests(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, target]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) resolve(null);
  }

  function confirmRequest() {
    if (!selectedRequestId) return;
    setOpen(false);
    resolve({ mode: 'request', change_request_id: selectedRequestId });
  }

  function confirmCorrection() {
    const justification = correctionJustification.trim();
    if (justification.length < 20) return;
    setOpen(false);
    resolve({
      mode: 'correction',
      correction_reason: correctionReason,
      correction_justification: justification,
    });
  }

  const canConfirmCorrection = correctionJustification.trim().length >= 20;
  const canConfirmRequest = !!selectedRequestId;

  const dialog = (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Post-lock edit</DialogTitle>
          <DialogDescription>
            This sheet is locked. Apply an approved change request, or log a data entry
            correction. Either path is appended to the audit log.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'request' | 'correction')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="request">Apply approved request</TabsTrigger>
            <TabsTrigger value="correction">Data entry correction</TabsTrigger>
          </TabsList>

          <TabsContent value="request" className="space-y-3 pt-3">
            {loadingRequests ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading approved requests…
              </div>
            ) : loadError ? (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{loadError}</span>
              </div>
            ) : requests.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                No approved change requests match this cell yet. Ask the teacher to file a
                request, or use the correction tab if this is a data entry fix.
              </p>
            ) : (
              <ScrollArea className="h-72 pr-1">
                <div role="radiogroup" aria-label="Approved change requests" className="space-y-2">
                {requests.map((r) => {
                  const selected = r.id === selectedRequestId;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setSelectedRequestId(r.id)}
                      className={`w-full rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        selected
                          ? 'border-primary bg-primary/5'
                          : 'border-border bg-card hover:bg-muted'
                      }`}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {r.current_value ?? '(blank)'}{' '}
                          <span className="text-muted-foreground">→</span>{' '}
                          <span className="tabular-nums">{r.proposed_value}</span>
                        </span>
                        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          {r.reason_category.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {r.justification}
                      </div>
                      <div className="mt-1.5 text-[11px] text-muted-foreground">
                        From {r.requested_by_email} · approved by{' '}
                        {r.reviewed_by_email ?? '(unknown)'}
                      </div>
                    </button>
                  );
                })}
                </div>
              </ScrollArea>
            )}
            <p className="text-[11px] text-muted-foreground">
              The typed cell value must match the request&apos;s proposed value.
            </p>
          </TabsContent>

          <TabsContent value="correction" className="space-y-3 pt-3">
            <Field>
              <FieldLabel htmlFor="correction-reason">Correction type</FieldLabel>
              <Select
                value={correctionReason}
                onValueChange={(v) => setCorrectionReason(v as CorrectionReason)}>
                <SelectTrigger id="correction-reason" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CORRECTION_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {CORRECTION_REASON_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="correction-justification">Justification</FieldLabel>
              <Textarea
                id="correction-justification"
                value={correctionJustification}
                onChange={(e) => setCorrectionJustification(e.target.value)}
                placeholder="Explain what was wrong and what the correct value should be (min 20 characters)"
                rows={4}
              />
              <p className="text-[11px] text-muted-foreground">
                {correctionJustification.trim().length}/20 characters minimum
              </p>
            </Field>
            <p className="text-[11px] text-muted-foreground">
              Corrections are tagged separately in the audit log so misuse is easy to spot.
            </p>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          {tab === 'request' ? (
            <Button onClick={confirmRequest} disabled={!canConfirmRequest}>
              Apply request
            </Button>
          ) : (
            <Button onClick={confirmCorrection} disabled={!canConfirmCorrection}>
              Log correction
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { requireChangeReference, dialog };
}
