import { YearSetupChecklist } from '@/components/sis/year-setup/year-setup-checklist';
import { listAcademicYears, listTermsByAy } from '@/lib/sis/ay-setup/queries';
import { getAyReadiness } from '@/lib/sis/readiness';
import { resolveSelectedAyCode } from '@/lib/sis/year-setup';

import { AySetupHeader } from './ay-setup-header';

// Year Setup — the readiness checklist for one academic year. Session and
// capability are guarded by the layout.
//
// This was a client-state tab, so it had no URL of its own and could not be
// linked, bookmarked or reached from the sidebar.
export default async function AySetupPage({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string }>;
}) {
  const sp = await searchParams;

  const [ays, termsByAy] = await Promise.all([
    listAcademicYears(),
    listTermsByAy(),
  ]);
  const selectedAyCode = resolveSelectedAyCode(ays, sp.ay);
  const selectedAy = ays.find((a) => a.ay_code === selectedAyCode) ?? null;
  const selectedTerms = selectedAy ? (termsByAy[selectedAy.id] ?? []) : [];
  const readiness = selectedAyCode
    ? await getAyReadiness(selectedAyCode)
    : null;
  const pickerAys = ays.map((a) => ({
    ayCode: a.ay_code,
    label: a.label,
    isCurrent: a.is_current,
  }));

  return (
    <>
      <AySetupHeader ay={sp.ay} />
      <div className="mt-6">
        <YearSetupChecklist
          ays={pickerAys}
          selectedAy={selectedAy}
          selectedTerms={selectedTerms}
          readiness={readiness}
        />
      </div>
    </>
  );
}
