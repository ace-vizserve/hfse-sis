'use client';

import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Radio,
  XCircle,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  concernsFor,
  type Concern,
} from '@/components/admin/bulk-publish-concerns';
import { SectionReadinessRow } from '@/components/admin/section-readiness-row';
import { Button } from '@/components/ui/button';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';

type SectionLite = { id: string; name: string; level_label: string };
type TermLite = { id: string; label: string; term_number: number };

// Per-section readiness state (fetched from GET /api/sections/[id]/publish-readiness).
type SectionReadiness =
  | { state: 'loading'; concerns?: Concern[] }
  | { state: 'ready'; concerns?: Concern[] }
  | { state: 'warn'; reasons: string[]; concerns?: Concern[] }
  | { state: 'blocked'; reasons: string[]; concerns?: Concern[] };

// A hard blocker / soft gap as returned by the server verdict.
type PublishGap = { code: string; label: string; count?: number };

// Build the per-pill reason strings from a verdict array. The label already
// reads plain-English ("Section has no students", "Adviser comments / virtue
// theme incomplete"); append the count when present.
function reasonsFromGaps(gaps: PublishGap[]): string[] {
  return gaps.map((g) =>
    g.count != null ? `${g.label} (${g.count})` : g.label
  );
}

// Classify the readiness API response into one of the four states.
// Prefers the server's verdict (hardBlockers / softGaps — codes no_students,
// no_grading_sheets, comments_incomplete are all hard now); falls back to the
// legacy comment-gate + per-field derivation if the verdict arrays are absent.
function classify(r: {
  grading_sheets: { unlocked: { subject_name: string }[] };
  attendance: { missing: unknown[] };
  t4_readiness: {
    all_terms_locked: boolean;
    missing_annual_count: number;
    non_examinable_readiness: { missing_count: number };
    letterhead_readiness: { ok: boolean };
  } | null;
  comment_gate: {
    ok: boolean;
    gaps: {
      term_number: number;
      virtue_missing: boolean;
      missing: unknown[];
    }[];
  };
  hardBlockers?: PublishGap[];
  softGaps?: PublishGap[];
  canPublish?: boolean;
}): SectionReadiness {
  // Preferred path: the server verdict drives the classification.
  if (r.hardBlockers || r.softGaps) {
    if ((r.hardBlockers?.length ?? 0) > 0) {
      return { state: 'blocked', reasons: reasonsFromGaps(r.hardBlockers!) };
    }
    if ((r.softGaps?.length ?? 0) > 0) {
      return { state: 'warn', reasons: reasonsFromGaps(r.softGaps!) };
    }
    return { state: 'ready' };
  }

  // Fallback path (verdict absent) — legacy comment-gate + per-field logic.
  if (!r.comment_gate.ok) {
    const reasons = r.comment_gate.gaps.map((g) => {
      const bits: string[] = [];
      if (g.missing.length)
        bits.push(
          `${g.missing.length} comment${g.missing.length === 1 ? '' : 's'}`
        );
      if (g.virtue_missing) bits.push('virtue');
      return `T${g.term_number} (${bits.join(', ')})`;
    });
    return { state: 'blocked', reasons };
  }

  // Soft warnings: the section will still publish (consistent with single-section
  // "publish anyway" per KD #28), but the registrar is informed.
  const warn: string[] = [];
  if (r.grading_sheets.unlocked.length) {
    const n = r.grading_sheets.unlocked.length;
    warn.push(`${n} sheet${n === 1 ? '' : 's'} unlocked`);
  }
  if (r.attendance.missing.length) {
    const n = r.attendance.missing.length;
    warn.push(`${n} attendance gap${n === 1 ? '' : 's'}`);
  }
  if (r.t4_readiness) {
    if (!r.t4_readiness.all_terms_locked) warn.push('not all terms locked');
    if (r.t4_readiness.missing_annual_count > 0)
      warn.push(
        `${r.t4_readiness.missing_annual_count} grade${r.t4_readiness.missing_annual_count === 1 ? '' : 's'} missing`
      );
    if (r.t4_readiness.non_examinable_readiness.missing_count > 0) {
      const n = r.t4_readiness.non_examinable_readiness.missing_count;
      warn.push(`${n} final letter grade${n === 1 ? '' : 's'} missing`);
    }
    if (!r.t4_readiness.letterhead_readiness.ok)
      warn.push('letterhead incomplete');
  }
  return warn.length ? { state: 'warn', reasons: warn } : { state: 'ready' };
}

// "Publish all sections for [term]" dialog. Fires one POST per selected
// section against the existing `/api/report-card-publications` endpoint
// (upserts on (section × term) + best-effort parent email per row).
//
// Readiness layer: fetches GET /api/sections/[id]/publish-readiness for every
// section on open + term-change. Blocked sections (comment_gate) are
// automatically unchecked and their checkbox disabled. Warn sections publish
// with a single-section "publish anyway" posture (KD #28).
//
// Publish behaviour: publishes all ready+warn sections in parallel chunks of 5,
// collecting per-section outcomes (published / skipped / failed). Reports a
// summary toast instead of halting on first error.
export function BulkPublishDialog({
  sections,
  terms,
  defaultTermId,
}: {
  sections: SectionLite[];
  terms: TermLite[];
  defaultTermId?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [termId, setTermId] = useState(defaultTermId ?? terms[0]?.id ?? '');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [selection, setSelection] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(sections.map((s) => [s.id, true]))
  );
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  // Per-section readiness state — keyed `${sectionId}:${termId}` so that
  // changing the term triggers fresh fetches without clobbering prior results.
  const [readiness, setReadiness] = useState<Record<string, SectionReadiness>>(
    {}
  );
  // Cache: avoids re-fetching if the user closes + reopens on the same term.
  const readinessCache = useRef<Record<string, SectionReadiness>>({});

  const sortedSections = useMemo(
    () =>
      sections.slice().sort((a, b) => {
        const byLevel = a.level_label.localeCompare(b.level_label);
        return byLevel === 0 ? a.name.localeCompare(b.name) : byLevel;
      }),
    [sections]
  );

  // ---------------------------------------------------------------------------
  // Fetch readiness for all sections whenever the dialog opens or term changes.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!open || !termId) return;

    const capturedTermId = termId; // for the fetch URL + cache key

    // Determine which sections still need fetching.
    const toFetch = sortedSections.filter(
      (s) => !readinessCache.current[`${s.id}:${capturedTermId}`]
    );

    if (toFetch.length === 0) {
      // All cached — hydrate state immediately.
      setReadiness((prev) => {
        const next = { ...prev };
        for (const s of sortedSections) {
          const cached = readinessCache.current[`${s.id}:${capturedTermId}`];
          if (cached) next[s.id] = cached;
        }
        return next;
      });
      return;
    }

    // Mark un-cached sections as loading.
    setReadiness((prev) => {
      const next = { ...prev };
      for (const s of toFetch) {
        next[s.id] = { state: 'loading' };
      }
      return next;
    });

    // Fetch in chunks of 5.
    const CHUNK = 5;
    let cancelled = false;

    (async () => {
      for (let i = 0; i < toFetch.length; i += CHUNK) {
        if (cancelled) break;
        const chunk = toFetch.slice(i, i + CHUNK);
        await Promise.all(
          chunk.map(async (s) => {
            const key = `${s.id}:${capturedTermId}`;
            try {
              const res = await fetch(
                `/api/sections/${s.id}/publish-readiness?term_id=${capturedTermId}`
              );
              // `cancelled` is flipped true by this effect's cleanup when the
              // dialog closes or the term changes, so a stale in-flight run
              // never writes to state for the wrong term.
              if (cancelled) return;
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const data = await res.json();
              const result: SectionReadiness = {
                ...classify(data),
                concerns: concernsFor(data),
              };
              readinessCache.current[key] = result;
              setReadiness((prev) => ({ ...prev, [s.id]: result }));
            } catch {
              if (cancelled) return;
              const fallback: SectionReadiness = {
                state: 'warn',
                reasons: ['readiness check failed'],
                concerns: [],
              };
              readinessCache.current[key] = fallback;
              setReadiness((prev) => ({ ...prev, [s.id]: fallback }));
            }
          })
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, termId, sortedSections]);

  // Auto-uncheck sections whose readiness resolves to blocked.
  useEffect(() => {
    setSelection((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const s of sortedSections) {
        const r = readiness[s.id];
        if (r?.state === 'blocked' && next[s.id]) {
          next[s.id] = false;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [readiness, sortedSections]);

  // ---------------------------------------------------------------------------
  // Selection helpers
  // ---------------------------------------------------------------------------
  const selectedCount = Object.values(selection).filter(Boolean).length;

  // Counts for the publish button label.
  const { publishableCount, blockedSelectedCount, loadingSelectedCount } =
    useMemo(() => {
      let publishable = 0;
      let blockedSel = 0;
      let loadingSel = 0;
      for (const s of sortedSections) {
        if (!selection[s.id]) continue;
        const r = readiness[s.id];
        if (!r || r.state === 'loading') {
          loadingSel += 1;
        } else if (r.state === 'blocked') {
          blockedSel += 1;
        } else {
          publishable += 1; // ready | warn
        }
      }
      return {
        publishableCount: publishable,
        blockedSelectedCount: blockedSel,
        loadingSelectedCount: loadingSel,
      };
    }, [selection, readiness, sortedSections]);

  function toggle(id: string) {
    const r = readiness[id];
    if (r?.state === 'blocked') return; // blocked rows can't be toggled
    setSelection((s) => ({ ...s, [id]: !s[id] }));
  }
  function setAll(v: boolean) {
    setSelection(
      Object.fromEntries(
        sections.map((s) => {
          const r = readiness[s.id];
          // Never re-check a blocked section via Select-All.
          const blocked = r?.state === 'blocked';
          return [s.id, v && !blocked];
        })
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Submit: publish ready+warn, skip blocked, collect outcomes
  // ---------------------------------------------------------------------------
  async function submit() {
    if (!termId) return toast.error('Pick a term');
    if (!from || !until) return toast.error('Publish window is required');
    if (new Date(until) <= new Date(from)) {
      return toast.error('Publish-until must be after publish-from');
    }

    // Publishable = selected AND (ready | warn). Loading sections are excluded
    // from the run (the readiness check is in-flight — safer to skip).
    const publishIds = sortedSections
      .filter((s) => {
        if (!selection[s.id]) return false;
        const r = readiness[s.id];
        return r?.state === 'ready' || r?.state === 'warn';
      })
      .map((s) => s.id);

    if (publishIds.length === 0) {
      return toast.info('No publishable sections selected');
    }

    const CHUNK_SIZE = 5;
    setSubmitting(true);
    setProgress({ done: 0, total: publishIds.length });

    let published = 0;
    let skipped = 0; // 422 publish_blocked slipping through the pre-flight check
    let failed = 0;
    let done = 0;

    for (let i = 0; i < publishIds.length; i += CHUNK_SIZE) {
      const chunk = publishIds.slice(i, i + CHUNK_SIZE);
      const results = await Promise.all(
        chunk.map(async (sectionId) => {
          try {
            const res = await fetch('/api/report-card-publications', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                section_id: sectionId,
                term_id: termId,
                publish_from: from,
                publish_until: until,
              }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
              // A section that became hard-blocked between the pre-flight check
              // and publish time returns 422 publish_blocked — count it as
              // skipped (a deliberate skip), not a failure.
              const isBlocked =
                res.status === 422 &&
                (body?.code === 'publish_blocked' ||
                  body?.code === 'comments_incomplete' ||
                  body?.error?.includes('comment'));
              return {
                sectionId,
                ok: false as const,
                skipped: isBlocked,
                message: body?.error ?? `HTTP ${res.status}`,
              };
            }
            return { sectionId, ok: true as const, skipped: false };
          } catch (e) {
            return {
              sectionId,
              ok: false as const,
              skipped: false,
              message: e instanceof Error ? e.message : 'error',
            };
          }
        })
      );

      for (const r of results) {
        done += 1;
        if (r.ok) {
          published += 1;
        } else if (r.skipped) {
          skipped += 1;
        } else {
          failed += 1;
        }
      }
      setProgress({ done, total: publishIds.length });
    }

    setSubmitting(false);
    setProgress(null);

    toast.success(
      `Published ${published} section${published === 1 ? '' : 's'}` +
        (skipped > 0 ? ` · ${skipped} skipped (incomplete)` : '') +
        (failed > 0 ? ` · ${failed} failed` : '')
    );

    if (published > 0) router.refresh();
    if (failed === 0 && skipped === 0) setOpen(false);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const publishButtonDisabled =
    submitting || publishableCount === 0 || loadingSelectedCount > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1.5">
          <Radio className="size-3.5" />
          Publish many
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Bulk publish report cards</DialogTitle>
          <DialogDescription>
            Applies one publish window to every selected section for the chosen
            term. Existing windows for the same section + term are replaced.
            Parents are emailed only the first time their child&apos;s report
            card is published for the term.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="bulk-term">Term</Label>
            <Select
              value={termId}
              onValueChange={setTermId}
              disabled={submitting}
            >
              <SelectTrigger id="bulk-term" className="h-10">
                <SelectValue placeholder="Pick a term" />
              </SelectTrigger>
              <SelectContent>
                {terms.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Publish from</Label>
              <DateTimePicker value={from} onChange={setFrom} />
            </div>
            <div className="grid gap-2">
              <Label>Publish until</Label>
              <DateTimePicker value={until} onChange={setUntil} />
            </div>
          </div>

          <div className="rounded-xl border border-border">
            <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Sections ({selectedCount} of {sections.length})
              </div>
              <div className="flex gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setAll(true)}
                  disabled={submitting}
                >
                  All
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setAll(false)}
                  disabled={submitting}
                >
                  None
                </Button>
              </div>
            </div>
            <ScrollArea className="h-[240px] p-2">
              {sortedSections.length === 0 && (
                <div className="p-3 text-center text-sm text-muted-foreground">
                  No sections available.
                </div>
              )}
              {sortedSections.map((s) => {
                const r = readiness[s.id];
                const isBlocked = r?.state === 'blocked';
                const concerns =
                  r && r.state !== 'loading' ? (r.concerns ?? []) : [];
                return (
                  <SectionReadinessRow
                    key={s.id}
                    section={s}
                    concerns={concerns}
                    termId={termId}
                    selected={!!selection[s.id]}
                    disabled={submitting || isBlocked}
                    onToggle={() => toggle(s.id)}
                    pill={<ReadinessPill readiness={r} />}
                  />
                );
              })}
            </ScrollArea>
          </div>

          {progress && (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Publishing {progress.done} of {progress.total}…
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={publishButtonDisabled}
          >
            {submitting ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Publishing…
              </>
            ) : (
              <>
                <CheckCircle2 className="size-3.5" />
                Publish {publishableCount}
                {blockedSelectedCount > 0 && (
                  <span className="ml-1 font-normal opacity-60">
                    · {blockedSelectedCount} blocked
                  </span>
                )}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Readiness pill — small status indicator rendered in each section row.
// ---------------------------------------------------------------------------
function ReadinessPill({
  readiness,
}: {
  readiness: SectionReadiness | undefined;
}) {
  if (!readiness || readiness.state === 'loading') {
    return (
      <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
    );
  }
  if (readiness.state === 'ready') {
    return (
      <StatusBadge tone="healthy" icon={CheckCircle2} className="text-[10px]">
        Ready
      </StatusBadge>
    );
  }
  if (readiness.state === 'warn') {
    const label = readiness.reasons.join(' · ');
    return (
      <span title={label}>
        <StatusBadge
          tone="warning"
          icon={AlertTriangle}
          className="max-w-[160px] truncate text-[10px]"
        >
          {label}
        </StatusBadge>
      </span>
    );
  }
  // blocked
  const label = readiness.reasons.join(' · ');
  return (
    <span title={label}>
      <StatusBadge
        tone="locked"
        icon={XCircle}
        className="max-w-[160px] truncate text-[10px]"
      >
        {label}
      </StatusBadge>
    </span>
  );
}
