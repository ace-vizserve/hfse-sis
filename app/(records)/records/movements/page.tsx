import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  ArrowLeft,
  ArrowLeftRight,
  RotateCcw,
  UserCheck,
  UserMinus,
} from 'lucide-react';

import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { MovementsTable } from '@/components/sis/movements-table';
import { getMovementEvents } from '@/lib/sis/movements';

type SearchParams = Promise<{ scope?: string }>;

export default async function MovementsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'registrar' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }

  const params = await searchParams;
  const includeAllAYs = params.scope === 'all';

  const service = createServiceClient();
  const currentAy = await getCurrentAcademicYear(service);
  if (!currentAy) {
    redirect('/');
  }

  // Reason filtering is now a client-side facet on the table (KD #84); the page
  // loads the full event set and the KPI cards count over it.
  const events = await getMovementEvents(currentAy.ay_code, {
    includeAllAYs,
  });

  // Counts derived from the same array so the cards always match the table
  // (whether scope is current-year or all-time).
  const counts = {
    transfer: events.filter((e) => e.kind === 'section-transfer').length,
    withdrawn: events.filter((e) => e.kind === 'withdrawn').length,
    lateEnrolled: events.filter((e) => e.kind === 'late-enrolled').length,
    reEnrolled: events.filter((e) => e.kind === 're-enrolled').length,
  };
  const scopeLabel = includeAllAYs ? 'All years' : `${currentAy.ay_code}`;

  return (
    <PageShell>
      <Link
        href="/records"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Dashboard
      </Link>

      <header className="space-y-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Records · Enrolment movements · {currentAy.ay_code}
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          Enrolment movements.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Track every section transfer, withdrawal, and late enrolment in one
          place.
        </p>
      </header>

      <div className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @3xl/main:grid-cols-4">
          <MovementStatCard
            description="Section transfers"
            value={counts.transfer}
            icon={ArrowLeftRight}
            footerTitle="Within HFSE, same level"
            footerDetail={scopeLabel}
          />
          <MovementStatCard
            description="Withdrawals"
            value={counts.withdrawn}
            icon={UserMinus}
            footerTitle="Students who left HFSE"
            footerDetail={scopeLabel}
          />
          <MovementStatCard
            description="Late enrolments"
            value={counts.lateEnrolled}
            icon={UserCheck}
            footerTitle="Joined after term start"
            footerDetail={scopeLabel}
          />
          <MovementStatCard
            description="Re-enrolments"
            value={counts.reEnrolled}
            icon={RotateCcw}
            footerTitle="Restored from withdrawn"
            footerDetail={scopeLabel}
          />
        </div>
      </div>

      <MovementsTable
        events={events}
        ayCode={currentAy.ay_code}
        includeAllAYs={includeAllAYs}
      />
    </PageShell>
  );
}

function MovementStatCard({
  description,
  value,
  icon: Icon,
  footerTitle,
  footerDetail,
}: {
  description: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  footerTitle: string;
  footerDetail: string;
}) {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {description}
        </CardDescription>
        <CardTitle className="font-serif text-[28px] font-semibold leading-none tabular-nums text-foreground @[240px]/card:text-[34px]">
          {value.toLocaleString('en-SG')}
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1 text-sm">
        <p className="font-medium text-foreground">{footerTitle}</p>
        <p className="text-xs text-muted-foreground">{footerDetail}</p>
      </CardFooter>
    </Card>
  );
}
