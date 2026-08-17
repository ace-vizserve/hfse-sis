'use client';

import { useMutation } from '@tanstack/react-query';
import {
  ArrowUpRight,
  BookOpen,
  CalendarCog,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  ClipboardList,
  Clock,
  LayoutGrid,
  ListChecks,
  School,
  Sparkles,
  Stamp,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { Fragment, useState, type ReactNode } from 'react';

import { useWriteAction } from '@/lib/hooks/use-write-action';

import { VirtueThemesEditor } from '@/components/evaluation/virtue-themes-editor';
import { AyAcceptingApplicationsToggle } from '@/components/sis/ay-accepting-applications-toggle';
import { GenerateSheetsDialog } from '@/components/sis/generate-sheets-dialog';
import { TermDatesEditor } from '@/components/sis/term-dates-editor';
import { AyPicker } from '@/components/sis/year-setup/ay-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import type { AcademicYearListItem, TermRow } from '@/lib/sis/ay-setup/queries';
import {
  nextIncompleteStepId,
  type AyReadiness,
  type ReadinessStep,
  type ReadinessStepId,
} from '@/lib/sis/readiness';
import {
  AY_STATUS_LABEL,
  ayStatusTone,
  checklistSummary,
  type AyStatusTone,
} from '@/lib/sis/year-setup';

// Row status-tile icon per item — kept identical to the retired stepper's
// `STEP_ICONS` map (renamed per the approved design: "ITEM_ICONS").
const ITEM_ICONS: Record<ReadinessStepId, LucideIcon> = {
  'ay-setup': CalendarCog,
  calendar: CalendarDays,
  sections: School,
  'subject-weights': LayoutGrid,
  advisers: Users,
  'section-subjects': BookOpen,
  'grading-sheets': ClipboardList,
  'virtue-themes': Sparkles,
  letterhead: Stamp,
  'app-window': ListChecks,
};

const STATUS_BADGE_CLASS: Record<AyStatusTone, string> = {
  active: 'h-6 border-brand-mint bg-brand-mint/30 text-ink',
  'early-bird': 'h-6 border-brand-indigo-soft bg-accent text-brand-indigo-deep',
  inactive: 'h-6 text-muted-foreground',
};

function StepStatusBadge({ step }: { step: ReadinessStep }) {
  if (step.status === 'done') {
    return (
      <Badge
        variant="outline"
        className="h-6 gap-1 border-brand-mint bg-brand-mint/30 text-ink"
      >
        <CheckCircle2 className="size-3" /> Ready
      </Badge>
    );
  }
  if (step.status === 'partial') {
    return (
      <Badge
        variant="outline"
        className="h-6 gap-1 border-brand-amber bg-brand-amber/20 text-ink"
      >
        <Clock className="size-3" /> In progress
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="h-6 gap-1 text-muted-foreground">
      <CircleDashed className="size-3" />{' '}
      {step.required ? 'Not started' : 'Optional'}
    </Badge>
  );
}

// Gradient status tile — mint/amber use the app's semantic gradient recipe
// (matches `components/sis/system-health-strip.tsx` etc.); muted `not-started`
// stays flat as the neutral absence state, not a semantic color.
function StatusTile({ step }: { step: ReadinessStep }) {
  const Icon = ITEM_ICONS[step.id];
  if (step.status === 'done') {
    return (
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-mint to-brand-sky text-ink shadow-brand-tile-mint">
        <CheckCircle2 className="size-5" />
      </div>
    );
  }
  if (step.status === 'partial') {
    return (
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-amber to-brand-amber/80 text-white shadow-brand-tile-amber">
        <Clock className="size-5" />
      </div>
    );
  }
  return (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
      <Icon className="size-5" />
    </div>
  );
}

// Shared row shell: status tile, title + live summary, status badge, and the
// row's action(s) on the right (`action`). An optional `below` block renders
// full-width beneath the row — used by the virtue-themes Collapsible content
// and the app-window caption.
function ChecklistRow({
  step,
  summary,
  isNextUp,
  action,
  below,
  collapsible,
}: {
  step: ReadinessStep;
  summary: string;
  isNextUp: boolean;
  action: ReactNode;
  below?: ReactNode;
  /**
   * When set, the row content + `below` render inside a single Collapsible
   * root (the `action` trigger and the `below` content are authored by the
   * caller as `CollapsibleTrigger`/`CollapsibleContent` and just need a
   * shared ancestor `Collapsible.Root` — provided here — to find their
   * context). Mirrors the single-Collapsible pattern in
   * `components/attendance/sheet-context.tsx`.
   */
  collapsible?: { open: boolean; onOpenChange: (open: boolean) => void };
}) {
  const rowContent = (
    <div className="flex flex-wrap items-start gap-4 px-6 py-4">
      <StatusTile step={step} />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-serif text-[15.5px] font-semibold leading-tight text-foreground">
          {isNextUp && <span className="sr-only">Next up: </span>}
          {step.label}
        </p>
        <p className="text-[13px] tabular-nums text-muted-foreground">
          {summary}
        </p>
      </div>
      <div className="flex shrink-0 items-center">
        <StepStatusBadge step={step} />
      </div>
      {/* gap-3 (was gap-2) — Fitts's Law: the ghost secondary button sat too
          close to the primary CTA's click zone in rows with two actions
          (calendar/classes/grading-sheets). */}
      <div className="flex shrink-0 flex-wrap items-center gap-3">{action}</div>
    </div>
  );

  return (
    <li
      data-testid={`checklist-row-${step.id}`}
      className={cn(
        isNextUp && 'border-l-2 border-l-brand-indigo bg-accent/30'
      )}
    >
      {collapsible ? (
        <Collapsible
          open={collapsible.open}
          onOpenChange={collapsible.onOpenChange}
        >
          {rowContent}
          {below}
        </Collapsible>
      ) : (
        <>
          {rowContent}
          {below}
        </>
      )}
    </li>
  );
}

export function YearSetupChecklist({
  ays,
  selectedAy,
  selectedTerms,
  readiness,
}: {
  ays: Array<{ ayCode: string; label: string; isCurrent: boolean }>;
  selectedAy: AcademicYearListItem | null;
  selectedTerms: TermRow[];
  readiness: AyReadiness | null;
}) {
  const [virtueOpen, setVirtueOpen] = useState(false);
  const steps = readiness?.steps ?? [];

  if (!selectedAy || !readiness || steps.length === 0) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <CalendarCog className="size-5" />
          </div>
          <p className="font-serif text-lg font-semibold text-foreground">
            No academic year yet
          </p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Create an academic year to start setting up its terms, calendar,
            classes, and grading sheets.
          </p>
        </div>
      </Card>
    );
  }

  const tone = ayStatusTone(selectedAy);
  const allDone = readiness.complete === readiness.total;
  // Only ever points at a required-but-incomplete step — `nextIncompleteStepId`
  // falls back to steps[0] when everything required is done, which would
  // wrongly re-accent a finished row, so that fallback is short-circuited here.
  const nextUpId = allDone ? null : nextIncompleteStepId(steps);

  const t13 = selectedTerms
    .filter((t) => t.term_number <= 3)
    .sort((a, b) => a.term_number - b.term_number)
    .map((t) => ({
      id: t.id,
      label: t.label,
      termNumber: t.term_number,
      startDate: t.start_date,
      endDate: t.end_date,
      virtueTheme: t.virtue_theme ?? '',
    }));

  const firstOptionalId = steps.find((s) => !s.required)?.id ?? null;

  // Sub-group the 10 flat rows into 3 clusters (Miller's Law — layout
  // redesign pass): the ids genuinely span different domains (dates/
  // calendar/staffing vs grading vs branding/admissions) with no visual
  // grouping today. Purely a label inserted between rows, same mechanism
  // as the existing "Optional" divider below — not a new pattern. The
  // label sits before 'sections' (Task 5: split out of the old combined
  // 'classes' step) since sections/subject-weights/advisers/section-
  // subjects/grading-sheets all belong to the same cluster.
  const CLUSTER_LABEL_BEFORE: Partial<Record<ReadinessStepId, string>> = {
    'ay-setup': 'Core setup',
    sections: 'Grading & staffing',
    'virtue-themes': 'Branding & admissions',
  };

  return (
    <div className="space-y-4">
      {/* AY picker + status only — the page header's own "N/M ready" badge
          (ay-setup/page.tsx) is the readiness glance now; this strip used to
          duplicate that exact number in a second progress bar right below it
          (layout redesign pass — signal dilution, Von Restorff). */}
      <div className="flex flex-wrap items-center gap-2">
        <AyPicker ays={ays} selected={selectedAy.ay_code} />
        <Badge variant="outline" className={STATUS_BADGE_CLASS[tone]}>
          {AY_STATUS_LABEL[tone]}
        </Badge>
      </div>

      <Card className="gap-0 py-0">
        <CardHeader className="gap-1.5 border-b border-border py-5">
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Setup checklist
          </CardDescription>
          <CardTitle className="font-serif text-[22px] font-semibold text-foreground">
            {allDone
              ? `${selectedAy.label} setup is done.`
              : `Getting ${selectedAy.label} ready.`}
          </CardTitle>
          {allDone && (
            <CardAction>
              <Badge
                variant="outline"
                className="h-6 gap-1 border-brand-mint bg-brand-mint/30 text-ink"
              >
                <CheckCircle2 className="size-3" /> Minimums met for{' '}
                {selectedAy.label}
              </Badge>
            </CardAction>
          )}
          <p className="text-sm text-muted-foreground">
            {allDone
              ? 'Every required item has at least the minimum in place.'
              : 'Work through each item below, in any order.'}
          </p>
        </CardHeader>

        <ul className="divide-y divide-border">
          {steps.map((step) => {
            const isNextUp = step.id === nextUpId;
            const summary = checklistSummary(step.id, {
              step,
              ay: selectedAy,
              terms: selectedTerms,
            });
            const primaryVariant = isNextUp ? 'default' : 'outline';

            let action: ReactNode = null;
            let below: ReactNode = undefined;
            let collapsible:
              | { open: boolean; onOpenChange: (open: boolean) => void }
              | undefined;

            switch (step.id) {
              case 'ay-setup':
                action = (
                  <TermDatesEditor
                    ayCode={selectedAy.ay_code}
                    ayLabel={selectedAy.label}
                    terms={selectedTerms}
                  >
                    <Button variant={primaryVariant} size="sm">
                      Edit term dates
                    </Button>
                  </TermDatesEditor>
                );
                break;

              case 'calendar':
                action = (
                  <>
                    <GenerateCalendarButton
                      ayCode={selectedAy.ay_code}
                      variant={primaryVariant}
                    />
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={step.href}>
                        Open calendar <ArrowUpRight className="size-3.5" />
                      </Link>
                    </Button>
                  </>
                );
                break;

              case 'sections':
                action = (
                  <Button variant={primaryVariant} size="sm" asChild>
                    <Link href={step.href}>
                      Open Sections <ArrowUpRight className="size-3.5" />
                    </Link>
                  </Button>
                );
                break;

              case 'subject-weights':
                action = (
                  <Button variant={primaryVariant} size="sm" asChild>
                    <Link href={step.href}>
                      Open Subject weights <ArrowUpRight className="size-3.5" />
                    </Link>
                  </Button>
                );
                break;

              case 'advisers':
                action = (
                  <Button variant={primaryVariant} size="sm" asChild>
                    <Link href={step.href}>
                      Open Sections <ArrowUpRight className="size-3.5" />
                    </Link>
                  </Button>
                );
                break;

              case 'section-subjects':
                action = (
                  <Button variant={primaryVariant} size="sm" asChild>
                    <Link href={step.href}>
                      Open Sections <ArrowUpRight className="size-3.5" />
                    </Link>
                  </Button>
                );
                break;

              case 'grading-sheets':
                action = (
                  <>
                    <GenerateSheetsDialog
                      scope={{
                        kind: 'ay',
                        ayId: selectedAy.id,
                        ayCode: selectedAy.ay_code,
                      }}
                    >
                      <Button variant={primaryVariant} size="sm">
                        Create grading sheets
                      </Button>
                    </GenerateSheetsDialog>
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={step.href}>
                        Open Markbook sections{' '}
                        <ArrowUpRight className="size-3.5" />
                      </Link>
                    </Button>
                  </>
                );
                break;

              case 'virtue-themes':
                collapsible = { open: virtueOpen, onOpenChange: setVirtueOpen };
                action = (
                  <CollapsibleTrigger asChild>
                    <Button variant={primaryVariant} size="sm">
                      {virtueOpen ? 'Hide' : 'Set virtue themes'}
                      <ChevronDown
                        className={cn(
                          'size-3.5 transition-transform',
                          virtueOpen && 'rotate-180'
                        )}
                      />
                    </Button>
                  </CollapsibleTrigger>
                );
                below = (
                  <CollapsibleContent>
                    <div className="px-6 pb-4 pl-[4.5rem]">
                      {t13.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                          Set term dates first.
                        </p>
                      ) : (
                        <VirtueThemesEditor terms={t13} />
                      )}
                    </div>
                  </CollapsibleContent>
                );
                break;

              case 'letterhead':
                action = (
                  <Button variant={primaryVariant} size="sm" asChild>
                    <Link href={step.href}>
                      Open School config <ArrowUpRight className="size-3.5" />
                    </Link>
                  </Button>
                );
                break;

              case 'app-window':
                action = (
                  <AyAcceptingApplicationsToggle
                    ayCode={selectedAy.ay_code}
                    current={selectedAy.accepting_applications}
                    isCurrentAy={selectedAy.is_current}
                  />
                );
                below = (
                  <div className="px-6 pb-4 pl-[4.5rem] text-[12px] leading-relaxed text-muted-foreground">
                    {selectedAy.is_current
                      ? 'Live application window for the active year.'
                      : 'Only one upcoming year can be open at a time — opening this one closes any other.'}
                  </div>
                );
                break;

              default:
                action = null;
            }

            const clusterLabel = CLUSTER_LABEL_BEFORE[step.id];

            return (
              <Fragment key={step.id}>
                {clusterLabel && (
                  <li
                    role="presentation"
                    data-testid={`cluster-divider-${step.id}`}
                    className="bg-muted/30 px-6 py-2"
                  >
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      {clusterLabel}
                    </p>
                  </li>
                )}
                {step.id === firstOptionalId && (
                  <li
                    role="presentation"
                    data-testid="optional-divider"
                    className="bg-muted/30 px-6 py-2"
                  >
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      Optional
                    </p>
                  </li>
                )}
                <ChecklistRow
                  step={step}
                  summary={summary}
                  isNextUp={isNextUp}
                  action={action}
                  below={below}
                  collapsible={collapsible}
                />
              </Fragment>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

function GenerateCalendarButton({
  ayCode,
  variant = 'default',
}: {
  ayCode: string;
  variant?: 'default' | 'outline';
}) {
  const m = useMutation({
    mutationFn: () =>
      apiFetch<{ inserted?: number }>(
        '/api/sis/ay-setup/seed-calendar',
        jsonInit('POST', { ay_code: ayCode })
      ),
  });

  const run = useWriteAction();
  const [busy, setBusy] = useState(false);

  async function seed() {
    setBusy(true);
    await run(() => m.mutateAsync(), {
      pending: 'Generating school days…',
      success: (data) =>
        `School days generated (${data?.inserted ?? 0} added).`,
      error: (e) =>
        e instanceof Error ? e.message : 'Could not generate school days.',
    });
    setBusy(false);
  }

  return (
    <Button
      variant={variant}
      size="sm"
      onClick={() => void seed()}
      loading={busy}
      loadingText="Generating…"
    >
      Generate school days
    </Button>
  );
}
