import { ArrowLeft, Settings2 } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { EnvironmentCard } from '@/components/sis/environment-card';
import { SisUrlMissingBanner } from '@/components/sis/sis-url-missing-banner';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import {
  getCurrentEnvironment,
  listEnvironmentAys,
} from '@/lib/sis/environment';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// System-level settings for the SIS. Superadmin only. Today this page
// hosts the Environment switcher (Production / Test); future system
// toggles that don't belong to School Config live here too.
export default async function SettingsPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (sessionUser.role !== 'superadmin') {
    redirect('/sis');
  }

  const service = createServiceClient();
  const { environment, current } = await getCurrentEnvironment(service);
  const { prodAys } = await listEnvironmentAys(service);
  const prodAyOptions = prodAys.map((r) => ({
    ayCode: r.ay_code,
    label: r.label,
    isCurrent: r.is_current,
  }));
  const defaultProdAyCode =
    prodAyOptions.find((p) => p.isCurrent)?.ayCode ??
    (current && !/^AY9/.test(current.ay_code)
      ? current.ay_code
      : prodAyOptions[0]?.ayCode) ??
    null;

  return (
    <PageShell>
      <Link
        href="/sis"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        SIS Admin
      </Link>

      <header className="space-y-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          SIS Admin · Settings
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          System settings.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          System-level controls that aren&apos;t tied to a specific academic
          year. School-wide details (principal, registration number) live on
          School Config.
        </p>
      </header>

      <SisUrlMissingBanner />

      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Environment
          </CardDescription>
          <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
            <span className="inline-flex items-center gap-2">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <Settings2 className="size-4" />
              </div>
              Operating environment
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EnvironmentCard
            current={environment}
            prodAyOptions={prodAyOptions}
            defaultProdAyCode={defaultProdAyCode}
          />
        </CardContent>
      </Card>
    </PageShell>
  );
}
