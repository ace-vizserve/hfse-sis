import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { ClassroomSubnav } from '@/components/classroom/classroom-subnav';
import {
  showWrongViewNotice,
  WrongViewNotice,
} from '@/components/auth/wrong-view-notice';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/ui/page-shell';
import { ROLE_LABEL } from '@/lib/auth/role-labels';
import { getViewContext } from '@/lib/auth/view-context';
import { loadClassroomAccess, getTermsForAy } from '@/lib/classroom/queries';
import { SCHEDULE_LABELS, type Schedule } from '@/lib/schemas/section';
import { createClient } from '@/lib/supabase/server';

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
  /** Read-only here. The only place this is editable is SIS Admin's section
   *  surface — it's shared school config, not a per-teacher preference, so a
   *  teacher sees when their class meets without being able to change it. */
  schedule: Schedule | null;
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

  const view = await getViewContext();
  if (!view) redirect('/login');
  const { id: userId, activeRole } = view;

  // Authorization, layer 1 (section-level): ROUTE_ACCESS only gates the
  // `/classroom` prefix, not individual classes — a teacher must not be
  // able to open a class they hold no assignment for by typing the URL.
  // This check alone does NOT protect the attendance/write-ups sub-routes
  // (a subject-teacher capability passes it) — those pages re-check
  // canReadAttendance/canReadWriteups themselves. See lib/classroom/queries.ts.
  //
  // ⚠ `activeRole`, NOT `role` — and this is the page half of the rule
  // "role authorises, activeRole renders." ROUTE_ACCESS and the proxy have
  // already admitted this viewer to `/classroom` on their real role by the
  // time this runs; what the lens decides is which of the classes they are
  // ALREADY entitled to is worth rendering, and in what capacity. For a
  // teaching admin in the Teacher view that is `adviser` for her own class
  // instead of `oversight` over all of them — which is what makes the
  // CAPABILITY_COPY line below finally true for her.
  //
  // It narrows in one direction only: her assignment rows are a strict subset
  // of the oversight her account role already had, so the worst this can do is
  // 404 a class she does not teach while she is looking as a teacher. The five
  // `app/api/classroom/**` routes keep passing the real `role`, so nothing she
  // can still see is anything she cannot still save.
  const { capability, substantiveCapability } = await loadClassroomAccess(
    activeRole,
    userId,
    sectionId
  );

  // ⚠ THE SECTION IS FETCHED BEFORE THE CAPABILITY GATE NOW, not after, and
  // the order is load-bearing rather than incidental. The wrong-view notice
  // has to be able to say WHICH class ("3/A isn't a class you teach or
  // advise") — a notice that cannot name the thing you clicked is barely
  // better than the 404 it replaces. It also puts the two failures in the
  // right order: a section id that does not exist is a genuine 404 in every
  // view, and should not be answered with "switch your view to see it".
  //
  // The cost is one indexed single-row read for a viewer who is about to be
  // refused, which is not a page anyone loads in a loop. RLS still applies —
  // this is the cookie client, and it is the viewer's REAL role that decides
  // whether the row comes back, so the lens cannot widen what is readable here.
  const supabase = await createClient();
  const { data: section } = await supabase
    .from('sections')
    .select(
      'id, name, schedule, academic_year_id, level:levels(id, code, label, level_type), academic_year:academic_years(ay_code, label)'
    )
    .eq('id', sectionId)
    .maybeSingle();
  if (!section) notFound();
  const row = section as SectionRow;

  // No capability HERE, in THIS view. For anyone with a second view to switch
  // into, that is a setting rather than a dead end, and saying so is the whole
  // of components/auth/wrong-view-notice.tsx. Everyone else — every real
  // teacher, every admin who does not teach — still gets a plain 404.
  if (!capability) {
    if (showWrongViewNotice(view)) {
      return (
        <PageShell>
          <WrongViewNotice
            view={view}
            heading="Not one of your classes."
            body={`You're viewing as ${ROLE_LABEL[view.activeRole!]}, and ${row.name} isn't a class you teach or advise.`}
            backHref="/classroom"
            backLabel="Back to your classes"
          />
        </PageShell>
      );
    }
    notFound();
  }

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
            {/* Read-only, and only when set — an unset schedule shows nothing
                rather than a "Not set" chip, since a teacher can't act on it
                and the gap belongs to the registrar. Same badge markup and
                order as /sis/sections/[id], so the two pages read alike. */}
            {row.schedule && (
              <Badge
                variant="outline"
                className="h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
              >
                {SCHEDULE_LABELS[row.schedule]}
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
        substantiveCapability={substantiveCapability}
        terms={terms}
      />

      {children}
    </PageShell>
  );
}
