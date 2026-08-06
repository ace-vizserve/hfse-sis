import { CalendarRange } from 'lucide-react';
import { redirect } from 'next/navigation';

import {
  AySetupDataTable,
  type AyTableRow,
} from '@/components/sis/ay-setup-data-table';
import {
  checkAyEmpty,
  listAcademicYears,
  listTermsByAy,
} from '@/lib/sis/ay-setup/queries';
import { getSessionUser } from '@/lib/supabase/server';

import { AySetupHeader } from '../ay-setup-header';

// Manage years — create, switch active, delete. Session and capability are
// guarded by the layout; the role is re-read here only because the Delete
// blockers are superadmin-only work and the check narrows the type.
export default async function AySetupManagePage({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  const role = sessionUser.role;

  const sp = await searchParams;
  const [ays, termsByAy] = await Promise.all([
    listAcademicYears(),
    listTermsByAy(),
  ]);
  const activeAyCode = ays.find((a) => a.is_current)?.ay_code ?? null;

  // Blockers only matter when superadmin sees the Delete button — cheap enough
  // to always fetch for HFSE's handful of years.
  const blockersByAy: Record<string, string[]> = {};
  if (role === 'superadmin') {
    await Promise.all(
      ays.map(async (ay) => {
        const res = await checkAyEmpty(ay.ay_code);
        blockersByAy[ay.ay_code] = res.blockers;
      })
    );
  }

  const tableRows: AyTableRow[] = ays.map((ay) => ({
    ...ay,
    termsData: termsByAy[ay.id] ?? [],
    blockers: blockersByAy[ay.ay_code] ?? [],
    activeAyCode,
    otherAys: ays
      .filter((o) => o.ay_code !== ay.ay_code)
      .map((o) => ({ ayCode: o.ay_code, label: o.label })),
    role,
  }));

  return (
    <>
      <AySetupHeader ay={sp.ay} />

      <div className="mt-6 space-y-8">
        <AySetupDataTable rows={tableRows} />

        <section className="rounded-xl border border-hairline bg-card p-4 text-xs leading-relaxed text-muted-foreground">
          <p className="mb-2 flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-indigo-deep">
            <CalendarRange className="size-3" /> Starting a new academic year
          </p>
          <ul className="ml-4 list-disc space-y-1">
            <li>
              <strong>Create the new AY</strong> here — sets up terms, sections,
              subjects, and admissions data all at once. The new AY shows up in
              the switcher right away across every page. (school admin +
              superadmin)
            </li>
            <li>
              <strong>Verify the parent-portal team</strong> is ready to write
              to the new admissions tables. The canonical DDL is frozen in{' '}
              <code className="rounded bg-muted px-1 py-0.5">
                docs/context/10-parent-portal.md
              </code>
              .
            </li>
            <li>
              <strong>Switch active</strong> on the new AY when ready. (school
              admin + superadmin)
            </li>
            <li>
              <strong>Optional:</strong> delete a mis-created AY if it&apos;s
              still empty. (superadmin only)
            </li>
            <li>
              <strong>Get it ready:</strong> work through Year Setup for the new
              year — term dates, calendar, classes, grading sheets, and the
              rest.
            </li>
          </ul>
        </section>
      </div>
    </>
  );
}
