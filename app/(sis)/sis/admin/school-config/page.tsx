import { ArrowLeft, Building2 } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SchoolConfigForm } from "@/components/sis/school-config-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import { getSchoolConfig } from "@/lib/sis/school-config";
import { getSessionUser } from "@/lib/supabase/server";

// Singleton school-wide settings: principal + CEO signature names, PEI
// registration number, default publication window. Superadmin only.
export default async function SchoolConfigPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");
  if (sessionUser.role !== "superadmin") redirect("/sis");

  const current = await getSchoolConfig();

  return (
    <PageShell>
      <Link
        href="/sis"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" />
        SIS Admin
      </Link>

      <header className="space-y-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          SIS Admin · School config
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          School-wide settings.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Report-card signature names, PEI registration number, and the default publication window. One singleton row;
          changes reflect on every new report-card render.
        </p>
      </header>

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
