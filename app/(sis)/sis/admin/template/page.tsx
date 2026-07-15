import { redirect } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';

import { TemplateManagerClient } from '@/components/sis/template-manager-client';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/ui/page-shell';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import {
  listEligibleAysForApply,
  listTemplateSections,
  listTemplateSubjectConfigs,
  listTemplateSubjectLevelOfferings,
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

  const [
    templateSections,
    templateConfigs,
    templateOfferings,
    subjects,
    levels,
    eligibleAys,
  ] = await Promise.all([
    listTemplateSections(),
    listTemplateSubjectConfigs(),
    listTemplateSubjectLevelOfferings(),
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

      {/* Amber, not indigo (Phase-0.4 convention correction) — Propagate is
          the single largest blast-radius action in the module: one click
          can push a weight/slot change across every AY you select at once,
          more than any other page's action touches. The indigo tone this
          banner previously used undersold that. */}
      <div className="flex items-start gap-4 rounded-xl border border-brand-amber/30 bg-brand-amber/5 p-5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-amber to-brand-amber/80 text-white shadow-brand-tile-amber">
          <ShieldAlert className="size-4" />
        </div>
        <div className="flex-1 space-y-1.5">
          <p className="font-serif text-base font-semibold text-foreground">
            Edits here touch no year until you push them
          </p>
          <p className="text-sm text-muted-foreground">
            Editing is safe — nothing changes until you use{' '}
            <strong className="font-semibold text-foreground">Propagate</strong>
            , which can update{' '}
            <strong className="font-semibold text-foreground">
              every academic year you select at once
            </strong>{' '}
            — the largest single change any action in this module can make.
          </p>
        </div>
      </div>

      <TemplateManagerClient
        templateSections={templateSections}
        templateConfigs={templateConfigs}
        templateOfferings={templateOfferings}
        subjects={subjects}
        levels={levels}
        eligibleAys={eligibleAys}
      />
    </PageShell>
  );
}
