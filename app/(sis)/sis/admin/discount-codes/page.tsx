import { redirect } from 'next/navigation';
import { Ban, CalendarClock, Check, Tag, X } from 'lucide-react';

import { AySwitcher } from '@/components/admissions/ay-switcher';
import { DiscountCodesDataTable } from '@/components/sis/discount-codes-data-table';
import { NewDiscountCodeButton } from '@/components/sis/edit-discount-code-dialog';
import { HubStat } from '@/components/sis/hub-stat';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { Badge } from '@/components/ui/badge';
import { classifyCodeStatus } from '@/components/ui/discount-code-status-badge';
import { PageShell } from '@/components/ui/page-shell';
import { getCurrentAcademicYear, listAyCodes } from '@/lib/academic-year';
import { summarizeDiscountCodeStatuses } from '@/lib/sis/discount-codes-summary';
import { listDiscountCodes } from '@/lib/sis/queries';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export default async function SisDiscountCodesPage({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'admissions' &&
    sessionUser.role !== 'academic_coordinator' &&
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
        <div className="text-sm text-destructive">
          No current academic year configured.
        </div>
      </PageShell>
    );
  }

  const { ay: ayParam } = await searchParams;
  const ayCodes = await listAyCodes(service);
  const selectedAy =
    ayParam && ayCodes.includes(ayParam) ? ayParam : currentAy.ay_code;
  const isCurrentAy = selectedAy === currentAy.ay_code;

  const codes = await listDiscountCodes(selectedAy);

  // Same classifier the table's per-row badges use (classifyCodeStatus) —
  // keeps the summary tiles and the table in agreement, including the
  // "inactive" bucket for codes missing a start or end date.
  const statusCounts = summarizeDiscountCodeStatuses(codes, classifyCodeStatus);

  // Same-origin filter deep-links into the table below — "discounts.status"
  // is the DataTable's own namespaced URL key (KD #84), so a plain <Link>
  // here is a real navigation onto the exact state the status tabs already
  // read, not a second hand-rolled filter mechanism. Preserves ?ay= only
  // when the visitor arrived with one set (mirrors AySwitcher's own
  // param-preservation convention).
  const ayQuery = ayParam ? `ay=${encodeURIComponent(selectedAy)}&` : '';
  const statusHref = (status: string) =>
    `?${ayQuery}discounts.status=${status}`;

  return (
    <PageShell>
      <SisPageHeader
        group="This year"
        title="Promotion codes."
        description="Time-bound enrolment discount codes for this academic year. Per-student grants are written by the enrolment portal directly; this page manages the catalogue."
        actions={
          <NewDiscountCodeButton
            ayCode={currentAy.ay_code}
            ayCodes={ayCodes.filter((c) => !/^AY9/i.test(c))}
          />
        }
        chips={
          <div className="flex flex-col items-start gap-2 md:items-end">
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
              >
                {selectedAy}
              </Badge>
              {isCurrentAy ? (
                <Badge className="h-7 border-brand-mint bg-brand-mint/30 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink">
                  Current
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                >
                  Historical
                </Badge>
              )}
            </div>
            <AySwitcher current={selectedAy} options={ayCodes} />
          </div>
        }
      />

      {/* Summary stats — each tile is a real filter deep-link into the table's
          own status tabs below (same taxonomy rendered twice; only one used
          to be clickable). "Total codes" folds into the header's own count
          convention isn't warranted here (there's no chip carrying a raw
          count elsewhere on this page), so it stays as the "All" tile,
          keeping 5 tiles at a real 5-col rhythm on xl instead of wrapping a
          5th tile alone into a 4-col grid. "Active today" is the
          Pareto-primary number (checked day-to-day; the rest are
          historical/reference) and gets the emphasized treatment. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <HubStat
          label="Total codes"
          value={codes.length}
          icon={Tag}
          tone="brand"
          subtext={`Configured for ${selectedAy}`}
          href={statusHref('all')}
        />
        <HubStat
          label="Active today"
          value={statusCounts.active}
          icon={Check}
          tone="mint"
          subtext="Within start/end window"
          href={statusHref('active')}
          emphasize
        />
        <HubStat
          label="Scheduled"
          value={statusCounts.scheduled}
          icon={CalendarClock}
          tone="sky"
          subtext="Start date is in the future"
          href={statusHref('scheduled')}
        />
        <HubStat
          label="Expired"
          value={statusCounts.expired}
          icon={X}
          tone="muted"
          subtext="End date has passed"
          href={statusHref('expired')}
        />
        <HubStat
          label="Inactive"
          value={statusCounts.inactive}
          icon={Ban}
          tone="amber"
          subtext="Missing a start or end date"
          href={statusHref('inactive')}
        />
      </div>

      {/* Catalogue table */}
      <DiscountCodesDataTable
        codes={codes}
        ayCode={selectedAy}
        ayLabel={selectedAy}
      />

      {/* Trust strip */}
      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <Tag className="size-3" strokeWidth={2.25} />
        <span>{selectedAy}</span>
        <span className="text-border">·</span>
        <span>{codes.length.toLocaleString('en-SG')} codes</span>
        <span className="text-border">·</span>
        <span>Codes are kept in history when expired</span>
      </div>
    </PageShell>
  );
}
