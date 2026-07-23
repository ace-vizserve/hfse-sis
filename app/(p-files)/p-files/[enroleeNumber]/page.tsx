import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  FileWarning,
  History as HistoryIcon,
  Mail,
  ShieldAlert,
  UserX,
  XCircle,
} from 'lucide-react';

import { DocumentCard } from '@/components/p-files/document-card';
import {
  ActionQueueCard,
  type ActionQueueRow,
} from '@/components/p-files/action-queue-card';
import {
  DocumentGroupTabs,
  type DocumentGroupTab,
} from '@/components/p-files/document-group-tabs';
import { FamilyContactCard } from '@/components/p-files/family-contact-card';
import { RecentActivityStrip } from '@/components/p-files/recent-activity-strip';
import {
  Alert,
  AlertDescription,
  AlertIcon,
  AlertTitle,
} from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { NoCurrentAyCard } from '@/components/ui/no-current-ay-card';
import { PageShell } from '@/components/ui/page-shell';
import { getCurrentAcademicYear, listAyCodes } from '@/lib/academic-year';
import {
  DOCUMENT_SLOTS,
  GROUP_LABELS,
  type DocumentGroup,
} from '@/lib/p-files/document-config';
import {
  getStudentDocumentDetail,
  isStudentEnrolled,
} from '@/lib/p-files/queries';
import {
  compareSlotsByUrgency,
  isActionable,
  classifyUrgency,
} from '@/lib/p-files/urgency';
import { freshenAyDocuments } from '@/lib/p-files/freshen-document-statuses';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

const ACTION_QUEUE_VISIBLE = 5;

export default async function StudentDocumentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ enroleeNumber: string }>;
  searchParams: Promise<{ ay?: string }>;
}) {
  const { enroleeNumber } = await params;
  const { ay: ayParam } = await searchParams;
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'p_file_officer' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }

  const service = createServiceClient();
  const currentAy = await getCurrentAcademicYear(service);
  if (!currentAy) {
    return (
      <PageShell>
        <NoCurrentAyCard />
      </PageShell>
    );
  }

  const ayCodes = await listAyCodes(service);
  const selectedAy =
    ayParam && ayCodes.includes(ayParam) ? ayParam : currentAy.ay_code;

  // Auto-flip + the enrollment whitelist run in parallel — both are
  // gating the detail render and have no shared state. Cached 60s.
  // P-Files is enrolled-only (KD #31). Hide pre-enrolment applicants from
  // the detail surface entirely — they belong on /admissions during the
  // initial-chase phase. Whitelist: Enrolled / Enrolled (Conditional)
  // — per KD #91 classSection is no longer required (legacy Directus rows
  // without classSection render with an amber alert instead of 404).
  const [, enrolled] = await Promise.all([
    freshenAyDocuments(selectedAy),
    isStudentEnrolled(selectedAy, enroleeNumber),
  ]);

  // Lenient AY resolution (mirrors /admissions/applications/[enroleeNumber]).
  // The enroleeNumber identifies WHO; ?ay is only a hint for which year's tables
  // to read. If this enrolee isn't enrolled in the hinted AY — e.g. the operator
  // switched AY, leaving a stale ?ay — don't 404: find the AY where they ARE
  // enrolled and self-correct the URL. enroleeNumber is AY-scoped (Hard Rule #4),
  // so it resolves to a single AY.
  if (!enrolled) {
    const otherAys = ayCodes.filter((ay) => ay !== selectedAy);
    const found = await Promise.all(
      otherAys.map((ay) => isStudentEnrolled(ay, enroleeNumber))
    );
    const idx = found.findIndex(Boolean);
    if (idx === -1) notFound();
    redirect(
      `/p-files/${encodeURIComponent(enroleeNumber)}?ay=${encodeURIComponent(otherAys[idx])}`
    );
  }

  const student = await getStudentDocumentDetail(selectedAy, enroleeNumber);
  if (!student) {
    return (
      <PageShell>
        <Card className="bg-gradient-to-t from-primary/5 to-card shadow-xs">
          <CardHeader>
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              Student not synced
            </CardDescription>
            <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
              Document record unavailable
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              This student is enrolled but has not been synced to the SIS yet.
              Assign them to a section to complete the sync, then return here to
              manage their documents.
            </p>
            <Button asChild size="sm">
              <Link href="/records/unsynced">
                <UserX className="mr-2 size-4" />
                View unsynced students
              </Link>
            </Button>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  const docRow = student.rawDocRow;
  const canWrite =
    sessionUser.role === 'p_file_officer' || sessionUser.role === 'superadmin';

  const pct =
    student.total > 0
      ? Math.round((student.complete / student.total) * 100)
      : 0;
  const circleR = 40;
  const circleCircumference = 2 * Math.PI * circleR;
  const circleDashOffset =
    circleCircumference - (pct / 100) * circleCircumference;

  // Per-slot meta lookup so we don't repeat .find inside the render loops.
  const slotConfigByKey = new Map(DOCUMENT_SLOTS.map((s) => [s.key, s]));

  // Multi-status counts for the hero pill row. Only render the pill when
  // count > 0 — avoids painting a row of zero-state chips that don't help
  // the registrar triage.
  const promisedCount = student.slots.filter((s) => {
    const o = student.outreach[s.key];
    return o?.activePromise != null;
  }).length;
  const remindedCount = student.slots.filter((s) => {
    const o = student.outreach[s.key];
    if (!o?.lastReminderAt) return false;
    // This is a force-dynamic server component (cookies + searchParams);
    // calling Date.now() at render time is intentional — the page renders
    // fresh on every request, no client-side re-render to worry about.
    // eslint-disable-next-line react-hooks/purity
    const days =
      (Date.now() - new Date(o.lastReminderAt).getTime()) / 86_400_000;
    return days < 30;
  }).length;
  const rejectedCount = student.slots.filter(
    (s) => s.status === 'rejected'
  ).length;

  // ── Action queue: top N actionable slots ranked by urgency.
  const actionableSlots = student.slots
    .filter((s) => isActionable(classifyUrgency(s)))
    .slice()
    .sort(compareSlotsByUrgency);
  const totalActionable = actionableSlots.length;
  const actionRows: ActionQueueRow[] = actionableSlots
    .slice(0, ACTION_QUEUE_VISIBLE)
    .map((s) => {
      const config = slotConfigByKey.get(s.key);
      const url = (docRow[s.key] as string | null | undefined) ?? null;
      return {
        slotKey: s.key,
        slotLabel: s.label,
        status: s.status,
        expiryDate: s.expiryDate,
        url,
        meta: config?.meta ?? null,
        expires: config?.expires ?? false,
        lastReminderAt: student.outreach[s.key]?.lastReminderAt ?? null,
      };
    });

  // ── Document groups (existing layout) — slots within each group are
  //    re-sorted by urgency so the most pressing ones appear first.
  const groups: {
    group: DocumentGroup;
    label: string;
    slots: typeof student.slots;
  }[] = [];
  const groupOrder: DocumentGroup[] = ['student-expiring', 'parent', 'student'];
  for (const g of groupOrder) {
    const groupSlots = student.slots
      .filter((slot) => slotConfigByKey.get(slot.key)?.group === g)
      .slice()
      .sort(compareSlotsByUrgency);
    if (groupSlots.length > 0) {
      groups.push({ group: g, label: GROUP_LABELS[g], slots: groupSlots });
    }
  }

  // Build each tab's metadata + pre-rendered DocumentCard grid. Server-
  // renders the cards (they're client components themselves for the
  // approve / reject mutation surface) and hands them to the tab
  // wrapper as `content`. Keeps the tab state on the client side while
  // the data + content stays in the RSC tree.
  const tabGroups: DocumentGroupTab[] = groups.map((g) => {
    const groupActionable = g.slots.filter((s) =>
      isActionable(classifyUrgency(s))
    ).length;
    const groupValid = g.slots.filter((s) => s.status === 'valid').length;
    return {
      group: g.group,
      label: g.label,
      total: g.slots.length,
      validCount: groupValid,
      actionableCount: groupActionable,
      content: (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {g.slots.map((slot) => {
            const config = slotConfigByKey.get(slot.key);
            const url = docRow[slot.key] as string | null | undefined;
            const outreach = student.outreach[slot.key];
            return (
              <DocumentCard
                key={slot.key}
                enroleeNumber={enroleeNumber}
                slotKey={slot.key}
                label={slot.label}
                status={slot.status}
                url={url ?? null}
                expiryDate={slot.expiryDate}
                expires={config?.expires ?? false}
                meta={config?.meta ?? null}
                ayCode={selectedAy}
                canWrite={canWrite}
                studentName={student.fullName}
                recipients={student.recipients}
                lastReminderAt={outreach?.lastReminderAt ?? null}
                activePromise={outreach?.activePromise ?? null}
              />
            );
          })}
        </div>
      ),
    };
  });

  return (
    <PageShell>
      <Link
        href={{ pathname: '/p-files', query: { ay: selectedAy } }}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All students · {selectedAy}
      </Link>

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <header>
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-4">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {canWrite
                ? 'P-Files · Student documents'
                : 'P-Files · Read-only oversight'}
            </p>
            <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
              {student.fullName}.
            </h1>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-muted-foreground">
              {student.studentNumber && (
                <>
                  <span className="font-mono tabular-nums">
                    {student.studentNumber}
                  </span>
                  <span className="text-hairline-strong">·</span>
                </>
              )}
              {student.level && (
                <>
                  <span>{student.level}</span>
                  <span className="text-hairline-strong">·</span>
                </>
              )}
              {student.section && (
                <>
                  <span>{student.section}</span>
                  <span className="text-hairline-strong">·</span>
                </>
              )}
              <span className="font-mono tabular-nums">{selectedAy}</span>
            </div>
            {/* Status pills — only rendered when count > 0. */}
            <div className="flex flex-wrap items-center gap-2">
              {student.expired > 0 && (
                <Badge variant="blocked">
                  <ShieldAlert />
                  {student.expired} expired
                </Badge>
              )}
              {rejectedCount > 0 && (
                <Badge variant="blocked">
                  <XCircle />
                  {rejectedCount} rejected
                </Badge>
              )}
              {student.missing > 0 && (
                <Badge
                  variant="outline"
                  className="border-dashed text-muted-foreground"
                >
                  <FileWarning />
                  {student.missing} missing
                </Badge>
              )}
              {promisedCount > 0 && (
                <Badge variant="default">
                  <CalendarClock />
                  {promisedCount} promised
                </Badge>
              )}
              {remindedCount > 0 && (
                <Badge variant="warning">
                  <Mail />
                  {remindedCount} reminded
                </Badge>
              )}
            </div>
          </div>

          {/* Circular completion indicator — right column. */}
          <div className="flex shrink-0 flex-col items-center gap-2">
            <div className="relative size-24">
              <svg
                className="absolute inset-0 -rotate-90"
                width="96"
                height="96"
                viewBox="0 0 96 96"
                aria-hidden="true"
              >
                <circle
                  cx="48"
                  cy="48"
                  r={circleR}
                  fill="none"
                  strokeWidth="6"
                  stroke="currentColor"
                  className="text-muted-foreground/20"
                />
                <circle
                  cx="48"
                  cy="48"
                  r={circleR}
                  fill="none"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={circleCircumference}
                  strokeDashoffset={circleDashOffset}
                  stroke="currentColor"
                  className={pct === 100 ? 'text-brand-mint' : 'text-primary'}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
                <span className="font-mono text-lg font-semibold tabular-nums text-foreground">
                  {pct}%
                </span>
                <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                  complete
                </span>
              </div>
            </div>
            <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {student.complete}/{student.total} on file
            </p>
          </div>
        </div>
      </header>

      {!student.section && (
        <Alert variant="warning">
          <AlertIcon variant="warning">
            <AlertTriangle className="size-4" />
          </AlertIcon>
          <AlertTitle>This student has no class section assigned.</AlertTitle>
          <AlertDescription>
            They&apos;re enrolled and their documents are tracked here, but they
            haven&apos;t been placed in a class yet. Assign a section from{' '}
            <Link
              href={`/admissions/applications/${enroleeNumber}?ay=${selectedAy}&tab=enrollment`}
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              the enrolment record
            </Link>{' '}
            so they appear on rosters, attendance, and other class-scoped
            surfaces.
          </AlertDescription>
        </Alert>
      )}

      {/* ── Operational row — Action queue + Family contact ──────────── */}
      <section className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ActionQueueCard
            enroleeNumber={enroleeNumber}
            rows={actionRows}
            recipients={student.recipients}
            canWrite={canWrite}
            totalActionable={totalActionable}
          />
        </div>
        <div className="lg:col-span-1">
          <FamilyContactCard
            family={student.family}
            recipients={student.recipients}
            stpApplicationType={student.stpApplicationType}
          />
        </div>
      </section>

      {student.recentEvents.length > 0 && (
        <RecentActivityStrip events={student.recentEvents} />
      )}

      {/* ── Document groups (tabbed) ───────────────────────────────────
          Tab strip collapses the 4 vertically-stacked sections into one
          interactive surface. Default opens the first group with
          actionable work. Per-trigger badge shows the "need action"
          count so the registrar sees where work is waiting without
          flipping every tab. */}
      <DocumentGroupTabs groups={tabGroups} />

      {/* Trust strip */}
      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <HistoryIcon className="size-3" strokeWidth={2.25} />
        <span>{selectedAy}</span>
        <span className="text-border">·</span>
        <span>{enroleeNumber}</span>
      </div>
    </PageShell>
  );
}
