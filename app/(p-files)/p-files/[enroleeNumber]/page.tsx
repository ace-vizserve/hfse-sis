import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  FileWarning,
  History as HistoryIcon,
  Mail,
  ShieldAlert,
  XCircle,
} from 'lucide-react';

import { DocumentCard } from '@/components/p-files/document-card';
import { ActionQueueCard, type ActionQueueRow } from '@/components/p-files/action-queue-card';
import { FamilyContactCard } from '@/components/p-files/family-contact-card';
import { RecentActivityStrip } from '@/components/p-files/recent-activity-strip';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/ui/page-shell';
import { getCurrentAcademicYear, listAyCodes } from '@/lib/academic-year';
import { DOCUMENT_SLOTS, GROUP_LABELS, type DocumentGroup } from '@/lib/p-files/document-config';
import { getStudentDocumentDetail, isStudentEnrolled } from '@/lib/p-files/queries';
import { compareSlotsByUrgency, isActionable, classifyUrgency } from '@/lib/p-files/urgency';
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
    sessionUser.role !== 'p-file' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }

  const service = createServiceClient();
  const currentAy = await getCurrentAcademicYear(service);
  if (!currentAy) notFound();

  const ayCodes = await listAyCodes(service);
  const selectedAy = ayParam && ayCodes.includes(ayParam) ? ayParam : currentAy.ay_code;

  // Auto-flip any expired-but-still-Valid statuses for this AY before
  // the page reads the column. Cached 60s; PATCH routes invalidate via
  // `sis:${ayCode}` tag.
  await freshenAyDocuments(selectedAy);

  // P-Files is enrolled-only (KD #31). Hide pre-enrolment applicants from
  // the detail surface entirely — they belong on /admissions during the
  // initial-chase phase. Strict whitelist (Enrolled / Enrolled (Conditional)
  // + classSection set) — admissions surfaces show the rest.
  const enrolled = await isStudentEnrolled(selectedAy, enroleeNumber);
  if (!enrolled) notFound();

  const student = await getStudentDocumentDetail(selectedAy, enroleeNumber);
  if (!student) notFound();

  const docRow = student.rawDocRow;
  const canWrite = sessionUser.role === 'p-file' || sessionUser.role === 'superadmin';

  const pct = student.total > 0 ? Math.round((student.complete / student.total) * 100) : 0;

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
    const days = (Date.now() - new Date(o.lastReminderAt).getTime()) / 86_400_000;
    return days < 30;
  }).length;
  const rejectedCount = student.slots.filter((s) => s.status === 'rejected').length;

  // ── Action queue: top N actionable slots ranked by urgency.
  const actionableSlots = student.slots
    .filter((s) => isActionable(classifyUrgency(s)))
    .slice()
    .sort(compareSlotsByUrgency);
  const totalActionable = actionableSlots.length;
  const actionRows: ActionQueueRow[] = actionableSlots.slice(0, ACTION_QUEUE_VISIBLE).map((s) => {
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
  const groups: { group: DocumentGroup; label: string; slots: typeof student.slots }[] = [];
  const groupOrder: DocumentGroup[] = ['student-expiring', 'parent', 'student', 'stp'];
  for (const g of groupOrder) {
    const groupSlots = student.slots
      .filter((slot) => slotConfigByKey.get(slot.key)?.group === g)
      .slice()
      .sort(compareSlotsByUrgency);
    if (groupSlots.length > 0) {
      groups.push({ group: g, label: GROUP_LABELS[g], slots: groupSlots });
    }
  }

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
      <header className="space-y-5">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {canWrite ? 'P-Files · Student documents' : 'P-Files · Read-only oversight'}
        </p>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-6">
          <div className="space-y-3">
            <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
              {student.fullName}.
            </h1>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-muted-foreground">
              {student.studentNumber && (
                <>
                  <span className="font-mono tabular-nums">{student.studentNumber}</span>
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
          </div>

          {/* Status pill row — only render counts that are > 0. Gradient
              variants per §9.3 trio (success / warning / blocked) so each
              count carries the same visual language as the card it
              summarises. */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={pct === 100 ? 'success' : 'outline'}>
              <CheckCircle2 />
              {student.complete}/{student.total} on file · {pct}%
            </Badge>
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
              <Badge variant="outline" className="border-dashed text-muted-foreground">
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

        {/* Inline progress bar — replaces the size-16 ring; saves vertical
            real estate for the operational panels below. */}
        <div className="flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full ${pct === 100 ? 'bg-brand-mint' : 'bg-primary'}`}
              style={{ width: `${pct}%`, transition: 'width 0.4s ease' }}
            />
          </div>
          <span className="font-mono text-[11px] font-semibold tabular-nums text-muted-foreground">
            {pct}%
          </span>
        </div>
      </header>

      {/* ── Operational row — Action queue + Family/STP ─────────────── */}
      <section className="grid gap-4 lg:grid-cols-3">
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

      {/* ── Recent activity (auto-hides when no events) ─────────────── */}
      {student.recentEvents.length > 0 && (
        <RecentActivityStrip events={student.recentEvents} />
      )}

      {/* ── Document groups ────────────────────────────────────────── */}
      {groups.map((g) => {
        const groupActionable = g.slots.filter((s) => isActionable(classifyUrgency(s))).length;
        const groupValid = g.slots.filter((s) => s.status === 'valid').length;
        return (
          <section key={g.group} className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-serif text-xl font-semibold tracking-tight text-foreground">
                {g.label}
              </h2>
              <Badge variant="outline">
                {groupValid}/{g.slots.length} valid
              </Badge>
              {groupActionable > 0 && (
                <Badge variant="blocked">
                  {groupActionable} need{groupActionable === 1 ? 's' : ''} action
                </Badge>
              )}
            </div>
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
                    canWrite={canWrite}
                    recipients={student.recipients}
                    lastReminderAt={outreach?.lastReminderAt ?? null}
                    activePromise={outreach?.activePromise ?? null}
                  />
                );
              })}
            </div>
          </section>
        );
      })}

      {/* Trust strip */}
      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <HistoryIcon className="size-3" strokeWidth={2.25} />
        <span>{selectedAy}</span>
        <span className="text-border">·</span>
        <span>{enroleeNumber}</span>
        <span className="text-border">·</span>
        <span>Audit-logged</span>
      </div>
    </PageShell>
  );
}
