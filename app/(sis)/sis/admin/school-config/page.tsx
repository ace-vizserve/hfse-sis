import { Building2, ShieldAlert } from 'lucide-react';
import { redirect } from 'next/navigation';

import { SchoolConfigForm } from '@/components/sis/school-config-form';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { getSchoolConfig } from '@/lib/sis/school-config';
import { getSessionUser } from '@/lib/supabase/server';

// Singleton school-wide settings: principal + CEO signature names, PEI
// registration number, default publication window. Superadmin only.
export default async function SchoolConfigPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'superadmin' &&
    sessionUser.role !== 'school_admin'
  ) {
    redirect('/sis');
  }

  const current = await getSchoolConfig();

  return (
    <PageShell>
      <SisPageHeader
        group="Access & system"
        title="School-wide settings."
        description="Report-card signature names, letterhead, and school-wide defaults. One record; changes reflect on every new report-card render."
      />

      {/* Risk banner (Phase-0.4 convention) — same recipe as Subjects'
          "reaches every grading sheet" banner (subjects/page.tsx), since
          this page's blast radius is at least as large: every future
          report-card render AND every subject/overall award tier. */}
      <div className="flex items-start gap-4 rounded-xl border border-brand-amber/30 bg-brand-amber/5 p-5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-amber to-brand-amber/80 text-white shadow-brand-tile-amber">
          <ShieldAlert className="size-4" />
        </div>
        <div className="flex-1 space-y-1.5">
          <p className="font-serif text-base font-semibold text-foreground">
            Changes here apply to every future report card
          </p>
          <p className="text-sm text-muted-foreground">
            Letterhead and signature edits appear on the{' '}
            <strong className="font-semibold text-foreground">
              next report card printed or previewed
            </strong>{' '}
            — no per-AY or per-student scoping. Award-threshold edits (Awards
            tab) re-grade{' '}
            <strong className="font-semibold text-foreground">
              every student&apos;s award tier
            </strong>{' '}
            the moment you save.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Singleton
          </CardDescription>
          <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
            <span className="inline-flex items-center gap-2">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <Building2 className="size-4" />
              </div>
              School config
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SchoolConfigForm current={current} />
        </CardContent>
      </Card>
    </PageShell>
  );
}
