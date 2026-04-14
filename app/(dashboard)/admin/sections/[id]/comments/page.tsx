import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, CircleDashed, MessageSquare, PencilLine } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CommentsGrid } from './comments-grid';

type LevelLite = { code: string; label: string };
type TermLite = { id: string; label: string; term_number: number; is_current: boolean };

export default async function SectionCommentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ term_id?: string }>;
}) {
  const { id } = await params;
  const q = await searchParams;
  const supabase = await createClient();

  const { data: section } = await supabase
    .from('sections')
    .select('id, name, form_class_adviser, academic_year_id, level:levels(code, label)')
    .eq('id', id)
    .single();
  if (!section) notFound();
  const level = (Array.isArray(section.level) ? section.level[0] : section.level) as
    | LevelLite
    | null;

  const { data: terms } = await supabase
    .from('terms')
    .select('id, label, term_number, is_current')
    .eq('academic_year_id', section.academic_year_id)
    .order('term_number');
  const termList = (terms ?? []) as TermLite[];
  const currentTerm = termList.find((t) => t.is_current) ?? termList[0];
  const selectedTermId = q.term_id ?? currentTerm?.id ?? '';
  const selectedTerm = termList.find((t) => t.id === selectedTermId);

  const { data: rows } = selectedTermId
    ? await supabase
        .from('section_students')
        .select(
          'id, index_number, enrollment_status, student:students(id, student_number, last_name, first_name, middle_name)',
        )
        .eq('section_id', id)
        .order('index_number')
    : { data: [] };

  const studentIds = (rows ?? [])
    .map((r) => (Array.isArray(r.student) ? r.student[0] : r.student)?.id)
    .filter((x): x is string => !!x);

  const { data: comments } =
    selectedTermId && studentIds.length > 0
      ? await supabase
          .from('report_card_comments')
          .select('student_id, comment')
          .eq('term_id', selectedTermId)
          .eq('section_id', id)
          .in('student_id', studentIds)
      : { data: [] };
  const byStudent = new Map((comments ?? []).map((c) => [c.student_id, c.comment]));

  const gridRows = (rows ?? []).map((r) => {
    const s = Array.isArray(r.student) ? r.student[0] : r.student;
    return {
      enrolment_id: r.id,
      index_number: r.index_number,
      withdrawn: r.enrollment_status === 'withdrawn',
      student_id: s?.id ?? '',
      student_number: s?.student_number ?? '',
      student_name: s
        ? [s.last_name, s.first_name, s.middle_name].filter(Boolean).join(', ')
        : '(missing)',
      comment: (s && byStudent.get(s.id)) ?? null,
    };
  });

  const active = gridRows.filter((r) => !r.withdrawn);
  const written = active.filter((r) => r.comment && r.comment.trim().length > 0).length;
  const pending = active.length - written;
  const writtenPct = active.length > 0 ? Math.round((written / active.length) * 100) : 0;

  return (
    <PageShell>
      <Link
        href={`/admin/sections/${id}`}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to {level?.label} {section.name}
      </Link>

      {/* Hero */}
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Section · Adviser comments
          </p>
          <div className="flex items-baseline gap-3">
            <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
              Adviser comments.
            </h1>
            <Badge
              variant="outline"
              className="h-7 border-border bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
            >
              {level?.label} {section.name}
            </Badge>
          </div>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Form Class Adviser:{' '}
            <span className="font-medium text-foreground">
              {section.form_class_adviser ?? '—'}
            </span>
            . One free-text comment per student per term. Appears on the published report card.
            Auto-saves on blur.
          </p>
        </div>
      </header>

      {/* Term switcher */}
      {termList.length > 0 && (
        <Tabs value={selectedTermId}>
          <TabsList>
            {termList.map((t) => (
              <TabsTrigger key={t.id} value={t.id} asChild>
                <Link href={`/admin/sections/${id}/comments?term_id=${t.id}`}>
                  {t.label}
                  {t.is_current && (
                    <span className="ml-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                      current
                    </span>
                  )}
                </Link>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {/* Stats */}
      <div className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-3">
          <StatCard
            description={`${selectedTerm?.label ?? 'Term'} · Written`}
            value={`${written} / ${active.length}`}
            icon={PencilLine}
            footerTitle={active.length === 0 ? 'No students yet' : `${writtenPct}% complete`}
            footerDetail="Active students only"
          />
          <StatCard
            description="Pending"
            value={pending.toLocaleString('en-SG')}
            icon={CircleDashed}
            footerTitle={
              pending === 0 ? 'All done for this term' : `${pending} to write`
            }
            footerDetail="Empty comment slots"
          />
          <StatCard
            description="Average length"
            value={avgLength(active)}
            icon={MessageSquare}
            footerTitle="Characters per comment"
            footerDetail="Among students with comments"
          />
        </div>
      </div>

      <CommentsGrid sectionId={id} termId={selectedTermId} rows={gridRows} />
    </PageShell>
  );
}

function avgLength(
  rows: Array<{ comment: string | null }>,
): string {
  const nonEmpty = rows
    .map((r) => (r.comment ?? '').trim())
    .filter((c) => c.length > 0);
  if (nonEmpty.length === 0) return '—';
  const avg = Math.round(
    nonEmpty.reduce((sum, c) => sum + c.length, 0) / nonEmpty.length,
  );
  return avg.toLocaleString('en-SG');
}

function StatCard({
  description,
  value,
  icon: Icon,
  footerTitle,
  footerDetail,
}: {
  description: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  footerTitle: string;
  footerDetail: string;
}) {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {description}
        </CardDescription>
        <CardTitle className="font-serif text-[32px] font-semibold leading-none tabular-nums text-foreground @[240px]/card:text-[38px]">
          {value}
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1 text-sm">
        <p className="font-medium text-foreground">{footerTitle}</p>
        <p className="text-xs text-muted-foreground">{footerDetail}</p>
      </CardFooter>
    </Card>
  );
}
