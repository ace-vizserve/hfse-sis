import {
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
  Tags,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';

import { EditStageDialog } from '@/components/sis/edit-stage-dialog';
import { type Field } from '@/components/sis/field-grid';
import { StageScrollLink } from '@/components/sis/stage-scroll-link';
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
import { RichText } from '@/components/ui/rich-text';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  ENROLLED_PREREQ_STAGES,
  isAdmissionsStageFrozen,
  STAGE_COLUMN_MAP,
  type StageKey,
} from '@/lib/schemas/sis';
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
  /** May this viewer edit stage statuses? Defaults to FALSE so a caller that
   *  forgets it renders the read-only record rather than an EditStageDialog
   *  whose PATCH route would 403 (KD #173). It also matters beyond the save:
   *  the dialog fetches `assignable-sections`, which 403s for a read-only
   *  viewer and would leave them staring at an empty section picker. */
  canEdit?: boolean;
  /** May this viewer put a student in a class? Narrower than `canEdit` — the
   *  admissions team finishes enrolment (step 10) but Records assigns the
   *  class (step 11, KD #51). Defaults to FALSE for the same reason `canEdit`
   *  does: no picker beats a picker whose save is refused. */
  canAssignSection?: boolean;
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

type ApplicationTone =
  | 'enrolled'
  | 'enrolledConditional'
  | 'cancelled'
  | 'withdrawn'
  | 'open';

const APPLICATION_TILE: Record<
  ApplicationTone,
  {
    gradient: string;
    bandTint: string;
    bandBorder: string;
    icon: LucideIcon;
    label: string;
  }
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
    /^(finished|verified|paid|signed|claimed|enrolled|enrolled \(conditional\))$/i.test(
      s
    )
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
      s
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
            ? new Date(f.value).toLocaleDateString('en-SG', {
                day: '2-digit',
                month: 'short',
              })
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
  const counts = {
    total: stages.length,
    done: 0,
    pending: 0,
    failed: 0,
    active: 0,
    empty: 0,
  };
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
  canEdit = false,
  canAssignSection = false,
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
        {
          label: 'Payment date',
          value: s.registrationPaymentDate,
          asDate: true,
        },
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
        {
          label: 'Math',
          value: s.assessmentGradeMath as string | number | null,
        },
        {
          label: 'English',
          value: s.assessmentGradeEnglish as string | number | null,
        },
        { label: 'Medical', value: s.assessmentMedical },
      ],
      extrasInitial: {
        schedule: s.assessmentSchedule,
        math:
          s.assessmentGradeMath != null ? String(s.assessmentGradeMath) : null,
        english:
          s.assessmentGradeEnglish != null
            ? String(s.assessmentGradeEnglish)
            : null,
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
      extras: [
        { label: 'Claimed date', value: s.suppliesClaimedDate, asDate: true },
      ],
      extrasInitial: { claimedDate: s.suppliesClaimedDate },
    },
    {
      key: 'orientation',
      label: 'Orientation',
      status: s.orientationStatus,
      remarks: s.orientationRemarks,
      updatedAt: s.orientationUpdatedDate,
      updatedBy: s.orientationUpdatedBy,
      extras: [
        { label: 'Schedule', value: s.orientationScheduleDate, asDate: true },
      ],
      extrasInitial: { scheduleDate: s.orientationScheduleDate },
    },
  ];

  const applicationStatus = s.applicationStatus ?? null;
  // Fully Enrolled freezes the funnel (KD #147). 'Enrolled (Conditional)' stays
  // editable — it still has an outstanding condition to resolve.
  const frozen = applicationStatus === 'Enrolled';
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
            <p className="font-medium text-foreground">
              Status row lookup returned an error.
            </p>
            <p className="text-muted-foreground">
              This usually means multiple rows exist in{' '}
              <code className="font-mono">
                {ayCode.toLowerCase()}_enrolment_status
              </code>{' '}
              for this enrolee — the schema allows duplicates. Status fields
              below may not reflect reality; contact an engineer to dedupe
              before editing.
            </p>
          </div>
        </div>
      )}

      {frozen && (
        <div className="flex items-start gap-3 rounded-xl border border-brand-mint/40 bg-brand-mint/10 p-4">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand-mint" />
          <div className="space-y-1 text-sm leading-relaxed">
            <p className="font-medium text-foreground">
              This student is enrolled — the admissions funnel is now a
              read-only record.
            </p>
            <p className="text-muted-foreground">
              Supplies and orientation can still be updated until they&apos;re
              finalized. Manage enrolment (withdrawal, re-enrolment) in Records
              and documents in P-Files.
            </p>
          </div>
        </div>
      )}

      <StageProgressCard
        prereqStages={[...intakeCards, ...commitmentsCards].filter((c) =>
          (ENROLLED_PREREQ_STAGES as readonly StageKey[]).includes(c.key)
        )}
        postEnrolStages={placementCards}
      />

      <ApplicationStatusCard
        applicationCard={applicationCard}
        applicationTone={applicationTone}
        s={s}
        ayCode={ayCode}
        enroleeNumber={enroleeNumber}
        frozen={frozen}
        canEdit={canEdit}
        canAssignSection={canAssignSection}
      />

      <StatusGroupCard
        eyebrow="Intake"
        title="Registration, documents & assessment"
        icon={ClipboardList}
        stages={intakeCards}
        ayCode={ayCode}
        enroleeNumber={enroleeNumber}
        applicationStatus={applicationStatus}
        canEdit={canEdit}
        canAssignSection={canAssignSection}
      />

      <StatusGroupCard
        eyebrow="Commitments"
        title="Contract & fees"
        icon={ShieldCheck}
        stages={commitmentsCards}
        ayCode={ayCode}
        enroleeNumber={enroleeNumber}
        applicationStatus={applicationStatus}
        canEdit={canEdit}
        canAssignSection={canAssignSection}
      />

      <StatusGroupCard
        eyebrow="Placement"
        title="Class, supplies & orientation"
        icon={GraduationCap}
        stages={placementCards}
        ayCode={ayCode}
        enroleeNumber={enroleeNumber}
        currentSectionId={currentSectionId}
        applicationStatus={applicationStatus}
        canEdit={canEdit}
        canAssignSection={canAssignSection}
      />

      {/* items-start so each card sizes to its own content. The default
          stretch made the shorter card grow to match the taller one, which on
          a typical student (little medical data, no discounts) left a large
          empty area below the content and read as missing information rather
          than as a short card. */}
      <div className="grid items-start gap-4 md:grid-cols-2">
        <MedicalCard app={app} />
        <BillingCard app={app} />
      </div>
    </div>
  );
}

// ─── stage progress card ────────────────────────────────────────────────────
//
// Top-of-tab overview. Answers "where is this enrolment right now?" via:
//
//   1. KPI strip — large serif percent + linear progress bar + 'N of M
//      stages done' caption. The bar gives the at-a-glance; the rails
//      below give the per-stage detail.
//   2. Required-for-Enrolled rail — 5-node horizontal stepper. Discs are
//      filled with the §9.3 status gradient per state (done = mint→sky,
//      active = indigo→navy, pending = amber, failed = destructive,
//      empty = hairline-bordered card). Connector segments between two
//      done discs run mint, otherwise hairline — don't lie about partial
//      progress. Readiness pill answers "ready for Enrolled?" in plain
//      English.
//   3. Post-enrollment rail — same pattern, 3 nodes.
//
// Application status (label / Updated date / Edit dialog) lives in the
// standalone ApplicationStatusCard immediately below this card. The two
// are intentionally separate sections — stage progress is the journey,
// application status is the outcome of step 1.

function StageProgressCard({
  prereqStages,
  postEnrolStages,
}: {
  prereqStages: StageCard[];
  postEnrolStages: StageCard[];
}) {
  const prereqCounts = stageBucketCounts(prereqStages);
  const postEnrolCounts = stageBucketCounts(postEnrolStages);
  const totalStages = prereqStages.length + postEnrolStages.length;
  const doneTotal = prereqCounts.done + postEnrolCounts.done;
  const percentComplete =
    totalStages > 0 ? Math.round((doneTotal / totalStages) * 100) : 0;

  return (
    <Card className="@container/overview gap-0 overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Stage progress
        </h2>
      </div>

      {/* KPI strip — percent + linear progress bar */}
      <div className="border-b border-border bg-muted/20 px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-[32px] font-semibold leading-none tabular-nums text-foreground">
              {percentComplete}
              <span className="text-lg font-medium text-muted-foreground">
                %
              </span>
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wider tabular-nums text-muted-foreground">
              {doneTotal} of {totalStages} stages done
            </span>
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-hairline">
          <div
            aria-hidden="true"
            className="h-full rounded-full bg-gradient-to-r from-brand-mint to-brand-sky transition-all duration-300"
            style={{ width: `${percentComplete}%` }}
          />
        </div>
      </div>

      {/* Journey rails */}
      <CardContent className="space-y-5 px-5 py-5">
        <JourneyRail
          eyebrow="Required for Enrolled"
          stages={prereqStages}
          variant="prereq"
        />
        <div className="border-t border-hairline" />
        <JourneyRail
          eyebrow="Post-enrollment"
          stages={postEnrolStages}
          variant="postEnrol"
        />
      </CardContent>
    </Card>
  );
}

// ─── application status card ────────────────────────────────────────────────
//
// Rendered immediately below StageProgressCard. Carries the application
// stage's status label, last-updated meta, Edit dialog, plus the
// application-only extras (enrolmentDate, enroleeType) and remarks.
// Tone-tinted band keys the card to the current applicationTone.

function ApplicationStatusCard({
  applicationCard,
  applicationTone,
  s,
  ayCode,
  enroleeNumber,
  frozen,
  canEdit,
  canAssignSection,
}: {
  applicationCard: StageCard;
  applicationTone: ApplicationTone;
  s: StatusRow;
  ayCode: string;
  enroleeNumber: string;
  frozen: boolean;
  canEdit: boolean;
  canAssignSection: boolean;
}) {
  const tile = APPLICATION_TILE[applicationTone];
  const TileIcon = tile.icon;

  // The five stages that must be terminal before Enrolled is allowed, read off
  // the status row this card already holds.
  //
  // WITHOUT THIS THE DIALOG'S CHECKLIST WAS DEAD CODE. `prereqStatuses` is an
  // optional prop and neither call site passed it, so `showPrereqChecklist` was
  // permanently false: the "N requirements not met yet · saving will fail"
  // warning never rendered, and the inline class picker offered itself to a
  // student who could not be enrolled at all. Same source of truth as the
  // server's `evaluateEnrolledFlipGate`, so the dialog and the route cannot
  // disagree about what "ready" means.
  const prereqStatuses = Object.fromEntries(
    ENROLLED_PREREQ_STAGES.map((stage) => [
      stage,
      (s[STAGE_COLUMN_MAP[stage].statusCol as keyof StatusRow] as
        | string
        | null
        | undefined) ?? null,
    ])
  ) as Partial<Record<StageKey, string | null>>;
  const isEnrolled =
    applicationTone === 'enrolled' || applicationTone === 'enrolledConditional';
  const classChip =
    isEnrolled && s.classLevel && s.classSection
      ? `${s.classLevel} · ${s.classSection}`
      : null;

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
              tile.gradient
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
              tile.gradient
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
          {canEdit && (
            <EditStageDialog
              ayCode={ayCode}
              enroleeNumber={enroleeNumber}
              stageKey="application"
              initialStatus={applicationCard.status}
              initialRemarks={applicationCard.remarks}
              initialExtras={applicationCard.extrasInitial}
              frozen={frozen}
              canAssignSection={canAssignSection}
              prereqStatuses={prereqStatuses}
            />
          )}
        </div>

        {applicationCard.extras &&
          applicationCard.extras.some((e) => !isFieldEmpty(e)) && (
            <div className="rounded-lg border border-hairline bg-card px-3 py-2.5">
              <ExtrasChips fields={applicationCard.extras} />
            </div>
          )}
        {/* RENDERED. Stage remarks run to 4,000 characters and are written in
            the formatting editor on the stage dialog — they are the office's
            account of what happened at this step, and they get a block of
            their own at the full width of the card. `whitespace-pre-line` is
            gone with the escaped text: the line breaks are real elements now,
            and leaving it on would double every gap. `RichText` renders
            nothing for an empty field, so the tinted box no longer appears
            for a remark somebody cleared back to `<p></p>`. */}
        <RichText
          html={applicationCard.remarks}
          className="rounded-lg bg-muted/40 px-3 py-2 text-xs leading-relaxed text-foreground"
        />
      </CardContent>
    </Card>
  );
}

// Stage status → visual tone discriminator. Five buckets matching
// `statusStripeClass` regex groups so the disc recipes stay in lockstep
// with the §9.3 tone vocabulary used elsewhere on this page.
type StageTone = 'done' | 'failed' | 'pending' | 'active' | 'empty';

function stageTone(status: string | null): StageTone {
  const s = (status ?? '').trim();
  if (!s) return 'empty';
  if (
    /^(finished|verified|paid|signed|claimed|enrolled|enrolled \(conditional\))$/i.test(
      s
    )
  ) {
    return 'done';
  }
  if (/^(cancelled|withdrawn|rejected|expired)$/i.test(s)) return 'failed';
  if (/^(pending|unpaid|incomplete)$/i.test(s)) return 'pending';
  if (
    /^(submitted|ongoing verification|processing|ongoing assessment|generated|sent|invoiced|re-invoiced)$/i.test(
      s
    )
  ) {
    return 'active';
  }
  return 'empty';
}

// Per-tone visual recipe for stepper discs. Done discs earn the project
// signature gradient (mint→sky); failed get destructive; active gets
// indigo→navy; pending gets amber; empty stays quiet with a hairline
// outline + bg-card so the connector line visibly terminates at the
// disc's solid edge. Matches §9.3 status palette + project gradient voice.
const STAGE_DISC_RECIPE: Record<
  StageTone,
  {
    discBg: string;
    discIcon: string;
    statusText: string;
  }
> = {
  done: {
    discBg:
      'bg-gradient-to-br from-brand-mint to-brand-sky shadow-brand-tile-mint',
    discIcon: 'text-white',
    statusText: 'text-brand-mint',
  },
  failed: {
    discBg:
      'bg-gradient-to-br from-destructive to-destructive/80 shadow-brand-tile-destructive',
    discIcon: 'text-white',
    statusText: 'text-destructive',
  },
  pending: {
    discBg:
      'bg-gradient-to-br from-brand-amber to-brand-amber/80 shadow-brand-tile-amber',
    discIcon: 'text-white',
    statusText: 'text-brand-amber',
  },
  active: {
    discBg:
      'bg-gradient-to-br from-brand-indigo to-brand-navy shadow-brand-tile',
    discIcon: 'text-white',
    statusText: 'text-brand-indigo',
  },
  empty: {
    discBg: 'border-2 border-hairline bg-card',
    discIcon: 'text-muted-foreground',
    statusText: 'text-muted-foreground',
  },
};

// Rollup-level readiness signal. Maps the section's count buckets to one
// of the §9.3 status pill tones — gives the registrar the at-a-glance
// "ready / not yet" answer that the disc row can't carry on its own.
type RollupReadiness =
  | { tone: 'healthy'; label: string }
  | { tone: 'warning'; label: string }
  | { tone: 'locked'; label: string }
  | { tone: 'info'; label: string }
  | { tone: 'muted'; label: string };

function readinessForPrereq(
  counts: ReturnType<typeof stageBucketCounts>
): RollupReadiness {
  if (counts.total === 0) return { tone: 'muted', label: 'No prereqs' };
  if (counts.done === counts.total)
    return { tone: 'healthy', label: 'Ready for Enrolled' };
  if (counts.failed > 0)
    return { tone: 'locked', label: `${counts.failed} cancelled` };
  const remaining = counts.total - counts.done;
  return { tone: 'warning', label: `${remaining} to complete` };
}

function readinessForPostEnrol(
  counts: ReturnType<typeof stageBucketCounts>
): RollupReadiness {
  if (counts.total === 0) return { tone: 'muted', label: 'Not applicable' };
  if (counts.done === counts.total)
    return { tone: 'healthy', label: 'All done' };
  if (counts.done === 0 && counts.active === 0) {
    return { tone: 'muted', label: 'Activates after Enrolled' };
  }
  if (counts.failed > 0)
    return { tone: 'locked', label: `${counts.failed} cancelled` };
  return { tone: 'info', label: 'In progress' };
}

function JourneyRail({
  eyebrow,
  stages,
  variant,
}: {
  eyebrow: string;
  stages: StageCard[];
  variant: 'prereq' | 'postEnrol';
}) {
  const counts = stageBucketCounts(stages);
  const readiness =
    variant === 'prereq'
      ? readinessForPrereq(counts)
      : readinessForPostEnrol(counts);

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {eyebrow}
          </span>
          <span className="font-serif text-[15px] font-semibold tabular-nums text-foreground">
            {counts.done}
            <span className="text-muted-foreground"> / {counts.total}</span>
          </span>
        </div>
        <StatusBadge tone={readiness.tone}>{readiness.label}</StatusBadge>
      </header>
      <div className="flex items-start">
        {stages.map((stage, i) => (
          <StageNode
            key={stage.key}
            stage={stage}
            isFirst={i === 0}
            isLast={i === stages.length - 1}
            prevTone={i > 0 ? stageTone(stages[i - 1].status) : null}
            nextTone={
              i < stages.length - 1 ? stageTone(stages[i + 1].status) : null
            }
          />
        ))}
      </div>
    </section>
  );
}

function StageNode({
  stage,
  isFirst,
  isLast,
  prevTone,
  nextTone,
}: {
  stage: StageCard;
  isFirst: boolean;
  isLast: boolean;
  prevTone: StageTone | null;
  nextTone: StageTone | null;
}) {
  const tone = stageTone(stage.status);
  const recipe = STAGE_DISC_RECIPE[tone];
  const Icon = STAGE_ICON[stage.key];

  // Connector logic: a segment is "complete" (mint) when BOTH flanking
  // nodes are in their terminal-done state. Anything else stays hairline
  // — don't lie about partial progress.
  const leftSegmentDone = !isFirst && prevTone === 'done' && tone === 'done';
  const rightSegmentDone = !isLast && nextTone === 'done' && tone === 'done';

  return (
    <StageScrollLink
      targetId={`stage-${stage.key}`}
      aria-label={`Jump to ${stage.label} details`}
      className="relative flex min-w-0 flex-1 flex-col items-center gap-2"
    >
      {!isFirst && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute left-0 right-[calc(50%+1.375rem)] top-[22px] h-0.5 -translate-y-1/2',
            leftSegmentDone ? 'bg-brand-mint' : 'bg-hairline'
          )}
        />
      )}
      {!isLast && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute left-[calc(50%+1.375rem)] right-0 top-[22px] h-0.5 -translate-y-1/2',
            rightSegmentDone ? 'bg-brand-mint' : 'bg-hairline'
          )}
        />
      )}

      <div
        className={cn(
          'relative z-10 flex size-11 items-center justify-center rounded-full transition-colors',
          recipe.discBg,
          recipe.discIcon
        )}
      >
        <Icon className="size-[18px]" />
      </div>
      <div className="w-full min-w-0 px-1 text-center">
        <p className="truncate font-serif text-[12px] font-semibold leading-tight text-foreground">
          {stage.label}
        </p>
        <p
          className={cn(
            'mt-0.5 truncate font-mono text-[9px] font-semibold uppercase tracking-[0.12em] tabular-nums',
            recipe.statusText
          )}
        >
          {stage.status?.trim() || 'Not set'}
        </p>
      </div>
    </StageScrollLink>
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
  applicationStatus,
  canEdit,
  canAssignSection,
}: {
  eyebrow: string;
  title: string;
  icon: LucideIcon;
  stages: StageCard[];
  ayCode: string;
  enroleeNumber: string;
  /** Optional — only meaningful for the Placement group's class tile. */
  currentSectionId?: string | null;
  /** Drives the per-stage freeze (KD #147) — passed to each tile. */
  applicationStatus: string | null;
  canEdit: boolean;
  /** Gates the class tile's two Records links (KD #51 / KD #173). */
  canAssignSection: boolean;
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
            applicationStatus={applicationStatus}
            canEdit={canEdit}
            canAssignSection={canAssignSection}
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
  applicationStatus,
  canEdit,
  canAssignSection,
}: {
  stage: StageCard;
  ayCode: string;
  enroleeNumber: string;
  /** Set only for the `class` stage when the section ID is known.
   *  Drives the "Move to another section →" CTA. */
  currentSectionId?: string | null;
  applicationStatus: string | null;
  canEdit: boolean;
  canAssignSection: boolean;
}) {
  // Per-stage freeze (KD #147): all stages freeze once fully Enrolled, except
  // supplies/orientation which stay editable until finalized. Shared with the
  // stage PATCH route so the disabled control matches the server's 422.
  const frozen = isAdmissionsStageFrozen(
    stage.key,
    stage.status,
    applicationStatus
  );
  const StageIcon = STAGE_ICON[stage.key];
  const stripe = statusStripeClass(stage.status);
  // The class stage has no edit control of its own here. Class Assignment is
  // step 11 of HFSE's admission process, done in Records — either alongside
  // the Enrolled flip or, normally, afterwards from the students-needing-setup
  // queue. Post-placement changes route through the section-transfer endpoint
  // (KD #67). So: hide the edit button, and point at whichever Records surface
  // applies.
  const autoManaged = stage.key === 'class';
  const isEnrolledStatus =
    applicationStatus === 'Enrolled' ||
    applicationStatus === 'Enrolled (Conditional)';
  const awaitingPlacement =
    autoManaged && isEnrolledStatus && !currentSectionId;

  return (
    <div
      id={`stage-${stage.key}`}
      className="group relative flex scroll-mt-24 flex-col gap-2.5 overflow-hidden rounded-xl border border-hairline bg-gradient-to-t from-primary/5 to-card p-4 shadow-xs transition-all duration-200 target:ring-2 target:ring-brand-mint hover:-translate-y-0.5 hover:shadow-md"
    >
      <span
        aria-hidden="true"
        className={cn('absolute inset-y-0 left-0 w-1', stripe)}
      />

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
            Assigned in Records
          </Badge>
        ) : canEdit ? (
          <EditStageDialog
            ayCode={ayCode}
            enroleeNumber={enroleeNumber}
            stageKey={stage.key}
            initialStatus={stage.status}
            initialRemarks={stage.remarks}
            initialExtras={stage.extrasInitial}
            frozen={frozen}
          />
        ) : null}
      </div>

      <div className="pl-1">
        <StageStatusBadge status={stage.status} />
      </div>

      {stage.updatedAt ? (
        <span className="pl-1 font-mono text-[10px] uppercase tracking-wider tabular-nums text-muted-foreground">
          {autoManaged && 'Assigned · '}
          {formatDate(stage.updatedAt)}
          {stage.updatedBy && (
            <span className="ml-1.5 normal-case text-muted-foreground/80">
              by {stage.updatedBy}
            </span>
          )}
        </span>
      ) : autoManaged ? (
        <span className="pl-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {awaitingPlacement ? 'Awaiting class assignment' : 'Not assigned yet'}
        </span>
      ) : null}
      {stage.extras && stage.extras.some((e) => !isFieldEmpty(e)) && (
        <div className="pl-1">
          <ExtrasChips fields={stage.extras} />
        </div>
      )}
      {/* RENDERED — same field, same reasoning as the application card above.
          This one is smaller (11px, on a stage tile) but it is still a block
          of its own on its own line, so a list lays out normally here. */}
      <RichText
        html={stage.remarks}
        className="ml-1 rounded-md bg-muted/40 px-2 py-1.5 text-[11px] leading-relaxed text-foreground"
      />
      {/* Both links go to placement surfaces, so both gate on the placement
          role, not merely on canEdit — an admissions viewer following either
          would land on a page their role cannot open (KD #173). */}
      {autoManaged && currentSectionId && canAssignSection && (
        <Button asChild variant="outline" size="sm" className="ml-1 self-start">
          <Link href={`/sis/sections/${currentSectionId}`}>
            <ArrowRightLeft className="size-3.5" />
            Move to another section
          </Link>
        </Button>
      )}
      {/* Enrolled but unplaced — this tile is otherwise a dead end, because
          the class stage is frozen once Enrolled and the queue is the only
          door left. */}
      {awaitingPlacement && canAssignSection && (
        <Button asChild variant="outline" size="sm" className="ml-1 self-start">
          <Link href="/records/unsynced">
            <GraduationCap className="size-3.5" />
            Assign a class
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
    raisedFlags.length > 0 ||
    detailEntries.length > 0 ||
    paracetamolConsent !== null;

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
                : 'border-hairline bg-muted/20'
            )}
          >
            {paracetamolConsent ? (
              <CheckCircle2 className="size-3.5 shrink-0 text-brand-mint" />
            ) : (
              <X className="size-3.5 shrink-0 text-destructive" />
            )}
            <span className="text-foreground">
              Paracetamol consent:{' '}
              <span className="font-medium">
                {paracetamolConsent ? 'Granted' : 'Withheld'}
              </span>
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
  // The discount-code referrer — NOT `marketingReferrerName`, which answers
  // "how did you hear about us" and stays on the profile.
  const referrer = {
    name: (app.referrerName ?? '').trim(),
    mobile: (app.referrerMobile ?? '').trim(),
  };
  const activeDiscounts = discountSlots.filter(
    (d) => d.value && String(d.value).trim() !== ''
  );

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
              {activeDiscounts.length} discount
              {activeDiscounts.length === 1 ? '' : 's'}
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
          {/* Only the slots that hold a code. Three bordered "Empty" rows
              said nothing three times — and most applications have none at
              all (203 of 497 on AY2026; nobody uses more than two). The slot
              NUMBER is dropped here too: on a read-only card the code is the
              information, and which of the three columns stores it isn't
              something the reader acts on. The edit sheet keeps the numbering,
              where it identifies the field being written. */}
          {activeDiscounts.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No discount codes on this application.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {activeDiscounts.map((d) => (
                <li
                  key={d.label}
                  className="flex items-center gap-2.5 rounded-md border border-brand-indigo/30 bg-brand-indigo/5 px-3 py-2 text-xs"
                >
                  <span className="font-mono font-medium tabular-nums text-brand-indigo-deep">
                    {String(d.value)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Who the discount is credited to. Lived under Profile → Application
            preferences until training action item #8 (Tin) — it sat beside
            the "how did you hear about us" marketing referral, which is an
            unrelated question, and away from the codes it actually explains.
            Hidden entirely when neither is recorded, which is most rows. */}
        {(referrer.name || referrer.mobile) && (
          <div className="space-y-2">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Referred by
            </p>
            <ul className="space-y-1.5">
              {referrer.name && (
                <li className="flex items-center justify-between gap-2.5 rounded-md border border-hairline bg-muted/20 px-3 py-2 text-xs">
                  <span className="text-muted-foreground">Name</span>
                  <span className="font-medium text-foreground">
                    {referrer.name}
                  </span>
                </li>
              )}
              {referrer.mobile && (
                <li className="flex items-center justify-between gap-2.5 rounded-md border border-hairline bg-muted/20 px-3 py-2 text-xs">
                  <span className="text-muted-foreground">Mobile</span>
                  <span className="font-mono font-medium tabular-nums text-foreground">
                    {referrer.mobile}
                  </span>
                </li>
              )}
            </ul>
          </div>
        )}

        <div className="space-y-2">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Consents
          </p>
          <ul className="space-y-1.5">
            {consents.map((c) => {
              const Icon =
                c.value === true
                  ? CheckCircle2
                  : c.value === false
                    ? X
                    : Circle;
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
                c.value === true
                  ? 'Granted'
                  : c.value === false
                    ? 'Withheld'
                    : 'Not answered';
              return (
                <li
                  key={c.label}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md border px-3 py-2 text-xs',
                    bgClass
                  )}
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
