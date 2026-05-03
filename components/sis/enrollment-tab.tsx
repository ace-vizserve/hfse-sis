import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Circle,
  ClipboardList,
  Compass,
  CreditCard,
  FileCheck,
  GraduationCap,
  Heart,
  Package,
  PenLine,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Tags,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';

import { EditStageDialog } from '@/components/sis/edit-stage-dialog';
import { type Field } from '@/components/sis/field-grid';
import { StageStatusBadge } from '@/components/sis/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ENROLLED_PREREQ_STAGES, type StageKey } from '@/lib/schemas/sis';
import { isFieldEmpty } from '@/lib/sis/field-helpers';
import type { ApplicationRow, StatusRow } from '@/lib/sis/queries';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// EnrollmentTab — STATUS UI (take 2: status-driven richness, no progress).
//
// HFSE freely changes any stage status at any time and in any order before
// the final enrollment decision is recorded. This tab presents each of the
// 9 stages as an independent editable status — no pipeline stepper, no
// prereq lock visualization, no "next action" pressure, no progress bar.
//
// Visual richness is added via STATUS-driven signals (not sequence):
//   - left-edge stripe color-keyed to the current stage status (mint=done,
//     amber=pending, destructive=cancelled, indigo=in-progress)
//   - per-stage gradient icon tile + serif title (mental-map by glyph)
//   - prominent StageStatusBadge as the visual anchor
//   - hover lift per the §7 craft standard
//   - always-visible edit button (no hover-to-reveal)
//
// Server-side enforcement still applies: the application stage's terminal
// `Enrolled` status requires all 5 prereqs to be marked complete. That
// enforcement lives in EditStageDialog + the stage PATCH route; the UI
// shows the resulting error if the user attempts an invalid transition.
// ─────────────────────────────────────────────────────────────────────────────

type Props = {
  status: StatusRow | null;
  app: ApplicationRow;
  ayCode: string;
  enroleeNumber: string;
  statusFetchError: boolean;
  /** Current assigned section's UUID — resolved by the page from
   *  classLevel + classSection. Drives the "Move to another section →"
   *  CTA on the class stage tile. Null when pre-Enrolled or section was
   *  renamed/dropped after AY rollover. */
  currentSectionId?: string | null;
};

type StageCard = {
  key: StageKey;
  label: string;
  status: string | null;
  remarks: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  extras?: Field[];
  extrasInitial: Record<string, string | null>;
};

type ApplicationTone = 'enrolled' | 'enrolledConditional' | 'cancelled' | 'withdrawn' | 'open';

const APPLICATION_TILE: Record<
  ApplicationTone,
  { gradient: string; bandTint: string; bandBorder: string; icon: LucideIcon; label: string }
> = {
  enrolled: {
    gradient: 'from-brand-mint to-brand-sky',
    bandTint: 'bg-brand-mint/10',
    bandBorder: 'border-brand-mint/30',
    icon: CheckCircle2,
    label: 'Enrolled',
  },
  enrolledConditional: {
    gradient: 'from-brand-amber to-brand-amber/80',
    bandTint: 'bg-brand-amber/10',
    bandBorder: 'border-brand-amber/40',
    icon: ShieldCheck,
    label: 'Enrolled (Conditional)',
  },
  cancelled: {
    gradient: 'from-destructive to-destructive/80',
    bandTint: 'bg-destructive/10',
    bandBorder: 'border-destructive/30',
    icon: X,
    label: 'Cancelled',
  },
  withdrawn: {
    gradient: 'from-destructive to-destructive/80',
    bandTint: 'bg-destructive/10',
    bandBorder: 'border-destructive/30',
    icon: X,
    label: 'Withdrawn',
  },
  open: {
    gradient: 'from-brand-indigo to-brand-navy',
    bandTint: 'bg-muted/30',
    bandBorder: 'border-hairline',
    icon: ClipboardList,
    label: 'In progress',
  },
};

// Status-driven left-stripe color. Single source of truth — the stage tile's
// stripe and the StageStatusBadge variant must read as the SAME tone, since
// both answer the same question ("what state is this stage in?"). Status
// values are the canonical set from STAGE_STATUS_OPTIONS in lib/schemas/sis.
function statusStripeClass(status: string | null): string {
  const s = (status ?? '').trim();
  if (!s) return 'bg-border';
  // Done — terminal-positive.
  if (
    /^(finished|verified|paid|signed|claimed|enrolled|enrolled \(conditional\))$/i.test(s)
  ) {
    return 'bg-brand-mint';
  }
  // Failed — terminal-negative.
  if (/^(cancelled|withdrawn|rejected|expired)$/i.test(s)) {
    return 'bg-destructive/70';
  }
  // Pending — needs attention.
  if (/^(pending|unpaid|incomplete)$/i.test(s)) {
    return 'bg-brand-amber';
  }
  // Active / in-flight.
  if (
    /^(submitted|ongoing verification|processing|ongoing assessment|generated|sent|invoiced|re-invoiced)$/i.test(
      s,
    )
  ) {
    return 'bg-brand-indigo';
  }
  return 'bg-border';
}

// Per-stage iconography. Used in the stage-tile's top-left gradient tile
// and in the section-card's CardAction. Builds an admissions-officer mental
// map: "the assessment one with the cap" beats "the third tile in the
// second card" when scanning the page.
const STAGE_ICON: Record<StageKey, LucideIcon> = {
  application: ClipboardList,
  registration: ReceiptText,
  documents: FileCheck,
  assessment: GraduationCap,
  contract: PenLine,
  fees: CreditCard,
  class: Users,
  supplies: Package,
  orientation: Compass,
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-SG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function ExtrasChips({ fields }: { fields: Field[] }) {
  const nonEmpty = fields.filter((f) => !isFieldEmpty(f));
  if (nonEmpty.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {nonEmpty.map((f) => {
        const value =
          f.asDate && typeof f.value === 'string'
            ? new Date(f.value).toLocaleDateString('en-SG', { day: '2-digit', month: 'short' })
            : String(f.value ?? '—');
        return (
          <span
            key={f.label}
            className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-muted/40 px-2 py-0.5 text-[11px] text-foreground"
          >
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
              {f.label}
            </span>
            <span className="font-medium tabular-nums">{value}</span>
          </span>
        );
      })}
    </div>
  );
}

// Stage-count rollup for the section-card meta strip. Pure status-driven
// (does NOT compute a "next action" — that would re-introduce sequence).
function stageBucketCounts(stages: StageCard[]): {
  total: number;
  done: number;
  pending: number;
  failed: number;
  active: number;
  empty: number;
} {
  const counts = { total: stages.length, done: 0, pending: 0, failed: 0, active: 0, empty: 0 };
  for (const s of stages) {
    const stripe = statusStripeClass(s.status);
    if (stripe === 'bg-brand-mint') counts.done += 1;
    else if (stripe === 'bg-destructive/70') counts.failed += 1;
    else if (stripe === 'bg-brand-amber') counts.pending += 1;
    else if (stripe === 'bg-brand-indigo') counts.active += 1;
    else counts.empty += 1;
  }
  return counts;
}

// ─── main component ─────────────────────────────────────────────────────────

export function EnrollmentTab({
  status,
  app,
  ayCode,
  enroleeNumber,
  statusFetchError,
  currentSectionId,
}: Props) {
  const s = status ?? ({} as StatusRow);

  const applicationCard: StageCard = {
    key: 'application',
    label: 'Application',
    status: s.applicationStatus,
    remarks: s.applicationRemarks,
    updatedAt: s.applicationUpdatedDate,
    updatedBy: s.applicationUpdatedBy,
    extras: [
      { label: 'Enrolment date', value: s.enrolmentDate, asDate: true },
      { label: 'Enrolee type', value: s.enroleeType },
    ],
    extrasInitial: {},
  };

  const intakeCards: StageCard[] = [
    {
      key: 'registration',
      label: 'Registration',
      status: s.registrationStatus,
      remarks: s.registrationRemarks,
      updatedAt: s.registrationUpdatedDate,
      updatedBy: s.registrationUpdatedBy,
      extras: [
        { label: 'Invoice', value: s.registrationInvoice },
        { label: 'Payment date', value: s.registrationPaymentDate, asDate: true },
      ],
      extrasInitial: {
        invoice: s.registrationInvoice,
        paymentDate: s.registrationPaymentDate,
      },
    },
    {
      key: 'documents',
      label: 'Documents',
      status: s.documentStatus,
      remarks: s.documentRemarks,
      updatedAt: s.documentUpdatedDate,
      updatedBy: s.documentUpdatedBy,
      extrasInitial: {},
    },
    {
      key: 'assessment',
      label: 'Assessment',
      status: s.assessmentStatus,
      remarks: s.assessmentRemarks,
      updatedAt: s.assessmentUpdatedDate,
      updatedBy: s.assessmentUpdatedBy,
      extras: [
        { label: 'Schedule', value: s.assessmentSchedule, asDate: true },
        { label: 'Math', value: s.assessmentGradeMath as string | number | null },
        { label: 'English', value: s.assessmentGradeEnglish as string | number | null },
        { label: 'Medical', value: s.assessmentMedical },
      ],
      extrasInitial: {
        schedule: s.assessmentSchedule,
        math: s.assessmentGradeMath != null ? String(s.assessmentGradeMath) : null,
        english: s.assessmentGradeEnglish != null ? String(s.assessmentGradeEnglish) : null,
        medical: s.assessmentMedical,
      },
    },
  ];

  const commitmentsCards: StageCard[] = [
    {
      key: 'contract',
      label: 'Contract',
      status: s.contractStatus,
      remarks: s.contractRemarks,
      updatedAt: s.contractUpdatedDate,
      updatedBy: s.contractUpdatedBy,
      extrasInitial: {},
    },
    {
      key: 'fees',
      label: 'Fees',
      status: s.feeStatus,
      remarks: s.feeRemarks,
      updatedAt: s.feeUpdatedDate,
      updatedBy: s.feeUpdatedBy,
      extras: [
        { label: 'Invoice', value: s.feeInvoice },
        { label: 'Payment date', value: s.feePaymentDate, asDate: true },
        { label: 'Start date', value: s.feeStartDate, asDate: true },
      ],
      extrasInitial: {
        invoice: s.feeInvoice,
        paymentDate: s.feePaymentDate,
        startDate: s.feeStartDate,
      },
    },
  ];

  const placementCards: StageCard[] = [
    {
      key: 'class',
      label: 'Class assignment',
      status: s.classStatus,
      remarks: s.classRemarks,
      updatedAt: s.classUpdatedDate,
      updatedBy: s.classUpdatedBy,
      extras: [
        { label: 'Class AY', value: s.classAY },
        { label: 'Level', value: s.classLevel },
        { label: 'Section', value: s.classSection },
      ],
      extrasInitial: {
        classAY: s.classAY,
        classLevel: s.classLevel,
        classSection: s.classSection,
      },
    },
    {
      key: 'supplies',
      label: 'Supplies',
      status: s.suppliesStatus,
      remarks: s.suppliesRemarks,
      updatedAt: s.suppliesUpdatedDate,
      updatedBy: s.suppliesUpdatedBy,
      extras: [{ label: 'Claimed date', value: s.suppliesClaimedDate, asDate: true }],
      extrasInitial: { claimedDate: s.suppliesClaimedDate },
    },
    {
      key: 'orientation',
      label: 'Orientation',
      status: s.orientationStatus,
      remarks: s.orientationRemarks,
      updatedAt: s.orientationUpdatedDate,
      updatedBy: s.orientationUpdatedBy,
      extras: [{ label: 'Schedule', value: s.orientationScheduleDate, asDate: true }],
      extrasInitial: { scheduleDate: s.orientationScheduleDate },
    },
  ];

  const applicationStatus = s.applicationStatus ?? null;
  const applicationTone: ApplicationTone =
    applicationStatus === 'Enrolled'
      ? 'enrolled'
      : applicationStatus === 'Enrolled (Conditional)'
        ? 'enrolledConditional'
        : applicationStatus === 'Cancelled'
          ? 'cancelled'
          : applicationStatus === 'Withdrawn'
            ? 'withdrawn'
            : 'open';

  return (
    <div className="space-y-5">
      {statusFetchError && (
        <div className="flex items-start gap-3 rounded-xl border border-brand-amber/40 bg-brand-amber-light/40 p-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-brand-amber" />
          <div className="space-y-1 text-xs leading-relaxed">
            <p className="font-medium text-foreground">Status row lookup returned an error.</p>
            <p className="text-muted-foreground">
              This usually means multiple rows exist in{' '}
              <code className="font-mono">{ayCode.toLowerCase()}_enrolment_status</code> for this
              enrolee — the schema allows duplicates. Status fields below may not reflect reality;
              contact an engineer to dedupe before editing.
            </p>
          </div>
        </div>
      )}

      <ApplicationStatusCard
        applicationCard={applicationCard}
        applicationTone={applicationTone}
        s={s}
        ayCode={ayCode}
        enroleeNumber={enroleeNumber}
      />

      <ProgressOverviewCard
        prereqStages={[...intakeCards, ...commitmentsCards].filter((c) =>
          (ENROLLED_PREREQ_STAGES as readonly StageKey[]).includes(c.key),
        )}
        postEnrolStages={placementCards}
      />

      <StatusGroupCard
        eyebrow="Intake"
        title="Registration, documents & assessment"
        icon={ClipboardList}
        stages={intakeCards}
        ayCode={ayCode}
        enroleeNumber={enroleeNumber}
      />

      <StatusGroupCard
        eyebrow="Commitments"
        title="Contract & fees"
        icon={ShieldCheck}
        stages={commitmentsCards}
        ayCode={ayCode}
        enroleeNumber={enroleeNumber}
      />

      <StatusGroupCard
        eyebrow="Placement"
        title="Class, supplies & orientation"
        icon={GraduationCap}
        stages={placementCards}
        ayCode={ayCode}
        enroleeNumber={enroleeNumber}
        currentSectionId={currentSectionId}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <MedicalCard app={app} />
        <BillingCard app={app} />
      </div>
    </div>
  );
}

// ─── application status card ────────────────────────────────────────────────

function ApplicationStatusCard({
  applicationCard,
  applicationTone,
  s,
  ayCode,
  enroleeNumber,
}: {
  applicationCard: StageCard;
  applicationTone: ApplicationTone;
  s: StatusRow;
  ayCode: string;
  enroleeNumber: string;
}) {
  const tile = APPLICATION_TILE[applicationTone];
  const TileIcon = tile.icon;
  const isEnrolled =
    applicationTone === 'enrolled' || applicationTone === 'enrolledConditional';

  // Headline: status label (always) + class assignment when Enrolled.
  // Single horizontal row — no nested "Current value" framing.
  const classChip =
    isEnrolled && s.classLevel && s.classSection ? `${s.classLevel} · ${s.classSection}` : null;

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <CardHeader className={cn('border-b px-5 py-4', tile.bandBorder)}>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Application status
        </CardDescription>
        <CardTitle className="font-serif text-[18px] font-semibold tracking-tight text-foreground">
          {tile.label}
        </CardTitle>
        <CardAction>
          <div
            className={cn(
              'flex size-10 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-brand-tile',
              tile.gradient,
            )}
          >
            <TileIcon className="size-5" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className={cn('space-y-3 px-5 py-4', tile.bandTint)}>
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-hairline bg-gradient-to-t from-primary/5 to-card p-4 shadow-xs">
          <div
            className={cn(
              'flex size-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-brand-tile',
              tile.gradient,
            )}
          >
            <TileIcon className="size-6" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <p className="font-serif text-base font-semibold leading-snug text-foreground">
                {tile.label}
              </p>
              {classChip && (
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  · {classChip}
                </span>
              )}
              {isEnrolled && !classChip && (
                <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  · Class placement pending
                </span>
              )}
            </div>
            {applicationCard.updatedAt && (
              <p className="font-mono text-[10px] uppercase tracking-wider tabular-nums text-muted-foreground">
                Updated {formatDate(applicationCard.updatedAt)}
                {applicationCard.updatedBy && (
                  <span className="ml-1.5 normal-case text-muted-foreground/80">
                    by {applicationCard.updatedBy}
                  </span>
                )}
              </p>
            )}
          </div>
          <EditStageDialog
            ayCode={ayCode}
            enroleeNumber={enroleeNumber}
            stageKey="application"
            initialStatus={applicationCard.status}
            initialRemarks={applicationCard.remarks}
            initialExtras={applicationCard.extrasInitial}
          />
        </div>

        {applicationCard.extras && applicationCard.extras.some((e) => !isFieldEmpty(e)) && (
          <div className="rounded-lg border border-hairline bg-card px-3 py-2.5">
            <ExtrasChips fields={applicationCard.extras} />
          </div>
        )}
        {applicationCard.remarks && (
          <p className="whitespace-pre-line rounded-lg bg-muted/40 px-3 py-2 text-xs leading-relaxed text-foreground">
            {applicationCard.remarks}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── progress overview card ─────────────────────────────────────────────────
//
// Two clearly-separated rollups so the Enrolled-prereq gate is obvious:
//   1. Required for Enrolled — the 5 prereq stages enforced server-side
//      (ENROLLED_PREREQ_STAGES). Setting applicationStatus='Enrolled' is
//      rejected unless every one is in its terminal-done state.
//   2. Post-enrollment — Class / Supplies / Orientation. These activate
//      after Enrolled and don't gate anything.
//
// Both sections are observational (status rollups, not sequence steppers)
// — order doesn't matter, the bar just shows how many of each set are
// currently in a done state. Single source of truth for color: every chip
// dot, tile left-stripe, and bucket count reuses statusStripeClass.
//
// The application stage itself is excluded — it's the OUTCOME, surfaced by
// ApplicationStatusCard above. Including it here would inflate the count
// once the applicant flips to Enrolled.

function ProgressOverviewCard({
  prereqStages,
  postEnrolStages,
}: {
  prereqStages: StageCard[];
  postEnrolStages: StageCard[];
}) {
  return (
    <Card className="@container/card gap-0 overflow-hidden p-0">
      <CardHeader className="border-b border-border px-5 py-4">
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Stage progress
        </CardDescription>
        <CardTitle className="font-serif text-[18px] font-semibold tracking-tight text-foreground">
          Completion rollup
        </CardTitle>
        <CardAction>
          <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Activity className="size-5" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5 px-5 py-4">
        <ProgressSection eyebrow="Required for Enrolled" stages={prereqStages} />
        <ProgressSection eyebrow="Post-enrollment" stages={postEnrolStages} />
      </CardContent>
    </Card>
  );
}

function ProgressSection({
  eyebrow,
  stages,
}: {
  eyebrow: string;
  stages: StageCard[];
}) {
  const counts = stageBucketCounts(stages);
  const pct = counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0;
  const isComplete = counts.total > 0 && counts.done === counts.total;

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {eyebrow}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {counts.done} of {counts.total} · {pct}%
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full transition-all',
              isComplete
                ? 'bg-gradient-to-r from-brand-mint to-brand-mint/70'
                : 'bg-gradient-to-r from-brand-indigo to-brand-indigo/70',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {stages.map((stage) => (
          <StageProgressChip key={stage.key} stage={stage} />
        ))}
      </div>
    </div>
  );
}

function StageProgressChip({ stage }: { stage: StageCard }) {
  const stripe = statusStripeClass(stage.status);
  return (
    <div className="inline-flex items-center gap-2 rounded-md border border-hairline bg-card px-2.5 py-1.5 shadow-xs">
      <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', stripe)} />
      <span className="font-serif text-xs font-semibold tracking-tight text-foreground">
        {stage.label}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-wider tabular-nums text-muted-foreground">
        {stage.status ?? '—'}
      </span>
    </div>
  );
}

// ─── status group card ──────────────────────────────────────────────────────

function StatusGroupCard({
  eyebrow,
  title,
  icon: Icon,
  stages,
  ayCode,
  enroleeNumber,
  currentSectionId,
}: {
  eyebrow: string;
  title: string;
  icon: LucideIcon;
  stages: StageCard[];
  ayCode: string;
  enroleeNumber: string;
  /** Optional — only meaningful for the Placement group's class tile. */
  currentSectionId?: string | null;
}) {
  const counts = stageBucketCounts(stages);

  // Meta-strip parts — only render the buckets that have rows. Keeps the
  // strip tight; rolls up cleanly to one or two segments on the common
  // case of all-empty or all-pending.
  const metaParts: string[] = [];
  if (counts.done) metaParts.push(`${counts.done} done`);
  if (counts.active) metaParts.push(`${counts.active} active`);
  if (counts.pending) metaParts.push(`${counts.pending} pending`);
  if (counts.failed) metaParts.push(`${counts.failed} cancelled`);
  if (counts.empty) metaParts.push(`${counts.empty} empty`);

  return (
    <Card className="@container/card gap-0 overflow-hidden p-0">
      <CardHeader className="border-b border-border px-6 py-5">
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {eyebrow}
        </CardDescription>
        <CardTitle className="font-serif text-[22px] font-semibold tracking-tight text-foreground">
          {title}
        </CardTitle>
        <CardAction>
          <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-5" />
          </div>
        </CardAction>
      </CardHeader>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-border bg-muted/30 px-6 py-3">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {counts.total} {counts.total === 1 ? 'stage' : 'stages'}
        </span>
        {metaParts.map((part) => (
          <span
            key={part}
            className="font-mono text-[10px] uppercase tracking-wider tabular-nums text-muted-foreground"
          >
            · {part}
          </span>
        ))}
      </div>
      <div className="grid gap-3 p-6 md:grid-cols-2 lg:grid-cols-3">
        {stages.map((stage) => (
          <StageStatusTile
            key={stage.key}
            stage={stage}
            ayCode={ayCode}
            enroleeNumber={enroleeNumber}
            currentSectionId={stage.key === 'class' ? currentSectionId : null}
          />
        ))}
      </div>
    </Card>
  );
}

function StageStatusTile({
  stage,
  ayCode,
  enroleeNumber,
  currentSectionId,
}: {
  stage: StageCard;
  ayCode: string;
  enroleeNumber: string;
  /** Set only for the `class` stage when the section ID is known.
   *  Drives the "Move to another section →" CTA. */
  currentSectionId?: string | null;
}) {
  const StageIcon = STAGE_ICON[stage.key];
  const stripe = statusStripeClass(stage.status);
  // Class assignment is auto-populated by pickSectionForApplicant when
  // applicationStatus flips to Enrolled. Post-Enrolled changes route
  // through the dedicated section-transfer endpoint (KD #67), not the
  // stage edit dialog. Hide the edit button here and label as auto.
  const autoManaged = stage.key === 'class';

  return (
    <div className="group relative flex flex-col gap-2.5 overflow-hidden rounded-xl border border-hairline bg-gradient-to-t from-primary/5 to-card p-4 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-1', stripe)} />

      <div className="flex items-start justify-between gap-2 pl-1">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <StageIcon className="size-4" />
          </div>
          <h3 className="font-serif text-sm font-semibold leading-tight tracking-tight text-foreground">
            {stage.label}
          </h3>
        </div>
        {autoManaged ? (
          <Badge variant="muted" className="shrink-0 gap-1">
            <Sparkles className="size-3" />
            Auto
          </Badge>
        ) : (
          <EditStageDialog
            ayCode={ayCode}
            enroleeNumber={enroleeNumber}
            stageKey={stage.key}
            initialStatus={stage.status}
            initialRemarks={stage.remarks}
            initialExtras={stage.extrasInitial}
          />
        )}
      </div>

      <div className="pl-1">
        <StageStatusBadge status={stage.status} />
      </div>

      {stage.updatedAt ? (
        <span className="pl-1 font-mono text-[10px] uppercase tracking-wider tabular-nums text-muted-foreground">
          {autoManaged && 'Auto-assigned · '}
          {formatDate(stage.updatedAt)}
          {stage.updatedBy && (
            <span className="ml-1.5 normal-case text-muted-foreground/80">by {stage.updatedBy}</span>
          )}
        </span>
      ) : autoManaged ? (
        <span className="pl-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Auto-assigned when Enrolled
        </span>
      ) : null}
      {stage.extras && stage.extras.some((e) => !isFieldEmpty(e)) && (
        <div className="pl-1">
          <ExtrasChips fields={stage.extras} />
        </div>
      )}
      {stage.remarks && (
        <p className="ml-1 whitespace-pre-line rounded-md bg-muted/40 px-2 py-1.5 text-[11px] leading-relaxed text-foreground">
          {stage.remarks}
        </p>
      )}
      {autoManaged && currentSectionId && (
        <Button asChild variant="outline" size="sm" className="ml-1 self-start">
          <Link href={`/sis/sections/${currentSectionId}`}>
            <ArrowRightLeft className="size-3.5" />
            Move to another section
          </Link>
        </Button>
      )}
    </div>
  );
}

// ─── medical + billing ──────────────────────────────────────────────────────

const MEDICAL_FLAGS: Array<{ key: keyof ApplicationRow; label: string }> = [
  { key: 'allergies', label: 'Allergies' },
  { key: 'foodAllergies', label: 'Food allergies' },
  { key: 'asthma', label: 'Asthma' },
  { key: 'heartConditions', label: 'Heart conditions' },
  { key: 'epilepsy', label: 'Epilepsy' },
  { key: 'diabetes', label: 'Diabetes' },
  { key: 'eczema', label: 'Eczema' },
];

const MEDICAL_DETAILS: Array<{ key: keyof ApplicationRow; label: string }> = [
  { key: 'allergyDetails', label: 'Allergy details' },
  { key: 'foodAllergyDetails', label: 'Food allergy details' },
  { key: 'otherMedicalConditions', label: 'Other conditions' },
  { key: 'dietaryRestrictions', label: 'Dietary restrictions' },
];

function MedicalCard({ app }: { app: ApplicationRow }) {
  const raisedFlags = MEDICAL_FLAGS.filter((f) => app[f.key] === true);
  const detailEntries = MEDICAL_DETAILS.filter((f) => {
    const v = app[f.key] as string | null | undefined;
    return v !== null && v !== undefined && String(v).trim() !== '';
  });
  const paracetamolConsent = app.paracetamolConsent;
  const hasAnyContent =
    raisedFlags.length > 0 || detailEntries.length > 0 || paracetamolConsent !== null;

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <CardHeader className="border-b border-border px-5 py-4">
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Health profile
        </CardDescription>
        <CardTitle className="flex flex-wrap items-baseline gap-2 font-serif text-[18px] font-semibold tracking-tight text-foreground">
          Medical
          {raisedFlags.length > 0 && (
            <Badge variant="warning">
              {raisedFlags.length} flag{raisedFlags.length === 1 ? '' : 's'}
            </Badge>
          )}
        </CardTitle>
        <CardAction>
          <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Heart className="size-5" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4 px-5 py-4">
        {!hasAnyContent && (
          <div className="flex items-center gap-2 rounded-lg border border-hairline bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
            <CheckCircle2 className="size-3.5 shrink-0 text-brand-mint" />
            No medical conditions on file.
          </div>
        )}

        {raisedFlags.length > 0 && (
          <div className="space-y-2">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Conditions declared
            </p>
            <div className="flex flex-wrap gap-1.5">
              {raisedFlags.map((f) => (
                <Badge key={String(f.key)} variant="warning" className="gap-1">
                  <AlertTriangle className="size-3" />
                  {f.label}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {detailEntries.length > 0 && (
          <div className="space-y-3">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Details
            </p>
            <dl className="space-y-3">
              {detailEntries.map((f) => (
                <div key={String(f.key)}>
                  <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {f.label}
                  </dt>
                  <dd className="mt-1 whitespace-pre-line text-sm leading-relaxed text-foreground">
                    {String(app[f.key] ?? '')}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {paracetamolConsent !== null && (
          <div
            className={cn(
              'flex items-center gap-2.5 rounded-lg border px-3 py-2 text-xs',
              paracetamolConsent
                ? 'border-brand-mint/50 bg-brand-mint/10'
                : 'border-hairline bg-muted/20',
            )}
          >
            {paracetamolConsent ? (
              <CheckCircle2 className="size-3.5 shrink-0 text-brand-mint" />
            ) : (
              <X className="size-3.5 shrink-0 text-destructive" />
            )}
            <span className="text-foreground">
              Paracetamol consent:{' '}
              <span className="font-medium">{paracetamolConsent ? 'Granted' : 'Withheld'}</span>
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BillingCard({ app }: { app: ApplicationRow }) {
  const discountSlots = [
    { label: 'Discount 1', value: app.discount1 },
    { label: 'Discount 2', value: app.discount2 },
    { label: 'Discount 3', value: app.discount3 },
  ];
  const consents: Array<{ label: string; value: boolean | null }> = [
    { label: 'Social media consent', value: app.socialMediaConsent ?? null },
    { label: 'Feedback consent', value: app.feedbackConsent ?? null },
  ];
  const activeDiscounts = discountSlots.filter((d) => d.value && String(d.value).trim() !== '');

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <CardHeader className="border-b border-border px-5 py-4">
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Billing &amp; consents
        </CardDescription>
        <CardTitle className="flex flex-wrap items-baseline gap-2 font-serif text-[18px] font-semibold tracking-tight text-foreground">
          Discounts &amp; consents
          {activeDiscounts.length > 0 && (
            <Badge variant="default">
              {activeDiscounts.length} discount{activeDiscounts.length === 1 ? '' : 's'}
            </Badge>
          )}
        </CardTitle>
        <CardAction>
          <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Tags className="size-5" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4 px-5 py-4">
        <div className="space-y-2">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Discount slots
          </p>
          <ul className="space-y-1.5">
            {discountSlots.map((d) => {
              const filled = !!d.value && String(d.value).trim() !== '';
              return (
                <li
                  key={d.label}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md border px-3 py-2 text-xs',
                    filled
                      ? 'border-brand-indigo/30 bg-brand-indigo/5'
                      : 'border-hairline bg-muted/20',
                  )}
                >
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {d.label}
                  </span>
                  {filled ? (
                    <span className="font-mono font-medium tabular-nums text-brand-indigo-deep">
                      {String(d.value)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Empty</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="space-y-2">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Consents
          </p>
          <ul className="space-y-1.5">
            {consents.map((c) => {
              const Icon = c.value === true ? CheckCircle2 : c.value === false ? X : Circle;
              const iconClass =
                c.value === true
                  ? 'text-brand-mint'
                  : c.value === false
                    ? 'text-destructive'
                    : 'text-muted-foreground';
              const bgClass =
                c.value === true
                  ? 'border-brand-mint/40 bg-brand-mint/10'
                  : c.value === false
                    ? 'border-destructive/30 bg-destructive/5'
                    : 'border-hairline bg-muted/20';
              const valueLabel =
                c.value === true ? 'Granted' : c.value === false ? 'Withheld' : 'Not answered';
              return (
                <li
                  key={c.label}
                  className={cn('flex items-center gap-2.5 rounded-md border px-3 py-2 text-xs', bgClass)}
                >
                  <Icon className={cn('size-3.5 shrink-0', iconClass)} />
                  <span className="text-foreground">{c.label}</span>
                  <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {valueLabel}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
