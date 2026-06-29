'use client';

import { useMutation } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarCog,
  CalendarDays,
  CheckCircle2,
  CircleDashed,
  ClipboardList,
  Clock,
  LayoutGrid,
  ListChecks,
  Loader2,
  Sparkles,
  Stamp,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { VirtueThemesEditor } from '@/components/evaluation/virtue-themes-editor';
import { AyAcceptingApplicationsToggle } from '@/components/sis/ay-accepting-applications-toggle';
import { GenerateSheetsDialog } from '@/components/sis/generate-sheets-dialog';
import { TermDatesEditor } from '@/components/sis/term-dates-editor';
import { AyPicker } from '@/components/sis/year-setup/ay-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
  type AyStatusTone,
} from '@/lib/sis/year-setup';

const STEP_ICONS: Record<ReadinessStepId, LucideIcon> = {
  'ay-setup': CalendarCog,
  calendar: CalendarDays,
  classes: LayoutGrid,
  advisers: Users,
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

export function YearSetupStepper({
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
  const steps = readiness?.steps ?? [];
  const initialId: ReadinessStepId =
    steps.length > 0 ? nextIncompleteStepId(steps) : 'ay-setup';
  const [activeId, setActiveId] = useState<ReadinessStepId>(initialId);

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

  const activeIndex = Math.max(
    0,
    steps.findIndex((s) => s.id === activeId)
  );
  const active = steps[activeIndex];
  const ActiveIcon = STEP_ICONS[active.id];
  const tone = ayStatusTone(selectedAy);
  const pct =
    readiness.total > 0
      ? Math.round((readiness.complete / readiness.total) * 100)
      : 0;
  const allDone = readiness.complete === readiness.total;

  return (
    <div className="overflow-hidden rounded-xl border border-border shadow-xs">
      <div className="flex">
        {/* Left rail — navigation chrome: AY meta + step list */}
        <div className="flex w-64 shrink-0 flex-col border-r border-border bg-accent/50">
          {/* AY meta + progress + resume */}
          <div className="space-y-3 border-b border-border px-4 py-4">
            <div className="space-y-1.5">
              <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Year Setup
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <AyPicker ays={ays} selected={selectedAy.ay_code} />
                <Badge variant="outline" className={STATUS_BADGE_CLASS[tone]}>
                  {AY_STATUS_LABEL[tone]}
                </Badge>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between font-mono text-[10px] text-muted-foreground">
                <span>Readiness</span>
                <span className="tabular-nums">
                  {readiness.complete} / {readiness.total} ready
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-brand-indigo/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-brand-indigo to-brand-sky transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
            {!allDone && (
              <Button
                size="sm"
                className="w-full"
                onClick={() => setActiveId(nextIncompleteStepId(steps))}
              >
                Resume <ArrowRight className="size-3.5" />
              </Button>
            )}
          </div>

          {/* Step buttons */}
          <nav className="flex flex-col gap-0.5 p-2" aria-label="Setup steps">
            {steps.map((s) => {
              const isActive = s.id === active.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActiveId(s.id)}
                  aria-current={isActive ? 'step' : undefined}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                    isActive
                      ? 'bg-card font-semibold text-brand-indigo-deep shadow-xs ring-1 ring-inset ring-brand-indigo-soft'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  )}
                >
                  {/* Numbered status tile: position + completion at a glance */}
                  <span
                    aria-hidden
                    className={cn(
                      'flex size-6 shrink-0 items-center justify-center rounded-md font-mono text-[10px] font-bold',
                      isActive
                        ? 'bg-brand-indigo text-white'
                        : s.status === 'done'
                          ? 'bg-brand-mint text-ink'
                          : s.status === 'partial'
                            ? 'bg-brand-amber/40 text-ink ring-1 ring-inset ring-brand-amber'
                            : s.required
                              ? 'bg-accent text-muted-foreground ring-1 ring-inset ring-brand-indigo-soft'
                              : 'bg-muted/60 text-muted-foreground/50'
                    )}
                  >
                    {s.step}
                  </span>
                  <span className="flex-1 leading-tight">{s.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Right panel — active step content */}
        <div className="flex min-w-0 flex-1 flex-col bg-card">
          {/* Step header */}
          <div className="flex items-start justify-between gap-4 border-b border-border bg-gradient-to-b from-accent/20 to-transparent px-6 py-5">
            <div className="flex items-start gap-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <ActiveIcon className="size-5" />
              </div>
              <div className="space-y-1">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Step {active.step} of {steps.length}
                </p>
                <h2 className="font-serif text-[22px] font-semibold leading-tight text-foreground">
                  {active.label}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {active.description}
                </p>
                {active.fraction && (
                  <p className="font-mono text-[11px] font-semibold tabular-nums text-brand-indigo-deep">
                    {active.fraction.done} of {active.fraction.total} complete
                  </p>
                )}
              </div>
            </div>
            <StepStatusBadge step={active} />
          </div>

          {/* Step content */}
          <div className="flex-1 px-6 py-6">
            <StepPanel
              step={active}
              selectedAy={selectedAy}
              selectedTerms={selectedTerms}
            />
          </div>

          {/* Navigation footer */}
          <div className="flex items-center justify-between border-t border-border px-6 py-3">
            <Button
              variant="outline"
              size="sm"
              disabled={activeIndex <= 0}
              onClick={() => setActiveId(steps[activeIndex - 1].id)}
            >
              <ArrowLeft className="size-3.5" /> Back
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={activeIndex >= steps.length - 1}
              onClick={() => setActiveId(steps[activeIndex + 1].id)}
            >
              Next <ArrowRight className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PanelShell({
  hint,
  children,
}: {
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted-foreground">{hint}</p>
      {children}
    </div>
  );
}

function StepPanel({
  step,
  selectedAy,
  selectedTerms,
}: {
  step: ReadinessStep;
  selectedAy: AcademicYearListItem;
  selectedTerms: TermRow[];
}) {
  switch (step.id) {
    case 'ay-setup':
      return (
        <PanelShell hint="Set each term's start and end date. Dates unlock the school calendar and report-card publish windows.">
          <TermDatesEditor
            ayCode={selectedAy.ay_code}
            ayLabel={selectedAy.label}
            terms={selectedTerms}
          >
            <Button>Edit term dates</Button>
          </TermDatesEditor>
        </PanelShell>
      );
    case 'calendar':
      return (
        <PanelShell hint="Generate the standard weekday school days for every term, then open the calendar to mark holidays and home-based learning days.">
          <div className="flex flex-wrap gap-2">
            <GenerateCalendarButton ayCode={selectedAy.ay_code} />
            <Button variant="outline" asChild>
              <Link href="/sis/calendar">
                Open calendar <ArrowUpRight className="size-3.5" />
              </Link>
            </Button>
          </div>
        </PanelShell>
      );
    case 'classes':
      return (
        <PanelShell hint="Apply the master class template to create this year's classes and their subject weights.">
          <div className="flex flex-wrap gap-2">
            <ApplyTemplateButton ayCode={selectedAy.ay_code} />
            <Button variant="outline" asChild>
              <Link href="/sis/admin/template">
                Open class template <ArrowUpRight className="size-3.5" />
              </Link>
            </Button>
          </div>
        </PanelShell>
      );
    case 'advisers':
      return (
        <PanelShell hint="Assign a form adviser to each class. This happens on the Sections page.">
          <Button variant="outline" asChild>
            <Link href="/sis/sections">
              Open Sections <ArrowUpRight className="size-3.5" />
            </Link>
          </Button>
        </PanelShell>
      );
    case 'grading-sheets':
      return (
        <PanelShell hint="Create one grading sheet per class, subject, and term — for every class at once.">
          <div className="flex flex-wrap gap-2">
            <GenerateSheetsDialog
              scope={{
                kind: 'ay',
                ayId: selectedAy.id,
                ayCode: selectedAy.ay_code,
              }}
            >
              <Button>Create grading sheets</Button>
            </GenerateSheetsDialog>
            <Button variant="outline" asChild>
              <Link href="/markbook/sections">
                Open Markbook sections <ArrowUpRight className="size-3.5" />
              </Link>
            </Button>
          </div>
        </PanelShell>
      );
    case 'virtue-themes': {
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
      return (
        <PanelShell hint="Set the virtue theme for Terms 1–3. It appears as the heading of the report-card form-class-adviser comments.">
          {t13.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              Set term dates first.
            </p>
          ) : (
            <VirtueThemesEditor terms={t13} />
          )}
        </PanelShell>
      );
    }
    case 'letterhead':
      return (
        <PanelShell hint="The organization name and address printed on report cards, set school-wide in School config. Usually already set for HFSE.">
          <Button variant="outline" asChild>
            <Link href="/sis/admin/school-config">
              Open School config <ArrowUpRight className="size-3.5" />
            </Link>
          </Button>
        </PanelShell>
      );
    case 'app-window':
      return (
        <PanelShell hint="Optional. Open this year for parent applications — early-bird for a future year, or live for the active year.">
          <AyAcceptingApplicationsToggle
            ayCode={selectedAy.ay_code}
            current={selectedAy.accepting_applications}
            isCurrentAy={selectedAy.is_current}
          />
        </PanelShell>
      );
    default:
      return null;
  }
}

function GenerateCalendarButton({ ayCode }: { ayCode: string }) {
  const router = useRouter();
  const m = useMutation({
    mutationFn: () =>
      apiFetch(
        '/api/sis/ay-setup/seed-calendar',
        jsonInit('POST', { ay_code: ayCode })
      ),
    onSuccess: (data: unknown) => {
      const inserted = (data as { inserted?: number })?.inserted ?? 0;
      toast.success(`School days generated (${inserted} added).`);
      router.refresh();
    },
    onError: (e) =>
      toast.error(
        e instanceof Error ? e.message : 'Could not generate school days.'
      ),
  });
  return (
    <Button onClick={() => m.mutate()} disabled={m.isPending}>
      {m.isPending && <Loader2 className="size-3.5 animate-spin" />}
      Generate school days
    </Button>
  );
}

function ApplyTemplateButton({ ayCode }: { ayCode: string }) {
  const router = useRouter();
  const m = useMutation({
    mutationFn: () =>
      apiFetch(
        '/api/sis/admin/template/apply',
        jsonInit('POST', { ay_codes: [ayCode] })
      ),
    onSuccess: () => {
      toast.success('Class template applied.');
      router.refresh();
    },
    onError: (e) =>
      toast.error(
        e instanceof Error ? e.message : 'Could not apply the template.'
      ),
  });
  return (
    <Button onClick={() => m.mutate()} disabled={m.isPending}>
      {m.isPending && <Loader2 className="size-3.5 animate-spin" />}
      Apply class template
    </Button>
  );
}
