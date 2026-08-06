import { AlertTriangle, CheckCircle2, UserCheck, Users2 } from 'lucide-react';
import { redirect } from 'next/navigation';

import { StaffTable } from '@/components/sis/staff-table';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getTeacherList } from '@/lib/auth/staff-list';
import { getSectionStaffingCoverage } from '@/lib/sis/dashboard';
import { loadStaffAssignments } from '@/lib/sis/staff';
import { createClient } from '@/lib/supabase/server';

// Teaching assignments — the staff directory's default cut. Form-adviser and
// subject-teacher assignments for the current year.
//
// Session and role are guarded by the layout, which runs for this route and
// every route beneath it.
export default async function StaffAssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  // Accounts used to live here as `?view=accounts`. That URL was linkable and
  // may be bookmarked, so it keeps working.
  const params = await searchParams;
  if (params.view === 'accounts') redirect('/sis/admin/staff/accounts');

  const supabase = await createClient();
  const { data: ayRow } = await supabase
    .from('academic_years')
    .select('ay_code')
    .eq('is_current', true)
    .single();
  const ayCode = (ayRow as { ay_code: string } | null)?.ay_code;
  if (!ayCode) redirect('/sis');

  const [rows, coverage, teacherList] = await Promise.all([
    loadStaffAssignments(ayCode),
    getSectionStaffingCoverage(ayCode),
    getTeacherList(),
  ]);

  const totalTeachers = rows.filter((r) => !r.disabled).length;
  const withFca = coverage?.withAdviser ?? 0;
  const sectionsMissingFca = coverage
    ? coverage.total - coverage.withAdviser
    : 0;
  const teachingCount = teacherList.length;

  return (
    <>
      {/* "Sections missing FCA" leads — it is the one actionable metric of the
          three (Serial Position / Pareto). */}
      <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:shadow-xs sm:grid-cols-3">
        <Card
          data-slot="card"
          className={
            sectionsMissingFca > 0
              ? 'border-brand-amber/30 bg-gradient-to-r from-brand-amber/10 to-card'
              : 'bg-gradient-to-t from-primary/5 to-card'
          }
        >
          <CardHeader>
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              Sections missing FCA
            </CardDescription>
            <CardTitle
              className={`font-serif text-3xl tabular-nums ${sectionsMissingFca > 0 ? 'text-brand-amber' : 'text-foreground'}`}
            >
              {sectionsMissingFca}
            </CardTitle>
            <CardAction>
              <div
                className={`flex size-9 items-center justify-center rounded-xl ${
                  sectionsMissingFca > 0
                    ? 'bg-gradient-to-br from-brand-amber to-brand-amber/70 text-ink shadow-brand-tile-amber'
                    : 'bg-gradient-to-br from-brand-mint to-brand-mint/60 text-ink shadow-brand-tile-mint'
                }`}
              >
                {sectionsMissingFca > 0 ? (
                  <AlertTriangle className="size-4" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
              </div>
            </CardAction>
          </CardHeader>
        </Card>

        <Card
          data-slot="card"
          className="bg-gradient-to-t from-primary/5 to-card"
        >
          <CardHeader>
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              Active teachers
            </CardDescription>
            <CardTitle className="font-serif text-3xl tabular-nums text-foreground">
              {totalTeachers}
            </CardTitle>
            <CardAction>
              <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <Users2 className="size-4" />
              </div>
            </CardAction>
          </CardHeader>
        </Card>

        <Card
          data-slot="card"
          className="bg-gradient-to-t from-primary/5 to-card"
        >
          <CardHeader>
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              Sections with FCA
            </CardDescription>
            <CardTitle className="font-serif text-3xl tabular-nums text-foreground">
              {withFca}
            </CardTitle>
            <CardAction>
              <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-mint to-brand-mint/60 text-ink shadow-brand-tile-mint">
                <UserCheck className="size-4" />
              </div>
            </CardAction>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            {teachingCount} teaching staff
          </CardDescription>
          <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
            <span className="inline-flex items-center gap-2">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <Users2 className="size-4" />
              </div>
              Teaching assignments
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <StaffTable rows={rows} ayCode={ayCode} />
        </CardContent>
      </Card>
    </>
  );
}
