import Link from 'next/link';
import {
  ArrowUpRight,
  CalendarCog,
  CalendarDays,
  CheckCircle2,
  CircleDashed,
  ClipboardList,
  Clock,
  LayoutGrid,
  Sparkles,
  Stamp,
  type LucideIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { AyAcceptingApplicationsToggle } from '@/components/sis/ay-accepting-applications-toggle';
import { TermDatesEditor } from '@/components/sis/term-dates-editor';
import { AyPicker } from '@/components/sis/year-setup/ay-picker';
import {
  AY_STATUS_LABEL,
  ayStatusTone,
  type AyStatusTone,
} from '@/lib/sis/year-setup';
import type { AcademicYearListItem, TermRow } from '@/lib/sis/ay-setup/queries';
import type {
  AyReadiness,
  ReadinessStep,
  ReadinessStepId,
} from '@/lib/sis/readiness';

const STEP_ICONS: Partial<Record<ReadinessStepId, LucideIcon>> = {
  'ay-setup': CalendarCog,
  calendar: CalendarDays,
  'grading-sheets': ClipboardList,
};

const STATUS_BADGE_CLASS: Record<AyStatusTone, string> = {
  active: 'h-6 border-brand-mint bg-brand-mint/30 text-ink',
  'early-bird': 'h-6 border-brand-indigo-soft bg-accent text-brand-indigo-deep',
  inactive: 'h-6 text-muted-foreground',
};

function StepStatusBadge({ status }: { status: ReadinessStep['status'] }) {
  if (status === 'done') {
    return (
      <Badge
        variant="outline"
        className="h-6 gap-1 border-brand-mint bg-brand-mint/30 text-ink"
      >
        <CheckCircle2 className="size-3" /> Ready
      </Badge>
    );
  }
  if (status === 'partial') {
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
      <CircleDashed className="size-3" /> Not started
    </Badge>
  );
}

function LinkRow({
  icon: Icon,
  title,
  description,
  href,
  emphasized = false,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  emphasized?: boolean;
}) {
  return (
    <li
      className={
        'flex items-center justify-between gap-4 px-6 py-4' +
        (emphasized ? ' bg-brand-amber/5' : '')
      }
    >
      <div className="flex items-start gap-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </div>
        <div className="space-y-1">
          <p className="font-medium text-foreground">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <Button variant="ghost" size="sm" className="gap-1" asChild>
        <Link href={href}>
          Open
          <ArrowUpRight className="size-3.5" />
        </Link>
      </Button>
    </li>
  );
}

export function YearSetupControlCenter({
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
  if (!selectedAy || !readiness) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <CalendarCog className="size-5" />
          </div>
          <p className="font-serif text-lg font-semibold text-foreground">
            No academic year yet
          </p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Create an academic year to start setting up its terms, calendar,
            sections, and grading sheets.
          </p>
        </CardContent>
      </Card>
    );
  }

  const tone = ayStatusTone(selectedAy);
  const pct =
    readiness.total > 0
      ? Math.round((readiness.complete / readiness.total) * 100)
      : 0;
  const needsTemplate =
    selectedAy.counts.sections === 0 || selectedAy.counts.subject_configs === 0;

  return (
    <div className="space-y-6">
      {/* AY picker + status + readiness summary */}
      <Card>
        <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              Configuring
            </CardDescription>
            <div className="flex flex-wrap items-center gap-3">
              <AyPicker ays={ays} selected={selectedAy.ay_code} />
              <Badge variant="outline" className={STATUS_BADGE_CLASS[tone]}>
                {AY_STATUS_LABEL[tone]}
              </Badge>
            </div>
          </div>
          <div className="min-w-[220px] space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-foreground">
                Core readiness
              </span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {readiness.complete} / {readiness.total} ready
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand-indigo-soft to-brand-sky transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Tier 1 — Core readiness steps */}
      <Card className="gap-0 py-0">
        <CardHeader className="border-b border-border py-5">
          <CardDescription>Core readiness</CardDescription>
          <CardTitle className="font-serif text-[22px]">
            Make the year ready
          </CardTitle>
        </CardHeader>
        <ul className="divide-y divide-border">
          {readiness.steps.map((step) => {
            const Icon = STEP_ICONS[step.id] ?? CalendarCog;
            return (
              <li key={step.id} className="flex items-start gap-4 px-6 py-4">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                  <Icon className="size-4" />
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground">{step.label}</p>
                    <StepStatusBadge status={step.status} />
                    {step.fraction ? (
                      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                        {step.fraction.done}/{step.fraction.total} sections
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {step.description}
                  </p>
                </div>
                <div className="mt-0.5 shrink-0">
                  {step.id === 'ay-setup' ? (
                    <TermDatesEditor
                      ayCode={selectedAy.ay_code}
                      ayLabel={selectedAy.label}
                      terms={selectedTerms}
                    >
                      <Button variant="outline" size="sm">
                        Edit term dates
                      </Button>
                    </TermDatesEditor>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      asChild
                    >
                      <Link href={step.href}>
                        Open
                        <ArrowUpRight className="size-3.5" />
                      </Link>
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {/* Tier 2/3 + convenient links */}
      <Card className="gap-0 py-0">
        <CardHeader className="border-b border-border py-5">
          <CardDescription>More setup</CardDescription>
          <CardTitle className="font-serif text-[22px]">
            Admissions & school-wide
          </CardTitle>
        </CardHeader>
        <ul className="divide-y divide-border">
          <li className="flex items-center justify-between gap-4 px-6 py-4">
            <div className="flex items-start gap-4">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <CalendarDays className="size-4" />
              </div>
              <div className="space-y-1">
                <p className="font-medium text-foreground">
                  Application window
                </p>
                <p className="text-sm text-muted-foreground">
                  Open or close early-bird applications for this year.
                </p>
              </div>
            </div>
            <AyAcceptingApplicationsToggle
              ayCode={selectedAy.ay_code}
              current={selectedAy.accepting_applications}
              isCurrentAy={selectedAy.is_current}
            />
          </li>
          <LinkRow
            icon={LayoutGrid}
            title="Class template & subjects"
            description={
              needsTemplate
                ? 'This year has no sections or subjects yet — set up the class template first.'
                : 'Edit the section list and subject weights that new years copy from.'
            }
            href="/sis/admin/template"
            emphasized={needsTemplate}
          />
          <LinkRow
            icon={Sparkles}
            title="Virtue themes"
            description="Set each term's virtue theme, shown on report-card comments."
            href="/evaluation/virtue-themes"
          />
          <LinkRow
            icon={Stamp}
            title="Letterhead & school details"
            description="Organization name, address, and the report-card letterhead."
            href="/sis/admin/school-config"
          />
        </ul>
      </Card>
    </div>
  );
}
