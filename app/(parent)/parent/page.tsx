import Link from 'next/link';
import { ArrowUpRight, BookOpen, CheckCircle2, Clock, GraduationCap, Lock } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getStudentsByParentEmail } from '@/lib/supabase/admissions';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { PageShell } from '@/components/ui/page-shell';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

type ChildCard = {
  student_id: string;
  student_number: string;
  full_name: string;
  class_label: string;
  section_id: string;
  publications: Array<{
    term_id: string;
    term_label: string;
    publish_from: string;
    publish_until: string;
    status: 'active' | 'scheduled' | 'expired';
  }>;
};

export default async function ParentHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Layout already verified user + null role; trust it here.
  const email = user?.email ?? '';

  // 1) Resolve the current academic year (dynamic — whatever row has
  //    is_current=true in public.academic_years). Admissions tables are
  //    named ay{YY}_enrolment_* and share the same column definitions from
  //    AY2026 onward, so only the table prefix changes year-to-year.
  const service = createServiceClient();
  const currentAy = await getCurrentAcademicYear(service);
  if (!currentAy) {
    return (
      <PageShell className="max-w-3xl">
        <ParentHero email={email} subtitle="Signed in." />
        <Card className="p-8">
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <BookOpen className="h-8 w-8 text-muted-foreground" />
            <div className="font-serif text-lg font-semibold text-foreground">
              No academic year is active
            </div>
            <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
              Please contact the school office — we&apos;ll let you know as soon as the new year
              is open.
            </p>
          </div>
        </Card>
      </PageShell>
    );
  }

  // 2) Look up the parent's children in admissions for the current AY.
  const admissionsRows = await getStudentsByParentEmail(email, currentAy.ay_code);

  if (admissionsRows.length === 0) {
    return (
      <PageShell className="max-w-3xl">
        <ParentHero email={email} subtitle="Signed in." />
        <Card className="p-8">
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <BookOpen className="h-8 w-8 text-muted-foreground" />
            <div className="font-serif text-lg font-semibold text-foreground">
              No student records linked to this email
            </div>
            <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
              We couldn&apos;t find any HFSE student applications where this email is listed as
              the mother or father contact for the current academic year. If you think this is a
              mistake, please contact the school office.
            </p>
          </div>
        </Card>
      </PageShell>
    );
  }

  // 3) Resolve each student_number → grading student_id via service-role client
  //    (the parent's own cookie-bound client can't read students under RLS 005).
  const studentNumbers = admissionsRows.map((r) => r.student_number);
  const { data: studentRows } = await service
    .from('students')
    .select('id, student_number, last_name, first_name, middle_name')
    .in('student_number', studentNumbers);
  type StudentRow = {
    id: string;
    student_number: string;
    last_name: string;
    first_name: string;
    middle_name: string | null;
  };
  const students = (studentRows ?? []) as StudentRow[];

  // 4) For each student, find their section enrollment in the current AY
  //    and any publications for that section.
  const { data: enrolments } = await service
    .from('section_students')
    .select(
      `id, student_id, section:sections!inner(id, name, academic_year_id, level:levels(label))`,
    )
    .in('student_id', students.map((s) => s.id));

  type EnrolmentRow = {
    id: string;
    student_id: string;
    section:
      | {
          id: string;
          name: string;
          academic_year_id: string;
          level: { label: string } | { label: string }[] | null;
        }
      | null;
  };
  const enrs = ((enrolments ?? []) as unknown as EnrolmentRow[]).filter(
    (e) => e.section && e.section.academic_year_id === currentAy.id,
  );

  const sectionIds = Array.from(new Set(enrs.map((e) => e.section!.id)));
  const { data: pubs } = sectionIds.length > 0
    ? await service
        .from('report_card_publications')
        .select('id, section_id, term_id, publish_from, publish_until')
        .in('section_id', sectionIds)
    : { data: [] };

  const { data: terms } = await service
    .from('terms')
    .select('id, term_number, label')
    .eq('academic_year_id', currentAy.id)
    .order('term_number');
  type TermRow = { id: string; term_number: number; label: string };
  const termList = (terms ?? []) as TermRow[];
  const termLabelById = new Map(termList.map((t) => [t.id, t.label]));

  type PubRow = {
    id: string;
    section_id: string;
    term_id: string;
    publish_from: string;
    publish_until: string;
  };
  const pubRows = (pubs ?? []) as PubRow[];

  // Server component runs per-request; current time is required to bucket
  // publications into active/scheduled/expired.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const children: ChildCard[] = students.flatMap((s) => {
    const enr = enrs.find((e) => e.student_id === s.id);
    if (!enr || !enr.section) return [];
    const level = Array.isArray(enr.section.level)
      ? enr.section.level[0]
      : enr.section.level;
    const sectionPubs = pubRows.filter((p) => p.section_id === enr.section!.id);
    const publications = sectionPubs.map((p) => {
      const from = new Date(p.publish_from).getTime();
      const until = new Date(p.publish_until).getTime();
      const status: 'active' | 'scheduled' | 'expired' =
        now < from ? 'scheduled' : now > until ? 'expired' : 'active';
      return {
        term_id: p.term_id,
        term_label: termLabelById.get(p.term_id) ?? 'Term',
        publish_from: p.publish_from,
        publish_until: p.publish_until,
        status,
      };
    });
    return [
      {
        student_id: s.id,
        student_number: s.student_number,
        full_name: [s.last_name, s.first_name, s.middle_name].filter(Boolean).join(', '),
        class_label: `${level?.label ?? ''} ${enr.section.name}`.trim(),
        section_id: enr.section.id,
        publications,
      },
    ];
  });

  const childLabel = children.length === 1 ? '1 child' : `${children.length} children`;

  return (
    <PageShell className="max-w-4xl">
      <ParentHero
        email={email}
        subtitle={`Viewing ${childLabel} — report cards appear here once the school publishes them.`}
      />

      <div className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs">
          {children.map((child) => (
            <Card key={child.student_id} className="@container/card group">
              <CardHeader>
                <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                  {child.class_label}
                </CardDescription>
                <CardTitle className="font-serif text-xl font-semibold leading-snug tracking-tight text-foreground @[320px]/card:text-[22px]">
                  {child.full_name}
                </CardTitle>
                <CardAction>
                  <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                    <GraduationCap className="size-5" />
                  </div>
                </CardAction>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {child.student_number}
                </p>

                {child.publications.length === 0 && (
                  <div className="rounded-lg border border-dashed border-border bg-background/40 p-5 text-center text-sm text-muted-foreground">
                    No report cards have been published yet. Check back after the school
                    publishes the term.
                  </div>
                )}

                {child.publications.length > 0 && (
                  <div className="space-y-2">
                    {child.publications.map((p) => {
                      const canView = p.status === 'active';
                      return (
                        <div
                          key={p.term_id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/60 px-4 py-3 shadow-xs transition-colors hover:border-primary/40"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-foreground">{p.term_label}</div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-xs">
                              {p.status === 'active' && (
                                <>
                                  <CheckCircle2 className="h-3 w-3 text-primary" />
                                  <span className="font-medium text-primary">Available now</span>
                                </>
                              )}
                              {p.status === 'scheduled' && (
                                <>
                                  <Clock className="h-3 w-3 text-muted-foreground" />
                                  <span className="text-muted-foreground">
                                    Available from{' '}
                                    {new Date(p.publish_from).toLocaleDateString()}
                                  </span>
                                </>
                              )}
                              {p.status === 'expired' && (
                                <span className="text-muted-foreground">
                                  Window closed on{' '}
                                  {new Date(p.publish_until).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          </div>
                          {canView ? (
                            <Link
                              href={`/parent/report-cards/${child.student_id}`}
                              className="inline-flex items-center gap-1 text-sm font-medium text-primary transition-transform hover:underline [&>svg]:hover:translate-x-0.5 [&>svg]:hover:-translate-y-0.5"
                            >
                              View report card
                              <ArrowUpRight className="h-3.5 w-3.5 transition-transform" />
                            </Link>
                          ) : (
                            <span className="text-xs text-muted-foreground">Not available</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <Lock className="size-3" strokeWidth={2.25} />
        <span>AY {currentAy.ay_code.replace('AY', '')}</span>
        <span className="text-border">·</span>
        <span>Secure Parent Portal</span>
        <span className="text-border">·</span>
        <span>Published reports only</span>
      </div>
    </PageShell>
  );
}

function ParentHero({ email, subtitle }: { email: string; subtitle: string }) {
  return (
    <header className="space-y-4">
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Parent Portal
      </p>
      <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
        My children.
      </h1>
      <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
        Signed in as <span className="font-medium text-foreground">{email}</span>. {subtitle}
      </p>
    </header>
  );
}
