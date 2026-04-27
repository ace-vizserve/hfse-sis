import { Globe2, Plane } from 'lucide-react';

import {
  ChartLegendChip,
  type ChartLegendChipColor,
} from '@/components/dashboard/chart-legend-chip';
import { ResidenceHistoryEditor } from '@/components/sis/residence-history-editor';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { ApplicationRow, DocumentSlot } from '@/lib/sis/queries';
import { STP_CONDITIONAL_SLOT_KEYS } from '@/lib/sis/queries';

/**
 * StpApplicationCard — Singapore ICA Student Pass surface for foreign-student
 * applicants who opted into the STP sub-flow on the parent portal.
 *
 * Renders only when `application.stpApplicationType IS NOT NULL`. Composes
 * three sections:
 *   1. STP slot status strip — 3 mini status tiles for icaPhoto,
 *      financialSupportDocs, vaccinationInformation. Click to anchor-jump
 *      to the slot in the Documents tab via `#slot-{key}`.
 *   2. Residence history preview — collapsible list of parsed `residenceHistory`
 *      entries (country + cityOrTown + (fromYear → toYear) + purposeOfStay).
 *   3. Edit residence history button — opens a Dialog with a JSON textarea +
 *      structured row editor for the 5-year history ICA expects.
 *
 * Spec: docs/context/21-stp-application.md
 */

// Slot status flow:
//   null      → muted "Not uploaded"     → ChartLegendChip color 'neutral'
//   Uploaded  → parent has uploaded      → 'primary' (in flight)
//   Valid     → registrar has approved   → 'fresh'
//   Rejected  → registrar bounced it     → 'very-stale'
//   *         → unknown legacy value     → 'stale'
function statusToChip(status: string | null | undefined): {
  color: ChartLegendChipColor;
  label: string;
} {
  const v = (status ?? '').trim();
  if (!v) return { color: 'neutral', label: 'Not uploaded' };
  if (v === 'Valid') return { color: 'fresh', label: 'Valid' };
  if (v === 'Uploaded') return { color: 'primary', label: 'Uploaded' };
  if (v === 'Rejected') return { color: 'very-stale', label: 'Rejected' };
  return { color: 'stale', label: v };
}

const STP_SLOT_LABELS: Record<(typeof STP_CONDITIONAL_SLOT_KEYS)[number], string> = {
  icaPhoto: 'ICA Photo',
  financialSupportDocs: 'Financial Support',
  vaccinationInformation: 'Vaccination Records',
};

type ResidenceEntry = {
  country?: string | null;
  cityOrTown?: string | null;
  fromYear?: string | number | null;
  toYear?: string | number | null;
  purposeOfStay?: string | null;
};

function parseResidenceHistory(raw: unknown): {
  ok: true;
  entries: ResidenceEntry[];
} | { ok: false } {
  // The column is jsonb. Supabase returns parsed JSON, so it's typically
  // already an array — but we defensively handle string-encoded fallbacks too.
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

function formatYearRange(from: ResidenceEntry['fromYear'], to: ResidenceEntry['toYear']): string {
  const fromStr = from === null || from === undefined || from === '' ? '?' : String(from);
  const toStr = to === null || to === undefined || to === '' ? '?' : String(to);
  return `${fromStr} → ${toStr}`;
}

export function StpApplicationCard({
  application,
  documents,
  ayCode,
}: {
  application: ApplicationRow;
  documents: DocumentSlot[];
  ayCode: string;
}) {
  // Gate — never render when the parent didn't opt into the STP flow.
  if (!application.stpApplicationType) return null;

  const docByKey = new Map(documents.map((d) => [d.key, d]));
  const stpDocs = STP_CONDITIONAL_SLOT_KEYS.map((key) => ({
    key,
    label: STP_SLOT_LABELS[key],
    doc: docByKey.get(key),
  }));

  const parsed = parseResidenceHistory(application.residenceHistory);

  return (
    <Card className="border-brand-indigo/20">
      <CardHeader className="border-b border-hairline">
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Singapore ICA · Student Pass
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
          Singapore Student Pass
        </CardTitle>
        <div className="pt-1.5">
          <ChartLegendChip color="primary" label={application.stpApplicationType} />
        </div>
        <CardAction>
          <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile [&>svg]:size-5">
            <Plane strokeWidth={2.25} />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        {/* Section 1 — STP slot status strip */}
        <section className="space-y-2.5">
          <div className="flex items-center gap-2 border-b border-hairline pb-2">
            <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-indigo-deep">
              STP document slots
            </h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Three documents are required by ICA on top of the standard package. Click a tile to
            jump to the slot in the Documents tab.
          </p>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {stpDocs.map(({ key, label, doc }) => {
              const chip = statusToChip(doc?.status);
              return (
                <li key={key}>
                  <a
                    href={`#slot-${key}`}
                    className="block rounded-xl border border-hairline bg-card p-3 transition-colors hover:border-brand-indigo/30 hover:bg-muted/40"
                  >
                    <div className="space-y-2">
                      <p className="font-serif text-sm font-semibold text-foreground">{label}</p>
                      <ChartLegendChip color={chip.color} label={chip.label} />
                    </div>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Section 2 — Residence history preview */}
        <section className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline pb-2">
            <div className="flex items-center gap-2">
              <Globe2 className="size-4 text-muted-foreground" />
              <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-indigo-deep">
                Residence history
              </h3>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] tabular-nums text-muted-foreground">
              {parsed.ok ? `${parsed.entries.length} entr${parsed.entries.length === 1 ? 'y' : 'ies'}` : 'Malformed'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            ICA expects the past 5 years of residency to screen overstay risk and prior-country
            exposures.
          </p>
          {parsed.ok ? (
            parsed.entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Residence history not yet captured.
              </p>
            ) : (
              <ul className="space-y-2">
                {parsed.entries.map((entry, idx) => (
                  <li
                    key={idx}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl border border-hairline bg-card px-3 py-2 text-sm"
                  >
                    <span className="font-serif font-semibold text-foreground">
                      {entry.country ?? '(country?)'}
                    </span>
                    {entry.cityOrTown && (
                      <span className="text-muted-foreground">{entry.cityOrTown}</span>
                    )}
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {formatYearRange(entry.fromYear, entry.toYear)}
                    </span>
                    {entry.purposeOfStay && (
                      <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        {entry.purposeOfStay}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )
          ) : (
            <p className="text-sm text-muted-foreground">
              Residence history not yet captured.
            </p>
          )}
        </section>

        {/* Section 3 — Edit residence history */}
        <ResidenceHistoryEditor
          ayCode={ayCode}
          enroleeNumber={application.enroleeNumber}
          initialJson={application.residenceHistory ?? null}
        />
      </CardContent>
    </Card>
  );
}

export default StpApplicationCard;
