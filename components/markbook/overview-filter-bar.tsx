'use client';

import { ChevronDown, ChevronUp, Loader2, RotateCcw, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export const ALL_FILTER_VALUE = '__all__';

// The filter bar for every school-wide Markbook page.
//
// Every control narrows THIS page — none of them navigates away — so the layout
// is identical at every scope. When something is applied the bar gains a chip
// row naming it, because a filtered dashboard that looks exactly like an
// unfiltered one is how people misread a class's numbers as the school's.
//
// Generic over its selects rather than hard-coded, because Academic Summary and
// Awards differ by exactly one control (Subject vs Award category) and every
// other behaviour — the chips, the reset, clearing Class when Level changes,
// dropping scope when the year changes — has to be the same on both. Two bars
// would have drifted on the first change to either.

export type OverviewFilterSelect = {
  /** URL search param this control writes. */
  param: string;
  label: string;
  /** Current value, or `null` when nothing is chosen. */
  value: string | null;
  options: { value: string; label: string }[];
  /**
   * Label for the "no choice" option. Omit for a control that always carries a
   * value — Award category is always one ladder, so it has no "all".
   */
  allLabel?: string;
  /** Prefix on the applied chip, e.g. "Grade level". Defaults to `label`. */
  chipPrefix?: string;
  /** Other params to clear when this one changes — Class hangs off Level. */
  clears?: string[];
  widthClass?: string;
  disabled?: boolean;
};

export function OverviewFilterBar({
  ayCode,
  ayCodes,
  selects,
}: {
  ayCode: string;
  ayCodes: readonly string[];
  selects: OverviewFilterSelect[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [hidden, setHidden] = useState(false);

  const scopeParams = selects.map((s) => s.param);

  function push(mutate: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(searchParams.toString());
    mutate(next);
    startTransition(() => {
      router.push(next.size > 0 ? `?${next.toString()}` : '?', {
        scroll: false,
      });
      router.refresh();
    });
  }

  const setParam = (select: OverviewFilterSelect, value: string) =>
    push((next) => {
      if (value === ALL_FILTER_VALUE) next.delete(select.param);
      else next.set(select.param, value);
      for (const p of select.clears ?? []) next.delete(p);
    });

  const clearAll = () =>
    push((next) => scopeParams.forEach((p) => next.delete(p)));

  // A control with no "all" option is always set, so it is scope rather than a
  // filter and never appears as a removable chip.
  const applied = selects
    .filter((s) => s.value != null && s.allLabel != null)
    .map((s) => ({
      key: s.param,
      label: `${s.chipPrefix ?? s.label}: ${
        s.options.find((o) => o.value === s.value)?.label ?? s.value
      }`,
      params: [s.param, ...(s.clears ?? [])],
    }));

  const hasFilters = applied.length > 0;

  return (
    <section
      aria-label="Filters"
      className={`rounded-xl border bg-card ${hasFilters ? 'border-primary/40 shadow-xs' : 'border-border'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {hasFilters ? 'Filters applied' : 'Filters'}
          {pending && (
            <Loader2 className="ml-2 inline size-3 animate-spin align-[-2px]" />
          )}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setHidden((v) => !v)}
        >
          {hidden ? 'Show filters' : 'Hide filters'}
          {hidden ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronUp className="size-4" />
          )}
        </Button>
      </div>

      {hasFilters && (
        <div className="flex flex-wrap items-center gap-2 px-4 pt-2">
          {applied.map((chip) => (
            <Badge
              key={chip.key}
              variant="outline"
              className="h-7 gap-1.5 border-brand-indigo-soft bg-accent pr-1.5 text-accent-foreground"
            >
              {chip.label}
              <button
                type="button"
                aria-label={`Remove filter ${chip.label}`}
                className="rounded-sm p-0.5 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() =>
                  push((next) => chip.params.forEach((p) => next.delete(p)))
                }
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
          <Button type="button" variant="link" size="sm" onClick={clearAll}>
            Clear all
          </Button>
        </div>
      )}

      {!hidden && (
        <div className="flex flex-wrap items-end gap-3 p-4">
          {ayCodes.length > 1 && (
            <Field label="Academic year">
              <Select
                value={ayCode}
                onValueChange={(v) =>
                  push((next) => {
                    next.set('ay', v);
                    // Levels, classes, subjects and terms are all per-year, so
                    // carrying one across would name a scope that may not exist.
                    scopeParams.forEach((p) => next.delete(p));
                  })
                }
              >
                <SelectTrigger className="h-9 w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ayCodes.map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          {selects.map((select) => (
            <Field key={select.param} label={select.label}>
              <Select
                value={select.value ?? ALL_FILTER_VALUE}
                onValueChange={(v) => setParam(select, v)}
                disabled={select.disabled}
              >
                <SelectTrigger
                  className={`h-9 ${select.widthClass ?? 'w-[180px]'}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {select.allLabel != null && (
                    <SelectItem value={ALL_FILTER_VALUE}>
                      {select.allLabel}
                    </SelectItem>
                  )}
                  {select.options.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasFilters}
            onClick={clearAll}
          >
            <RotateCcw className="size-4" />
            Reset filters
          </Button>
        </div>
      )}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-ink-2">{label}</span>
      {children}
    </div>
  );
}
