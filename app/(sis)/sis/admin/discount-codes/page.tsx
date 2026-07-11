import { redirect } from 'next/navigation';
import { CalendarClock, Check, Tag, X } from 'lucide-react';

import { AySwitcher } from '@/components/admissions/ay-switcher';
import { DiscountCodesDataTable } from '@/components/sis/discount-codes-data-table';
import { NewDiscountCodeButton } from '@/components/sis/edit-discount-code-dialog';
import { HubStat } from '@/components/sis/hub-stat';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/ui/page-shell';
import { getCurrentAcademicYear, listAyCodes } from '@/lib/academic-year';
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
    sessionUser.role !== 'registrar' &&
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

  // Single-pass status derivation. `Date.parse(iso)` returns ms directly —
  // no `Date` allocation per code. Pre-compute `todayMs` once.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();

  let activeCount = 0;
  let scheduledCount = 0;
  let expiredCount = 0;
  for (const c of codes) {
    if (!c.startDate || !c.endDate) continue;
    const startMs = Date.parse(c.startDate);
    const endMs = Date.parse(c.endDate);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue;
    if (endMs < todayMs) expiredCount += 1;
    else if (startMs > todayMs) scheduledCount += 1;
    else activeCount += 1;
  }

  return (
    <PageShell>
      <SisPageHeader
        group="This year"
        title="Promotion codes."
        description="Time-bound enrolment discount codes for this academic year. Per-student grants are written by the enrolment portal directly; this page manages the catalogue."
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

      {/* Summary stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <HubStat
          label="Total codes"
          value={codes.length}
          icon={Tag}
          tone="brand"
          subtext={`Configured for ${selectedAy}`}
        />
        <HubStat
          label="Active today"
          value={activeCount}
          icon={Check}
          tone="mint"
          subtext="Within start/end window"
        />
        <HubStat
          label="Scheduled"
          value={scheduledCount}
          icon={CalendarClock}
          tone="sky"
          subtext="Start date is in the future"
        />
        <HubStat
          label="Expired"
          value={expiredCount}
          icon={X}
          tone="muted"
          subtext="End date has passed"
        />
      </div>

      {/* Catalogue table */}
      <DiscountCodesDataTable
        codes={codes}
        ayCode={selectedAy}
        ayLabel={selectedAy}
        toolbarTrailing={
          <NewDiscountCodeButton
            ayCode={currentAy.ay_code}
            ayCodes={ayCodes.filter((c) => !/^AY9/i.test(c))}
          />
        }
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
