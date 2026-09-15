'use client';

import { AlertCircle } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useWriteAction } from '@/lib/hooks/use-write-action';
import { ApiError, apiFetch, jsonInit } from '@/lib/query/fetcher';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ComponentWeightChips,
  COMPONENT_PAINT,
  type GradeComponent,
} from '@/components/grading/component-weight-chips';
import { cn } from '@/lib/utils';

// Which components a subject is graded on IN EACH TERM, and at what weights.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
//
// Miss Joann, 2026-09-15 registrar training: S3 Filipino has an exam in some
// terms and not others, and Global Perspectives had no exam in Term 3 — "those
// subjects have PT scores only, and the PT score effectively is the exam". She
// asked whether she has to untick something per term. There was nothing to
// untick, and the cost was not cosmetic: a missing component's weight was
// multiplied by zero rather than handed back, so a term with no exam graded
// every student out of 80. A Filipino student on full marks scored 87.
//
// ── WHY IT LOOKS LIKE THE WEIGHTS ROW ABOVE IT ─────────────────────────────
//
// The form already has a vocabulary for "how this subject's grade splits" —
// `RatioBar` in subject-config-form.tsx, with written work in chart-3,
// performance tasks in brand-indigo and the exam in brand-amber. This control
// IS that bar, once per term, so unticking the exam visibly reshapes the thing
// the coordinator is already reading rather than introducing a second visual
// language beside it. `COMPONENT_PAINT` below is the single source for both the
// chip dot and the bar segment (09a §10.2 — the cells own the map).
//
// ⚠ EVERY TERM IS LISTED, not only the ones that differ. Four rows of height
// buys the answer to the question Joann actually asked. Behind a "set a term
// apart" button it is a feature she never finds.

type TermRow = {
  termId: string;
  termNumber: number;
  label: string;
  sheets: number;
  lockedSheets: number;
  mixed: boolean;
  overridden: boolean;
  ww: number;
  pt: number;
  qa: number;
};

type TermWeightsPayload = {
  config: { ww: number; pt: number; qa: number };
  terms: TermRow[];
};

type Component = GradeComponent;

export function SubjectTermWeights({
  configId,
  subjectCode,
}: {
  configId: string;
  subjectCode: string;
}) {
  const queryClient = useQueryClient();
  const run = useWriteAction();
  const key = ['subject-term-weights', configId];

  const { data, isPending, isError, error, refetch } =
    useQuery<TermWeightsPayload>({
      queryKey: key,
      queryFn: () =>
        apiFetch<TermWeightsPayload>(
          `/api/sis/admin/subjects/${configId}/term-weights`
        ),
    });

  const mutation = useMutation({
    mutationFn: (body: {
      term_id: string;
      components: Record<Component, boolean>;
    }) =>
      apiFetch<{ sheetsUpdated: number; lockedClasses: string[] }>(
        `/api/sis/admin/subjects/${configId}/term-weights`,
        jsonInit('PATCH', body)
      ),
  });

  async function toggleComponent(term: TermRow, component: Component) {
    const inUse: Record<Component, boolean> = {
      ww: term.ww > 0,
      pt: term.pt > 0,
      qa: term.qa > 0,
    };
    inUse[component] = !inUse[component];

    if (!inUse.ww && !inUse.pt && !inUse.qa) {
      // The route refuses this too. Saying so here keeps the last tick from
      // looking broken when nothing happens.
      toast.error('A subject has to be graded on at least one component.');
      return;
    }

    const turningOff = !inUse[component];
    await run(
      () => mutation.mutateAsync({ term_id: term.termId, components: inUse }),
      {
        pending: `Updating Term ${term.termNumber}…`,
        success: (result) => {
          const what = COMPONENT_PAINT[component].label.toLowerCase();
          const head = turningOff
            ? `Term ${term.termNumber} no longer counts ${what}`
            : `Term ${term.termNumber} counts ${what} again`;
          const updated = result?.sheetsUpdated ?? 0;
          const classes =
            updated === 1 ? '1 class updated' : `${updated} classes updated`;
          const locked = Array.isArray(result?.lockedClasses)
            ? result.lockedClasses
            : [];
          const skipped = locked.length
            ? `. Locked and left alone: ${locked.join(', ')}`
            : '';
          return `${head}. ${classes}${skipped}`;
        },
        error: (e: unknown) =>
          e instanceof Error ? e.message : 'Could not update this term',
      }
    );
    await queryClient.invalidateQueries({ queryKey: key });
  }

  if (isPending) {
    return (
      <div className="space-y-1.5">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-9 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  // ⚠ Shape-check the payload, don't trust it. This panel is one row inside the
  // Subject setup drawer, and reading `.length` off an unexpected response
  // threw — which takes the WHOLE drawer down, so a coordinator loses the
  // weights form too. A row that cannot load says so and leaves the rest of the
  // form working.
  const terms = Array.isArray(data?.terms) ? data.terms : null;

  if (isError || !terms) {
    // ⚠ SAY WHY. The first version of this branch printed "Couldn't load this
    // year's terms" and nothing else, which is useless to the person looking at
    // it and useless to whoever they report it to — a signed-out session, a
    // permission problem and a server fault all looked identical. The reason
    // comes from `ApiError.message`, which carries the route's own sentence.
    const reason =
      error instanceof ApiError
        ? error.status === 401
          ? 'Your session has expired — sign in again.'
          : error.status === 403
            ? 'Your account can’t change subject settings.'
            : error.status === 404
              ? 'This subject has no settings for the current academic year yet.'
              : error.message
        : error instanceof Error
          ? error.message
          : null;

    return (
      <div className="space-y-1.5 text-[12px] text-muted-foreground">
        <p>
          Couldn&rsquo;t load this year&rsquo;s terms.
          {reason ? ` ${reason}` : ''}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7"
          onClick={() => void refetch()}
        >
          Try again
        </Button>
      </div>
    );
  }

  if (terms.length === 0) {
    return (
      <p className="text-[12px] text-muted-foreground">
        This academic year has no terms set up yet, so there is nothing to
        change per term.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {terms.map((term) => {
        const values: Record<Component, number> = {
          ww: term.ww,
          pt: term.pt,
          qa: term.qa,
        };
        const noSheets = term.sheets === 0;

        return (
          <div
            key={term.termId}
            className={cn(
              'grid grid-cols-1 items-center gap-3 rounded-lg px-2 py-2 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto]',
              // A standard opacity step, not an arbitrary one: an arbitrary
              // value that fails to compile leaves the element with NO
              // background, because tailwind-merge has already stripped what it
              // was overriding.
              term.overridden && 'bg-brand-amber/5'
            )}
          >
            <span className="text-[13px] font-medium text-ink-2">
              Term {term.termNumber}
            </span>

            <ComponentWeightChips
              className="col-span-full sm:col-span-2 sm:col-start-2"
              values={values}
              onToggle={(component) => void toggleComponent(term, component)}
              disabled={noSheets || mutation.isPending}
              scopeLabel={`Term ${term.termNumber}`}
            />

            {(term.mixed || term.lockedSheets > 0 || noSheets) && (
              <p className="col-span-full flex items-start gap-1.5 pl-2 text-[11px] leading-snug text-muted-foreground sm:col-start-2">
                <AlertCircle className="mt-0.5 size-3 shrink-0" />
                <span>
                  {noSheets
                    ? 'No grading sheets for this subject in this term yet.'
                    : term.mixed
                      ? 'Classes in this term are not all graded the same way. Set it again here to bring them into line.'
                      : `${term.lockedSheets} ${term.lockedSheets === 1 ? 'class is' : 'classes are'} locked, so ${term.lockedSheets === 1 ? 'it keeps' : 'they keep'} the split ${term.lockedSheets === 1 ? 'it was' : 'they were'} published with.`}
                </span>
              </p>
            )}
          </div>
        );
      })}

      <p className="pt-1 text-[11px] leading-snug text-muted-foreground">
        Untick a component a term doesn&rsquo;t use — {subjectCode} is then
        graded only on what is left, and the share moves across so the grade is
        still out of 100.
      </p>
    </div>
  );
}
