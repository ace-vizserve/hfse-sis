import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  Calendar,
  Clock,
  MessageSquare,
  UserCheck,
  UserMinus,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ManualAddStudent } from './manual-add';
import { TeacherAssignmentsPanel } from '@/components/admin/teacher-assignments-panel';

type LevelLite = { id: string; code: string; label: string; level_type: 'primary' | 'secondary' };

type EnrolmentRow = {
  id: string;
  index_number: number;
  enrollment_status: 'active' | 'late_enrollee' | 'withdrawn';
  enrollment_date: string | null;
  withdrawal_date: string | null;
  student: {
    id: string;
    student_number: string;
    last_name: string;
    first_name: string;
    middle_name: string | null;
  } | null;
};

export default async function SectionRosterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: section } = await supabase
    .from('sections')
    .select('id, name, academic_year_id, level:levels(id, code, label, level_type)')
    .eq('id', id)
    .single();
  if (!section) notFound();

  const { data: rows } = await supabase
    .from('section_students')
    .select(
      'id, index_number, enrollment_status, enrollment_date, withdrawal_date, student:students(id, student_number, last_name, first_name, middle_name)',
    )
    .eq('section_id', id)
    .order('index_number');

  const levelFromSection = (Array.isArray(section.level) ? section.level[0] : section.level) as
    | LevelLite
    | null;
  const { data: configs } = levelFromSection
    ? await supabase
        .from('subject_configs')
        .select('subject:subjects(id, code, name)')
        .eq('academic_year_id', section.academic_year_id)
        .eq('level_id', levelFromSection.id)
    : { data: [] };
  type CfgRow = {
    subject:
      | { id: string; code: string; name: string }
      | { id: string; code: string; name: string }[]
      | null;
  };
  const levelSubjects = ((configs ?? []) as CfgRow[])
    .map((c) => (Array.isArray(c.subject) ? c.subject[0] : c.subject))
    .filter((s): s is { id: string; code: string; name: string } => !!s)
    .sort((a, b) => a.name.localeCompare(b.name));

  const enrolments = (rows ?? []) as unknown as EnrolmentRow[];
  const level = levelFromSection;
  const activeCount = enrolments.filter((e) => e.enrollment_status === 'active').length;
  const lateCount = enrolments.filter((e) => e.enrollment_status === 'late_enrollee').length;
  const withdrawnCount = enrolments.filter((e) => e.enrollment_status === 'withdrawn').length;
  const onRosterCount = activeCount + lateCount;
  const nextIndex = Math.max(0, ...enrolments.map((e) => e.index_number)) + 1;

  return (
    <PageShell>
      <Link
        href="/admin/sections"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to sections
      </Link>

      {/* Hero */}
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Administration · Section
          </p>
          <div className="flex items-baseline gap-3">
            <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
              {section.name}
            </h1>
            {level && (
              <Badge
                variant="outline"
                className="h-7 border-border bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
              >
                {level.label}
              </Badge>
            )}
          </div>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            {onRosterCount} on the roster
            {withdrawnCount > 0 && ` · ${withdrawnCount} withdrawn (kept for audit)`}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/sections/${section.id}/comments`}>
              <MessageSquare className="h-4 w-4" />
              Comments
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/sections/${section.id}/attendance`}>
              <Calendar className="h-4 w-4" />
              Attendance
            </Link>
          </Button>
          <ManualAddStudent sectionId={section.id} nextIndex={nextIndex} />
        </div>
      </header>

      {/* Stat cards */}
      <div className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-3">
          <StatCard
            description="Active"
            value={activeCount}
            icon={UserCheck}
            footerTitle="On the roster"
            footerDetail="Currently enrolled"
          />
          <StatCard
            description="Late enrollees"
            value={lateCount}
            icon={Clock}
            footerTitle={lateCount === 0 ? 'None' : 'Started after term began'}
            footerDetail="Pre-enrolment scores marked N/A"
          />
          <StatCard
            description="Withdrawn"
            value={withdrawnCount}
            icon={UserMinus}
            footerTitle={withdrawnCount === 0 ? 'None this year' : 'Retained for audit'}
            footerDetail="Kept in the roster permanently"
          />
        </div>
      </div>

      {/* Tabs: Roster / Teachers */}
      <Tabs defaultValue="roster">
        <TabsList>
          <TabsTrigger value="roster">
            <Users className="h-3.5 w-3.5" />
            Roster
            <span className="ml-1 font-mono text-[10px] text-muted-foreground">
              {enrolments.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="teachers">
            <UserCheck className="h-3.5 w-3.5" />
            Teachers
          </TabsTrigger>
        </TabsList>

        <TabsContent value="roster" className="mt-4 space-y-4">
          <Card className="overflow-hidden p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="w-14 text-right">#</TableHead>
                  <TableHead>Student number</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enrolments.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-12 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <div className="font-serif text-base font-semibold text-foreground">
                          No students enrolled yet
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Sync from admissions or add a student manually below.
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {enrolments.map((e) => {
                  const withdrawn = e.enrollment_status === 'withdrawn';
                  const s = e.student;
                  const name = s
                    ? [s.last_name, s.first_name, s.middle_name].filter(Boolean).join(', ')
                    : '(missing student)';
                  return (
                    <TableRow key={e.id} className={withdrawn ? 'text-muted-foreground' : ''}>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                        {e.index_number}
                      </TableCell>
                      <TableCell className="font-mono tabular-nums">
                        {s?.student_number ?? '—'}
                      </TableCell>
                      <TableCell
                        className={
                          'font-medium ' + (withdrawn ? 'line-through text-muted-foreground' : 'text-foreground')
                        }
                      >
                        {name}
                      </TableCell>
                      <TableCell>
                        {withdrawn ? (
                          <Badge
                            variant="outline"
                            className="h-6 border-destructive/40 bg-destructive/10 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-destructive"
                          >
                            Withdrawn
                          </Badge>
                        ) : e.enrollment_status === 'late_enrollee' ? (
                          <Badge
                            variant="outline"
                            className="h-6 border-brand-indigo-soft/60 bg-accent px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-indigo-deep"
                          >
                            Late enrollee
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="h-6 border-brand-mint bg-brand-mint/30 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink"
                          >
                            Active
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="teachers" className="mt-4">
          <TeacherAssignmentsPanel sectionId={section.id} levelSubjects={levelSubjects} />
        </TabsContent>
      </Tabs>
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
  value: number;
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
          {value.toLocaleString('en-SG')}
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
