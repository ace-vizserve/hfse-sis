import { CalendarRange, Globe2, Plane } from 'lucide-react';

import { ResidenceHistoryEditor } from '@/components/sis/residence-history-editor';
import { StpStatusEditor } from '@/components/sis/stp-status-editor';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { ApplicationRow, StpApplicationStatus } from '@/lib/sis/queries';

/**
 * StpApplicationCard — Singapore ICA Student Pass surface for foreign-student
 * applicants who opted into the STP sub-flow on the parent portal.
 *
 * Renders only when `application.stpApplicationType IS NOT NULL`. Composes
 * two sections:
 *   1. STP application status — Pending/Submitted/Approved/Rejected editor
 *      writing to `ay{YY}_enrolment_status.stpApplicationStatus` (migration 050).
 *      Parents file STP documents directly with ICA; the school just records
 *      which phase they're in.
 *   2. Residence history — ICA expects past 5 years of residency. Preview +
 *      structured editor live here.
 *
 * Replaces the prior 3-document-slot model (icaPhoto / financialSupportDocs /
 * vaccinationInformation) per migration 050. The slot columns remain on
 * `ay{YY}_enrolment_documents` for historical preservation but are no longer
 * collected or displayed.
 */

const STATUS_BADGE: Record<
  StpApplicationStatus,
  'warning' | 'default' | 'success' | 'blocked'
> = {
  Pending: 'warning',
  Submitted: 'default',
  Approved: 'success',
  Rejected: 'blocked',
};

type ResidenceEntry = {
  country?: string | null;
  cityOrTown?: string | null;
  fromYear?: string | number | null;
  toYear?: string | number | null;
  purposeOfStay?: string | null;
};

function parseResidenceHistory(
  raw: unknown
): { ok: true; entries: ResidenceEntry[] } | { ok: false } {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false };
    }
  }
  if (!Array.isArray(value)) return { ok: false };
  const entries: ResidenceEntry[] = [];
  for (const e of value) {
    if (e && typeof e === 'object' && !Array.isArray(e)) {
      entries.push(e as ResidenceEntry);
    }
  }
  return { ok: true, entries };
}

function formatYearRange(
  from: ResidenceEntry['fromYear'],
  to: ResidenceEntry['toYear']
): string {
  const fromStr =
    from === null || from === undefined || from === '' ? '?' : String(from);
  const toStr = to === null || to === undefined || to === '' ? '?' : String(to);
  return `${fromStr} → ${toStr}`;
}

function isStpStatus(v: string | null): v is StpApplicationStatus {
  return (
    v === 'Pending' || v === 'Submitted' || v === 'Approved' || v === 'Rejected'
  );
}

export function StpApplicationCard({
  application,
  stpApplicationStatus,
  ayCode,
  canEdit = false,
}: {
  application: ApplicationRow;
  stpApplicationStatus: string | null;
  ayCode: string;
  /** May this viewer edit the STP status and residence history? Defaults to
   *  FALSE so a caller that forgets it renders the record read-only rather
   *  than two editors whose PATCH routes would 403 (KD #173). Both call sites
   *  pass it explicitly. */
  canEdit?: boolean;
}) {
  if (!application.stpApplicationType) return null;

  const normalizedStatus: StpApplicationStatus | null = isStpStatus(
    stpApplicationStatus
  )
    ? stpApplicationStatus
    : null;
  const parsed = parseResidenceHistory(application.residenceHistory);
  const residenceCount = parsed.ok ? parsed.entries.length : 0;

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <CardHeader className="border-b border-border px-5 py-4">
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Singapore ICA · Student Pass
        </CardDescription>
        <CardTitle className="font-serif text-[20px] font-semibold tracking-tight text-foreground">
          Singapore Student Pass
        </CardTitle>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge variant="default">{application.stpApplicationType}</Badge>
          {normalizedStatus && (
            <Badge variant={STATUS_BADGE[normalizedStatus]}>
              {normalizedStatus}
            </Badge>
          )}
        </div>
        <CardAction>
          <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile [&>svg]:size-5">
            <Plane strokeWidth={2.25} />
          </div>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-6 p-5">
        {/* Section 1 — STP application status editor */}
        <section className="space-y-3">
          <SectionHeader
            icon={Plane}
            title="ICA application status"
            subtitle="Parents file the Student Pass directly with ICA. Use this control to record which phase they're in so registrars across the team have a single source of truth."
          />
          {canEdit && (
            <StpStatusEditor
              ayCode={ayCode}
              enroleeNumber={application.enroleeNumber}
              initialStatus={normalizedStatus}
            />
          )}
          <p className="text-[11px] text-muted-foreground">
            Pending = parent hasn&rsquo;t filed yet · Submitted = filed with ICA
            · Approved = ICA issued the pass · Rejected = ICA declined.
          </p>
        </section>

        {/* Section 2 — Residence history */}
        <section className="space-y-3">
          <SectionHeader
            icon={Globe2}
            title="Residence history"
            subtitle="ICA expects the past 5 years of residency to screen overstay risk and prior-country exposures."
            rightSlot={
              parsed.ok ? (
                <Badge variant={residenceCount > 0 ? 'default' : 'outline'}>
                  {residenceCount} {residenceCount === 1 ? 'entry' : 'entries'}
                </Badge>
              ) : (
                <Badge variant="blocked">Malformed</Badge>
              )
            }
          />

          {parsed.ok && parsed.entries.length > 0 ? (
            <ul className="space-y-1.5">
              {parsed.entries.map((entry, idx) => (
                <ResidenceRow key={idx} entry={entry} />
              ))}
            </ul>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-6 text-center">
              <p className="text-sm font-medium text-foreground">
                {parsed.ok
                  ? 'Residence history not yet captured.'
                  : 'Residence history JSON is malformed.'}
              </p>
              {/* Only point at an editor the viewer actually has. */}
              {canEdit && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {parsed.ok
                    ? 'Use the editor below to add the past 5 years.'
                    : 'Open the editor below to repair or replace the value.'}
                </p>
              )}
            </div>
          )}

          {canEdit && (
            <div className="pt-1">
              <ResidenceHistoryEditor
                ayCode={ayCode}
                enroleeNumber={application.enroleeNumber}
                initialJson={application.residenceHistory ?? null}
              />
            </div>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
  rightSlot,
}: {
  icon: typeof Globe2;
  title: string;
  subtitle: string;
  rightSlot?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5 border-b border-hairline pb-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="size-3.5 text-muted-foreground" />
          <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-indigo-deep">
            {title}
          </h3>
        </div>
        {rightSlot}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {subtitle}
      </p>
    </div>
  );
}

function ResidenceRow({ entry }: { entry: ResidenceEntry }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-hairline bg-card px-4 py-2.5">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
        <Globe2 className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-serif text-sm font-semibold leading-tight tracking-tight text-foreground">
            {entry.country ?? '(country?)'}
          </span>
          {entry.cityOrTown && (
            <span className="text-xs text-muted-foreground">
              {entry.cityOrTown}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            <CalendarRange className="size-3" />
            {formatYearRange(entry.fromYear, entry.toYear)}
          </span>
          {entry.purposeOfStay && (
            <Badge variant="secondary">{entry.purposeOfStay}</Badge>
          )}
        </div>
      </div>
    </li>
  );
}
