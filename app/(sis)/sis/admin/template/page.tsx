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

      <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/30 px-4 py-2.5">
        <Info className="size-3.5 shrink-0 text-muted-foreground" />
        <p className="text-[13px] text-muted-foreground">
          Changes here touch no year until you push them.{' '}
          <span className="text-foreground">
            Edit freely, then use Propagate to update existing academic years.
          </span>
        </p>
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
