import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { ClassroomSubnav } from '@/components/classroom/classroom-subnav';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/ui/page-shell';
import { loadClassroomAccess, getTermsForAy } from '@/lib/classroom/queries';
import { createClient, getSessionUser } from '@/lib/supabase/server';

type LevelLite = {
  id: string;
  code: string;
  label: string;
  level_type: 'primary' | 'secondary';
};
type AyLite = { ay_code: string; label: string };

type SectionRow = {
  id: string;
  name: string;
  academic_year_id: string;
  level: LevelLite | LevelLite[] | null;
  academic_year: AyLite | AyLite[] | null;
};

const CAPABILITY_COPY: Record<string, string> = {
  adviser:
    'You are the form adviser — attendance, write-ups, grading and the roster are all yours to manage here.',
  subject:
    'You teach a subject in this class. Attendance and write-ups are visible to the form adviser only; your grading sheet is under Grades.',
  oversight: 'Read-only oversight view — every panel available for review.',
};

export default async function ClassroomSectionLayout({
  params,
  children,
}: {
  params: Promise<{ sectionId: string }>;
  children: React.ReactNode;
}) {
  const { sectionId } = await params;

  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  const { id: userId, role } = sessionUser;

  // Authorization, layer 1 (section-level): ROUTE_ACCESS only gates the
  // `/classroom` prefix, not individual classes — a teacher must not be
  // able to open a class they hold no assignment for by typing the URL.
  // This check alone does NOT protect the attendance/write-ups sub-routes
  // (a subject-teacher capability passes it) — those pages re-check
  // canReadAttendance/canReadWriteups themselves. See lib/classroom/queries.ts.
  const { capability } = await loadClassroomAccess(role, userId, sectionId);
  if (!capability) notFound();

  const supabase = await createClient();
  const { data: section } = await supabase
    .from('sections')
    .select(
      'id, name, academic_year_id, level:levels(id, code, label, level_type), academic_year:academic_years(ay_code, label)'
    )
    .eq('id', sectionId)
    .maybeSingle();
  if (!section) notFound();
  const row = section as SectionRow;

  const level = Array.isArray(row.level) ? row.level[0] : row.level;
  const ay = Array.isArray(row.academic_year)
    ? row.academic_year[0]
    : row.academic_year;

  const terms = await getTermsForAy(row.academic_year_id);

  return (
    <PageShell>
      <Link
        href="/classroom"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to classes
      </Link>

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Classroom
          </p>
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
              {row.name}
            </h1>
            {level && (
              <Badge
                variant="outline"
                className="h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
              >
                {level.label}
              </Badge>
            )}
            {ay && (
              <Badge
                variant="outline"
                className="h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
              >
                {ay.ay_code}
              </Badge>
            )}
          </div>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            {CAPABILITY_COPY[capability]}
          </p>
        </div>
      </header>

      <ClassroomSubnav
        sectionId={sectionId}
        capability={capability}
        terms={terms}
      />

      {children}
    </PageShell>
  );
}
