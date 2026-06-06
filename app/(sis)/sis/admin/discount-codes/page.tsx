import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, CalendarClock, Check, Tag, X } from 'lucide-react';

import { AySwitcher } from '@/components/admissions/ay-switcher';
import { DiscountCodesDataTable } from '@/components/sis/discount-codes-data-table';
import { NewDiscountCodeButton } from '@/components/sis/edit-discount-code-dialog';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
      <Link
        href="/sis"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        SIS Admin
      </Link>

      {/* Hero */}
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            SIS Admin · Discount codes
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Promotion codes.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Time-bound enrolment discount codes for this academic year.
            Per-student grants are written by the enrolment portal directly;
            this page manages the catalogue.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="h-7 border-border bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
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
                className="h-7 border-border bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
              >
                Historical
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <AySwitcher current={selectedAy} options={ayCodes} />
          </div>
        </div>
      </header>

      {/* Summary stats */}
      <section className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
          <SummaryStat
            label="Total codes"
            value={codes.length}
            icon={Tag}
            footnote={`Configured for ${selectedAy}`}
          />
          <SummaryStat
            label="Active today"
            value={activeCount}
            icon={Check}
            footnote="Within start/end window"
          />
          <SummaryStat
            label="Scheduled"
            value={scheduledCount}
            icon={CalendarClock}
            footnote="Start date is in the future"
          />
          <SummaryStat
            label="Expired"
            value={expiredCount}
            icon={X}
            footnote="End date has passed"
          />
        </div>
      </section>

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

function SummaryStat({
  label,
  value,
  icon: Icon,
  footnote,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  footnote: string;
}) {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {label}
        </CardDescription>
        <CardTitle className="font-serif text-[32px] font-semibold leading-none tabular-nums text-foreground @[240px]/card:text-[38px]">
          {value.toLocaleString('en-SG')}
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardFooter className="text-xs text-muted-foreground">
        {footnote}
      </CardFooter>
    </Card>
  );
}
