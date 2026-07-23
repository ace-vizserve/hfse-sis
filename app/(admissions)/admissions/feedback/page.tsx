import { MessageSquare, Star, ThumbsUp } from 'lucide-react';
import { redirect } from 'next/navigation';
import type React from 'react';

import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { getAdmissionsFeedback } from '@/lib/admissions/feedback';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { getSessionUser } from '@/lib/supabase/server';
import type { Role } from '@/lib/auth/roles';
import { FeedbackTable } from './feedback-table';

const ALLOWED_ROLES: Role[] = [
  'admissions',
  'academic_coordinator',
  'school_admin',
  'superadmin',
];

function StatCard({
  label,
  value,
  footnote,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  footnote: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {label}
        </CardDescription>
        <CardTitle className="font-serif text-[32px] font-semibold leading-none tabular-nums text-foreground @[240px]/card:text-[38px]">
          {typeof value === 'number' ? value.toLocaleString('en-SG') : value}
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

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!ALLOWED_ROLES.includes(sessionUser.role as Role)) redirect('/');

  const params = await searchParams;
  const currentAy = await getCurrentAcademicYear();
  const selectedAy = params.ay ?? currentAy?.ay_code ?? '';
  if (!selectedAy) redirect('/admissions');

  const { rows, stats } = await getAdmissionsFeedback(selectedAy);

  return (
    <PageShell>
      <header className="space-y-2">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Admissions · Analytics · {selectedAy}
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          Application feedback.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Parent ratings and comments about the online application form
          experience.
        </p>
      </header>

      <div className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-3">
          <StatCard
            label="Average rating"
            value={stats.avgRating !== null ? stats.avgRating.toFixed(1) : '—'}
            footnote={`out of 5 (${stats.ratingCount} response${stats.ratingCount !== 1 ? 's' : ''})`}
            icon={Star}
          />
          <StatCard
            label="Responses"
            value={stats.total}
            footnote="applicants who submitted feedback"
            icon={MessageSquare}
          />
          <StatCard
            label="Open to follow-up"
            value={stats.consentRate !== null ? `${stats.consentRate}%` : '—'}
            footnote={`${stats.consentCount} parent${stats.consentCount !== 1 ? 's' : ''} consented to contact`}
            icon={ThumbsUp}
          />
        </div>
      </div>

      <FeedbackTable rows={rows} ayCode={selectedAy} />
    </PageShell>
  );
}
