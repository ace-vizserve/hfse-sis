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
import type { AcademicOverview } from '@/lib/markbook/academic-overview-compute';

const ALL = '__all__';

type Applied = { key: string; label: string; param: string[] };

// Filters for the school-wide Academic Summary.
//
// Every control narrows THIS page — none of them navigates away — so the
// layout is identical at every scope. When something is applied the bar gains
// a chip row naming it, because a filtered dashboard that looks exactly like
// an unfiltered one is how people misread a class's numbers as the school's.
export function OverviewFilterBar({
  ayCode,
  ayCodes,
  options,
  filters,
}: {
  ayCode: string;
  ayCodes: readonly string[];
  options: AcademicOverview['filterOptions'];
  filters: AcademicOverview['filters'];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [hidden, setHidden] = useState(false);

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

  const setParam = (name: string, value: string) =>
    push((next) => {
      if (value === ALL) next.delete(name);
      else next.set(name, value);
      // A class belongs to a level, and a level's classes differ per level —
      // so changing the level always clears the class beneath it.
      if (name === 'level') next.delete('class');
    });

  const sectionsForLevel = filters.levelId
    ? options.sections.filter((s) => s.levelId === filters.levelId)
    : options.sections;

  const applied: Applied[] = [];
  if (filters.levelId) {
    applied.push({
      key: 'level',
      label: `Grade level: ${options.levels.find((l) => l.id === filters.levelId)?.label ?? filters.levelId}`,
      param: ['level', 'class'],
    });
  }
  if (filters.sectionId) {
    applied.push({
      key: 'class',
      label: `Class: ${options.sections.find((s) => s.id === filters.sectionId)?.name ?? filters.sectionId}`,
      param: ['class'],
    });
  }
  if (filters.subjectId) {
    applied.push({
      key: 'subject',
      label: `Subject: ${options.subjects.find((s) => s.id === filters.subjectId)?.name ?? filters.subjectId}`,
      param: ['subject'],
    });
  }
  if (filters.termNumber != null) {
    applied.push({
      key: 'term',
      label: `Term: ${filters.termNumber}`,
      param: ['term'],
    });
  }

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
                  push((next) => chip.param.forEach((p) => next.delete(p)))
                }
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={() =>
              push((next) =>
                ['level', 'class', 'subject', 'term'].forEach((p) =>
                  next.delete(p)
                )
              )
            }
          >
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
                    // Levels, classes and subjects are all per-year.
                    ['level', 'class', 'subject', 'term'].forEach((p) =>
                      next.delete(p)
                    );
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

          <Field label="Term">
            <Select
              value={
                filters.termNumber == null ? ALL : String(filters.termNumber)
              }
              onValueChange={(v) => setParam('term', v)}
            >
              <SelectTrigger className="h-9 w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All terms</SelectItem>
                {options.terms.map((t) => (
                  <SelectItem key={t.termNumber} value={String(t.termNumber)}>
                    Term {t.termNumber}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Grade level">
            <Select
              value={filters.levelId ?? ALL}
              onValueChange={(v) => setParam('level', v)}
            >
              <SelectTrigger className="h-9 w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All grade levels</SelectItem>
                {options.levels.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Class">
            <Select
              value={filters.sectionId ?? ALL}
              onValueChange={(v) => setParam('class', v)}
              disabled={sectionsForLevel.length === 0}
            >
              <SelectTrigger className="h-9 w-[190px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All classes</SelectItem>
                {sectionsForLevel.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Subject">
            <Select
              value={filters.subjectId ?? ALL}
              onValueChange={(v) => setParam('subject', v)}
            >
              <SelectTrigger className="h-9 w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All subjects</SelectItem>
                {options.subjects.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasFilters}
            onClick={() =>
              push((next) =>
                ['level', 'class', 'subject', 'term'].forEach((p) =>
                  next.delete(p)
                )
              )
            }
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
