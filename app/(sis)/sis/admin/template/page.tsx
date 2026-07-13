import { redirect } from 'next/navigation';
import { Info } from 'lucide-react';

import { TemplateManagerClient } from '@/components/sis/template-manager-client';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/ui/page-shell';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import {
  listEligibleAysForApply,
  listTemplateSections,
  listTemplateSubjectConfigs,
} from '@/lib/sis/template/queries';
import { listLevels, listSubjects } from '@/lib/sis/subjects/queries';
import { getSessionUser } from '@/lib/supabase/server';

// Master template editor. Superadmin only. Sections + subject_configs
// edited here are what every NEW AY copies from on creation, and the
// admin can also propagate template changes to existing AYs via the
// "Propagate template to AYs" dialog (UPSERT — never deletes).
export default async function TemplateAdminPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'superadmin' &&
    sessionUser.role !== 'school_admin'
  ) {
    redirect('/sis');
  }

  const [templateSections, templateConfigs, subjects, levels, eligibleAys] =
    await Promise.all([
      listTemplateSections(),
      listTemplateSubjectConfigs(),
      listSubjects(),
      listLevels(),
      listEligibleAysForApply(),
    ]);

  return (
    <PageShell>
      <SisPageHeader
        group="Structure"
        title="Structure defaults."
        description="The master sections and subject weights every new academic year copies from on creation."
        chips={
          <Badge
            variant="outline"
            className="h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
          >
            Template
          </Badge>
        }
      />

      <div className="flex items-start gap-4 rounded-xl border border-brand-indigo/30 bg-brand-indigo/5 p-5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
          <Info className="size-4" />
        </div>
        <div className="flex-1 space-y-1.5">
          <p className="font-serif text-base font-semibold text-foreground">
            Changes here touch no year until you push them.
          </p>
          <p className="text-sm text-muted-foreground">
            Edit freely, then use Propagate to update existing academic years.
          </p>
        </div>
      </div>

      <TemplateManagerClient
        templateSections={templateSections}
        templateConfigs={templateConfigs}
        subjects={subjects}
        levels={levels}
        eligibleAys={eligibleAys}
      />
    </PageShell>
  );
}
