import { CheckCircle2 } from 'lucide-react';

import { NewAyButton } from '@/components/sis/ay-setup-wizard';
import { PageTabNav } from '@/components/sis/page-tab-nav';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { Badge } from '@/components/ui/badge';
import {
  getAySetupPreview,
  listAcademicYears,
} from '@/lib/sis/ay-setup/queries';
import { getAyReadiness } from '@/lib/sis/readiness';
import { resolveSelectedAyCode } from '@/lib/sis/year-setup';

/**
 * Header and switcher shared by both Year setup routes.
 *
 * Not a layout, for the same reason Subject Setup's isn't: the readiness chip
 * reads `?ay=`, and a Next layout never sees its route's params. The selected
 * year has to be carried across the tab switch or picking a year then changing
 * tab would silently drop you back to the current one.
 */
export async function AySetupHeader({ ay }: { ay: string | undefined }) {
  const ays = await listAcademicYears();
  const selectedAyCode = resolveSelectedAyCode(ays, ay);
  const selectedAy = ays.find((a) => a.ay_code === selectedAyCode) ?? null;
  const readiness = selectedAyCode
    ? await getAyReadiness(selectedAyCode)
    : null;

  // Preview for the "New AY" wizard. The throwaway code makes the query pull
  // the most-recent existing AY.
  const preview = await getAySetupPreview('__NEW__');

  const ayQuery = ay ? `?ay=${encodeURIComponent(ay)}` : '';

  return (
    <>
      <SisPageHeader
        group="This year"
        title="Year setup."
        description="See how ready an academic year is and configure it in one place — term dates, calendar, sections, grading sheets, and more."
        chips={
          selectedAy && (
            <>
              <Badge
                variant="outline"
                className="h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
              >
                {selectedAy.ay_code}
              </Badge>
              {readiness && (
                <Badge
                  variant="outline"
                  className={
                    readiness.complete === readiness.total
                      ? 'h-7 gap-1 border-brand-mint bg-brand-mint/30 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink'
                      : 'h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground'
                  }
                >
                  {readiness.complete === readiness.total && (
                    <CheckCircle2 className="size-3" />
                  )}
                  {readiness.complete}/{readiness.total} ready
                </Badge>
              )}
            </>
          )
        }
        actions={<NewAyButton preview={preview} variant="outline" />}
      />

      <PageTabNav
        tabs={[
          { href: `/sis/ay-setup${ayQuery}`, label: 'Year Setup' },
          { href: `/sis/ay-setup/manage${ayQuery}`, label: 'Manage years' },
        ]}
      />
    </>
  );
}
