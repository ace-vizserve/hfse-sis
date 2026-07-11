import { ArrowLeft, Building2 } from 'lucide-react';
import Link from 'next/link';
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
      <Link
        href="/sis"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        SIS Admin
      </Link>

      <SisPageHeader
        group="Access & system"
        title="School-wide settings."
        description="Report-card signature names, letterhead, and school-wide defaults. One record; changes reflect on every new report-card render."
      />

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
