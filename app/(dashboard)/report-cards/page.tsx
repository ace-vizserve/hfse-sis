import Link from 'next/link';
import {
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  FileText,
  Users,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PublishWindowPanel } from '@/components/admin/publish-window-panel';
import { SectionPicker } from './section-picker';

type LevelLite = { id: string; code: string; label: string; level_type: 'primary' | 'secondary' };

const first = <T,>(v: T | T[] | null): T | null =>
  Array.isArray(v) ? v[0] ?? null : v ?? null;

export default async function ReportCardsListPage({
  searchParams,
}: {
  searchParams: Promise<{ section_id?: string }>;
}) {
  const q = await searchParams;
  const supabase = await createClient();

  const { data: ay } = await supabase
    .from('academic_years')
    .select('id, ay_code, label')
    .eq('is_current', true)
    .single();

  const { data: sections } = ay
    ? await supabase
        .from('sections')
        .select('id, name, level:levels(id, code, label, level_type)')
        .eq('academic_year_id', ay.id)
    : { data: [] };

  const pickerSections = (sections ?? []).map((s) => {
    const lvl = first(s.level as LevelLite | LevelLite[] | null);
    return { id: s.id, name: s.name, level_label: lvl?.label ?? 'Unknown' };
  });

  const { data: terms } = ay
    ? await supabase
        .from('terms')
        .select('id, term_number, label')
        .eq('academic_year_id', ay.id)
        .order('term_number')
    : { data: [] };
  const termList = terms ?? [];

  // Section-detail data (only when a section is selected)
  let selectedLabel: string | null = null;
  let rosterRows: Array<{
    enrolment_id: string;
    index_number: number;
    student_id: string;
    student_number: string;
    name: string;
    withdrawn: boolean;
  }> = [];
  let activeCount = 0;
  let publishedCount = 0;
  let scheduledCount = 0;

  if (q.section_id) {
    const { data: sec } = await supabase
      .from('sections')
      .select('id, name, level:levels(label)')
      .eq('id', q.section_id)
      .single();
    if (sec) {
      const lvl = first(sec.level as { label: string } | { label: string }[] | null);
      selectedLabel = `${lvl?.label ?? ''} ${sec.name}`.trim();
    }

    const { data: enrolments } = await supabase
      .from('section_students')
      .select(
        'id, index_number, enrollment_status, student:students(id, student_number, last_name, first_name, middle_name)',
      )
      .eq('section_id', q.section_id)
      .order('index_number');

    type Row = {
      id: string;
      index_number: number;
      enrollment_status: string;
      student:
        | {
            id: string;
            student_number: string;
            last_name: string;
            first_name: string;
            middle_name: string | null;
          }
        | {
            id: string;
            student_number: string;
            last_name: string;
            first_name: string;
            middle_name: string | null;
          }[]
        | null;
    };
    rosterRows = ((enrolments ?? []) as Row[]).map((e) => {
      const s = first(e.student);
      return {
        enrolment_id: e.id,
        index_number: e.index_number,
        student_id: s?.id ?? '',
        student_number: s?.student_number ?? '',
        name: s
          ? [s.last_name, s.first_name, s.middle_name].filter(Boolean).join(', ')
          : '(missing)',
        withdrawn: e.enrollment_status === 'withdrawn',
      };
    });
    activeCount = rosterRows.filter((r) => !r.withdrawn).length;

    // Publication stats (server-side compute — panel hydrates with its own fetch later)
    const { data: pubs } = await supabase
      .from('report_card_publications')
      .select('id, term_id, publish_from, publish_until')
      .eq('section_id', q.section_id);
    // eslint-disable-next-line react-hooks/purity -- server component, fresh per request
    const now = Date.now();
    for (const p of pubs ?? []) {
      const from = new Date(p.publish_from).getTime();
      const until = new Date(p.publish_until).getTime();
      if (now < from) scheduledCount++;
      else if (now <= until) publishedCount++;
    }
  }

  return (
    <PageShell>
      {/* Hero */}
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Administration · Report cards
          </p>
          <div className="flex items-baseline gap-3">
            <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
              Report cards.
            </h1>
            {ay && (
              <Badge variant="outline">{ay.ay_code}</Badge>
            )}
          </div>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Preview each student&apos;s report card before printing, and control when parents
            can view them. Pick a section to begin.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <SectionPicker sections={pickerSections} selectedId={q.section_id} />
        </div>
      </header>

      {/* No section picked — empty state */}
      {!q.section_id && (
        <Card className="items-center py-16 text-center">
          <CardContent className="flex flex-col items-center gap-4">
            <div className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <FileText className="size-5" />
            </div>
            <div className="space-y-1">
              <div className="font-serif text-xl font-semibold text-foreground">
                Pick a section to begin
              </div>
              <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
                Use the selector in the top right to load a section&apos;s roster and publication
                windows.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Section picked — stats, publish windows, roster */}
      {q.section_id && (
        <>
          {/* Stats */}
          <div className="@container/main">
            <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-3">
              <StatCard
                description={`${selectedLabel ?? 'Section'} · Active`}
                value={activeCount.toLocaleString('en-SG')}
                icon={Users}
                footerTitle="On the roster"
                footerDetail="Eligible for report cards"
              />
              <StatCard
                description="Terms published"
                value={`${publishedCount} / ${termList.length}`}
                icon={CheckCircle2}
                footerTitle={
                  publishedCount === 0
                    ? 'Nothing visible to parents'
                    : `${publishedCount} visible now`
                }
                footerDetail="Within the publish window"
              />
              <StatCard
                description="Scheduled"
                value={scheduledCount.toLocaleString('en-SG')}
                icon={CalendarClock}
                footerTitle={
                  scheduledCount === 0 ? 'None upcoming' : 'Upcoming publish windows'
                }
                footerDetail="Not yet visible to parents"
              />
            </div>
          </div>

          {/* Publish window panel */}
          {selectedLabel && termList.length > 0 && (
            <PublishWindowPanel
              sectionId={q.section_id}
              sectionName={selectedLabel}
              terms={termList}
            />
          )}

          {/* Roster */}
          {selectedLabel && (
            <section className="space-y-3">
              <div className="flex items-baseline justify-between">
                <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {selectedLabel} · Roster
                </h2>
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {rosterRows.length}{' '}
                  {rosterRows.length === 1 ? 'student' : 'students'}
                </span>
              </div>
              <Card className="overflow-hidden p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="w-14 text-right">#</TableHead>
                      <TableHead>Student number</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead className="w-[140px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rosterRows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="py-12 text-center">
                          <div className="flex flex-col items-center gap-2">
                            <div className="font-serif text-base font-semibold text-foreground">
                              No students enrolled
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Sync students from admissions first.
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                    {rosterRows.map((r) => (
                      <TableRow key={r.enrolment_id} className="group">
                        <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                          {r.index_number}
                        </TableCell>
                        <TableCell className="font-mono tabular-nums">
                          {r.student_number}
                        </TableCell>
                        <TableCell
                          className={
                            'font-medium ' +
                            (r.withdrawn
                              ? 'line-through text-muted-foreground'
                              : 'text-foreground')
                          }
                        >
                          {r.name}
                        </TableCell>
                        <TableCell className="text-right">
                          {!r.withdrawn && (
                            <Button asChild size="sm" variant="outline">
                              <Link href={`/report-cards/${r.student_id}`}>
                                Preview
                                <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                              </Link>
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </section>
          )}
        </>
      )}
    </PageShell>
  );
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
