'use client';

import { useMutation } from '@tanstack/react-query';
import { Sparkle } from 'lucide-react';
import { useState } from 'react';

import { useWriteAction } from '@/lib/hooks/use-write-action';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

type TermProp = {
  id: string;
  label: string;
  termNumber: number;
  startDate: string | null;
  endDate: string | null;
  virtueTheme: string;
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function VirtueThemesEditor({ terms }: { terms: TermProp[] }) {
  // Controlled values per term, keyed by id
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(terms.map((t) => [t.id, t.virtueTheme]))
  );
  // Baselines — what was last-saved so we can compute dirty state
  const [baselines, setBaselines] = useState<Record<string, string>>(() =>
    Object.fromEntries(terms.map((t) => [t.id, t.virtueTheme]))
  );
  // Per-term saving flag
  const [saving, setSaving] = useState<Set<string>>(new Set());

  function isDirty(id: string): boolean {
    return (values[id] ?? '').trim() !== (baselines[id] ?? '').trim();
  }

  const saveMutation = useMutation({
    mutationFn: (term: TermProp) => {
      const value = (values[term.id] ?? '').trim();
      return apiFetch(
        '/api/evaluation/virtue-theme',
        jsonInit('PATCH', { termId: term.id, virtueTheme: value || null })
      );
    },
  });

  const run = useWriteAction();

  async function handleSave(term: TermProp) {
    setSaving((prev) => new Set(prev).add(term.id));
    const value = (values[term.id] ?? '').trim();
    await run(() => saveMutation.mutateAsync(term), {
      pending: `Saving ${term.label} virtue theme…`,
      success: `${term.label} virtue theme saved`,
      // ApiError.message already equals the route's `error` body field, so a
      // route-specific message (not a generic one) is surfaced.
      error: (e) =>
        e instanceof Error ? e.message : 'Failed to save virtue theme',
      // Baseline moves to the value we just sent, so the field stops reading
      // dirty the moment the write lands.
      onResolved: () => setBaselines((prev) => ({ ...prev, [term.id]: value })),
    });
    setSaving((prev) => {
      const next = new Set(prev);
      next.delete(term.id);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      {terms.map((term) => {
        const isSaving = saving.has(term.id);
        const dirty = isDirty(term.id);

        return (
          <div
            key={term.id}
            className={
              'rounded-xl border bg-card p-4 transition-colors ' +
              (dirty
                ? 'border-brand-amber/40 bg-brand-amber-light/20'
                : 'border-border')
            }
          >
            {/* Term header */}
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <div className="space-y-0.5">
                <h3 className="font-serif text-base font-semibold tracking-tight text-foreground">
                  {term.label}
                </h3>
                <p className="font-mono text-[10px] font-medium text-muted-foreground">
                  {formatDate(term.startDate)} – {formatDate(term.endDate)}
                </p>
              </div>
              {dirty && !isSaving && (
                <span className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-amber">
                  <span
                    className="size-1.5 rounded-full bg-brand-amber"
                    aria-hidden="true"
                  />
                  Unsaved
                </span>
              )}
            </div>

            {/* Input row */}
            <div className="flex items-end gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <label
                  htmlFor={`virtue-${term.id}`}
                  className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
                >
                  <Sparkle className="size-3" />
                  Virtue theme
                </label>
                <Input
                  id={`virtue-${term.id}`}
                  value={values[term.id] ?? ''}
                  onChange={(e) =>
                    setValues((prev) => ({
                      ...prev,
                      [term.id]: e.target.value,
                    }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && dirty && !isSaving) {
                      handleSave(term);
                    }
                  }}
                  placeholder="e.g. Faith, Hope, Love"
                  maxLength={200}
                  className="h-9"
                  disabled={isSaving}
                />
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => void handleSave(term)}
                loading={isSaving}
                loadingText="Saving…"
                disabled={!dirty}
                className="shrink-0"
              >
                Save
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
