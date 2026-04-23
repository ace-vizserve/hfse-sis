'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, Radio } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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

type SectionLite = { id: string; name: string; level_label: string };
type TermLite = { id: string; label: string; term_number: number };

// "Publish all sections for [term]" dialog. Fires one POST per selected
// section against the existing `/api/report-card-publications` endpoint
// (upserts on (section × term) + best-effort parent email per row).
//
// Rolling loop with progress toast — stops on first error; rows written
// before the error stay written (idempotent via upsert).
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
  const [selection, setSelection] = useState<Record<string, boolean>>(
    () => Object.fromEntries(sections.map((s) => [s.id, true])),
  );
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const sortedSections = useMemo(
    () =>
      sections.slice().sort((a, b) => {
        const byLevel = a.level_label.localeCompare(b.level_label);
        return byLevel === 0 ? a.name.localeCompare(b.name) : byLevel;
      }),
    [sections],
  );
  const selectedCount = Object.values(selection).filter(Boolean).length;

  function toggle(id: string) {
    setSelection((s) => ({ ...s, [id]: !s[id] }));
  }
  function setAll(v: boolean) {
    setSelection(Object.fromEntries(sections.map((s) => [s.id, v])));
  }

  async function submit() {
    const ids = sortedSections.filter((s) => selection[s.id]).map((s) => s.id);
    if (!termId) return toast.error('Pick a term');
    if (!from || !until) return toast.error('Publish window is required');
    if (new Date(until) <= new Date(from)) {
      return toast.error('Publish-until must be after publish-from');
    }
    if (ids.length === 0) return toast.info('No sections selected');

    // Chunked parallel publish (Sprint 14.2). 5 at a time — enough to mask
    // network latency without overwhelming Supabase connection pool or
    // triggering Resend rate limits. Each chunk finishes fully before the
    // next starts so errors still halt the run with prior rows preserved
    // (the upsert is idempotent, so re-clicking retries cleanly).
    const CHUNK_SIZE = 5;
    setSubmitting(true);
    setProgress({ done: 0, total: ids.length });
    let successes = 0;
    let firstError: { sectionId: string; message: string } | null = null;

    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      if (firstError) break;
      const chunk = ids.slice(i, i + CHUNK_SIZE);
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
              return { sectionId, ok: false as const, message: body?.error ?? `HTTP ${res.status}` };
            }
            return { sectionId, ok: true as const };
          } catch (e) {
            return {
              sectionId,
              ok: false as const,
              message: e instanceof Error ? e.message : 'error',
            };
          }
        }),
      );

      // Report chunk results in deterministic order so the first-failure
      // message matches the user's visual expectation.
      for (const r of results) {
        if (r.ok) {
          successes += 1;
        } else if (!firstError) {
          firstError = { sectionId: r.sectionId, message: r.message };
        }
      }
      setProgress({ done: successes, total: ids.length });
    }

    if (firstError) {
      toast.error(
        `Failed on ${sectionLabel(sortedSections, firstError.sectionId)}: ${firstError.message}. Stopped after ${successes} of ${ids.length}.`,
      );
    }

    setSubmitting(false);
    setProgress(null);
    if (successes === ids.length) {
      toast.success(
        `Published ${successes} section${successes === 1 ? '' : 's'} for ${termLabel(terms, termId)}.`,
      );
      setOpen(false);
      router.refresh();
    } else if (successes > 0) {
      router.refresh();
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1.5">
          <Radio className="size-3.5" />
          Publish many
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Bulk publish report cards</DialogTitle>
          <DialogDescription>
            Applies one publish window to every selected section for the chosen term.
            Existing windows on (section × term) are overwritten — upsert. Parent emails
            fire on first publish per row.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="bulk-term">Term</Label>
            <Select value={termId} onValueChange={setTermId} disabled={submitting}>
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
              {sortedSections.map((s) => (
                <label
                  key={s.id}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/40"
                >
                  <Checkbox
                    checked={!!selection[s.id]}
                    onCheckedChange={() => toggle(s.id)}
                    disabled={submitting}
                  />
                  <div className="min-w-0 flex-1 text-sm">
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {s.level_label}
                    </span>{' '}
                    <span className="text-foreground">{s.name}</span>
                  </div>
                </label>
              ))}
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
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={submitting || selectedCount === 0}>
            {submitting ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Publishing…
              </>
            ) : (
              <>
                <CheckCircle2 className="size-3.5" />
                Publish {selectedCount}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function sectionLabel(sections: SectionLite[], id: string): string {
  const s = sections.find((x) => x.id === id);
  return s ? `${s.level_label} ${s.name}` : id;
}
function termLabel(terms: TermLite[], id: string): string {
  return terms.find((t) => t.id === id)?.label ?? id;
}
